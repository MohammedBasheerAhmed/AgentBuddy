const test = require('node:test');
const assert = require('node:assert/strict');
import { createPolicyGuard, mergePanelPolicy } from '../src/content/policyGuard.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The managed policy cannot always be read inside a content script. The panel sends its own copy with each READ, and the two
// are merged: lists are joined, HR content must be allowed by every source. The panel can only make a read stricter.

const unknown = async () => ({ known: false, raw: {} });
const fakeDeps = (log) => ({
  queryTable: async (table) => {
    log.push(table);
    return [];
  },
  fetchRecord: async (table) => {
    log.push(table);
    return null;
  },
});

test('with no managed policy readable, the policy the panel sends still blocks a table', async () => {
  const guard = createPolicyGuard({ getManaged: unknown });
  const log = [];
  const deps = await guard.deps(fakeDeps(log), { blockedTables: ['Sc_Item_Option_Mtom'], sensitiveTablePrefixes: [], allowHrContent: false });
  await assert.rejects(() => deps.queryTable('sc_item_option_mtom', 'request_item=x', ['sys_id']), (e) => e.code === 'BLOCKED_TABLE');
  await deps.queryTable('incident', 'sys_id=x', ['number']);
  assert.deepEqual(log, ['incident'], 'the blocked table was never requested');
});

test('the lists are joined and HR content needs every source to allow it', async () => {
  const managedAllowsHr = async () => ({ known: true, raw: { blockedTables: ['problem'], allowHrContent: true } });
  const guard = createPolicyGuard({ getManaged: managedAllowsHr });
  const deps = await guard.deps(fakeDeps([]), { blockedTables: ['change_request'], allowHrContent: true });
  await assert.rejects(() => deps.queryTable('problem', 'x', ['a']), (e) => e.code === 'BLOCKED_TABLE');
  await assert.rejects(() => deps.queryTable('change_request', 'x', ['a']), (e) => e.code === 'BLOCKED_TABLE');
  assert.equal(await guard.allowSensitive(true, { allowHrContent: true }), true);
  assert.equal(await guard.allowSensitive(true, { allowHrContent: false }), false, 'the panel says no: no');
  assert.equal(await guard.allowSensitive(true, undefined), true, 'no panel policy: the managed policy decides');
  const managedDenies = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { allowHrContent: false } }) });
  assert.equal(await managedDenies.allowSensitive(true, { allowHrContent: true }), false, 'a panel can not loosen the managed policy');
});

test('a missing or malformed panel policy changes nothing; names are cleaned', () => {
  const state = { known: true, policy: normalizePolicy({ blockedTables: ['a'] }), blocked: new Set(['a']), sensitivePrefixes: ['sn_hr_'] };
  for (const bad of [null, undefined, 'x', 42, [], [1, 2]]) assert.equal(mergePanelPolicy(state, bad), state);
  const merged = mergePanelPolicy(state, { blockedTables: ['B', 'not a table!', '', 'x'.repeat(200)], sensitiveTablePrefixes: ['x_hr_'], allowHrContent: true });
  assert.deepEqual([...merged.blocked].sort(), ['a', 'b']);
  assert.deepEqual(merged.sensitivePrefixes, ['sn_hr_', 'x_hr_']);
});
