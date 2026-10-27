import test from 'node:test';
import assert from 'node:assert/strict';
import checksOps, { FORM_FIELDS, makeChecksOps, readFormValues } from '../src/content/ops/checks.js';
import { OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { fakeDeps, sessionExpiredError, v } from './fixtures/sn-fakeDeps.js';

const INC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PROBLEM = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';
const TASK = 'c3d4e5f60718293a4b5c6d7e8f90a1b2';
const RITM = 'd4e5f60718293a4b5c6d7e8f90a1b2c3';

// A page bridge that answers like src/page/bridge.js: getFormMeta and getFormValues.
function bridge({ meta = { table: 'incident', sysId: INC, isNewRecord: false, number: 'INC1' }, values = {}, throwOn = null } = {}) {
  const calls = [];
  const callPage = async (action, args = []) => {
    calls.push({ action, args });
    if (throwOn === action) throw new Error('page did not answer');
    if (action === 'getFormMeta') return meta;
    if (action === 'getFormValues') return values;
    throw new Error(`unexpected bridge action ${action}`);
  };
  return { callPage, calls };
}
const ctx = (deps) => ({ deps, checkRecord, checkPack });
const rec = { table: 'incident', sysId: INC };

// ---- the form ----------------------------------------------------------------------------------------------------------------------

test('only the fixed list of fields is asked for, and only those come back as text', async () => {
  const { callPage, calls } = bridge({ values: { close_notes: 'Fixed the cert', close_code: 'Solution provided', state: '6', comments: 'Hello', work_notes: 'wn', hold_reason: '', resolution_code: '', u_password: 'pw', short_description: 'x', caller_id: 'y', description: 5, __proto__x: 1 } });
  const form = await readFormValues(rec, callPage);
  assert.deepEqual(calls.map((c) => c.action), ['getFormMeta', 'getFormValues']);
  assert.deepEqual(calls[1].args, [[...FORM_FIELDS]], 'the page is asked for exactly the whitelist');
  assert.deepEqual(Object.keys(form).sort(), ['close_code', 'close_notes', 'comments', 'hold_reason', 'resolution_code', 'state', 'work_notes']);
  assert.equal(form.close_notes, 'Fixed the cert');
  assert.deepEqual([...FORM_FIELDS], ['close_notes', 'close_code', 'resolution_code', 'state', 'hold_reason', 'comments', 'work_notes']);
});

test('a page with no form (portal, Workspace) gives null, and the values are not even asked for', async () => {
  const { callPage, calls } = bridge({ meta: null });
  assert.equal(await readFormValues(rec, callPage), null);
  assert.deepEqual(calls.map((c) => c.action), ['getFormMeta']);
});

test('a form that shows another record, or another table, is not used', async () => {
  assert.equal(await readFormValues(rec, bridge({ meta: { table: 'incident', sysId: PROBLEM } }).callPage), null);
  assert.equal(await readFormValues(rec, bridge({ meta: { table: 'problem', sysId: INC } }).callPage), null);
  assert.equal(await readFormValues(rec, bridge({ meta: 'nonsense' }).callPage), null);
  // the same id in another case is the same record
  assert.notEqual(await readFormValues(rec, bridge({ meta: { table: 'incident', sysId: INC.toUpperCase() }, values: { state: '2' } }).callPage), null);
});

test('a page that fails or answers nonsense never breaks the read: null', async () => {
  for (const throwOn of ['getFormMeta', 'getFormValues']) assert.equal(await readFormValues(rec, bridge({ throwOn, values: { state: '2' } }).callPage), null, throwOn);
  for (const values of [null, 'text', 7, ['close_notes']]) assert.equal(await readFormValues(rec, bridge({ values }).callPage), null, JSON.stringify(values));
});

test('a very long field is cut, not passed on whole', async () => {
  const form = await readFormValues(rec, bridge({ values: { comments: 'x'.repeat(50000) } }).callPage);
  assert.equal(form.comments.length, 20000);
});

// ---- resolutionFacts -----------------------------------------------------------------------------------------------------------------

const facts = (tables, behaviour, page = bridge()) => makeChecksOps({ callPage: page.callPage }).resolutionFacts({ ...rec }, ctx(fakeDeps(tables, behaviour)));

test('resolutionFacts: the form values and the links in one answer', async () => {
  const out = await facts(
    { incident: [{ sys_id: v(INC), problem_id: v(PROBLEM, 'PRB0001') }], m2m_kb_task: [{ sys_id: v('m1'), task: v(INC), kb_knowledge: v('kb1') }] },
    {},
    bridge({ values: { close_notes: 'Done' } })
  );
  assert.deepEqual(out.form, { close_notes: 'Done' });
  assert.deepEqual(out.links, { problem: { status: 'yes', note: '' }, knowledge: { status: 'yes', note: '' } });
});

test('resolutionFacts: no form (null) still reports the links', async () => {
  const out = await facts({ incident: [{ sys_id: v(INC), problem_id: v('') }], m2m_kb_task: [{ sys_id: v('m1'), task: v('other0000000000000000000000000000'), kb_knowledge: v('kb1') }] }, {}, bridge({ meta: null }));
  assert.equal(out.form, null);
  assert.equal(out.links.problem.status, 'no');
  assert.equal(out.links.knowledge.status, 'no', 'the article is linked to another ticket, and the table is visible');
});

test('problem link: not asked for other tables, "unknown" when the incident cannot be read', async () => {
  const ops = makeChecksOps({ callPage: bridge({ meta: null }).callPage });
  const sctask = await ops.resolutionFacts({ table: 'sc_task', sysId: TASK }, ctx(fakeDeps({})));
  assert.equal(sctask.links.problem.status, 'na');
  const denied = await facts({ incident: [{ sys_id: v(INC) }] }, { denied: ['incident'] });
  assert.equal(denied.links.problem.status, 'unknown');
  assert.match(denied.links.problem.note, /cannot read the problem link/);
  const missing = await facts({ incident: [] });
  assert.equal(missing.links.problem.status, 'unknown');
});

test('knowledge link: the kb_use table counts too; a table that ignores the filter is not believed', async () => {
  const viaUse = await facts({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [{ sys_id: v('m1'), task: v('f'.repeat(32)) }], kb_use: [{ sys_id: v('u1'), task_id: v(INC), article: v('kb1') }] });
  assert.equal(viaUse.links.knowledge.status, 'yes');
  // kb_use has no task_id column: ServiceNow ignores the condition and answers with every row.
  const leaky = await facts({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [{ sys_id: v('u1'), other: v('x') }] });
  assert.equal(leaky.links.knowledge.status, 'unknown');
  assert.match(leaky.links.knowledge.note, /did not apply the filter/);
});

test('knowledge link: "none" only when the user can see rows of the table at all', async () => {
  const hidden = await facts({ incident: [{ sys_id: v(INC) }] }, { hidden: ['m2m_kb_task', 'kb_use'] });
  assert.equal(hidden.links.knowledge.status, 'unknown');
  assert.match(hidden.links.knowledge.note, /sees no rows/);
  const denied = await facts({ incident: [{ sys_id: v(INC) }] }, { denied: ['m2m_kb_task', 'kb_use'] });
  assert.equal(denied.links.knowledge.status, 'unknown');
  assert.match(denied.links.knowledge.note, /cannot read m2m_kb_task/);
  const missingTable = await facts({ incident: [{ sys_id: v(INC) }] }, { errors: { m2m_kb_task: new Error('Invalid table m2m_kb_task'), kb_use: new Error('Invalid table kb_use') } });
  assert.equal(missingTable.links.knowledge.status, 'unknown');
  // One table readable and empty is enough to say "none"; the other one being hidden is noted but does not hide the answer.
  const one = await facts({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [{ sys_id: v('m1'), task: v('e'.repeat(32)) }] }, { denied: ['kb_use'] });
  assert.equal(one.links.knowledge.status, 'no');
});

test('a lost session is reported to the panel; every other failure becomes "could not check"', async () => {
  await assert.rejects(() => facts({ incident: [{ sys_id: v(INC) }] }, { expired: ['m2m_kb_task'] }), (e) => e.code === 'SESSION_EXPIRED');
  assert.ok(sessionExpiredError());
  const odd = await facts({ incident: [{ sys_id: v(INC) }] }, { errors: { incident: new Error('boom') } });
  assert.equal(odd.links.problem.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(odd), /boom/, 'a raw error text is not passed on as an answer');
});

test('arguments are validated before anything is read', async () => {
  const deps = fakeDeps({});
  const ops = makeChecksOps({ callPage: bridge().callPage });
  for (const bad of [{}, { table: 'incident' }, { table: 'incident; drop', sysId: INC }, { table: 'incident', sysId: 'xyz' }, { table: '', sysId: INC }, undefined]) {
    await assert.rejects(() => ops.resolutionFacts(bad, ctx(deps)), /not a valid record/, JSON.stringify(bad));
    await assert.rejects(() => ops.requestTarget(bad, ctx(deps)), /not a valid record/, JSON.stringify(bad));
  }
  assert.equal(deps.calls.length, 0);
});

test('reads are GET-only queries of a few known tables, with a short column list each', async () => {
  const deps = fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [] });
  await makeChecksOps({ callPage: bridge({ meta: null }).callPage }).resolutionFacts({ ...rec }, ctx(deps));
  const tables = new Set(deps.calls.map((c) => c.table));
  for (const t of tables) assert.ok(['incident', 'm2m_kb_task', 'kb_use'].includes(t), t);
  for (const c of deps.calls) {
    assert.equal(c.fn, 'queryTable');
    assert.ok(c.fields.length <= 3, `${c.table} asks for ${c.fields.join(',')}`);
  }
  assert.ok(!deps.fieldsAsked().has('work_notes') && !deps.fieldsAsked().has('comments'), 'the saved notes are not read here');
});

// ---- requestTarget ---------------------------------------------------------------------------------------------------------------------

test('requestTarget: a catalog task points at its requested item; items and requests are their own target', async () => {
  const ops = makeChecksOps();
  const deps = fakeDeps({ sc_task: [{ sys_id: v(TASK), request_item: v(RITM, 'RITM1') }] });
  assert.deepEqual(await ops.requestTarget({ table: 'sc_task', sysId: TASK }, ctx(deps)), { table: 'sc_req_item', sysId: RITM, note: '' });
  assert.deepEqual(await ops.requestTarget({ table: 'sc_req_item', sysId: RITM.toUpperCase() }, ctx(deps)), { table: 'sc_req_item', sysId: RITM, note: '' });
  assert.deepEqual(await ops.requestTarget({ table: 'sc_request', sysId: RITM }, ctx(deps)), { table: 'sc_request', sysId: RITM, note: '' });
  assert.equal(deps.calls.length, 1, 'only the catalog task needs a read');
  await assert.rejects(() => ops.requestTarget({ table: 'incident', sysId: INC }, ctx(deps)), /not part of a catalog request/);
});

test('requestTarget: no readable item means the task on its own, with the reason', async () => {
  const ops = makeChecksOps();
  const none = await ops.requestTarget({ table: 'sc_task', sysId: TASK }, ctx(fakeDeps({ sc_task: [{ sys_id: v(TASK), request_item: v('') }] })));
  assert.equal(none.table, 'sc_task');
  assert.match(none.note, /no requested item you can see.*on its own/);
  const denied = await ops.requestTarget({ table: 'sc_task', sysId: TASK }, ctx(fakeDeps({ sc_task: [] }, { denied: ['sc_task'] })));
  assert.equal(denied.table, 'sc_task');
  assert.match(denied.note, /cannot read sc_task/);
  // A row for another task (a filter that was ignored) is not used.
  const other = await ops.requestTarget({ table: 'sc_task', sysId: TASK }, ctx(fakeDeps({ sc_task: [{ sys_id: v('9'.repeat(32)), request_item: v(RITM) }] }, { ignoreUnknownColumns: false })));
  assert.equal(other.table, 'sc_task');
});

// ---- registration -----------------------------------------------------------------------------------------------------------------------

test('both operations are registered for the panel to call, and nothing else is exposed by this module', () => {
  assert.equal(OPS.resolutionFacts, checksOps.resolutionFacts);
  assert.equal(OPS.requestTarget, checksOps.requestTarget);
  assert.deepEqual(Object.keys(checksOps).sort(), ['requestTarget', 'resolutionFacts']);
});
