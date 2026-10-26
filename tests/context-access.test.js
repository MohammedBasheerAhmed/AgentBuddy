import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, classifyReadError, confirmEmptyIsReallyEmpty, softRead } from '../src/context/access.js';
import { accessDeniedError, fakeDeps, sessionExpiredError, v } from './fixtures/sn-fakeDeps.js';

const rows = { task_sla: [{ sys_id: v('s1'), task: v('t1') }], empty_table: [] };

test('classifyReadError: a 403 is denied, a missing table is an error that says so, the rest is an error with the cause', () => {
  assert.deepEqual(classifyReadError(accessDeniedError('task_sla'), 'task_sla'), { status: 'denied', note: 'Your user cannot read task_sla.' });
  assert.equal(classifyReadError(new Error('Your user is not allowed to read this (403).'), 't').status, 'denied');
  assert.equal(classifyReadError(new Error('Invalid table foo'), 'foo').note, 'foo is not on this instance.');
  const other = classifyReadError(new Error('Table API query on "x" failed (500): boom'), 'x');
  assert.equal(other.status, 'error');
  assert.match(other.note, /^Could not read x: Table API query on "x" failed \(500\): boom/);
  assert.equal(classifyReadError(undefined, 'x').status, 'error');
});

test('softRead returns rows, or a failure instead of throwing', async () => {
  const ok = await softRead(fakeDeps(rows), 'task_sla', '', ['sys_id'], { limit: 5 });
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.failure, null);
  const denied = await softRead(fakeDeps(rows, { denied: ['task_sla'] }), 'task_sla', '', [], {});
  assert.deepEqual(denied.rows, []);
  assert.equal(denied.failure.status, 'denied');
});

test('softRead does not swallow a lost session or a cancelled request', async () => {
  await assert.rejects(softRead(fakeDeps(rows, { expired: ['task_sla'] }), 'task_sla', '', []), (err) => err.code === 'SESSION_EXPIRED');
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(softRead(fakeDeps(rows, { errors: { task_sla: abort } }), 'task_sla', '', []), (err) => err.name === 'AbortError');
  assert.equal(sessionExpiredError().code, 'SESSION_EXPIRED');
});

test('confirmEmptyIsReallyEmpty: rows visible -> empty is a fact; nothing visible -> cannot tell', async () => {
  const visible = await confirmEmptyIsReallyEmpty('task_sla', fakeDeps(rows));
  assert.deepEqual(visible, { status: STATUS.EMPTY, note: '' });

  const none = await confirmEmptyIsReallyEmpty('empty_table', fakeDeps(rows));
  assert.equal(none.status, 'empty-or-hidden');
  assert.match(none.note, /Your user sees no rows of empty_table at all/);

  const hidden = await confirmEmptyIsReallyEmpty('task_sla', fakeDeps(rows, { hidden: ['task_sla'] }));
  assert.equal(hidden.status, 'empty-or-hidden');
});

test('confirmEmptyIsReallyEmpty: a refusal is reported as one, and the read is one unfiltered row', async () => {
  const denied = await confirmEmptyIsReallyEmpty('task_sla', fakeDeps(rows, { denied: ['task_sla'] }));
  assert.equal(denied.status, 'denied');
  const deps = fakeDeps(rows);
  await confirmEmptyIsReallyEmpty('task_sla', deps);
  assert.deepEqual(deps.calls.map((c) => [c.table, c.query, c.fields, c.options.limit]), [['task_sla', '', ['sys_id'], 1]]);
});

test('confirmEmptyIsReallyEmpty reads each table once per memo, even for concurrent callers', async () => {
  const deps = fakeDeps(rows);
  const memo = new Map();
  const answers = await Promise.all([
    confirmEmptyIsReallyEmpty('task_sla', deps, memo),
    confirmEmptyIsReallyEmpty('task_sla', deps, memo),
    confirmEmptyIsReallyEmpty('empty_table', deps, memo),
  ]);
  assert.deepEqual(answers.map((a) => a.status), ['empty', 'empty', 'empty-or-hidden']);
  assert.equal(deps.calls.length, 2);
});

test('fakeDeps itself: the query language the other tests rely on', async () => {
  const deps = fakeDeps({
    t: [
      { sys_id: v('a'), n: v('2', 'Two'), ref: v('r1', 'Alpha'), when: v('2026-01-02') },
      { sys_id: v('b'), n: v('1', 'One'), ref: v('r2', 'Beta'), when: v('2026-01-01') },
      { sys_id: v('c'), n: v('3', 'Three'), ref: v('r1', 'Alpha'), when: v('2026-01-03') },
    ],
  });
  const ids = async (query, options) => (await deps.queryTable('t', query, ['sys_id'], options)).map((r) => r.sys_id);
  assert.deepEqual(await ids('ref=r1^ORDERBYDESCwhen'), ['c', 'a']);
  assert.deepEqual(await ids('ref.name=Beta'), ['b']);
  assert.deepEqual(await ids('refLIKEalp'), ['a', 'c']);
  assert.deepEqual(await ids('sys_idINa,b^ORsys_idINc^ORDERBYwhen'), ['b', 'a', 'c']);
  assert.deepEqual(await ids('sys_id!=a^n>=2'), ['c']);
  assert.deepEqual(await ids('nISNOTEMPTY^ORDERBYn', { limit: 2 }), ['b', 'a']);
  assert.deepEqual(await ids('unknown_column=zzz'), ['a', 'b', 'c'], 'a condition on a column nobody has is ignored, like ServiceNow');
  const shown = await deps.queryTable('t', 'sys_id=a', ['n', 'ref'], { displayValue: true });
  assert.deepEqual(shown, [{ n: { value: '2', display_value: 'Two' }, ref: { value: 'r1', display_value: 'Alpha' } }]);
  const plain = await deps.queryTable('t', 'sys_id=a', ['n', 'ref']);
  assert.deepEqual(plain, [{ n: '2', ref: 'r1' }]);
  assert.equal(await deps.fetchRecord('t', 'zzz', ['n']), null);
  assert.equal(await deps.countRecords('t', 'ref=r1'), 2);
});
