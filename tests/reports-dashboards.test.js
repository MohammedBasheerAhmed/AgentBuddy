const test = require('node:test');
const assert = require('node:assert/strict');
import {
  DASHBOARDS_KEY, DASHBOARDS_VERSION, CAPS, PRESETS, defaultState, sanitizeState, sanitizeDashboard, sanitizeWidget, addDashboard, addPresetDashboard, removeDashboard,
  renameDashboard, setActive, setDashboardSetup, addWidget, removeWidget, updateWidget, moveWidget, createDashboardStore,
} from '../src/reports/dashboards.js';
import { GROUP_A, GROUP_B } from './reports-fixtures.js';

let n = 0;
const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
const memory = (initial) => {
  const data = new Map(initial === undefined ? [] : [[DASHBOARDS_KEY, initial]]);
  return { data, get: async (k) => data.get(k), set: async (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))); } };
};

test('a first run gets the two ready-made dashboards', () => {
  const { state, status } = sanitizeState(undefined, makeId);
  assert.equal(status, 'empty');
  assert.equal(state.version, DASHBOARDS_VERSION);
  assert.deepEqual(state.dashboards.map((d) => d.name), ['My day at a glance', 'Team overview']);
  assert.equal(state.activeId, state.dashboards[0].id);
  assert.deepEqual(state.dashboards[0].scope.kind, 'mine');
  assert.deepEqual(state.dashboards[1].scope.kind, 'groups');
  assert.deepEqual(state.dashboards[1].widgets.map((w) => w.section), ['overview', 'workload', 'sla', 'quality', 'fulfilment']);
});

test('what is stored is configuration only: no key outside the allowed list', () => {
  const { state } = sanitizeState(undefined, makeId);
  const allowed = {
    state: ['version', 'activeId', 'dashboards'],
    dashboard: ['id', 'name', 'scope', 'tables', 'widgets'],
    scope: ['kind', 'groupIds', 'groupNames'],
    widget: ['id', 'type', 'section', 'params', 'builder'],
    builder: ['table', 'presets', 'groupBy', 'metric', 'chart', 'title'],
  };
  const within = (obj, keys) => Object.keys(obj).forEach((k) => assert.ok(keys.includes(k), `unexpected key ${k}`));
  within(state, allowed.state);
  state.dashboards.forEach((d) => {
    within(d, allowed.dashboard);
    within(d.scope, allowed.scope);
    d.widgets.forEach((w) => {
      within(w, allowed.widget);
      if (w.builder) within(w.builder, allowed.builder);
    });
  });
  // Hostile extra data is dropped on the way in.
  const dirty = { version: 1, activeId: 'x', dashboards: [{ id: 'd-1', name: 'A', secret: 'ticket text', results: [1, 2], scope: { kind: 'mine', rows: [1] }, widgets: [{ id: 'w-1', type: 'section', section: 'overview', data: { open: 5 }, params: { trend: 'day-30', rows: [1] } }] }] };
  const clean = sanitizeState(dirty, makeId).state;
  assert.equal(clean.dashboards[0].secret, undefined);
  assert.equal(clean.dashboards[0].results, undefined);
  assert.equal(clean.dashboards[0].widgets[0].data, undefined);
  assert.deepEqual(clean.dashboards[0].widgets[0].params, { trend: 'day-30' });
  assert.ok(!JSON.stringify(clean).includes('ticket text'));
});

test('widgets: sections and builder reports are checked; unknown ones are dropped', () => {
  assert.equal(sanitizeWidget({ type: 'section', section: 'nope' }, makeId), null);
  assert.equal(sanitizeWidget({ type: 'script', src: 'x' }, makeId), null);
  assert.equal(sanitizeWidget(null, makeId), null);
  const w = sanitizeWidget({ type: 'section', section: 'quality', params: { trend: 'bogus', staleDays: 999 } }, makeId);
  assert.equal(w.params, undefined);
  assert.deepEqual(sanitizeWidget({ id: 'w-keep', type: 'section', section: 'overview', params: { staleDays: 5 } }, makeId), { id: 'w-keep', type: 'section', section: 'overview', params: { staleDays: 5 } });
  const b = sanitizeWidget({ type: 'builder', builder: { table: 'problem', presets: ['open', 'evil'], groupBy: 'state', metric: 'count', chart: 'donut' } }, makeId);
  assert.deepEqual(b.builder.presets, ['open']);
  assert.equal(b.builder.table, 'problem');
  assert.match(b.id, /^w-/);
  assert.match(sanitizeWidget({ id: 'BAD ID!', type: 'section', section: 'overview' }, makeId).id, /^w-/);
});

test('dashboards: names, scope, tables and widget count are capped and cleaned', () => {
  const d = sanitizeDashboard(
    {
      id: 'd-1',
      name: `  ${'x'.repeat(200)}\n  `,
      scope: { kind: 'chosen', groupIds: [GROUP_A, 'junk', GROUP_B], groupNames: { [GROUP_A]: 'Service Desk' } },
      tables: ['incident', 'bogus', 'incident', 'problem'],
      widgets: Array.from({ length: 60 }, () => ({ type: 'section', section: 'overview' })),
    },
    makeId
  );
  assert.equal(d.name.length, CAPS.name);
  assert.deepEqual(d.scope.groupIds, [GROUP_A, GROUP_B]);
  assert.deepEqual(d.tables, ['incident', 'problem']);
  assert.equal(d.widgets.length, CAPS.widgets);
  assert.equal(new Set(d.widgets.map((w) => w.id)).size, CAPS.widgets, 'ids are unique');
  assert.equal(sanitizeDashboard({ name: 'n', scope: { kind: 'chosen', groupIds: [] } }, makeId).scope.kind, 'mine', 'chosen groups with none chosen fall back to mine');
  assert.equal(sanitizeDashboard({ name: '' }, makeId).name, 'My dashboard');
  assert.equal(sanitizeDashboard('x', makeId), null);
  assert.equal(sanitizeDashboard({ tables: [] }, makeId).tables, null);
});

test('stored data that is corrupt or in the wrong shape falls back to the defaults', () => {
  for (const bad of ['text', 42, [], { version: 1 }, { version: 1, dashboards: 'x' }, { version: 0, dashboards: [] }, { version: 1, dashboards: [] }, { version: 1, dashboards: [null, 5, 'x'] }]) {
    const { state, status } = sanitizeState(bad, makeId);
    assert.equal(status, 'corrupt', JSON.stringify(bad));
    assert.equal(state.dashboards.length, 2);
  }
});

test('data written by a newer version is not understood and is never overwritten', async () => {
  const newer = { version: DASHBOARDS_VERSION + 1, dashboards: [{ id: 'd-future', name: 'Future', widgets: [] }] };
  assert.equal(sanitizeState(newer, makeId).status, 'newer');
  const storage = memory(newer);
  const store = createDashboardStore({ storage, makeId });
  const { state, status } = await store.load();
  assert.equal(status, 'newer');
  assert.equal(store.readOnly, true);
  assert.equal(await store.save(state), false);
  assert.deepEqual(storage.data.get(DASHBOARDS_KEY), newer);
});

test('a dashboard list is capped, ids are made unique, and the active one always exists', () => {
  const many = { version: 1, activeId: 'gone', dashboards: Array.from({ length: 30 }, (_, i) => ({ id: i % 2 ? 'd-same' : `d-${i}`, name: `D${i}`, widgets: [] })) };
  const { state } = sanitizeState(many, makeId);
  assert.ok(state.dashboards.length <= CAPS.dashboards);
  assert.equal(new Set(state.dashboards.map((d) => d.id)).size, state.dashboards.length);
  assert.ok(state.dashboards.some((d) => d.id === state.activeId));
});

test('add, rename, switch and remove dashboards; the last one stays', () => {
  let s = defaultState(makeId);
  s = addDashboard(s, { name: 'Night shift', scope: { kind: 'mine' }, widgets: [{ type: 'section', section: 'sla' }] }, makeId);
  assert.equal(s.dashboards.length, 3);
  assert.equal(s.dashboards[2].name, 'Night shift');
  assert.equal(s.activeId, s.dashboards[2].id, 'the new one is shown');
  assert.equal(s.dashboards[2].widgets[0].section, 'sla');
  s = renameDashboard(s, s.dashboards[2].id, '  Late shift  ');
  assert.equal(s.dashboards[2].name, 'Late shift');
  assert.equal(renameDashboard(s, s.dashboards[2].id, '   ').dashboards[2].name, 'Late shift', 'an empty name keeps the old one');
  s = setActive(s, s.dashboards[0].id);
  assert.equal(s.activeId, s.dashboards[0].id);
  assert.equal(setActive(s, 'nope').activeId, s.activeId);
  s = removeDashboard(s, s.dashboards[0].id);
  assert.equal(s.dashboards.length, 2);
  assert.ok(s.dashboards.some((d) => d.id === s.activeId), 'removing the active one picks another');
  s = removeDashboard(s, s.dashboards[0].id);
  assert.equal(s.dashboards.length, 1);
  assert.equal(removeDashboard(s, s.dashboards[0].id).dashboards.length, 1, 'never zero dashboards');
});

test('the number of dashboards is capped when adding', () => {
  let s = defaultState(makeId);
  for (let i = 0; i < 20; i += 1) s = addDashboard(s, { name: `D${i}` }, makeId);
  assert.equal(s.dashboards.length, CAPS.dashboards);
});

test('a ready-made dashboard can be added back once', () => {
  let s = defaultState(makeId);
  s = removeDashboard(s, s.dashboards[1].id);
  assert.equal(s.dashboards.some((d) => d.id === 'preset-team'), false);
  s = addPresetDashboard(s, 'preset-team', makeId);
  assert.equal(s.dashboards.some((d) => d.id === 'preset-team'), true);
  assert.equal(addPresetDashboard(s, 'preset-team', makeId).dashboards.length, s.dashboards.length, 'not twice');
  assert.equal(addPresetDashboard(s, 'nope', makeId), s);
  assert.deepEqual(PRESETS.map((p) => p.id), ['preset-my-day', 'preset-team']);
});

test('widgets: add, remove, reorder (ends stay put), update', () => {
  let s = defaultState(makeId);
  const dash = () => s.dashboards[0];
  const ids = () => dash().widgets.map((w) => w.section);
  assert.deepEqual(ids(), ['overview', 'sla', 'fulfilment']);
  s = addWidget(s, dash().id, { type: 'section', section: 'quality' }, makeId);
  s = addWidget(s, dash().id, { type: 'builder', builder: { table: 'problem', groupBy: 'priority' } }, makeId);
  s = addWidget(s, dash().id, { type: 'section', section: 'bogus' }, makeId);
  assert.equal(dash().widgets.length, 5);
  const last = dash().widgets[4];
  assert.equal(last.type, 'builder');
  s = moveWidget(s, dash().id, last.id, -1);
  assert.equal(dash().widgets[3].id, last.id);
  s = moveWidget(s, dash().id, dash().widgets[0].id, -1);
  assert.deepEqual(ids().slice(0, 2), ['overview', 'sla'], 'the first one cannot move up');
  s = moveWidget(s, dash().id, dash().widgets[4].id, 1);
  assert.equal(dash().widgets.length, 5);
  s = updateWidget(s, dash().id, last.id, { builder: { ...last.builder, chart: 'donut', groupBy: 'state' } });
  assert.equal(dash().widgets.find((w) => w.id === last.id).builder.chart, 'donut');
  s = removeWidget(s, dash().id, last.id);
  assert.equal(dash().widgets.length, 4);
  // The state stays valid after every change.
  assert.equal(sanitizeState(s, makeId).status, 'ok');
  assert.deepEqual(sanitizeState(s, makeId).state, s);
});

test('the widget limit holds when adding', () => {
  let s = defaultState(makeId);
  for (let i = 0; i < 40; i += 1) s = addWidget(s, s.dashboards[0].id, { type: 'section', section: 'overview' }, makeId);
  assert.equal(s.dashboards[0].widgets.length, CAPS.widgets);
});

test('scope and tables can be changed per dashboard, and are cleaned', () => {
  let s = defaultState(makeId);
  const id = s.dashboards[0].id;
  s = setDashboardSetup(s, id, { scope: { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } }, tables: ['incident', 'bogus'] });
  assert.deepEqual(s.dashboards[0].scope, { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } });
  assert.deepEqual(s.dashboards[0].tables, ['incident']);
  s = setDashboardSetup(s, id, { tables: null });
  assert.equal(s.dashboards[0].tables, null);
  assert.equal(s.dashboards[0].scope.kind, 'chosen', 'scope kept when only tables change');
});

test('the store saves a valid state and reads it back', async () => {
  const storage = memory();
  const store = createDashboardStore({ storage, makeId });
  const first = await store.load();
  assert.equal(first.status, 'empty');
  const changed = addWidget(first.state, first.state.dashboards[0].id, { type: 'section', section: 'quality' }, makeId);
  assert.equal(await store.save(changed), true);
  const again = await createDashboardStore({ storage, makeId }).load();
  assert.equal(again.status, 'ok');
  assert.equal(again.state.dashboards[0].widgets.length, 4);
});

test('the store refuses what is invalid, too big, or when storage fails', async () => {
  const storage = memory();
  const store = createDashboardStore({ storage, makeId });
  await store.load();
  assert.equal(await store.save({ version: 1, dashboards: [] }), false);
  assert.equal(await store.save(null), false);
  assert.equal(storage.data.has(DASHBOARDS_KEY), false);
  const failing = createDashboardStore({ storage: { get: async () => undefined, set: async () => { throw new Error('quota'); } }, makeId });
  await failing.load();
  assert.equal(await failing.save(defaultState(makeId)), false);
  const broken = createDashboardStore({ storage: { get: async () => { throw new Error('no storage'); }, set: async () => {} }, makeId });
  const { status, state } = await broken.load();
  assert.equal(status, 'unavailable');
  assert.equal(state.dashboards.length, 2);
});
