// Round 5, the weekly views: what is read, what each number is made of, and when it is LEFT OUT. A scriptable fake instance answers; the
// calls it records prove the reads are GET only and ask only for columns on the allowlist (src/reports/weekly/columns.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWeekly } from '../src/reports/weekly/run.js';
import { createRuntime } from '../src/reports/engine/index.js';
import { createWeeklyOps } from '../src/content/ops/weekly.js';
import { OPS } from '../src/content/ops/index.js';
import { isAllowedWeeklyColumn, WEEKLY_COLUMNS } from '../src/reports/weekly/columns.js';
import { fakeInstance, cell, group, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const LAST = { from: '2026-10-19 00:00:00', to: '2026-10-26 00:00:00' }; // NOW is Tuesday 27 Oct 2026: the last whole week
const BEFORE = { from: '2026-10-12 00:00:00', to: '2026-10-19 00:00:00' };

const q = (call) => call.query;
const has = (call, ...parts) => parts.every((p) => q(call).includes(p));
const agg = (call) => call.kind === 'aggregate' && !call.groupBy.length;
const by = (call, field) => call.kind === 'aggregate' && call.groupBy[0] === field;

/** A team's week on the incident table, as the numbers on the board: 63 in, 58 closed, 88 percent of SLAs kept, 4 reopened. */
function teamRules(extra = [], { sla = true } = {}) {
  return [
    ...extra,
    { when: (c) => c.kind === 'query' && c.table === 'sys_user_group' && c.query !== '', then: [{ sys_id: GROUP_A, name: 'Service Desk', active: 'true' }] },
    // incident counts
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `opened_at>=${LAST.from}`), then: count(63) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `opened_at>=${BEFORE.from}`), then: count(54) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `resolved_at>=${LAST.from}`, 'reopen_count>0'), then: count(4) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `resolved_at>=${LAST.from}`, 'close_notesISEMPTY'), then: count(14) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `resolved_at>=${LAST.from}`), then: count(58) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `resolved_at>=${BEFORE.from}`, 'reopen_count>0'), then: count(6) },
    { when: (c) => c.table === 'incident' && agg(c) && has(c, `resolved_at>=${BEFORE.from}`), then: count(54) },
    // by area, by configuration item, open tickets by person, states
    { when: (c) => c.table === 'incident' && by(c, 'category'), then: [group('category', 'network', 'Network', 21), group('category', 'email', 'Email', 14), group('category', '', '', 23)] },
    { when: (c) => c.table === 'incident' && by(c, 'cmdb_ci'), then: [group('cmdb_ci', id(77), 'VPN Gateway EU', 4)] },
    { when: (c) => c.table === 'incident' && by(c, 'state'), then: [group('state', '1', 'New', 5), group('state', '2', 'In Progress', 30)] },
    { when: (c) => c.table === 'incident' && by(c, 'assigned_to'), then: [group('assigned_to', id(1), 'Ann', 12), group('assigned_to', id(2), 'Bob', 10), group('assigned_to', id(3), 'Cy', 5), group('assigned_to', id(4), 'Di', 4), group('assigned_to', id(5), 'Ed', 3), group('assigned_to', id(6), 'Flo', 2)] },
    // fix notes, ticket numbers
    { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'close_notesISEMPTY') && c.fields.includes('close_notes'), then: [{ sys_id: id(9), close_notes: '' }] },
    { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'close_notesISEMPTY') && c.fields.includes('number'), then: [{ sys_id: id(9), number: cell('INC0010101') }, { sys_id: id(10), number: cell('INC0010102') }] },
    { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'cmdb_ci='), then: [{ sys_id: id(11), number: cell('INC0010001') }, { sys_id: id(12), number: cell('INC0010002') }] },
    // oldest open tickets
    { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'ORDERBYopened_at'), then: [{ sys_id: id(21), number: cell('INC0010100'), short_description: cell('Printer offline in Finance'), opened_at: cell(utc(NOW - 31 * 86400000)), sys_class_name: cell('incident') }] },
    // SLAs
    ...(sla ? slaRules() : []),
  ];
}

function slaRules() {
  return [
    { when: (c) => c.table === 'task_sla' && agg(c) && has(c, `planned_end_time>=${LAST.from}`, 'has_breached=true'), then: count(17) },
    { when: (c) => c.table === 'task_sla' && agg(c) && has(c, `planned_end_time>=${LAST.from}`), then: count(140) },
    { when: (c) => c.table === 'task_sla' && agg(c) && has(c, `planned_end_time>=${BEFORE.from}`, 'has_breached=true'), then: count(9) },
    { when: (c) => c.table === 'task_sla' && agg(c) && has(c, `planned_end_time>=${BEFORE.from}`), then: count(100) },
    { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [{ task: cell(id(21)), has_breached: cell('true'), stage: cell('breached'), sla: cell('P2 resolution'), percentage: cell('130'), business_percentage: cell('120') }] },
  ];
}

const team = (inst, over = {}) =>
  runWeekly({ kind: 'team', which: 'last', scope: { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } }, tables: ['incident'], ...over }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

// ---- The weekly report -----------------------------------------------------------------------------------------------------------

test('the weekly report: five numbers, each from an exact count, against the week before', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  const result = await team(inst);
  const d = result.data;
  assert.equal(d.available, true);
  assert.equal(d.kind, 'team');
  assert.deepEqual(d.numbers.cameIn, { value: 63, prev: 54 });
  assert.deepEqual(d.numbers.closed, { value: 58, prev: 54 });
  assert.deepEqual(d.numbers.backlog, { value: 5, prev: 0 }, 'came in minus closed, both weeks');
  assert.deepEqual(d.numbers.sla, { percent: 88, total: 140, kept: 123, prev: 91 });
  assert.equal(d.numbers.reopened.value, 4);
  assert.equal(d.numbers.reopened.of, 58, 'of the closed tickets of the types that record reopening');
  assert.equal(d.numbers.reopened.prev, 6);
  assert.deepEqual(d.leftOut, [], 'every number was read');
  assert.equal(d.window.which, 'last');
  assert.equal(d.window.start, Date.UTC(2026, 9, 19));
  assert.equal(result.scope.label, 'Chosen groups (1)');
});

test('the week is counted with the right dates, for the group only', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  await team(inst);
  const opened = inst.callsTo('incident', `opened_at>=${LAST.from}`).find((c) => agg(c));
  assert.equal(opened.query, `assignment_groupIN${GROUP_A}^opened_at>=${LAST.from}^opened_at<${LAST.to}`);
  const closed = inst.callsTo('incident', `resolved_at>=${LAST.from}`).find((c) => agg(c));
  assert.equal(closed.query, `assignment_groupIN${GROUP_A}^resolved_at>=${LAST.from}^resolved_at<${LAST.to}`);
  const sla = inst.callsTo('task_sla', `planned_end_time>=${LAST.from}`).find((c) => agg(c));
  assert.equal(sla.query, `task.sys_class_nameINincident^task.assignment_groupIN${GROUP_A}^planned_end_time>=${LAST.from}^planned_end_time<${LAST.to}^stage!=cancelled^stage!=paused`);
});

test('this week so far is compared with the same days of last week', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  await team(inst, { which: 'this' });
  const queries = inst.callsTo('incident', 'opened_at>=').filter((c) => agg(c)).map(q);
  assert.ok(queries.some((x) => x.includes('opened_at>=2026-10-26 00:00:00^opened_at<2026-10-27 12:00:00')), queries.join('\n'));
  assert.ok(queries.some((x) => x.includes('opened_at>=2026-10-19 00:00:00^opened_at<2026-10-20 12:00:00')), 'the same span, a week earlier');
});

test('where the week went, and what needs a decision, from the same reads', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  const d = (await team(inst)).data;
  assert.deepEqual(d.areas.map((a) => [a.name, a.count]), [['No category set', 23], ['Network', 21], ['Email', 14]]);
  assert.deepEqual(
    d.decisions.map((x) => x.id),
    ['cause', 'load', 'notes']
  );
  const [cause, load, notes] = d.decisions;
  assert.equal(cause.count, 4);
  assert.equal(cause.name, 'VPN Gateway EU');
  assert.deepEqual(cause.numbers, ['INC0010001', 'INC0010002']);
  assert.deepEqual(load, { id: 'load', people: 2, percent: 61, of: 36 });
  assert.deepEqual([notes.without, notes.closed], [14, 58]);
  assert.deepEqual(notes.numbers, ['INC0010101', 'INC0010102']);
  assert.ok(!('ciId' in cause) && !('field' in cause), 'nothing internal travels to the panel');
});

test('the oldest open tickets are read for the PDF, each with where its SLA stands', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  const d = (await team(inst)).data;
  assert.equal(d.oldest.length, 1);
  assert.deepEqual(d.oldest[0], { table: 'incident', sysId: id(21), number: 'INC0010100', title: 'Printer offline in Finance', ageDays: 31, sla: 'breached' });
});

test('a number that cannot be counted is left out and says why: never a zero', async () => {
  // The reopened count is refused: the other four numbers stay.
  const inst = fakeInstance({ rules: teamRules([{ when: (c) => c.table === 'incident' && has(c, 'reopen_count>0'), then: () => Promise.reject(Object.assign(new Error('Your user is not allowed (403)'), { code: 'ACCESS_DENIED' })) }]) });
  const d = (await team(inst)).data;
  assert.equal(d.numbers.reopened, null);
  assert.deepEqual(d.leftOut.map((x) => x.key), ['reopened']);
  assert.equal(d.leftOut[0].why, 'Reopened tickets could not be counted.');
  assert.equal(d.numbers.cameIn.value, 63);

  // Every count of the week is refused: nothing at all is drawn as zero.
  const none = fakeInstance({ rules: teamRules([{ when: (c) => c.table === 'incident' && c.kind === 'aggregate' && /opened_at|resolved_at/.test(c.query), then: () => Promise.reject(Object.assign(new Error('403'), { code: 'ACCESS_DENIED' })) }]) });
  const n = (await team(none)).data;
  assert.equal(n.numbers.cameIn, null);
  assert.equal(n.numbers.closed, null);
  assert.equal(n.numbers.backlog, null);
  assert.equal(n.areas, null, 'nothing was closed that could be read: no areas, and not a made-up empty list');
});

test('SLAs the person cannot see are not "all kept"; a week in which none came due is not 100 percent', async () => {
  const hidden = fakeInstance({ hidden: ['task_sla'], rules: teamRules([], { sla: false }) });
  const d = (await team(hidden)).data;
  assert.equal(d.numbers.sla, null);
  assert.ok(d.leftOut.some((x) => x.key === 'sla' && /SLAs? at all|can't see|can\\u2019t see|can see/.test(x.why)), JSON.stringify(d.leftOut));
  const none = fakeInstance({ rules: [{ when: (c) => c.table === 'task_sla' && c.kind === 'aggregate', then: count(0) }, ...teamRules()] });
  const e = (await team(none)).data;
  assert.equal(e.numbers.sla, null);
  assert.equal(e.leftOut.find((x) => x.key === 'sla')?.why, 'No SLA came due in this week.');
});

test('"Needs a decision" shows only what the data supports', async () => {
  const quiet = fakeInstance({
    rules: teamRules([
      { when: (c) => c.table === 'incident' && by(c, 'cmdb_ci'), then: [group('cmdb_ci', id(77), 'VPN', 2)] },
      { when: (c) => c.table === 'incident' && by(c, 'assigned_to'), then: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => group('assigned_to', id(i), `P${i}`, 4)) },
      { when: (c) => c.table === 'incident' && agg(c) && has(c, 'close_notesISEMPTY'), then: count(1) },
    ]),
  });
  assert.deepEqual((await team(quiet)).data.decisions, []);
});

test('a type with no closing date is left out of EVERY number, with one note: a total must be a total', async () => {
  const inst = fakeInstance({ missingColumns: ['closed_at'], rules: teamRules() });
  const result = await team(inst, { tables: ['incident', 'sc_req_item'] });
  const d = result.data;
  assert.deepEqual(d.types, ['Incidents'], 'only the types that can be counted for every number');
  assert.deepEqual([d.numbers.cameIn.value, d.numbers.closed.value, d.numbers.backlog.value], [63, 58, 5]);
  assert.ok(result.notes.includes('Requested items are not counted: there is no closing date to work from.'), JSON.stringify(result.notes));
  assert.equal(inst.callsTo('sc_req_item', 'opened_at').length, 0, 'its tickets are not counted as having come in either');
  // and when no type can be counted at all, there is nothing to show, not a page of zeros
  const none = await team(fakeInstance({ missingColumns: ['closed_at', 'resolved_at'], rules: teamRules() }), { tables: ['sc_req_item'] });
  assert.equal(none.data.available, false);
  assert.match(none.data.reason, /None of the ticket types you can read has a closing date/);
});

test('a lost session ends the read: it is an error, not a report of zeros', async () => {
  const inst = fakeInstance({ rules: teamRules([{ when: (c) => c.table === 'incident' && c.kind === 'aggregate', then: () => Promise.reject(Object.assign(new Error('401'), { code: 'SESSION_EXPIRED' })) }]) });
  await assert.rejects(() => team(inst), (err) => err.code === 'SESSION_EXPIRED');
});

test('only GET reads, only columns on the allowlist, and no HR table', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  await team(inst, { tables: ['incident', 'sn_hr_core_case'] });
  for (const call of inst.calls) {
    assert.ok(call.kind === 'query' || call.kind === 'aggregate', 'only the two reads the content script has');
    // (the groups are read by the Team screen's own scope code, with its own columns: src/reports/engine/scope.js)
    if (['sys_user_group', 'sys_user', 'sys_user_grmember'].includes(call.table)) continue;
    for (const field of [...(call.fields || []), ...(call.groupBy || [])]) {
      assert.ok(isAllowedWeeklyColumn(field) || ['category', 'cmdb_ci', 'state', 'assigned_to', 'caller_id', 'reassignment_count', 'sys_id'].includes(field), `${call.table}: ${field}`);
    }
  }
  assert.equal(inst.calls.filter((c) => c.table === 'sn_hr_core_case').length, 0, 'HR cases are never read here');
  assert.ok(Object.keys(WEEKLY_COLUMNS.tickets).every((c) => typeof WEEKLY_COLUMNS.tickets[c] === 'string' && WEEKLY_COLUMNS.tickets[c].length > 10), 'every column has its reason');
});

test('no fix note text is ever read: the column is asked for only as "is empty"', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  await team(inst);
  const withText = inst.calls.filter((c) => c.kind === 'query' && c.fields.includes('close_notes'));
  assert.ok(withText.length > 0);
  for (const call of withText) assert.ok(call.query.includes('close_notesISEMPTY'), call.query);
});

test('a site with no close_notes column is not told "every close had no note"', async () => {
  const inst = fakeInstance({
    rules: teamRules([{ when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'close_notesISEMPTY') && c.fields.includes('close_notes'), then: [{ sys_id: id(9) }] }]),
  });
  const d = (await team(inst)).data;
  assert.ok(!d.decisions.some((x) => x.id === 'notes'));
});

// ---- My week --------------------------------------------------------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 20, 9, 0); // a Tuesday of the last whole week
const row = (n, over = {}) => ({
  sys_id: cell(id(n)),
  number: cell(`INC00${n + 100}`),
  opened_at: cell(utc(T0 + n * 3600000)),
  resolved_at: cell(utc(T0 + n * 3600000 + (n % 2 ? 30 : 90) * 3600000)),
  reopen_count: cell('0'),
  category: cell(n % 3 ? 'network' : 'email', n % 3 ? 'Network' : 'Email'),
  'caller_id.user_name': cell('abel.tuter'),
  ...over,
});
const mineRules = (rows, beforeRows = [], extra = []) => [
  ...extra,
  { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, `resolved_at>=${LAST.from}`) && c.fields.includes('sys_id') && !has(c, 'close_notesISEMPTY'), then: rows },
  { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, `resolved_at>=${BEFORE.from}`) && c.fields.includes('sys_id') && !has(c, 'close_notesISEMPTY'), then: beforeRows },
  { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: (c) => (c.query.includes(id(1)) || c.query.includes(id(11)) ? rows.map((r, i) => ({ task: r.sys_id, has_breached: cell(i === 0 ? 'true' : 'false'), stage: cell('achieved') })) : []) },
  { when: (c) => c.kind === 'query' && c.table === 'sys_journal_field', then: (c) => rows.flatMap((r, i) => (c.query.includes(r.sys_id.value) ? [{ element_id: r.sys_id, sys_created_on: cell(utc(T0 + (i + 1) * 3600000 + 20 * 60000)), sys_created_by: cell('itil') }] : [])) },
];
const mine = (inst) => runWeekly({ kind: 'mine', which: 'last', tables: ['incident'] }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

test('My week: closed, typical time, first reply, reopened, SLAs and areas, from the person\'s own closed tickets', async () => {
  const rows = [1, 2, 3, 4, 5].map((n) => row(n, n === 2 ? { reopen_count: cell('1') } : {}));
  const inst = fakeInstance({ rules: mineRules(rows) });
  const d = (await mine(inst)).data;
  assert.equal(d.kind, 'mine');
  assert.equal(d.now.closed, 5);
  // 30, 90, 30, 90, 30 hours: the median is 30 hours
  assert.equal(d.now.typicalMs, 30 * 3600000);
  assert.deepEqual(d.now.reopened, { n: 1, of: 5, types: ['Incidents'], numbers: ['INC00102'] });
  assert.equal(d.now.sla.total, 5);
  assert.equal(d.now.sla.kept, 4, 'one of the five had breached');
  assert.equal(d.now.sla.percent, 80);
  assert.equal(d.now.reply.n, 5);
  assert.equal(d.now.reply.meanMs, 20 * 60000, 'each first reply came 20 minutes after the ticket was opened');
});

test('My week: the week before is read the same way, so each number can say how it changed', async () => {
  const rows = [1, 2, 3].map((n) => row(n));
  const before = [11, 12, 13, 14].map((n) => row(n, { resolved_at: cell('2026-10-14 10:00:00'), opened_at: cell('2026-10-13 10:00:00') }));
  const inst = fakeInstance({ rules: mineRules(rows, before) });
  const d = (await mine(inst)).data;
  assert.equal(d.now.closed, 3);
  assert.equal(d.before.closed, 4);
  assert.equal(d.before.typicalMs, 24 * 3600000);
  assert.equal(d.before.areas, null, 'the areas and the fix notes are read for the week itself only');
  assert.equal(d.before.notes, null);
});

test('My week: under three tickets there is no "typical time" and no "average first reply": they are left out with the reason, not shown as a number', async () => {
  const inst = fakeInstance({ rules: mineRules([row(1), row(2)]) });
  const d = (await mine(inst)).data;
  assert.equal(d.now.closed, 2, 'the count is exact');
  assert.equal(d.now.typicalMs, null);
  assert.equal(d.now.reply, null);
  const keys = d.leftOut.map((x) => x.key);
  assert.ok(keys.includes('typical') && keys.includes('reply'), keys.join());
});

test('My week: nothing closed is a real zero, and the rest is simply not there', async () => {
  const inst = fakeInstance({ rules: mineRules([]) });
  const d = (await mine(inst)).data;
  assert.equal(d.now.closed, 0);
  assert.equal(d.now.typicalMs, null);
  assert.equal(d.now.sla, null);
  assert.equal(d.now.reply, null);
  assert.deepEqual(d.leftOut, [], 'a week with nothing closed has nothing to apologise for');
});

test('My week: SLAs that cannot be seen are not "all answered in time"', async () => {
  const rows = [1, 2, 3, 4].map((n) => row(n));
  const inst = fakeInstance({ hidden: ['task_sla'], rules: mineRules(rows).filter((r) => !r.when({ kind: 'query', table: 'task_sla', query: '', fields: [] })) });
  const d = (await mine(inst)).data;
  assert.equal(d.now.sla, null);
  assert.ok(d.leftOut.some((x) => x.key === 'sla'));
});

test('My week: a ticket whose customer could not be read has no first reply to measure (the customer\'s own comment would count as one)', async () => {
  const rows = [1, 2, 3, 4].map((n) => row(n, { 'caller_id.user_name': cell('') }));
  const inst = fakeInstance({ rules: mineRules(rows) });
  const d = (await mine(inst)).data;
  assert.equal(d.now.reply, null);
  assert.equal(inst.calls.filter((c) => c.table === 'sys_journal_field').length, 0, 'nothing to compare with, so the comments are not even read');
});

test('My week: the comments are read for who wrote and when, never the text', async () => {
  const inst = fakeInstance({ rules: mineRules([1, 2, 3].map((n) => row(n))) });
  await mine(inst);
  const journal = inst.calls.filter((c) => c.table === 'sys_journal_field');
  assert.ok(journal.length >= 1);
  for (const call of journal) {
    assert.deepEqual(call.fields, ['element_id', 'sys_created_on', 'sys_created_by']);
    assert.match(call.query, /^element=comments\^element_idIN[0-9,]+\^ORDERBYsys_created_on$/);
  }
});

test('My week: the fix notes of the week are counted, and the ones that came back', async () => {
  const rows = [1, 2, 3, 4, 5].map((n) => row(n, n === 2 ? { reopen_count: cell('1') } : {}));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query' && c.table === 'incident' && has(c, 'close_notesISEMPTY') && c.fields.includes('close_notes'), then: [{ sys_id: id(2), close_notes: '' }] },
      { when: (c) => c.table === 'incident' && agg(c) && has(c, 'close_notesISEMPTY', 'reopen_count>0'), then: count(1) },
      { when: (c) => c.table === 'incident' && agg(c) && has(c, 'close_notesISEMPTY'), then: count(2) },
      ...mineRules(rows),
    ],
  });
  const d = (await mine(inst)).data;
  assert.deepEqual(d.now.notes, { closed: 5, without: 2, reopenedWithout: 1 });
});

test('the operations: myWeek and weeklyReport are registered, answer plain JSON and clear their own cache', async () => {
  assert.equal(typeof OPS.myWeek, 'function');
  assert.equal(typeof OPS.weeklyReport, 'function');
  assert.equal(typeof OPS.weeklyClear, 'function');
  const inst = fakeInstance({ rules: teamRules([{ when: (c) => c.table === 'sys_user', then: [{ sys_id: USER, time_zone: 'UTC' }] }]) });
  const ops = createWeeklyOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime(), now: () => NOW });
  const result = await ops.weeklyReport({ which: 'last', scope: { kind: 'chosen', groupIds: [GROUP_A] }, tables: ['incident'] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result, 'no function or class instance in the answer');
  assert.equal(result.data.numbers.cameIn.value, 63);
  assert.equal(result.zone.source, 'servicenow', 'the week is counted in the ServiceNow time zone of the person');
  const again = inst.calls.length;
  await ops.weeklyReport({ which: 'last', scope: { kind: 'chosen', groupIds: [GROUP_A] }, tables: ['incident'] });
  assert.equal(inst.calls.length, again, 'the second ask in the same minute is answered from the cache');
  assert.deepEqual(await ops.weeklyClear(), { ok: true });
  await ops.weeklyReport({ which: 'last', scope: { kind: 'chosen', groupIds: [GROUP_A] }, tables: ['incident'] });
  assert.ok(inst.calls.length > again, 'after Refresh it is read again');
});

test('the operations check what the panel sends: a scope with no group, an unknown week, somebody who cannot be told apart', async () => {
  const inst = fakeInstance({ rules: teamRules() });
  const ops = createWeeklyOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime(), now: () => NOW });
  await assert.rejects(() => ops.weeklyReport({ scope: { kind: 'chosen', groupIds: [] }, tables: ['incident'] }), /Pick at least one group/);
  const odd = await ops.weeklyReport({ which: 'next fortnight', scope: { kind: 'mine' }, tables: ['incident'] });
  assert.equal(odd.data.window.which, 'last');
  const nobody = createWeeklyOps({ deps: inst.deps, getSession: async () => ({ userId: '' }), runtime: createRuntime() });
  await assert.rejects(() => nobody.myWeek({}), /could not tell who is signed in/);
});
