// Round 3, Team screen (N15, N17): saved dashboards belong to ONE ServiceNow instance (a group sys_id means nothing elsewhere), the
// first dashboard depends on the role, and a layout can be saved to a file and loaded again, checked like storage.
const test = require('node:test');
const assert = require('node:assert/strict');
import {
  DASHBOARDS_KEY, STORE_VERSION, CAPS, PRESETS, defaultState, instanceKey, createDashboardStore, readStore, stateForInstance, exportLayout,
  importLayout, layoutFileName, LAYOUT_KIND, addDashboard,
} from '../src/reports/dashboards.js';
import { GROUP_A } from './reports-fixtures.js';

let n = 0;
const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
const memory = (initial) => {
  const data = new Map(initial === undefined ? [] : [[DASHBOARDS_KEY, initial]]);
  return { data, writes: 0, get: async (k) => data.get(k), async set(k, v) { this.writes += 1; data.set(k, JSON.parse(JSON.stringify(v))); } };
};
const A = 'https://acme.service-now.com';
const B = 'https://dev364920.service-now.com';
const chosen = { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } };

test('an instance is known by its origin, in lower case; anything else has no key', () => {
  assert.equal(instanceKey('https://ACME.service-now.com/nav_to.do?uri=incident.do'), A);
  assert.equal(instanceKey(`${A}:443/x`), A);
  assert.equal(instanceKey('chrome-extension://abc/dashboard.html'), '');
  assert.equal(instanceKey('not a url'), '');
  assert.equal(instanceKey(undefined), '');
});

test('the first dashboard depends on the role: a lead sees Team overview for their groups, anyone else their own tickets', () => {
  const lead = defaultState(makeId, { lead: true });
  const active = lead.dashboards.find((d) => d.id === lead.activeId);
  assert.equal(active.name, 'Team overview');
  assert.equal(active.scope.kind, 'groups');
  const other = defaultState(makeId);
  const mine = other.dashboards.find((d) => d.id === other.activeId);
  assert.equal(mine.scope.kind, 'mine');
  assert.notEqual(mine.name, 'My day at a glance', 'not the name of the My work screen');
  assert.ok(PRESETS.every((p) => p.widgets.every((w) => !['insights', 'coaching'].includes(w.section))), 'the ready-made dashboards hold no AI section');
});

test('each instance has its own dashboards: what is saved on one never shows on another', async () => {
  const storage = memory();
  const onA = createDashboardStore({ storage, makeId, instance: `${A}/incident.do`, lead: true });
  const first = await onA.load();
  assert.equal(first.status, 'empty');
  assert.equal(first.state.dashboards.find((d) => d.id === first.state.activeId).name, 'Team overview');
  const mine = addDashboard(first.state, { name: 'Network team', scope: chosen }, makeId);
  assert.equal(await onA.save(mine), true);

  const onB = createDashboardStore({ storage, makeId, instance: B });
  const there = await onB.load();
  assert.equal(there.status, 'empty', 'a new instance starts with the ready-made dashboards');
  assert.ok(!JSON.stringify(there.state).includes(GROUP_A), "A's groups are not offered on B");
  assert.equal(await onB.save(addDashboard(there.state, { name: 'B only' }, makeId)), true);

  const stored = storage.data.get(DASHBOARDS_KEY);
  assert.equal(stored.version, STORE_VERSION);
  assert.deepEqual(Object.keys(stored.instances).sort(), [A, B].sort());
  const backOnA = await createDashboardStore({ storage, makeId, instance: A }).load();
  assert.equal(backOnA.status, 'ok');
  assert.ok(backOnA.state.dashboards.some((d) => d.name === 'Network team'));
  assert.ok(!backOnA.state.dashboards.some((d) => d.name === 'B only'));
  assert.equal(stateForInstance(stored, B, makeId).state.dashboards.some((d) => d.name === 'B only'), true);
  assert.equal(stateForInstance(stored, 'https://other.service-now.com', makeId), null, 'a change on another instance says nothing here');
});

test('the earlier one-list format is adopted by the first instance that loads it, and written back per instance at once', async () => {
  const legacy = { version: 1, activeId: 'd-old', dashboards: [{ id: 'd-old', name: 'Old one', scope: chosen, widgets: [{ id: 'w-1', type: 'section', section: 'sla' }] }] };
  const storage = memory(legacy);
  const onA = await createDashboardStore({ storage, makeId, instance: A }).load();
  assert.equal(onA.status, 'ok');
  assert.equal(onA.state.dashboards[0].name, 'Old one');
  assert.deepEqual(Object.keys(storage.data.get(DASHBOARDS_KEY).instances), [A]);
  const onB = await createDashboardStore({ storage, makeId, instance: B }).load();
  assert.equal(onB.status, 'empty', 'a second instance gets its own ready-made dashboards, not the old groups');
});

test('stored data: what is not understood is never trusted, and data from a newer version is never overwritten', async () => {
  for (const bad of ['text', 7, [], { version: 2 }, { version: 2, instances: [] }, { version: 0 }]) assert.equal(readStore(bad).status, 'corrupt', JSON.stringify(bad));
  const hostileKeys = readStore({ version: 2, instances: { [A]: {}, 'javascript:alert(1)': {}, 'HTTPS://ACME.service-now.com': {}, '': {} } });
  assert.deepEqual(Object.keys(hostileKeys.instances).sort(), ['', A].sort(), 'only keys written by instanceKey()');
  const newer = { version: STORE_VERSION + 1, instances: { [A]: { anything: true } } };
  const storage = memory(newer);
  const store = createDashboardStore({ storage, makeId, instance: A });
  assert.equal((await store.load()).status, 'newer');
  assert.equal(await store.save(defaultState(makeId)), false);
  assert.deepEqual(storage.data.get(DASHBOARDS_KEY), newer);
});

test('at most ten instances are kept: the one saved longest ago goes first', async () => {
  const instances = {};
  for (let i = 0; i < CAPS.instances; i += 1) instances[`https://i${i}.service-now.com`] = defaultState(makeId);
  const storage = memory({ version: STORE_VERSION, instances });
  const store = createDashboardStore({ storage, makeId, instance: B });
  await store.load();
  assert.equal(await store.save(defaultState(makeId)), true);
  const keys = Object.keys(storage.data.get(DASHBOARDS_KEY).instances);
  assert.equal(keys.length, CAPS.instances);
  assert.ok(!keys.includes('https://i0.service-now.com'));
  assert.equal(keys[keys.length - 1], B, 'the one just saved is the newest');
});

test('a save keeps what another instance saved in the meantime (it reads again just before writing)', async () => {
  const storage = memory();
  const onA = createDashboardStore({ storage, makeId, instance: A });
  const onB = createDashboardStore({ storage, makeId, instance: B });
  const a = await onA.load();
  const b = await onB.load();
  await onB.save(addDashboard(b.state, { name: 'From B' }, makeId));
  await onA.save(addDashboard(a.state, { name: 'From A' }, makeId));
  const stored = storage.data.get(DASHBOARDS_KEY);
  assert.ok(stored.instances[B].dashboards.some((d) => d.name === 'From B'));
  assert.ok(stored.instances[A].dashboards.some((d) => d.name === 'From A'));
});

// ---- Layout files ------------------------------------------------------------------------------------------------------------

test('a layout file holds the configuration and nothing else, and loads back as a new dashboard', () => {
  const state = defaultState(makeId);
  const team = state.dashboards.find((d) => d.id === 'preset-team');
  const file = exportLayout({ ...team, scope: chosen });
  assert.equal(file.kind, LAYOUT_KIND);
  // "Every table" leaves `tables` out (no null), so the same file also works as the organisation's defaultDashboard policy.
  assert.deepEqual(Object.keys(file.dashboard).sort(), ['name', 'scope', 'widgets']);
  assert.deepEqual(Object.keys(exportLayout({ ...team, tables: ['incident'] }).dashboard).sort(), ['name', 'scope', 'tables', 'widgets']);
  assert.ok(file.dashboard.widgets.every((w) => !('id' in w)), 'ids are made on import');
  assert.equal(layoutFileName('Team overview / night!'), 'agent-buddy-dashboard-team-overview-night.json');

  const text = `\uFEFF${JSON.stringify(file, null, 2)}`; // the download helper writes a byte-order mark
  const loaded = importLayout(text, state, makeId);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.name, 'Team overview (imported)', 'a name that is taken is told apart');
  const added = loaded.state.dashboards.find((d) => d.id === loaded.state.activeId);
  assert.deepEqual(added.widgets.map((w) => w.section), ['overview', 'workload', 'sla', 'quality', 'fulfilment']);
  assert.deepEqual(added.scope, chosen, 'chosen groups come along; the engine checks them against this instance');
  assert.equal(new Set(loaded.state.dashboards.map((d) => d.id)).size, loaded.state.dashboards.length);
});

test('loading a file is checked like storage: wrong files are refused in plain words, hostile content is dropped', () => {
  const state = defaultState(makeId);
  const reasons = [
    ['', /empty/],
    ['{not json', /not a dashboard layout/],
    [JSON.stringify({ kind: 'something-else', version: 1, dashboard: {} }), /not a dashboard layout/],
    [JSON.stringify([1, 2]), /not a dashboard layout/],
    [JSON.stringify({ kind: LAYOUT_KIND, version: 9, dashboard: {} }), /newer version/],
    [JSON.stringify({ kind: LAYOUT_KIND, version: 1, dashboard: 'x' }), /not a dashboard layout/],
    [JSON.stringify({ kind: LAYOUT_KIND, version: 1, dashboard: { name: 'X', widgets: [{ type: 'script', src: 'evil.js' }] } }), /no section this version/],
    ['x'.repeat(CAPS.file + 1), /too big/],
  ];
  for (const [text, reason] of reasons) {
    const out = importLayout(text, state, makeId);
    assert.equal(out.ok, false, text.slice(0, 40));
    assert.match(out.reason, reason);
  }
  const hostile = JSON.stringify({
    kind: LAYOUT_KIND,
    version: 1,
    tickets: ['INC0010001 Abel Tuter'],
    dashboard: { name: `  ${'N'.repeat(300)}`, secret: 'ticket text', scope: { kind: 'chosen', groupIds: ['not-an-id', GROUP_A], rows: [1] }, tables: ['incident', 'sys_user'], widgets: [{ type: 'section', section: 'sla', data: { open: 5 } }, { type: 'section', section: 'nope' }] },
  });
  const out = importLayout(hostile, state, makeId);
  assert.equal(out.ok, true);
  const d = out.state.dashboards.find((x) => x.id === out.state.activeId);
  assert.equal(d.name.length <= CAPS.name, true);
  assert.deepEqual(d.scope.groupIds, [GROUP_A]);
  assert.deepEqual(d.tables, ['incident']);
  assert.deepEqual(d.widgets.map((w) => w.section), ['sla']);
  assert.ok(!/ticket text|Abel|INC00/.test(JSON.stringify(out.state)));
  // Full: the person is told to remove one first.
  let full = defaultState(makeId);
  while (full.dashboards.length < CAPS.dashboards) full = addDashboard(full, { name: `D${full.dashboards.length}` }, makeId);
  assert.match(importLayout(JSON.stringify(exportLayout(full.dashboards[0])), full, makeId).reason, /Remove one first/);
});
