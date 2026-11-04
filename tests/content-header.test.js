// The ticket header (READ 'header', src/content/header.js) and the policy the panel sends with PAGE_STATE (src/lib/messages.js).
//
// The header used to read an HR case's title without `allowSensitive`, while every other read of the same record left its free text
// out. Now the title of a sensitive record (HR family, the policy's own prefixes, a `task` whose class cannot be told) is read only when
// sensitive data is allowed; the number and state still show. PAGE_STATE used to be answered with the managed policy only (which the
// content script may not be able to read): the panel now sends its policy with it as with READ, and the guard merges it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readHeader } from '../src/content/header.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { MSG, pageStateMessage, readPolicyOf } from '../src/lib/messages.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { HR_CASE_ID, HR_CASE_NUMBER } from './fixtures/sn-hr-case.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';

const guardFor = (raw, known = true) => createPolicyGuard({ getManaged: async () => ({ known, raw }) });
const header = (args, { raw = {}, known = true, policy = null, tables = buildInstance() } = {}) => {
  const fake = fakeDeps(tables);
  return readHeader(args, { guard: guardFor(raw, known), deps: fake, policy }).then((answer) => ({ answer, fake }));
};
const askedFor = (fake, table) => fake.callsTo(table).flatMap((c) => c.fields);

test('an HR case\'s title is not read without allowSensitive; its number and state still show', async () => {
  const { answer, fake } = await header({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, { raw: { allowHrContent: true } });
  assert.equal(answer.number, HR_CASE_NUMBER);
  assert.equal(answer.state, 'Open');
  assert.equal(answer.short_description, '');
  assert.ok(!askedFor(fake, 'sn_hr_core_case').includes('short_description'), 'not even asked for');
});

test('with allowSensitive, and the organisation allowing HR content, the title is read', async () => {
  const { answer } = await header({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, allowSensitive: true }, { raw: { allowHrContent: true } });
  assert.match(answer.short_description, /Maternity leave/);
});

test('allowSensitive cannot rise above the policy: the managed policy, or the panel\'s, not allowing HR keeps the title out', async () => {
  const managedNo = await header({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, allowSensitive: true }, { raw: {} });
  assert.equal(managedNo.answer.short_description, '');
  const panelNo = await header({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, allowSensitive: true }, { known: false, policy: readPolicyOf(normalizePolicy({})) });
  assert.equal(panelNo.answer.short_description, '');
  const unknown = await header({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, allowSensitive: true }, { known: false });
  assert.match(unknown.answer.short_description, /Maternity leave/, 'no policy anywhere: the panel\'s request stands, as for every READ');
});

test('a table the policy names as sensitive is treated like HR, and so is a `task` whose real class cannot be told', async () => {
  const tables = buildInstance();
  tables.x_acme_hr_case = [{ sys_id: v('e'.repeat(32)), number: v('XHR0001'), short_description: v('Grievance about a manager'), state: v('1', 'Open') }];
  const custom = await header({ table: 'x_acme_hr_case', sysId: 'e'.repeat(32) }, { tables, policy: readPolicyOf(normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'] })) });
  assert.equal(custom.answer.number, 'XHR0001');
  assert.equal(custom.answer.short_description, '');

  // /task.do on an HR case: the class lookup says sn_hr_core_case
  const hrTask = buildInstance();
  hrTask.task = [...(hrTask.task || []), { sys_id: v(HR_CASE_ID), number: v(HR_CASE_NUMBER), sys_class_name: v('sn_hr_core_case'), short_description: v('Maternity leave request'), state: v('10', 'Open') }];
  const viaTask = await header({ table: 'task', sysId: HR_CASE_ID }, { tables: hrTask });
  assert.equal(viaTask.answer.number, HR_CASE_NUMBER);
  assert.equal(viaTask.answer.short_description, '');

  // a task whose class cannot be read at all
  const blind = buildInstance();
  blind.task = [{ sys_id: v('f'.repeat(32)), number: v('TASK0001'), short_description: v('Something private'), state: v('1', 'Open') }];
  const unresolved = await header({ table: 'task', sysId: 'f'.repeat(32) }, { tables: blind });
  assert.equal(unresolved.answer.short_description, '');
});

test('an ordinary ticket\'s header is as before (title, state, priority, the major incident column on an incident)', async () => {
  const { answer } = await header({ table: 'incident', sysId: INCIDENT_ID });
  assert.ok(answer.number && answer.short_description && answer.state, JSON.stringify(answer));
  const plainTask = buildInstance();
  plainTask.task = [{ sys_id: v('f'.repeat(32)), number: v('TASK0002'), sys_class_name: v('incident_task'), short_description: v('Swap the cable'), state: v('1', 'Open') }];
  assert.equal((await header({ table: 'task', sysId: 'f'.repeat(32) }, { tables: plainTask })).answer.short_description, 'Swap the cable');
});

test('the header refuses a malformed record and a blocked table, as before', async () => {
  await assert.rejects(() => header({ table: 'incident; drop', sysId: INCIDENT_ID }), /not a valid record/);
  await assert.rejects(() => header({ table: 'incident', sysId: 'nope' }), /not a valid record/);
  await assert.rejects(() => header({ table: 'incident', sysId: INCIDENT_ID }, { raw: { blockedTables: ['incident'] } }), (e) => e.code === 'BLOCKED_TABLE');
});

// ---- PAGE_STATE carries the policy --------------------------------------------------------------------------------------------

test('PAGE_STATE carries the read part of the policy, the same shape READ sends; without a policy, none', () => {
  const policy = normalizePolicy({ blockedTables: ['sc_request'], sensitiveTablePrefixes: ['x_acme_hr_'], allowHrContent: true, aiProvider: 'anthropic', providedApiKey: 'sk-secret' });
  const message = pageStateMessage(policy);
  assert.equal(message.type, MSG.PAGE_STATE);
  assert.deepEqual(message.policy, { blockedTables: ['sc_request'], sensitiveTablePrefixes: ['sn_hr_', 'x_acme_hr_'], allowHrContent: true });
  assert.ok(!JSON.stringify(message).includes('sk-secret'), 'nothing else of the policy goes to the page');
  assert.deepEqual(pageStateMessage(null), { type: MSG.PAGE_STATE });
  assert.deepEqual(pageStateMessage(undefined), { type: MSG.PAGE_STATE });
  assert.deepEqual(readPolicyOf({ blockedTables: ['a', 7, null], allowHrContent: 'yes' }), { blockedTables: ['a'], sensitiveTablePrefixes: [], allowHrContent: false });
});

test('the lookups made to answer PAGE_STATE honour the panel\'s policy where the managed one cannot be read (and junk changes nothing)', async () => {
  const guard = guardFor({}, false); // the content script cannot read the managed policy
  const sent = pageStateMessage(normalizePolicy({ blockedTables: ['incident'] })).policy;
  const deps = await guard.deps(fakeDeps(buildInstance()), sent);
  await assert.rejects(() => deps.queryTable('incident', 'number=INC0010001', ['sys_id', 'number'], { limit: 1 }), (e) => e.code === 'BLOCKED_TABLE');
  // a forged or malformed policy is checked like READ's (src/content/policyGuard.js mergePanelPolicy): it cannot loosen anything
  const managed = guardFor({ blockedTables: ['incident'] });
  for (const junk of [null, 'incident', ['x'], { blockedTables: 'incident' }, { blockedTables: [] }, { allowHrContent: true }]) {
    const d = await managed.deps(fakeDeps(buildInstance()), junk);
    await assert.rejects(() => d.queryTable('incident', 'number=INC0010001', ['sys_id'], { limit: 1 }), (e) => e.code === 'BLOCKED_TABLE', JSON.stringify(junk));
  }
  assert.equal(await managed.allowSensitive(true, { allowHrContent: true }), false, 'the managed policy stays the floor');
});
