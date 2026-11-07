// A blocked table is never asked for, at the call layer as well: readTableMeta (the UI meta address, one GET besides the Table and
// Aggregate APIs) goes through the same policy guard as every other read (src/content/policyGuard.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyGuard } from '../src/content/policyGuard.js';

const guardFor = (raw) => createPolicyGuard({ getManaged: async () => ({ known: true, raw }) });
const refused = (table) => (e) => e.code === 'BLOCKED_TABLE' && e.table === table;

function metaDeps() {
  const calls = [];
  return { calls, readTableMeta: async (table, columns) => (calls.push([table, columns]), { state: { label: 'State', choices: [{ value: '1', label: 'New' }] } }) };
}

test('readTableMeta of a blocked table is refused before anything is asked', async () => {
  const fake = metaDeps();
  const deps = await guardFor({ blockedTables: ['sn_hr_core_case'] }).deps(fake);
  await assert.rejects(() => deps.readTableMeta('sn_hr_core_case', ['state']), refused('sn_hr_core_case'));
  await assert.rejects(() => deps.readTableMeta('SN_HR_CORE_CASE', ['state']), refused('sn_hr_core_case'));
  assert.deepEqual(fake.calls, [], 'no request was made for a blocked table');
});

test('readTableMeta of another table goes through, with its arguments untouched', async () => {
  const fake = metaDeps();
  const deps = await guardFor({ blockedTables: ['sn_hr_core_case'] }).deps(fake);
  const meta = await deps.readTableMeta('incident', ['state', 'priority']);
  assert.equal(meta.state.label, 'State');
  assert.deepEqual(fake.calls, [['incident', ['state', 'priority']]]);
});

test('with nothing blocked readTableMeta is called as asked; deps without it stay without it', async () => {
  const fake = metaDeps();
  const deps = await guardFor({}).deps(fake);
  await deps.readTableMeta('problem', ['state']);
  assert.deepEqual(fake.calls, [['problem', ['state']]]);
  const plain = await guardFor({ blockedTables: ['task_sla'] }).deps({ queryTable: async () => [] });
  assert.equal(plain.readTableMeta, undefined);
});
