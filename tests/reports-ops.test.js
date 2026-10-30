const test = require('node:test');
const assert = require('node:assert/strict');
import { createReportOps, cleanParams, cleanBlocked } from '../src/content/ops/reports.js';
import { OPS } from '../src/content/ops/index.js';
import { createRuntime } from '../src/reports/engine/index.js';
import { aggregate, ReadOnlyViolation } from '../src/content/tableApi.js';
import { fakeInstance, cell, group, count, USER, GROUP_A } from './reports-fixtures.js';

const session = { userId: USER, firstName: 'Ann', lastName: 'Lee' };
const make = (instance, getSession = async () => session) => createReportOps({ deps: instance.deps, getSession, runtime: createRuntime() });

test('the operations are registered where the content script looks for them', () => {
  ['reportContext', 'reportGroups', 'reportRun', 'reportClear'].forEach((name) => assert.equal(typeof OPS[name], 'function', name));
  assert.ok(Object.isFrozen(OPS));
});

test('who is signed in comes from the page, and a missing user stops every operation', async () => {
  const ops = make(fakeInstance(), async () => null);
  await assert.rejects(() => ops.reportContext({}), /who is signed in/);
  await assert.rejects(() => ops.reportRun({ section: 'overview' }), /who is signed in/);
  await assert.rejects(() => ops.reportGroups({ search: 'desk' }), /who is signed in/);
  const bad = make(fakeInstance(), async () => ({ userId: 'x'.repeat(32) }));
  await assert.rejects(() => bad.reportContext({}), /who is signed in/);
});

test('reportContext: which tables can be read (and why not), my groups, my name', async () => {
  const inst = fakeInstance({ denied: ['problem'], hidden: ['sc_task'], rules: [{ when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] }] });
  const out = await make(inst).reportContext({});
  assert.equal(out.user.name, 'Ann Lee');
  const by = Object.fromEntries(out.tables.map((t) => [t.table, t]));
  assert.equal(by.incident.usable, true);
  assert.equal(by.problem.usable, false);
  assert.equal(by.problem.status, 'denied');
  assert.equal(by.sc_task.status, 'hidden');
  assert.deepEqual(out.groups, [{ id: GROUP_A, name: 'Service Desk' }]);
  assert.equal(out.groupsNote, '');
  assert.ok(out.readAt > 0);
  // plain JSON only
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('reportContext: groups that cannot be read are reported, not guessed', async () => {
  const out = await make(fakeInstance({ denied: ['sys_user_grmember'] })).reportContext({});
  assert.equal(out.groups, null);
  assert.match(out.groupsNote, /not available to you/);
  const none = await make(fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_grmember', then: [] }] })).reportContext({});
  assert.deepEqual(none.groups, []);
  assert.match(none.groupsNote, /not a member/);
});

test('reportContext honours the policy: blocked tables are not probed', async () => {
  const inst = fakeInstance();
  const out = await make(inst).reportContext({ blocked: ['Incident', 'bad name!', 5] });
  assert.equal(out.tables.find((t) => t.table === 'incident').status, 'blocked');
  assert.equal(inst.callsTo('incident').length, 0);
  assert.deepEqual(cleanBlocked(['Incident', 'bad name!', 5, null, 'sc_task']), ['incident', 'sc_task']);
  assert.deepEqual(cleanBlocked('incident'), []);
});

test('reportGroups: needs two letters, searches active groups by name with the text escaped, and returns ids and names only', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_group', then: [{ sys_id: GROUP_A, name: 'Service Desk <b>' }, { sys_id: 'not-an-id', name: 'x' }] }] });
  const ops = make(inst);
  assert.deepEqual((await ops.reportGroups({ search: 'a' })).groups, []);
  assert.match((await ops.reportGroups({ search: ' ' })).note, /two letters/);
  assert.equal(inst.callsTo('sys_user_group').length, 0, 'nothing is read for a short search');
  const out = await ops.reportGroups({ search: 'Service^active=false' });
  assert.deepEqual(out.groups, [{ id: GROUP_A, name: 'Service Desk' }], 'markup in a name is stripped, and the row without a real id is dropped');
  const q = inst.callsTo('sys_user_group')[0].query;
  assert.equal(q, 'nameLIKEService^^active=false^active=true^ORDERBYname', 'the caret was doubled: it stays inside the one condition');
  assert.equal(inst.callsTo('sys_user_group')[0].options.limit, 20);
  const bad = await ops.reportGroups({ search: 'javascript:alert(1)' }).catch((e) => e);
  assert.ok(bad instanceof Error, 'a script-looking search is refused');
});

test('reportGroups: a denied group table is said, not hidden', async () => {
  const out = await make(fakeInstance({ denied: ['sys_user_group'] })).reportGroups({ search: 'desk' });
  assert.deepEqual(out.groups, []);
  assert.match(out.note, /not available to you/);
});

test('reportRun: validates the section, cleans params, and runs the report', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy.length === 0, then: count(3) }] });
  const ops = make(inst);
  await assert.rejects(() => ops.reportRun({ section: 'nope' }), /does not exist/);
  await assert.rejects(() => ops.reportRun({ section: '__proto__' }), /does not exist/);
  const out = await ops.reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'], params: { staleDays: 5, evil: 'x', top: 9999 } });
  assert.equal(out.id, 'overview');
  assert.equal(out.data.staleDays, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON');
  assert.deepEqual(cleanParams({ trend: 'week-8', staleDays: '3', top: 2, junk: 1 }), { trend: 'week-8', staleDays: 3, top: 3 });
  assert.deepEqual(cleanParams({ trend: 'bogus', staleDays: 0 }), { staleDays: 1 });
  assert.deepEqual(cleanParams(null), {});
});

test('reportRun: a builder request is cleaned by the engine; tables outside the list are ignored', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'state', then: [group('state', '2', 'In Progress', 2)] }] });
  const out = await make(inst).reportRun({ kind: 'builder', config: { table: 'sys_user', presets: ['open'], groupBy: 'state' } });
  assert.equal(out.id, 'builder');
  assert.equal(out.data.table, 'incident');
  const sections = await make(fakeInstance()).reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['sys_user', 'incident'] });
  assert.deepEqual(sections.tables.map((t) => t.table), ['incident']);
});

test('reportRun: the policy\'s blocked tables are never read', async () => {
  const inst = fakeInstance();
  const out = await make(inst).reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem'], blocked: ['problem'] });
  assert.equal(out.tables.find((t) => t.table === 'problem').status, 'blocked');
  assert.equal(inst.callsTo('problem').length, 0);
});

test('reportClear empties the cache so the next run reads again', async () => {
  const inst = fakeInstance();
  const ops = make(inst);
  const request = { section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] };
  await ops.reportRun(request);
  const first = inst.calls.length;
  await ops.reportRun(request);
  assert.equal(inst.calls.length, first);
  assert.deepEqual(await ops.reportClear(), { ok: true });
  await ops.reportRun(request);
  assert.ok(inst.calls.length > first);
});

// ---- the one new helper in tableApi.js ----------------------------------------------------------------------------------

function stubBrowser(answer) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, signal: init?.signal });
    return { ok: true, status: 200, headers: { get: () => null }, redirected: false, url: String(url), text: async () => JSON.stringify({ result: answer }) };
  };
  const listeners = [];
  globalThis.document = {
    querySelector: () => null,
    scripts: [],
    getElementById: () => null,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result: 'tokentokentokentokentoken' } }));
      return true;
    },
  };
  return calls;
}

test('aggregate is a GET to the stats endpoint with the asked-for parameters, and nothing else', async () => {
  const calls = stubBrowser([{ stats: { count: '3' }, groupby_fields: [{ field: 'state', value: '2', display_value: 'In Progress' }] }]);
  const controller = new AbortController();
  const result = await aggregate('incident', { query: 'active=true^assigned_to=abc', groupBy: ['assigned_to', 'state'], avgFields: ['reassignment_count'], signal: controller.signal });
  assert.equal(result[0].stats.count, '3');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  const url = new URL(calls[0].url, 'https://x.example');
  assert.equal(url.pathname, '/api/now/stats/incident');
  assert.equal(url.searchParams.get('sysparm_count'), 'true');
  assert.equal(url.searchParams.get('sysparm_group_by'), 'assigned_to,state');
  assert.equal(url.searchParams.get('sysparm_display_value'), 'all');
  assert.equal(url.searchParams.get('sysparm_avg_fields'), 'reassignment_count');
  assert.equal(url.searchParams.get('sysparm_query'), 'active=true^assigned_to=abc');
  assert.equal(calls[0].signal, controller.signal, 'the abort signal reaches the request');
});

test('aggregate without a grouping sends no grouping and returns the stats object', async () => {
  const calls = stubBrowser({ stats: { count: '7' } });
  const result = await aggregate('sc_task', { query: '' });
  assert.equal(result.stats.count, '7');
  const url = new URL(calls[0].url, 'https://x.example');
  assert.equal(url.searchParams.has('sysparm_group_by'), false);
  assert.equal(url.searchParams.has('sysparm_query'), false);
});

test('aggregate refuses column names and table names that are not plain identifiers, before any request', async () => {
  const calls = stubBrowser({ stats: { count: '1' } });
  await assert.rejects(() => aggregate('incident', { groupBy: ['state^ORDERBYname'] }), /valid column/);
  await assert.rejects(() => aggregate('incident', { avgFields: ['a b'] }), /valid column/);
  // A table name becomes part of the address: "a/../b" (or "..") would ask for another path, so it is refused like on every read path.
  await assert.rejects(() => aggregate('a/../b', { query: '' }), /valid table/);
  await assert.rejects(() => aggregate('..', { query: '' }), /valid table/);
  await assert.rejects(() => aggregate('', { query: '' }), /valid table/);
  assert.equal(calls.length, 0);
  await aggregate('incident', { query: '' });
  assert.ok(calls[0].url.includes('/api/now/stats/incident?'));
  assert.ok(ReadOnlyViolation);
});

test('aggregate sends a count-only group filter (sysparm_having) and refuses anything else in it, before any request', async () => {
  const calls = stubBrowser([]);
  await aggregate('incident', { groupBy: ['caller_id'], having: 'count^caller_id^>^2' });
  assert.equal(new URL(calls[0].url, 'https://x.example').searchParams.get('sysparm_having'), 'count^caller_id^>^2');
  for (const bad of ['count^caller_id^>^2^active=false', 'avg^caller_id^>^2', 'count^caller_id^!=^2', 'count^caller_id^>^x', 'count^a b^>^2', 'count^caller_id^>^2\n']) {
    // eslint-disable-next-line no-await-in-loop -- one at a time, so the count below is exact.
    await assert.rejects(() => aggregate('incident', { groupBy: ['caller_id'], having: bad }), /valid group filter/, bad);
  }
  assert.equal(calls.length, 1);
  await aggregate('incident', { groupBy: ['caller_id'] });
  assert.equal(new URL(calls[1].url, 'https://x.example').searchParams.has('sysparm_having'), false);
});
