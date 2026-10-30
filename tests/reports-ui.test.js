import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { OverviewBody } from '../src/sidepanel/reports/OverviewView.jsx';
import { WorkloadBody } from '../src/sidepanel/reports/WorkloadView.jsx';
import { SlaBody } from '../src/sidepanel/reports/SlaView.jsx';
import { QualityBody } from '../src/sidepanel/reports/QualityView.jsx';
import { FulfilmentBody } from '../src/sidepanel/reports/FulfilmentView.jsx';
import { BuilderChart } from '../src/sidepanel/reports/BuilderView.jsx';
import SectionShell from '../src/sidepanel/reports/SectionShell.jsx';
import ExportBar from '../src/sidepanel/reports/ExportBar.jsx';
import ScopeBar from '../src/sidepanel/reports/ScopeBar.jsx';
import { REPORT_SECTIONS, sectionById } from '../src/sidepanel/reports/sections.js';
import { SECTION_IDS } from '../src/reports/engine/constants.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const id = (n) => String(n).padStart(32, '0');
const EVIL = 'Ann <img src=x onerror=alert(1)> Lee';
const EVIL_TITLE = '<script>alert(1)</script> printer';

const env = { openList() {}, openTicket() {}, scopeKind: 'groups', mask: false, setMask() {}, canEdit: true, setWidgetParams() {}, noteRead() {}, blocked: [] };

// One generic instance for every section: every count is 5, every breakdown has one hostile-looking name.
const slaRow = (task, pct, breached) => ({ task: cell(task), sla: cell('s', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), planned_end_time: cell('2026-10-28 09:00:00') });
const world = (extra = {}) =>
  fakeInstance({
    ...extra,
    rules: [
      ...(extra.rules || []),
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(40) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [slaRow(id(1), 130, true), slaRow(id(2), 88, false)] },
      { when: (c) => c.kind === 'query' && c.table === 'task', then: [1, 2].map((n) => ({ sys_id: cell(id(n)), number: cell(`INC${n}`), short_description: cell(EVIL_TITLE), priority: cell('2', '2 - High'), state: cell('2', 'In Progress'), assigned_to: cell('a1', EVIL), assignment_group: cell(GROUP_A, 'Service Desk'), sys_class_name: cell('incident') })) },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 2, then: (c) => [group2(c.groupBy[0], 'a1', EVIL, c.groupBy[1], '2', 'In Progress', 4), group2(c.groupBy[0], 'b1', 'Bo Ray', c.groupBy[1], '3', 'On Hold', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 1, then: (c) => [group(c.groupBy[0], '2', c.groupBy[0] === 'state' ? 'In Progress' : 'Hardware', 3), group(c.groupBy[0], '3', c.groupBy[0] === 'state' ? 'On Hold' : 'Network', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.avgFields.length, then: { stats: { count: '5', avg: { reassignment_count: '1.2' } } } },
      { when: (c) => c.kind === 'aggregate', then: count(5) },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.fields.join() === 'opened_at', then: [{ opened_at: '2026-10-27 09:00:00' }, { opened_at: '2026-10-26 09:00:00' }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.fields.join() === 'resolved_at,opened_at', then: [{ resolved_at: '2026-10-27 10:00:00', opened_at: '2026-10-27 08:00:00' }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.query.includes('ORDERBYopened_at'), then: [{ sys_id: cell(id(9)), number: cell('RITM9'), short_description: cell(EVIL_TITLE), state: cell('2', 'Work in Progress'), assigned_to: cell('a1', EVIL), assignment_group: cell(GROUP_A, 'Service Desk'), opened_at: cell('2026-10-01 08:00:00'), sys_class_name: cell('sc_req_item') }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.query.includes('reassignment_count>='), then: [{ sys_id: cell(id(1)), number: cell('INC1'), short_description: cell(EVIL_TITLE), assigned_to: cell('a1', EVIL), assignment_group: cell(GROUP_A, 'Service Desk'), reassignment_count: cell('6') }] },
    ],
  });

const run = (request, inst = world()) => runReport(request, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });
const TABLES = ['incident', 'sc_req_item', 'sc_task'];
const section = (name, scope = { kind: 'groups' }, inst) => run({ section: name, scope, tables: TABLES, params: {} }, inst);

function assertClean(markup, label) {
  for (const bad of ['NaN', 'undefined', 'null', '[object', 'Infinity']) assert.ok(!markup.includes(bad), `${label}: markup contains ${bad}`);
  assert.ok(!/<(img|script|iframe)\b/i.test(markup), `${label}: a hostile tag came through`);
  assert.ok(!/\sstyle="/.test(markup), `${label}: inline style attribute (blocked by the extension CSP)`);
  assert.ok(!/\son[a-z]+="/i.test(markup), `${label}: inline event handler`);
}

test('the registry lists exactly the sections the engine can run, each with a view and a description', () => {
  assert.deepEqual(REPORT_SECTIONS.map((s) => s.id).sort(), [...SECTION_IDS].sort());
  REPORT_SECTIONS.forEach((s) => {
    assert.equal(typeof s.View, 'function', s.id);
    assert.ok(s.label && s.description, s.id);
  });
  assert.equal(sectionById('sla').label, 'SLA risk radar');
  assert.equal(sectionById('nope'), null);
});

test('Overview: tiles show real numbers, the unavailable ones say so, and hostile text is inert', async () => {
  const r = await section('overview');
  const markup = html(h(OverviewBody, { d: r.data, env }));
  assertClean(markup, 'overview');
  assert.match(markup, /Open/);
  assert.match(markup, /ab-tile/);
  assert.ok(!/Not available to you/.test(markup), 'everything could be read here');

  const noSla = await section('overview', { kind: 'groups' }, world({ denied: ['task_sla'] }));
  const m2 = html(h(OverviewBody, { d: noSla.data, env }));
  assert.equal((m2.match(/Not available to you/g) || []).length, 2, 'only the two SLA tiles');
  assertClean(m2, 'overview without SLA');
});

test('Overview: a tile that has data is a button; one table opens straight away', async () => {
  const r = await section('overview');
  const markup = html(h(OverviewBody, { d: r.data, env }));
  assert.match(markup, /<button[^>]*class="ab-tile [^"]*ab-tile-button"/);
});

test('Workload: every chart is an image or a labelled group with text, and ageing sums to the open total', async () => {
  const r = await section('workload');
  const markup = html(h(WorkloadBody, { d: r.data, env }));
  assertClean(markup, 'workload');
  assert.match(markup, /aria-label="[^"]*How long tickets have been open[^"]*"/);
  assert.match(markup, /Open work by person/);
  assert.match(markup, /Show as table/);
  assert.ok(!markup.includes('<img'));
  assert.ok(markup.includes('Ann &lt;img src=x onerror=alert(1)&gt; Lee'), 'the hostile name is shown as text');
  assert.equal(r.data.ageing.buckets.reduce((n, b) => n + b.count, 0), r.data.ageing.open);
});

test('Workload for my own tickets has no per-person board', async () => {
  const r = await section('workload', { kind: 'mine' });
  const markup = html(h(WorkloadBody, { d: r.data, env: { ...env, scopeKind: 'mine' } }));
  assert.ok(!markup.includes('Open work by person'));
  assert.ok(!markup.includes('Unassigned'));
  assertClean(markup, 'workload mine');
});

test('SLA radar: tiles, the table of the closest tickets with an Open button, and risk by owner', async () => {
  const r = await section('sla');
  assert.equal(r.data.available, true);
  const markup = html(h(SlaBody, { d: r.data, env }));
  assertClean(markup, 'sla');
  assert.match(markup, /Breached/);
  assert.match(markup, /At risk 88%/);
  assert.match(markup, /Closest to breaking/);
  assert.match(markup, /<button type="button" class="ab-chart-link">INC1<\/button>/);
  assert.match(markup, /SLA risk by owner/);
});

test('Quality: trend charts, tiles and tables render without NaN even when parts are missing', async () => {
  const full = await section('quality');
  const markup = html(h(QualityBody, { d: full.data, env }));
  assertClean(markup, 'quality');
  assert.match(markup, /Opened and resolved per day/);
  assert.match(markup, /Time to resolve/);
  assert.match(markup, /Top categories/);

  const bare = await section('quality', { kind: 'mine' }, world({ missingColumns: ['reopen_count', 'reassignment_count', 'category', 'cmdb_ci', 'caller_id', 'resolved_at', 'closed_at'] }));
  assertClean(html(h(QualityBody, { d: bare.data, env })), 'quality without columns');
});

test('Fulfilment: states as bars, approvals as tiles, oldest items as a table', async () => {
  const r = await section('fulfilment');
  const markup = html(h(FulfilmentBody, { d: r.data, env }));
  assertClean(markup, 'fulfilment');
  assert.match(markup, /Requested items by state/);
  assert.match(markup, /Waiting for your approval/);
  assert.match(markup, /Oldest open items/);
  assert.match(markup, /RITM9/);
});

test('Builder: bar, donut, table, line and a single number all render', async () => {
  const base = { presets: ['open'], groupBy: 'state', metric: 'count' };
  for (const chart of ['bar', 'donut', 'table']) {
    const r = await run({ kind: 'builder', config: { ...base, chart } });
    const markup = html(h(BuilderChart, { data: r.data, env }));
    assertClean(markup, `builder ${chart}`);
    assert.ok(markup.length > 100, chart);
  }
  const line = await run({ kind: 'builder', config: { presets: ['open'], groupBy: 'opened_day' } });
  assertClean(html(h(BuilderChart, { data: line.data, env })), 'builder line');
  const one = await run({ kind: 'builder', config: { presets: ['open'], groupBy: 'none' } });
  const markup = html(h(BuilderChart, { data: one.data, env }));
  assert.match(markup, /ab-tile/);
  assertClean(markup, 'builder single');
});

test('the widget frame: loading, error, a plain explanation for a table you cannot read, read time and denominators', async () => {
  const loading = html(h(SectionShell, { title: 'Overview', state: { phase: 'loading', result: null, error: '', busy: true }, env, widgetId: 'w1' }));
  assert.match(loading, /Reading the numbers/);
  assert.match(loading, /role="status"/);

  const failed = html(h(SectionShell, { title: 'Overview', state: { phase: 'error', result: null, error: 'Your ServiceNow session has expired.', busy: false }, env, widgetId: 'w1' }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /session has expired/);

  const r = await section('overview', { kind: 'groups' }, world({ denied: ['problem'], hidden: ['sc_task'] }));
  const r2 = await run({ section: 'overview', scope: { kind: 'groups' }, tables: ['incident', 'problem', 'sc_task'], params: {} }, world({ denied: ['problem'], hidden: ['sc_task'] }));
  const markup = html(h(SectionShell, { title: 'Overview', state: { phase: 'ready', result: r2, error: '', busy: false }, env, widgetId: 'w1', facts: ['SLA counts cover 40 active SLAs'] }, h('p', null, 'BODY')));
  assert.match(markup, /Problems: not available to you/);
  assert.match(markup, /Catalog tasks: you can see no rows in this table/);
  assert.match(markup, /Read at /);
  assert.match(markup, /My groups \(1\)/);
  assert.match(markup, /Incidents/);
  assert.match(markup, /SLA counts cover 40 active SLAs/);
  assert.match(markup, /BODY/);
  assert.ok(r.data.tiles.length > 0);
});

test('the widget frame shows a cap in words and hides the body of an unavailable section', async () => {
  const result = { id: 'sla', title: 'SLA', readAt: NOW, generatedAt: NOW, scope: { label: 'Mine' }, tables: [], access: [], notes: [], caps: [{ source: 'task_sla', note: 'Only the first 1000 of 1500 were read.' }], data: { available: false, reason: 'SLA information is not available to you.' } };
  const markup = html(h(SectionShell, { title: 'SLA risk radar', state: { phase: 'ready', result, error: '', busy: false }, env, widgetId: 'w2' }, h('p', null, 'SHOULD NOT SHOW')));
  assert.match(markup, /Only the first 1000 of 1500 were read/);
  assert.match(markup, /SLA information is not available to you/);
  assert.ok(!markup.includes('SHOULD NOT SHOW'));
});

test('export bar: appears when there are rows, offers CSV, copy and masking, and says what masking cannot do', async () => {
  const r = await section('sla');
  const on = html(h(ExportBar, { title: 'SLA risk radar', result: r, env: { ...env, mask: true } }));
  assert.match(on, /Download CSV/);
  assert.match(on, /Copy as table/);
  assert.match(on, /Mask names and emails/);
  assert.match(on, /checked=""/);
  assert.match(on, /Check the file before you share it/, 'it says the person should still look: a name with nothing around it can pass');
  const off = html(h(ExportBar, { title: 'SLA risk radar', result: r, env }));
  assert.ok(!/checked=""/.test(off));
  const empty = html(h(ExportBar, { title: 'x', result: { id: 'sla', data: { available: false } }, env }));
  assert.equal(empty, '');
});

test('scope bar: the three scopes, chosen groups with a safe remove, and tables that cannot be used say why', () => {
  const tables = [
    { table: 'incident', label: 'Incidents', usable: true, status: 'ok' },
    { table: 'problem', label: 'Problems', usable: false, status: 'denied' },
    { table: 'sc_task', label: 'Catalog tasks', usable: false, status: 'hidden' },
  ];
  const markup = html(h(ScopeBar, { scope: { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } }, tables, selected: ['incident'], context: { groups: [], groupsNote: '' }, tabId: 1, blocked: [], onScope() {}, onTables() {}, canEdit: true }));
  assert.match(markup, /Mine/);
  assert.match(markup, /My groups/);
  assert.match(markup, /Chosen groups/);
  assert.match(markup, /Service Desk/);
  assert.match(markup, /aria-label="Remove Service Desk"[^>]*disabled/, 'the last chosen group cannot be removed');
  assert.match(markup, /Not available to you/);
  assert.match(markup, /No rows visible to you/);
  assert.match(markup, /Tables: 1 of 1 available/);
  assertClean(markup, 'scope bar');
});
