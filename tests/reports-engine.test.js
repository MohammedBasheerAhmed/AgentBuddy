const test = require('node:test');
const assert = require('node:assert/strict');
import { createCache, createLimiter } from '../src/reports/engine/cache.js';
import { createReader, attempt, normalizeGroups, ReportError } from '../src/reports/engine/reader.js';
import { normalizeScope, resolveScope } from '../src/reports/engine/scope.js';
import { runReport, createRuntime, resultTables } from '../src/reports/engine/index.js';
import { waitingStates } from '../src/reports/engine/overview.js';
import { foldByOwner } from '../src/reports/engine/workload.js';
import { groupSlaByTicket, rankSlaTickets, tallyBy } from '../src/reports/engine/sla.js';
import { stateClass, topWithOthers, normalizeTables } from '../src/reports/engine/common.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, GROUP_B, NOW } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const slaRow = (task, pct, breached, end = '2026-10-28 09:00:00') => ({ task: cell(task), sla: cell('s', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), planned_end_time: cell(end) });
const taskRow = (n, number, title, who, whoId, grp, grpId, table = 'incident') => ({ sys_id: cell(id(n)), number: cell(number), short_description: cell(title), priority: cell('2', '2 - High'), state: cell('2', 'In Progress'), assigned_to: cell(whoId, who), assignment_group: cell(grpId, grp), sys_class_name: cell(table) });

const run = (request, instance, extra = {}) => runReport(request, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...extra });
const tileOf = (result, key) => result.data.tiles.find((t) => t.key === key);

// ---- plumbing ------------------------------------------------------------------------------------------------------

test('the limiter never runs more than its limit at once, and keeps order', async () => {
  const limiter = createLimiter(2);
  let active = 0;
  let peak = 0;
  const order = [];
  await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(i);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return i;
      })
    )
  );
  assert.equal(peak, 2);
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(limiter.active, 0);
});

test('the limiter passes errors on and keeps going', async () => {
  const limiter = createLimiter(1);
  const bad = limiter.run(async () => {
    throw new Error('nope');
  });
  const good = limiter.run(async () => 'fine');
  await assert.rejects(bad, /nope/);
  assert.equal(await good, 'fine');
});

test('the cache shares in-flight loads, expires after the TTL, forgets failures and clears on demand', async () => {
  let t = 0;
  const cache = createCache({ ttlMs: 60000, now: () => t });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return `v${loads}`;
  };
  const [a, b] = await Promise.all([cache.load('k', loader), cache.load('k', loader)]);
  assert.equal(loads, 1);
  assert.equal(a.value, 'v1');
  assert.equal(b.value, 'v1');
  t = 59999;
  assert.equal((await cache.load('k', loader)).value, 'v1');
  t = 60000;
  assert.equal((await cache.load('k', loader)).value, 'v2');
  await assert.rejects(() => cache.load('bad', async () => { throw new Error('x'); }), /x/);
  assert.equal((await cache.load('bad', async () => 'ok')).value, 'ok');
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal((await cache.load('k', loader)).value, 'v3');
});

test('the cache keeps null and zero answers (a count of 0 is an answer)', async () => {
  const cache = createCache({});
  let n = 0;
  await cache.load('zero', async () => { n += 1; return 0; });
  await cache.load('zero', async () => { n += 1; return 0; });
  await cache.load('nil', async () => { n += 1; return null; });
  await cache.load('nil', async () => { n += 1; return null; });
  assert.equal(n, 2);
});

test('the reader refuses blocked tables, reports denied ones, and never turns a failure into zero', async () => {
  const inst = fakeInstance({ denied: ['problem'] });
  const reader = createReader({ deps: inst.deps, cache: createCache({}), limiter: createLimiter(4), blocked: ['change_request'] });
  await assert.rejects(() => reader.count('change_request', 'active=true'), (e) => e instanceof ReportError && e.code === 'BLOCKED');
  assert.equal(inst.calls.length, 0, 'a blocked table is never even asked');
  const denied = await attempt(() => reader.count('problem', 'active=true'), 'problem');
  assert.deepEqual([denied.ok, denied.status], [false, 'denied']);
  const blocked = await attempt(() => reader.count('change_request', ''), 'change_request');
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(await reader.visibility('change_request'), { status: 'blocked', note: 'Your organisation does not allow reports to read changes.' });
});

test('visibility: readable, denied, and 200-with-nothing (hidden) are told apart', async () => {
  const inst = fakeInstance({ denied: ['problem'], hidden: ['sc_task'] });
  const reader = createReader({ deps: inst.deps, cache: createCache({}), limiter: createLimiter(4) });
  assert.equal((await reader.visibility('incident')).status, 'ok');
  assert.equal((await reader.visibility('problem')).status, 'denied');
  const hidden = await reader.visibility('sc_task');
  assert.equal(hidden.status, 'hidden');
  assert.match(hidden.note, /proves nothing/);
});

test('a session that has expired is thrown, not turned into a note', async () => {
  const deps = { queryTable: async () => { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); }, aggregate: async () => { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); } };
  const reader = createReader({ deps, cache: createCache({}), limiter: createLimiter(4) });
  await assert.rejects(() => attempt(() => reader.count('incident', ''), 'incident'), /expired/);
});

test('pages stop at the cap and say how many there really are', async () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ opened_at: `2026-10-26 10:${String(i % 60).padStart(2, '0')}:00` }));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query', then: (c) => rows(Math.min(c.options.limit, 5000 - c.options.offset)) },
      { when: (c) => c.kind === 'aggregate', then: count(5000) },
    ],
  });
  const reader = createReader({ deps: inst.deps, cache: createCache({}), limiter: createLimiter(4) });
  const capped = await reader.pages('incident', 'x=1', ['opened_at'], { max: 2500, pageSize: 1000 });
  assert.equal(capped.fetched, 2500);
  assert.equal(capped.capped, true);
  assert.equal(capped.total, 5000);
  assert.deepEqual(inst.calls.filter((c) => c.kind === 'query').map((c) => [c.options.offset, c.options.limit]), [[0, 1000], [1000, 1000], [2000, 500]]);

  const whole = await reader.pages('incident', 'x=1', ['opened_at'], { max: 6000, pageSize: 1000 });
  assert.equal(whole.fetched, 5000);
  assert.equal(whole.capped, false);
});

test('a read that outlasts the section time limit is given up on', async () => {
  const deps = { queryTable: () => new Promise(() => {}), aggregate: () => new Promise(() => {}) };
  const controller = new AbortController();
  const reader = createReader({ deps, cache: createCache({}), limiter: createLimiter(4), signal: controller.signal });
  const pending = attempt(() => reader.count('incident', ''), 'incident');
  controller.abort();
  const result = await pending;
  assert.deepEqual([result.ok, result.status], [false, 'timeout']);
  // After the limit, new reads are refused at once.
  const late = await attempt(() => reader.count('incident', 'x'), 'incident');
  assert.equal(late.status, 'timeout');
});

test('normalizeGroups tolerates odd answers', () => {
  assert.equal(normalizeGroups({ stats: { count: '3' } }), null);
  assert.equal(normalizeGroups(undefined), null);
  const g = normalizeGroups([{ stats: { count: '2', avg: { reopen_count: '1.5', bad: 'x' } }, groupby_fields: [{ field: 'state', value: '2', display_value: 'In Progress' }] }, {}]);
  assert.equal(g[0].count, 2);
  assert.deepEqual(g[0].avg, { reopen_count: 1.5 });
  assert.equal(g[0].keys[0].display, 'In Progress');
  assert.equal(g[1].count, 0);
  assert.deepEqual(g[1].keys, []);
});

// ---- scope ---------------------------------------------------------------------------------------------------------

test('a scope from the panel is cleaned: valid ids only, capped, names shortened', () => {
  assert.deepEqual(normalizeScope({ kind: 'bogus' }), { kind: 'mine', groupIds: [], groupNames: {} });
  assert.deepEqual(normalizeScope({ kind: 'groups', groupIds: [GROUP_A] }), { kind: 'groups', groupIds: [], groupNames: {} });
  const chosen = normalizeScope({ kind: 'chosen', groupIds: [GROUP_A, GROUP_A, 'zzz', GROUP_B.toUpperCase()], groupNames: { [GROUP_A]: 'Service  Desk\n', [GROUP_B]: 'x'.repeat(300) } });
  assert.deepEqual(chosen.groupIds, [GROUP_A, GROUP_B]);
  assert.equal(chosen.groupNames[GROUP_A], 'Service Desk');
  assert.equal(chosen.groupNames[GROUP_B].length, 80);
  assert.throws(() => normalizeScope({ kind: 'chosen', groupIds: ['nope'] }), /at least one group/);
  assert.equal(normalizeScope({ kind: 'chosen', groupIds: Array.from({ length: 40 }, (_, i) => id(i + 1)) }).groupIds.length, 25);
});

test('"my groups" reads the membership; when that is not readable it infers the team from my tickets', async () => {
  const members = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }, { group: cell(GROUP_B, 'Network') }, { group: cell(GROUP_A, 'Service Desk') }] }] });
  const reader = createReader({ deps: members.deps, cache: createCache({}), limiter: createLimiter(4) });
  const scope = await resolveScope({ kind: 'groups' }, { reader, userId: USER, tables: ['incident'] });
  assert.equal(scope.label, 'My groups (2)');
  assert.equal(scope.query, `assignment_groupIN${GROUP_A},${GROUP_B}`);
  assert.equal(scope.taskQuery, `task.assignment_groupIN${GROUP_A},${GROUP_B}`);
  assert.equal(scope.inferred, false);
  assert.ok(members.callsTo('sys_user_grmember')[0].query.startsWith(`user=${USER}`));

  const denied = fakeInstance({ denied: ['sys_user_grmember'], rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'assignment_group', then: [group('assignment_group', GROUP_A, 'Service Desk', 4)] }] });
  const r2 = createReader({ deps: denied.deps, cache: createCache({}), limiter: createLimiter(4) });
  const inferred = await resolveScope({ kind: 'groups' }, { reader: r2, userId: USER, tables: ['incident'] });
  assert.equal(inferred.inferred, true);
  assert.equal(inferred.query, `assignment_groupIN${GROUP_A}`);
  assert.match(inferred.note, /not visible to you/);

  const none = fakeInstance({ denied: ['sys_user_grmember'] });
  const r3 = createReader({ deps: none.deps, cache: createCache({}), limiter: createLimiter(4) });
  const empty = await resolveScope({ kind: 'groups' }, { reader: r3, userId: USER, tables: ['incident'] });
  assert.equal(empty.empty, true);
  assert.equal(empty.query, '', 'an empty scope has no query: sections must not run with it');
});

test('"mine" needs a real user id', async () => {
  const reader = createReader({ deps: fakeInstance().deps, cache: createCache({}), limiter: createLimiter(4) });
  await assert.rejects(() => resolveScope({ kind: 'mine' }, { reader, userId: '' }), /who is signed in/);
  const mine = await resolveScope({ kind: 'mine' }, { reader, userId: USER });
  assert.equal(mine.query, `assigned_to=${USER}`);
  assert.equal(mine.unassignedMeaningful, false);
});

// ---- small pure pieces -----------------------------------------------------------------------------------------------

test('states are classed by what their label says', () => {
  const cases = { New: 'new', 'In Progress': 'working', 'Work in Progress': 'working', Open: 'working', 'On Hold': 'waiting', 'Awaiting Caller': 'waiting', 'Awaiting Info': 'waiting', Pending: 'waiting', Resolved: 'resolved', Closed: 'resolved', 'Closed Complete': 'resolved', Cancelled: 'resolved', Assess: 'working', Implement: 'working', '': 'other' };
  Object.entries(cases).forEach(([label, cls]) => assert.equal(stateClass(label), cls, label));
});

test('waiting states come from the labels the instance shows', () => {
  const g = (v, d, n) => ({ count: n, avg: {}, keys: [{ field: 'state', value: v, display: d }] });
  const w = waitingStates([g('1', 'New', 5), g('3', 'On Hold', 2), g('18', 'Awaiting Info', 4), g('2', 'In Progress', 9)]);
  assert.equal(w.count, 6);
  assert.deepEqual(w.values, ['3', '18']);
  assert.deepEqual(w.labels, ['On Hold', 'Awaiting Info']);
  assert.equal(waitingStates([]).count, 0);
});

test('workload rows fold several tables into one row per person', () => {
  const g = (who, whoId, state, n) => ({ count: n, avg: {}, keys: [{ field: 'assigned_to', value: whoId, display: who }, { field: 'state', value: '', display: state }] });
  const rows = foldByOwner(
    [
      { table: 'incident', groups: [g('Ann Lee', 'a1', 'In Progress', 4), g('Ann Lee', 'a1', 'On Hold', 1), g('Bo Ray', 'b1', 'New', 2), g('', '', 'New', 7)] },
      { table: 'sc_task', groups: [g('Ann Lee', 'a1', 'Open', 3)] },
    ],
    '(unassigned)'
  );
  const ann = rows.find((r) => r.id === 'a1');
  assert.equal(ann.count, 8);
  assert.deepEqual(rows.map((r) => r.name), ['Ann Lee', '(unassigned)', 'Bo Ray'], 'busiest first, the unowned work is its own row');
  assert.equal(rows[1].count, 7);
  assert.deepEqual(ann.classes, { new: 0, working: 7, waiting: 1, resolved: 0, other: 0 });
  assert.deepEqual(ann.byTable, { incident: 5, sc_task: 3 });
});

test('top lists keep the biggest and sum the rest', () => {
  const list = Array.from({ length: 5 }, (_, i) => ({ key: String(i), name: `P${i}`, count: 10 - i }));
  const top = topWithOthers(list, 3, 'Other people');
  assert.equal(top.length, 4);
  assert.equal(top[3].count, 7 + 6);
  assert.equal(top[3].name, 'Other people (2)');
  assert.equal(topWithOthers(list, 5).length, 5);
});

test('SLA rows collapse to one entry per ticket, breached first, then fullest, then soonest', () => {
  const tickets = groupSlaByTicket(
    [slaRow(id(1), 130, true), slaRow(id(2), 82, false), slaRow(id(3), 30, false, '2026-10-27 13:30:00'), slaRow(id(4), 40, false), slaRow(id(4), 90, false), slaRow(id(5), 10, false), slaRow('junk', 99, true)],
    { now: NOW }
  );
  // id(5) (10 % used, due tomorrow) is not at issue: it is left out, as are rows without a real ticket id.
  assert.equal(tickets.length, 4, 'rows without a real ticket id, and tickets that are not at issue, are skipped');
  const by = Object.fromEntries(tickets.map((t) => [t.sysId, t]));
  assert.equal(by[id(1)].breached, true);
  assert.equal(by[id(2)].atRisk, true);
  assert.equal(by[id(3)].dueSoon, true);
  assert.equal(by[id(3)].atRisk, false);
  assert.equal(by[id(4)].sla.percentage, 90, 'the worst SLA of the ticket');
  assert.equal(by[id(5)], undefined);
  assert.deepEqual(rankSlaTickets(tickets).map((t) => t.sysId), [id(1), id(4), id(2), id(3)]);
  assert.deepEqual(groupSlaByTicket([], { now: NOW }), []);
});

test('SLA tallies count each ticket once per owner', () => {
  const t = (owner, ownerId, breached, atRisk, dueSoon) => ({ owner, ownerId, breached, atRisk, dueSoon });
  const out = tallyBy([t('Ann', 'a', true, false, false), t('Ann', 'a', false, true, true), t('', '', false, true, false)], 'ownerId', 'owner', '(unassigned)');
  assert.deepEqual(out.map((r) => [r.name, r.breached, r.atRisk, r.dueSoon, r.count]), [['Ann', 1, 1, 1, 2], ['(unassigned)', 0, 1, 0, 1]]);
});

test('table lists are cleaned', () => {
  assert.equal(normalizeTables(['incident', 'incident', 'bogus', 'problem']).length, 2);
  // Every table but the HR ones (sensitive): those only for the HR profile with the organisation's approval (allowSensitive).
  assert.equal(normalizeTables([]).length, 11);
  assert.equal(normalizeTables(undefined).includes('sn_hr_core_case'), false);
  assert.deepEqual(normalizeTables(['sn_hr_core_case']), normalizeTables([]), 'asked for without approval: dropped');
  assert.deepEqual(normalizeTables(['sn_hr_core_case'], { allowSensitive: true }), ['sn_hr_core_case']);
  assert.equal(normalizeTables([], { allowSensitive: true }).length, 13);
  assert.ok(normalizeTables([]).includes('change_task'));
  // (audit of 2026-11-07, F20: the requests and the tasks of a case, an incident and a problem are ticket types too; the HR tasks need approval like the HR cases)
  for (const table of ['sc_request', 'sn_customerservice_task', 'incident_task', 'problem_task']) assert.ok(normalizeTables([]).includes(table), table);
  assert.ok(!normalizeTables([]).includes('sn_hr_core_task'));
  assert.ok(normalizeTables(['sn_hr_core_task'], { allowSensitive: true }).includes('sn_hr_core_task'));
});

// ---- Overview ------------------------------------------------------------------------------------------------------

const MINE = `assigned_to=${USER}`;
const overviewRules = () => [
  { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.groupBy[0] === 'state', then: [group('state', '1', 'New', 2), group('state', '3', 'On Hold', 3), group('state', '2', 'In Progress', 2)] },
  { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query === `${MINE}^active=true`, then: count(7) },
  { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query.includes('sys_updated_on<'), then: count(2) },
  { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query === `${MINE}^opened_at>=2026-10-27 00:00:00`, then: count(1) },
  { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query === `${MINE}^resolved_at>=2026-10-27 00:00:00`, then: count(2) },
  { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(12) },
  { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [slaRow(id(1), 130, true), slaRow(id(2), 82, false), slaRow(id(3), 30, false, '2026-10-27 13:30:00'), slaRow(id(4), 40, false), slaRow(id(4), 90, false)] },
  { when: (c) => c.kind === 'query' && c.table === 'task', then: [taskRow(1, 'INC1', 'Printer', 'Ann Lee', 'a1', 'Service Desk', GROUP_A)] },
];

test('overview (mine): every tile is a real number from the right query', async () => {
  const inst = fakeInstance({ rules: overviewRules() });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.id, 'overview');
  assert.equal(tileOf(result, 'open').value, 7);
  assert.equal(tileOf(result, 'stale').value, 2);
  assert.equal(tileOf(result, 'waiting').value, 3);
  assert.equal(tileOf(result, 'openedToday').value, 1);
  assert.equal(tileOf(result, 'resolvedToday').value, 2);
  assert.equal(tileOf(result, 'breached').value, 1);
  assert.equal(tileOf(result, 'dueSoon').value, 1);
  assert.equal(tileOf(result, 'unassigned'), undefined, '"unassigned" means nothing for my own tickets');
  assert.deepEqual(tileOf(result, 'waiting').hint, 'States: On Hold');
  assert.equal(result.data.tiles.every((t) => !t.unavailable), true);
  assert.equal(result.generatedAt, NOW);
  assert.ok(result.readAt > 0);
  // The drill-down of a tile is a query for exactly what it counts.
  assert.deepEqual(tileOf(result, 'open').drills.map((d) => [d.table, d.count, d.query]), [['incident', 7, `${MINE}^active=true`]]);
  assert.equal(tileOf(result, 'waiting').drills[0].query, `${MINE}^active=true^stateIN3`);
  assert.match(tileOf(result, 'breached').drills[0].query, /^active=true\^task\.sys_class_nameINincident\^task\.assigned_to=.+\^has_breached=true$/);
});

test('overview (my groups): unassigned appears and the group query is used', async () => {
  const q = `assignment_groupIN${GROUP_A}`;
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query === `${q}^active=true^assigned_toISEMPTY`, then: count(4) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.query === `${q}^active=true`, then: count(30) },
    ],
  });
  const result = await run({ section: 'overview', scope: { kind: 'groups' }, tables: ['incident'] }, inst);
  assert.equal(tileOf(result, 'open').value, 30);
  assert.equal(tileOf(result, 'unassigned').value, 4);
  assert.equal(result.scope.label, 'My groups (1)');
  assert.deepEqual(result.scope.groups, [{ id: GROUP_A, name: 'Service Desk' }]);
});

test('overview: a denied or hidden table is named and left out, never counted as zero', async () => {
  const inst = fakeInstance({ denied: ['problem'], hidden: ['sc_task'], rules: overviewRules() });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem', 'sc_task'] }, inst);
  const status = Object.fromEntries(result.tables.map((t) => [t.table, t.status]));
  assert.deepEqual(status, { incident: 'ok', problem: 'denied', sc_task: 'hidden' });
  assert.match(result.tables.find((t) => t.table === 'problem').note, /not available to you/);
  assert.match(result.tables.find((t) => t.table === 'sc_task').note, /prove nothing/);
  assert.deepEqual(result.data.perTable.map((r) => r.table), ['incident']);
  assert.equal(tileOf(result, 'open').value, 7);
  assert.equal(inst.callsTo('problem', 'active').length, 0, 'no count is asked of a table that cannot be read');
});

test('overview: with no readable table the tiles say "not available", not 0', async () => {
  const inst = fakeInstance({ denied: ['incident', 'problem'] });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem'] }, inst);
  assert.ok(result.data.tiles.length > 0);
  result.data.tiles.forEach((t) => {
    assert.equal(t.unavailable, true, t.key);
    assert.equal(t.value, null, t.key);
  });
});

test('overview: no SLA access makes only the SLA tiles unavailable', async () => {
  const inst = fakeInstance({ denied: ['task_sla'], rules: overviewRules() });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(tileOf(result, 'breached').unavailable, true);
  assert.equal(tileOf(result, 'dueSoon').unavailable, true);
  assert.match(tileOf(result, 'breached').note, /not available to you/);
  assert.equal(tileOf(result, 'open').value, 7);
});

test('overview: one failing count does not hide the others, and is flagged as partial', async () => {
  const inst = fakeInstance({
    rules: [
      ...overviewRules().filter((r) => r.then?.stats?.count !== '2' || true),
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.query.includes('sys_updated_on<'), then: () => { throw new Error('Report failed (500)'); } },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.query === `${MINE}^active=true`, then: count(5) },
    ],
  });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'sc_task'] }, inst);
  assert.equal(tileOf(result, 'open').value, 12);
  assert.equal(tileOf(result, 'stale').value, 2, 'the table that could be counted');
  assert.equal(tileOf(result, 'stale').partial, true);
  assert.match(tileOf(result, 'stale').hint, /could not be counted/);
  assert.ok(result.access.some((a) => a.source === 'sc_task'));
});

test('overview: the number of requests in flight never exceeds the limit', async () => {
  const inst = fakeInstance({ rules: overviewRules() });
  await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem', 'sc_task', 'sc_req_item'] }, inst);
  assert.ok(inst.maxInFlight <= 4, `peak ${inst.maxInFlight}`);
  assert.ok(inst.maxInFlight >= 2, 'but it does run in parallel');
});

test('the second dashboard widget reuses what the first one read', async () => {
  const inst = fakeInstance({ rules: overviewRules() });
  const runtime = createRuntime();
  const env = { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 };
  await runReport({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, env);
  const first = inst.calls.length;
  await runReport({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, env);
  assert.equal(inst.calls.length, first, 'identical requests in the same minute are answered from the cache');
  runtime.cache.clear();
  await runReport({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, env);
  assert.equal(inst.calls.length, first * 2, 'Refresh empties the cache');
});

// ---- Empty scope, unknown reports, timeout ---------------------------------------------------------------------------

test('an empty group scope never queries the ticket tables (it would match everything)', async () => {
  const inst = fakeInstance({ denied: ['sys_user_grmember'] });
  const result = await run({ section: 'overview', scope: { kind: 'groups' }, tables: ['incident'] }, inst);
  assert.equal(result.data.available, false);
  assert.equal(result.data.emptyScope, true);
  assert.match(result.data.reason, /memberships are not visible/);
  // The only incident read is the one that looks for my own groups; nothing is counted for the whole table.
  inst.calls.filter((c) => c.kind === 'aggregate' && c.table === 'incident').forEach((c) => assert.ok(c.query.startsWith(`assigned_to=${USER}`), c.query));
});

test('an unknown section is refused', async () => {
  await assert.rejects(() => run({ section: 'secrets' }, fakeInstance()), /does not exist/);
  await assert.rejects(() => run({ section: '__proto__' }, fakeInstance()), /does not exist/);
  await assert.rejects(() => run({ section: 'toString' }, fakeInstance()), /does not exist/);
});

test('a lost session aborts the report with the session error', async () => {
  const deps = { queryTable: async () => { throw Object.assign(new Error('Your ServiceNow session has expired.'), { code: 'SESSION_EXPIRED' }); }, aggregate: async () => { throw Object.assign(new Error('Your ServiceNow session has expired.'), { code: 'SESSION_EXPIRED' }); } };
  await assert.rejects(() => runReport({ section: 'overview', scope: { kind: 'mine' } }, { deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 }), (e) => e.code === 'SESSION_EXPIRED');
});

test('a section that cannot finish in time returns what it has, with a note, and stops asking', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.groupBy.length === 0, then: () => new Promise(() => {}) }] });
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst, { timeoutMs: 40 });
  assert.match(result.notes.join(' '), /took too long/);
  assert.equal(tileOf(result, 'open').unavailable, true, 'a number that timed out is missing, not zero');
});

// ---- Workload ------------------------------------------------------------------------------------------------------

test('workload: people, groups, ageing, stale, unassigned and reassignment ping-pong', async () => {
  const q = `assignment_groupIN${GROUP_A}`;
  const open = `${q}^active=true`;
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: [group2('assigned_to', 'a1', 'Ann Lee', 'state', '2', 'In Progress', 5), group2('assigned_to', 'a1', 'Ann Lee', 'state', '3', 'On Hold', 1), group2('assigned_to', 'b1', 'Bo Ray', 'state', '1', 'New', 2), group2('assigned_to', '', '', 'state', '1', 'New', 3)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assignment_group,state', then: [group2('assignment_group', GROUP_A, 'Service Desk', 'state', '2', 'In Progress', 11)] },
      { when: (c) => c.kind === 'aggregate' && c.query === open, then: count(11) },
      { when: (c) => c.kind === 'aggregate' && c.query === `${open}^assigned_toISEMPTY`, then: count(3) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('sys_updated_on<'), then: count(4) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>2026-10-25 12:00:00'), then: count(3) }, // < 2 days
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>2026-10-23 12:00:00'), then: count(5) }, // < 4 days
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>2026-10-19 12:00:00'), then: count(6) }, // < 8 days
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>2026-10-12 12:00:00'), then: count(9) }, // < 15 days
      { when: (c) => c.kind === 'aggregate' && c.query.includes('reassignment_count>=3'), then: count(2) },
      { when: (c) => c.kind === 'query' && c.query.includes('reassignment_count>=3'), then: [{ sys_id: cell(id(1)), number: cell('INC1'), short_description: cell('Wi-Fi'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), reassignment_count: cell('6') }] },
    ],
  });
  const result = await run({ section: 'workload', scope: { kind: 'groups' }, tables: ['incident'] }, inst);
  const d = result.data;
  assert.equal(d.totals.open, 11);
  assert.equal(d.totals.unassigned, 3);
  assert.equal(d.totals.stale, 4);
  assert.deepEqual(d.ageing.buckets.map((b) => b.count), [3, 2, 1, 3, 2]);
  assert.equal(d.ageing.buckets.reduce((n, b) => n + b.count, 0), 11);
  assert.equal(d.byAssignee[0].name, 'Ann Lee');
  assert.deepEqual(d.byAssignee[0].classes, { new: 0, working: 5, waiting: 1, resolved: 0, other: 0 });
  assert.equal(d.byGroup[0].name, 'Service Desk');
  assert.equal(d.pingPong.available, true);
  assert.equal(d.pingPong.count, 2);
  assert.equal(d.pingPong.items[0].reassignments, 6);
  assert.ok(resultTables(result).length >= 3);
});

test('workload: without a reassignment column the hand-off part is absent and says so', async () => {
  const inst = fakeInstance({
    missingColumns: ['reassignment_count'],
    rules: [{ when: (c) => c.kind === 'aggregate' && c.query === `assigned_to=${USER}^active=true`, then: count(3) }],
  });
  const result = await run({ section: 'workload', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.data.pingPong.available, false);
  assert.match(result.notes.join(' '), /Reassignment counts are not available/);
  assert.equal(inst.calls.filter((c) => c.query.includes('reassignment_count>=')).length, 0, 'a missing column is not queried');
  assert.deepEqual(result.data.byAssignee, [], 'no per-person board for my own tickets');
});

// ---- SLA radar -----------------------------------------------------------------------------------------------------

test('SLA radar: counts, the ten closest to breaking, and who owns the risk', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(40) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [slaRow(id(1), 130, true), slaRow(id(2), 82, false), slaRow(id(3), 30, false, '2026-10-27 13:30:00'), slaRow(id(4), 90, false)] },
      {
        when: (c) => c.kind === 'query' && c.table === 'task',
        then: [taskRow(1, 'INC1', 'Printer', 'Ann Lee', 'a1', 'Service Desk', GROUP_A), taskRow(2, 'INC2', 'VPN', 'Ann Lee', 'a1', 'Service Desk', GROUP_A), taskRow(3, 'INC3', 'Mail', 'Bo Ray', 'b1', 'Network', GROUP_B), taskRow(4, 'RITM4', 'Laptop', '', '', 'Service Desk', GROUP_A, 'sc_req_item')],
      },
    ],
  });
  const result = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident', 'sc_req_item'] }, inst);
  const d = result.data;
  assert.deepEqual(d.counts, { breached: 1, atRisk: 2, dueSoon: 1 });
  assert.equal(d.activeSlas, 40);
  assert.deepEqual(d.top.map((t) => t.number), ['INC1', 'RITM4', 'INC2', 'INC3']);
  assert.equal(d.top[0].risk, 'breached');
  assert.equal(d.top[1].table, 'sc_req_item');
  const ann = d.byOwner.find((r) => r.name === 'Ann Lee');
  assert.deepEqual([ann.breached, ann.atRisk], [1, 1]);
  assert.ok(d.byOwner.some((r) => r.name === '(unassigned)'));
  assert.equal(d.byGroup.find((r) => r.name === 'Service Desk').count, 3);
  // Both tables are in the class filter; the scope is dot-walked through the task.
  const q = inst.calls.find((c) => c.kind === 'query' && c.table === 'task_sla').query;
  // The business percentage decides (an SLA on working hours); the plain one is asked for too, for rows without a business figure.
  assert.match(q, new RegExp(`^active=true\\^task\\.sys_class_nameINincident,sc_req_item\\^task\\.assigned_to=${USER}\\^has_breached=true\\^ORbusiness_percentage>=75\\^ORpercentage>=75\\^ORplanned_end_time<=2026-10-27 16:00:00\\^ORDERBYDESChas_breached\\^ORDERBYDESCpercentage$`));
  assert.ok(inst.calls.find((c) => c.kind === 'query' && c.table === 'task_sla').fields.includes('business_percentage'));
  assert.equal(resultTables(result)[0].rows.length, 4);
});

test('SLA radar: no SLA access, or no ticket details, degrades with a plain note', async () => {
  const none = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident'] }, fakeInstance({ denied: ['task_sla'] }));
  assert.equal(none.data.available, false);
  assert.match(none.data.reason, /not available to you/);

  const noTask = fakeInstance({
    denied: ['task'],
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(5) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [slaRow(id(1), 130, true)] },
    ],
  });
  const partial = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident'] }, noTask);
  assert.equal(partial.data.available, true);
  assert.equal(partial.data.counts.breached, 1);
  assert.equal(partial.data.detailsMissing, true);
  assert.deepEqual(partial.data.top, []);
  assert.ok(partial.access.some((a) => a.source === 'task'));
});

test('SLA radar: a capped read is reported with the real total', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => slaRow(id(i + 1), 90, false));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(1500) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: (c) => many.slice(c.options.offset, c.options.offset + c.options.limit) },
      { when: (c) => c.kind === 'query' && c.table === 'task', then: [] },
    ],
  });
  const result = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.caps.length, 1);
  assert.equal(result.caps[0].fetched, 1000);
  assert.equal(result.caps[0].total, 1500);
  assert.match(result.caps[0].note, /first 1000 of 1500/);
});

// ---- Quality and trend -----------------------------------------------------------------------------------------------

test('quality: trend, backlog, time to resolve, reopen rate, reassignments, categories and repeat callers', async () => {
  const day = (d, h) => `2026-10-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:00:00`;
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'query' && c.table === 'incident' && c.fields.join() === 'opened_at', then: [{ opened_at: day(27, 9) }, { opened_at: day(27, 8) }, { opened_at: day(26, 15) }, { opened_at: day(25, 10) }] },
      { when: (c) => c.kind === 'query' && c.table === 'incident' && c.fields.join() === 'resolved_at,opened_at', then: [{ resolved_at: day(27, 10), opened_at: day(27, 8) }, { resolved_at: day(26, 18), opened_at: day(26, 12) }] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'category', then: [group('category', 'network', 'Network', 3), group('category', 'hardware', 'Hardware', 1)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'cmdb_ci', then: [group('cmdb_ci', 'ci1', 'mail-01', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'caller_id', then: [group('caller_id', 'u1', 'Cy Doe', 4), group('caller_id', 'u2', 'Di Fox', 1), group('caller_id', 'u3', 'Ed Roe', 3)] },
      { when: (c) => c.kind === 'aggregate' && c.avgFields.length, then: { stats: { count: '4', avg: { reassignment_count: '1.5' } } } },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('reopen_count>0'), then: count(1) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('reassignment_count>=3'), then: count(1) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>=2026-10-14 00:00:00'), then: count(4) }, // opened in the 14-day window
      { when: (c) => c.kind === 'aggregate' && c.query.endsWith('active=true'), then: count(10) },
    ],
  });
  const result = await run({ section: 'quality', scope: { kind: 'groups' }, tables: ['incident'], params: { trend: 'day-14' } }, inst);
  const d = result.data;
  assert.equal(d.trend.labels.length, 14);
  assert.deepEqual(d.trend.labels.slice(-3), ['Oct 25', 'Oct 26', 'Oct 27']);
  assert.deepEqual(d.trend.opened.slice(-3), [1, 1, 2]);
  assert.deepEqual(d.trend.resolved.slice(-3), [0, 1, 1]);
  assert.equal(d.trend.opened.reduce((a, b) => a + b, 0), 4);
  assert.ok(d.trend.backlog, 'estimated backlog is shown when the reads were complete');
  assert.equal(d.trend.backlog[13], 10, 'the last day is the open count now');
  assert.equal(d.trend.backlog[12], 9, 'before today: 10 - 2 opened + 1 resolved');
  assert.equal(d.mttr.sample, 2);
  assert.equal(d.mttr.meanHours, 4);
  assert.equal(d.mttr.medianHours, 4);
  assert.equal(d.reopen.reopened, 1);
  assert.equal(d.reopen.percent, 25);
  assert.equal(d.reassign.average, 1.5);
  assert.equal(d.reassign.multi, 1);
  assert.deepEqual(d.categories.map((c) => [c.name, c.count]), [['Network', 3], ['Hardware', 1]]);
  assert.deepEqual(d.cis.map((c) => c.name), ['mail-01']);
  assert.deepEqual(d.repeatCallers.items.map((c) => [c.name, c.count]), [['Cy Doe', 4], ['Ed Roe', 3]]);
  assert.equal(d.repeatCallers.total, 2);
  assert.equal(d.repeatCallers.min, 3);
  assert.ok(resultTables(result).some((t) => t.title.startsWith('Callers with 3+')));
});

test('quality: only the date column is read for the trend, newest first, in pages of at most 1000', async () => {
  const inst = fakeInstance();
  await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  const date = inst.calls.filter((c) => c.kind === 'query' && c.table === 'incident' && c.query !== '');
  assert.ok(date.length >= 2);
  date.forEach((c) => {
    assert.ok(c.options.limit <= 1000);
    assert.match(c.query, /ORDERBYDESC(opened_at|resolved_at)$/);
    assert.ok(c.fields.length <= 2);
  });
});

test('quality: a read cut at the cap says so and marks the oldest buckets partial; no backlog is invented', async () => {
  const rows = Array.from({ length: 3000 }, () => ({ opened_at: '2026-10-27 09:00:00' }));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query' && c.fields.join() === 'opened_at', then: (c) => rows.slice(c.options.offset, c.options.offset + c.options.limit) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>=') && !c.groupBy.length && !c.avgFields.length, then: count(4210) },
      { when: (c) => c.kind === 'aggregate' && c.query.endsWith('active=true'), then: count(100) },
    ],
  });
  const result = await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'], params: { trend: 'day-14' } }, inst);
  assert.equal(result.caps.length, 1);
  assert.match(result.caps[0].note, /first 3000 of 4210/);
  assert.equal(result.data.trend.partial[0], true);
  assert.equal(result.data.trend.backlog, null);
  assert.match(result.notes.join(' '), /backlog trend is not shown/);
});

test('quality: columns the table does not have are left out instead of guessed', async () => {
  const inst = fakeInstance({ missingColumns: ['reopen_count', 'reassignment_count', 'category', 'cmdb_ci', 'caller_id', 'resolved_at', 'closed_at'] });
  const result = await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  const d = result.data;
  assert.equal(d.reopen, null);
  assert.equal(d.reassign, null);
  assert.equal(d.repeatCallers, null);
  assert.deepEqual(d.categories, []);
  assert.equal(d.trend.resolved, null);
  assert.equal(d.mttr, null);
  assert.equal(inst.calls.filter((c) => /reopen_count|caller_id/.test(`${c.query}${c.groupBy}`)).length, 0);
});

// ---- Request fulfilment ----------------------------------------------------------------------------------------------

test('fulfilment: states, approvals and the oldest open items', async () => {
  const item = (n, number, opened, table) => ({ sys_id: cell(id(n)), number: cell(number), short_description: cell(`Item ${number}`), state: cell('2', 'Work in Progress'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), opened_at: cell(opened), sys_class_name: cell(table) });
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_req_item' && c.groupBy[0] === 'state', then: [group('state', '2', 'Work in Progress', 6), group('state', '-5', 'Pending', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.groupBy[0] === 'state', then: [group('state', '1', 'Open', 4)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_req_item', then: count(8) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task', then: count(4) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sysapproval_approver' && c.query.startsWith('approver='), then: count(3) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sysapproval_approver', then: count(5) },
      { when: (c) => c.kind === 'query' && c.table === 'sc_req_item' && c.query.includes('ORDERBYopened_at'), then: [item(1, 'RITM1', '2026-10-01 08:00:00', 'sc_req_item'), item(2, 'RITM2', '2026-10-20 08:00:00', 'sc_req_item')] },
      { when: (c) => c.kind === 'query' && c.table === 'sc_task' && c.query.includes('ORDERBYopened_at'), then: [item(3, 'SCTASK3', '2026-10-10 08:00:00', 'sc_task')] },
    ],
  });
  const result = await run({ section: 'fulfilment', scope: { kind: 'groups' }, tables: ['incident', 'sc_req_item', 'sc_task'] }, inst);
  const d = result.data;
  assert.equal(d.available, true);
  assert.equal(d.open, 12);
  assert.deepEqual(d.byTable.map((t) => [t.table, t.open]), [['sc_req_item', 8], ['sc_task', 4]]);
  assert.equal(d.byTable[0].states[0].name, 'Work in Progress');
  assert.equal(d.byTable[0].states[1].cls, 'waiting');
  assert.equal(d.approvals.mine, 3);
  assert.equal(d.approvals.team, 5);
  assert.deepEqual(d.oldest.map((o) => [o.number, o.ageDays]), [['RITM1', 26], ['SCTASK3', 17], ['RITM2', 7]]);
  assert.match(inst.calls.find((c) => c.table === 'sysapproval_approver' && !c.query.startsWith('approver=')).query, /^state=requested\^sysapproval\.sys_class_name=sc_req_item\^sysapproval\.assignment_groupIN/);
  assert.ok(resultTables(result).length >= 3);
});

test('fulfilment: without those tables there is a hint, and no approvals are read', async () => {
  const inst = fakeInstance();
  const result = await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.data.available, false);
  assert.match(result.data.reason, /Requested items or Catalog tasks/);
  assert.equal(inst.callsTo('sysapproval_approver').length, 0);
});
