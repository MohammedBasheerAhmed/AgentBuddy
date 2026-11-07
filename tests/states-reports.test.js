// The Team reports and the one meaning of a state (audit of 2026-11-07, F9, F20): states are filed by their stored value for the table,
// a state with no label is never drawn as a number, and the fulfilment section covers requests, case tasks, HR tasks and other classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReport, createRuntime, resultTables } from '../src/reports/engine/index.js';
import { REPORT_TABLES, STANDARD_TABLE_IDS, isSensitiveReportTable } from '../src/reports/engine/constants.js';
import { stateClass, stateName, resolvedStates, normalizeTables } from '../src/reports/engine/common.js';
import { waitingStates } from '../src/reports/engine/overview.js';
import { foldByOwner } from '../src/reports/engine/workload.js';
import { stateRows, otherKinds, FULFILMENT_TABLES } from '../src/reports/engine/fulfilment.js';
import { waitingKind } from '../src/reports/engine/handover.js';
import { stateShown } from '../src/reports/shown.js';
import { fakeInstance, cell, group, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const run = (request, instance, extra = {}) => runReport(request, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...extra });
const key = (value, display) => ({ field: 'state', value, display });
const g = (value, display, n) => ({ count: n, avg: {}, keys: [key(value, display)] });

// ---- the class of a state ------------------------------------------------------------------------------------------------------

test('stateClass: the stored value of the table decides, the words of the label give way', () => {
  // by label alone (as before, but one answer for the contested words)
  const cases = { New: 'new', 'In Progress': 'working', Open: 'working', 'On Hold': 'waiting', Pending: 'waiting', Resolved: 'resolved', Closed: 'resolved', Cancelled: 'resolved', Assess: 'working', Authorize: 'waiting', Scheduled: 'working', Review: 'working', Requested: 'new', Zzz: 'other', '': 'other' };
  for (const [label, cls] of Object.entries(cases)) assert.equal(stateClass(label), cls, label);
  // by value for the table
  assert.equal(stateClass('Wartend', { table: 'incident', value: '3' }), 'waiting');
  assert.equal(stateClass('', { table: 'incident', value: '6' }), 'resolved');
  assert.equal(stateClass('Zzz', { table: 'sc_task', value: '-5' }), 'waiting');
  assert.equal(stateClass('Zzz', { table: 'sc_task', value: '4' }), 'resolved', 'closed incomplete is finished');
  assert.equal(stateClass('Geschlossen abgeschlossen', { table: 'sc_task' }), 'resolved');
  assert.equal(stateClass('قيد الانتظار', { table: 'incident' }), 'waiting');
  // the same number on two tables
  assert.equal(stateClass('', { table: 'incident', value: '3' }), 'waiting');
  assert.equal(stateClass('', { table: 'sc_task', value: '3' }), 'resolved');
});

test('resolved and waiting states of one table: the table makes the stored values count', () => {
  const groups = [g('3', 'Zzz', 4), g('2', 'In Progress', 2)];
  assert.equal(resolvedStates(groups, 'sc_task').count, 4, 'on a task 3 is Closed Complete');
  assert.equal(resolvedStates(groups, 'incident').count, 0, 'on an incident 3 is On Hold');
  assert.equal(waitingStates(groups, 'incident').count, 4);
  assert.deepEqual(waitingStates(groups, 'incident').values, ['3']);
  assert.equal(waitingStates(groups, 'sc_task').count, 0);
  // no table given: the words only, as before
  assert.equal(resolvedStates([g('6', 'Resolved', 3)]).count, 3);
  assert.deepEqual(resolvedStates([g('6', 'Resolved', 3)]), { count: 3, values: ['6'], labels: ['Resolved'] });
});

test('workload rows fold by the class of the state of each table', () => {
  const row = (who, whoId, value, display, n) => ({ count: n, avg: {}, keys: [{ field: 'assigned_to', value: whoId, display: who }, key(value, display)] });
  const rows = foldByOwner(
    [
      { table: 'incident', groups: [row('Ann Lee', 'a1', '3', 'Wartend', 2), row('Ann Lee', 'a1', '2', 'In Bearbeitung', 3)] },
      { table: 'sc_task', groups: [row('Ann Lee', 'a1', '-5', '-5', 4), row('Ann Lee', 'a1', '3', 'Geschlossen abgeschlossen', 1)] },
    ],
    '(unassigned)'
  );
  assert.deepEqual(rows[0].classes, { new: 0, working: 3, waiting: 6, resolved: 1, other: 0 });
  assert.equal(rows[0].count, 9, 'what is finished is not open');
});

// ---- a state with no label is not a number ---------------------------------------------------------------------------------------

test('stateName: the label the site gave; with only the stored number, the plain word for what it means', () => {
  assert.deepEqual(stateName(key('3', 'On Hold'), 'incident'), { name: 'On Hold', plain: false });
  assert.deepEqual(stateName(key('3', 'Wartend'), 'incident'), { name: 'Wartend', plain: false });
  assert.deepEqual(stateName(key('3', '3'), 'incident'), { name: 'On hold', plain: true });
  assert.deepEqual(stateName(key('-5', '-5'), 'sc_task'), { name: 'On hold', plain: true });
  assert.deepEqual(stateName(key('6', ''), 'incident'), { name: 'Resolved', plain: true });
  assert.deepEqual(stateName(key('2', '2'), 'incident'), { name: 'In progress', plain: true });
  assert.deepEqual(stateName(key('8', '8'), 'incident'), { name: 'Cancelled', plain: true });
  assert.deepEqual(stateName(key('1', '1'), 'incident'), { name: 'New', plain: true });
  assert.deepEqual(stateName(key('42', '42'), 'incident'), { name: 'Unknown state', plain: true }, 'a number nobody knows is still not drawn');
  assert.deepEqual(stateName(key('', ''), 'incident'), { name: '(none)', plain: false });
  assert.deepEqual(stateName(undefined), { name: '(none)', plain: false });
  // a number that IS the site's label is a label (a state called "2")? Only the stored number as the label is replaced
  assert.equal(stateName(key('7', 'Closed'), 'incident').plain, false);
  for (const out of ['On hold', 'In progress', 'Cancelled', 'Unknown state']) assert.ok(!/^\d+$/.test(out));
});

test('stateRows names a state with no label by what it means, and says so', () => {
  const rows = stateRows([g('-5', '-5', 4), g('2', 'Work in Progress', 6), g('', '', 1)], 'sc_req_item');
  assert.deepEqual(rows.map((r) => [r.name, r.plain, r.count, r.cls]), [['Work in Progress', false, 6, 'working'], ['On hold', true, 4, 'waiting'], ['(none)', false, 1, 'other']]);
  assert.deepEqual(rows.map((r) => r.key), ['2', '-5', '']);
});

test('a list of tickets shows the state the same way', () => {
  assert.equal(stateShown({ state: 'On hold', statePlain: true }), 'On hold', 'English panel: the word as it is');
  assert.equal(stateShown({ state: 'Wartend', statePlain: false }), 'Wartend');
  assert.equal(stateShown({}), '');
  assert.equal(stateShown(null), '');
});

test('waitingKind: for whom a state waits, by value when the table is known, by the words of any of the three languages otherwise', () => {
  assert.equal(waitingKind('Awaiting Info', { table: 'sn_customerservice_case', value: '18' }), 'customer');
  assert.equal(waitingKind('Zzz', { table: 'sn_customerservice_case', value: '18' }), 'customer');
  assert.equal(waitingKind('Authorize', { table: 'change_request', value: '-3' }), 'approval');
  assert.equal(waitingKind('On Hold', { table: 'incident', value: '3' }), 'other');
  assert.equal(waitingKind('Warten auf Rückmeldung'), 'customer');
  assert.equal(waitingKind('Warten auf Genehmigung'), 'approval');
  assert.equal(waitingKind('بانتظار العميل'), 'customer');
  assert.equal(waitingKind('بانتظار الموافقة'), 'approval');
  assert.equal(waitingKind('Zzz'), 'other');
  assert.equal(waitingKind(''), 'other');
  assert.equal(waitingKind(null), 'other');
});

// ---- F20: more ticket types ---------------------------------------------------------------------------------------------------------

test('the ticket types: requests and the tasks of incidents, problems, cases and HR cases are offered; the HR ones only with approval', () => {
  for (const table of ['sc_request', 'incident_task', 'problem_task', 'sn_customerservice_task', 'sn_hr_core_task']) {
    assert.ok(REPORT_TABLES[table], table);
    assert.ok(REPORT_TABLES[table].label && REPORT_TABLES[table].singular, `${table} has plain words`);
    assert.ok(!/[a-z]+_[a-z]+/.test(REPORT_TABLES[table].label + REPORT_TABLES[table].singular), `${table}: no table name in its words`);
  }
  assert.equal(REPORT_TABLES.sc_request.label, 'Requests');
  assert.equal(REPORT_TABLES.sn_customerservice_task.label, 'Customer service tasks');
  assert.equal(REPORT_TABLES.sn_hr_core_task.label, 'HR tasks');
  assert.equal(isSensitiveReportTable('sn_hr_core_task'), true);
  assert.equal(isSensitiveReportTable('sn_customerservice_task'), false);
  assert.ok(STANDARD_TABLE_IDS.includes('sc_request'));
  assert.ok(!STANDARD_TABLE_IDS.includes('sn_hr_core_task'));
  assert.ok(!normalizeTables([]).includes('sn_hr_core_task'));
  assert.ok(normalizeTables([], { allowSensitive: true }).includes('sn_hr_core_task'));
  assert.deepEqual(FULFILMENT_TABLES, ['sc_request', 'sc_req_item', 'sc_task', 'sn_customerservice_task', 'sn_hr_core_task']);
});

test('otherKinds: a custom class is counted by the instance\'s own name; known types, sensitive and blocked classes are not listed', () => {
  const groups = [
    { count: 5, keys: [{ field: 'sys_class_name', value: 'u_facilities', display: 'Facilities Request' }] },
    { count: 3, keys: [{ field: 'sys_class_name', value: 'x_acme_visit_log', display: 'x_acme_visit_log' }] },
    { count: 9, keys: [{ field: 'sys_class_name', value: 'incident', display: 'Incident' }] },
    { count: 2, keys: [{ field: 'sys_class_name', value: 'sn_hr_core_case', display: 'HR Case' }] },
    { count: 4, keys: [{ field: 'sys_class_name', value: 'sn_si_incident', display: 'Security Incident' }] },
    { count: 1, keys: [{ field: 'sys_class_name', value: 'u_secret', display: 'Secret' }] },
    { count: 7, keys: [{ field: 'sys_class_name', value: 'u_facilities', display: 'Facilities Request' }] },
    { count: 0, keys: [{ field: 'sys_class_name', value: 'u_empty', display: 'Empty' }] },
    { count: 3, keys: [{ field: 'sys_class_name', value: 'not a table!', display: 'x' }] },
    { count: 2, keys: [] },
    null,
  ];
  const out = otherKinds(groups, { isBlocked: (table) => table === 'u_secret' });
  assert.deepEqual(out.items.map((i) => [i.table, i.label, i.count]), [['u_facilities', 'Facilities requests', 12], ['x_acme_visit_log', 'Visit logs', 3]]);
  assert.equal(out.left, 2 + 4 + 1, 'the HR, security and blocked tickets are counted as left out, not listed');
  assert.equal(out.more, false);
  // with HR allowed the HR family is the HR case type's to count, and is not "left out" either
  const hr = otherKinds(groups, { allowSensitive: true, isBlocked: (table) => table === 'u_secret' });
  assert.equal(hr.left, 4 + 1);
  assert.ok(!hr.items.some((i) => i.table.startsWith('sn_hr_')));
  // a policy prefix is sensitive too
  const own = otherKinds([{ count: 6, keys: [{ field: 'sys_class_name', value: 'x_acme_people_case', display: 'People case' }] }], { sensitivePrefixes: ['x_acme_people_'] });
  assert.deepEqual([own.items.length, own.left], [0, 6]);
  // the biggest first, and a cap that says there is more
  const many = Array.from({ length: 25 }, (_, i) => ({ count: i + 1, keys: [{ field: 'sys_class_name', value: `u_kind_${i}`, display: `Kind ${i}` }] }));
  const capped = otherKinds(many, { max: 20 });
  assert.equal(capped.items.length, 20);
  assert.equal(capped.more, true);
  assert.equal(capped.items[0].count, 25);
  assert.deepEqual(otherKinds(undefined), { items: [], more: false, left: 0 });
});

// ---- the fulfilment section ---------------------------------------------------------------------------------------------------------

const item = (n, number, table, opened) => ({ sys_id: cell(id(n)), number: cell(number), short_description: cell(`Item ${number}`), state: cell('-5', '-5'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), opened_at: cell(opened), sys_class_name: cell(table) });

function fulfilmentWorld(extra = []) {
  return fakeInstance({
    rules: [
      ...extra,
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_request' && c.groupBy[0] === 'state', then: [group('state', '1', '1', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sn_customerservice_task' && c.groupBy[0] === 'state', then: [group('state', '-5', '-5', 3), group('state', '2', 'Work in Progress', 5)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sn_hr_core_task' && c.groupBy[0] === 'state', then: [group('state', '1', 'Open', 7)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'task' && c.groupBy[0] === 'sys_class_name', then: [group('sys_class_name', 'u_facilities', 'Facilities Request', 6), group('sys_class_name', 'sn_hr_core_case', 'HR Case', 2), group('sys_class_name', 'incident', 'Incident', 30)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_request', then: count(2) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sn_customerservice_task', then: count(8) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sn_hr_core_task', then: count(7) },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sysapproval_approver', then: count(1) },
      { when: (c) => c.kind === 'query' && c.table === 'sn_customerservice_task' && c.query.includes('ORDERBYopened_at'), then: [item(1, 'CSTASK1', 'sn_customerservice_task', '2026-10-05 08:00:00')] },
      { when: (c) => c.kind === 'query' && c.table === 'sc_request' && c.query.includes('ORDERBYopened_at'), then: [item(2, 'REQ1', 'sc_request', '2026-10-20 08:00:00')] },
    ],
  });
}

test('request fulfilment: requests and the tasks of cases are read, labelled in plain words, and a state with no label is not a number', async () => {
  const inst = fulfilmentWorld();
  const result = await run({ section: 'fulfilment', scope: { kind: 'groups' }, tables: ['sc_request', 'sn_customerservice_task', 'sc_task'] }, inst);
  const d = result.data;
  assert.equal(d.available, true);
  // (in the order the ticket types were asked for)
  assert.deepEqual(d.byTable.map((t) => [t.table, t.label, t.open]), [['sc_request', 'Requests', 2], ['sn_customerservice_task', 'Customer service tasks', 8], ['sc_task', 'Catalog tasks', 0]]);
  const req = d.byTable.find((t) => t.table === 'sc_request');
  assert.deepEqual(req.states.map((s) => [s.name, s.plain, s.cls]), [['In progress', true, 'working']], 'a request in state 1 is Open: the task values');
  const cs = d.byTable.find((t) => t.table === 'sn_customerservice_task');
  assert.deepEqual(cs.states.map((s) => [s.name, s.plain, s.cls, s.key]), [['Work in Progress', false, 'working', '2'], ['On hold', true, 'waiting', '-5']]);
  // the oldest items show a state word, never the number
  assert.deepEqual(d.oldest.map((o) => [o.number, o.state, o.statePlain]), [['CSTASK1', 'On hold', true], ['REQ1', 'On hold', true]]);
  // the HR tasks were not asked for and are not read
  assert.equal(inst.callsTo('sn_hr_core_task').length, 0);
  // the rows for CSV, print and copy carry the word too
  const tables = resultTables(result);
  const stateTable = tables.find((x) => /Customer service tasks by state/.test(x.title));
  assert.deepEqual(stateTable.rows.map((r) => r.name), ['Work in Progress', 'On hold']);
  assert.deepEqual(tables.find((x) => x.title === 'Oldest open items').rows.map((r) => r.state), ['On hold', 'On hold']);
});

test('request fulfilment: the other kinds of ticket in scope are counted by their own name; sensitive ones are left out and said', async () => {
  const inst = fulfilmentWorld();
  const result = await run({ section: 'fulfilment', scope: { kind: 'groups' }, tables: ['sc_req_item', 'sc_request'] }, inst);
  const d = result.data;
  assert.equal(d.other.available, true);
  assert.deepEqual(d.other.items, [{ table: 'u_facilities', label: 'Facilities requests', count: 6 }]);
  assert.match(d.other.query, /^assignment_groupIN[0-9a-f]{32}\^active=true$/);
  assert.ok(result.notes.includes('Some kinds of ticket are not counted: your organisation keeps them out of Agent Buddy.'), 'the HR cases are counted as left out, not hidden');
  // one count, on the task table, of this scope
  const read = inst.callsTo('task').filter((c) => c.kind === 'aggregate' && c.groupBy[0] === 'sys_class_name');
  assert.equal(read.length, 1);
  assert.equal(read[0].query, d.other.query);
  // the table for CSV, print and copy
  const other = resultTables(result).find((x) => x.title === 'Other kinds of ticket');
  assert.deepEqual(other.rows.map((r) => [r.label, r.count]), [['Facilities requests', 6]]);
  // with HR allowed there is nothing left out
  const hr = await run({ section: 'fulfilment', scope: { kind: 'groups' }, tables: ['sc_req_item'] }, fulfilmentWorld(), { allowSensitive: true });
  assert.ok(!hr.notes.includes('Some kinds of ticket are not counted: your organisation keeps them out of Agent Buddy.'));
});

test('request fulfilment: a count of other kinds that could not be made is said, never shown as none', async () => {
  const inst = fulfilmentWorld([{ when: (c) => c.table === 'task', then: () => { throw Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' }); } }]);
  const result = await run({ section: 'fulfilment', scope: { kind: 'groups' }, tables: ['sc_req_item'] }, inst);
  assert.equal(result.data.other.available, false);
  assert.deepEqual(result.data.other.items, []);
  const note = result.access.find((a) => a.source === 'task');
  assert.ok(note, 'an access note names it');
  assert.equal(note.note, 'Other kinds of ticket: Not available to you.');
  assert.ok(!/403|ACL|task/i.test(note.note), 'no code and no table name');
  assert.equal(resultTables(result).some((x) => x.title === 'Other kinds of ticket'), false, 'and no table claims there are none');
});

test('request fulfilment: with none of its ticket types selected there is still the old hint, and nothing is read', async () => {
  const inst = fakeInstance();
  const result = await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.data.available, false);
  assert.match(result.data.reason, /Requested items or Catalog tasks/);
  assert.equal(inst.callsTo('task').filter((c) => c.kind === 'aggregate').length, 0);
});

test('the shift hand-over names a waiting state with no label by what it means, and says what it waits for', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'incident' && c.groupBy.join() === 'state', then: [group('state', '3', '3', 2), group('state', '2', 'In Progress', 4)] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'sn_customerservice_case' && c.groupBy.join() === 'state', then: [group('state', '18', 'Awaiting Info', 3)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length, then: [] },
      { when: (c) => c.kind === 'aggregate', then: count(5) },
    ],
  });
  const result = await run({ section: 'handover', scope: { kind: 'groups' }, tables: ['incident', 'sn_customerservice_case'] }, inst);
  const by = result.data.waiting.byState;
  assert.deepEqual(by.map((s) => [s.label, s.plain, s.kind, s.count]).sort(), [['Awaiting Info', false, 'customer', 3], ['On hold', true, 'other', 2]].sort());
  assert.equal(result.data.waiting.customer, 3);
  assert.equal(result.data.waiting.other, 2);
});

test('the report builder, grouped by state: a state with no label is named by what it means, with the number kept for the drill-down', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'state', then: [group('state', '2', '2', 9), group('state', '3', '3', 4), group('state', '1', 'Neu', 2), group('state', '', '', 1)] }] });
  const r = await run({ kind: 'builder', config: { table: 'incident', presets: ['open'], groupBy: 'state', metric: 'count', chart: 'bar' } }, inst);
  const d = r.data;
  assert.deepEqual(d.items.map((i) => [i.label, i.plain === true, i.key]), [['In progress', true, '2'], ['On hold', true, '3'], ['Neu', false, '1'], ['(empty)', false, '']]);
  assert.equal(d.items[0].query, 'active=true^state=2', 'the stored number still drills down');
  assert.deepEqual(resultTables(r)[0].rows.map((row) => row.label), ['In progress', 'On hold', 'Neu', '(empty)']);
});
