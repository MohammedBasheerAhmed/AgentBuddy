import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TeamInsights } from '../src/sidepanel/team/index.js';
import { resetTeamShares } from '../src/sidepanel/team/teamShare.js';
import { attentionRow, ageingRow, closedRow, comingBackRow, loadRow, sectionState, teamSummary } from '../src/sidepanel/team/rows.js';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { handoverWorld, USER, NOW, GROUP_A, PRIYA, MARCUS } from './reports-ai-fixtures.js';

// Round 5, board C (docs/round5.md): Team opens on a Weekly report button and FIVE rows. Each says one finding; a row with nothing to
// report is a calm sentence; what could not be read is said so, never a zero; names of people show only inside an opened row.

const ready = (data, scopeKind = 'groups') => sectionState({ phase: 'ready', result: { data, scope: { kind: scopeKind } } });
const counts = (b, c) => ({
  breached: { ok: b !== null, population: b, atLeast: false },
  closest: { ok: c !== null, population: c, atLeast: false },
});
const row = (n, reason) => ({ sysId: `s${n}`, table: 'incident', number: `INC${n}`, title: `Ticket ${n}`, reason, reasons: [reason], more: 0, owner: 'Beth Anglin', priority: '2 - High', facts: { [reason]: {} } });
const buckets = (...c) => ['0-1 days', '2-3 days', '4-7 days', '8-14 days', '15+ days'].map((label, i) => ({ key: String(i), label, count: c[i] }));

// ---- the numbers of the five rows -----------------------------------------------------------------------------------------------------

test('a section that is not ready is loading, unavailable (with its reason) or could not be read: a row never turns it into a zero', () => {
  assert.equal(sectionState({ phase: 'loading' }).status, 'loading');
  assert.equal(sectionState({ phase: 'error', error: 'x' }).status, 'error');
  assert.deepEqual(sectionState({ phase: 'ready', result: { data: { available: false, reason: 'Nothing to read.' } } }), { status: 'unavailable', d: null, reason: 'Nothing to read.' });
  assert.equal(sectionState({ phase: 'idle' }, { none: 'No ticket type is available to you.' }).status, 'unavailable');
  for (const state of [{ phase: 'loading' }, { phase: 'error' }, { phase: 'ready', result: { data: { available: false, reason: 'Some reason.' } } }]) {
    const s = sectionState(state);
    for (const r of [attentionRow(s), ageingRow(s), loadRow(s), comingBackRow(s), closedRow(s)]) assert.equal(r.count, null, 'no number');
  }
  assert.equal(attentionRow(sectionState({ phase: 'error' })).line, 'Could not be read.');
  assert.equal(attentionRow(sectionState({ phase: 'loading' })).line, 'Reading the numbers…');
  assert.equal(attentionRow(sectionState({ phase: 'ready', result: { data: { available: false, reason: 'Some reason.' } } })).line, 'Some reason.');
});

test('needs attention now: the breached and the about to breach, and the tickets behind them', () => {
  const r = attentionRow(ready({ counts: counts(3, 2), rows: [row(1, 'breached'), row(2, 'breached'), row(3, 'breached'), row(4, 'closest'), row(5, 'oldest')] }));
  assert.equal(r.count, 5);
  assert.equal(r.line, '3 breached, 2 about to breach');
  assert.equal(r.level, 'danger');
  assert.deepEqual(r.items.map((x) => x.number), ['INC1', 'INC2', 'INC3', 'INC4'], 'only the tickets of these two reasons');
  assert.equal(r.hint, 'Showing 4 of 5.');
  assert.equal(attentionRow(ready({ counts: counts(0, 1), rows: [row(1, 'closest')] })).level, 'warn');
});

test('needs attention now: a count that could not be read is said so, not shown as none; all zero is a calm sentence', () => {
  const half = attentionRow(ready({ counts: counts(null, 2), rows: [row(1, 'closest')] }));
  assert.equal(half.line, '2 about to breach, breached could not be counted');
  assert.equal(half.count, 2);
  const none = attentionRow(ready({ counts: counts(null, null), rows: [] }));
  assert.equal(none.count, null);
  assert.match(none.line, /could not be counted/);
  const calm = attentionRow(ready({ counts: counts(0, 0), rows: [] }));
  assert.equal(calm.line, 'Nothing is breached or about to breach.');
  assert.equal(calm.count, 0);
  const least = attentionRow(ready({ counts: { breached: { ok: true, population: 7, atLeast: true }, closest: { ok: true, population: 0, atLeast: false } }, rows: [] }));
  assert.equal(least.line, 'at least 7 breached');
});

test('getting old: the open tickets of more than 7 days, and those of 15 days or more', () => {
  const d = { ageing: { buckets: buckets(12, 1, 3, 0, 10), byTable: [{}], left: 0 }, totals: { stale: 11 }, staleDays: 3 };
  const r = ageingRow(ready(d), ready({ rows: [row(1, 'oldest'), { ...row(2, 'breached'), reasons: ['breached'] }] }));
  assert.equal(r.count, 10);
  assert.equal(r.line, '10 open for more than 7 days, 10 for 15 days or more');
  assert.equal(r.level, 'warn');
  assert.deepEqual(r.oldest.map((x) => x.number), ['INC1']);
  const calm = ageingRow(ready({ ...d, ageing: { ...d.ageing, buckets: buckets(5, 4, 3, 0, 0) } }));
  assert.equal(calm.line, 'Nothing has been open for more than 7 days.');
  assert.equal(calm.count, 0);
  const none = ageingRow(ready({ ...d, ageing: { buckets: buckets(0, 0, 0, 0, 0), byTable: [], left: 1 } }));
  assert.equal(none.count, null, 'no ticket type could be aged: not a zero');
  assert.match(ageingRow(ready({ ...d, ageing: { ...d.ageing, left: 1 } })).line, /some ticket types could not be aged/);
});

test('who is carrying the load: numbers only on the row; the names are in the people the opened row lists', () => {
  const person = (name, count) => ({ key: name, id: name, name, count });
  const d = { totals: { open: 10, unassigned: 2 }, assigneeCount: 3, detail: { assignees: [person('Beth Anglin', 4), person('Dave Loftus', 3), person('Charlie W', 1), { key: '__none', id: '', name: '(unassigned)', count: 2 }] } };
  const r = loadRow(ready(d));
  assert.equal(r.count, 2);
  assert.equal(r.line, 'The busiest 2 people hold 70% of the open tickets');
  assert.ok(!/Beth|Dave|Charlie/.test(r.line), 'no name on a collapsed row');
  assert.deepEqual(r.people.map((p) => p.name), ['Beth Anglin', 'Dave Loftus', 'Charlie W'], 'nobody is not a person');
  assert.equal(loadRow(ready({ ...d, assigneeCount: 1, detail: { assignees: [person('Beth Anglin', 4)] }, totals: { open: 4 } })).line, 'The busiest person holds 100% of the open tickets');
  const nobody = { totals: { open: 5, unassigned: null }, assigneeCount: 0, detail: { assignees: [] } };
  assert.equal(loadRow(ready(nobody, 'mine')).line, 'Only your own tickets are in this view.');
  const unread = loadRow(ready(nobody, 'groups'));
  assert.equal(unread.line, 'Could not be read.', 'a team view whose per-person read gave nothing could not be read: not "nobody carries anything"');
  assert.equal(unread.count, null);
  assert.equal(loadRow(ready({ ...nobody, totals: { open: 0 } }, 'groups')).line, 'Nothing is open.');
  assert.equal(loadRow(ready({ ...d, totals: { open: null } })).count, null, 'an open total that could not be read');
});

test('coming back again: one configuration item with three or more tickets, else callers who keep coming back, else a calm line', () => {
  const base = { windowDays: 30, cis: [{ name: 'VPN Gateway EU', count: 4 }, { name: 'Printer', count: 2 }], repeatCallers: { items: [{ name: 'Abel Tuter', count: 3 }], min: 3, days: 30, total: 1 } };
  const r = comingBackRow(ready(base));
  assert.equal(r.count, 4);
  assert.equal(r.line, 'VPN Gateway EU: 4 tickets in the last 30 days. One cause?');
  assert.equal(r.level, 'warn');
  assert.ok(!r.line.includes('Abel'), 'a caller is named only inside the opened row');
  const callers = comingBackRow(ready({ ...base, cis: [{ name: 'Printer', count: 2 }] }));
  assert.equal(callers.line, '1 caller has 3 or more tickets in the last 30 days');
  const calm = comingBackRow(ready({ ...base, cis: [], repeatCallers: { items: [], min: 3, days: 30, total: 0 } }));
  assert.equal(calm.line, 'No cause stands out in the last 30 days.');
  assert.equal(calm.count, 0);
});

test('how well tickets are closed: the reopened tickets; the closes without a fix note when the engine counts them', () => {
  const d = { windowDays: 30, resolved: { value: 14 }, mttr: { meanHours: 5 }, reopen: { reopened: 3, of: 40, percent: 7.5 } };
  const r = closedRow(ready(d));
  assert.equal(r.count, 3);
  assert.equal(r.line, '3 of 40 tickets opened in the last 30 days were reopened');
  assert.equal(r.level, '');
  assert.equal(closedRow(ready({ ...d, reopen: { reopened: 6, of: 40, percent: 15 } })).level, 'warn');
  assert.equal(closedRow(ready({ ...d, reopen: { reopened: 0, of: 40, percent: 0 } })).line, 'No ticket opened in the last 30 days was reopened.');
  assert.equal(closedRow(ready({ ...d, reopen: null })).count, null, 'no reopen count on these ticket types: not a zero');
  assert.deepEqual(r.facts.map((f) => f.value), ['14', '5 h', '3 / 40']);
  const notes = closedRow(ready({ ...d, closeNotes: { without: 3, of: 14 } }));
  assert.equal(notes.line, '3 of 14 closed this week have no fix note');
  assert.equal(notes.fixNotes, true);
  assert.equal(closedRow(ready({ ...d, closeNotes: { without: 0, of: 14 } })).line, 'Every ticket closed this week has a fix note.');
});

test('the summary: open tickets and how many need a lead today', () => {
  const wl = ready({ totals: { open: 38 } });
  assert.equal(teamSummary(wl, { count: 5 }), '38 open tickets. 5 need a lead today.');
  assert.equal(teamSummary(wl, { count: 1 }), '38 open tickets. 1 needs a lead today.');
  assert.equal(teamSummary(wl, { count: 0 }), '38 open tickets. Nothing needs a lead today.');
  assert.equal(teamSummary(wl, { count: null }), '38 open tickets.');
  assert.equal(teamSummary(sectionState({ phase: 'error' }), { count: null }), 'Open tickets could not be counted.');
});

// ---- the screen, over the real engine ---------------------------------------------------------------------------------------------------

const eff = (values = {}) => ({
  ready: true,
  apiKey: 'sk-test',
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it', 'lead'], ...values },
  locked: {},
  policy: normalizePolicy({}),
});
const page = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic', record: null, newRecord: null };
const CONTEXT = {
  user: { name: 'Beth Anglin' },
  tables: [
    { table: 'incident', label: 'Incidents', status: 'ok', note: '', usable: true },
    { table: 'sc_req_item', label: 'Requested items', status: 'ok', note: '', usable: true },
  ],
  groups: [{ id: GROUP_A, name: 'Service Desk' }],
  groupsTotal: 1,
  groupsNote: '',
  zone: { id: 'Europe/Berlin', source: 'instance', note: '' },
  readAt: NOW,
};
function world({ fail = false } = {}) {
  resetTeamShares();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const inst = handoverWorld();
  const runtime = createRuntime();
  fake.onRead('reportContext', () => CONTEXT);
  fake.onRead('reportClear', () => ({ ok: true }));
  fake.onRead('reportRun', async (args) => {
    if (fail) throw Object.assign(new Error('This report could not be read.'), { code: 'FAILED' });
    return runReport({ kind: args.kind, section: args.section, scope: args.scope, tables: args.tables, params: {}, config: args.config }, { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 });
  });
  return fake;
}
const mounted = [];
async function show(options) {
  const fake = world(options);
  const ui = await mount(<TeamInsights page={page} eff={eff()} active />);
  mounted.push(ui);
  await settle(16);
  return { ui, fake };
}
afterEach(async () => {
  while (mounted.length) await mounted.pop().unmount().catch(() => {});
});

test('the screen: a Weekly report button, five rows with a line and a number each, the first open; no name on a collapsed row', async () => {
  const { ui, fake } = await show();
  const rows = ui.$$('[data-row]');
  assert.deepEqual(rows.map((r) => r.getAttribute('data-row')), ['needs', 'old', 'load', 'back', 'closed']);
  assert.deepEqual(rows.map((r) => r.querySelector('.ab-ins-pain-title').textContent), ['Needs attention now', 'Getting old', 'Who is carrying the load', 'Coming back again', 'How well tickets are closed']);
  const weekly = ui.button(/^Weekly report/);
  assert.match(weekly.textContent, /One click\. Ready to send to your manager\./);
  assert.match(weekly.className, /ab-btn-primary/, 'the screen\'s one filled button');
  assert.match(ui.$('.ab-scope-chip').textContent, /My groups \(1\)/);
  assert.match(ui.text(), /Read at \d\d:\d\d/);
  assert.match(ui.text(), /open tickets?\./);
  for (const r of rows) {
    const line = r.querySelector('.ab-fr-line').textContent;
    assert.ok(line.length > 0 && !/Reading the numbers/.test(line), `${r.getAttribute('data-row')} has read: ${line}`);
    assert.ok(![PRIYA, MARCUS].some((name) => line.includes(name)), 'a person is named only inside an opened row');
  }
  assert.equal(rows[0].querySelector('button').getAttribute('aria-expanded'), 'true', 'the first row opens with its tickets');
  assert.ok(rows[0].querySelectorAll('a[data-ab-link="record"]').length >= 1);
  assert.ok(ui.hasButton('All team charts and tables'));
  const controls = ui.$$('button, a, input, select', { all: true }).filter((el) => el.shown);
  assert.ok(controls.length <= 25, `${controls.length} controls (there were 55)`);
  assert.ok(fake.readsOf('reportRun').every((a) => ['attention', 'workload', 'quality'].includes(a.section)), 'the first screen reads three sections of the overview, nothing else');
  assert.equal(ui.$$('section.ab-widget', { all: true }).length, 0, 'none of the overview\'s sections on the first screen');
});

test('opening a row shows what is behind it, and the people are named only there', async () => {
  const { ui } = await show();
  // The first row is open: its tickets name their owners (a person is named only inside an opened row).
  const body = ui.$('[data-row="needs"] .ab-fr-body');
  assert.ok([PRIYA, MARCUS].some((name) => body.textContent.includes(name)), 'the names are inside');
  await click(ui.$('[data-row="old"] > button'));
  assert.ok(ui.$('[data-row="old"] .ab-fr-facts'), 'the open tickets by age');
  assert.equal(ui.$('[data-row="old"] > button').getAttribute('aria-expanded'), 'true');
  await click(ui.$('[data-row="old"] > button'));
  assert.equal(ui.$('[data-row="old"] > button').getAttribute('aria-expanded'), 'false', 'it folds again');
});

test('"All team charts and tables" is today\'s Team overview, complete, and Back returns to the five rows', async () => {
  const { ui } = await show();
  await click(ui.button('All team charts and tables'));
  await settle(16);
  assert.ok(ui.$$('section.ab-widget').length >= 3, 'the overview\'s sections');
  assert.ok(ui.$('.ab-dash-top'), 'its top row, its menu: customize, export, hand-over, saved dashboards stay reachable');
  assert.ok(ui.$('.ab-more-btn'));
  assert.ok(!ui.$('[data-row="needs"]'), 'the five rows are behind it, hidden');
  await click(ui.button('Back'));
  assert.equal(ui.$$('[data-row]').length, 5);
  assert.equal(document.activeElement?.textContent.trim(), 'All team charts and tables', 'the focus is back on what opened it');
});

test('the Weekly report button opens the reports agent\'s view (props { onBack }) and Back comes back', async () => {
  const { ui } = await show();
  await click(ui.button(/^Weekly report/));
  assert.ok(ui.$('[data-view="weekly"]'), 'the weekly report is mounted');
  assert.ok(!ui.$('[data-row="needs"]'), 'the five rows are behind it, hidden');
  await click(ui.button(/^(Team|Back)$/));
  assert.equal(ui.$$('[data-row]').length, 5);
});

test('the scope chip opens the scope bar: whose tickets, which ticket types', async () => {
  const { ui } = await show();
  await click(ui.$('.ab-scope-chip'));
  assert.ok(ui.$('#ab-fr-scope .ab-scope'), 'the same scope bar as the overview');
});

test('honest: when the reads fail every row says it could not be read, and none shows a zero', async () => {
  const { ui } = await show({ fail: true });
  const rows = ui.$$('[data-row]');
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.querySelector('.ab-fr-line').textContent, 'Could not be read.', r.getAttribute('data-row'));
    assert.equal(r.querySelector('.ab-fr-num'), null, 'no number');
  }
});
