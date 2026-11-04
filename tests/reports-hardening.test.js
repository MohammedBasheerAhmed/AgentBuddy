// Pins for the correctness review of the reports engine (cache, reader, time zones, SLA math, "you cannot see this" is not zero,
// one "now" per dashboard load, and the read boundary). Each test failed before its fix.
const test = require('node:test');
const assert = require('node:assert/strict');
import { createCache, createLimiter } from '../src/reports/engine/cache.js';
import { createReader, attempt } from '../src/reports/engine/reader.js';
import { runReport, createRuntime, asOfFor, AS_OF_MAX_AGE_MS } from '../src/reports/engine/index.js';
import { startOfLocalDay, startOfLocalWeek, bucketStarts, bucketLabels, dayLabel, offsetAt } from '../src/reports/engine/time.js';
import { groupSlaByTicket, worryingQuery } from '../src/reports/engine/sla.js';
import { slaPercent, worstSla, riskOf, isPaused, readMyDay } from '../src/reports/myDay.js';
import { createReportOps, cleanParams, readsFor } from '../src/content/ops/reports.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { fakeInstance, cell, count, group, USER, GROUP_A, NOW, DAY, HOUR } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const run = (request, instance, extra = {}) => runReport(request, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...extra });
const tileOf = (result, key) => result.data.tiles.find((t) => t.key === key);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

// ---- the cache -----------------------------------------------------------------------------------------------------

test('cache: a load that was on its way when Refresh cleared the cache answers its caller but is not stored', async () => {
  const cache = createCache({});
  const slow = deferred();
  const first = cache.load('k', () => slow.promise);
  cache.clear(); // the person pressed Refresh while the old read was still running
  slow.resolve('old');
  assert.equal((await first).value, 'old', 'the caller that asked still gets its answer');
  let loads = 0;
  const fresh = await cache.load('k', async () => {
    loads += 1;
    return 'new';
  });
  assert.equal(loads, 1, 'after the refresh the number is read again');
  assert.equal(fresh.value, 'new');
});

test('cache: an old load that fails after a refresh does not throw away the new entry', async () => {
  const cache = createCache({});
  const slow = deferred();
  const first = cache.load('k', () => slow.promise);
  cache.clear();
  const second = cache.load('k', async () => 'new');
  slow.reject(new Error('late failure'));
  await assert.rejects(first, /late failure/);
  assert.equal((await second).value, 'new');
  let loads = 0;
  await cache.load('k', async () => {
    loads += 1;
    return 'again';
  });
  assert.equal(loads, 0, 'the new entry is still there');
});

// ---- the reader ------------------------------------------------------------------------------------------------------

test('reader: a request shared with a section that ran out of time is asked again for the section that did not', async () => {
  const cache = createCache({});
  const limiter = createLimiter(4);
  let calls = 0;
  const deps = {
    queryTable: async () => [],
    aggregate: (table, { signal }) => {
      calls += 1;
      if (calls === 1) {
        // The first request hangs until ITS section gives up.
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      }
      return Promise.resolve(count(7));
    },
  };
  const a = new AbortController();
  const b = new AbortController();
  const readerA = createReader({ deps, cache, limiter, signal: a.signal });
  const readerB = createReader({ deps, cache, limiter, signal: b.signal });
  const fromA = attempt(() => readerA.count('incident', 'active=true'), 'incident');
  await new Promise((resolve) => setImmediate(resolve));
  const fromB = attempt(() => readerB.count('incident', 'active=true'), 'incident'); // shares A's request
  await new Promise((resolve) => setImmediate(resolve));
  a.abort(); // section A's time limit
  assert.deepEqual(await fromA, { ok: false, status: 'timeout', note: 'It took too long to read.' });
  assert.deepEqual(await fromB, { ok: true, value: 7 }, 'B is not given A\'s timeout');
  assert.equal(calls, 2);
});

test('reader: a passing failure of the "can you see this table" read is not remembered; a denial is', async () => {
  let n = 0;
  const deps = {
    aggregate: async () => count(0),
    queryTable: async (table) => {
      n += 1;
      if (table === 'problem') throw Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' });
      if (n === 1) throw new Error('Table API query on "incident" failed (500)');
      return [{ sys_id: 'x' }];
    },
  };
  const reader = createReader({ deps, cache: createCache({}), limiter: createLimiter(2) });
  assert.equal((await reader.visibility('incident')).status, 'error');
  assert.equal((await reader.visibility('incident')).status, 'ok', 'asked again, not "could not be read" for a minute');
  assert.equal((await reader.visibility('problem')).status, 'denied');
  const before = n;
  assert.equal((await reader.visibility('problem')).status, 'denied');
  assert.equal(n, before, 'a denial is a stable answer and is kept');
});

test('reader: the content script\'s own policy check is asked before the cache', async () => {
  const inst = fakeInstance();
  const cache = createCache({});
  const limiter = createLimiter(2);
  let blockedNow = false;
  const open = createReader({ deps: inst.deps, cache, limiter, prefix: USER });
  await open.count('incident', 'active=true');
  const guarded = createReader({ deps: inst.deps, cache, limiter, prefix: USER, isBlocked: (t) => blockedNow && t === 'incident' });
  blockedNow = true;
  const r = await attempt(() => guarded.count('incident', 'active=true'), 'incident');
  assert.equal(r.status, 'blocked', 'a number cached before the table was blocked is not handed out');
  assert.equal((await guarded.visibility('incident')).status, 'blocked');
  const broken = createReader({ deps: inst.deps, cache, limiter, isBlocked: () => { throw new Error('policy unavailable'); } });
  assert.equal((await attempt(() => broken.count('problem', ''), 'problem')).status, 'blocked', 'a policy that cannot answer is not a yes');
});

test('reader: a breakdown can ask the instance for the big groups only (sysparm_having), and still filters itself', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate', then: [group('caller_id', 'c1', 'Ann', 5)] }] });
  const reader = createReader({ deps: inst.deps, cache: createCache({}), limiter: createLimiter(2) });
  await reader.groups('incident', 'active=true', ['caller_id'], { minCount: 3 });
  await reader.groups('incident', 'active=true', ['caller_id']);
  assert.equal(inst.calls[0].options.having, 'count^caller_id^>^2');
  assert.equal(inst.calls[1].options.having, undefined, 'a plain breakdown is a different question (and cache entry)');
});

// ---- time zones --------------------------------------------------------------------------------------------------------

// A zone with summer time (as London): UTC+1 (offset -60) until 01:00 UTC on 25 Oct 2026, UTC (0) after; again from 29 Mar 2026.
const london = (ms) => (ms >= Date.UTC(2026, 2, 29, 1) && ms < Date.UTC(2026, 9, 25, 1) ? -60 : 0);

test('time: "today" starts at the local midnight that really happened on the day the clocks go back', () => {
  const noon = Date.UTC(2026, 9, 25, 12);
  assert.equal(new Date(startOfLocalDay(noon, london)).toISOString(), '2026-10-24T23:00:00.000Z', 'midnight was still summer time');
  // A fixed offset (the old way, the offset of "now") began the day an hour late and missed the first hour of tickets.
  assert.equal(new Date(startOfLocalDay(noon, 0)).toISOString(), '2026-10-25T00:00:00.000Z');
});

test('time: on the day the clocks go forward, "today" does not count an hour of yesterday', () => {
  const noon = Date.UTC(2026, 2, 29, 12);
  assert.equal(new Date(startOfLocalDay(noon, london)).toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(new Date(startOfLocalDay(noon, -60)).toISOString(), '2026-03-28T23:00:00.000Z', 'the fixed offset of "now" was an hour early');
});

test('time: daily buckets across a change of the clocks each start at their own midnight, with the right labels', () => {
  const starts = bucketStarts({ now: Date.UTC(2026, 9, 26, 12), unit: 'day', count: 3, offsetMin: london });
  assert.deepEqual(starts.map((s) => new Date(s).toISOString()), ['2026-10-23T23:00:00.000Z', '2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z']);
  assert.deepEqual(bucketLabels(starts, london), ['Oct 24', 'Oct 25', 'Oct 26']);
  const weeks = bucketStarts({ now: Date.UTC(2026, 9, 27, 12), unit: 'week', count: 2, offsetMin: london });
  assert.deepEqual(weeks.map((s) => new Date(s).toISOString()), ['2026-10-18T23:00:00.000Z', '2026-10-26T00:00:00.000Z']);
  assert.equal(new Date(startOfLocalWeek(Date.UTC(2026, 9, 27, 12), london)).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(dayLabel(Date.UTC(2026, 9, 24, 23), london), 'Oct 25');
});

test('time: an offset that is not a real zone falls back to the browser\'s own', () => {
  assert.equal(offsetAt(300, NOW), 300);
  assert.equal(offsetAt(() => -330, NOW), -330);
  assert.equal(offsetAt(NaN, NOW), new Date(NOW).getTimezoneOffset());
  assert.equal(offsetAt(() => 99999, NOW), new Date(NOW).getTimezoneOffset());
});

test('time: the Overview\'s "opened today" uses the zone function the engine is given', async () => {
  const inst = fakeInstance();
  const noon = Date.UTC(2026, 9, 25, 12);
  await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst, { now: noon, offsetMin: london });
  assert.ok(inst.callsTo('incident', 'opened_at>=2026-10-24 23:00:00').length >= 1);
});

// ---- SLA math ------------------------------------------------------------------------------------------------------------

const sla = (task, { pct, bpct, breached = false, stage = 'in_progress', end = '2026-10-28 09:00:00' }) => ({
  task: cell(task),
  sla: cell('s', 'Resolution'),
  stage: cell(stage, stage === 'paused' ? 'Paused' : 'In progress'),
  has_breached: cell(breached ? 'true' : 'false'),
  percentage: cell(String(pct)),
  ...(bpct === undefined ? {} : { business_percentage: cell(String(bpct)) }),
  planned_end_time: cell(end),
});

test('SLA: the business percentage decides (an 8-to-5 SLA passes 100% plain time every evening without breaking)', () => {
  assert.deepEqual(slaPercent(sla(id(1), { pct: 118, bpct: 62 })), { percentage: 62, basis: 'business' });
  assert.deepEqual(slaPercent(sla(id(1), { pct: 80 })), { percentage: 80, basis: 'actual' }, 'no business figure: the plain one');
  assert.deepEqual(slaPercent({ percentage: cell('81'), business_percentage: cell('') }), { percentage: 81, basis: 'actual' }, 'an empty business figure is not 0');
  const w = worstSla([sla(id(1), { pct: 118, bpct: 62 })]);
  assert.equal(w.percentage, 62);
  assert.equal(riskOf(w), 'ok', 'not "at risk": the record view shows 62% for the same SLA');
  assert.equal(riskOf(worstSla([sla(id(1), { pct: 40, bpct: 91 })])), 'at-risk', 'little wall time, but nearly all its working time');
});

test('SLA: a paused SLA is never "due soon", even with a planned end in the past; a running one is', () => {
  const now = NOW;
  const tickets = groupSlaByTicket(
    [sla(id(1), { pct: 50, bpct: 50, stage: 'paused', end: '2026-10-27 10:00:00' }), sla(id(2), { pct: 50, bpct: 50, end: '2026-10-27 13:00:00' }), sla(id(3), { pct: 80, bpct: 80, stage: 'paused', end: '2026-10-27 10:00:00' })],
    { now }
  );
  // The paused one with half its time used is then not at issue at all, so it is not kept; a paused one at risk is, but not "due soon".
  assert.equal(tickets.find((t) => t.sysId === id(1)), undefined);
  assert.equal(tickets.find((t) => t.sysId === id(2)).dueSoon, true);
  assert.deepEqual([tickets.find((t) => t.sysId === id(3)).atRisk, tickets.find((t) => t.sysId === id(3)).dueSoon], [true, false]);
  assert.equal(isPaused({ stage: cell('paused', 'Paused') }), true);
  assert.equal(isPaused({ stage: 'Paused' }), true);
  assert.equal(isPaused({ stage: cell('in_progress', 'In progress') }), false);
});

test('SLA: the "worth a look" query asks for both percentages', () => {
  assert.equal(worryingQuery(75, NOW), 'has_breached=true^ORbusiness_percentage>=75^ORpercentage>=75^ORplanned_end_time<=2026-10-27 12:00:00');
});

// ---- "you cannot see this" is not zero ----------------------------------------------------------------------------------

test('SLA tiles: when no SLA record is visible at all, the tiles say "not available", never "0 breached"', async () => {
  const hidden = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, fakeInstance({ hidden: ['task_sla'] }));
  assert.equal(tileOf(hidden, 'breached').unavailable, true);
  assert.equal(tileOf(hidden, 'breached').value, null);
  assert.match(tileOf(hidden, 'breached').note, /can see no SLA records at all/);
  const radar = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident'] }, fakeInstance({ hidden: ['task_sla'] }));
  assert.equal(radar.data.available, false);
  // A real zero (SLA records are visible, none is in the scope) is still a zero.
  const real = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, fakeInstance());
  assert.equal(tileOf(real, 'breached').value, 0);
  assert.equal(tileOf(real, 'breached').unavailable, false);
});

test('approvals: 0 waiting is only said when approval records are visible at all', async () => {
  const hidden = await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['sc_req_item'] }, fakeInstance({ hidden: ['sysapproval_approver'] }));
  assert.equal(hidden.data.approvals.mine, null);
  assert.match(hidden.data.approvals.mineNote, /no approval records at all/);
  const real = await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['sc_req_item'] }, fakeInstance());
  assert.equal(real.data.approvals.mine, 0);
  const handover = await run({ section: 'handover', scope: { kind: 'mine' }, tables: ['sc_req_item'] }, fakeInstance({ hidden: ['sysapproval_approver', 'task_sla'] }));
  assert.equal(handover.data.waiting.approvals.mine, null);
  assert.equal(handover.data.events.breaches.available, false, 'breaches in the period: not "0" when no SLA is visible');
});

test('fulfilment: a table whose count failed is not added as 0; the total says it is partial', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.groupBy.length === 0, then: () => { throw new Error('Report on "sc_task" failed (500)'); } },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_req_item' && c.groupBy.length === 0, then: count(4) },
    ],
  });
  const r = await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['sc_req_item', 'sc_task'] }, inst);
  assert.equal(r.data.open, 4);
  assert.equal(r.data.openPartial, true);
});

test('hand-over: a note or cap said by the Overview it builds on is not said twice', async () => {
  const many = Array.from({ length: 500 }, (_, i) => sla(id(i + 1), { pct: 90, bpct: 90 }));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(5000) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla' && c.query.includes('ORDERBYDESCpercentage'), then: many },
    ],
  });
  const r = await run({ section: 'handover', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  const slaCaps = r.caps.filter((c) => c.source === 'task_sla');
  assert.equal(slaCaps.length, 1, JSON.stringify(r.caps));
  assert.equal(new Set(r.notes).size, r.notes.length);
});

// ---- one "now" per dashboard load ---------------------------------------------------------------------------------------

test('asOf: a recent instant from the dashboard is used; anything else falls back to the real time', () => {
  assert.equal(asOfFor({ asOf: NOW - 5 * 60000 }, NOW), NOW - 5 * 60000);
  assert.equal(asOfFor({ asOf: NOW - AS_OF_MAX_AGE_MS - 1 }, NOW), NOW, 'too old');
  assert.equal(asOfFor({ asOf: NOW + 2 * 60000 }, NOW), NOW, 'in the future');
  assert.equal(asOfFor({ asOf: 'x' }, NOW), NOW);
  assert.equal(asOfFor({}, NOW), NOW);
  assert.equal(asOfFor(undefined, NOW), NOW);
});

test('asOf: two widgets of one load, started minutes apart, ask the same questions and the second one is a cache hit', async () => {
  const inst = fakeInstance();
  const runtime = createRuntime();
  const env = (now) => ({ deps: inst.deps, userId: USER, runtime, now, offsetMin: 0 });
  const asOf = NOW;
  await runReport({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'], params: { asOf } }, env(NOW + 10000));
  const stale = (c) => c.kind === 'aggregate' && c.query.includes('sys_updated_on<');
  const after = inst.calls.filter(stale).length;
  await runReport({ section: 'workload', scope: { kind: 'mine' }, tables: ['incident'], params: { asOf } }, env(NOW + 2 * 60000 + 10000));
  assert.equal(inst.calls.filter(stale).length, after, 'the "no update in 3 days" count was not asked again');
  // Without the shared instant, a widget started two minutes later asked a slightly different question: a new request.
  await runReport({ section: 'workload', scope: { kind: 'mine' }, tables: ['incident'] }, env(NOW + 2 * 60000 + 10000));
  assert.equal(inst.calls.filter(stale).length, after + 1);
});

test('asOf passes the panel-to-page check as a whole number only', () => {
  assert.deepEqual(cleanParams({ asOf: NOW + 0.7 }), { asOf: NOW });
  assert.deepEqual(cleanParams({ asOf: 'soon' }), {});
  assert.deepEqual(cleanParams({ asOf: -5 }), {});
});

// ---- the read boundary ----------------------------------------------------------------------------------------------------

/** The guarded reads the content script hands every operation (src/content/reads.js -> policyGuard.deps), faked. */
function guardedCtx(inst, blocked) {
  const isBlocked = (t) => blocked.includes(String(t).toLowerCase());
  return {
    deps: {
      isBlocked,
      queryTable: async (table, query, fields, options) => {
        if (isBlocked(table)) throw Object.assign(new Error(`Your organisation does not allow Agent Buddy to read ${table} records.`), { code: 'BLOCKED_TABLE' });
        return inst.deps.queryTable(table, query, fields, options);
      },
    },
  };
}

test('reports use the content script\'s guarded reads: a table blocked by the managed policy is never read, even if the panel did not say so', async () => {
  const inst = fakeInstance();
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() });
  const ctx = guardedCtx(inst, ['problem', 'task_sla']);
  const out = await ops.reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem'] }, ctx);
  assert.equal(out.tables.find((t) => t.table === 'problem').status, 'blocked');
  assert.equal(inst.callsTo('problem').length, 0);
  assert.equal(inst.callsTo('task_sla').length, 0, 'the SLA reads are refused too');
  assert.equal(tileOf(out, 'breached').unavailable, true);
  const context = await ops.reportContext({}, ctx);
  assert.equal(context.tables.find((t) => t.table === 'problem').status, 'blocked');
  assert.equal(inst.callsTo('problem').length, 0);
});

test('readsFor: the Aggregate API read is refused for a blocked table', async () => {
  const inst = fakeInstance();
  const { deps, isBlocked } = readsFor(inst.deps, guardedCtx(inst, ['sys_user']));
  assert.equal(isBlocked('SYS_USER'), true);
  await assert.rejects(() => deps.aggregate('sys_user', { query: '' }), (e) => e.code === 'BLOCKED_TABLE');
  await deps.aggregate('incident', { groupBy: ['assigned_to'] });
  assert.equal(inst.calls.length, 1);
  // Without the content script's context (the unit tests), the injected reads are used as they are.
  assert.equal(readsFor(inst.deps, undefined).deps, inst.deps);
});

test('readsFor with the real policy guard: a dot-walk is checked by the table its column points at, in the query too', async () => {
  const inst = fakeInstance();
  const realCtx = async (blockedTables) => ({
    deps: await createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables } }) }).deps({ queryTable: inst.deps.queryTable }),
  });
  const people = readsFor(inst.deps, await realCtx(['sys_user'])).deps;
  // assigned_to is not a table's name: it points at sys_user. The old check compared the column's name and let this through.
  await assert.rejects(() => people.aggregate('incident', { groupBy: ['assigned_to.department'] }), (e) => e.code === 'BLOCKED_TABLE');
  await people.aggregate('incident', { groupBy: ['assigned_to'] });
  // SLA counts filtered by the task they belong to walk through task: refused when task is blocked.
  const sla = readsFor(inst.deps, await realCtx(['task'])).deps;
  await assert.rejects(() => sla.aggregate('task_sla', { query: 'task.active=true^stage=in_progress' }), (e) => e.code === 'BLOCKED_TABLE');
  assert.equal(inst.calls.length, 1, 'only the allowed read reached the instance');
});

// ---- My day -----------------------------------------------------------------------------------------------------------

const ticket = (n) => ({ sys_id: cell(id(n)), number: cell(`INC${n}`), short_description: cell('t'), priority: cell('2', '2 - High'), state: cell('2', 'In Progress'), sys_updated_on: cell('2026-10-27 10:00:00'), sys_class_name: cell('incident') });

function myDayDeps({ rows = {}, slas = [], hidden = [], denied = [] } = {}) {
  const calls = [];
  return {
    calls,
    async queryTable(table, query) {
      calls.push({ table, query });
      if (denied.includes(table)) throw Object.assign(new Error('403'), { code: 'ACCESS_DENIED' });
      if (hidden.includes(table)) return [];
      if (query === '') return [{ sys_id: cell('f'.repeat(32)) }];
      if (table === 'task_sla') return slas;
      return rows[table] || [];
    },
  };
}

test('My day: an SLA with most of its working time left is not "at risk", even past 100% plain time', async () => {
  const out = await readMyDay({ userId: USER }, myDayDeps({ rows: { incident: [ticket(1)] }, slas: [sla(id(1), { pct: 118, bpct: 62 })] }), { tables: ['incident'], now: NOW });
  assert.equal(out.items[0].risk, 'ok');
  assert.equal(out.items[0].sla.percentage, 62);
});

test('My day: no SLA row because no SLA record is visible at all says so; none for these tickets says nothing', async () => {
  const hidden = await readMyDay({ userId: USER }, myDayDeps({ rows: { incident: [ticket(1)] }, hidden: ['task_sla'] }), { tables: ['incident'], now: NOW });
  assert.deepEqual(hidden.access.map((a) => [a.source, a.status]), [['task_sla', 'hidden']]);
  assert.match(hidden.access[0].note, /ordered by priority only/);
  const none = await readMyDay({ userId: USER }, myDayDeps({ rows: { incident: [ticket(1)] } }), { tables: ['incident'], now: NOW });
  assert.deepEqual(none.access, []);
});

test('My day: an empty list says what it means (nothing assigned / nothing visible / nothing readable)', async () => {
  const nothing = await readMyDay({ userId: USER }, myDayDeps(), { tables: ['incident'], now: NOW });
  assert.deepEqual([nothing.items.length, nothing.empty], [0, 'nothing']);
  const unseen = await readMyDay({ userId: USER }, myDayDeps({ hidden: ['incident', 'sc_task'] }), { tables: ['incident', 'sc_task'], now: NOW });
  assert.equal(unseen.empty, 'unseen');
  const unread = await readMyDay({ userId: USER }, myDayDeps({ denied: ['incident'] }), { tables: ['incident'], now: NOW });
  assert.equal(unread.empty, 'unread');
  const some = await readMyDay({ userId: USER }, myDayDeps({ rows: { incident: [ticket(1)] } }), { tables: ['incident'], now: NOW });
  assert.equal(some.empty, null);
});

test('My day: a table refused by the organisation\'s policy is "blocked", not "denied"', async () => {
  const deps = {
    async queryTable(table) {
      if (table === 'problem') throw Object.assign(new Error('Your organisation does not allow Agent Buddy to read problem records.'), { code: 'BLOCKED_TABLE' });
      return [];
    },
  };
  const out = await readMyDay({ userId: USER }, deps, { tables: ['problem'], now: NOW });
  assert.deepEqual(out.access.map((a) => a.status), ['blocked']);
});

test('reports and My day read the same SLA columns', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(3) },
      // The chosen group exists on this instance (the engine checks that first).
      { when: (c) => c.kind === 'query' && c.table === 'sys_user_group' && c.query !== '', then: [{ sys_id: GROUP_A, name: 'Service Desk', active: 'true' }] },
    ],
  });
  await run({ section: 'sla', scope: { kind: 'chosen', groupIds: [GROUP_A] }, tables: ['incident'] }, inst);
  const deps = myDayDeps({ rows: { incident: [ticket(1)] }, slas: [sla(id(1), { pct: 10, bpct: 10 })] });
  await readMyDay({ userId: USER }, deps, { tables: ['incident'], now: NOW });
  const radar = inst.calls.find((c) => c.kind === 'query' && c.table === 'task_sla' && c.query !== '');
  assert.ok(radar.fields.includes('business_percentage') && radar.fields.includes('stage'));
  assert.ok(HOUR > 0 && DAY > 0);
});

test('builder: "SLA breached" with no SLA record visible at all is a plain reason, not a chart of zeros', async () => {
  const hidden = await run({ kind: 'builder', config: { table: 'incident', presets: ['breached'], groupBy: 'state' } }, fakeInstance({ hidden: ['task_sla'] }));
  assert.equal(hidden.data.available, false);
  assert.match(hidden.data.reason, /no SLA records at all/);
  // SLA records are visible and none of them is breached: then "none" is a real answer.
  const none = await run({ kind: 'builder', config: { table: 'incident', presets: ['breached'], groupBy: 'state' } }, fakeInstance());
  assert.equal(none.data.available, true);
});
