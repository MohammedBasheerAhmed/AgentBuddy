// SEC-03(a): `blockedTables` at the READ boundary. The content script loads the managed policy (src/content/policyGuard.js) and wraps the
// deps every read uses; a blocked table is refused with the code BLOCKED_TABLE and shown as "your organisation does not allow", never as
// an empty result, a zero, or "you cannot see it".
import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_TTL_MS, blockedError, createPolicyGuard } from '../src/content/policyGuard.js';
import { STATUS, classifyReadError, confirmEmptyIsReallyEmpty, softRead } from '../src/context/access.js';
import { readContextPack } from '../src/context/pack.js';
import { findSimilarTickets } from '../src/context/similar.js';
import { handleRead } from '../src/content/reads.js';
import { addReference, statusSentence } from '../src/itsm/reference.js';
import { referenceParts } from '../src/itsm/parts.js';
import { unavailableText } from '../src/domain/parts.js';
import { accessNotes } from '../src/checks/requestStatus.js';
import { answersModel } from '../src/checks/requestView.js';
import { toWireError } from '../src/lib/messages.js';
import { OPS as ALL_OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { RITM_ID } from './fixtures/sn-requested-item.js';
import { CASE_ID } from './fixtures/sn-case.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

const guardFor = (raw, known = true) => createPolicyGuard({ getManaged: async () => ({ known, raw }) });

async function guarded(raw, tables = buildInstance(), behaviour) {
  const fake = fakeDeps(tables, behaviour);
  const deps = await guardFor(raw).deps(fake);
  return { fake, deps };
}

const refused = (table) => (e) => e.code === 'BLOCKED_TABLE' && e.message === `Your organisation does not allow Agent Buddy to read ${table} records.`;

// ---- The policy is loaded once per 30 seconds -------------------------------------------------------------------------------

test('the policy is read from managed storage at most once every 30 seconds, then again', async () => {
  let reads = 0;
  let clock = 1000;
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: reads++ ? ['task_sla'] : [] } }), now: () => clock });
  assert.equal(POLICY_TTL_MS, 30000);
  const first = await guard.state();
  clock += 29000;
  await guard.state();
  await guard.state();
  assert.equal(reads, 1, 'cached inside the window');
  assert.equal(first.blocked.size, 0);
  clock += 2000;
  const second = await guard.state();
  assert.equal(reads, 2, 'read again after 30 seconds');
  assert.deepEqual([...second.blocked], ['task_sla'], 'a change made by IT applies');
});

test('two reads at the same moment share one load', async () => {
  let reads = 0;
  const guard = createPolicyGuard({ getManaged: async () => { reads += 1; await new Promise((r) => setTimeout(r, 5)); return { known: true, raw: { blockedTables: ['incident'] } }; } });
  const [a, b, c] = await Promise.all([guard.state(), guard.state(), guard.state()]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('when the managed policy cannot be read the lists are empty and the guard blocks nothing (the caveat is in the header comment)', async () => {
  for (const getManaged of [async () => ({ known: false, raw: {} }), async () => { throw new Error('no managed storage here'); }, async () => null]) {
    const guard = createPolicyGuard({ getManaged });
    const state = await guard.state();
    assert.equal(state.known, false);
    assert.equal(state.blocked.size, 0);
    const deps = await guard.deps(fakeDeps(buildInstance()));
    assert.ok((await deps.queryTable('incident', '', ['number'], {})).length > 0);
  }
});

test('a browser that never answers, or a loader that throws at once, does not hang or break a read', async () => {
  const hangs = createPolicyGuard({ getManaged: () => new Promise(() => {}), timeoutMs: 20 });
  const started = Date.now();
  const state = await hangs.state();
  assert.equal(state.known, false);
  assert.ok(Date.now() - started < 1000, 'gave up after the timeout');
  const deps = await hangs.deps(fakeDeps(buildInstance()));
  assert.ok((await deps.queryTable('incident', '', ['number'], {})).length > 0);
  const throws = createPolicyGuard({ getManaged: () => { throw new Error('sync failure'); } });
  assert.equal((await throws.state()).known, false);
});

test('the policy is cleaned the same way the panel cleans it: names are lower-cased, junk is dropped', async () => {
  const state = await guardFor({ blockedTables: ['Incident', ' SC_ITEM_OPTION_MTOM ', 7, ''], sensitiveTablePrefixes: ['X_Acme_HR_'] }).state();
  assert.deepEqual([...state.blocked].sort(), ['7', 'incident', 'sc_item_option_mtom']);
  assert.deepEqual(state.sensitivePrefixes, ['sn_hr_', 'x_acme_hr_']);
});

// ---- The wrapped deps ------------------------------------------------------------------------------------------------------

test('every read function refuses a blocked table before any request is made', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['Incident'] });
  await assert.rejects(() => deps.queryTable('incident', '', ['number'], {}), refused('incident'));
  await assert.rejects(() => deps.queryTable('INCIDENT', '', [], {}), refused('incident'), 'not case-sensitive');
  await assert.rejects(() => deps.fetchRecord('incident', INCIDENT_ID, ['number'], {}), refused('incident'));
  await assert.rejects(() => deps.countRecords('incident', 'active=true'), refused('incident'));
  await assert.rejects(() => deps.countByColumn('incident', '', 'state'), refused('incident'));
  assert.equal(fake.calls.length, 0, 'nothing reached the instance');
  // another table goes through, untouched
  const rows = await deps.queryTable('task_sla', '', ['sla'], { limit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(fake.calls.length, 1);
});

test('aggregate and queryAll are guarded when the deps have them, and a table name is made safe in the message', async () => {
  const calls = [];
  const base = { ...fakeDeps({}), aggregate: async (t) => calls.push(['aggregate', t]), queryAll: async (t) => (calls.push(['queryAll', t]), []) };
  const deps = await guardFor({ blockedTables: ['sys_user'] }).deps(base);
  await assert.rejects(() => deps.aggregate('sys_user', { groupBy: ['name'] }), refused('sys_user'));
  await assert.rejects(() => deps.queryAll('sys_user', '', ['name'], {}), refused('sys_user'));
  await deps.aggregate('incident', { query: 'active=true' });
  assert.deepEqual(calls, [['aggregate', 'incident']]);
  assert.equal(blockedError('sys_user"><img src=x>').message, 'Your organisation does not allow Agent Buddy to read sys_userimgsrcx records.');
  assert.equal(blockedError('').message, 'Your organisation does not allow Agent Buddy to read that table records.');
});

test('a table reached through a dot-walked column is refused too (the variable answers go through sc_item_option and item_option_new)', async () => {
  const fields = ['request_item', 'sc_item_option.value', 'sc_item_option.item_option_new.question_text'];
  for (const blocked of ['sc_item_option', 'item_option_new']) {
    const { fake, deps } = await guarded({ blockedTables: [blocked] });
    await assert.rejects(() => deps.queryTable('sc_item_option_mtom', `request_item=${RITM_ID}`, fields, {}), refused(blocked));
    assert.equal(fake.calls.length, 0);
  }
  const { deps } = await guarded({ blockedTables: ['value'] });
  assert.ok(await deps.queryTable('sc_item_option_mtom', `request_item=${RITM_ID}`, fields, {}), 'the last segment is a column, not a table');
});

test('journal rows whose `name` is a blocked table are refused, by the query and by the rows that come back', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['incident'] });
  await assert.rejects(() => deps.queryTable('sys_journal_field', `name=incident^element_id=${INCIDENT_ID}^elementINcomments,work_notes`, ['element', 'value'], {}), refused('incident'));
  await assert.rejects(() => deps.queryTable('sys_journal_field', 'nameINproblem,incident^element_id=x', ['element'], {}), refused('incident'));
  await assert.rejects(() => deps.queryTable('sys_journal_field', 'ORname=incident', ['element'], {}), refused('incident'));
  await assert.rejects(() => deps.queryTable('sys_journal_field', 'nameLIKEincid', ['element'], {}), refused('incident'), 'a fuzzy match on a blocked name');
  assert.equal(fake.calls.length, 0);
  // another record's table is fine
  const ok = await deps.queryTable('sys_journal_field', 'name=problem^element_id=x', ['element', 'value'], {});
  assert.ok(Array.isArray(ok));
  // no `name` clause at all: the rows are checked (the column is added to what is asked for)
  const rows = await deps.queryTable('sys_journal_field', `element_id=${INCIDENT_ID}`, ['element', 'value'], {}).catch((e) => e);
  assert.equal(rows.code, 'BLOCKED_TABLE', 'rows of a blocked table came back');
  assert.ok(fake.calls.at(-1).fields.includes('name'));
});

test('a `task` read whose rows are of a blocked class is refused, and the class is asked for so it can be seen', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['incident_task'] });
  await assert.rejects(() => deps.queryTable('task', `parent=${INCIDENT_ID}`, ['number', 'short_description'], { displayValue: true }), refused('incident_task'));
  assert.ok(fake.calls[0].fields.includes('sys_class_name'));
  const free = await guarded({ blockedTables: ['sn_hr_core_task'] });
  const rows = await free.deps.queryTable('task', `parent=${INCIDENT_ID}`, ['number'], { displayValue: true });
  assert.ok(rows.length > 0, 'no row of the blocked class: the read goes through');
  // fetchRecord of a task of a blocked class
  const one = await guarded({ blockedTables: ['incident_task'] });
  await assert.rejects(() => one.deps.fetchRecord('task', 'task1', ['number'], {}), refused('incident_task'));
});

test('nothing is added to a call when nothing is blocked', async () => {
  const { fake, deps } = await guarded({ blockedTables: [] });
  await deps.queryTable('task', `parent=${INCIDENT_ID}`, ['number'], {});
  assert.deepEqual(fake.calls[0].fields, ['number']);
  const none = await guarded({});
  await none.deps.queryTable('sys_journal_field', 'name=incident', ['element'], {});
  assert.deepEqual(none.fake.calls[0].fields, ['element']);
  assert.equal(none.deps.isBlocked('incident'), false);
});

test('the other properties of the deps are kept, and the policy is offered to the context engine', async () => {
  const base = { ...fakeDeps({}), now: () => 42, extra: 'kept' };
  const deps = await guardFor({ blockedTables: ['incident'], sensitiveTablePrefixes: ['x_hr_'] }).deps(base);
  assert.equal(deps.now(), 42);
  assert.equal(deps.extra, 'kept');
  assert.equal(deps.isBlocked('Incident'), true);
  assert.equal(deps.isBlocked('problem'), false);
  assert.deepEqual(deps.sensitivePrefixes, ['sn_hr_', 'x_hr_']);
  assert.ok(Object.isFrozen(deps));
  const unknown = await guardFor({}, false).deps(base);
  assert.equal(unknown.sensitivePrefixes, undefined, 'no policy known: the context engine uses its defaults');
});

// ---- allowSensitive can not rise above the policy -----------------------------------------------------------------------------

test('allowSensitive: the managed policy has the last word on HR content', async () => {
  assert.equal(await guardFor({ allowHrContent: true }).allowSensitive(true), true);
  assert.equal(await guardFor({ allowHrContent: true }).allowSensitive(false), false);
  assert.equal(await guardFor({}).allowSensitive(true), false, 'the policy is known and does not allow HR: lowered');
  assert.equal(await guardFor({ allowHrContent: false }).allowSensitive(true), false);
  assert.equal(await guardFor({}, false).allowSensitive(true), true, 'the policy cannot be read here: the panel\'s value (it read the same policy) stands');
  assert.equal(await guardFor({}, false).allowSensitive(false), false);
  assert.equal(await guardFor({ allowHrContent: true }).allowSensitive('true'), false, 'only the boolean true');
});

// ---- What the readers show -----------------------------------------------------------------------------------------------------

test('classifyReadError: BLOCKED_TABLE is "blocked", with the organisation\'s own words, and never "denied"', () => {
  const out = classifyReadError(blockedError('task_sla'), 'task_sla');
  assert.equal(out.status, STATUS.BLOCKED);
  assert.equal(out.status, 'blocked');
  assert.match(out.note, /Your organisation does not allow Agent Buddy to read task_sla records/);
  assert.ok(!/cannot read|cannot see/i.test(out.note));
  // a plain 403 is still "denied"
  assert.equal(classifyReadError(Object.assign(new Error('403'), { code: 'ACCESS_DENIED' }), 'x').status, 'denied');
});

test('softRead and confirmEmptyIsReallyEmpty report a blocked table as blocked: never empty, never zero', async () => {
  const { deps } = await guarded({ blockedTables: ['task_sla'] });
  const read = await softRead(deps, 'task_sla', 'task=x', ['sla'], {});
  assert.deepEqual(read.rows, []);
  assert.equal(read.failure.status, 'blocked');
  const seen = await confirmEmptyIsReallyEmpty('task_sla', deps, new Map());
  assert.equal(seen.status, 'blocked');
  assert.match(seen.note, /does not allow/);
});

test('a blocked related table is reported in `access` as blocked and the list is absent (not an empty list, not "none")', async () => {
  const { deps } = await guarded({ blockedTables: ['task_sla'] });
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'record-summary' });
  const entry = pack.access.find((a) => a.source === 'task_sla');
  assert.equal(entry.status, 'blocked');
  assert.match(entry.note, /Your organisation does not allow Agent Buddy to read task_sla records/);
  assert.equal(pack.related.slas, undefined, 'absent, so nothing can read it as "no SLAs"');
  assert.ok(Array.isArray(pack.related.childTasks), 'the other lists are still read');
});

test('the record itself being blocked fails the whole read with that message', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['incident'] });
  await assert.rejects(() => readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'record-summary' }), refused('incident'));
  assert.equal(fake.calls.length, 0);
  // the same through the message boundary: code and plain message reach the panel
  const wire = toWireError(await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'record-summary' }).catch((e) => e));
  assert.equal(wire.error.code, 'BLOCKED_TABLE');
  assert.match(wire.error.message, /^Your organisation does not allow Agent Buddy to read incident records\.$/);
});

test('the notes of a record are not read from the journal table when the journal table is blocked, nor from the record\'s own columns', async () => {
  const { deps } = await guarded({ blockedTables: ['sys_journal_field'] });
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'record-summary' });
  assert.deepEqual(pack.journal, []);
  const entry = pack.access.find((a) => a.source === 'journal');
  assert.equal(entry.status, 'blocked');
  assert.match(entry.note, /does not allow/);
  assert.ok(!JSON.stringify(pack).includes('Gateway EU-2 shows 14 session resets'), 'work note text is not in the pack');
});

test('a variable answer whose reference table is blocked is left out, and the note says whose rule it is', async () => {
  const { deps } = await guarded({ blockedTables: ['sys_user'] });
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, deps, { feature: 'record-summary' });
  const entry = pack.access.find((a) => a.source === 'sc_item_option_mtom');
  assert.equal(entry.status, 'ok');
  assert.match(entry.note, /your organisation does not allow reading sys_user/);
  assert.ok(!pack.related.variables.some((x) => x.question === 'Manager'), 'the manager answer is left out, never shown as an id');
  const whole = await guarded({ blockedTables: ['sc_item_option_mtom'] });
  const blocked = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, whole.deps, { feature: 'record-summary' });
  assert.equal(blocked.access.find((a) => a.source === 'sc_item_option_mtom').status, 'blocked');
  assert.equal(blocked.related.variables, undefined);
});

test('SEC-13: a variable whose reference table is not on the allow-list is never read, with a note', async () => {
  const tables = buildInstance();
  const fake = fakeDeps(tables);
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, fake, { feature: 'record-summary' });
  // the fixture's "Cost centre owner" points at u_cost_center_owner, which is not a table Agent Buddy reads
  assert.ok(!fake.calls.some((c) => c.table === 'u_cost_center_owner'), 'that table was not queried');
  const note = pack.access.find((a) => a.source === 'sc_item_option_mtom').note;
  assert.match(note, /could not be shown/);
  assert.match(note, /not one Agent Buddy reads/);
  assert.ok(fake.calls.some((c) => c.table === 'sys_user' && c.query.startsWith('sys_idIN')), 'sys_user is allowed and is read');
});

test('a reader that gets BLOCKED for the similar-tickets table says so (no hits is not "nothing similar")', async () => {
  const { deps } = await guarded({ blockedTables: ['incident'] });
  const pack = { table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting' }, people: [] };
  const found = await findSimilarTickets(pack, deps, {});
  assert.deepEqual(found.hits, []);
  assert.equal(found.access[0].status, 'blocked');
});

test('the prompt is told that a part was blocked by the organisation, not that it was empty or hidden', async () => {
  const blockedRead = async () => { throw blockedError('kb_knowledge'); };
  const out = await addReference({ table: 'incident', sysId: INCIDENT_ID, fields: {}, people: [], access: [] }, { read: blockedRead }, { knowledge: true });
  assert.equal(out.reference.knowledge.status, 'blocked');
  assert.match(statusSentence(out.reference.knowledge), /not allowed by the organisation/);
  assert.match(referenceParts(out)[0].text, /Knowledge articles: not allowed by the organisation\./);
  assert.ok(out.access.some((a) => a.status === 'blocked' && /does not allow/.test(a.note)));
  assert.equal(out.requirePreview, undefined, 'nothing from other tickets is in it');
  // a read that answers with an access entry (the usual way) gets the same status
  const answered = await addReference({ table: 'incident', sysId: INCIDENT_ID, fields: {}, people: [] }, { read: async () => ({ hits: [], access: [{ source: 'kb_knowledge', status: 'blocked', note: 'x' }] }) }, { knowledge: true });
  assert.equal(answered.reference.knowledge.status, 'blocked');
  // the domain features list it under "Data not available", in fixed words
  const text = unavailableText({ access: [{ source: 'incident', status: 'blocked', note: 'Your organisation does not allow Agent Buddy to read incident records.' }, { source: 'sys_user', status: 'blocked', note: 'quiet' }] });
  assert.match(text, /Linked incidents: not allowed by your organisation \(do not describe it as empty\)/);
  assert.ok(!/quiet/.test(text), 'people lookups stay quiet');
});

test('the Request and Check tabs say whose rule stopped a read', () => {
  const notes = accessNotes([{ source: 'sysapproval_approver', status: 'blocked', note: 'x' }, { source: 'task_sla', status: 'denied', note: '' }]);
  assert.ok(notes.some((n) => /Your organisation does not allow Agent Buddy to read approvals/.test(n)), notes.join(' | '));
  assert.ok(notes.some((n) => /You cannot see SLAs/.test(n)));
  const view = answersModel({ kind: 'requested_item', related: {}, access: [{ source: 'sc_item_option_mtom', status: 'blocked', note: 'x' }] });
  assert.match(view.note, /Your organisation does not allow/);
  assert.ok(!/cannot read/.test(view.note));
});

test('the account-cases read and the routing look-alikes read report blocked, not empty', async () => {
  const { deps } = await guarded({ blockedTables: ['sn_customerservice_case'] });
  const answer = await ALL_OPS.accountCases({ table: 'sn_customerservice_case', sysId: CASE_ID }, { deps, checkRecord, checkPack });
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'blocked');
  assert.match(answer.access[0].note, /does not allow/);
  const inc = await guarded({ blockedTables: ['incident'] });
  const routing = await ALL_OPS.routingLookalikes({ pack: { table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting' }, people: [] } }, { deps: inc.deps, checkRecord, checkPack });
  assert.equal(routing.access[0].status, 'blocked');
});

// ---- handleRead: the content script's entry --------------------------------------------------------------------------------

test('handleRead builds the guarded deps for every read and lowers allowSensitive to the managed policy', async () => {
  const fake = fakeDeps(buildInstance());
  const guard = guardFor({ blockedTables: ['task_sla'] });
  const pack = await handleRead('pack', { table: 'incident', sysId: INCIDENT_ID, feature: 'record-summary' }, { guard, makeDeps: () => fake });
  assert.equal(pack.access.find((a) => a.source === 'task_sla').status, 'blocked');
  assert.ok(!fake.calls.some((c) => c.table === 'task_sla'), 'task_sla was never requested');
  await assert.rejects(() => handleRead('pack', { table: 'task_sla', sysId: INCIDENT_ID, feature: 'record-summary' }, { guard, makeDeps: () => fake }), refused('task_sla'));

  // HR content: the panel asks for allowSensitive, the policy says no
  const hr = fakeDeps(buildInstance());
  const noHr = await handleRead('pack', { table: 'sn_hr_core_case', sysId: 'd3e4f5a6b7c84d9e0f1a2b3c4d5e6f70', feature: 'record-summary', allowSensitive: true }, { guard: guardFor({}), makeDeps: () => hr });
  assert.equal(noHr.fields.short_description, undefined, 'minimised although the panel asked for free text');
  const yesHr = await handleRead('pack', { table: 'sn_hr_core_case', sysId: 'd3e4f5a6b7c84d9e0f1a2b3c4d5e6f70', feature: 'record-summary', allowSensitive: true }, { guard: guardFor({ allowHrContent: true }), makeDeps: () => fakeDeps(buildInstance()) });
  assert.ok(yesHr.fields.short_description, 'allowed by the policy: free text read');
});

test('an operation that is not known is still refused, and own properties only', async () => {
  const fake = fakeDeps({});
  const guard = guardFor({});
  await assert.rejects(() => handleRead('constructor', {}, { guard, makeDeps: () => fake }), /Unknown request/);
  await assert.rejects(() => handleRead('nope', {}, { guard, makeDeps: () => fake }), /Unknown request/);
});

test('a read of a record id with a feature the panel invented stays refused (the guard does not change that)', async () => {
  const fake = fakeDeps(buildInstance());
  await assert.rejects(() => handleRead('pack', { table: 'incident', sysId: INCIDENT_ID, feature: 'x' }, { guard: guardFor({}), makeDeps: () => fake }), /not a feature/);
});
