const test = require('node:test');
const assert = require('node:assert/strict');
import { runReport, createRuntime, resultTables } from '../src/reports/engine/index.js';
import { normalizeBuilderConfig, describeFilter, GROUP_BY, METRICS, CHARTS } from '../src/reports/engine/builder.js';
import { fakeInstance, cell, group, count, USER, GROUP_A, NOW, DAY } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const build = (config, instance, extra = {}) => runReport({ kind: 'builder', config }, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...extra });

test('a builder configuration is cleaned: unknown names fall back, nothing free-form survives', () => {
  assert.deepEqual(normalizeBuilderConfig(undefined), { table: 'incident', presets: [], groupBy: 'state', metric: 'count', chart: 'bar', title: '' });
  const c = normalizeBuilderConfig({ table: 'users; DROP', presets: ['open', 'x^y', 'last_7', 'last_30'], groupBy: 'caller_id^x', metric: 'sum', chart: 'pie', title: '  My\u0000 report  ' });
  assert.equal(c.table, 'incident');
  assert.deepEqual(c.presets, ['open', 'last_7']);
  assert.equal(c.groupBy, 'state');
  assert.equal(c.metric, 'count');
  assert.equal(c.chart, 'bar');
  assert.equal(c.title, 'My  report');
  assert.equal(normalizeBuilderConfig({ title: 'x'.repeat(200) }).title.length, 60);
  assert.equal(normalizeBuilderConfig({ table: 'problem' }).table, 'problem');
  assert.equal(normalizeBuilderConfig({ table: 'sys_user' }).table, 'incident', 'only the report tables');
});

test('time groupings are always counts, shown as lines; a line needs a time grouping', () => {
  const t = normalizeBuilderConfig({ groupBy: 'opened_day', metric: 'avg_resolve_days', chart: 'donut' });
  assert.deepEqual([t.metric, t.chart], ['count', 'line']);
  assert.equal(normalizeBuilderConfig({ groupBy: 'opened_week' }).chart, 'line');
  assert.equal(normalizeBuilderConfig({ groupBy: 'state', chart: 'line' }).chart, 'bar');
  assert.equal(normalizeBuilderConfig({ groupBy: 'state', chart: 'donut' }).chart, 'donut');
});

test('every option the screen offers is accepted as is', () => {
  GROUP_BY.forEach((g) => assert.equal(normalizeBuilderConfig({ groupBy: g.id }).groupBy, g.id));
  METRICS.forEach((m) => assert.equal(normalizeBuilderConfig({ groupBy: 'state', metric: m.id }).metric, m.id));
  CHARTS.forEach((c) => assert.ok(normalizeBuilderConfig({ groupBy: 'opened_day', chart: c.id }).chart));
});

test('the filter heading names the presets', () => {
  assert.equal(describeFilter(['open', 'my_groups']), 'Open, In my groups');
  assert.equal(describeFilter([]), 'All tickets');
});

test('count by state: one Aggregate read with the filter, bars sorted, each with a drill-down query', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'state', then: [group('state', '1', 'New', 2), group('state', '2', 'In Progress', 9), group('state', '3', 'On Hold', 4)] }] });
  const r = await build({ table: 'incident', presets: ['open', 'assigned_to_me'], groupBy: 'state', metric: 'count', chart: 'bar' }, inst);
  const d = r.data;
  assert.equal(d.available, true);
  assert.deepEqual(d.items.map((i) => [i.label, i.value]), [['In Progress', 9], ['On Hold', 4], ['New', 2]]);
  assert.equal(d.total, 15);
  assert.equal(d.query, `active=true^assigned_to=${USER}`);
  assert.equal(d.items[0].query, `active=true^assigned_to=${USER}^state=2`);
  assert.equal(d.table, 'incident');
  assert.equal(r.scope.label, 'Open, Assigned to me');
  assert.equal(resultTables(r)[0].rows.length, 3);
  assert.equal(resultTables(r)[0].columns[0].label, 'State');
});

test('a value from the instance that holds a caret cannot add conditions to the drill-down', async () => {
  const inst = fakeInstance({
    rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'category', then: [group('category', 'x^assigned_to=1', 'Evil', 3), group('category', 'a\nb', 'Newline', 2), group('category', 'javascript:alert(1)', 'Script', 1), group('category', '', '', 5)] }],
  });
  const r = await build({ table: 'incident', presets: ['open'], groupBy: 'category' }, inst);
  const by = Object.fromEntries(r.data.items.map((i) => [i.label, i.query]));
  assert.equal(by.Evil, 'active=true^category=x^^assigned_to=1');
  assert.equal(by.Newline, '', 'no drill-down rather than an unsafe one');
  assert.equal(by.Script, '');
  assert.equal(by['(empty)'], 'active=true^categoryISEMPTY');
});

test('no grouping gives one number', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.table === 'problem', then: count(17) }] });
  const r = await build({ table: 'problem', presets: ['open'], groupBy: 'none', chart: 'table' }, inst);
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].value, 17);
  assert.equal(r.data.total, 17);
});

test('"in my groups" reads the membership; with none it says so instead of querying every ticket', async () => {
  const ok = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] }, { when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'state', then: [group('state', '2', 'In Progress', 1)] }] });
  const r = await build({ presets: ['my_groups'], groupBy: 'state' }, ok);
  assert.equal(r.data.query, `assignment_groupIN${GROUP_A}`);
  const none = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_grmember', then: [] }] });
  const empty = await build({ presets: ['my_groups'], groupBy: 'state' }, none);
  assert.equal(empty.data.available, false);
  assert.match(empty.data.reason, /not in any group/);
  assert.equal(none.calls.filter((c) => c.kind === 'aggregate').length, 0);
  const denied = fakeInstance({ denied: ['sys_user_grmember'] });
  assert.match((await build({ presets: ['my_groups'] }, denied)).data.reason, /not available to you/);
});

test('"SLA breached" finds the breached tickets first and filters by their ids', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [{ task: cell(id(1)) }, { task: cell(id(2)) }, { task: cell(id(1)) }, { task: cell('junk') }] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'priority', then: [group('priority', '1', '1 - Critical', 2)] },
    ],
  });
  const r = await build({ presets: ['open', 'breached'], groupBy: 'priority' }, inst);
  assert.equal(r.data.query, `active=true^sys_idIN${id(1)},${id(2)}`);
  assert.equal(inst.calls.find((c) => c.table === 'task_sla').query, 'active=true^has_breached=true^task.sys_class_name=incident');
  // Nothing breached (SLA records are visible, none of them breached): match nothing, never everything.
  const quiet = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.table === 'task_sla' && c.query !== '', then: [] }] });
  const q = await build({ presets: ['breached'], groupBy: 'none' }, quiet);
  assert.match(q.data.query, /^sys_idIN0{32}$/);
  // No SLA record visible at all: that is not "nothing breached" (tests/reports-hardening.test.js has the details).
  const unseen = await build({ presets: ['breached'], groupBy: 'none' }, fakeInstance({ hidden: ['task_sla'] }));
  assert.equal(unseen.data.available, false);
  const noSla = await build({ presets: ['breached'] }, fakeInstance({ denied: ['task_sla'] }));
  assert.match(noSla.data.reason, /SLA information is not available/);
});

test('a table the person cannot read gives a plain reason, not an empty chart', async () => {
  const denied = await build({ table: 'problem', groupBy: 'state' }, fakeInstance({ denied: ['problem'] }));
  assert.equal(denied.data.available, false);
  assert.equal(denied.data.status, 'denied');
  assert.match(denied.data.reason, /not available to you/);
  const hidden = await build({ table: 'problem', groupBy: 'state' }, fakeInstance({ hidden: ['problem'] }));
  assert.equal(hidden.data.status, 'hidden');
});

test('a column the table does not have is reported, not charted as empty', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'cmdb_ci', then: { stats: { count: '5' } } }] });
  const r = await build({ groupBy: 'cmdb_ci' }, inst);
  assert.equal(r.data.available, false);
  assert.match(r.data.reason, /not available on incidents/);
});

test('opened per day: the date column is bucketed here, newest first, and a cap is reported', async () => {
  const at = (d, h) => ({ opened_at: `2026-10-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:00:00` });
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.table === 'incident' && c.fields.join() === 'opened_at', then: [at(27, 9), at(27, 10), at(26, 9), at(20, 9)] }] });
  const r = await build({ presets: ['open'], groupBy: 'opened_day' }, inst);
  const d = r.data;
  assert.equal(d.series.labels.length, 30);
  assert.deepEqual(d.series.values.slice(-2), [1, 2]);
  assert.equal(d.total, 4);
  assert.equal(d.timeUnit, 'day');
  assert.match(inst.calls.find((c) => c.kind === 'query' && c.query !== '').query, /^active=true\^opened_at>=2026-09-28 00:00:00\^ORDERBYDESCopened_at$/);

  const big = Array.from({ length: 3000 }, () => at(27, 9));
  const capped = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'query' && c.fields.join() === 'opened_at', then: (c) => big.slice(c.options.offset, c.options.offset + c.options.limit) },
      { when: (c) => c.kind === 'aggregate', then: count(9000) },
    ],
  });
  const cr = await build({ groupBy: 'opened_week' }, capped);
  assert.equal(cr.caps.length, 1);
  assert.match(cr.caps[0].note, /first 3000 of 9000/);
  assert.equal(cr.data.series.labels.length, 12);
});

test('average days to resolve, per group, from the rows that have both dates', async () => {
  const row = (state, opened, resolved) => ({ state: cell(state === 'In' ? '2' : '6', state === 'In' ? 'In Progress' : 'Resolved'), opened_at: cell(opened), resolved_at: cell(resolved) });
  const inst = fakeInstance({
    rules: [
      {
        when: (c) => c.kind === 'query' && c.table === 'incident' && c.fields.includes('resolved_at') && c.query !== '',
        then: [row('R', '2026-10-20 00:00:00', '2026-10-22 00:00:00'), row('R', '2026-10-20 00:00:00', '2026-10-21 00:00:00'), row('In', '2026-10-01 00:00:00', '2026-10-11 00:00:00'), row('R', '2026-10-22 00:00:00', '2026-10-21 00:00:00')],
      },
    ],
  });
  const r = await build({ presets: ['last_30'], groupBy: 'state', metric: 'avg_resolve_days', chart: 'bar' }, inst);
  const d = r.data;
  assert.equal(d.unit, 'days');
  assert.deepEqual(d.items.map((i) => [i.label, i.value, i.n]), [['In Progress', 10, 1], ['Resolved', 1.5, 2]]);
  assert.equal(d.total, 3, 'the row resolved before it was opened is skipped');
  assert.equal(d.overall, 4.3);
  assert.match(inst.calls.find((c) => c.kind === 'query' && c.query !== '').query, /resolved_atISNOTEMPTY/);
  assert.equal(resultTables(r)[0].columns[1].label, 'Average days to resolve');
});

test('average age counts only open tickets', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'query' && c.table === 'incident' && c.query !== '', then: [{ opened_at: cell('2026-10-25 12:00:00'), assigned_to: cell('a1', 'Ann Lee') }, { opened_at: cell('2026-10-23 12:00:00'), assigned_to: cell('a1', 'Ann Lee') }] }] });
  const r = await build({ groupBy: 'assigned_to', metric: 'avg_age_days' }, inst);
  assert.match(inst.calls.find((c) => c.kind === 'query' && c.query !== '').query, /^active=true\^ORDERBYDESCopened_at$/);
  assert.deepEqual(r.data.items.map((i) => [i.label, i.value]), [['Ann Lee', 3]]);
  assert.equal(r.data.person, true);
  assert.equal(resultTables(r)[0].columns[0].person, true);
});

test('averages need a resolved date column', async () => {
  const inst = fakeInstance({ missingColumns: ['resolved_at', 'closed_at'] });
  const r = await build({ groupBy: 'state', metric: 'avg_resolve_days' }, inst);
  assert.equal(r.data.available, false);
  assert.match(r.data.reason, /no resolved date/);
});

test('the builder honours the policy: a blocked table is never read', async () => {
  const inst = fakeInstance();
  const r = await build({ table: 'change_request' }, inst, { blocked: ['change_request'] });
  assert.equal(r.data.available, false);
  assert.equal(r.data.status, 'blocked');
  assert.equal(inst.calls.length, 0);
});

test('window presets are real dates, not text', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate', then: [group('state', '2', 'In Progress', 1)] }] });
  const r = await build({ presets: ['last_7'], groupBy: 'state' }, inst);
  assert.equal(r.data.query, `opened_at>=${new Date(NOW - 7 * DAY).toISOString().slice(0, 19).replace('T', ' ')}`);
});
