// Drill-downs that open a ServiceNow LIST are real links (like tickets); the Team dashboard stops restarting its widgets when the
// ServiceNow tab moves; the full page keeps its dashboard while that tab loads; My day says what an empty list means.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tile, HorizontalBar, StackedBar, Donut, HeatStrip } from '../src/sidepanel/charts/index.js';
import { hrefOf } from '../src/sidepanel/charts/DrillLink.jsx';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { OverviewBody } from '../src/sidepanel/reports/OverviewView.jsx';
import { WorkloadBody } from '../src/sidepanel/reports/WorkloadView.jsx';
import { FulfilmentBody } from '../src/sidepanel/reports/FulfilmentView.jsx';
import { BuilderChart } from '../src/sidepanel/reports/BuilderView.jsx';
import SectionShell from '../src/sidepanel/reports/SectionShell.jsx';
import WidgetBoundary from '../src/sidepanel/reports/WidgetBoundary.jsx';
import { listUrl } from '../src/sidepanel/reports/drill.js';
import { pageIdentity, visibleWidgets, widgetParams } from '../src/sidepanel/reports/dashboardEnv.js';
import { retryDelay, LOST_TOUCH_RETRY_MS } from '../src/sidepanel/reports/useReport.js';
import { nextSource } from '../src/dashboard/sourceTab.js';
import { summaryText, emptyText, idleText, accessText } from '../src/sidepanel/MyDayView.jsx';
import { normalizePolicy } from '../src/policy/policy.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const count_ = (markup, re) => (markup.match(re) || []).length;
const noop = () => {};
const ORIGIN = 'https://acme.service-now.com';
const PAGE = { tabId: 7, href: `${ORIGIN}/now/nav/ui/home`, surface: 'classic' };
const env = { openList() {}, openTicket() {}, scopeKind: 'groups', mask: false, setMask() {}, canEdit: true, setWidgetParams() {}, noteRead() {}, blocked: [], listHref: (table, query) => listUrl(PAGE, table, query) };

function assertRealLinks(markup, label) {
  const links = markup.match(/<a [^>]*data-ab-link="list"[^>]*>/g) || [];
  assert.ok(links.length > 0, `${label}: no list link`);
  for (const a of links) {
    assert.match(a, new RegExp(`href="${ORIGIN.replace(/\./g, '\\.')}/nav_to\\.do\\?uri=`), `${label}: the address is on the page's own instance`);
    assert.match(a, /target="_blank"/, `${label}: Ctrl/middle-click and the menu open a new tab`);
    assert.match(a, /rel="noopener noreferrer"/, `${label}: no opener for the new tab`);
    assert.match(a, /aria-label="[^"]+\. Open the list\."/, `${label}: named with its numbers`);
  }
  assert.ok(!/\sstyle="/.test(markup), `${label}: inline style`);
  assert.ok(!/\son[a-z]+="/i.test(markup), `${label}: inline handler`);
}

// ---- the chart kit -------------------------------------------------------------------------------------------------------

const ITEMS = [{ key: 'new', label: 'New', value: 8, query: 'state=1' }, { key: 'wip', label: 'In Progress', value: 12, query: 'state=2' }];
const hrefFor = (item) => listUrl(PAGE, 'incident', item.query);

test('charts: with an address every bar row, legend row and heat cell is a real link, not a button', () => {
  const bars = html(h(HorizontalBar, { title: 'By state', items: ITEMS, onDrill: noop, hrefFor }));
  assert.equal(count_(bars, /<a class="ab-hbar-row"/g), 2);
  assert.ok(!/<button type="button" class="ab-hbar-row"/.test(bars));
  assertRealLinks(bars, 'bars');
  assert.match(bars, /aria-label="New: 8, 40%\. Open the list\."/);
  assert.match(bars, /role="group"/, 'a chart with links is a labelled group, not an image that would hide them');

  const donut = html(h(Donut, { title: 'Mix', items: ITEMS, onDrill: noop, hrefFor }));
  assert.equal(count_(donut, /<a class="ab-legend-item"/g), 2);
  assertRealLinks(donut, 'donut');

  const heat = html(h(HeatStrip, { title: 'Age', cells: ITEMS, onDrill: noop, hrefFor }));
  assert.equal(count_(heat, /<a class="ab-heat-cell ab-heat-\d"/g), 2);
  assertRealLinks(heat, 'heat');
});

test('charts: a stacked row is one link (label, total and bar) and its segments are not separate targets', () => {
  const rows = [{ key: 'ann', label: 'Ann', parts: [{ key: 'new', value: 3 }, { key: 'wip', value: 5 }] }, { key: '__others', label: 'Others (4)', parts: [{ key: 'new', value: 9 }] }];
  const markup = html(h(StackedBar, { title: 'Workload', rows, series: [{ key: 'new', label: 'New' }, { key: 'wip', label: 'In progress' }], onDrill: noop, hrefFor: (key) => (key === 'ann' ? listUrl(PAGE, 'incident', 'assigned_to=x') : '') }));
  assert.equal(count_(markup, /<a class="ab-stack-row ab-stack-link"/g), 1, 'only the row with an address');
  assert.match(markup, /aria-label="Ann: 8 \(New 3, In progress 5\)\. Open the list\."/);
  assert.ok(!/role="button"/.test(markup), 'no segment buttons inside a link');
  assert.ok(!/tabindex/.test(markup));
  assertRealLinks(markup, 'stacked');
});

test('charts: an item whose address cannot be built is not clickable at all (nothing pretends to open)', () => {
  const bars = html(h(HorizontalBar, { title: 'By state', items: ITEMS, onDrill: noop, hrefFor: () => '' }));
  assert.ok(!/<a |<button type="button" class="ab-hbar-row"/.test(bars));
  assert.match(bars, /role="img"/, 'nothing interactive: one image with its summary again');
  // Callers that give no hrefFor keep the buttons they had.
  assert.equal(count_(html(h(HorizontalBar, { title: 'x', items: ITEMS, onDrill: noop })), /<button type="button" class="ab-hbar-row"/g), 2);
});

test('charts: hrefOf accepts web addresses only', () => {
  assert.equal(hrefOf(() => `${ORIGIN}/x`), `${ORIGIN}/x`);
  assert.equal(hrefOf(() => 'javascript:alert(1)'), '');
  assert.equal(hrefOf(() => { throw new Error('x'); }), '');
  assert.equal(hrefOf(undefined), '');
  assert.equal(hrefOf(() => 42), '');
});

test('Tile: with an address it is a link; without one (a tile that opens a choice) it stays a button', () => {
  const link = html(h(Tile, { label: 'Open', value: 12, hint: 'Active', onOpen: noop, href: listUrl(PAGE, 'incident', 'active=true') }));
  assert.match(link, /^<a class="ab-tile ab-tone-neutral ab-tile-button ab-tile-link"/);
  assertRealLinks(link, 'tile');
  assert.match(link, /aria-label="Open: 12, Active\. Open the list\."/);
  assert.match(html(h(Tile, { label: 'Open', value: 12, onOpen: noop })), /^<button type="button"/);
  assert.ok(!/<a /.test(html(h(Tile, { label: 'Open', value: 12, unavailable: true, onOpen: noop, href: `${ORIGIN}/x` }))), 'nothing to open when unavailable');
});

// ---- the report views ----------------------------------------------------------------------------------------------------

const id = (n) => String(n).padStart(32, '0');
const world = () =>
  fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(4) },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 2, then: (c) => [group2(c.groupBy[0], 'a1', 'Ann Lee', c.groupBy[1], '2', 'In Progress', 4)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 1, then: (c) => [group(c.groupBy[0], '2', 'In Progress', 3), group(c.groupBy[0], '3', 'On Hold', 2)] },
      { when: (c) => c.kind === 'aggregate', then: count(5) },
    ],
  });
const section = (name, tables = ['incident', 'sc_req_item']) => runReport({ section: name, scope: { kind: 'groups' }, tables, params: {} }, { deps: world().deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

test('Overview: a tile with one list is a link to exactly that list; a tile with several tables opens a choice', async () => {
  const one = await section('overview', ['incident']);
  const markup = html(h(OverviewBody, { d: one.data, env }));
  assertRealLinks(markup, 'overview');
  const openTile = one.data.tiles.find((t) => t.key === 'open');
  assert.ok(markup.includes(`href="${listUrl(PAGE, 'incident', openTile.drills[0].query).replace(/&/g, '&amp;')}"`), 'the link opens the query the number counted');
  const two = await section('overview', ['incident', 'sc_req_item']);
  const m2 = html(h(OverviewBody, { d: two.data, env }));
  assert.match(m2, /<button type="button" class="ab-tile [^"]*ab-tile-button" aria-label="Open:/, 'several tables: a button that offers them');
});

test('Workload, Fulfilment and the builder: the bars, rows and cells that open a list are links', async () => {
  const wl = await section('workload', ['incident']);
  assertRealLinks(html(h(WorkloadBody, { d: wl.data, env })), 'workload');
  const ff = await section('fulfilment', ['sc_req_item']);
  assertRealLinks(html(h(FulfilmentBody, { d: ff.data, env })), 'fulfilment');
  const builder = { config: { chart: 'bar' }, table: 'incident', tableLabel: 'Incidents', groupBy: 'state', groupLabel: 'State', metric: 'count', unit: 'tickets', query: 'active=true', filter: 'Open', items: [{ key: '1', label: 'New', value: 3, n: 3, query: 'active=true^state=1' }] };
  assertRealLinks(html(h(BuilderChart, { data: builder, env })), 'builder bars');
  assertRealLinks(html(h(BuilderChart, { data: { ...builder, config: { chart: 'donut' } }, env })), 'builder donut');
  assertRealLinks(html(h(BuilderChart, { data: { ...builder, groupBy: 'none', items: [{ key: 'all', label: 'Incidents', value: 3, query: 'active=true' }] }, env })), 'builder number');
});

test('the widget frame: an error offers "Try again" (not for an expired session, which needs a login first)', () => {
  const failed = html(h(SectionShell, { title: 'Overview', state: { phase: 'error', error: 'It took too long.', result: null, busy: false, reload: noop, code: 'TIMEOUT' }, env }));
  // The panel's shared ErrorNote: the reason in plain words, then "Try again".
  assert.match(failed, /class="ab-note ab-note-danger ab-errnote" role="alert"><p class="ab-errnote-text">It took too long\.<\/p>/);
  assert.match(failed, /<button type="button" class="ab-btn ab-btn-sm">Try again<\/button>/);
  const expired = html(h(SectionShell, { title: 'Overview', state: { phase: 'error', error: 'Your ServiceNow session has expired.', result: null, busy: false, reload: noop, code: 'SESSION_EXPIRED' }, env }));
  assert.ok(!/Try again/.test(expired));
  const boundary = html(h(WidgetBoundary, { title: 'Overview', resetKey: 1 }, h('p', null, 'fine')));
  assert.equal(boundary, '<p>fine</p>', 'a widget that draws is untouched by its boundary');
});

// ---- the dashboard -------------------------------------------------------------------------------------------------------

test('dashboard: moving the ServiceNow tab to another page of the same instance does not change what the widgets depend on', () => {
  const at = (href, extra = {}) => pageIdentity({ ...PAGE, href, ...extra });
  assert.equal(at(`${ORIGIN}/incident_list.do?sysparm_query=active=true`), at(`${ORIGIN}/nav_to.do?uri=incident.do?sys_id=1`));
  assert.notEqual(at(`${ORIGIN}/x`), at('https://other.service-now.com/x'), 'another instance reads again');
  assert.notEqual(at(`${ORIGIN}/x`), at(`${ORIGIN}/x`, { tabId: 8 }), 'another tab reads again');
  assert.notEqual(at(`${ORIGIN}/x`), at(`${ORIGIN}/sp?id=index`, { surface: 'portal', portal: { base: '/sp' } }), 'links are built for another kind of page');
  assert.equal(pageIdentity({ tabId: 1, href: 'not a url' }), '1||||');
});

test('dashboard: the env no longer lists page.href as something that restarts the widgets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'sidepanel', 'reports', 'ReportsDashboard.jsx'), 'utf8');
  const deps = source.slice(source.indexOf('const env = useMemo('), source.indexOf('if (disabled)'));
  assert.ok(!/page\.href/.test(deps), 'page.href is not in the env or its dependencies');
  assert.match(deps, /\[stablePage, layout/);
});

test('dashboard (Insights): an AI section saved on a dashboard is never drawn, one line says where it went, Customize can remove it', () => {
  const widgets = [{ id: 'w-1', type: 'section', section: 'overview' }, { id: 'w-2', type: 'section', section: 'insights' }, { id: 'w-3', type: 'section', section: 'coaching' }];
  for (const policy of [normalizePolicy({ disabledFeatures: ['dashboard-insights'] }), normalizePolicy({ coachingEnabled: true })]) {
    const shown = visibleWidgets(widgets, { policy });
    assert.deepEqual(shown.shown.map((w) => w.id), ['w-1'], 'no AI element on Insights, whatever the policy');
    assert.deepEqual(shown.hidden, ['Explain this dashboard', 'Coaching snapshot (opt-in)']);
    assert.equal(visibleWidgets(widgets, { policy, customize: true }).shown.length, 3);
  }
});

test('dashboard: every widget of one load sends the same "as of" instant with its own params', () => {
  assert.deepEqual(widgetParams({ params: { trend: 'day-14' } }, NOW), { trend: 'day-14', asOf: NOW });
  assert.deepEqual(widgetParams({}, NaN), {});
  assert.deepEqual(widgetParams(undefined, NOW), { asOf: NOW });
});

test('a widget whose page went away while it read asks again twice, then gives up; other errors are shown at once', () => {
  const lost = { code: 'LOST_TOUCH' };
  assert.equal(retryDelay(lost, 0), LOST_TOUCH_RETRY_MS[0]);
  assert.equal(retryDelay(lost, 1), LOST_TOUCH_RETRY_MS[1]);
  assert.equal(retryDelay(lost, 2), null);
  assert.equal(retryDelay({ code: 'SESSION_EXPIRED' }, 0), null);
  assert.equal(retryDelay(new Error('x'), 0), null);
});

test('full page: a dashboard that is showing stays while its ServiceNow tab loads the next page', () => {
  const page = { tabId: 7, href: `${ORIGIN}/a` };
  const ready = { status: 'ready', page };
  assert.deepEqual(nextSource(ready, { status: 'not-enabled' }), { status: 'ready', page, reconnecting: true });
  const back = { status: 'ready', page: { ...page, href: `${ORIGIN}/b` } };
  assert.deepEqual(nextSource({ status: 'ready', page, reconnecting: true }, back), back, 'the tab answers again');
  assert.deepEqual(nextSource(ready, { status: 'gone' }), { status: 'gone' }, 'a closed tab is said at once');
  assert.deepEqual(nextSource({ status: 'checking' }, { status: 'not-enabled' }), { status: 'not-enabled' }, 'nothing to keep on the first check');
});

// ---- My day ----------------------------------------------------------------------------------------------------------------

test('My day: the summary line, the empty-list sentence and the access notes', () => {
  const items = [{ risk: 'breached' }, { risk: 'at-risk' }, { risk: 'ok' }];
  assert.equal(summaryText(items), '3 open tickets: 1 with a breached SLA and 1 with an SLA at risk, listed first.');
  assert.equal(summaryText([{ risk: 'none' }]), '1 open ticket.');
  assert.equal(summaryText([]), '');
  assert.equal(emptyText('nothing'), 'Nothing is assigned to you right now.');
  assert.match(emptyText('unseen'), /cannot tell whether anything is assigned to you/);
  assert.equal(emptyText('unread'), 'None of your ticket queues could be read.');
  assert.equal(idleText(0), 'updated just now');
  assert.equal(idleText(5), 'updated 5h ago');
  assert.equal(idleText(72), 'updated 3d ago');
  assert.match(accessText([{ source: 'sn_customerservice_case', status: 'denied', note: 'You cannot read this table.' }]), /: you cannot read this\./);
  assert.ok(id(1));
});

test('dashboard: "Download all as CSV" takes every table on screen, in widget order, named by its section', async () => {
  const { dashboardTables } = await import('../src/sidepanel/reports/dashboardEnv.js');
  const { resultTables } = await import('../src/reports/engine/index.js');
  const ov = await section('overview', ['incident']);
  const ff = await section('fulfilment', ['sc_req_item']);
  const entries = [{ id: 'w-2', section: 'fulfilment', result: ff }, { id: 'w-1', section: 'overview', result: ov }, { id: 'w-gone', section: 'overview', result: ov }];
  const tables = dashboardTables(entries, ['w-1', 'w-2'], resultTables);
  assert.equal(tables[0].title, 'Overview', 'the overview first, as on screen; its own title is not repeated');
  assert.ok(tables.some((t) => t.title === 'Request fulfilment: Approvals waiting'));
  assert.ok(tables.every((t) => t.rows.length), 'empty tables are left out');
  assert.equal(tables.filter((t) => t.title === 'Overview').length, 1, 'a widget no longer on the dashboard is not exported');
  assert.deepEqual(dashboardTables(null, null, resultTables), []);
});
