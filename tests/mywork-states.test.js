// My work and the one meaning of a state (audit of 2026-11-07): F5 (no customer follow-up on a catalog task), F9 (My work reads the
// state through src/domain/states.js), F17 (the unassigned queue of my groups is ordered for picking work up).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { readMyWork, itemOf } from '../src/mywork/read.js';
import { workState } from '../src/mywork/states.js';
import { columnsFor, reachesCustomer, hasCustomer } from '../src/mywork/tables.js';
import { followUps } from '../src/mywork/followups.js';
import { compareGroupQueue, rankGroupQueue } from '../src/mywork/rank.js';
import { groupChip, statusChip } from '../src/sidepanel/mywork/parts.jsx';
import { HOUR, DAY } from '../src/mywork/time.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const USER = '46d44a23a9fe19810012d100cca80666';
const GROUP = 'd625dccec0a8016700a222a0f7900d06';
const LOGIN = 'beth.anglin';

// ---- F9: the state through the one reader ---------------------------------------------------------------------------------------

test('workState: the one reader gives My work its five words, by the stored value first', () => {
  const w = (over) => workState({ table: 'incident', state: '', stateValue: '', ...over });
  assert.equal(w({ stateValue: '6' }), 'resolved');
  assert.equal(w({ table: 'change_request', stateValue: '-3', state: 'Authorize' }), 'on-hold', 'a change that waits for a decision');
  assert.equal(w({ table: 'change_request', stateValue: '0', state: 'Review' }), 'open', 'the review of a change is still work');
  assert.equal(w({ table: 'change_request', stateValue: '4' }), 'resolved', 'cancelled but still active');
  assert.equal(w({ table: 'sc_task', stateValue: '4', state: 'Closed Incomplete' }), 'resolved');
  assert.equal(w({ table: 'sc_task', stateValue: '-5', state: 'Pending' }), 'on-hold');
  assert.equal(w({ table: 'sc_task', stateValue: '1', state: 'Open' }), 'open');
  assert.equal(w({ table: 'sc_req_item', stateValue: '1', state: 'Open', stage: 'waiting_for_approval' }), 'on-hold', 'a requested item that waits for its approval');
  assert.equal(w({ table: 'sc_req_item', stateValue: '1', state: 'Open', stage: 'fulfillment' }), 'open');
  assert.equal(w({ table: 'sn_customerservice_case', stateValue: '18', state: 'Awaiting Info' }), 'waiting-customer');
  assert.equal(w({ table: 'sn_hr_core_case', state: 'Ready' }), 'new');
  assert.equal(w({ table: 'sc_req_item', state: 'Requested' }), 'new');
});

test('workState: a state in German or Arabic is understood, by its value or its words', () => {
  const w = (over) => workState({ table: 'incident', ...over });
  assert.equal(w({ state: 'Wartend', stateValue: '3', holdReason: 'Warten auf Anrufer', holdReasonValue: '1' }), 'waiting-customer');
  assert.equal(w({ state: 'Wartend', stateValue: '3', holdReason: 'Warten auf Lieferant', holdReasonValue: '4' }), 'on-hold');
  assert.equal(w({ state: 'Gelöst', stateValue: '6' }), 'resolved');
  assert.equal(w({ state: 'قيد الانتظار', stateValue: '3', holdReasonValue: '1' }), 'waiting-customer');
  assert.equal(w({ state: 'تم الحل' }), 'resolved', 'by its words, with no value');
  assert.equal(w({ state: 'Geschlossen abgeschlossen', table: 'sc_task' }), 'resolved');
  assert.equal(w({ state: 'In Bearbeitung', stateValue: '2' }), 'open');
  // a state nobody can read is live work
  assert.equal(w({ state: 'Zzz', stateValue: '42' }), 'open');
});

test('a state with only its stored number to show is not drawn as a number', () => {
  const row = { sys_id: v('a'.repeat(32)), number: v('INC1'), short_description: v('x'), priority: v('2', '2 - High'), state: v('-5', '-5') };
  const item = itemOf(row, 'sc_task');
  assert.equal(item.state, '', 'the chip says nothing instead of "-5"');
  assert.equal(item.work, 'on-hold', 'but the value still decides what it means');
  assert.deepEqual(statusChip(item), { text: 'On hold', tone: 'quiet' });
  assert.equal(itemOf({ ...row, state: v('1', 'Open') }, 'sc_task').state, 'Open');
});

test('a requested item is read with its stage; a catalog task is not', () => {
  assert.ok(columnsFor('sc_req_item').includes('stage'));
  assert.ok(!columnsFor('sc_task').includes('stage'));
  assert.ok(!columnsFor('incident').includes('stage'));
  assert.ok(FIELDS_BY_KIND.requested_item.includes('stage'), 'the stage is on the field list of a requested item (the field allowlist)');
  const row = { sys_id: v('a'.repeat(32)), number: v('RITM1'), short_description: v('x'), priority: v('3'), state: v('1', 'Open'), stage: v('waiting_for_approval', 'Waiting for Approval') };
  assert.equal(itemOf(row, 'sc_req_item').work, 'on-hold');
});

// ---- F5: no word to "the customer" on a catalog task -----------------------------------------------------------------------------

const BASE_MARKER = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '', customerKnown: true };
let n = 0;
const item = (over = {}) => {
  n += 1;
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, '0'), number: `T${n}`, title: 'A title', work: 'open', updatedAt: NOW - HOUR, openedAt: NOW - 10 * DAY, marker: BASE_MARKER, ...over };
};

test('a catalog task is never "No update to the customer": the requester reads the requested item, not its tasks', () => {
  const task = item({ table: 'sc_task', type: 'sc_task' }); // opened 10 days ago, nobody wrote: every old sc_task was listed before
  assert.deepEqual(followUps([task], { now: NOW, days: 3 }), []);
  // ... and its other follow-ups are not claimed either
  const waiting = item({ table: 'sc_task', type: 'sc_task', work: 'waiting-customer', updatedAt: NOW - 9 * DAY });
  const answered = item({ table: 'sc_task', type: 'sc_task', work: 'waiting-customer', marker: { ...BASE_MARKER, lastCustomerAt: NOW - HOUR, lastAt: NOW - HOUR, replied: 'customer' } });
  assert.deepEqual(followUps([waiting, answered], { now: NOW, days: 3 }), []);
  assert.equal(reachesCustomer('sc_task'), false);
  // the requester is still known for the row (the VIP flag, the "customer replied" chip when they do write there)
  assert.equal(hasCustomer('sc_task'), true);
});

test('incidents, requested items, cases and HR cases keep their follow-ups; so does a class we do not know', () => {
  const kinds = [
    ['incident', 'update'],
    ['sc_req_item', 'update'],
    ['sn_customerservice_case', 'update'],
    ['sn_hr_core_case', 'update'],
    ['change_request', 'update'],
  ];
  for (const [table, kind] of kinds) {
    const got = followUps([item({ table, type: table })], { now: NOW, days: 3 });
    assert.deepEqual(got.map((f) => f.kind), [kind], table);
    assert.equal(reachesCustomer(table), true, table);
  }
  const waiting = item({ table: 'u_facilities', type: 'u_facilities', work: 'waiting-customer', updatedAt: NOW - 9 * DAY });
  assert.deepEqual(followUps([waiting], { now: NOW, days: 3 }).map((f) => f.kind), ['reminder'], 'a custom class that waits on its customer');
});

test('a problem and the tasks of another ticket are team work: no word to a customer', () => {
  for (const table of ['problem', 'problem_task', 'incident_task', 'change_task', 'sn_customerservice_task', 'sn_hr_core_task']) {
    assert.equal(reachesCustomer(table), false, table);
    const waiting = item({ table, type: table, work: 'waiting-customer', updatedAt: NOW - 9 * DAY });
    const live = item({ table, type: table });
    assert.deepEqual(followUps([waiting, live], { now: NOW, days: 3 }), [], table);
  }
});

// ---- F17: the unassigned queue of my groups --------------------------------------------------------------------------------------

const sla = (risk) => ({ name: 'Resolution', breached: risk === 'breached', paused: risk === 'paused', percentage: 10, basis: 'business', dueAt: NOW + 5 * HOUR, risk });
const q = (number, over = {}) => ({ number, priority: '3 - Moderate', openedAt: NOW - DAY, work: 'open', sla: null, ...over });

test('the group queue: SLA breached, then at risk, then priority, then the one that waited longest', () => {
  const list = [
    q('OLD-P3', { openedAt: NOW - 9 * DAY }),
    q('NEW-P1', { priority: '1 - Critical', openedAt: NOW - HOUR }),
    q('AT-RISK-P4', { priority: '4 - Low', sla: sla('at-risk') }),
    q('BREACHED-P5', { priority: '5 - Planning', sla: sla('breached') }),
    q('OLD-P1', { priority: '1 - Critical', openedAt: NOW - 5 * DAY }),
    q('PAUSED-P2', { priority: '2 - High', sla: sla('paused') }),
    q('OK-P2', { priority: '2 - High', sla: sla('ok'), openedAt: NOW - 2 * DAY }),
  ];
  assert.deepEqual(rankGroupQueue(list).map((i) => i.number), ['BREACHED-P5', 'AT-RISK-P4', 'OLD-P1', 'NEW-P1', 'OK-P2', 'PAUSED-P2', 'OLD-P3']);
  // ... the same whatever order they came in
  assert.deepEqual(rankGroupQueue([...list].reverse()).map((i) => i.number), rankGroupQueue(list).map((i) => i.number));
  // (the list given is not changed)
  assert.equal(list[0].number, 'OLD-P3');
});

test('the group queue: work that is ready goes before work on hold, inside the same SLA state', () => {
  const list = [
    q('PENDING-P1', { priority: '1 - Critical', work: 'on-hold' }),
    q('READY-P3', { priority: '3 - Moderate' }),
    q('BREACHED-PENDING', { work: 'on-hold', sla: sla('breached') }),
    q('AWAITING-P2', { priority: '2 - High', work: 'waiting-customer' }),
  ];
  assert.deepEqual(rankGroupQueue(list).map((i) => i.number), ['BREACHED-PENDING', 'READY-P3', 'PENDING-P1', 'AWAITING-P2']);
});

test('the group queue: no priority, no opening time and equal tickets are ordered, by their number last', () => {
  const list = [q('B', { priority: '', openedAt: null }), q('A', { priority: '', openedAt: null }), q('C', { priority: '3', openedAt: NOW - DAY })];
  assert.deepEqual(rankGroupQueue(list).map((i) => i.number), ['C', 'A', 'B']);
  assert.deepEqual(rankGroupQueue(null), []);
  assert.equal(compareGroupQueue(q('X'), q('X')), 0);
});

// ---- F17 through the read ------------------------------------------------------------------------------------------------------

function ticket(table, i, over = {}) {
  const prefix = { incident: 'INC', sc_task: 'SCTASK' }[table] || 'TASK';
  const idPrefix = { incident: '1', sc_task: '2' }[table] || '7';
  return {
    sys_id: v(`${idPrefix}${i.toString(16)}`.padStart(32, '0').slice(-32)),
    number: v(`${prefix}${String(i).padStart(7, '0')}`),
    short_description: v(`${table} ${i}`),
    priority: v('3', '3 - Moderate'),
    state: v('2', 'In Progress'),
    active: v('true'),
    assigned_to: v('', ''),
    assignment_group: v(GROUP, 'Service Desk'),
    sys_updated_on: v(utc(NOW - (i + 1) * HOUR)),
    opened_at: v(utc(NOW - (i + 1) * DAY)),
    sys_class_name: v(table),
    cmdb_ci: v('', ''),
    ...over,
  };
}

function instance(tables) {
  const ticketTables = Object.keys(tables).filter((t) => (tables[t][0] || {}).sys_class_name);
  const all = { ...tables, task: ticketTables.flatMap((t) => tables[t]) };
  all.sys_user = [{ sys_id: v(USER), user_name: v(LOGIN) }];
  all.sys_user_grmember = [{ sys_id: v('m1'), user: v(USER), group: v(GROUP, 'Service Desk'), 'group.active': v('true') }];
  const deps = fakeDeps(all, {});
  deps.countByColumn = async (table, query, column) => {
    deps.calls.push({ fn: 'countByColumn', table, query, column });
    const rows = await deps.queryTable(table, query, ['sys_id', column], { limit: 100000 });
    deps.calls.pop();
    const by = new Map();
    for (const r of rows) by.set(r[column], (by.get(r[column]) || 0) + 1);
    return [...by].map(([cls, count]) => ({ stats: { count: String(count) }, groupby_fields: [{ field: column, value: cls, display_value: cls }] }));
  };
  return deps;
}

const slaRow = (task, over = {}) => ({ sys_id: `s-${task.value}`, task, sla: v('d', 'Resolution'), stage: v('in_progress', 'In progress'), has_breached: v('false'), percentage: v('10'), business_percentage: v('10'), planned_end_time: v(utc(NOW + 10 * HOUR)), active: v('true'), ...over });

test('the unassigned queue is read most urgent first, then ordered by SLA, readiness, priority and age', async () => {
  const young = ticket('incident', 1, { priority: v('1', '1 - Critical'), opened_at: v(utc(NOW - HOUR)) });
  const old = ticket('incident', 2, { opened_at: v(utc(NOW - 20 * DAY)) });
  const pending = ticket('sc_task', 3, { priority: v('1', '1 - Critical'), state: v('-5', 'Pending'), opened_at: v(utc(NOW - 30 * DAY)) });
  const breached = ticket('incident', 4, { priority: v('5', '5 - Planning') });
  const deps = instance({
    incident: [young, old, breached],
    sc_task: [pending],
    task_sla: [slaRow(breached.sys_id, { has_breached: v('true'), percentage: v('120'), planned_end_time: v(utc(NOW - HOUR)) })],
  });
  const out = await readMyWork({ userId: USER, userName: LOGIN }, deps, { now: NOW });
  const numbers = out.groups.items.map((i) => i.number);
  assert.deepEqual(numbers, ['INC0000004', 'INC0000001', 'INC0000002', 'SCTASK0000003'], 'breached first; ready work before the pending task; priority; age');
  assert.equal(out.groups.items[0].sla.risk, 'breached');
  assert.equal(out.groups.items[3].work, 'on-hold');
  // the read itself asks for the most urgent first (so a new critical ticket is never lost behind old ones), with columns it always read
  const reads = deps.calls.filter((c) => c.fn === 'queryTable' && c.query.includes('assigned_toISEMPTY') && (c.table === 'incident' || c.table === 'sc_task'));
  assert.ok(reads.length >= 2);
  for (const call of reads) assert.match(call.query, /\^ORDERBYpriority\^ORDERBYopened_at\^ORDERBYnumber$/);
  assert.equal(out.groups.listQuery.endsWith('^ORDERBYopened_at'), true, 'the link to the full list in ServiceNow is unchanged');
});

test('the group queue row shows a chip only for work that is on hold', () => {
  assert.equal(groupChip({ work: 'open', state: 'In Progress' }), null);
  assert.equal(groupChip({ work: 'new', state: 'New' }), null);
  assert.deepEqual(groupChip({ work: 'on-hold', state: 'Pending', holdReason: '' }), { text: 'Pending', tone: 'quiet' });
  assert.deepEqual(groupChip({ work: 'on-hold', state: 'On Hold', holdReason: 'Awaiting Vendor' }), { text: 'On hold: Awaiting Vendor', tone: 'quiet' });
  assert.deepEqual(groupChip({ work: 'waiting-customer', state: 'On Hold' }), { text: 'Waiting on customer', tone: 'quiet' });
  // nobody owns these tickets, so no "Customer replied" even if a marker were there
  assert.equal(groupChip({ work: 'on-hold', state: 'Pending', marker: { replied: 'customer' } }).text, 'Pending');
});
