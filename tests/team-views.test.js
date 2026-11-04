import { mount, click, makeChrome, settle, document, fakeAiFetch } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TeamInsights, TeamAssist } from '../src/sidepanel/team/index.js';
import { resetTeamShares, teamShare, shareKey } from '../src/sidepanel/team/teamShare.js';
import { handoverSource, explainEntries } from '../src/sidepanel/team/TeamAssist.jsx';
import { scopeChipText, hrReportsAllowed } from '../src/sidepanel/reports/ReportsDashboard.jsx';
import { span, dueText, ageText } from '../src/sidepanel/reports/format.js';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { normalizePolicy, effectiveSettings, DEFAULT_SETTINGS } from '../src/policy/policy.js';
import { handoverWorld, USER, NOW, GROUP_A, PRIYA, MARCUS } from './reports-ai-fixtures.js';

// Round 3, the Team screen as a person sees it: the Insights half (N15-N17) with a quiet top row, one menu, one export panel, one
// session banner and no AI element; the AI Assist half (AI28-AI30) with the AI mark on every action, working from the numbers
// Insights read, coaching behind its gate.

const eff = ({ values = {}, policy = {} } = {}) => ({
  ready: true,
  apiKey: 'sk-test',
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it', 'lead'], ...values },
  locked: {},
  policy: normalizePolicy(policy),
});
const page = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic', record: null, newRecord: null };
const CONTEXT = {
  user: { name: 'Beth Anglin' },
  tables: [
    { table: 'incident', label: 'Incidents', status: 'ok', note: '', usable: true },
    { table: 'sc_req_item', label: 'Requested items', status: 'ok', note: '', usable: true },
    { table: 'problem', label: 'Problems', status: 'denied', note: 'Problems: not available to you.', usable: false },
  ],
  groups: [{ id: GROUP_A, name: 'Service Desk' }],
  groupsTotal: 41,
  groupsNote: '1 of 41 groups used: the ones with the most open work. Choose groups to see others.',
  zone: { id: 'Europe/Berlin', source: 'browser', note: '"Today" is counted in your browser\'s time zone (Europe/Berlin): your ServiceNow time zone could not be read.' },
  readAt: NOW,
};

/** A fake panel world: chrome with the report reads answered by the real engine over a fake instance. */
function world({ session = false } = {}) {
  resetTeamShares();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const inst = handoverWorld();
  const runtime = createRuntime();
  const state = { session };
  fake.onRead('reportContext', () => CONTEXT);
  fake.onRead('reportClear', () => ({ ok: true }));
  fake.onRead('reportRun', async (args) => {
    if (state.session) throw Object.assign(new Error('Your ServiceNow session has expired.'), { code: 'SESSION_EXPIRED' });
    return runReport({ kind: args.kind, section: args.section, scope: args.scope, tables: args.tables, params: {}, config: args.config }, { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 });
  });
  return { fake, state, runs: () => fake.readsOf('reportRun') };
}
const settleMore = () => settle(8);
// Every mounted view is unmounted after its test, failed or not: a view left mounted keeps its timers and the run never ends.
const mounted = [];
const show = async (element) => {
  const ui = await mount(element);
  mounted.push(ui);
  return ui;
};
test.afterEach(async () => {
  while (mounted.length) {
    const ui = mounted.pop();
    try {
      await ui.unmount();
    } catch {
      /* already unmounted by the test */
    }
  }
});

test('Insights: a quiet top row (dashboard, scope chip, one menu) before the first number, and no AI element anywhere', async () => {
  const { fake } = world();
  const ui = await show(<TeamInsights page={page} eff={eff()} active />);
  await settleMore();
  const top = ui.$('.ab-dash-top');
  assert.equal(top.querySelectorAll('select, button').length, 3, 'three controls before the numbers (there were about twelve)');
  assert.match(ui.$('.ab-scope-chip').textContent, /My groups \(1 of 41\)/);
  const t = ui.text();
  assert.match(t, /Team overview/, 'a lead starts on Team overview');
  assert.match(t, /Overview/);
  assert.match(t, /SLA risk radar/);
  assert.equal(ui.$$('.ab-ai-badge', { all: true }).length, 0, 'no AI mark on Insights');
  assert.ok(!/Explain this dashboard|Write the hand-over note|Coaching/.test(t));
  assert.ok(!ui.hasButton('Download CSV') && !ui.hasButton('Copy as table'), 'no export bar under every widget');
  assert.equal(ui.$$('.ab-btn-primary').length, 0, 'no filled button competes with the numbers');
  // What could not be read is said once, folded, for the whole dashboard (with the time zone note).
  assert.match(t, /\d notes about these numbers/);
  const said = ui.$$('.ab-dash-notes-list li', { all: true }).map((li) => li.textContent);
  assert.ok(said.length >= 1);
  for (const note of said) assert.equal(ui.container.textContent.split(note).length - 1, 1, `said once: ${note}`);
  assert.match(ui.container.textContent, /counted in your browser's time zone/);
  assert.ok(fake.readsOf('reportContext').length >= 1);
  await ui.unmount();
});

test('Insights: the one "⋯" menu holds refresh, auto-refresh, customize, export, print and full page; export is one panel', async () => {
  world();
  const ui = await show(<TeamInsights page={page} eff={eff()} active />);
  await settleMore();
  const more = ui.$('.ab-more-btn');
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');
  await click(more);
  const items = ui.$$('[role^="menuitem"]').map((b) => b.textContent.replace(/[✓\s]+/g, ' ').trim());
  assert.deepEqual(items, ['Refresh', 'Refresh every 5 minutes', 'Customize', 'Export…', 'Print or save as PDF', 'Open full page']);
  assert.equal(ui.$('[role="menuitemcheckbox"]').getAttribute('aria-checked'), 'false');
  await click(ui.$$('[role="menuitem"]').find((b) => b.textContent === 'Export…'));
  assert.equal(ui.$('[role="menu"]'), null, 'the menu closes');
  const panel = ui.$('.ab-export-panel');
  assert.ok(panel);
  assert.ok(ui.hasButton('Download all as CSV') && ui.hasButton('Copy all as a table'));
  assert.match(ui.text(), /One section/);
  await click(ui.button('Close'));
  assert.equal(ui.$('.ab-export-panel'), null);
  // Customize: at most four buttons in view, the rest under More (layout file save and load among them).
  await click(more);
  await click(ui.$$('[role="menuitem"]').find((b) => b.textContent === 'Customize'));
  const card = ui.$('.ab-customize');
  const visible = card.querySelectorAll('button').filter((b) => b.shown && !b.closest('details'));
  assert.ok(visible.length <= 4, `${visible.length} buttons in view`);
  assert.ok(ui.$$('button', { all: true }).some((b) => b.textContent === 'Save layout as a file'));
  assert.ok(ui.$$('button', { all: true }).some((b) => b.textContent === 'Load a layout file'));
  await ui.unmount();
});

test('Insights: each section has a quiet "⋯" by its title: its charts as tables at once and, while customizing, move and remove', async () => {
  world();
  const ui = await show(<TeamInsights page={page} eff={eff()} active />);
  await settleMore();
  const sectionNamed = (name) => ui.$(`section.ab-widget[aria-label="${name}"]`);
  const workload = sectionNamed('Workload and ageing');
  assert.ok(workload, 'the lead\'s dashboard has Workload');
  assert.equal(workload.querySelectorAll('.ab-chart-toggle').length, 0, 'no "Show as table" button on every chart of a section');
  const charts = workload.querySelectorAll('.ab-chart-visual').length;
  assert.ok(charts >= 1);
  const more = workload.querySelector('.ab-widget-more .ab-more-btn');
  assert.equal(more.getAttribute('aria-label'), 'Options for Workload and ageing');
  await click(more);
  const tables = ui.$$('[role="menuitemcheckbox"]').find((b) => /Show as tables/.test(b.textContent));
  assert.equal(tables.getAttribute('aria-checked'), 'false');
  await click(tables);
  assert.equal(workload.querySelectorAll('table.ab-chart-table').length, charts, 'every chart of the section is now a table');
  assert.equal(workload.querySelectorAll('.ab-chart-visual').length, 0);
  assert.ok(sectionNamed('Quality and trend').querySelectorAll('.ab-chart-visual').length >= 1, 'the other sections keep their charts');
  // One number once: next to Overview, Workload draws none of Overview's tiles.
  const labels = (el) => el.querySelectorAll('.ab-tile-label').map((l) => l.textContent.trim());
  const overviewTiles = labels(sectionNamed('Overview'));
  assert.ok(overviewTiles.includes('Open'));
  assert.ok(!labels(workload).some((l) => overviewTiles.includes(l)), labels(workload).join(', '));
  assert.ok(!labels(sectionNamed('SLA risk radar')).some((l) => overviewTiles.includes(l)), labels(sectionNamed('SLA risk radar')).join(', '));

  // Customizing: the section's menu also moves and removes it (in place of four buttons above every section).
  await click(ui.$('.ab-dash-top .ab-more-btn'));
  await click(ui.$$('[role="menuitem"]').find((b) => b.textContent === 'Customize'));
  assert.ok(!ui.hasButton('Move up') && !ui.hasButton('Remove'), 'no row of buttons above each section');
  await click(workload.querySelector('.ab-more-btn'));
  assert.deepEqual(ui.$$('[role^="menuitem"]').map((b) => b.textContent.replace(/[✓\s]+/g, ' ').trim()), ['Show as tables', 'Move up', 'Move down', 'Remove']);
  await click(ui.$$('[role="menuitem"]').find((b) => b.textContent === 'Remove'));
  assert.equal(sectionNamed('Workload and ageing'), null, 'Remove takes the section off the dashboard');
  await ui.unmount();
});

test('Insights: an ended ServiceNow session is ONE banner with Try again, not a red box per widget', async () => {
  const { fake, state } = world({ session: true });
  const ui = await show(<TeamInsights page={page} eff={eff()} active />);
  await settleMore();
  const alerts = ui.$$('[role="alert"]');
  assert.equal(alerts.length, 1, alerts.map((a) => a.textContent).join(' | '));
  assert.match(alerts[0].textContent, /Your ServiceNow session has ended\. Sign in again in the ServiceNow tab, then press Try again\./);
  assert.equal(ui.$$('section.ab-widget[data-state="session"]').length, ui.$$('section.ab-widget').length);
  const before = fake.readsOf('reportRun').length;
  state.session = false;
  await click(ui.button('Try again'));
  await settleMore();
  assert.equal(fake.readsOf('reportClear').length, 1);
  assert.ok(fake.readsOf('reportRun').length > before, 'everything is read again');
  assert.equal(ui.$$('[role="alert"]').length, 0);
  assert.ok(ui.$$('section.ab-widget[data-state="ready"]').length >= 3);
  await ui.unmount();
});

test('HR cases are asked for only with the HR profile AND the organisation allowing HR content', async () => {
  const hr = eff({ values: { profiles: ['hr', 'lead'] }, policy: { allowHrContent: true } });
  assert.equal(hrReportsAllowed(hr), true);
  assert.equal(hrReportsAllowed(eff({ values: { profiles: ['hr', 'lead'] } })), false);
  assert.equal(hrReportsAllowed(eff({ policy: { allowHrContent: true } })), false, 'the organisation allows it, but this person does not do HR work');
  const { fake } = world();
  const ui = await show(<TeamInsights page={page} eff={hr} active />);
  await settleMore();
  assert.equal(fake.readsOf('reportContext')[0].allowSensitive, true);
  assert.ok(fake.readsOf('reportRun').every((a) => a.allowSensitive === true));
  await ui.unmount();
  const other = world();
  const ui2 = await show(<TeamInsights page={page} eff={eff()} active />);
  await settleMore();
  assert.equal(other.fake.readsOf('reportContext')[0].allowSensitive, false);
  assert.ok(other.fake.readsOf('reportRun').every((a) => a.allowSensitive === undefined));
  await ui2.unmount();
});

test('AI Assist on its own: it reads the dashboard and the hand-over itself, marks every action as AI, coaching stays behind its gate', async () => {
  const { runs } = world();
  const ui = await show(<TeamAssist page={page} eff={eff()} active />);
  await settleMore();
  const t = ui.text();
  assert.match(t, /Hand-over note/);
  assert.match(t, /Explain this dashboard/);
  assert.match(t, /From the hand-over numbers for My groups \(1 of 41\), read at/);
  const sections = runs().map((a) => a.section);
  assert.ok(sections.includes('handover'), 'the hand-over the note is written from');
  assert.ok(['overview', 'workload', 'sla'].every((s) => sections.includes(s)), 'the dashboard this half explains');
  const write = ui.button(/Write the hand-over note/);
  assert.equal(write.disabled, false);
  assert.ok(write.querySelector('.ab-ai-badge'), 'the AI mark on the button');
  assert.match(write.className, /\bab-btn-ai\b/);
  assert.match(write.getAttribute('title'), /^Sends masked text to .+\. You see it first\.$/);
  const explain = ui.button(/Explain these numbers/);
  assert.ok(explain.querySelector('.ab-ai-badge'));
  assert.doesNotMatch(explain.className, /primary/, 'one filled button on the screen');
  assert.match(ui.text(), /Based on what is on this dashboard now: Overview/);
  assert.match(t, /Coaching snapshot: off until your organisation switches coaching on\./);
  assert.ok(!ui.hasButton(/Write the coaching snapshot/));
  assert.equal(ui.$$('.ab-btn-primary').length, 0, 'no Insights-green filled button in the AI half');
  await ui.unmount();
});

test('AI Assist next to Insights works from the numbers Insights read: it reads no section of the dashboard again', async () => {
  const { runs } = world();
  const both = await mount(
    <>
      <TeamInsights page={page} eff={eff()} active={false} />
      <TeamAssist page={page} eff={eff()} active />
    </>
  );
  await settleMore();
  const count = (section) => runs().filter((a) => a.section === section).length;
  assert.equal(count('overview'), 1, 'read once, by the Insights dashboard');
  assert.equal(count('sla'), 1);
  assert.equal(teamShare(page).live, 1);
  assert.ok(teamShare(page).loaded.snapshot().some((e) => e.section === 'overview' && !e.id.startsWith('assist:')));
  await both.unmount();
  assert.equal(teamShare(page).live, 0);
});

test('coaching: on only with the organisation\'s coachingEnabled, and in Strict mode it can run (the gate is unchanged)', async () => {
  world();
  const on = await show(<TeamAssist page={page} eff={eff({ values: { piiMode: 'strict' }, policy: { coachingEnabled: true } })} active />);
  await settleMore();
  assert.match(on.text(), /Coaching snapshot/);
  assert.ok(on.$$('[data-card="team-coaching"]', { all: true }).length === 1);
  const coachButton = on.$$('button', { all: true }).find((b) => /Write the coaching snapshot/.test(b.textContent));
  assert.ok(coachButton.querySelector('.ab-ai-badge'));
  await on.unmount();
  world();
  const standard = await show(<TeamAssist page={page} eff={eff({ policy: { coachingEnabled: true } })} active />);
  await settleMore();
  assert.ok(standard.$$('*', { all: true }).some((el) => /Coaching needs Strict privacy mode/.test(el.textContent || '')));
  await standard.unmount();
  world();
  const off = await show(<TeamAssist page={page} eff={eff({ values: { piiMode: 'strict' }, policy: { coachingEnabled: true, disabledFeatures: ['coaching-snapshot'] } })} active />);
  await settleMore();
  assert.match(off.text(), /Coaching snapshot: turned off by your organisation\./);
  await off.unmount();
});

test('pure pieces: the scope chip, which hand-over the note uses, relative times', () => {
  assert.equal(scopeChipText({ kind: 'mine' }), 'Mine');
  assert.equal(scopeChipText({ kind: 'groups' }, { groups: [1, 2, 3] }), 'My groups (3)');
  assert.equal(scopeChipText({ kind: 'groups' }, { groups: new Array(25).fill(0), groupsTotal: 41 }), 'My groups (25 of 41)');
  assert.equal(scopeChipText({ kind: 'chosen', groupIds: ['a', 'b'] }), 'Chosen groups (2)');
  const h12 = { id: 'w-1', section: 'handover', result: { data: { available: true, hours: 12 } } };
  const own = { id: 'assist:handover', section: 'handover', result: { data: { available: true, hours: 12 } } };
  assert.equal(handoverSource([own, h12], 12), h12, 'what Insights loaded comes first');
  assert.equal(handoverSource([h12], 8), null, 'another period: read again');
  assert.deepEqual(explainEntries([own, h12]), [h12], 'the private hand-over read is not part of "this dashboard"');
  assert.equal(shareKey(page), '7|https://acme.service-now.com');

  const now = Date.UTC(2026, 9, 27, 12);
  assert.equal(span(80 * 60000), '1 h 20 min');
  assert.equal(span(45 * 60000), '45 min');
  assert.equal(span(30000), 'less than a minute');
  assert.equal(span(27 * 3600000), '1 d 3 h');
  assert.equal(span(12 * 3600000 + 5 * 60000), '12 h');
  assert.equal(dueText({ endMs: now + 80 * 60000 }, now), 'Due in 1 h 20 min');
  assert.equal(dueText({ endMs: now - 10 * 60000 }, now), 'Overdue by 10 min');
  assert.equal(dueText({ endMs: now - 2 * 3600000, breached: true }, now), 'Breached 2 h ago');
  assert.equal(dueText({ endMs: now + 3600000, paused: true }, now), 'Paused');
  assert.equal(dueText({ endMs: null, plannedEnd: '2026-10-27 15:00:00' }, now), 'Due 2026-10-27 15:00:00', 'no stored time: the instance\'s own text');
  assert.equal(ageText(0), 'opened today');
  assert.equal(ageText(1), '1 day old');
  assert.equal(ageText(NaN), '');
  assert.ok(document);
});

test('the hand-over note goes through the one AI path: the check comes first, names are masked, the answer carries the AI mark', async () => {
  world();
  globalThis.fetch = fakeAiFetch('Headline: A busy shift.\nNeeds attention now:\n- INC0010001\nWaiting on others:\n- Not stated\nWatch during the next shift:\n- Not stated\nNotes for the incoming team:\n- Not stated');
  const full = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'always', profiles: ['it', 'lead'] }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false };
  const ui = await show(<TeamAssist page={page} eff={full} active />);
  await settleMore();
  await click(ui.button(/Write the hand-over note/));
  await settle(6);
  assert.ok(ui.$('.ab-dialog'), 'the check before sending comes first');
  assert.equal(globalThis.fetch.calls.length, 0, 'nothing sent yet');
  await click(ui.button('Send to AI'));
  await settle(8);
  assert.equal(globalThis.fetch.calls.length, 1);
  const sent = JSON.stringify(globalThis.fetch.calls[0].body);
  for (const name of [PRIYA, MARCUS, 'abel.tuter@example.com']) assert.ok(!sent.includes(name), `masked: ${name}`);
  assert.match(sent, /INC0010001/, 'ticket numbers are kept');
  const answer = ui.$('.ab-ai-result');
  assert.ok(answer, 'the answer card');
  assert.ok(answer.querySelector('.ab-ai-badge'), 'the AI mark on the answer');
  assert.match(answer.textContent, /Hand-over note, last 12 hours/);
  assert.match(answer.textContent, /A busy shift/);
});
