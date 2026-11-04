// The numbers the Team screen and the dashboards show agree with each other: what "open" means, which SLAs are at issue, what a
// custom report with an average draws, which days and weeks a chart covers, and how old a ticket is (audit phase 3, reports).
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runReport, createRuntime, resultTables } from '../src/reports/engine/index.js';
import { normalizeBuilderConfig } from '../src/reports/engine/builder.js';
import { topWithOthers } from '../src/reports/engine/common.js';
import { foldByOwner, NOBODY_KEY } from '../src/reports/engine/workload.js';
import { oldestItems } from '../src/reports/engine/fulfilment.js';
import { startOfLocalDay, bucketStarts, bucketLabels, localDaysBetween, localWeeksCovering, DAY, HOUR } from '../src/reports/engine/time.js';
import { buildInsightsPack, insightsParts } from '../src/reports/ai/insights.js';
import { WorkloadBody } from '../src/sidepanel/reports/WorkloadView.jsx';
import { BuilderChart, builderRequest } from '../src/sidepanel/reports/BuilderView.jsx';
import BuilderEditor from '../src/sidepanel/reports/BuilderEditor.jsx';
import { stackedLayout, stackedToTable, summarizeItems, itemsToTable } from '../src/sidepanel/charts/geometry.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const id = (n) => String(n).padStart(32, '0');
const run = (request, instance, extra = {}) => runReport({ params: {}, ...request }, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...extra });
const env = { openList() {}, openTicket() {}, scopeKind: 'chosen', listHref: (table, q) => `https://acme.service-now.com/${table}_list.do?sysparm_query=${encodeURIComponent(q)}` };
const chosen = { kind: 'chosen', groupIds: [GROUP_A] };
const groupsRule = { when: (c) => c.table === 'sys_user_group', then: [{ sys_id: GROUP_A, name: 'Desk', active: 'true' }] };
// Active incidents by state: 6 in progress, 4 resolved (still active until they close).
const statesRule = { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'state', then: [group('state', '2', 'In Progress', 6), group('state', '6', 'Resolved', 4)] };
const activeRule = { when: (c) => c.kind === 'aggregate' && !c.groupBy.length && c.query.endsWith('active=true'), then: count(10) };

// ---- P3.16 / P3.21 / P3.22: the Workload board ------------------------------------------------------------------------------------

test('Workload: more people than the board shows: the "Other people" row has its state parts and draws', async () => {
  const people = Array.from({ length: 13 }, (_, i) => group2('assigned_to', String(i).padStart(32, 'd'), `Person ${i}`, 'state', i % 2 ? '3' : '2', i % 2 ? 'On Hold' : 'In Progress', 20 - i));
  const inst = fakeInstance({ rules: [groupsRule, { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: people }] });
  const d = (await run({ section: 'workload', scope: chosen, tables: ['incident'] }, inst)).data;
  const others = d.byAssignee[d.byAssignee.length - 1];
  assert.equal(others.others, true);
  assert.equal(others.count, 8);
  assert.deepEqual(others.classes, { new: 0, working: 8, waiting: 0, resolved: 0, other: 0 });
  assert.deepEqual(others.byTable, { incident: 8 });
  const markup = html(h(WorkloadBody, { d, env }));
  assert.match(markup, /Other people \(1\)/, 'the row is drawn, not cut by the chart');
  assert.match(markup, /Open work by person \(top 12 of 13\)/, '"top n" counts the named rows only');
  assert.doesNotMatch(markup, /<a [^>]*>(?:(?!<\/a>).)*Other people/, 'the summed row opens nothing');
  // topWithOthers on rows without breakdowns stays as it was.
  assert.deepEqual(Object.keys(topWithOthers([{ name: 'a', count: 2 }, { name: 'b', count: 1 }], 1)[1]).sort(), ['count', 'id', 'key', 'name', 'others']);
});

test('Workload: the "(unassigned)" and "(no group)" rows have a stable key, keep their ISEMPTY query and are links', async () => {
  const rows = foldByOwner([{ table: 'incident', groups: [{ count: 3, avg: {}, keys: [{ field: 'assigned_to', value: '', display: '' }, { field: 'state', value: '2', display: 'In Progress' }] }] }], '(unassigned)');
  assert.equal(rows[0].key, NOBODY_KEY);
  assert.equal(rows[0].id, '');
  const inst = fakeInstance({
    rules: [
      groupsRule,
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: [group2('assigned_to', 'a1', 'Ann Lee', 'state', '2', 'In Progress', 2), group2('assigned_to', '', '', 'state', '2', 'In Progress', 3)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assignment_group,state', then: [group2('assignment_group', '', '', 'state', '2', 'In Progress', 5)] },
    ],
  });
  const d = (await run({ section: 'workload', scope: chosen, tables: ['incident'] }, inst)).data;
  const nobody = d.byAssignee.find((r) => r.id === '');
  assert.equal(nobody.key, NOBODY_KEY);
  assert.match(nobody.queries.incident, /\^active=true\^assigned_toISEMPTY$/);
  assert.match(d.byGroup[0].queries.incident, /\^active=true\^assignment_groupISEMPTY$/);
  const markup = html(h(WorkloadBody, { d, env }));
  assert.ok(markup.includes(`href="${env.listHref('incident', nobody.queries.incident).replace(/&/g, '&amp;')}"`), '(unassigned) opens its list');
  assert.ok(markup.includes(`href="${env.listHref('incident', d.byGroup[0].queries.incident).replace(/&/g, '&amp;')}"`), '(no group) opens its list');
});

test('Workload: a person\'s "Open" leaves out resolved-but-not-closed, like the Open tile; the bar still shows them as their own part', async () => {
  const ANN = 'c'.repeat(32);
  const inst = fakeInstance({
    rules: [
      groupsRule,
      statesRule,
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: [group2('assigned_to', ANN, 'Ann Lee', 'state', '2', 'In Progress', 3), group2('assigned_to', ANN, 'Ann Lee', 'state', '6', 'Resolved', 4), group2('assigned_to', '', '', 'state', '2', 'In Progress', 3)] },
      activeRule,
    ],
  });
  const r = await run({ section: 'workload', scope: chosen, tables: ['incident'] }, inst);
  const d = r.data;
  assert.equal(d.totals.open, 6);
  const ann = d.byAssignee.find((x) => x.id === ANN);
  assert.equal(ann.count, 3);
  assert.equal(ann.classes.resolved, 4, 'kept as its own part');
  assert.equal(d.byAssignee.reduce((n, x) => n + x.count, 0), d.totals.open, 'the rows add up to the Open tile');
  const csv = resultTables(r)[0];
  assert.equal(csv.columns[1].label, 'Open');
  assert.deepEqual(csv.rows.find((x) => x.name === 'Ann Lee'), { name: 'Ann Lee', total: 3, new: 0, working: 3, waiting: 0, resolved: 4, other: 0 });
  const line = insightsParts(buildInsightsPack([{ id: 'w', section: 'workload', result: r }])).find((p) => p.field === 'insights_workload').text.split('\n').find((l) => l.includes('by person'));
  assert.match(line, /Ann Lee: 3 open \(working 3, waiting 0, new 0, other 0\), plus 4 resolved and waiting to close/);
  // The bar prints the open count and draws both parts; its table view names that number "Open".
  const markup = html(h(WorkloadBody, { d, env }));
  assert.match(markup, /title="Ann Lee">Ann Lee<\/span><span class="ab-stack-total">3<\/span>/);
  assert.match(markup, /Ann Lee, Resolved, not closed: 4/);
});

test('stacked bars: a row may print its own total; the scale and the parts are unchanged', () => {
  const series = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const rows = [{ key: 'r1', label: 'R1', total: 3, parts: [{ key: 'a', value: 3 }, { key: 'b', value: 4 }] }, { key: 'r2', label: 'R2', parts: [{ key: 'a', value: 2 }] }];
  const layout = stackedLayout(rows, series);
  assert.deepEqual(layout.rows.map((r) => r.total), [3, 2]);
  assert.equal(layout.scaleMax, 7, 'the bar is as long as its parts');
  const table = stackedToTable(rows, series, { totalHeader: 'Open' });
  assert.equal(table.columns[table.columns.length - 1].label, 'Open');
  assert.equal(table.rows[0].total, 3);
  assert.equal(stackedToTable(rows, series).columns[3].label, 'Total');
});

// ---- P3.17: the SLA radar ---------------------------------------------------------------------------------------------------------

test('SLA radar: a ticket read by the wider query but not breached, at risk or due soon is not counted, listed or exported', async () => {
  const sla = (task, { pct, bpct, breached = false, end = '2026-10-30 09:00:00' }) => ({ task: cell(task), sla: cell('s', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), business_percentage: cell(String(bpct)), planned_end_time: cell(end) });
  const task = (n) => ({ sys_id: cell(id(n)), number: cell(`INC${n}`), short_description: cell('Printer'), priority: cell('3', '3 - Moderate'), state: cell('2', 'In Progress'), assigned_to: cell('u', 'Ann Lee'), assignment_group: cell('g', 'Desk'), sys_class_name: cell('incident') });
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla' && !c.groupBy.length, then: count(9) },
      {
        when: (c) => c.kind === 'query' && c.table === 'task_sla' && c.query.includes('has_breached=true^OR'),
        // 1 breached, 2 at risk, 3 due in an hour (20 % used), 4 at 118 % of wall time but 62 % of its working time: none of the three.
        then: [sla(id(1), { pct: 130, bpct: 130, breached: true }), sla(id(2), { pct: 80, bpct: 80 }), sla(id(3), { pct: 20, bpct: 20, end: '2026-10-27 13:00:00' }), sla(id(4), { pct: 118, bpct: 62 })],
      },
      { when: (c) => c.kind === 'query' && c.table === 'task' && c.query.includes('sys_idIN'), then: [1, 2, 3, 4].map(task) },
    ],
  });
  const r = await run({ section: 'sla', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.deepEqual(r.data.counts, { breached: 1, atRisk: 1, dueSoon: 1 });
  assert.equal(r.data.ticketsAtIssue, 3);
  assert.deepEqual(r.data.top.map((x) => x.number), ['INC1', 'INC2', 'INC3']);
  assert.deepEqual(resultTables(r)[0].rows.map((x) => x.risk), ['Breached', 'At risk', 'Due soon'], 'a ticket only due soon is not exported as "At risk"');
  const hand = await run({ section: 'handover', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.deepEqual(hand.data.sla.top.map((x) => [x.number, x.risk]), [['INC1', 'Breached'], ['INC2', 'At risk'], ['INC3', 'Due soon']]);
});

// ---- P3.18 / P3.25: Quality ---------------------------------------------------------------------------------------------------------

test('Quality: the backlog starts from the same Open as the Overview, so resolved-not-closed tickets are not counted twice', async () => {
  const resolvedToday = Array.from({ length: 4 }, () => ({ resolved_at: cell('2026-10-27 07:00:00'), opened_at: cell('2026-10-01 07:00:00') }));
  const inst = fakeInstance({ rules: [statesRule, activeRule, { when: (c) => c.kind === 'query' && c.query.includes('ORDERBYDESCresolved_at'), then: resolvedToday }] });
  const ov = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  const q = await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'], params: { trend: 'day-14' } }, inst);
  const open = ov.data.tiles.find((x) => x.key === 'open').value;
  assert.equal(open, 6);
  assert.deepEqual(q.data.trend.backlog.slice(-2), [10, 6], 'yesterday 6 + the 4 resolved today; today the Open tile');
  assert.equal(q.data.perTable[0].openNow, 6);
});

test('Quality: "Last 14 days" is 14 days at any hour; weeks count the days the window covers', async () => {
  const inst = fakeInstance();
  const morning = Date.UTC(2026, 9, 27, 8, 0, 0);
  const evening = Date.UTC(2026, 9, 27, 23, 30, 0);
  for (const now of [morning, NOW, evening]) {
    const q = await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'], params: { trend: 'day-14' } }, inst, { now });
    assert.equal(q.data.windowDays, 14, new Date(now).toISOString());
    assert.equal(q.data.reopen.window, 'tickets opened in the last 14 days');
  }
  // Tuesday 27 Oct: 7 whole weeks back to Monday 7 Sep, plus Monday and Tuesday of this week.
  const weeks = await run({ section: 'quality', scope: { kind: 'mine' }, tables: ['incident'], params: { trend: 'week-8' } }, inst, { now: morning });
  assert.equal(weeks.data.windowDays, 51);
});

// ---- P3.19 / P3.20 / P3.23: the report builder --------------------------------------------------------------------------------------

test('builder: an average is never a donut, has no shares or total, and its bars open the tickets that were averaged', async () => {
  assert.equal(normalizeBuilderConfig({ groupBy: 'priority', metric: 'avg_resolve_days', chart: 'donut' }).chart, 'bar');
  assert.equal(normalizeBuilderConfig({ groupBy: 'priority', metric: 'count', chart: 'donut' }).chart, 'donut');
  const rows = [{ opened_at: cell('2026-10-20 10:00:00'), resolved_at: cell('2026-10-21 10:00:00'), priority: cell('1', '1 - Critical') }, { opened_at: cell('2026-10-10 10:00:00'), resolved_at: cell('2026-10-20 10:00:00'), priority: cell('4', '4 - Low') }];
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.query.includes('ORDERBYDESC'), then: rows }] });
  const age = await run({ kind: 'builder', config: { table: 'incident', presets: [], groupBy: 'priority', metric: 'avg_age_days' } }, inst);
  assert.ok(age.data.items.every((i) => /^active=true\^priority=\d$/.test(i.query)), 'average age is of open tickets: so is the list');
  const resolve = await run({ kind: 'builder', config: { table: 'incident', presets: ['open'], groupBy: 'priority', metric: 'avg_resolve_days', chart: 'donut' } }, inst);
  assert.equal(resolve.data.config.chart, 'bar');
  assert.ok(resolve.data.items.every((i) => /^active=true\^resolved_atISNOTEMPTY\^priority=\d$/.test(i.query)));
  const markup = html(h(BuilderChart, { data: resolve.data, env }));
  assert.doesNotMatch(markup, /ab-hbar-pct|Total|Share/, 'no percentages of a sum of averages');
  assert.match(markup, /1 - Critical/);
  assert.equal(summarizeItems([{ label: 'A', value: 0.5 }, { label: 'B', value: 9.5 }], { unit: 'days', shares: false }), 'A 0.5 days, B 9.5 days.');
  assert.deepEqual(itemsToTable([{ label: 'A', value: 1 }], { shares: false }).columns.map((c) => c.key), ['label', 'value']);
  // An old saved donut with an average is drawn as bars too.
  assert.doesNotMatch(html(h(BuilderChart, { data: { ...resolve.data, config: { chart: 'donut' } }, env })), /ab-donut/);
});

test('builder: an average with no ticket to average shows no made-up 0', () => {
  const data = { config: { chart: 'bar' }, groupBy: 'none', items: [], unit: 'days', table: 'incident', tableLabel: 'Incidents', groupLabel: 'No grouping (one number)', filter: 'All tickets', metric: 'avg_age_days', overall: null, query: 'active=true' };
  const markup = html(h(BuilderChart, { data, env }));
  assert.doesNotMatch(markup, /ab-tile-value/);
  assert.match(markup, /nothing to average/);
});

test('builder: more than 40 groups: the rest is one "Others" entry, so shares are of the real total', async () => {
  const many = Array.from({ length: 45 }, (_, i) => group('category', `c${i}`, `Cat ${String(i).padStart(2, '0')}`, 100 - i));
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'category', then: many }] });
  const r = await run({ kind: 'builder', config: { table: 'incident', groupBy: 'category', chart: 'donut' } }, inst);
  const d = r.data;
  assert.equal(d.items.length, 41);
  const others = d.items[40];
  assert.deepEqual([others.others, others.label, others.value, others.query], [true, 'Others (5)', 60 + 59 + 58 + 57 + 56, '']);
  assert.equal(d.items.reduce((n, i) => n + i.value, 0), d.total);
  assert.equal(resultTables(r)[0].rows[40].label, 'Others (5)');
  const markup = html(h(BuilderChart, { data: d, env }));
  assert.match(markup, /Others \(5\)/);
});

test('builder: the export names a one-number report by its grouping, not by the words of its label', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.table === 'problem', then: count(4) }] });
  const r = await run({ kind: 'builder', config: { table: 'problem', groupBy: 'none' } }, inst);
  assert.equal(resultTables({ ...r, data: { ...r.data, groupLabel: 'Something else' } })[0].columns[0].label, 'Measure');
});

test('builder: weeks cover the report\'s own window, not always twelve', async () => {
  const rows = [{ opened_at: cell('2026-10-26 10:00:00') }, { opened_at: cell('2026-10-20 10:00:00') }];
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.query.includes('ORDERBYDESCopened_at'), then: rows }] });
  const weeks = async (presets) => (await run({ kind: 'builder', config: { table: 'incident', presets, groupBy: 'opened_week' } }, inst)).data;
  const w7 = await weeks(['last_7']);
  assert.deepEqual(w7.series.values, [1, 1], 'last week and this week, no empty weeks the filter made');
  assert.deepEqual(w7.series.labels, ['Oct 19', 'Oct 26']);
  assert.equal((await weeks(['last_30'])).series.labels.length, 6, 'Sep 27 is in the week of Sep 21');
  assert.equal((await weeks(['last_90'])).series.labels.length, 14, 'the whole window, from the week of Jul 27');
  assert.equal((await weeks([])).series.labels.length, 12, 'no window: the last 12 weeks');
  assert.equal((await weeks(['last_7'])).basedOn, undefined, 'a complete read: the sum is the total');
});

test('builder: a time chart whose read stopped at the limit does not call its sum the total, and marks the oldest buckets', async () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ opened_at: cell(i < 2990 ? '2026-10-27 09:00:00' : '2026-10-21 09:00:00') }));
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query' && c.fields.join() === 'opened_at', then: (c) => big.slice(c.options.offset, c.options.offset + c.options.limit) },
      { when: (c) => c.kind === 'aggregate', then: count(9000) },
    ],
  });
  const r = await run({ kind: 'builder', config: { table: 'incident', groupBy: 'opened_day' } }, inst);
  assert.equal(r.data.total, 3000);
  assert.match(r.data.basedOn, /the first ones read; there are more/);
  assert.deepEqual(r.data.series.partial.slice(-8), [true, true, false, false, false, false, false, false], 'up to the oldest day read');
  const markup = html(h(BuilderChart, { data: r.data, env }));
  assert.match(markup, /The oldest 24 days are only partly counted/);
});

test('builder: the Preview asks what the saved widget asks (HR tables, the dashboard\'s params), and the editor opens', () => {
  const dash = { blocked: ['x'], allowSensitive: true, widgetParams: () => ({ asOf: NOW }) };
  const config = normalizeBuilderConfig({ table: 'sn_hr_core_case' });
  assert.deepEqual(builderRequest(config, dash), { kind: 'builder', config, blocked: ['x'], params: { asOf: NOW }, allowSensitive: true });
  assert.deepEqual(builderRequest(config, { blocked: [] }), { kind: 'builder', config, blocked: [], params: {} });
  // It used to name its preview state `shown`, hiding shown() it draws every label with: opening the editor threw.
  const markup = html(h(BuilderEditor, { env: { page: { tabId: 1 }, blocked: [], refreshKey: 0 }, usableTables: ['incident'], onSave() {}, onCancel() {} }));
  assert.match(markup, /New custom report/);
  const avg = html(h(BuilderEditor, { initial: { table: 'incident', groupBy: 'state', metric: 'avg_age_days' }, env: { page: { tabId: 1 }, blocked: [] }, usableTables: ['incident'], onSave() {}, onCancel() {} }));
  assert.match(avg, /<option value="donut" disabled="">/, 'no donut for an average');
});

// ---- P3.24 / P3.26: days in the person's zone ---------------------------------------------------------------------------------------

// A zone whose clocks jump forward AT midnight (as America/Santiago on 6 Sep 2026: 00:00 -> 01:00): UTC-4 (240) before
// 04:00 UTC on 6 Sep, UTC-3 (180) after.
const santiago = (ms) => (ms >= Date.UTC(2026, 8, 6, 4) ? 180 : 240);
// The opposite side of the world (as Asia/Beirut on 29 Mar 2026: 00:00 -> 01:00): UTC+2 (-120) before 22:00 UTC on 28 Mar, UTC+3 after.
const beirut = (ms) => (ms >= Date.UTC(2026, 2, 28, 22) ? -180 : -120);

test('time: where the clocks jump forward at midnight, the day starts at the first instant that is on it', () => {
  const starts = bucketStarts({ now: Date.UTC(2026, 8, 7, 15), unit: 'day', count: 3, offsetMin: santiago });
  assert.deepEqual(starts.map((s) => new Date(s).toISOString()), ['2026-09-05T04:00:00.000Z', '2026-09-06T04:00:00.000Z', '2026-09-07T03:00:00.000Z']);
  assert.deepEqual(bucketLabels(starts, santiago), ['Sep 5', 'Sep 6', 'Sep 7'], 'no day labelled twice');
  assert.equal(new Date(startOfLocalDay(Date.UTC(2026, 8, 6, 16), santiago)).toISOString(), '2026-09-06T04:00:00.000Z', '"today" holds no hour of yesterday');
  assert.equal(new Date(startOfLocalDay(Date.UTC(2026, 2, 29, 12), beirut)).toISOString(), '2026-03-28T22:00:00.000Z');
  assert.equal(new Date(startOfLocalDay(Date.UTC(2026, 2, 28, 12), beirut)).toISOString(), '2026-03-27T22:00:00.000Z');
});

test('time: calendar days and weeks in the person\'s zone', () => {
  const evening = Date.UTC(2026, 9, 26, 20); // Monday 20:00 UTC
  const morning = Date.UTC(2026, 9, 27, 9); // Tuesday 09:00 UTC
  assert.equal(localDaysBetween(evening, morning, 0), 1, '13 hours, but yesterday');
  assert.equal(localDaysBetween(Date.UTC(2026, 9, 27, 1), morning, 0), 0);
  assert.equal(localDaysBetween(evening, morning, -300), 0, 'UTC+5: both are Tuesday there');
  assert.equal(localDaysBetween(morning, evening, 0), 0, 'never negative');
  assert.equal(localWeeksCovering(morning - 7 * DAY, morning, 0), 2);
  assert.equal(localWeeksCovering(morning - HOUR, morning, 0), 1);
});

test('age: a ticket opened yesterday evening is 1 day old, not "opened today"', async () => {
  const row = (n, opened) => ({ sys_id: cell(id(n)), number: cell(`RITM${n}`), short_description: cell('Laptop'), state: cell('1', 'Open'), opened_at: cell(opened), assigned_to: cell('', ''), assignment_group: cell('', '') });
  const items = oldestItems([{ table: 'sc_req_item', label: 'Requested items', rows: [row(1, '2026-10-26 20:00:00'), row(2, '2026-10-27 01:00:00')] }], { now: Date.UTC(2026, 9, 27, 9), tz: 0 });
  assert.deepEqual(items.map((i) => [i.number, i.ageDays]), [['RITM1', 1], ['RITM2', 0]]);
  // The hand-over's "oldest open" in the person's zone (UTC-5: 20:00 UTC on Monday is 15:00 there, 09:00 UTC on Tuesday is 04:00).
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.table === 'incident' && c.query.endsWith('ORDERBYopened_at'), then: [row(3, '2026-10-26 20:00:00')] }] });
  const at = (offsetMin) => run({ section: 'handover', scope: { kind: 'mine' }, tables: ['incident'] }, inst, { now: Date.UTC(2026, 9, 27, 9), offsetMin });
  assert.equal((await at(0)).data.oldest[0].ageDays, 1);
  assert.equal((await at(300)).data.oldest[0].ageDays, 1);
  assert.equal((await at(-300)).data.oldest[0].ageDays, 0, 'UTC+5: opened 01:00 Tuesday, read 14:00 Tuesday');
});
