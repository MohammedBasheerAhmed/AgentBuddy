// The caller briefing (docs/focus-layout.md, part B): the feature's shape, its context spec, its fixed prompt, how the caller is found,
// what the enrich step reads and merges (caller found, no caller, a failed read, a lost session, HR), the parts it builds, and what
// leaves the browser, end to end on the fixture instance through the content script's own entry (src/content/reads.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FEATURES, contextFor, featureById, featuresFor, insertsFor, partsFor } from '../src/features/registry.js';
import callerPack, { CALLER_KINDS } from '../src/features/packs/caller.js';
import callerSpec from '../src/context/specs/caller.js';
import { FEATURES as SPEC_IDS, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, PERSON_COLUMNS } from '../src/context/allowlists.js';
import { KINDS } from '../src/context/kinds.js';
import { handleRead } from '../src/content/reads.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { CALLER_ROLES, CALLER_TICKETS_LIMIT, callerOf, callerTicketsText, cleanCallerTickets, mergeCallerTickets } from '../src/domain/callerTickets.js';
import { columnsForPart } from '../src/features/partColumns.js';
import { QUICK_LABELS } from '../src/features/quick.js';
import { groupOf } from '../src/features/stages.js';
import { PAIN_POINTS } from '../src/features/focus.js';
import { profilesOfFeature } from '../src/profiles/profiles.js';
import { RunBlocked, prepareRun } from '../src/lib/pipeline.js';
import { createFirewall, FirewallError } from '../src/pii/index.js';
import { RULES_PREAMBLE, isSensitiveField } from '../src/pii/firewall.js';
import { UNTRUSTED_MARK, rulesFor } from '../src/prompts/rules.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { AR } from '../src/i18n/ar/index.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { HR_CASE_ID } from './fixtures/sn-hr-case.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, sessionExpiredError, v } from './fixtures/sn-fakeDeps.js';
import { ABEL, BETH, CHARLIE, DAVE, ERIN, HANA, JANE, MARIA } from './fixtures/sn-users.js';

const ID = 'caller-briefing';
const feature = featureById(ID);
const HEADINGS = ['Caller', 'Before', 'Same issue?', 'What fixed it', 'Watch out for'];

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const outgoing = (prepared) => `${prepared.request.messages.map((m) => m.content).join('\n')}\n${prepared.request.preview}`;
const partText = (parts) => parts.map((p) => `${p.label}\n${p.text}`).join('\n');
const partOf = (pack, field) => partsFor(feature, pack).find((p) => p.field === field);

// A hand-made pack of an incident, and history items as the `history` read answers them (oldest first).
const incidentPack = (over = {}) => ({
  version: 1,
  table: 'incident',
  sysId: INCIDENT_ID,
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN drops every 10 minutes', state: 'In Progress' },
  people: [
    { role: 'assigned_to', name: BETH.name, email: BETH.email, sysId: BETH.sysId },
    { role: 'caller', name: ABEL.name, email: ABEL.email, sysId: ABEL.sysId },
  ],
  journal: [],
  related: {},
  access: [],
  ...over,
});
const hrPack = (over = {}) =>
  incidentPack({
    table: 'sn_hr_core_case',
    sysId: HR_CASE_ID,
    number: 'HRC0001001',
    kind: 'hr_case',
    fields: { number: 'HRC0001001', short_description: 'Leave request', state: 'Open' },
    people: [
      { role: 'assigned_to', name: HANA.name, email: HANA.email, sysId: HANA.sysId },
      { role: 'opened_for', name: JANE.name, email: JANE.email, sysId: JANE.sysId },
    ],
    ...over,
  });
const item = (number, over = {}) => ({
  table: 'incident',
  sysId: 'f'.repeat(32),
  number,
  short_description: `Ticket ${number}`,
  state: 'Closed',
  active: 'false',
  category: 'Network',
  cmdb_ci: 'VPN Gateway EU',
  assignment_group: 'Network Support',
  close_code: 'Solution provided',
  close_notes: `Fixed ${number}.`,
  opened_at: '2026-10-01 10:00:00',
  resolved_at: '2026-10-02 10:00:00',
  openedUtc: '2026-10-01 08:00:00',
  resolvedUtc: '2026-10-02 08:00:00',
  ...over,
});
const ACCESS_OK = [
  { source: 'incident', status: 'ok', note: '' },
  { source: 'sc_req_item', status: 'empty', note: '' },
  { source: 'sn_customerservice_case', status: 'empty', note: '' },
  { source: 'sn_hr_core_case', status: 'skipped', note: 'HR cases are only included when sensitive data is allowed.' },
];
const answerOf = (items, access = ACCESS_OK, signals = {}) => ({ items, signals, access });

/** A `read` that records what it was asked and answers `answer` (or throws it, or calls it). */
function spy(answer) {
  const calls = [];
  const read = async (op, args) => {
    calls.push([op, args]);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(op, args) : answer;
  };
  return { read, calls };
}

// ---- The feature -------------------------------------------------------------------------------------------------------------

test('the feature is in the registry once: its title, description, group, Copy first and an insert into the work notes', () => {
  assert.deepEqual(callerPack.map((f) => f.id), [ID]);
  const ids = FEATURES.map((f) => f.id);
  assert.equal(ids.filter((id) => id === ID).length, 1);
  assert.equal(feature.title, 'Brief me on this caller');
  assert.equal(feature.description, 'What this caller raised before, and what fixed it.');
  assert.equal(feature.group, 'understand');
  assert.equal(groupOf(feature), 'understand');
  assert.equal(feature.primary, 'copy', 'a briefing is read by the agent first');
  assert.equal(typeof feature.enrich, 'function');
  assert.equal(feature.requires, undefined, 'any privacy mode (an HR ticket is gated as HR by the pipeline)');
  assert.equal(feature.keepMasked, undefined);
  assert.equal(feature.defaultOff, undefined);
  const inserts = insertsFor(feature);
  assert.deepEqual(inserts.map((s) => s.field), ['work_notes']);
  assert.equal(inserts[0].label, 'Add to work notes');
  assert.equal(inserts[0].fieldLabel, 'Work notes');
  // the bar's short label, everyone's profile, and the "Same caller" pain point offers it before the account briefing
  assert.equal(QUICK_LABELS[ID], 'Caller briefing');
  assert.deepEqual(profilesOfFeature(feature), ['all']);
  assert.equal(PAIN_POINTS.find((p) => p.id === 'caller').actions[0], ID);
});

test('the texts a person reads have their Arabic', () => {
  for (const text of [feature.title, feature.description, QUICK_LABELS[ID]]) assert.ok(typeof AR[text] === 'string' && AR[text].length > 3, text);
});

test('offered on every kind of record that has a caller, never on a change, an article or "other"', () => {
  assert.deepEqual([...CALLER_KINDS], ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task', 'chat']);
  assert.deepEqual([...feature.kinds], [...CALLER_KINDS]);
  for (const kind of KINDS) {
    assert.equal(featuresFor(kind, normalizePolicy({})).some((f) => f.id === ID), CALLER_KINDS.includes(kind), kind);
  }
  // every one of them has a column for the person it is for, or at least for who opened it
  for (const kind of CALLER_KINDS) {
    assert.ok(FIELDS_BY_KIND[kind].some((name) => ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_for', 'opened_by'].includes(name)), kind);
  }
  // and the organisation can switch it off like any feature
  assert.ok(!featuresFor('incident', normalizePolicy({ disabledFeatures: [ID] })).some((f) => f.id === ID));
});

// ---- The context spec ------------------------------------------------------------------------------------------------------

test('the context spec reads this ticket\'s short fields only, plus every person column so the caller is found and masked', () => {
  assert.ok(SPEC_IDS.includes(ID));
  assert.equal(contextFor(feature), ID);
  assert.equal(FEATURE_JOURNAL[ID], false, 'no notes');
  assert.deepEqual(FEATURE_RELATED[ID], [], 'no SLAs, approvals or tasks');
  assert.deepEqual([callerSpec.fieldsByKind, callerSpec.extendFields, callerSpec.limits], [{}, {}, {}], 'no ceiling is widened');
  for (const kind of CALLER_KINDS) {
    const read = FEATURE_FIELDS[ID][kind];
    const ceiling = FIELDS_BY_KIND[kind];
    for (const name of read) assert.ok(ceiling.includes(name), `${kind}: ${name} is on the ceiling`);
    for (const never of ['description', 'close_notes', 'comments', 'work_notes', 'special_instructions', 'cause_notes', 'workaround']) assert.ok(!read.includes(never), `${kind}: ${never}`);
    for (const person of ceiling.filter((name) => PERSON_COLUMNS.includes(name))) assert.ok(read.includes(person), `${kind}: ${person} is read for masking`);
  }
  assert.ok(FEATURE_FIELDS[ID].incident.includes('short_description') && FEATURE_FIELDS[ID].incident.includes('category'));
});

// ---- The prompt -------------------------------------------------------------------------------------------------------------

test('the prompt is fixed text: the five headings in order, each on its own line, the fallbacks, a length cap and the agent rules', () => {
  const { system, instruction } = feature;
  let from = 0;
  for (const heading of HEADINGS) {
    const at = system.indexOf(`\n${heading}: `, from);
    assert.ok(at >= from, `"${heading}:" starts its own line, after the heading before it`);
    from = at + heading.length;
  }
  for (const phrase of ['"Not stated"', '"No sign of a repeat"', '"Nothing flagged"', '"Not available"', 'never present the history as empty', 'never by name', 'at most 150 words', 'use only facts in the data']) {
    assert.ok(system.includes(phrase), phrase);
  }
  assert.match(system, /Before: up to three bullet points/);
  assert.match(system, /Watch out for: up to two bullet points/);
  assert.ok(system.endsWith(rulesFor('agent')), 'the agent rules close the prompt, as in every feature');
  assert.doesNotMatch(system, UNTRUSTED_MARK, 'the firewall says that rule, once');
  for (const text of [system, instruction]) {
    assert.ok(!/\{\{|\$\{|<%|<ticket_data/.test(text), 'no template hole');
    assert.ok(!/\b[A-Z]{2,6}\d{5,}\b|@[\w.-]+\.[a-z]{2,}|\b[0-9a-f]{32}\b/i.test(text), 'no ticket data');
  }
  assert.equal(instruction, 'Write the caller briefing for the agent working on this ticket.');
});

// ---- Who the caller is --------------------------------------------------------------------------------------------------------

test('the caller: the same roles in the same order as the caller card, the first with a valid sys_id', () => {
  assert.deepEqual([...CALLER_ROLES], ['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'opened_by']);
  const p = (role, who, sysId = who.sysId) => ({ role, name: who.name, email: who.email, sysId });
  assert.deepEqual(callerOf({ people: [p('opened_by', BETH), p('caller', ABEL)] }), { role: 'caller', sysId: ABEL.sysId });
  assert.deepEqual(callerOf({ people: [p('consumer', CHARLIE), p('contact', ERIN)] }), { role: 'contact', sysId: ERIN.sysId });
  assert.deepEqual(callerOf({ people: [p('opened_by', DAVE), p('requested_for', MARIA)] }), { role: 'requested_for', sysId: MARIA.sysId });
  assert.deepEqual(callerOf({ people: [p('assigned_to', BETH), p('opened_by', DAVE)] }), { role: 'opened_by', sysId: DAVE.sysId }, 'only who opened it');
  assert.deepEqual(callerOf({ people: [p('caller', ABEL, 'not-an-id'), p('opened_for', JANE, JANE.sysId.toUpperCase())] }), { role: 'opened_for', sysId: JANE.sysId });
  // The people list keeps one role per person, the first column that names them: an HR case's employee who is both the subject and
  // opened_for is on it as subject_person. They are the caller, before whoever opened the case for them.
  assert.deepEqual(callerOf({ people: [p('assigned_to', HANA), p('subject_person', JANE), p('opened_by', DAVE)] }), { role: 'subject_person', sysId: JANE.sysId });
  assert.deepEqual(callerOf({ people: [p('subject_person', DAVE), p('opened_for', JANE)] }), { role: 'opened_for', sysId: JANE.sysId }, 'opened_for itself first');
  for (const pack of [{ people: [p('assigned_to', BETH), p('reference_person', CHARLIE)] }, { people: 'x' }, {}, null, { people: [null, 7, 'caller'] }]) {
    assert.equal(callerOf(pack), null);
  }
});

test('when the caller card still lists its own roles, they are the same list (src/sidepanel/ticket/cards/data.js)', () => {
  const file = path.join(__dirname, '..', 'src', 'sidepanel', 'ticket', 'cards', 'data.js');
  const code = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const m = /CALLER_ROLES\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/.exec(code);
  if (!m) return; // the card imports the list (or reads no caller any more): nothing to keep in step
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...CALLER_ROLES]);
});

// ---- enrich, with an injected read ----------------------------------------------------------------------------------------------

test('caller found: their other tickets are asked of the history read (this ticket left out) and merged as a list, newest first', async () => {
  const { read, calls } = spy(answerOf([item('INC0009001'), item('INC0009150', { state: 'In Progress', active: 'true', resolved_at: '', close_code: '', close_notes: '' }), item('INC0009640')]));
  const pack = incidentPack();
  const before = JSON.stringify(pack);
  const out = await feature.enrich(pack, { read, allowSensitive: false });
  assert.deepEqual(calls, [['history', { callerSysId: ABEL.sysId, excludeSysId: INCIDENT_ID, allowSensitive: false }]]);
  assert.equal(JSON.stringify(pack), before, 'the pack it was given is not changed');
  assert.deepEqual(out.related.callerTickets.map((r) => r.number), ['INC0009640', 'INC0009150', 'INC0009001']);
  // only the columns partColumns names for caller_tickets: no group, no CI, no sys_id, no person
  for (const row of out.related.callerTickets) assert.deepEqual(Object.keys(row).sort(), ['close_code', 'close_notes', 'number', 'open', 'opened_at', 'resolved_at', 'short_description', 'state', 'type']);
  assert.equal(out.requirePreview, true, 'other tickets\' wording: the person sees what is sent every time');
  assert.equal(out.sensitive, undefined);
  assert.deepEqual(out.access, [], 'nothing was missing');
  assert.deepEqual(out.people, pack.people, 'nobody new: the read names no one');

  const text = partOf(out, 'caller_tickets').text;
  assert.equal(partOf(out, 'caller_tickets').label, "The caller's other tickets");
  assert.match(text, /^The caller is the person in this ticket's "Caller" field\.\nTheir other tickets that your user can see: 3, newest first\.\n- INC0009640 \(incident, Closed\): Ticket INC0009640; opened 2026-10-01 10:00:00, resolved 2026-10-02 10:00:00 \| Close code: Solution provided \| Close notes: Fixed INC0009640\./);
  assert.match(text, /- INC0009150 \(incident, In Progress\): Ticket INC0009150; opened 2026-10-01 10:00:00\n/);
  assert.match(text, /Still open: 1 of them\./);
  assert.ok(!text.includes(ABEL.name) && !text.includes('Network Support'), 'no name, no group');
  assert.equal(partOf(out, 'data_not_available'), undefined);
});

test('the parts: this ticket\'s short fields and the caller\'s list, nothing else', async () => {
  const out = await feature.enrich(incidentPack({ fields: { number: 'INC0010001', short_description: 'VPN', state: 'New', priority: '3 - Moderate', category: 'Network' } }), spy(answerOf([item('INC0009001')])));
  assert.deepEqual(partsFor(feature, out).map((p) => p.field), ['number', 'short_description', 'state', 'priority', 'category', 'caller_tickets']);
  for (const p of partsFor(feature, out)) {
    assert.equal(isSensitiveField(p.field), false, p.field);
    assert.equal(isSensitiveField(p.label), false, p.label);
  }
});

test('no caller on the ticket: nothing is read, and the briefing says no caller was found', async () => {
  const { read, calls } = spy(answerOf([item('INC0009001')]));
  const pack = incidentPack({ people: [{ role: 'assigned_to', name: BETH.name, email: BETH.email, sysId: BETH.sysId }] });
  const out = await feature.enrich(pack, { read, allowSensitive: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(out.access, [{ source: 'caller-history', status: 'skipped', note: 'No caller was found on this ticket, so their other tickets were not looked up.' }]);
  assert.equal(out.related.callerTickets, undefined);
  assert.equal(out.requirePreview, undefined);
  const parts = partsFor(feature, out);
  assert.ok(!parts.some((p) => p.field === 'caller_tickets'));
  assert.match(parts.find((p) => p.field === 'data_not_available').text, /- The caller's other tickets: No caller was found on this ticket/);
  assert.ok(parts.some((p) => p.field === 'short_description'), 'the briefing still has the ticket');
});

test('a read that fails: the briefing still works and says the history was not available, never that it is empty', async () => {
  const lost = Object.assign(new Error('Agent Buddy lost touch with this page. Reload the ServiceNow page and try again.'), { code: 'LOST_TOUCH' });
  for (const err of [lost, new Error('Could not read incident: 500 Internal Server Error'), new TypeError('x is undefined')]) {
    const out = await feature.enrich(incidentPack(), spy(err));
    assert.deepEqual(out.access, [{ source: 'caller-history', status: 'error', note: "The caller's other tickets could not be read." }]);
    const parts = partsFor(feature, out);
    assert.ok(!parts.some((p) => p.field === 'caller_tickets'), 'no list at all, not an empty one');
    const missing = parts.find((p) => p.field === 'data_not_available').text;
    assert.match(missing, /do not describe them as empty/);
    assert.match(missing, /- The caller's other tickets: could not be read/);
    assert.ok(!/no other tickets|500|lost touch|undefined/i.test(partText(parts)), 'neither "none" nor the error text');
  }
});

test('a lost session stops the run: it is thrown again for the person to log in', async () => {
  await assert.rejects(() => feature.enrich(incidentPack(), spy(sessionExpiredError())), (e) => e.code === 'SESSION_EXPIRED');
});

test('no table could be read: the history is not available, with the worst reason', async () => {
  const cases = [
    [[{ source: 'incident', status: 'denied' }, { source: 'sc_req_item', status: 'error' }, { source: 'sn_customerservice_case', status: 'empty-or-hidden' }], 'denied', /not readable by your user/],
    [[{ source: 'incident', status: 'error' }, { source: 'sc_req_item', status: 'blocked' }], 'blocked', /not allowed by your organisation/],
    [[{ source: 'incident', status: 'empty-or-hidden' }, { source: 'sn_hr_core_case', status: 'skipped' }], 'empty-or-hidden', /may exist but be hidden/],
    [[{ source: 'incident', status: 'made-up' }], 'error', /could not be read/],
    [[], 'error', /could not be read/],
  ];
  for (const [access, status, says] of cases) {
    const out = await feature.enrich(incidentPack(), spy(answerOf([item('INC0009001')], access)));
    assert.deepEqual(out.access.map((a) => [a.source, a.status]), [['caller-history', status]], status);
    assert.equal(out.related.callerTickets, undefined, `${status}: rows next to a failed read are not used`);
    assert.match(partOf(out, 'data_not_available').text, says);
  }
  for (const answer of [null, 'text', 42, { items: 'x', access: ACCESS_OK }]) {
    const out = await feature.enrich(incidentPack(), spy(answer));
    assert.deepEqual(out.access.map((a) => [a.source, a.status]), [['caller-history', 'error']], JSON.stringify(answer));
  }
});

test('some tables could not be checked: the list is sent and says it may be incomplete', async () => {
  const access = [
    { source: 'incident', status: 'ok' },
    { source: 'sc_req_item', status: 'denied' },
    { source: 'sn_customerservice_case', status: 'empty-or-hidden' },
    { source: 'sn_hr_core_case', status: 'skipped' },
  ];
  const out = await feature.enrich(incidentPack(), spy(answerOf([item('INC0009001')], access)));
  const text = partOf(out, 'caller_tickets').text;
  assert.match(text, /Not checked, so the list may be incomplete: requested items \(not readable by your user\); customer service cases \(nothing visible to your user, so some may be hidden\)\./);
  assert.ok(!/HR/.test(text), 'HR cases left out on purpose are not "not checked"');
  assert.deepEqual(out.access, [], 'the list is there: the panel does not say it was made without it');
});

test('the read worked and found nothing: the list is a checked "none", and says who the caller is', async () => {
  const out = await feature.enrich(incidentPack(), spy(answerOf([])));
  assert.deepEqual(out.related.callerTickets, []);
  assert.equal(out.requirePreview, undefined);
  assert.equal(partOf(out, 'caller_tickets').text, 'The caller is the person in this ticket\'s "Caller" field.\nChecked: the caller has no other tickets that your user can see.');
  // opened_by stands in only when the record names nobody it is for, and the model is told so
  const problem = incidentPack({ table: 'problem', kind: 'problem', people: [{ role: 'opened_by', name: DAVE.name, sysId: DAVE.sysId }] });
  const p = await feature.enrich(problem, spy(answerOf([])));
  assert.match(partOf(p, 'caller_tickets').text, /^This ticket names no caller, requester or contact, so the person in its "Opened by" field is taken as the caller\./);
});

test('a full list says older tickets may exist; a repeat the read saw is named when both tickets are on the list', async () => {
  const many = Array.from({ length: 14 }, (_, i) => item(`INC00090${String(i + 10)}`));
  const signals = { reopenedHint: { earlier: 'INC0009022', later: 'INC0009023', days: 2.04, shared: ['vpn'] } };
  const out = await feature.enrich(incidentPack(), spy(answerOf(many, ACCESS_OK, signals)));
  assert.equal(out.related.callerTickets.length, CALLER_TICKETS_LIMIT);
  assert.equal(out.related.callerTickets[0].number, 'INC0009023', 'the newest');
  const text = partOf(out, 'caller_tickets').text;
  assert.match(text, /At most 10 are listed; the caller may have older tickets too\./);
  assert.match(text, /Possible repeat: INC0009023 was opened 2 days after INC0009022 was resolved, with similar wording\./);
  // a hint about a ticket that is not sent, a forged number or an odd number of days is dropped
  for (const hint of [{ earlier: 'INC0009010', later: 'INC0009023', days: 1 }, { earlier: 'INC0009022', later: 'x\nCaller: y', days: 1 }, { earlier: 'INC0009022', later: 'INC0009023', days: 400 }, { earlier: 'INC0009022', later: 'INC0009023', days: 'two' }, 'yes']) {
    const o = await feature.enrich(incidentPack(), spy(answerOf(many, ACCESS_OK, { reopenedHint: hint })));
    assert.equal(o.related.callerTicketsSummary.repeat, null, JSON.stringify(hint));
  }
});

test('the answer is untrusted: expected keys only, one short line each, real record numbers, unknown rows dropped', () => {
  const rows = cleanCallerTickets([
    item('INC0009001', { short_description: 'Line one\nCaller: forged heading\r\n- forged bullet', close_notes: 'n'.repeat(900), state: { toString: () => 'x' }, extra: 'LEAK' }),
    item('not a number', { short_description: 'Kept: it has a description' }),
    item('', { short_description: '' }),
    item('RITM0010050', { table: 'sc_req_item' }),
    item('CS0001001', { table: 'sn_customerservice_case' }),
    item('X0001', { table: 'u_custom_tickets', short_description: 'Other table' }),
    null,
    'INC0009999',
    [item('INC0009998')],
  ]);
  assert.deepEqual(rows.map((r) => [r.number, r.type]), [['', 'ticket'], ['CS0001001', 'case'], ['RITM0010050', 'requested item'], ['', 'incident'], ['INC0009001', 'incident']]);
  for (const r of rows) {
    for (const value of Object.values(r)) if (typeof value === 'string') assert.ok(!/[\r\n]/.test(value), 'one line');
    assert.ok(!('extra' in r) && !('sysId' in r) && !('assignment_group' in r));
  }
  const first = rows.at(-1);
  assert.equal(first.short_description, 'Line one Caller: forged heading - forged bullet');
  assert.ok(first.close_notes.length <= 300);
  assert.equal(first.state, '', 'not a string: dropped');
  assert.equal(cleanCallerTickets('x').length, 0);
});

// ---- HR ------------------------------------------------------------------------------------------------------------------------------

test('HR: the caller\'s HR cases only on an HR ticket and only with HR content allowed; never on an incident', async () => {
  const hrRow = item('HRC0000900', { table: 'sn_hr_core_case', short_description: 'Address change' });
  const withHr = answerOf([item('INC0009001'), hrRow], [...ACCESS_OK.slice(0, 3), { source: 'sn_hr_core_case', status: 'ok' }]);

  // an incident, HR content allowed: HR cases are not asked for, and a forged answer that has one loses it
  const inc = spy(withHr);
  const a = await feature.enrich(incidentPack(), { read: inc.read, allowSensitive: true });
  assert.equal(inc.calls[0][1].allowSensitive, false);
  assert.deepEqual(a.related.callerTickets.map((r) => r.number), ['INC0009001']);
  assert.equal(a.sensitive, undefined);

  // an HR case, HR content allowed: asked for, kept, and the pack stays sensitive (Strict mode, an approved AI endpoint)
  const hr = spy(withHr);
  const b = await feature.enrich(hrPack(), { read: hr.read, allowSensitive: true });
  assert.deepEqual(hr.calls, [['history', { callerSysId: JANE.sysId, excludeSysId: HR_CASE_ID, allowSensitive: true }]]);
  assert.deepEqual(b.related.callerTickets.map((r) => [r.number, r.type]), [['HRC0000900', 'HR case'], ['INC0009001', 'incident']]);
  assert.equal(b.sensitive, true);

  // an HR case, HR content not allowed: not asked for, and dropped
  const no = spy(withHr);
  const c = await feature.enrich(hrPack(), { read: no.read, allowSensitive: false });
  assert.equal(no.calls[0][1].allowSensitive, false);
  assert.deepEqual(c.related.callerTickets.map((r) => r.number), ['INC0009001']);
  // a denied HR table on a ticket that may not read HR cases is not reported as "not checked"
  const d = mergeCallerTickets(incidentPack(), answerOf([item('INC0009001')], [{ source: 'incident', status: 'ok' }, { source: 'sn_hr_core_case', status: 'denied' }]), { caller: { role: 'caller' } });
  assert.deepEqual(d.related.callerTicketsSummary.notChecked, []);
  // without allowSensitive at all (an older caller), nothing HR either
  const e = spy(withHr);
  await feature.enrich(hrPack(), { read: e.read });
  assert.equal(e.calls[0][1].allowSensitive, false);
});

// ---- End to end on the fixture instance ------------------------------------------------------------------------------------------

const guardFor = (raw) => createPolicyGuard({ getManaged: async () => ({ known: true, raw }) });

/**
 * The panel's run: the pack read and the enrich step, both through the content script's entry (the `history` op is reached by name).
 * `history`: how the instance behaves for the history read only (the record itself is read normally).
 */
async function run({ table = 'incident', sysId = INCIDENT_ID, tables = buildInstance(), policy = {}, allowSensitive = false, history } = {}) {
  const deps = fakeDeps(tables);
  const historyDeps = history ? fakeDeps(tables, history) : deps;
  const guard = guardFor(policy);
  const read = (op, args) => handleRead(op, args, { guard, makeDeps: () => (op === 'pack' ? deps : historyDeps) });
  const pack = await read('pack', { table, sysId, feature: contextFor(feature), allowSensitive });
  return { pack: await feature.enrich(pack, { read, allowSensitive }), deps: historyDeps };
}

const USERS = [ABEL, BETH, MARIA, CHARLIE, DAVE, ERIN, JANE, HANA];

test('end to end: the caller\'s earlier incidents, never this one or anyone else\'s; the parts name nobody who is not on the pack', async () => {
  const { pack, deps } = await run();
  assert.deepEqual(pack.related.callerTickets.map((r) => r.number), ['INC0009702', 'INC0009640', 'INC0009588', 'INC0009377', 'INC0009150', 'INC0009001']);
  const asked = deps.callsTo('incident').find((c) => c.query.startsWith('caller_id='));
  assert.equal(asked.query, `caller_id=${ABEL.sysId}^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`);
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'), 'reads only');
  const parts = partsFor(feature, pack);
  const allowed = new Set([...FEATURE_FIELDS[ID].incident, 'caller_tickets', 'data_not_available']);
  for (const p of parts) {
    assert.ok(allowed.has(p.field), p.field);
    assert.ok(!PERSON_COLUMNS.includes(p.field), `${p.field}: no person column is a part`);
  }
  // Everyone a part names is on the pack's people list, so the firewall masks them by name.
  const named = USERS.filter((u) => partText(parts).includes(u.name) || partText(parts).includes(u.email));
  for (const u of named) assert.ok(pack.people.some((p) => p.name === u.name), `${u.name} is in the parts but not on the pack`);
  assert.match(partOf(pack, 'caller_tickets').text, /Possible repeat: INC0009640 was opened 6 days after INC0009588 was resolved/);
});

test('end to end: what is sent masks the caller and the agent, keeps the fixes, and the prompt is the fixed one', async () => {
  const tables = buildInstance();
  tables.incident.find((r) => r.number.value === 'INC0009640').close_notes = v(`Beth Anglin replaced the certificate; Abel Tuter (${ABEL.email}) confirmed by phone.`);
  const { pack } = await run({ tables });
  assert.equal(pack.requirePreview, true);
  for (const mode of ['standard', 'strict']) {
    const prepared = prepareRun({ feature, pack, values: values({ piiMode: mode }), policy: normalizePolicy({}), config: config(), createFirewall });
    const text = outgoing(prepared);
    for (const secret of [ABEL.name, 'Abel', 'Tuter', ABEL.email, BETH.name, 'Anglin', BETH.email]) assert.ok(!text.includes(secret), `${mode}: sent "${secret}"`);
    assert.match(text, /INC0009640/);
    assert.match(text, /replaced the certificate/);
    assert.equal(prepared.request.messages[0].content, `${feature.system}\n\n${RULES_PREAMBLE}`, 'no ticket data in the system message');
    assert.equal(prepared.request.feature, ID);
  }
});

test('the stated limit: someone named only inside another ticket\'s close notes is caught by the name finder, not by the people list', async () => {
  const tables = buildInstance();
  tables.incident.find((r) => r.number.value === 'INC0009640').close_notes = v('Spoke to Charlie Whitherspoon from the network team; replaced the certificate.');
  const { pack } = await run({ tables });
  assert.ok(!pack.people.some((p) => p.name === CHARLIE.name), 'the history read names nobody, so he is not on the pack');
  assert.equal(pack.requirePreview, true, 'which is why the person sees what is sent every time');
  const strict = outgoing(prepareRun({ feature, pack, values: values({ piiMode: 'strict' }), policy: normalizePolicy({}), config: config(), createFirewall }));
  assert.ok(!/Charlie|Whitherspoon/.test(strict), 'Strict masks a capitalised full name with no cue in front of it');
});

test('end to end: an incident never reads or sends the caller\'s HR cases, even with HR content allowed', async () => {
  const tables = buildInstance();
  tables.sn_hr_core_case.push({
    sys_id: v('e'.repeat(32)),
    number: v('HRC0000901'),
    short_description: v('Grievance about a manager'),
    state: v('3', 'Closed Complete'),
    active: v('false'),
    opened_for: v(ABEL.sysId, ABEL.name),
    opened_at: v('2026-09-01 08:00:00'),
    resolved_at: v('2026-09-02 08:00:00'),
    close_notes: v('Handled by HR.'),
  });
  const { pack, deps } = await run({ tables, policy: { allowHrContent: true }, allowSensitive: true });
  assert.equal(deps.callsTo('sn_hr_core_case').length, 0, 'not even asked');
  assert.ok(!JSON.stringify(pack.related.callerTickets).includes('HRC0000901'));
  assert.ok(!partText(partsFor(feature, pack)).includes('Grievance'));
});

test('end to end, HR case: with HR content allowed the employee\'s other HR cases are read, and the run is gated as HR', async () => {
  const { pack, deps } = await run({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, policy: { allowHrContent: true }, allowSensitive: true });
  assert.ok(deps.callsTo('sn_hr_core_case').some((c) => c.query.startsWith(`opened_for=${JANE.sysId}^sys_id!=${HR_CASE_ID}`)));
  assert.deepEqual(pack.related.callerTickets.map((r) => [r.number, r.type]), [['HRC0000900', 'HR case']]);
  // Jane is the subject, opened_for and opened_by of the case: the people list has her once, as subject_person (see callerOf)
  assert.deepEqual(pack.people.filter((p) => p.name === JANE.name).map((p) => p.role), ['subject_person']);
  assert.match(partOf(pack, 'caller_tickets').text, /^The caller is the person in this ticket's "Subject person" field\./);
  const policy = normalizePolicy({ allowHrContent: true, aiProvider: 'anthropic' });
  assert.throws(() => prepareRun({ feature, pack, values: values({ piiMode: 'standard' }), policy, config: config(), createFirewall }), (e) => e instanceof RunBlocked && e.code === 'MODE_TOO_LOW');
  assert.throws(() => prepareRun({ feature, pack, values: values({ piiMode: 'strict' }), policy: normalizePolicy({}), config: config(), createFirewall }), (e) => e instanceof RunBlocked && e.code === 'HR_BLOCKED');
  const text = outgoing(prepareRun({ feature, pack, values: values({ piiMode: 'strict' }), policy, config: config(), createFirewall }));
  assert.match(text, /HRC0000900/);
  for (const secret of [JANE.name, 'Jane', JANE.email, HANA.name]) assert.ok(!text.includes(secret), secret);

  // the managed policy does not allow HR content: the content script lowers what the panel asked for; the identities are not read,
  // so there is no caller to look up, and the briefing says so
  const off = await run({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, policy: {}, allowSensitive: true });
  assert.equal(off.deps.callsTo('sn_hr_core_case').filter((c) => c.query.startsWith('opened_for=')).length, 0);
  assert.ok(off.pack.access.some((a) => a.source === 'caller-history' && a.status === 'skipped'));
});

test('end to end: some tables denied, a partial list that says so; every table denied, "not available"; a lost session stops', async () => {
  const partial = await run({ history: { denied: ['sc_req_item', 'sn_customerservice_case'] } });
  assert.equal(partial.pack.related.callerTickets.length, 6);
  assert.match(partOf(partial.pack, 'caller_tickets').text, /Not checked, so the list may be incomplete: requested items \(not readable by your user\); customer service cases \(not readable by your user\)\./);

  const none = await run({ history: { denied: ['incident', 'sc_req_item', 'sn_customerservice_case'] } });
  assert.equal(none.pack.related.callerTickets, undefined);
  assert.deepEqual(none.pack.access.filter((a) => a.source === 'caller-history').map((a) => a.status), ['denied']);
  const parts = partsFor(feature, none.pack);
  assert.ok(!parts.some((p) => p.field === 'caller_tickets'));
  assert.match(parts.find((p) => p.field === 'data_not_available').text, /- The caller's other tickets: not readable by your user/);
  assert.ok(!/ACL|403|Access to/.test(partText(parts)), 'nothing from the instance\'s error text');

  await assert.rejects(() => run({ history: { expired: ['incident'] } }), (e) => e.code === 'SESSION_EXPIRED');
});

// ---- Blocked fields ------------------------------------------------------------------------------------------------------------------

test('the caller\'s list is named for the columns it carries, so blockedFields refuses it', async () => {
  for (const column of ['number', 'short_description', 'state', 'opened_at', 'resolved_at', 'close_code', 'close_notes', 'caller_id', 'requested_for', 'contact', 'opened_for']) {
    assert.ok(columnsForPart('caller_tickets').includes(column), column);
  }
  assert.ok(!columnsForPart('caller_tickets').includes('assigned_to'), 'no assignee is in it');
  const pack = await feature.enrich(incidentPack({ fields: { number: 'INC0010001', state: 'New' } }), spy(answerOf([item('INC0009001')])));
  const send = (blockedFields) => prepareRun({ feature, pack, values: values(), policy: normalizePolicy({ blockedFields }), config: config(), createFirewall });
  assert.ok(send([]).request);
  for (const column of ['close_notes', 'short_description', 'caller_id']) {
    assert.throws(() => send([column]), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD' && /caller_tickets/.test(e.message), column);
  }
  assert.ok(send(['assignment_group']).request, 'a column it does not carry does not stop it');
});

test('callerTicketsText is empty when there is no list (the "Not available" part speaks then)', () => {
  assert.equal(callerTicketsText(incidentPack()), '');
  assert.equal(callerTicketsText({ related: { callerTickets: 'x' } }), '');
  assert.equal(callerTicketsText(null), '');
});
