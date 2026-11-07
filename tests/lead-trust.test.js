// What a team lead can trust (wave 6): the number in Needs attention is the number in the section it came from, a ticket is not counted
// twice, and the totals of the Overview, the SLA radar, the Workload and the fulfilment agree for the same scope: the same filter, the
// same meaning of a state (src/domain/states.js), the same "at least" when a read stopped early. Each audit fix has its test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { showsPersonRows } from '../src/reports/engine/common.js';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { ATTENTION_REASONS, composeAttention, reconcileAttention, reconcileWithSections } from '../src/reports/engine/attention.js';
import { fakeInstance, cell, group, count, GROUP_A } from './reports-fixtures.js';
import { leadWorld, ticket, slaRow, id, USER, NOW } from './lead-fixtures.js';

const run = (section, inst, { scope = { kind: 'groups' }, tables = ['incident'] } = {}) =>
  runReport({ section, scope, tables, params: {} }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

const STATES = [group('state', '2', 'In Progress', 8), group('state', '90', 'Awaiting Caller', 2), group('state', '-5', 'On Hold', 1), group('state', '9', 'Awaiting Approval', 1)];
const busy = () =>
  leadWorld({
    slaRows: [slaRow(id(1), 130, true), slaRow(id(2), 88, false), slaRow(id(2), 95, false)],
    tickets: { 1: ticket(1, { title: 'VPN down', priority: '1' }), 2: ticket(2, { title: 'Printer jam' }) },
    open: 12,
    oldCount: 2,
    reassignedCount: 3,
    reassignedRows: [ticket(1, { reassignments: '5' }), ticket(3, { reassignments: '4', title: 'Mailbox full' })],
    states: STATES,
    waitingRows: [ticket(5, { state: ['9', 'Awaiting Approval'], openedAt: '2026-10-20 08:00:00' }), ticket(6, { state: ['90', 'Awaiting Caller'], openedAt: '2026-10-21 08:00:00' })],
    oldestRows: [ticket(7, { openedAt: '2026-09-01 08:00:00' }), ticket(5, { openedAt: '2026-10-20 08:00:00' })],
  });

// ---- each count is its section's count ----------------------------------------------------------------------------------------------

test('every count in Needs attention is the count of the same tickets in the section it came from', async () => {
  const results = {};
  for (const section of ['overview', 'sla', 'workload', 'handover', 'attention']) results[section] = (await run(section, busy())).data;
  const { attention } = results;
  assert.deepEqual(reconcileWithSections(attention, results), []);
  // the numbers, one by one
  assert.equal(attention.counts.breached.population, 1);
  assert.equal(results.overview.tiles.find((t) => t.key === 'breached').value, 1);
  assert.equal(results.sla.counts.breached, 1);
  assert.equal(results.handover.snapshot.breached, 1);
  assert.equal(attention.counts.closest.population, results.sla.ticketsAtIssue - results.sla.counts.breached);
  assert.equal(attention.counts.reassigned.population, results.workload.pingPong.count);
  assert.equal(attention.counts.oldest.population, results.workload.ageing.buckets.at(-1).count);
  assert.equal(attention.counts.approval.population, results.handover.waiting.approval);
  assert.equal(attention.counts.customer.population, results.handover.waiting.customer);
});

test('"closest to breaking" is the tickets at issue less the breached: a ticket that is both at risk and due soon is counted once', async () => {
  // INC2 has two SLAs, one at 88 %, one at 95 %, both ending within four hours: it is at risk AND due soon, and one ticket.
  const sla = (await run('sla', busy())).data;
  assert.equal(sla.counts.atRisk, 1);
  assert.equal(sla.counts.dueSoon, 1);
  assert.equal(sla.counts.atRisk + sla.counts.dueSoon, 2, 'adding the two would say two tickets');
  assert.equal(sla.ticketsAtIssue, 2);
  const attention = (await run('attention', busy())).data;
  assert.equal(attention.counts.closest.population, 1);
  assert.equal(attention.counts.breached.population + attention.counts.closest.population, sla.ticketsAtIssue);
});

test('a difference between Needs attention and its sections is found, not hidden', async () => {
  const results = {};
  for (const section of ['overview', 'sla', 'workload', 'handover', 'attention']) results[section] = (await run(section, busy())).data;
  const bad = (change) => {
    const copy = JSON.parse(JSON.stringify(results));
    change(copy);
    return reconcileWithSections(copy.attention, copy);
  };
  assert.ok(bad((r) => (r.sla.counts.breached += 1)).some((p) => /breached \(SLA radar\)/.test(p)));
  assert.ok(bad((r) => (r.overview.tiles.find((t) => t.key === 'breached').value += 1)).some((p) => /Overview/.test(p)));
  assert.ok(bad((r) => (r.workload.pingPong.count += 1)).some((p) => /reassigned often/.test(p)));
  assert.ok(bad((r) => (r.workload.ageing.buckets[4].count += 1)).some((p) => /open longest/.test(p)));
  assert.ok(bad((r) => (r.handover.waiting.approval += 1)).some((p) => /approval/.test(p)));
  assert.ok(bad((r) => (r.handover.waiting.customer += 1)).some((p) => /customer/.test(p)));
  assert.ok(bad((r) => (r.sla.top = [])).some((p) => /not in the SLA radar/.test(p)));
  assert.ok(bad((r) => (r.workload.pingPong.items = [])).some((p) => /not in the Workload/.test(p)));
  assert.ok(bad((r) => (r.handover.oldest = [])).some((p) => /not in the hand-over/.test(p)));
});

test('a source that is not read is "not read" on both sides, never 0 on one', async () => {
  const world = () => busy();
  const results = {};
  const denied = leadWorld({ denied: ['task_sla'], states: STATES, open: 12 });
  for (const section of ['overview', 'sla', 'workload', 'handover', 'attention']) results[section] = (await run(section, section === 'attention' ? leadWorld({ denied: ['task_sla'], states: STATES, open: 12 }) : denied)).data;
  assert.equal(results.sla.available, false);
  assert.equal(results.attention.counts.breached.population, null);
  assert.deepEqual(reconcileWithSections(results.attention, results), []);
  assert.ok(world);
});

// ---- the rows are exactly the sources' rows, in order, once -----------------------------------------------------------------------------

test('reconcileAttention: the rows are the first tickets of the sources in order of reason, once each, with the sources\' own counts', () => {
  const item = (n, facts = {}) => ({ sysId: id(n), table: 'incident', number: `INC${n}`, title: '', priority: '', owner: '', group: '', facts });
  const src = (items, extra = {}) => ({ ok: true, population: items.length, atLeast: false, listedAll: true, items, ...extra });
  const sources = Object.fromEntries(ATTENTION_REASONS.map((r) => [r, src([])]));
  sources.breached = src([item(1), item(2)]);
  sources.reassigned = src([item(2, { n: 4 }), item(3, { n: 3 })], { population: 9, listedAll: false });
  sources.oldest = src([item(1), item(4)]);
  const data = composeAttention(sources);
  assert.deepEqual(reconcileAttention(data, sources), { ok: true, problems: [] });

  const tampered = (change) => {
    const copy = JSON.parse(JSON.stringify(data));
    change(copy);
    return reconcileAttention(copy, sources);
  };
  assert.equal(tampered((d) => (d.counts.breached.population = 5)).ok, false, 'a count that is not the source\'s');
  assert.equal(tampered((d) => d.rows.push({ ...d.rows[0] })).ok, false, 'a ticket twice');
  assert.equal(tampered((d) => d.rows.reverse()).ok, false, 'out of order');
  assert.equal(tampered((d) => (d.rows[0].more = 3)).ok, false, 'a count of other reasons that is not the sources\'');
  assert.equal(tampered((d) => (d.rows[0].reason = 'oldest')).ok, false, 'not under its strongest reason');
  assert.equal(tampered((d) => (d.total = 1)).ok, false, 'a total below the tickets it stands for');
  assert.equal(tampered((d) => (d.complete = !d.complete)).ok, false, 'complete that does not follow the sources');
  assert.equal(tampered((d) => d.rows.splice(1, 1)).ok, false, 'a stronger ticket left out');
});

test('no ticket is counted twice, whatever the sources hold (seeded, 200 random worlds)', () => {
  let seed = 7;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let w = 0; w < 200; w += 1) {
    const sources = {};
    for (const reason of ATTENTION_REASONS) {
      const items = Array.from({ length: next(7) }, () => next(12) + 1).filter((v, i, all) => all.indexOf(v) === i).map((n) => ({ sysId: id(n), table: 'incident', number: `INC${n}`, title: `t${n}`, priority: '', owner: '', group: '', facts: { n: next(9) } }));
      const ok = next(6) !== 0;
      sources[reason] = { ok, population: ok ? items.length + next(3) : null, atLeast: next(5) === 0, listedAll: ok && next(2) === 0, items: ok ? items : [] };
    }
    const limit = 1 + next(10);
    const data = composeAttention(sources, { limit });
    const result = reconcileAttention(data, sources, { limit });
    assert.deepEqual(result, { ok: true, problems: [] }, `world ${w}`);
    assert.ok(data.rows.length <= limit);
    assert.equal(new Set(data.rows.map((r) => r.sysId)).size, data.rows.length);
    // the total is never below what is listed or counted, and an unread source can never make it exact
    const listed = new Set(ATTENTION_REASONS.flatMap((r) => sources[r].items.map((i) => i.sysId)));
    assert.ok(data.total >= listed.size && data.total >= data.rows.length);
    if (ATTENTION_REASONS.some((r) => !sources[r].ok)) assert.equal(data.totalAtLeast, true);
  }
});

// ---- the audit: the totals of the sections for the same scope ------------------------------------------------------------------------

const taskWorld = ({ rules = [], ...options } = {}) =>
  fakeInstance({
    ...options,
    rules: [
      ...rules,
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      // sc_task: five in progress and two "Resolved" (a state the table does not list: the label decides) that are still active
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.groupBy.join() === 'state', then: [group('state', '2', 'Work in Progress', 5), group('state', '77', 'Resolved', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.groupBy.length, then: [] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.query.includes('state!=77'), then: count(5) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_task' && c.query.includes('active=true'), then: count(7) },
    ],
  });

test('audit 1: the fulfilment\'s open count is the Overview\'s open count for the same tickets (resolved-but-active left out of both)', async () => {
  const overview = (await run('overview', taskWorld(), { tables: ['sc_task'] })).data;
  const fulfilment = (await run('fulfilment', taskWorld(), { tables: ['sc_task'] })).data;
  const workload = (await run('workload', taskWorld(), { tables: ['sc_task'] })).data;
  const open = overview.tiles.find((t) => t.key === 'open').value;
  assert.equal(open, 5, 'seven active, two of them resolved');
  assert.equal(fulfilment.open, open, 'it used to say 7');
  assert.equal(workload.totals.open, open);
  assert.equal(fulfilment.byTable[0].open, 5);
});

test('audit 2: the fulfilment\'s oldest open items leave out the resolved-but-active, as the hand-over\'s do', async () => {
  const inst = taskWorld();
  await run('fulfilment', inst, { tables: ['sc_task'] });
  const oldest = inst.calls.filter((c) => c.kind === 'query' && c.table === 'sc_task' && c.query.includes('ORDERBYopened_at'));
  assert.equal(oldest.length, 1);
  assert.ok(oldest[0].query.includes('state!=77'), oldest[0].query);
});

test('audit 3: the hand-over\'s "handed over often" leaves out the resolved-but-active, as the Workload\'s count does', async () => {
  const inst = leadWorld({ states: [group('state', '2', 'In Progress', 4), group('state', '6', 'Resolved', 2)], open: 4 });
  await run('handover', inst);
  const asked = inst.calls.filter((c) => c.table === 'incident' && c.query.includes('reassignment_count>=') && c.query.includes('sys_updated_on>='));
  assert.ok(asked.length >= 1);
  assert.ok(asked.every((c) => c.query.includes('state!=6')), asked.map((c) => c.query).join('\n'));
  const ping = leadWorld({ states: [group('state', '2', 'In Progress', 4), group('state', '6', 'Resolved', 2)], open: 4 });
  await run('workload', ping);
  assert.ok(ping.calls.filter((c) => c.query.includes('reassignment_count>=')).every((c) => c.query.includes('state!=6')), 'the Workload does the same');
});

const boom = (match) => ({ when: (c) => match(c), then: () => { throw Object.assign(new Error('denied'), { code: 'ACCESS_DENIED' }); } });

test('audit 4: handed-over counts say "at least" when a ticket type could not be counted, and name what failed', async () => {
  const inst = leadWorld({ reassignedCount: 3, reassignedRows: [ticket(1, { reassignments: '4' })], rules: [boom((c) => c.table === 'problem' && c.kind === 'aggregate' && c.query.includes('reassignment_count>='))] });
  const r = await run('workload', inst, { tables: ['incident', 'problem'] });
  assert.equal(r.data.pingPong.count, 3);
  assert.equal(r.data.pingPong.partial, true, 'the problems were not counted');
  assert.ok(r.notes.some((n) => /could not be checked for hand-offs/.test(n)), r.notes.join('|'));
  assert.ok(r.access.some((a) => a.source === 'problem'), 'and the dashboard says which');
  const whole = await run('workload', leadWorld({ reassignedCount: 3 }), { tables: ['incident'] });
  assert.equal(whole.data.pingPong.partial, false);
});

test('audit 5: a ticket type that could not be aged is said, not left out of the ageing in silence', async () => {
  const inst = leadWorld({ open: 10, rules: [boom((c) => c.table === 'problem' && c.kind === 'aggregate' && c.query.includes('opened_at>'))] });
  const r = await run('workload', inst, { tables: ['incident', 'problem'] });
  assert.equal(r.data.ageing.left, 1);
  assert.equal(r.data.ageing.byTable.length, 1);
  assert.ok(r.data.ageing.open < r.data.totals.open + 1);
  assert.ok(r.notes.some((n) => /could not be aged/.test(n)));
  assert.ok(r.access.some((a) => a.source === 'problem'));
  const attention = await run('attention', leadWorld({ open: 10, rules: [boom((c) => c.table === 'problem' && c.kind === 'aggregate' && c.query.includes('opened_at>'))] }), { tables: ['incident', 'problem'] });
  assert.equal(attention.data.counts.oldest.atLeast, true, 'Needs attention takes the same lower bound');
  assert.equal(attention.data.complete, false);
});

test('audit 6: a person the platform hides from you is "not shown to you", never "unassigned"', async () => {
  const hidden = { ...ticket(1, { reassignments: '5' }), assigned_to: cell(id(99), '') };
  const inst = leadWorld({ reassignedCount: 1, reassignedRows: [hidden] });
  const r = await run('workload', inst);
  assert.equal(r.data.pingPong.items[0].owner, 'Not shown to you');
  const empty = leadWorld({ reassignedCount: 1, reassignedRows: [ticket(1, { owner: '' })] });
  assert.equal((await run('workload', empty)).data.pingPong.items[0].owner, '', 'a ticket with nobody is empty (the panel says unassigned)');
});

test('audit 7: an SLA read that stopped early is "at least" on the SLA radar, the Overview tile and the hand-over', async () => {
  const rows = [];
  const tickets = {};
  for (let n = 1; n <= 1000; n += 1) {
    rows.push(slaRow(id(n), 130, true));
    if (n <= 200) tickets[n] = ticket(n);
  }
  const world = () => leadWorld({ slaRows: rows, slaTotal: 5000, tickets, open: 900 });
  const sla = (await run('sla', world())).data;
  assert.equal(sla.atLeast, true);
  const overview = (await run('overview', world())).data;
  const tile = overview.tiles.find((t) => t.key === 'breached');
  assert.equal(tile.atLeast, true);
  assert.match(tile.hint, /At least this many/);
  assert.equal(overview.tiles.find((t) => t.key === 'open').atLeast, undefined, 'only the SLA counts are lower bounds');
  const whole = (await run('overview', leadWorld({ slaRows: [slaRow(id(1), 120, true)], tickets: { 1: ticket(1) } }))).data;
  assert.equal(whole.tiles.find((t) => t.key === 'breached').atLeast, undefined);
});

test('audit 8: Overview, SLA, Workload and hand-over agree on open, waiting and unassigned for one scope', async () => {
  const world = () => busy();
  const o = (await run('overview', world())).data;
  const w = (await run('workload', world())).data;
  const h = (await run('handover', world())).data;
  const tile = (key) => o.tiles.find((t) => t.key === key)?.value;
  assert.equal(w.totals.open, tile('open'));
  assert.equal(w.totals.stale, tile('stale'));
  assert.equal(h.snapshot.open, tile('open'));
  assert.equal(h.snapshot.waiting, tile('waiting'));
  assert.equal(h.snapshot.stale, tile('stale'));
  // every bucket of the ageing adds up to the open count
  assert.equal(w.ageing.buckets.reduce((n, b) => n + b.count, 0), tile('open'));
  // waiting = customer + approval + other, in the hand-over and in the Overview
  assert.equal(h.waiting.customer + h.waiting.approval + h.waiting.other, tile('waiting'));
});

// ---- who sees per-person rows: unchanged today, and decided in one place ------------------------------------------------------------------

test('per-person rows: every member of a group sees them, a report on one\'s own tickets has none, and ONE function says so', async () => {
  assert.equal(showsPersonRows({ kind: 'groups' }), true);
  assert.equal(showsPersonRows({ kind: 'chosen' }), true);
  assert.equal(showsPersonRows({ kind: 'mine' }), false);
  const people = (d) => d.byAssignee.map((r) => r.name);
  const team = (await run('workload', leadWorld({ states: [group('state', '2', 'In Progress', 3)], open: 3, rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: [{ stats: { count: '3' }, groupby_fields: [{ field: 'assigned_to', value: 'u1', display_value: 'Ann Lee' }, { field: 'state', value: '2', display_value: 'In Progress' }] }] }] }))).data;
  assert.deepEqual(people(team), ['Ann Lee'], 'today a member sees the team\'s people');
  const mine = leadWorld({ states: [group('state', '2', 'In Progress', 3)], open: 3 });
  const own = (await run('workload', mine, { scope: { kind: 'mine' } })).data;
  assert.deepEqual(own.byAssignee, []);
  assert.ok(!mine.calls.some((c) => c.groupBy?.includes('assigned_to')), 'and the people are not even asked for');
  // the places that ask are the Workload engine and the SLA radar's owner bars, and only through that function
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/reports/engine/workload.js'), /showsPersonRows\(scope\)/);
  assert.match(read('src/sidepanel/reports/SlaView.jsx'), /const owners = showsPersonRows\(/, 'no second rule in the panel');
});
