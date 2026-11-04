import test from 'node:test';
import assert from 'node:assert/strict';
import { formShowsRecord } from '../src/content/formRecord.js';
import { readFormValues as readTypedForChecks } from '../src/content/ops/checks.js';
import { readFormValues as readTypedForWrite } from '../src/content/ops/compose.js';
import { checkInsertTargets } from '../src/content/fill.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { handleRead } from '../src/content/reads.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// A record opened through the base class, /task.do?sys_id=<an incident>: g_form.getTableName() says 'task', while the content script
// (src/content/recordResolver.js) and the panel know the record as an incident. The reads of the form compared the two as they were
// and always answered "another record" (audit P2.24). The form's `task` now counts when the content script's own reading of the
// page (currentRecord: the same form, its class looked up) is that record.

const INC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';
const incident = { table: 'incident', sysId: INC };
const taskForm = { table: 'task', sysId: INC, isNewRecord: false, number: 'INC0010001' };
const at = (record) => async () => record;

// A page bridge with a classic form of `task` on it.
function bridge({ meta = taskForm, values = { close_notes: 'Restarted the gateway', comments: 'Hello' }, states = null } = {}) {
  const calls = [];
  const callPage = async (action, args = []) => {
    calls.push(action);
    if (action === 'getFormMeta') return meta;
    if (action === 'getFormValues') return values;
    if (action === 'getFieldStates') return states || { form: 'gform', table: meta.table, sysId: meta.sysId, fields: { comments: 'editable', close_notes: 'read-only' } };
    throw new Error(`unexpected bridge action ${action} ${args.length}`);
  };
  return { callPage, calls };
}

test('formShowsRecord: the same table and id; a form of task only when the content script finds that very record', async () => {
  assert.equal(await formShowsRecord({ table: 'incident', sysId: INC.toUpperCase() }, incident), true);
  assert.equal(await formShowsRecord({ table: 'task', sysId: INC }, incident, at(incident)), true);
  // without the content script's reading, or when it finds something else, a form of task is not the incident
  assert.equal(await formShowsRecord({ table: 'task', sysId: INC }, incident), false);
  for (const open of [null, 'incident', { table: 'problem', sysId: INC }, { table: 'incident', sysId: OTHER }, { table: 'task', sysId: INC }]) {
    assert.equal(await formShowsRecord({ table: 'task', sysId: INC }, incident, at(open)), false, JSON.stringify(open));
  }
  assert.equal(await formShowsRecord({ table: 'task', sysId: INC }, incident, async () => { throw new Error('no page'); }), false);
  // only the base class is looked up: a form of another table is never the record, whatever the page's address says
  assert.equal(await formShowsRecord({ table: 'problem', sysId: INC }, incident, at(incident)), false);
  // another record's form is refused before anything else is asked
  let asked = 0;
  assert.equal(await formShowsRecord({ table: 'task', sysId: OTHER }, incident, async () => (asked++, incident)), false);
  assert.equal(asked, 0);
  // what the page said is data
  for (const odd of [null, 'task', [], { table: ['task'], sysId: INC }, { table: 'task' }]) assert.equal(await formShowsRecord(odd, incident, at(incident)), false, JSON.stringify(odd));
  // a record whose class could not be looked up stays 'task' in the panel too: the form matches as it is
  assert.equal(await formShowsRecord({ table: 'task', sysId: INC }, { table: 'task', sysId: INC }), true);
});

test('resolution facts (Check tab, Ready to resolve): what is typed on a task.do form of this incident is read', async () => {
  const page = bridge();
  const typed = await readTypedForChecks(incident, page.callPage, { currentRecord: at({ ...incident, number: 'INC0010001' }) });
  assert.deepEqual(typed, { source: 'form', values: { close_notes: 'Restarted the gateway', comments: 'Hello' } });
  assert.deepEqual(page.calls, ['getFormMeta', 'getFormValues']);
  // the page shows another record now: nothing is read
  const moved = bridge();
  assert.equal(await readTypedForChecks(incident, moved.callPage, { currentRecord: at({ table: 'incident', sysId: OTHER }) }), null);
  assert.deepEqual(moved.calls, ['getFormMeta']);
});

test('Write (Rewrite, Check my comment): the form values of a task.do form of this incident are available, not "another form"', async () => {
  const args = { names: ['comments'], expect: incident };
  assert.deepEqual(await readTypedForWrite(args, bridge().callPage, { currentRecord: at(incident) }), { available: true, values: { comments: 'Hello' } });
  assert.deepEqual(await readTypedForWrite(args, bridge().callPage), { available: false, values: {}, wrongForm: true });
  assert.deepEqual(await readTypedForWrite(args, bridge().callPage, { currentRecord: at({ table: 'problem', sysId: INC }) }), { available: false, values: {}, wrongForm: true });
});

test('Insert targets: the boxes of a task.do form of this incident are offered', async () => {
  const fields = [{ name: 'comments' }, { name: 'close_notes' }];
  const out = await checkInsertTargets({ fields, expect: incident }, { callPage: bridge().callPage, currentRecord: at(incident) });
  assert.deepEqual(out, { form: 'gform', match: true, fields: { comments: { state: 'editable' }, close_notes: { state: 'read-only' } } });
  const elsewhere = await checkInsertTargets({ fields, expect: incident }, { callPage: bridge().callPage, currentRecord: at({ table: 'incident', sysId: OTHER }) });
  assert.equal(elsewhere.match, false);
  assert.deepEqual(elsewhere.fields, { comments: { state: 'unknown' }, close_notes: { state: 'unknown' } });
});

test('through handleRead: formValues, insertTargets and resolutionFacts get the content script\'s record finder, never the panel\'s', async () => {
  // The page: the real tryCallPage talks to it over document events, as to src/page/bridge.js.
  const listeners = new Map();
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.document = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => {
      const { id, action } = event.detail;
      const result = {
        getFormMeta: taskForm,
        getFormValues: { comments: 'Hello', close_notes: 'Restarted the gateway' },
        getFieldStates: { form: 'gform', table: 'task', sysId: INC, fields: { comments: 'editable' } },
      }[action];
      queueMicrotask(() => listeners.get('ab-page-response')?.({ detail: { id, ok: true, result: result ?? null } }));
      return true;
    },
  };
  try {
    const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: {} }) });
    const makeDeps = () => fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [], kb_use: [] });
    const found = [];
    const currentRecord = async () => (found.push('asked'), { ...incident, number: 'INC0010001' });
    const read = (op, args) => handleRead(op, { ...args, currentRecord: async () => ({ table: 'task', sysId: INC }) }, { guard, makeDeps, currentRecord });

    const write = await read('formValues', { names: ['comments'], expect: incident });
    assert.deepEqual(write, { available: true, values: { comments: 'Hello' } });
    const targets = await read('insertTargets', { fields: [{ name: 'comments' }], expect: incident });
    assert.equal(targets.match, true);
    assert.deepEqual(targets.fields, { comments: { state: 'editable' } });
    const facts = await read('resolutionFacts', incident);
    assert.equal(facts.formSource, 'form');
    assert.equal(facts.form.close_notes, 'Restarted the gateway');
    assert.equal(found.length, 3, 'each read asked the content script which record the page shows');
  } finally {
    delete globalThis.document;
  }
});
