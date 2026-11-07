import test from 'node:test';
import assert from 'node:assert/strict';
import checksOps, { BOX_FIELDS, FORM_FIELDS, boxLabelsFor, makeChecksOps, readFormValues } from '../src/content/ops/checks.js';
import { FEATURES, featureById, insertsFor } from '../src/features/registry.js';
import { insertsForKind } from '../src/sidepanel/insertFlow.js';
import { OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { handleRead } from '../src/content/reads.js';
import { fakeDeps, sessionExpiredError, v } from './fixtures/sn-fakeDeps.js';

const INC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const PROBLEM = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';
const TASK = 'c3d4e5f60718293a4b5c6d7e8f90a1b2';
const RITM = 'd4e5f60718293a4b5c6d7e8f90a1b2c3';

// A page bridge that answers like src/page/bridge.js: getFormMeta, getFormValues and (a page with no g_form) getBoxValues.
function bridge({ meta = { table: 'incident', sysId: INC, isNewRecord: false, number: 'INC1' }, values = {}, boxes = {}, throwOn = null } = {}) {
  const calls = [];
  const callPage = async (action, args = []) => {
    calls.push({ action, args });
    if (throwOn === action) throw new Error('page did not answer');
    if (action === 'getFormMeta') return meta;
    if (action === 'getFormValues') return values;
    if (action === 'getBoxValues') return boxes;
    throw new Error(`unexpected bridge action ${action}`);
  };
  return { callPage, calls };
}
const ctx = (deps, extra = {}) => ({ deps, checkRecord, checkPack, ...extra });
const rec = { table: 'incident', sysId: INC };
// The record the content script finds from the page's address (src/content/index.js resolveRecord).
const at = (record) => async () => record;

// ---- the form ----------------------------------------------------------------------------------------------------------------------

test('only the fixed list of fields is asked for, and only those come back as text', async () => {
  const { callPage, calls } = bridge({ values: { close_notes: 'Fixed the cert', close_code: 'Solution provided', state: '6', comments: 'Hello', work_notes: 'wn', hold_reason: '', resolution_code: '', u_password: 'pw', short_description: 'x', caller_id: 'y', description: 5, __proto__x: 1 } });
  const { source, values: form } = await readFormValues(rec, callPage);
  assert.equal(source, 'form');
  assert.deepEqual(calls.map((c) => c.action), ['getFormMeta', 'getFormValues']);
  assert.deepEqual(calls[1].args, [[...FORM_FIELDS]], 'the page is asked for exactly the whitelist');
  assert.deepEqual(Object.keys(form).sort(), ['close_code', 'close_notes', 'comments', 'hold_reason', 'resolution_code', 'state', 'work_notes']);
  assert.equal(form.close_notes, 'Fixed the cert');
  assert.deepEqual([...FORM_FIELDS], ['close_notes', 'close_code', 'resolution_code', 'state', 'hold_reason', 'comments', 'work_notes']);
});

test('a page with no form and no record to compare with gives null, and nothing more is asked of the page', async () => {
  const { callPage, calls } = bridge({ meta: null, boxes: { close_notes: 'typed' } });
  assert.equal(await readFormValues(rec, callPage), null);
  assert.deepEqual(calls.map((c) => c.action), ['getFormMeta']);
});

test('a form that shows another record, or another table, is not used', async () => {
  assert.equal(await readFormValues(rec, bridge({ meta: { table: 'incident', sysId: PROBLEM } }).callPage), null);
  assert.equal(await readFormValues(rec, bridge({ meta: { table: 'problem', sysId: INC } }).callPage), null);
  assert.equal(await readFormValues(rec, bridge({ meta: 'nonsense' }).callPage), null);
  // the same id in another case is the same record
  assert.notEqual(await readFormValues(rec, bridge({ meta: { table: 'incident', sysId: INC.toUpperCase() }, values: { state: '2' } }).callPage), null);
  // a form of another record is never a reason to look at the boxes instead, even when the address is this record
  const other = bridge({ meta: { table: 'incident', sysId: PROBLEM }, boxes: { close_notes: 'typed' } });
  assert.equal(await readFormValues(rec, other.callPage, { currentRecord: at(rec) }), null);
  assert.ok(!other.calls.some((c) => c.action === 'getBoxValues'));
});

test('a page that fails or answers nonsense never breaks the read: null', async () => {
  for (const throwOn of ['getFormMeta', 'getFormValues']) assert.equal(await readFormValues(rec, bridge({ throwOn, values: { state: '2' } }).callPage), null, throwOn);
  for (const values of [null, 'text', 7, ['close_notes']]) assert.equal(await readFormValues(rec, bridge({ values }).callPage), null, JSON.stringify(values));
});

test('a very long field is cut, not passed on whole', async () => {
  const { values: form } = await readFormValues(rec, bridge({ values: { comments: 'x'.repeat(50000) } }).callPage);
  assert.equal(form.comments.length, 20000);
});

// ---- a Workspace page: the notes boxes (TRACKER.md N4) -------------------------------------------------------------------------------

test('Workspace: with no g_form and the address on this record, the notes boxes are read, by the labels the inserts use', async () => {
  const { callPage, calls } = bridge({ meta: null, boxes: { close_notes: 'Restarted the gateway', work_notes: 'wn', comments: '' } });
  const out = await readFormValues(rec, callPage, { currentRecord: at({ table: 'incident', sysId: INC.toUpperCase(), number: 'INC1' }) });
  assert.deepEqual(out, { source: 'boxes', values: { close_notes: 'Restarted the gateway', work_notes: 'wn', comments: '' } });
  assert.deepEqual(calls.map((c) => c.action), ['getFormMeta', 'getBoxValues']);
  assert.deepEqual(calls[1].args, [['close_notes', 'work_notes', 'comments'], ['Resolution notes', 'Work notes', 'Additional comments']]);
  assert.deepEqual([...BOX_FIELDS], ['close_notes', 'work_notes', 'comments'], 'text boxes only: never the close code, the state or the hold reason');
});

test('Workspace: only the notes fields, only text, cut to length; whatever else the page says is dropped', async () => {
  const boxes = { close_notes: 'x'.repeat(50000), work_notes: 7, comments: ['a'], close_code: 'Solution provided', state: '6', hold_reason: 'x', u_secret: 's' };
  const out = await readFormValues(rec, bridge({ meta: null, boxes }).callPage, { currentRecord: at(rec) });
  assert.deepEqual(Object.keys(out.values), ['close_notes']);
  assert.equal(out.values.close_notes.length, 20000);
  // nothing found, or nonsense: no form at all (the saved ticket only)
  for (const answer of [{}, null, 'text', 7, ['close_notes'], { close_code: 'x' }]) {
    assert.equal(await readFormValues(rec, bridge({ meta: null, boxes: answer }).callPage, { currentRecord: at(rec) }), null, JSON.stringify(answer));
  }
  assert.equal(await readFormValues(rec, bridge({ meta: null, throwOn: 'getBoxValues' }).callPage, { currentRecord: at(rec) }), null);
});

test('Workspace: the boxes are read only when the page\'s address is this very record', async () => {
  for (const open of [null, { table: 'incident', sysId: PROBLEM }, { table: 'problem', sysId: INC }, { sysId: INC }, 'incident', ['incident', INC]]) {
    const page = bridge({ meta: null, boxes: { close_notes: 'typed' } });
    assert.equal(await readFormValues(rec, page.callPage, { currentRecord: at(open) }), null, JSON.stringify(open));
    assert.ok(!page.calls.some((c) => c.action === 'getBoxValues'), `the page was not asked (${JSON.stringify(open)})`);
  }
  const failing = bridge({ meta: null, boxes: { close_notes: 'typed' } });
  assert.equal(await readFormValues(rec, failing.callPage, { currentRecord: async () => { throw new Error('no page'); } }), null);
  assert.equal(await readFormValues(rec, failing.callPage, { currentRecord: 'not a function' }), null);
});

test('Workspace: the label of close_notes follows the kind, as the inserts of "Improve my resolution notes" do', () => {
  assert.deepEqual(boxLabelsFor('incident'), ['Resolution notes', 'Work notes', 'Additional comments']);
  assert.deepEqual(boxLabelsFor('sn_customerservice_case'), ['Resolution notes', 'Work notes', 'Additional comments']);
  for (const table of ['sc_req_item', 'sc_task', 'task', 'incident_task']) assert.equal(boxLabelsFor(table)[0], 'Close notes', table);
  // read and insert agree: the label an insert into close_notes looks for on each kind is the label read here
  const improve = featureById('resolution-improve');
  for (const [kind, table] of [['incident', 'incident'], ['case', 'sn_customerservice_case'], ['requested_item', 'sc_req_item'], ['catalog_task', 'sc_task'], ['task', 'task']]) {
    const spec = insertsForKind(improve, kind).find((s) => s.field === 'close_notes');
    assert.equal(spec?.fieldLabel, boxLabelsFor(table)[0], kind);
  }
  // and the journal boxes carry the labels every work-note and customer-comment insert of every feature uses
  const journal = { work_notes: new Set(), comments: new Set() };
  for (const feature of FEATURES) for (const spec of insertsFor(feature)) if (journal[spec.field] && spec.fieldLabel) journal[spec.field].add(spec.fieldLabel);
  assert.ok(journal.work_notes.size && journal.comments.size);
  for (const [name, labels] of Object.entries(journal)) assert.deepEqual([...labels], [boxLabelsFor('incident')[BOX_FIELDS.indexOf(name)]], name);
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
  assert.equal(out.formSource, 'form');
  assert.deepEqual(out.links, { problem: { status: 'yes', note: '' }, knowledge: { status: 'yes', note: '' } });
});

test('resolutionFacts: no form (null) still reports the links', async () => {
  const out = await facts({ incident: [{ sys_id: v(INC), problem_id: v('') }], m2m_kb_task: [{ sys_id: v('m1'), task: v('other0000000000000000000000000000'), kb_knowledge: v('kb1') }] }, {}, bridge({ meta: null }));
  assert.equal(out.form, null);
  assert.equal(out.formSource, null);
  assert.equal(out.links.problem.status, 'no');
  assert.equal(out.links.knowledge.status, 'no', 'the article is linked to another ticket, and the table is visible');
});

test('resolutionFacts on a Workspace page: the notes boxes, said to be boxes, with the record the content script found', async () => {
  const deps = fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [] });
  const page = bridge({ meta: null, boxes: { close_notes: 'Typed, not saved', work_notes: '' } });
  const ops = makeChecksOps({ callPage: page.callPage });
  const out = await ops.resolutionFacts({ ...rec }, ctx(deps, { currentRecord: at({ table: 'incident', sysId: INC }) }));
  assert.deepEqual(out.form, { close_notes: 'Typed, not saved', work_notes: '' });
  assert.equal(out.formSource, 'boxes');
  // another record in the address: nothing typed is read, the links still are
  const elsewhere = await ops.resolutionFacts({ ...rec }, ctx(deps, { currentRecord: at({ table: 'incident', sysId: PROBLEM }) }));
  assert.equal(elsewhere.form, null);
  assert.equal(elsewhere.formSource, null);
  assert.ok(elsewhere.links.problem);
  assert.ok(!deps.calls.some((c) => c.fn !== 'queryTable'), 'reading the boxes is not a request to the instance');
});

test('handleRead gives the operation the content script\'s own record finder (src/content/reads.js); the panel cannot send one', async () => {
  // A stand-in for the page: the real tryCallPage talks to it over document events, as to src/page/bridge.js.
  const listeners = new Map();
  const asked = [];
  globalThis.document = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => {
      const { id, action } = event.detail;
      asked.push(action);
      const result = action === 'getBoxValues' ? { close_notes: 'Typed on the Workspace' } : null;
      queueMicrotask(() => listeners.get('ab-page-response')?.({ detail: { id, ok: true, result } }));
      return true;
    },
  };
  try {
    const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: {} }) });
    const makeDeps = () => fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [] });
    const found = [];
    const currentRecord = async () => (found.push('asked'), { table: 'incident', sysId: INC });
    const out = await handleRead('resolutionFacts', { ...rec, currentRecord: 'from the panel' }, { guard, makeDeps, currentRecord });
    assert.deepEqual(found, ['asked']);
    assert.deepEqual(out.form, { close_notes: 'Typed on the Workspace' });
    assert.equal(out.formSource, 'boxes');
    assert.deepEqual(asked, ['getFormMeta', 'getBoxValues']);
    // without the content script's finder (an old caller), a page with no g_form reads nothing typed
    asked.length = 0;
    const none = await handleRead('resolutionFacts', { ...rec }, { guard, makeDeps });
    assert.equal(none.form, null);
    assert.deepEqual(asked, ['getFormMeta']);
  } finally {
    delete globalThis.document;
  }
});

test('problem link: not asked for other tables, "unknown" when the incident cannot be read', async () => {
  const ops = makeChecksOps({ callPage: bridge({ meta: null }).callPage });
  const sctask = await ops.resolutionFacts({ table: 'sc_task', sysId: TASK }, ctx(fakeDeps({})));
  assert.equal(sctask.links.problem.status, 'na');
  const denied = await facts({ incident: [{ sys_id: v(INC) }] }, { denied: ['incident'] });
  assert.equal(denied.links.problem.status, 'unknown');
  assert.match(denied.links.problem.note, /cannot see whether a problem is linked/);
  const missing = await facts({ incident: [] });
  assert.equal(missing.links.problem.status, 'unknown');
});

test('knowledge link: the kb_use table counts too; a table that ignores the filter is not believed', async () => {
  const viaUse = await facts({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [{ sys_id: v('m1'), task: v('f'.repeat(32)) }], kb_use: [{ sys_id: v('u1'), task_id: v(INC), article: v('kb1') }] });
  assert.equal(viaUse.links.knowledge.status, 'yes');
  // kb_use has neither a task_id nor a task column: the one-row probe shows it, so no query is built on a missing column (which
  // ServiceNow would ignore and answer with every row) and nothing is believed.
  const leaky = await facts({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [{ sys_id: v('u1'), other: v('x') }] });
  assert.equal(leaky.links.knowledge.status, 'unknown');
  assert.match(leaky.links.knowledge.note, /article links could not be checked/);
  assert.doesNotMatch(leaky.links.knowledge.note, /kb_use|task_id/);
  // A table that has the column but ignores the condition anyway (answers with another ticket's row) is not believed either.
  const INC2 = 'f'.repeat(32);
  const ignoring = fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [{ sys_id: v('u1'), task_id: v(INC2) }] });
  const answering = { ...ignoring, queryTable: (table, query, ...rest) => ignoring.queryTable(table, table === 'kb_use' ? '' : query, ...rest) };
  const wrong = await makeChecksOps({ callPage: bridge({ meta: null }).callPage }).resolutionFacts({ ...rec }, ctx(answering));
  assert.equal(wrong.links.knowledge.status, 'unknown');
  assert.match(wrong.links.knowledge.note, /did not narrow the results as asked/);
});

test('knowledge link: "none" only when the user can see rows of the table at all', async () => {
  const hidden = await facts({ incident: [{ sys_id: v(INC) }] }, { hidden: ['m2m_kb_task', 'kb_use'] });
  assert.equal(hidden.links.knowledge.status, 'unknown');
  assert.match(hidden.links.knowledge.note, /you can see none of the links at all/);
  assert.doesNotMatch(hidden.links.knowledge.note, /m2m_kb_task|kb_use|your user/i);
  const denied = await facts({ incident: [{ sys_id: v(INC) }] }, { denied: ['m2m_kb_task', 'kb_use'] });
  assert.equal(denied.links.knowledge.status, 'unknown');
  assert.match(denied.links.knowledge.note, /cannot see which articles are linked/);
  assert.equal(denied.links.knowledge.note.split('cannot see which articles are linked').length, 2, 'two tables that fail the same way say it once');
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
  assert.match(denied.note, /cannot see the requested item this task belongs to.*on its own/);
  assert.doesNotMatch(denied.note, /sc_task|your user/i);
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
