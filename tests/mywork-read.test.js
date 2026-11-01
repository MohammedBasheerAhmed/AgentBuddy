const test = require('node:test');
const assert = require('node:assert/strict');
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { readMyWork, countByClass, readPages, createLimiter } from '../src/mywork/read.js';
import { makeMyWorkOps, cleanMyWorkArgs } from '../src/content/ops/mywork.js';
import { OPS } from '../src/content/ops/index.js';
import { HOUR, DAY } from '../src/mywork/time.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const USER = '46d44a23a9fe19810012d100cca80666';
const LOGIN = 'beth.anglin';
const OTHER = '77ad8c0d3b4b4f0d8d8e0cb8d3e2a001';
const GROUP = 'd625dccec0a8016700a222a0f7900d06';
const GROUP2 = 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d';
const hex = (prefix, i) => `${prefix}${i.toString(16)}`.padStart(32, '0').slice(-32);

// One ticket row as the Table API returns it with display values. The customer's login is a dot-walked column, stored here under
// the dotted name (the shared fake returns a column of that name as it is).
function ticket(table, i, over = {}) {
  const prefix = { incident: 'INC', sc_task: 'SCTASK', sn_customerservice_case: 'CS', sn_hr_core_case: 'HRC', u_facilities: 'FAC', problem: 'PRB' }[table] || 'TASK';
  const idPrefix = { incident: '1', sc_task: '2', sn_customerservice_case: '3', sn_hr_core_case: '4', u_facilities: '5', problem: '6' }[table] || '7';
  return {
    sys_id: v(hex(idPrefix, i)),
    number: v(`${prefix}${String(i).padStart(7, '0')}`),
    short_description: v(`${table} ${i}`),
    priority: v('3', '3 - Moderate'),
    state: v('2', 'In Progress'),
    active: v('true'),
    assigned_to: v(USER, 'Beth Anglin'),
    assignment_group: v(GROUP, 'Service Desk'),
    sys_updated_on: v(utc(NOW - (i + 1) * HOUR)),
    opened_at: v(utc(NOW - (i + 1) * DAY)),
    sys_class_name: v(table),
    cmdb_ci: v('', ''),
    ...over,
  };
}

/** A fake instance: the given ticket tables, `task` as their union, and an Aggregate API on `task` grouped by class. */
function instance(tables, behaviour = {}, { refuseAggregate = false } = {}) {
  const ticketTables = Object.keys(tables).filter((t) => (tables[t][0] || {}).sys_class_name);
  const all = { ...tables, task: ticketTables.flatMap((t) => tables[t]) };
  all.sys_user = all.sys_user || [{ sys_id: v(USER), user_name: v(LOGIN) }];
  const deps = fakeDeps(all, behaviour);
  deps.countByColumn = async (table, query, column) => {
    deps.calls.push({ fn: 'countByColumn', table, query, column });
    if (refuseAggregate) throw Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' });
    const rows = await deps.queryTable(table, query, ['sys_id', column], { limit: 100000 });
    deps.calls.pop(); // (the counting read is not a row read)
    const by = new Map();
    for (const r of rows) by.set(r[column], (by.get(r[column]) || 0) + 1);
    return [...by].map(([cls, n]) => ({ stats: { count: String(n) }, groupby_fields: [{ field: column, value: cls, display_value: cls === 'u_facilities' ? 'Facilities request' : cls }] }));
  };
  return deps;
}

const rowsOf = (deps, table) => deps.calls.filter((c) => c.fn === 'queryTable' && c.table === table);
const read = (deps, options = {}) => readMyWork({ userId: USER, userName: LOGIN }, deps, { now: NOW, ...options });

// ---- the P0: every ticket, counted first, read in pages -----------------------------------------------------------------------

test('40 open incidents: all 40 are listed (none lost to a 25-row read), counted first, by priority then oldest update', async () => {
  const incidents = Array.from({ length: 40 }, (_, i) => ticket('incident', i));
  const deps = instance({ incident: incidents });
  const out = await read(deps);
  assert.equal(out.queue.items.length, 40);
  assert.equal(out.queue.total, 40);
  assert.equal(out.queue.more, false);
  assert.deepEqual(out.queue.totals.incident, { shown: 40, total: 40, more: false });
  const count = deps.calls.find((c) => c.fn === 'countByColumn');
  assert.equal(count.table, 'task');
  assert.equal(count.query, `assigned_to=${USER}^active=true`);
  const q = rowsOf(deps, 'incident')[0];
  assert.equal(q.query, `assigned_to=${USER}^active=true^ORDERBYpriority^ORDERBYsys_updated_on^ORDERBYnumber`);
  assert.ok(!q.fields.some((f) => /^(description|comments|work_notes|close_notes)$/.test(f)), 'no free text but the title');
});

test('over the cap: read in pages up to it, then "25 of 40" and a filtered list in ServiceNow', async () => {
  const incidents = Array.from({ length: 40 }, (_, i) => ticket('incident', i));
  const deps = instance({ incident: incidents });
  const out = await read(deps, { limits: { perClass: 25, pageSize: 10 } });
  assert.equal(out.queue.items.length, 25);
  assert.deepEqual(out.queue.totals.incident, { shown: 25, total: 40, more: true });
  assert.equal(out.queue.total, 40);
  assert.equal(out.queue.more, true);
  assert.deepEqual(rowsOf(deps, 'incident').map((c) => [c.options.offset, c.options.limit]), [[0, 10], [10, 10], [20, 5]]);
  assert.equal(out.queue.listQuery, `assigned_to=${USER}^active=true`);
  // The least recently touched are in what was read (oldest update first inside one priority).
  assert.ok(out.queue.items.some((i) => i.number === 'INC0000039'));
});

test('every class with something for me is read, custom ones too, from its own table; empty classes are not asked', async () => {
  const deps = instance({
    incident: [ticket('incident', 1)],
    sc_task: [ticket('sc_task', 1), ticket('sc_task', 2, { assigned_to: v(OTHER, 'Dave') })],
    u_facilities: [ticket('u_facilities', 1)],
    problem: [ticket('problem', 1, { assigned_to: v(OTHER, 'Dave') })],
  });
  const out = await read(deps);
  assert.deepEqual(out.queue.items.map((i) => i.number).sort(), ['FAC0000001', 'INC0000001', 'SCTASK0000001']);
  assert.equal(rowsOf(deps, 'problem').length, 0, 'a class with no ticket for me is not read');
  assert.equal(out.queue.names.u_facilities, 'Facilities request');
  assert.ok(!rowsOf(deps, 'u_facilities')[0].fields.some((f) => f.includes('.')), 'an unknown class gets the common columns only');
});

test('without the count on `task`: each table of my profiles is counted on its own; a missing table says nothing', async () => {
  const err = Object.assign(new Error('Table API query on "sn_customerservice_case" failed (400): Invalid table sn_customerservice_case'), {});
  const deps = instance({ incident: [ticket('incident', 1)] }, { errors: { sn_customerservice_case: err } }, { refuseAggregate: true });
  const out = await read(deps, { profiles: ['it', 'csm'] });
  assert.deepEqual(out.queue.items.map((i) => i.number), ['INC0000001']);
  const counted = new Set(deps.calls.filter((c) => c.fn === 'queryTable' && c.options.limit === 100000).map((c) => c.table));
  assert.ok(counted.has('incident') && counted.has('sn_customerservice_case') && counted.has('sc_task'));
  assert.ok(!out.access.some((a) => a.source === 'sn_customerservice_case'), JSON.stringify(out.access));
  assert.ok(!JSON.stringify(out).includes('Invalid table'), 'no raw API text anywhere');
});

test('a table I cannot read is one plain note; any other failure too, never the API text', async () => {
  const boom = new Error('Table API query on "incident" failed (500): java.lang.NullPointerException at line 4');
  const denied = instance({ incident: [ticket('incident', 1)], sn_customerservice_case: [ticket('sn_customerservice_case', 1)] }, { denied: ['sn_customerservice_case'] });
  const a = await read(denied);
  assert.deepEqual(a.access.find((x) => x.source === 'sn_customerservice_case'), { source: 'sn_customerservice_case', status: 'denied', note: 'You cannot read cases.' });
  assert.equal(a.queue.items.length, 1);
  const broken = instance({ incident: [ticket('incident', 1)], sc_task: [ticket('sc_task', 1)] }, { errors: { incident: boom } });
  const b = await read(broken);
  assert.equal(b.access.find((x) => x.source === 'incident').note, 'Incidents could not be read just now.');
  assert.ok(!JSON.stringify(b).includes('NullPointer'));
});

test('a class the organisation blocks is not read at all, and says whose rule it is', async () => {
  const deps = instance({ incident: [ticket('incident', 1)], problem: [ticket('problem', 1)] });
  deps.isBlocked = (t) => t === 'problem';
  const out = await read(deps);
  assert.equal(rowsOf(deps, 'problem').length, 0);
  assert.deepEqual(out.access.find((a) => a.source === 'problem'), { source: 'problem', status: 'blocked', note: 'Your organisation does not allow Agent Buddy to read problems.' });
});

test('HR cases: only with HR content allowed and the HR profile on; otherwise a count and why', async () => {
  const tables = () => ({ incident: [ticket('incident', 1)], sn_hr_core_case: [ticket('sn_hr_core_case', 1), ticket('sn_hr_core_case', 2)] });
  const off = instance(tables());
  const a = await read(off);
  assert.equal(rowsOf(off, 'sn_hr_core_case').length, 0);
  assert.match(a.access.find((x) => x.source === 'sn_hr_core_case').note, /^2 HR cases are not listed: your organisation keeps/);
  const one = await read(instance({ sn_hr_core_case: [ticket('sn_hr_core_case', 1)] }));
  assert.match(one.access.find((x) => x.source === 'sn_hr_core_case').note, /^1 HR case is not listed/);
  const noProfile = instance(tables());
  const b = await read(noProfile, { allowSensitive: true });
  assert.equal(rowsOf(noProfile, 'sn_hr_core_case').length, 0);
  assert.match(b.access.find((x) => x.source === 'sn_hr_core_case').note, /turn on the HR profile/);
  const on = instance(tables());
  const c = await read(on, { allowSensitive: true, profiles: ['hr'] });
  assert.equal(c.queue.items.filter((i) => i.type === 'sn_hr_core_case').length, 2);
  assert.ok(!c.access.some((x) => x.source === 'sn_hr_core_case'));
});

// ---- states, SLAs, markers ------------------------------------------------------------------------------------------------------

test('resolved-but-active tickets are folded as resolved and their comments are not read', async () => {
  const resolved = ticket('incident', 1, { state: v('6', 'Resolved') });
  const live = ticket('incident', 2);
  const deps = instance({ incident: [resolved, live] });
  const out = await read(deps);
  assert.equal(out.queue.items.find((i) => i.number === 'INC0000001').work, 'resolved');
  assert.equal(out.queue.items[out.queue.items.length - 1].number, 'INC0000001', 'ranked after live work');
  const journal = rowsOf(deps, 'sys_journal_field')[0];
  assert.ok(!journal.query.includes(resolved.sys_id.value));
  assert.ok(journal.query.includes(live.sys_id.value));
});

test('who wrote last: one read of authors and times (no text); "customer replied" is the caller, matched by login', async () => {
  const a = ticket('incident', 1, { state: v('3', 'On Hold'), hold_reason: v('1', 'Awaiting Caller'), 'caller_id.user_name': v('abel.tuter') });
  const b = ticket('incident', 2, { 'caller_id.user_name': v('abel.tuter') });
  const journal = [
    { sys_id: 'j1', name: 'incident', element: 'comments', element_id: a.sys_id.value, sys_created_on: utc(NOW - 2 * DAY), sys_created_by: LOGIN, value: 'Could you send the error?' },
    { sys_id: 'j2', name: 'incident', element: 'comments', element_id: a.sys_id.value, sys_created_on: utc(NOW - HOUR), sys_created_by: 'abel.tuter', value: 'Here it is' },
    { sys_id: 'j3', name: 'incident', element: 'work_notes', element_id: b.sys_id.value, sys_created_on: utc(NOW - HOUR), sys_created_by: 'abel.tuter', value: 'not a comment' },
    { sys_id: 'j4', name: 'incident', element: 'comments', element_id: b.sys_id.value, sys_created_on: utc(NOW - 5 * DAY), sys_created_by: LOGIN, value: 'Working on it' },
  ];
  const deps = instance({ incident: [a, b], sys_journal_field: journal });
  const out = await read(deps);
  const call = rowsOf(deps, 'sys_journal_field')[0];
  assert.match(call.query, /^element=comments\^element_idIN/);
  assert.match(call.query, /\^ORDERBYDESCsys_created_on$/);
  assert.deepEqual(call.fields, ['element_id', 'sys_created_on', 'sys_created_by']);
  const ia = out.queue.items.find((i) => i.number === 'INC0000001');
  const ib = out.queue.items.find((i) => i.number === 'INC0000002');
  assert.equal(ia.marker.replied, 'customer');
  assert.equal(ia.work, 'waiting-customer');
  assert.equal(ib.marker.replied, '');
  assert.equal(ib.marker.lastMineAt, NOW - 5 * DAY);
  assert.ok(!JSON.stringify(out).includes('abel.tuter'), 'the customer\'s login never leaves the content script');
  assert.equal(out.queue.items[0].number, 'INC0000001', 'the customer replied: ranked first');
});

test('comments not readable: markers unknown and one note; my login unknown: looked up once', async () => {
  const deps = instance({ incident: [ticket('incident', 1)] }, { denied: ['sys_journal_field'] });
  const out = await readMyWork({ userId: USER, userName: '' }, deps, { now: NOW });
  assert.equal(rowsOf(deps, 'sys_user').length, 1);
  assert.equal(out.queue.items[0].marker.known, false);
  assert.match(out.access.find((a) => a.source === 'sys_journal_field').note, /Who wrote last is not visible to you/);
});

test('SLAs in one batch: time left on every ticket, paused ones paused, no SLA access is a note', async () => {
  const a = ticket('incident', 1);
  const b = ticket('incident', 2);
  const slas = [
    { sys_id: 's1', task: v(a.sys_id.value), sla: v('d', 'Resolution'), stage: v('in_progress', 'In progress'), has_breached: v('false'), percentage: v('40'), business_percentage: v('40'), planned_end_time: v(utc(NOW + 2 * HOUR + 600000)), active: v('true') },
    { sys_id: 's2', task: v(b.sys_id.value), sla: v('d', 'Resolution'), stage: v('paused', 'Paused'), has_breached: v('false'), percentage: v('90'), planned_end_time: v(utc(NOW - HOUR)), active: v('true') },
  ];
  const deps = instance({ incident: [a, b], task_sla: slas });
  const out = await read(deps);
  assert.equal(rowsOf(deps, 'task_sla').length, 1);
  const ia = out.queue.items.find((i) => i.sysId === a.sys_id.value);
  const ib = out.queue.items.find((i) => i.sysId === b.sys_id.value);
  assert.deepEqual([ia.sla.risk, ia.sla.dueAt], ['ok', NOW + 2 * HOUR + 600000]);
  assert.equal(ib.sla.risk, 'paused');
  const denied = instance({ incident: [a] }, { denied: ['task_sla'] });
  const d = await read(denied);
  assert.match(d.access.find((x) => x.source === 'task_sla').note, /SLA information is not available/);
});

// ---- approvals and the group queue --------------------------------------------------------------------------------------------

test('approvals waiting on me: requested ones, with titles only where the class may be read', async () => {
  const ritm = ticket('sc_task', 9, { assigned_to: v(OTHER, 'Dave') });
  const hr = ticket('sn_hr_core_case', 9, { assigned_to: v(OTHER, 'Dave') });
  const approval = (i, task, cls, state = 'requested') => ({ sys_id: v(hex('9', i)), approver: v(USER), state: v(state), sysapproval: v(task.sys_id.value, task.number.value), source_table: v(cls), sys_created_on: v(utc(NOW - i * DAY)), due_date: v('') });
  const deps = instance({ sc_task: [ritm], sn_hr_core_case: [hr], sysapproval_approver: [approval(1, ritm, 'sc_task'), approval(2, hr, 'sn_hr_core_case'), approval(3, ritm, 'sc_task', 'approved')] });
  const out = await read(deps);
  assert.equal(rowsOf(deps, 'sysapproval_approver')[0].query, `approver=${USER}^state=requested^ORDERBYsys_created_on`);
  // Oldest request first; the HR one without its title.
  assert.deepEqual(out.approvals.items.map((a) => [a.number, a.title]), [['HRC0000009', ''], ['SCTASK0000009', 'sc_task 9']]);
  assert.equal(out.approvals.total, 2);
  assert.equal(out.approvals.items[0].table, 'sysapproval_approver');
  const titleRead = rowsOf(deps, 'task').find((c) => c.query.startsWith('sys_idIN'));
  assert.ok(!titleRead.query.includes(hr.sys_id.value), 'no HR title is read without HR content allowed');
});

test('unassigned in my groups: the group queue, oldest first, assigned ones left out', async () => {
  // (group.active is the dot-walked column the membership read filters on; the shared fake returns a column of that name as it is)
  const member = (id, group, name, active = 'true') => ({ sys_id: v(id), user: v(USER), group: v(group, name), 'group.active': v(active) });
  const members = [member('m1', GROUP, 'Service Desk'), member('m2', GROUP2, 'Network'), member('m3', 'f'.repeat(32), 'Retired team', 'false')];
  const young = ticket('incident', 3, { assigned_to: v('', ''), opened_at: v(utc(NOW - DAY)) });
  const old = ticket('sc_task', 4, { assigned_to: v('', ''), assignment_group: v(GROUP2, 'Network'), opened_at: v(utc(NOW - 6 * DAY)) });
  const elsewhere = ticket('incident', 5, { assigned_to: v('', ''), assignment_group: v('e'.repeat(32), 'Other') });
  const deps = instance({ incident: [ticket('incident', 1), young, elsewhere], sc_task: [old], sys_user_grmember: members });
  const out = await read(deps);
  assert.deepEqual(out.groups.items.map((i) => i.number), ['SCTASK0000004', 'INC0000003']);
  assert.equal(out.groups.items[0].group.name, 'Network');
  assert.equal(out.groups.total, 2);
  assert.deepEqual(out.groups.groups.map((g) => g.name), ['Service Desk', 'Network']);
  assert.equal(out.groups.listQuery, `assignment_groupIN${GROUP},${GROUP2}^assigned_toISEMPTY^active=true^ORDERBYopened_at`);
  assert.deepEqual(out.queue.items.map((i) => i.number), ['INC0000001']);
});

test('group memberships not visible: the group queue says so, the rest still works', async () => {
  const deps = instance({ incident: [ticket('incident', 1)] }, { denied: ['sys_user_grmember'] });
  const out = await read(deps);
  assert.equal(out.groups.items.length, 0);
  assert.match(out.access.find((a) => a.source === 'sys_user_grmember').note, /group memberships are not visible/);
  assert.equal(out.queue.items.length, 1);
});

// ---- empty, errors, the operation -------------------------------------------------------------------------------------------

test('an empty queue says what it means', async () => {
  const nothing = await read(instance({ incident: [ticket('incident', 1, { assigned_to: v(OTHER, 'Dave') })] }));
  assert.deepEqual([nothing.queue.items.length, nothing.queue.empty], [0, 'nothing']);
  const some = await read(instance({ incident: [ticket('incident', 1)] }));
  assert.equal(some.queue.empty, null);
  // Nothing could be counted or read at all.
  const unread = await read(instance({ incident: [ticket('incident', 1)] }, { denied: ['incident', 'incident_task', 'problem', 'problem_task', 'change_request', 'change_task', 'sc_req_item', 'sc_task'] }, { refuseAggregate: true }));
  assert.equal(unread.queue.empty, 'unread');
});

test('a lost session ends the whole read; a missing user id is refused before any read', async () => {
  const deps = instance({ incident: [ticket('incident', 1)] }, { expired: ['task_sla'] });
  await assert.rejects(read(deps), /session has expired/);
  const none = instance({ incident: [] });
  await assert.rejects(readMyWork({ userId: 'nope' }, none, { now: NOW }), /who is signed in/);
  assert.equal(none.calls.length, 0);
});

test('counting falls back table by table; a failed count is unknown, not zero', async () => {
  const deps = { countRecords: async (t) => { if (t === 'b') throw new Error('x'); return t === 'a' ? 3 : 0; } };
  const run = createLimiter(2);
  const got = await countByClass(deps, 'q', ['a', 'b', 'c'], run);
  assert.equal(got.source, 'tables');
  assert.deepEqual([...got.counts], [['a', 3], ['b', null], ['c', 0]]);
});

test('paging stops at a short page; a page past the count is not asked', async () => {
  const calls = [];
  const rows = Array.from({ length: 7 }, (_, i) => ({ sys_id: hex('8', i) }));
  const deps = { queryTable: async (t, q, f, o) => { calls.push(o.offset); return rows.slice(o.offset, o.offset + o.limit); } };
  const run = createLimiter(1);
  const a = await readPages(deps, 'incident', 'q', [], { cap: 100, pageSize: 5, total: null, run });
  assert.deepEqual([a.rows.length, a.ended, calls], [7, true, [0, 5]]);
  calls.length = 0;
  const b = await readPages(deps, 'incident', 'q', [], { cap: 100, pageSize: 5, total: 5, run });
  assert.deepEqual([b.rows.length, b.ended, calls], [5, true, [0]]);
});

test('the operation: profiles validated, the user from the page, HR as the guard decided', async () => {
  assert.deepEqual(cleanMyWorkArgs({ profiles: ['it', 'hr', 'x', 'it', 5] }), { profiles: ['it', 'hr'] });
  assert.deepEqual(cleanMyWorkArgs(undefined), { profiles: [] });
  assert.equal(typeof OPS.myWork, 'function');
  const deps = instance({ incident: [ticket('incident', 1)], sn_hr_core_case: [ticket('sn_hr_core_case', 1)] });
  const ops = makeMyWorkOps({ whoAmI: async () => ({ userId: USER, userName: LOGIN }), now: () => NOW });
  // The panel asks for HR (allowSensitive in its args) but the guard said no: the operation goes by the guard.
  const out = await ops.myWork({ profiles: ['hr'], allowSensitive: true }, { deps, allowSensitive: false });
  assert.ok(!out.queue.items.some((i) => i.type === 'sn_hr_core_case'));
  const nobody = makeMyWorkOps({ whoAmI: async () => ({ userId: '' }) });
  await assert.rejects(nobody.myWork({}, { deps }), /who is signed in/);
});
