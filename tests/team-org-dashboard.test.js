import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPS, DASHBOARDS_KEY, PRESETS, STORE_VERSION, LAYOUT_KIND, addDashboard, addOrgDashboard, createDashboardStore, defaultState, importLayout,
  offerOrgDashboard, orgDashboard, removeDashboard, renameDashboard, removeWidget,
} from '../src/reports/dashboards.js';
import ReportsDashboard from '../src/sidepanel/reports/ReportsDashboard.jsx';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { handoverWorld, USER, NOW, GROUP_A } from './reports-ai-fixtures.js';

// N17, the organisation's dashboard (policy key `defaultDashboard`): someone with no dashboards yet on an instance starts with it,
// first and on show (lead or not); someone who already has dashboards is offered it once in the ⋯ menu; nothing is locked. It is read
// exactly like a layout file a person loads.

let n = 0;
const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
const memory = (initial) => {
  const data = new Map(initial === undefined ? [] : [[DASHBOARDS_KEY, initial]]);
  return { data, get: async (k) => data.get(k), async set(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); } };
};
const A = 'https://acme.service-now.com';
const ORG = Object.freeze({
  kind: LAYOUT_KIND,
  version: 1,
  dashboard: { name: 'Service desk today', scope: { kind: 'groups' }, tables: ['incident'], widgets: [{ type: 'section', section: 'overview' }, { type: 'section', section: 'sla', params: { staleDays: 5 } }] },
});
const active = (state) => state.dashboards.find((d) => d.id === state.activeId);
const names = (state) => state.dashboards.map((d) => d.name);

// ---- First run -----------------------------------------------------------------------------------------------------------------

test('a first run starts with the organisation\'s dashboard, first and on show, before the ready-made ones; for a lead too', () => {
  for (const lead of [false, true]) {
    const state = defaultState(makeId, { lead, org: ORG });
    assert.deepEqual(names(state), ['Service desk today', ...PRESETS.map((p) => p.name)], `lead ${lead}`);
    const shown = active(state);
    assert.equal(shown.name, 'Service desk today');
    assert.deepEqual(shown.widgets.map((w) => [w.section, w.params]), [['overview', undefined], ['sla', { staleDays: 5 }]]);
    assert.deepEqual(shown.tables, ['incident']);
    assert.equal(shown.scope.kind, 'groups');
  }
  // Without one (or with one this version cannot show) nothing changes: the lead still starts on Team overview.
  for (const org of [null, 'text', { ...ORG, version: 2 }, { ...ORG, dashboard: { ...ORG.dashboard, widgets: [{ type: 'section', section: 'nope' }] } }, { ...ORG, dashboard: { ...ORG.dashboard, widgets: [] } }]) {
    const state = defaultState(makeId, { lead: true, org });
    assert.deepEqual(names(state), PRESETS.map((p) => p.name), JSON.stringify(org)?.slice(0, 60));
    assert.equal(active(state).name, 'Team overview');
  }
});

test('a ready-made dashboard of the same name gives way to the organisation\'s', () => {
  const org = { ...ORG, dashboard: { ...ORG.dashboard, name: ' team OVERVIEW ' } };
  const state = defaultState(makeId, { lead: true, org });
  assert.deepEqual(names(state), ['team OVERVIEW', 'My numbers', 'Shift handover']);
  assert.equal(active(state).name, 'team OVERVIEW');
});

test('it is read exactly like a layout file a person loads: the same dashboard, hostile parts dropped', () => {
  const hostile = {
    kind: LAYOUT_KIND,
    version: 1,
    dashboard: { name: `  ${'N'.repeat(300)}`, secret: 'ticket text', scope: { kind: 'chosen', groupIds: ['not-an-id', GROUP_A], rows: [1] }, tables: ['incident', 'sys_user'], widgets: [{ type: 'section', section: 'sla', data: { open: 5 } }, { type: 'section', section: 'nope' }, { type: 'script', src: 'x.js' }] },
  };
  const own = orgDashboard(hostile, makeId);
  const loaded = importLayout(JSON.stringify(hostile), { dashboards: [] }, makeId);
  const strip = (d) => ({ ...d, id: '', widgets: d.widgets.map((w) => ({ ...w, id: '' })) });
  assert.deepEqual(strip(own), strip(active(loaded.state)));
  assert.equal(own.name.length, CAPS.name);
  assert.deepEqual(own.scope.groupIds, [GROUP_A]);
  assert.deepEqual(own.tables, ['incident']);
  assert.deepEqual(own.widgets.map((w) => w.section), ['sla']);
  assert.ok(!/ticket text|x\.js|rows/.test(JSON.stringify(own)));
});

// ---- The store -----------------------------------------------------------------------------------------------------------------

test('the store: nothing saved on this instance gives the organisation\'s dashboard first; what a person saved is never changed', async () => {
  const storage = memory();
  const store = createDashboardStore({ storage, makeId, instance: A, org: ORG });
  const first = await store.load();
  assert.equal(first.status, 'empty');
  assert.equal(active(first.state).name, 'Service desk today');
  // Their copy is their own: rename it, take a section off, save, and it comes back as they left it (the policy does not re-impose it).
  let mine = renameDashboard(first.state, first.state.activeId, 'My desk');
  mine = removeWidget(mine, mine.activeId, active(mine).widgets[0].id);
  assert.equal(await store.save(mine), true);
  const again = await createDashboardStore({ storage, makeId, instance: A, org: ORG }).load();
  assert.equal(again.status, 'ok');
  assert.deepEqual(names(again.state), ['My desk', ...PRESETS.map((p) => p.name)]);
  assert.deepEqual(active(again.state).widgets.map((w) => w.section), ['sla']);
  // Someone with dashboards saved before the organisation set one keeps exactly those.
  const before = memory({ version: STORE_VERSION, instances: { [A]: defaultState(makeId) } });
  const kept = await createDashboardStore({ storage: before, makeId, instance: A, org: ORG }).load();
  assert.deepEqual(names(kept.state), PRESETS.map((p) => p.name));
  // Unreadable or newer data: the defaults shown include the organisation's dashboard.
  for (const stored of ['corrupt', { version: STORE_VERSION + 1, instances: {} }]) {
    const fallback = await createDashboardStore({ storage: memory(stored), makeId, instance: A, org: ORG }).load();
    assert.equal(active(fallback.state).name, 'Service desk today', JSON.stringify(stored));
  }
});

// ---- Someone who already has dashboards ----------------------------------------------------------------------------------------

test('someone with their own dashboards is offered it once, by name; adding it shows it; the same limits as loading a file', () => {
  let state = addDashboard(defaultState(makeId), { name: 'Network team' }, makeId);
  assert.equal(offerOrgDashboard(state, ORG), true);
  assert.equal(offerOrgDashboard(state, null), false, 'no organisation dashboard, nothing to offer');
  assert.equal(offerOrgDashboard(state, { ...ORG, kind: 'other' }), false);
  assert.equal(offerOrgDashboard(defaultState(makeId, { org: ORG }), ORG), false, 'a first run has it already');
  const added = addOrgDashboard(state, ORG, makeId);
  assert.equal(added.ok, true);
  assert.equal(added.name, 'Service desk today');
  assert.equal(active(added.state).name, 'Service desk today', 'shown at once');
  assert.equal(added.state.dashboards.length, state.dashboards.length + 1);
  assert.equal(new Set(added.state.dashboards.map((d) => d.id)).size, added.state.dashboards.length);
  state = added.state;
  assert.equal(offerOrgDashboard(state, ORG), false, 'offered once');
  assert.equal(offerOrgDashboard(renameDashboard(state, state.activeId, 'SERVICE DESK TODAY'), ORG), false, 'the name matches whatever its case');
  assert.match(addOrgDashboard(state, ORG, makeId).reason, /already have "Service desk today"/);
  // Nothing is locked: renamed or removed, it is theirs; the menu offers it again.
  assert.equal(offerOrgDashboard(renameDashboard(state, state.activeId, 'Our desk'), ORG), true);
  assert.equal(offerOrgDashboard(removeDashboard(state, state.activeId), ORG), true);
  // Full: told to remove one first, as when loading a file.
  let full = defaultState(makeId);
  while (full.dashboards.length < CAPS.dashboards) full = addDashboard(full, { name: `D${full.dashboards.length}` }, makeId);
  assert.equal(offerOrgDashboard(full, ORG), true, 'still offered: choosing it says why it cannot be added');
  assert.match(addOrgDashboard(full, ORG, makeId).reason, /You have 12 dashboards, the most there can be\. Remove one first\./);
  assert.match(addOrgDashboard(state, 'not a layout', makeId).reason, /has not set a dashboard/);
});

// ---- On screen -----------------------------------------------------------------------------------------------------------------

const eff = (policy = {}, profiles = ['it', 'lead']) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles },
  locked: {},
  policy: normalizePolicy(policy),
});
const page = { tabId: 7, href: `${A}/nav_to.do`, surface: 'classic', record: null, newRecord: null };
const CONTEXT = {
  user: { name: 'Beth Anglin' },
  tables: [{ table: 'incident', label: 'Incidents', status: 'ok', note: '', usable: true }],
  groups: [{ id: GROUP_A, name: 'Service Desk' }],
  readAt: NOW,
};
function world(stored) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  if (stored) fake.chrome.storage.local.data[DASHBOARDS_KEY] = stored;
  const inst = handoverWorld();
  const runtime = createRuntime();
  fake.onRead('reportContext', () => CONTEXT);
  fake.onRead('reportClear', () => ({ ok: true }));
  fake.onRead('reportRun', (args) => runReport({ kind: args.kind, section: args.section, scope: args.scope, tables: args.tables, params: {}, config: args.config }, { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 }));
  return fake;
}
const menuItems = (ui) => ui.$$('[role^="menuitem"]').map((b) => b.textContent.replace(/[✓\s]+/g, ' ').trim());

test('on screen: a lead with nothing saved sees the organisation\'s dashboard first; the menu offers nothing more', async () => {
  world();
  const ui = await mount(<ReportsDashboard page={page} eff={eff({ defaultDashboard: ORG })} layout="panel" />);
  try {
    await settle(8);
    const select = ui.$('.ab-dash-top select');
    assert.equal(select.querySelectorAll('option')[0].textContent, 'Service desk today');
    assert.equal(select.value, select.querySelectorAll('option')[0].getAttribute('value'), 'on show');
    await click(ui.$('.ab-more-btn'));
    assert.ok(!menuItems(ui).includes("Add your organisation's dashboard"));
  } finally {
    await ui.unmount();
  }
});

test('on screen: someone with their own dashboards gets one menu entry; choosing it adds and shows their own copy', async () => {
  const fake = world({ version: STORE_VERSION, instances: { [A]: addDashboard(defaultState(makeId), { name: 'Network team' }, makeId) } });
  const ui = await mount(<ReportsDashboard page={page} eff={eff({ defaultDashboard: ORG })} layout="panel" />);
  try {
    await settle(8);
    assert.equal(ui.$('.ab-dash-top select').querySelectorAll('option')[0].textContent, 'My numbers', 'what they saved is shown as saved');
    await click(ui.$('.ab-more-btn'));
    const items = menuItems(ui);
    assert.equal(items.filter((t) => t === "Add your organisation's dashboard").length, 1);
    assert.equal(items.indexOf("Add your organisation's dashboard"), items.indexOf('Customize') + 1);
    await click(ui.$$('[role="menuitem"]').find((b) => b.textContent === "Add your organisation's dashboard"));
    await settle(4);
    const select = ui.$('.ab-dash-top select');
    const shown = select.querySelectorAll('option').find((o) => o.getAttribute('value') === select.value);
    assert.equal(shown.textContent, 'Service desk today');
    assert.match(ui.text(), /Added "Service desk today", your organisation's dashboard\. It is your own copy/);
    const saved = fake.chrome.storage.local.data[DASHBOARDS_KEY].instances[A];
    assert.ok(saved.dashboards.some((d) => d.name === 'Service desk today'), 'saved as their own');
    await click(ui.$('.ab-more-btn'));
    assert.ok(!menuItems(ui).includes("Add your organisation's dashboard"), 'offered once');
  } finally {
    await ui.unmount();
  }
});

test('on screen: without an organisation dashboard the menu is as before', async () => {
  world({ version: STORE_VERSION, instances: { [A]: addDashboard(defaultState(makeId), { name: 'Network team' }, makeId) } });
  const ui = await mount(<ReportsDashboard page={page} eff={eff({ defaultDashboard: 'not a layout' })} layout="panel" />);
  try {
    await settle(8);
    await click(ui.$('.ab-more-btn'));
    assert.ok(!menuItems(ui).includes("Add your organisation's dashboard"));
  } finally {
    await ui.unmount();
  }
});
