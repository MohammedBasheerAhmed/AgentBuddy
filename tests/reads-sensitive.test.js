import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_SENSITIVE_PREFIXES, isSensitiveTable, kindForTable } from '../src/context/kinds.js';
import { HR_HIDDEN, allowedFields, withheldFields } from '../src/context/allowlists.js';
import { readContextPack } from '../src/context/pack.js';
import { findOpenDuplicates, findSimilarTickets } from '../src/context/similar.js';
import { readHeader } from '../src/content/header.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { readDecision } from '../src/mywork/tables.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// Round 4, Phase 0 (docs/round4.md, agent B): security and audit records are sensitive by default. Security Incident Response,
// Vulnerability Response and GRC/IRM/audit tables are on the built-in list next to HR, and behave exactly as a prefix the organisation
// adds with `sensitiveTablePrefixes` behaves: free text and identities are read only when sensitive content is allowed. What is HR
// only (the hr_case kind: the HR case brief, the HR work profile) stays HR only.

const SECURITY_TABLES = [
  'sn_si_incident', // Security Incident Response
  'sn_si_task',
  'sn_vul_vulnerable_item', // Vulnerability Response
  'sn_vul_remediation_task',
  'sn_grc_issue', // GRC / IRM
  'sn_risk_risk',
  'sn_compliance_control',
  'sn_audit_engagement', // Audit management
];

test('the built-in list: HR, security incidents, vulnerabilities, GRC/IRM and audit; sn_hr_ first, as before', () => {
  assert.deepEqual([...BUILT_IN_SENSITIVE_PREFIXES], ['sn_hr_', 'sn_si_', 'sn_vul_', 'sn_grc_', 'sn_risk_', 'sn_compliance_', 'sn_audit_']);
  assert.ok(Object.isFrozen(BUILT_IN_SENSITIVE_PREFIXES));
  for (const table of [...SECURITY_TABLES, 'SN_SI_Incident', ' sn_vul_entry ']) assert.equal(isSensitiveTable(table), true, table);
  // Only the families themselves: no prefix is matched without its underscore, and ordinary tables stay ordinary.
  for (const table of ['incident', 'sys_audit', 'sn_customerservice_case', 'sn_risky', 'sn_sim_thing', 'sn_auditor', 'u_sn_si_incident', 'task', '']) {
    assert.equal(isSensitiveTable(table), false, table);
  }
});

test('a policy cannot take a built-in family off the list (it can only add)', () => {
  for (const table of SECURITY_TABLES) {
    assert.equal(isSensitiveTable(table, []), true, table);
    assert.equal(isSensitiveTable(table, ['x_acme_hr_']), true, table);
  }
  assert.equal(isSensitiveTable('x_acme_hr_case', ['x_acme_hr_']), true, 'the policy\'s own prefixes still count');
});

test('a security table is read exactly as a table the policy names: same columns withheld, same columns read with permission', () => {
  const policyPrefix = ['x_acme_sec_'];
  for (const feature of ['record-summary', 'reply-draft', 'resolution-notes', 'similar']) {
    const builtIn = allowedFields('sn_si_incident', feature);
    const byPolicy = allowedFields('x_acme_sec_incident', feature, { sensitivePrefixes: policyPrefix });
    assert.deepEqual(builtIn, byPolicy, feature);
    assert.ok(!builtIn.some((name) => HR_HIDDEN.has(name)), `${feature}: no free text and no identities`);
    assert.deepEqual(withheldFields('sn_si_incident', feature), withheldFields('x_acme_sec_incident', feature, { sensitivePrefixes: policyPrefix }), feature);
    assert.deepEqual(allowedFields('sn_si_incident', feature, { allowSensitive: true }), allowedFields('x_acme_sec_incident', feature, { allowSensitive: true, sensitivePrefixes: policyPrefix }), feature);
  }
});

test('HR-only rules stay HR only: a security record is not an HR case and does not ask for the HR profile', () => {
  for (const table of SECURITY_TABLES) assert.notEqual(kindForTable(table), 'hr_case', table);
  assert.equal(kindForTable('sn_si_incident'), 'other');
  // My work: without permission a security incident is left out (as an HR case is); with it, it is listed. The HR work profile is
  // asked for HR cases only.
  assert.equal(readDecision('sn_si_incident', {}), 'hr-off');
  assert.equal(readDecision('sn_si_incident', { allowSensitive: true, profiles: ['it'] }), 'read');
  assert.equal(readDecision('sn_hr_core_case', { allowSensitive: true, profiles: ['it'] }), 'hr-profile');
  assert.equal(readDecision('incident', {}), 'read');
});

// ---- On a security incident --------------------------------------------------------------------------------------------------

const SI_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const USER_ID = 'b1b2c3d4e5f60718293a4b5c6d7e8f91';
const instance = () => ({
  sn_si_incident: [
    {
      sys_id: v(SI_ID),
      number: v('SIR0010001'),
      short_description: v('Phishing mail opened by Abel Tuter on LAPTOP-42'),
      description: v('Credentials of Abel Tuter may be compromised; mailbox rule forwards to an outside address.'),
      state: v('2', 'Analysis'),
      priority: v('1', '1 - Critical'),
      assignment_group: v('g1', 'Security Operations'),
      assigned_to: v(USER_ID, 'Beth Anglin'),
      opened_by: v(USER_ID, 'Beth Anglin'),
      opened_at: v('2026-11-05 08:00:00'),
      sys_updated_on: v('2026-11-06 09:00:00'),
      close_notes: v(''),
      comments: v(''),
      work_notes: v('2026-11-06 09:00:00 - Beth Anglin (Work notes)\nIsolated LAPTOP-42.'),
    },
  ],
  sys_journal_field: [{ sys_id: v('j1'), element_id: v(SI_ID), element: v('work_notes'), value: v('Isolated LAPTOP-42.'), sys_created_on: v('2026-11-06 09:00:00'), sys_created_by: v('beth.anglin') }],
  sys_user: [{ sys_id: v(USER_ID), user_name: v('beth.anglin'), name: v('Beth Anglin'), email: v('beth.anglin@example.com') }],
});

test('the pack of a security incident: no title, description, notes or names without permission; all of them with it', async () => {
  const deps = fakeDeps(instance());
  const pack = await readContextPack({ table: 'sn_si_incident', sysId: SI_ID }, deps, { feature: 'record-summary' });
  assert.equal(pack.number, 'SIR0010001');
  assert.equal(pack.fields.state, 'Analysis');
  for (const name of ['short_description', 'description', 'close_notes', 'opened_by']) assert.equal(pack.fields[name], undefined, name);
  assert.deepEqual(pack.journal, []);
  const asked = deps.fieldsAsked();
  for (const name of ['short_description', 'description', 'comments', 'work_notes', 'opened_by']) assert.ok(!asked.has(name), `${name} not even asked for`);
  assert.equal(deps.callsTo('sys_journal_field').length, 0, 'the notes table is not read');
  const why = pack.access.find((a) => a.source === 'sn_si_incident');
  assert.equal(why.status, 'skipped');
  assert.match(why.note, /holds sensitive data, so free text and identities were not read/);
  assert.equal(pack.kind, 'other');

  const allowed = await readContextPack({ table: 'sn_si_incident', sysId: SI_ID }, fakeDeps(instance()), { feature: 'record-summary', allowSensitive: true });
  assert.match(allowed.fields.short_description, /Phishing mail/);
});

test('no look-alike or duplicate search from a security incident without permission (other records are not searched)', async () => {
  const pack = { table: 'sn_si_incident', sysId: SI_ID, kind: 'other', fields: { short_description: 'Phishing mail opened on LAPTOP-42' } };
  const deps = fakeDeps(instance());
  const similar = await findSimilarTickets(pack, deps, { resolvedOnly: true });
  assert.deepEqual(similar.hits, []);
  assert.equal(similar.access[0].status, 'skipped');
  assert.match(similar.access[0].note, /sensitive table/);
  const duplicates = await findOpenDuplicates(pack, deps, {});
  assert.deepEqual(duplicates.hits, []);
  assert.equal(deps.calls.length, 0, 'nothing was read');
});

test('the ticket header of a security incident: number, state and priority; the title only with permission', async () => {
  const guardFor = (raw) => createPolicyGuard({ getManaged: async () => ({ known: true, raw }) });
  const off = await readHeader({ table: 'sn_si_incident', sysId: SI_ID, allowSensitive: true }, { guard: guardFor({}), deps: fakeDeps(instance()) });
  assert.deepEqual(off, { number: 'SIR0010001', short_description: '', state: 'Analysis', priority: '1 - Critical' });
  const on = await readHeader({ table: 'sn_si_incident', sysId: SI_ID, allowSensitive: true }, { guard: guardFor({ allowHrContent: true }), deps: fakeDeps(instance()) });
  assert.match(on.short_description, /Phishing mail/);
});
