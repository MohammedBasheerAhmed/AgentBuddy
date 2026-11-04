import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById, partsFor } from '../src/features/registry.js';
import { prepareRun, RunBlocked } from '../src/lib/pipeline.js';
import { createFirewall, FirewallError } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { buildComposePack, composeParts, formReadRefusal, pageTable, withLanguage } from '../src/compose/rewrite.js';
import { FORM_FIELD_NAMES } from '../src/compose/formFields.js';
import { planFill } from '../src/compose/notesToTicket.js';

// AB-SEC-02 / H2: a Rewrite or Notes run carries the REAL table of the page and the form field the text came from, so the table
// policy, the HR gate, blockedFields and the Strict-mode HR rule apply to it. These run the real pipeline and the real firewall.

const cfg = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const valuesFor = (piiMode = 'standard') => effectiveSettings({ provider: 'anthropic', piiMode }, {}).values;
const run = (id, pack, { piiMode = 'standard', policy = {} } = {}) =>
  prepareRun({ feature: id === 'rewrite-translate' ? withLanguage(featureById(id), 'es') : featureById(id), pack, values: valuesFor(piiMode), policy: normalizePolicy(policy), config: cfg(), createFirewall });

// HR content is only allowed together with an approved AI endpoint (the policy pins the provider).
const HR_OK = { allowHrContent: true, aiProvider: 'anthropic' };
const SICK = 'I am off sick with a back problem until the 12th, please do not tell my manager.';
const REWRITE_IDS = ['rewrite-short', 'rewrite-friendly', 'rewrite-plain', 'rewrite-formal', 'rewrite-fix', 'rewrite-translate', 'rewrite-bilingual'];
const hrPage = { record: { table: 'sn_hr_core_case', sysId: 'a'.repeat(32), number: 'HRC0001' }, newRecord: null };
const incidentPage = { record: { table: 'incident', sysId: 'b'.repeat(32), number: 'INC0010001' }, newRecord: null };
const blankIncident = { record: null, newRecord: { table: 'incident', kind: 'incident' } };

test('the pack takes the table of the page the person is on; the sys_id stays made up', () => {
  assert.equal(pageTable(hrPage), 'sn_hr_core_case');
  assert.equal(pageTable(incidentPage), 'incident');
  assert.equal(pageTable(blankIncident), 'incident', 'a blank form has a table too');
  assert.equal(pageTable({ record: null, newRecord: null }), '');
  assert.equal(pageTable(null), '');
  const pack = buildComposePack({ text: SICK, table: pageTable(hrPage), field: 'description' });
  assert.equal(pack.table, 'sn_hr_core_case');
  assert.equal(pack.sysId, 'compose');
  assert.equal(pack.kind, 'other');
  assert.deepEqual(pack.fields, {});
  assert.equal(buildComposePack({ text: 'x' }).table, 'compose', 'pasted text with no ticket open keeps the made-up table');
  assert.equal(buildComposePack({ text: 'x', table: '' }).table, 'compose');
  assert.equal(buildComposePack({ text: 'x', table: 'Not A Table; DROP' }).table, 'compose', 'a table name is validated');
});

test('the part carries the form field the text came from; unknown names fall back to "text"; call notes stay "notes"', () => {
  for (const name of FORM_FIELD_NAMES) {
    assert.deepEqual(composeParts(buildComposePack({ text: 'hello', field: name })).map((p) => p.field), [name], name);
  }
  assert.equal(composeParts(buildComposePack({ text: 'hello' }))[0].field, 'text');
  assert.equal(composeParts(buildComposePack({ text: 'hello', field: 'notes', label: 'Call notes' }))[0].field, 'notes');
  for (const bad of ['state', 'assigned_to', '__proto__', 'a b', '', null, 42]) assert.equal(composeParts(buildComposePack({ text: 'hello', field: bad }))[0].field, 'text', String(bad));
});

test('Rewrite on a blocked table is refused with the same message as an action on that table', () => {
  const pack = buildComposePack({ text: SICK, table: 'incident', field: 'comments' });
  for (const id of REWRITE_IDS) {
    assert.throws(() => run(id, pack, { policy: { blockedTables: ['incident'] } }), (e) => e instanceof RunBlocked && e.code === 'TABLE_BLOCKED' && /does not allow Agent Buddy to use incident records/.test(e.message), id);
  }
  // the same text with no ticket open is not tied to a table
  assert.doesNotThrow(() => run('rewrite-short', buildComposePack({ text: SICK }), { policy: { blockedTables: ['incident'] } }));
  // and on a table that is not blocked it runs
  assert.doesNotThrow(() => run('rewrite-short', pack, { policy: { blockedTables: ['problem'] } }));
});

test('Rewrite and Notes on an HR case are refused unless the organisation allows HR content', () => {
  for (const id of [...REWRITE_IDS, 'notes-to-ticket']) {
    const pack = buildComposePack({ text: SICK, table: 'sn_hr_core_case', field: id === 'notes-to-ticket' ? 'notes' : 'description' });
    assert.throws(() => run(id, pack), (e) => e instanceof RunBlocked && e.code === 'HR_BLOCKED', id);
    assert.throws(() => run(id, pack, { piiMode: 'strict' }), (e) => e.code === 'HR_BLOCKED', `${id} strict`);
  }
  const allowed = buildComposePack({ text: SICK, table: 'sn_hr_core_case', field: 'description' });
  // Round 3 (TRACKER.md AI0.2): every function on an HR record needs Strict privacy mode, a rewrite too.
  assert.throws(() => run('rewrite-short', allowed, { policy: HR_OK }), (e) => e instanceof RunBlocked && e.code === 'MODE_TOO_LOW');
  assert.doesNotThrow(() => run('rewrite-short', allowed, { policy: HR_OK, piiMode: 'strict' }));
});

test('a blocked field blocks the text that came from it, and only that', () => {
  const policy = { blockedFields: ['comments', 'close_notes'] };
  const fromComments = buildComposePack({ text: SICK, table: 'incident', field: 'comments' });
  assert.throws(() => run('rewrite-short', fromComments, { policy }), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD');
  assert.throws(() => run('rewrite-short', buildComposePack({ text: SICK, table: 'incident', field: 'close_notes' }), { policy }), (e) => e.code === 'BLOCKED_FIELD');
  assert.doesNotThrow(() => run('rewrite-short', buildComposePack({ text: SICK, table: 'incident', field: 'description' }), { policy }));
  assert.doesNotThrow(() => run('rewrite-short', buildComposePack({ text: SICK, table: 'incident' }), { policy }), 'pasted text is "text"');
});

test('the Strict-mode HR rule sees the real table: HR free text is kept out, and goes only where HR is allowed', () => {
  const pack = buildComposePack({ text: SICK, table: 'sn_hr_core_case', field: 'description' });
  const allowed = run('rewrite-short', pack, { piiMode: 'strict', policy: HR_OK });
  assert.equal(allowed.request.table, 'sn_hr_core_case');
  assert.equal(allowed.request.feature, 'rewrite-short');
  assert.ok(partsFor(featureById('rewrite-short'), pack)[0].field === 'description');
});

test('Notes to ticket on a blank form of a blocked table is refused too', () => {
  const pack = buildComposePack({ text: 'vpn down', label: 'Call notes', field: 'notes', table: pageTable(blankIncident) });
  assert.equal(pack.table, 'incident');
  assert.throws(() => run('notes-to-ticket', pack, { policy: { blockedTables: ['incident'] } }), (e) => e.code === 'TABLE_BLOCKED');
  assert.throws(() => run('notes-to-ticket', pack, { policy: { blockedFields: ['notes'] } }), (e) => e.code === 'BLOCKED_FIELD');
  assert.doesNotThrow(() => run('notes-to-ticket', pack));
});

test('the audit label of the run is the real table, not "compose"', () => {
  const p = run('rewrite-short', buildComposePack({ text: 'hello there', table: 'incident', field: 'comments' }));
  assert.equal(p.request.table, 'incident');
  assert.equal(p.pack.table, 'incident');
});

// ---- Reading the form (the panel checks first) -----------------------------------------------------------------------------------

test('"Use what I typed in the form" is refused on a blocked or HR table, or for a blocked field, before anything is read', () => {
  assert.match(formReadRefusal('incident', 'comments', normalizePolicy({ blockedTables: ['incident'] })), /does not allow Agent Buddy to use incident records/);
  assert.match(formReadRefusal('sn_hr_core_case', 'description', normalizePolicy({})), /HR case content is not sent/);
  assert.match(formReadRefusal('sn_hr_core_task', 'description', normalizePolicy({})), /HR case content is not sent/, 'any sn_hr_ table');
  assert.equal(formReadRefusal('sn_hr_core_case', 'description', normalizePolicy(HR_OK)), '');
  assert.match(formReadRefusal('incident', 'comments', normalizePolicy({ blockedFields: ['Comments'] })), /does not allow the comments field/);
  assert.equal(formReadRefusal('incident', 'description', normalizePolicy({ blockedFields: ['comments'] })), '');
  assert.equal(formReadRefusal('incident', 'comments', normalizePolicy({})), '');
  assert.equal(formReadRefusal('', 'comments', normalizePolicy({ blockedTables: ['incident'] })), '', 'no table known: nothing to refuse here (the run still checks)');
  assert.equal(formReadRefusal('incident', 'comments', undefined), '');
});

test('"Use what I typed in the form" also honours the sensitive prefixes the organisation adds (the same check the run makes)', () => {
  const policy = normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'] });
  assert.match(formReadRefusal('x_acme_hr_case', 'description', policy), /HR case content is not sent/);
  assert.match(formReadRefusal('sn_hr_core_case', 'description', policy), /HR case content is not sent/, 'sn_hr_ always counts');
  assert.equal(formReadRefusal('x_acme_hr_case', 'description', normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'], ...HR_OK })), '');
  assert.equal(formReadRefusal('x_acme_hr_case', 'description', normalizePolicy({})), '', 'without the prefix it is an ordinary table');
});

// ---- L10: a case form has no impact and urgency -------------------------------------------------------------------------------------

test('Notes to ticket does not offer impact and urgency for a case form (L10)', () => {
  const values = { shortDescription: 'VPN down', description: 'Since 8am.', impact: 'High', urgency: 'Medium', contactType: 'phone' };
  const incident = planFill(values, { table: 'incident', kind: 'incident' });
  assert.deepEqual(incident.fields.map((f) => f.field), ['short_description', 'description', 'impact', 'urgency', 'contact_type']);
  const kase = planFill(values, { table: 'sn_customerservice_case', kind: 'case' });
  assert.equal(kase.canFill, true);
  assert.deepEqual(kase.fields.map((f) => f.field), ['short_description', 'description'], 'impact, urgency and the incident channel are left alone');
  const onlyLevels = planFill({ impact: 'High', urgency: 'Low' }, { table: 'sn_customerservice_case', kind: 'case' });
  assert.equal(onlyLevels.canFill, false);
  assert.equal(onlyLevels.reason, 'There is nothing to fill yet.');
});

test('no Write feature has an "open" button any more (L1)', () => {
  for (const id of [...REWRITE_IDS, 'notes-to-ticket', 'email-closure']) assert.equal(featureById(id).open, undefined, id);
});
