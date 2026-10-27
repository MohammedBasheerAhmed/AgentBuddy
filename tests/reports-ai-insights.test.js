const test = require('node:test');
const assert = require('node:assert/strict');
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { createLoadedStore } from '../src/reports/ai/loaded.js';
import { INSIGHT_CORE, INSIGHT_HEADINGS, INSIGHT_SECTIONS, buildInsightsPack, checkInsightsNote, collectLoaded, describeInputs, insightsParts } from '../src/reports/ai/insights.js';
import { USER, NOW, PRIYA, MARCUS, ZELDA, DASH_CALLER, INJECTION, dashboardWorld } from './reports-ai-fixtures.js';

const TABLES = ['incident', 'sc_req_item', 'sc_task'];
const run = (section, inst = dashboardWorld(), scope = { kind: 'groups' }, params = {}) =>
  runReport({ section, scope, tables: TABLES, params }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

async function loadAll(inst = dashboardWorld(), sections = ['overview', 'workload', 'sla', 'quality', 'fulfilment', 'handover']) {
  const out = [];
  for (const section of sections) out.push({ id: `w-${section}`, section, result: await run(section, inst) });
  return out;
}

// ---- The store -----------------------------------------------------------------------------------------------------------

test('the store remembers what widgets loaded, tells listeners, and keeps one snapshot until something changes', () => {
  const store = createLoadedStore();
  let calls = 0;
  const off = store.subscribe(() => (calls += 1));
  const first = store.snapshot();
  assert.deepEqual(first, []);
  store.set('a', 'overview', { id: 'overview' });
  const second = store.snapshot();
  assert.notEqual(second, first);
  assert.equal(store.snapshot(), second, 'the same array until a change (what useSyncExternalStore needs)');
  assert.equal(calls, 1);
  store.set('a', 'overview', store.snapshot()[0].result);
  assert.equal(calls, 1, 'the same result again is not a change');
  store.set('b', 'sla', { id: 'sla' });
  store.set('a', 'overview', { id: 'overview', again: true });
  assert.deepEqual(store.snapshot().map((e) => e.id), ['a', 'b'], 'a replaced result keeps its place');
  store.remove('zzz');
  assert.equal(calls, 3);
  store.remove('a');
  assert.deepEqual(store.snapshot().map((e) => e.id), ['b']);
  store.set('b', 'sla', null);
  assert.deepEqual(store.snapshot(), [], 'no result means nothing remembered');
  store.set('c', 'sla', { id: 'sla' });
  store.set('', 'sla', { id: 'sla' });
  store.set('d', '', { id: 'sla' });
  assert.equal(store.snapshot().length, 1);
  store.clear();
  assert.deepEqual(store.snapshot(), []);
  off();
  const before = calls;
  store.set('e', 'sla', { id: 'sla' });
  assert.equal(calls, before, 'an unsubscribed listener hears nothing');
});

test('the store holds results in memory only: no storage is touched', () => {
  const touched = [];
  const real = globalThis.chrome;
  globalThis.chrome = new Proxy({}, { get: (_, key) => { touched.push(String(key)); return undefined; } });
  try {
    const store = createLoadedStore();
    store.set('a', 'overview', { id: 'overview', data: { x: 1 } });
    store.remove('a');
  } finally {
    globalThis.chrome = real;
  }
  assert.deepEqual(touched, []);
});

// ---- What counts as loaded ----------------------------------------------------------------------------------------------

test('collectLoaded keeps the newest usable result per known section and ignores the rest', async () => {
  const entries = await loadAll();
  const got = collectLoaded(entries);
  assert.deepEqual(Object.keys(got).sort(), ['fulfilment', 'handover', 'overview', 'quality', 'sla', 'workload']);
  const older = { ...entries[0].result, readAt: entries[0].result.readAt - 1000 };
  const newer = { ...entries[0].result, readAt: entries[0].result.readAt + 1000, marker: 'new' };
  assert.equal(collectLoaded([{ id: 'x', section: 'overview', result: older }, { id: 'y', section: 'overview', result: newer }]).overview.marker, 'new');
  assert.equal(collectLoaded([{ id: 'y', section: 'overview', result: newer }, { id: 'x', section: 'overview', result: older }]).overview.marker, 'new');
  const unavailable = { ...entries[2].result, data: { available: false, reason: 'no' } };
  const bad = [
    { id: 'u', section: 'sla', result: unavailable },
    { id: 'v', section: 'sla', result: { ...entries[2].result, id: 'overview' } },
    { id: 'w', section: 'builder', result: entries[0].result },
    { id: 'x', section: 'overview', result: null },
    { id: 'y', section: 'overview', result: { id: 'overview' } },
    null,
    undefined,
  ];
  assert.deepEqual(collectLoaded(bad), {});
  assert.deepEqual(collectLoaded(null), {});
});

test('describeInputs names what the explanation rests on and what is missing from the dashboard', async () => {
  const entries = await loadAll(dashboardWorld(), ['overview', 'sla']);
  const d = describeInputs(entries);
  assert.deepEqual(d.used, ['Overview', 'SLA risk radar']);
  assert.deepEqual(d.missing, ['Workload and ageing', 'Quality and trend', 'Request fulfilment']);
  assert.ok(Number.isFinite(d.readAt));
  assert.deepEqual(describeInputs([]), { used: [], missing: INSIGHT_SECTIONS.filter((s) => INSIGHT_CORE.includes(s.id)).map((s) => s.title), readAt: null });
});

// ---- The pack -----------------------------------------------------------------------------------------------------------

test('the pack: a report, aggregate figures, group names, ticket numbers; assignees on pack.people; nothing else about people', async () => {
  const pack = buildInsightsPack(await loadAll());
  assert.equal(pack.table, 'report');
  assert.equal(pack.sysId, 'insights');
  assert.deepEqual(pack.fields, {});
  assert.deepEqual(pack.journal, []);
  assert.deepEqual(pack.people.map((p) => p.name).sort(), [MARCUS, PRIYA].sort());
  assert.ok(pack.people.every((p) => p.role === 'assigned_to'));
  assert.deepEqual(pack.report.sections.map((s) => s.id), ['overview', 'handover', 'workload', 'sla', 'quality', 'fulfilment']);
  assert.equal(pack.report.scope, 'My groups (1): Service Desk');
  assert.deepEqual(pack.report.missing, []);
  const all = JSON.stringify(pack);
  // ticket titles, callers and the injected text never go in: this feature sends aggregates
  for (const never of [ZELDA, DASH_CALLER, 'PWNED', INJECTION.slice(0, 15), 'Printer fire']) assert.ok(!all.includes(never), `${never} is in the pack`);
  // the repeat callers are only counted
  const quality = pack.report.sections.find((s) => s.id === 'quality').lines.join('\n');
  assert.match(quality, /Callers with 3\+ tickets in 30 days: \d+ of \d+ callers \(names are not included\)/);
});

test('the parts: the scope first, then one part per section, each a plain text block with figures', async () => {
  const pack = buildInsightsPack(await loadAll());
  const parts = insightsParts(pack);
  assert.deepEqual(parts.map((p) => p.field), ['insights_scope', 'insights_overview', 'insights_handover', 'insights_workload', 'insights_sla', 'insights_quality', 'insights_requests']);
  assert.match(parts[0].text, /Team and scope: My groups \(1\): Service Desk/);
  assert.match(parts[1].text, /- Open: 15/);
  assert.match(parts[1].text, /- Breached: 1/);
  const workload = parts.find((p) => p.field === 'insights_workload').text;
  assert.match(workload, /Open work by person \(busiest 2\): Priya Raman: 12 open \(working 12, waiting 0, new 0, other 0\); Marcus Webb: 6 open/);
  assert.match(workload, /Open work by group \(busiest 2\): Service Desk: 12 open/);
  assert.match(workload, /Ageing of open tickets: 0-1 days \d+;/);
  assert.match(workload, /INC0010001: 6 reassignments, group Service Desk, assigned to Priya Raman/);
  const sla = parts.find((p) => p.field === 'insights_sla').text;
  assert.match(sla, /Breached: 1; at risk \(75% of the time used or more\): 1/);
  assert.match(sla, /INC0010001, breached/);
  assert.match(sla, /By owner: /);
  for (const p of parts) assert.ok(p.text.trim() && p.text.length <= 6000, p.label);
});

test('a section that is not on the dashboard is not sent, and the AI is told it is missing', async () => {
  const pack = buildInsightsPack(await loadAll(dashboardWorld(), ['overview', 'sla']));
  assert.deepEqual(pack.report.sections.map((s) => s.id), ['overview', 'sla']);
  assert.deepEqual(pack.report.missing, ['Workload and ageing', 'Quality and trend', 'Request fulfilment']);
  const head = insightsParts(pack)[0].text;
  assert.match(head, /Not on the dashboard, so nothing is known about them: Workload and ageing, Quality and trend, Request fulfilment\./);
  assert.deepEqual(pack.people.map((p) => p.name).sort(), [MARCUS, PRIYA].sort(), 'the assignees named in the SLA list');
});

test('no pack when nothing usable is loaded; a denied section is simply not there', async () => {
  assert.equal(buildInsightsPack([]), null);
  assert.equal(buildInsightsPack(null), null);
  // every table denied: the Overview still arrives, with every figure marked as not available
  const allDenied = buildInsightsPack(await loadAll(dashboardWorld({ denied: TABLES }), ['overview']));
  assert.ok(insightsParts(allDenied)[1].text.split('\n').filter((l) => /^- (Open|Breached)/.test(l)).every((l) => /not available/.test(l)));
  const noSla = await loadAll(dashboardWorld({ denied: ['task_sla'] }), ['sla']);
  assert.equal(buildInsightsPack(noSla), null, 'an unavailable SLA result is not an input');
  assert.deepEqual(insightsParts(null), []);
  assert.deepEqual(insightsParts({ report: { kind: 'handover' } }), []);
});

test('a missing figure reads "not available", and the notes about what could not be read go along', async () => {
  const entries = await loadAll(dashboardWorld({ denied: ['task_sla'] }), ['overview']);
  const parts = insightsParts(buildInsightsPack(entries));
  assert.match(parts[1].text, /- Due soon: not available to this person/);
  assert.match(parts[1].text, /- Breached: not available to this person/);
  assert.ok(!/- Breached: 0/.test(parts[1].text));
});

test('fields the organisation blocks are left out of the lines, but the assignee names stay on the people list', async () => {
  const entries = await loadAll();
  const pack = buildInsightsPack(entries, { blockedFields: ['assigned_to', 'Assignment_Group', 'priority', 'state'] });
  const text = insightsParts(pack).map((p) => p.text).join('\n');
  assert.ok(!text.includes(PRIYA) && !text.includes(MARCUS), 'no assignee in the text');
  assert.ok(!text.includes('group Service Desk') && !/Open work by group/.test(text) && !/By group:/.test(text));
  assert.ok(!/priority 2 - High|state In Progress/.test(text.split('Closest to breaking')[1] || ''));
  assert.equal(pack.report.scope, 'My groups (1)', 'the group name too');
  assert.deepEqual(pack.people.map((p) => p.name).sort(), [MARCUS, PRIYA].sort(), 'still masked wherever they turn up');
});

test('a "mine" dashboard has no per-person board to describe', async () => {
  const inst = dashboardWorld();
  const entries = [];
  for (const section of ['overview', 'workload']) entries.push({ id: section, section, result: await run(section, inst, { kind: 'mine' }) });
  const text = insightsParts(buildInsightsPack(entries)).map((p) => p.text).join('\n');
  assert.ok(!/Open work by person/.test(text));
  assert.equal(buildInsightsPack(entries).report.scope, 'Mine');
});

test('the quality section is written out as series with partial periods marked', async () => {
  const entries = await loadAll(dashboardWorld(), ['quality']);
  const lines = buildInsightsPack(entries).report.sections[0].lines.join('\n');
  assert.match(lines, /- Period: Last 30 days/);
  assert.match(lines, /- Opened per day: .*Oct 27 /);
  assert.match(lines, /- Top categories: Hardware 8; Network 4|- Top categories: Hardware/);
});

test('the answer check wants three headings and a short answer', () => {
  const good = INSIGHT_HEADINGS.map((h) => `${h}\n- one\n- two\n- three`).join('\n');
  assert.equal(checkInsightsNote(good).ok, true);
  assert.deepEqual(checkInsightsNote('What stands out:\n- x').missing, ['Likely reasons (hypotheses):', 'Suggested actions:']);
  assert.equal(checkInsightsNote(`${good}\n${'word '.repeat(300)}`).tooLong, true);
});
