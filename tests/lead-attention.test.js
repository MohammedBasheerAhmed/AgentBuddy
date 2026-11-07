// "Needs attention now" (wave 6, team lead): the few tickets that most need a lead, one reason each, composed from what the other
// sections read. The rows and their order, one row per ticket, the cap of eight, the honest flags (never a false "nothing"), a lead of
// any team size, and that it asks for nothing the Team screen does not already read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { ATTENTION_MAX, ATTENTION_REASONS, WAIT_MIN_DAYS, OLDEST_MIN_DAYS, composeAttention, attentionSources, reasonLabel, attentionTables } from '../src/reports/engine/attention.js';
import { TICKET_FIELDS, SECTION_IDS } from '../src/reports/engine/constants.js';
import { leadWorld, ticket, slaRow, id, group, USER, NOW } from './lead-fixtures.js';

const run = (section, inst, { scope = { kind: 'groups' }, tables = ['incident'] } = {}) =>
  runReport({ section, scope, tables, params: {} }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });
const attention = (inst, options) => run('attention', inst, options);

const STATES = [group('state', '2', 'In Progress', 8), group('state', '90', 'Awaiting Caller', 2), group('state', '-5', 'On Hold', 1), group('state', '9', 'Awaiting Approval', 1)];

// A busy day: one breached (also handed over often), one close to breaking, an approval and a customer that have waited, a ticket
// handed over often, a ticket open for weeks.
const busy = (extra = {}) =>
  leadWorld({
    slaRows: [slaRow(id(1), 130, true), slaRow(id(2), 88, false)],
    tickets: { 1: ticket(1, { title: 'VPN down', priority: '1' }), 2: ticket(2, { title: 'Printer jam' }) },
    open: 12,
    oldCount: 2,
    reassignedCount: 3,
    reassignedRows: [ticket(1, { reassignments: '5' }), ticket(3, { reassignments: '4', title: 'Mailbox full' })],
    states: STATES,
    waitingRows: [ticket(5, { state: ['9', 'Awaiting Approval'], openedAt: '2026-10-20 08:00:00', title: 'New laptop' }), ticket(6, { state: ['90', 'Awaiting Caller'], openedAt: '2026-10-21 08:00:00', title: 'Reset token' })],
    oldestRows: [ticket(7, { openedAt: '2026-09-01 08:00:00', title: 'Old request' }), ticket(5, { openedAt: '2026-10-20 08:00:00' })],
    ...extra,
  });

// ---- the rows -----------------------------------------------------------------------------------------------------------------------

test('the section exists and is a saved-dashboard section; the reasons run from the strongest', () => {
  assert.ok(SECTION_IDS.includes('attention'));
  assert.deepEqual([...ATTENTION_REASONS], ['breached', 'closest', 'approval', 'reassigned', 'oldest', 'customer']);
  assert.equal(ATTENTION_MAX, 8);
});

test('the rows are in order of reason; a ticket is one row under its strongest reason, the others a count', async () => {
  const r = await attention(busy());
  const d = r.data;
  assert.equal(r.id, 'attention');
  assert.equal(r.title, 'Needs attention now');
  assert.deepEqual(d.rows.map((x) => [x.number, x.reason]), [
    ['INC0000001', 'breached'],
    ['INC0000002', 'closest'],
    ['INC0000005', 'approval'],
    ['INC0000003', 'reassigned'],
    ['INC0000007', 'oldest'],
    ['INC0000006', 'customer'],
  ]);
  const first = d.rows[0];
  assert.deepEqual(first.reasons, ['breached', 'reassigned'], 'it is also handed over often');
  assert.equal(first.more, 1);
  assert.equal(first.facts.reassigned.n, 5);
  assert.equal(first.priority, '1 - High');
  assert.equal(first.title, 'VPN down');
  assert.equal(first.owner, 'Ann Lee');
  assert.equal(new Set(d.rows.map((x) => x.sysId)).size, d.rows.length, 'one row per ticket');
  assert.equal(d.rows.find((x) => x.number === 'INC0000003').facts.reassigned.n, 4);
});

test('a wait is a reason only after a few days; the oldest only from the last ageing bucket on', async () => {
  assert.equal(WAIT_MIN_DAYS, 3);
  assert.equal(OLDEST_MIN_DAYS, 15);
  const r = await attention(
    busy({
      waitingRows: [ticket(5, { state: ['9', 'Awaiting Approval'], openedAt: '2026-10-26 08:00:00' }), ticket(6, { state: ['90', 'Awaiting Caller'], openedAt: '2026-10-27 08:00:00' })],
      oldestRows: [ticket(7, { openedAt: '2026-10-20 08:00:00' })],
    })
  );
  const reasons = r.data.rows.map((x) => x.reason);
  assert.ok(!reasons.includes('approval') && !reasons.includes('customer') && !reasons.includes('oldest'), reasons.join());
  assert.equal(r.data.counts.approval.population, 1, 'the count of approvals waiting is still the section\'s own');
  assert.equal(r.data.counts.approval.listed, 0);
});

test('never more than eight rows, however many tickets: the total is "at least"', async () => {
  const tickets = {};
  const slaRows = [];
  for (let n = 1; n <= 30; n += 1) {
    tickets[n] = ticket(n);
    slaRows.push(slaRow(id(n), 120, true));
  }
  const r = await attention(leadWorld({ slaRows, tickets, open: 40 }));
  const d = r.data;
  assert.equal(d.rows.length, 8);
  assert.equal(d.shown, 8);
  assert.equal(d.counts.breached.population, 30);
  assert.equal(d.total, 30);
  assert.equal(d.totalAtLeast, false, 'thirty breached are all listed and nothing else is found: exact');
  assert.ok(d.rows.every((x) => x.reason === 'breached'));
});

test('a lead of any team size: nothing, one ticket, a few, hundreds', async () => {
  // nothing, and every source read: the one case where "nothing needs attention" is true
  const calm = (await attention(leadWorld({ states: [group('state', '2', 'In Progress', 4)], open: 4, tickets: {} }))).data;
  assert.equal(calm.rows.length, 0);
  assert.equal(calm.complete, true);
  assert.equal(calm.total, 0);
  assert.deepEqual(calm.missing, []);

  // one
  const one = (await attention(leadWorld({ slaRows: [slaRow(id(1), 99, true)], tickets: { 1: ticket(1) }, open: 1 }))).data;
  assert.equal(one.rows.length, 1);
  assert.equal(one.total, 1);
  assert.equal(one.totalAtLeast, false);

  // hundreds, more than the radar reads: the rows are the top, the count is a lower bound
  const big = {};
  const rows = [];
  for (let n = 1; n <= 1000; n += 1) {
    rows.push(slaRow(id(n), 130, true));
    if (n <= 200) big[n] = ticket(n);
  }
  const huge = (await attention(leadWorld({ slaRows: rows, slaTotal: 5000, tickets: big, open: 900 }))).data;
  assert.equal(huge.rows.length, 8);
  assert.equal(huge.counts.breached.atLeast, true, 'the SLA read stopped at its cap');
  assert.equal(huge.complete, false);
  assert.equal(huge.totalAtLeast, true);
  assert.ok(huge.total >= 200, `at least what was looked up: ${huge.total}`);
});

// ---- honest: never a false "nothing" ---------------------------------------------------------------------------------------------------

test('SLAs the person cannot read: the breached and the closest are not read, and the section says so instead of calling it quiet', async () => {
  // (denied: a 403; hidden: a 200 that shows no row at all, which proves nothing)
  for (const options of [{ denied: ['task_sla'] }, { hidden: ['task_sla'], slaTotal: 0 }]) {
    const r = await attention(leadWorld({ states: [group('state', '2', 'In Progress', 4)], open: 4, ...options }));
    const d = r.data;
    assert.equal(d.rows.length, 0);
    assert.equal(d.complete, false, JSON.stringify(options));
    assert.deepEqual(d.missing, ['breached', 'closest']);
    assert.equal(d.counts.breached.population, null, 'a missing number, never 0');
    assert.ok(r.access.some((a) => a.source === 'task_sla'), 'and the dashboard says why');
  }
});

test('a hand-off count, the states or the oldest list that fail make it incomplete, one by one', async () => {
  const boom = (match) => ({ when: (c) => match(c), then: () => { throw Object.assign(new Error('boom'), { code: 'ACCESS_DENIED' }); } });
  const cases = [
    ['reassigned', boom((c) => c.query.includes('reassignment_count>=')), 'reassigned'],
    ['oldest', boom((c) => c.kind === 'aggregate' && c.query.includes('opened_at>') && !c.query.includes('opened_at>=')), 'oldest'],
    ['states', boom((c) => c.kind === 'aggregate' && c.groupBy.join() === 'state'), 'approval'],
  ];
  for (const [name, rule, reason] of cases) {
    const r = await attention(busy({ rules: [rule] }));
    assert.equal(r.data.complete, false, name);
    assert.ok(r.data.missing.includes(reason), `${name}: ${r.data.missing.join()}`);
    assert.ok(r.data.rows.length > 0, `${name}: the rest is still shown`);
  }
});

test('details of the SLA tickets that cannot be read: counted, not listed, and the section is incomplete', async () => {
  const inst = busy({ rules: [{ when: (c) => c.table === 'task' && c.query.includes('sys_idIN'), then: () => { throw Object.assign(new Error('denied'), { code: 'ACCESS_DENIED' }); } }] });
  const r = await attention(inst);
  assert.equal(r.data.counts.breached.population, 1);
  assert.equal(r.data.counts.breached.listed, 0);
  assert.equal(r.data.complete, false);
  assert.ok(r.data.total >= 1);
});

test('a ticket type the person cannot read is left out of the sources, not turned into zeros', async () => {
  const none = await attention(leadWorld({}), { tables: ['incident', 'problem'] });
  assert.ok(none.tables.some((t) => t.table === 'problem'));
  const alone = await attention(leadWorld({ denied: ['incident'] }), { tables: ['incident'] });
  assert.equal(alone.data.available, false, 'no ticket type can be read');
  assert.match(alone.data.reason, /nothing to look at/);
});

// ---- nothing new is read -----------------------------------------------------------------------------------------------------------

const keyOf = (c) => [c.kind, c.table, c.query, (c.fields || []).join(','), (c.groupBy || []).join(','), c.options.limit ?? '', c.options.offset ?? ''].join('|');

test('it asks the instance for nothing the Team screen does not already ask: the same questions, the same columns, tables and no write', async () => {
  const sections = ['overview', 'workload', 'sla', 'fulfilment', 'handover'];
  const known = new Set();
  for (const section of sections) {
    const inst = busy();
    await run(section, inst, { tables: ['incident'] });
    inst.calls.forEach((c) => known.add(keyOf(c)));
  }
  const inst = busy();
  await attention(inst);
  const extra = inst.calls.filter((c) => !known.has(keyOf(c)));
  // The one difference: for a table with several kinds of wait, the oldest approvals and the oldest customers are asked for on their own
  // (the same list as the hand-over's "waiting the longest", narrowed to one kind), so old holds with a vendor do not hide them.
  assert.ok(extra.every((c) => c.kind === 'query' && c.table === 'incident' && /stateIN/.test(c.query) && c.options.limit === 5), extra.map(keyOf).join('\n'));
  assert.ok(extra.length <= 2, `${extra.length} extra`);
  // The columns are the ones the Team screen reads (the ticket columns of the reports, the hand-over's name columns, the SLA columns).
  const allowed = new Set([...TICKET_FIELDS, 'opened_by', 'caller_id', 'reassignment_count', 'closed_at', 'resolved_at', 'category', 'cmdb_ci', 'reopen_count', 'group', 'task', 'sla', 'stage', 'has_breached', 'percentage', 'business_percentage', 'planned_end_time', 'name', 'active', 'time_zone']);
  inst.calls.filter((c) => c.kind === 'query').forEach((c) => c.fields.forEach((f) => assert.ok(allowed.has(f), `column ${f} on ${c.table}`)));
  const tables = new Set(inst.calls.map((c) => c.table));
  assert.deepEqual([...tables].sort(), ['incident', 'sys_user_grmember', 'task', 'task_sla']);
  // The engine can only read (queryTable, aggregate): there is no other function to call.
  assert.deepEqual(Object.keys(inst.deps).sort(), ['aggregate', 'queryTable']);
});

test('a second run, or the Workload on the same dashboard, is served from the cache: the questions are asked once', async () => {
  const inst = busy();
  const runtime = createRuntime();
  const env = { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 };
  await runReport({ section: 'workload', scope: { kind: 'groups' }, tables: ['incident'], params: {} }, env);
  const before = inst.calls.length;
  await runReport({ section: 'attention', scope: { kind: 'groups' }, tables: ['incident'], params: {} }, env);
  const asked = inst.calls.slice(before);
  // Only what the Workload does not read (the SLAs and the waiting lists) is new.
  assert.ok(asked.every((c) => c.table === 'task_sla' || c.table === 'task' || /stateIN|ORDERBYopened_at/.test(c.query)), asked.map(keyOf).join('\n'));
});

// ---- composing, on its own ----------------------------------------------------------------------------------------------------------

const src = (items = [], extra = {}) => ({ ok: true, population: items.length, atLeast: false, listedAll: true, items, ...extra });
const item = (n, facts = {}) => ({ sysId: id(n), table: 'incident', number: `INC${n}`, title: `t${n}`, priority: '2', owner: 'Ann', group: 'Desk', facts });
const empty = () => Object.fromEntries(ATTENTION_REASONS.map((r) => [r, src()]));

test('composeAttention: the head of the severity order, a ticket once, its other reasons counted', () => {
  const s = empty();
  s.breached = src([item(1), item(2)]);
  s.closest = src([item(3)]);
  s.reassigned = src([item(2, { n: 4 }), item(4, { n: 3 })]);
  s.oldest = src([item(1), item(5)]);
  const d = composeAttention(s);
  assert.deepEqual(d.rows.map((r) => r.number), ['INC1', 'INC2', 'INC3', 'INC4', 'INC5']);
  assert.deepEqual(d.rows.map((r) => r.reason), ['breached', 'breached', 'closest', 'reassigned', 'oldest']);
  assert.deepEqual(d.rows.map((r) => r.more), [1, 1, 0, 0, 0]);
  assert.deepEqual(d.rows[0].reasons, ['breached', 'oldest']);
  assert.equal(d.total, 5);
  assert.equal(d.totalAtLeast, false);
  assert.equal(d.complete, true);
});

test('composeAttention: the limit, and the order stays when a stronger reason has many tickets', () => {
  const s = empty();
  s.breached = src(Array.from({ length: 12 }, (_, i) => item(i + 1)));
  s.customer = src([item(50)]);
  const d = composeAttention(s);
  assert.equal(d.rows.length, 8);
  assert.ok(d.rows.every((r) => r.reason === 'breached'), 'a customer waiting is not shown while eight are breached');
  assert.equal(d.total, 13, 'twelve breached and one waiting customer: thirteen tickets are listed');
  assert.equal(composeAttention(s, { limit: 3 }).rows.length, 3);
});

test('composeAttention: honest flags follow the sources', () => {
  const s = empty();
  s.breached = src([item(1)], { atLeast: true });
  assert.equal(composeAttention(s).complete, false, 'a count that is only a lower bound is not the whole picture');
  s.breached = src([item(1)]);
  s.closest = { ok: false, population: null, atLeast: false, listedAll: false, items: [] };
  const d = composeAttention(s);
  assert.equal(d.complete, false);
  assert.deepEqual(d.missing, ['closest']);
  assert.equal(d.totalAtLeast, true, 'a source that was not read can hide tickets');
  const part = empty();
  part.reassigned = src([item(1)], { population: 9, listedAll: false });
  assert.equal(composeAttention(part).totalAtLeast, true, 'five of nine listed: at least nine');
  assert.equal(composeAttention(part).total, 9);
  assert.equal(composeAttention(part).complete, true, 'listing a sample is not unread data');
});

test('composeAttention is deterministic and does not change its input', () => {
  const s = empty();
  s.breached = src([item(1)]);
  s.oldest = src([item(1), item(2)]);
  const before = JSON.stringify(s);
  assert.deepEqual(composeAttention(s), composeAttention(s));
  assert.equal(JSON.stringify(s), before);
});

test('attentionSources: an unread source is "not read", never zero', () => {
  const sources = attentionSources({
    sla: { snap: { ok: false }, known: [], failure: null },
    reassigned: { available: false, items: [] },
    ageing: { byTable: [], buckets: [], left: 1 },
    waiting: { statesOk: false, partial: true, listsPartial: false, sumKind: () => 0 },
    approval: { items: [], failed: false },
    customer: { items: [], failed: false },
    oldest: { items: [], failed: false },
    now: NOW,
  });
  for (const r of ['breached', 'closest', 'reassigned', 'oldest', 'approval']) assert.equal(sources[r].ok, false, r);
  for (const r of ['breached', 'closest', 'reassigned', 'oldest', 'approval', 'customer']) assert.equal(sources[r].population, null, r);
});

// ---- words and the export ---------------------------------------------------------------------------------------------------------------

test('the reasons in plain words, and the export table says the same', async () => {
  assert.equal(reasonLabel('breached'), 'Breached');
  assert.equal(reasonLabel('closest'), 'Closest to breaking');
  assert.equal(reasonLabel('approval'), 'Waiting for approval');
  assert.equal(reasonLabel('reassigned', { n: 5 }), 'Reassigned 5 times');
  assert.equal(reasonLabel('reassigned', { n: 1 }), 'Reassigned 1 time');
  assert.equal(reasonLabel('oldest'), 'Oldest open');
  assert.equal(reasonLabel('customer'), 'Customer waiting');
  const r = await attention(busy());
  const [table] = attentionTables(r);
  assert.equal(table.title, 'Needs attention now');
  assert.deepEqual(table.columns.map((c) => c.label), ['Ticket', 'Short description', 'Reason', 'Priority', 'Assigned to', 'Group']);
  assert.equal(table.rows.length, r.data.rows.length);
  assert.equal(table.rows[0].reason, 'Breached');
  assert.equal(table.rows[3].reason, 'Reassigned 4 times');
  assert.deepEqual(attentionTables({ data: { available: false } }), []);
  // No table, column, id or code in what a person reads.
  const text = JSON.stringify(table);
  assert.ok(!/sys_id|_list|HTTP|\b40[0-9]\b|incident_|\bsc_|\btask_sla\b/i.test(text), text);
});
