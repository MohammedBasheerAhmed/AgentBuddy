import { mount, click, settle, during, makeChrome, fakeAiFetch, focused } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import { cardIdsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { ALL_TOOLS, actionLabel, answerAction, assistRail, insightsRail, reveal } from '../src/sidepanel/ticket/ticketRail.js';
import { actionPlan } from '../src/sidepanel/ticket/assist/actions/index.js';
import { forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { RailContext } from '../src/sidepanel/shell/SideRail.jsx';
import { createRailStore } from '../src/sidepanel/shell/railStore.js';
import { AllToolsContext } from '../src/sidepanel/palette/allToolsContext.js';
import { focusCards } from '../src/features/focus.js';
import { featureById } from '../src/features/registry.js';
import { makeLaunch } from '../src/lib/launch.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import insightOps from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';

// The Ticket screen's side rail and the ways into the screen (docs/focus-layout.md A): with Insights on, the five rows (a dot on the
// ones that need a look; a click opens that row in place); with AI Assist on, the five AI actions (a click starts one as a click in AI
// Assist does: preview first); both end with "All tools". Then what All tools, a shortcut or the bar on the ServiceNow page can ask of
// the screen: an action, a card alone ('card:ready', 'show:<id>'), "Ask about this ticket" ('ask:ticket'). The pure part first, then
// the screen in a small DOM with the shell's real rail store.

const groups = [
  { id: 'understand', title: 'Understand the ticket', level: 'danger' },
  { id: 'fix', title: 'Find the fix', level: 'ok' },
  { id: 'caller', title: 'Same caller', level: 'warn' },
  { id: 'reply', title: 'Reply', level: 'clear' },
];

test('Insights rail: the five rows with their pain point\'s icon, a dot only for a look; then a line and "All tools"', () => {
  const items = insightsRail({ groups, current: 'fix' });
  assert.deepEqual(items.map((i) => i.id), ['understand', 'fix', 'caller', 'reply', ALL_TOOLS]);
  assert.deepEqual(items.map((i) => i.icon), ['eye', 'tool', 'user', 'reply', 'grid']);
  assert.deepEqual(items.map((i) => i.label), ['Understand the ticket', 'Find the fix', 'Same caller', 'Reply', 'All tools']);
  assert.deepEqual(items.map((i) => i.attention), ['danger', '', 'warn', '', '']);
  assert.deepEqual(items.map((i) => i.separator), [false, false, false, false, true], 'the line comes before "All tools"');
  assert.deepEqual(items.filter((i) => i.current).map((i) => i.id), ['fix']);
  assert.ok(items.every((i) => !i.ai && !i.disabled));
  assert.deepEqual(insightsRail({}).map((i) => [i.id, i.separator]), [[ALL_TOOLS, false]], 'nothing else: "All tools" alone, no line');
});

const item = (id, reason = '') => ({ feature: featureById(id), reason, caution: '' });
const fiveOf = (...ids) => ids.map((id) => ({ pain: 'x', painTitle: 'X', item: item(id) }));

test('AI Assist rail: the five actions in the order of the five, short names, AI marked; then "All tools"', () => {
  const items = assistRail({ five: fiveOf('record-summary', 'next-best-action', 'reply-draft', 'resolution-notes'), current: 'reply-draft' });
  assert.deepEqual(items.map((i) => i.id), ['record-summary', 'next-best-action', 'reply-draft', 'resolution-notes', ALL_TOOLS]);
  assert.equal(items.find((i) => i.id === 'reply-draft').label, 'Draft a reply', 'the short label, as on the page\'s bar');
  assert.equal(items.find((i) => i.id === 'reply-draft').icon, 'reply');
  assert.deepEqual(items.map((i) => i.ai), [true, true, true, true, false]);
  assert.deepEqual(items.filter((i) => i.current).map((i) => i.id), ['reply-draft'], 'the action whose answer is on show');
  assert.deepEqual(items.at(-1), { id: ALL_TOOLS, label: 'All tools', icon: 'grid', attention: '', ai: false, separator: true, current: false, disabled: false });
});

test('AI Assist rail: disabled while AI cannot be used now, and an action with a reason of its own; "All tools" stays usable', () => {
  const items = assistRail({ five: [{ pain: 'understand', item: item('record-summary') }, { pain: 'reply', item: item('reply-draft', 'Needs Strict privacy mode. Change it in Settings.') }] });
  assert.deepEqual(items.map((i) => [i.id, i.disabled]), [['record-summary', false], ['reply-draft', true], [ALL_TOOLS, false]]);
  const off = assistRail({ five: fiveOf('record-summary', 'reply-draft'), off: true });
  assert.deepEqual(off.map((i) => i.disabled), [true, true, false], 'no key, AI skipped, a record block, an answer on its way');
  assert.equal(actionLabel({ id: 'not-a-short-one', title: 'Some long title' }), 'Some long title');
  assert.deepEqual(assistRail({}).map((i) => i.id), [ALL_TOOLS]);
});

test('the action an answer was made by: a rewrite (Shorter, Translate) counts as the action it rewrote', () => {
  assert.equal(answerAction({ feature: { id: 'reply-draft' } }), 'reply-draft');
  assert.equal(answerAction({ feature: { id: 'refine-shorter' }, meta: { base: { id: 'record-summary' } } }), 'record-summary');
  assert.equal(answerAction(undefined), '');
});

test('reveal: brought into view only when it is out of sight (under the sticky header, or below), smooth unless asked not to be', () => {
  const calls = [];
  const win = (reduce = false) => ({ innerHeight: 600, document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: () => '56px' }), matchMedia: () => ({ matches: reduce }) });
  const el = (top) => ({ getBoundingClientRect: () => ({ top }), scrollIntoView: (o) => calls.push(`${top} ${o.block} ${o.behavior}`) });
  assert.equal(reveal(el(120), win()), false);
  assert.equal(reveal(el(20), win()), true, 'under the header');
  assert.equal(reveal(el(-300), win(true)), true);
  assert.equal(reveal(el(590), win()), true, 'at the very bottom');
  assert.deepEqual(calls, ['20 start smooth', '-300 start auto', '590 start smooth']);
  assert.equal(reveal(null, win()), false);
});

// ---- the screen ------------------------------------------------------------------------------------------------------------------

const ORIGIN = 'https://acme.service-now.com';
const record = { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' };
const page = { status: 'record', tabId: 601, href: `${ORIGIN}/incident.do?sys_id=${INCIDENT_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
const header = { number: 'INC0010001', short_description: 'VPN keeps disconnecting for Abel Tuter', state: 'In Progress', priority: '2 - High' };
const effOf = (values = {}, policy = {}, apiKey = '') => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'], profilesConfirmed: true, provider: 'anthropic', ...values }, policy), apiKey, keyLocked: false });
const KEY = 'sk-ant-test-0123456789';
const deps = () => Object.assign(fakeDeps(buildInstance()), { now: () => Date.UTC(2026, 9, 26, 12) });
const packOf = () => ({
  version: 1,
  table: 'incident',
  sysId: INCIDENT_ID,
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: {},
  access: [],
});

async function setup() {
  insightStore.clear();
  forgetAnswers();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Hi Abel, please restart the client.');
  const answer = await insightOps.glance({ table: 'incident', sysId: INCIDENT_ID }, { deps: deps(), checkRecord, checkPack });
  fake.onRead('header', () => header);
  fake.onRead('glance', () => answer);
  fake.onRead('pack', () => packOf());
  for (const op of ['lookalikes', 'knowledge', 'history', 'journey', 'ciChanges', 'knownErrors', 'resolutionFacts']) fake.onRead(op, () => new Promise(() => {}));
  return fake;
}

// The shell's two pieces the screen talks to: the rail store, and the opener of All tools (here it only notes where it was opened).
const drawn = (store, props, opened = []) => (
  <AllToolsContext.Provider value={(section) => opened.push(section || '')}>
    <RailContext.Provider value={store}>
      <TicketView page={page} eff={effOf()} active {...props} />
    </RailContext.Provider>
  </AllToolsContext.Provider>
);
const rail = (store) => store.getSnapshot().ticket || null;
const groupRow = (ui, id) => ui.$(`li[data-group="${id}"] > .ab-ins-group-row`);
const launchOf = (featureId) => makeLaunch({ tabId: page.tabId, table: 'incident', sysId: INCIDENT_ID, featureId, now: Date.now() });

test('the screen publishes the Insights rail: the five rows it draws, the dots they show; a click opens that row in place, "All tools" opens All tools', async () => {
  await setup();
  const store = createRailStore();
  const opened = [];
  const eff = effOf();
  const ui = await mount(drawn(store, { eff }, opened));
  try {
    await settle(8);
    const r = rail(store);
    assert.equal(r.title, 'Insights');
    const shownGroups = ui.$$('li[data-group]').map((li) => li.getAttribute('data-group'));
    assert.deepEqual(r.items.map((i) => i.id), [...shownGroups, ALL_TOOLS]);
    assert.deepEqual(shownGroups, focusCards(cardIdsFor(record, header, eff).map((id) => ({ id }))).groups.map((g) => g.id));
    for (const it of r.items.slice(0, -1)) {
      const li = ui.$(`li[data-group="${it.id}"]`);
      const look = /\bis-(warn|danger)\b/.exec(li.getAttribute('class'))?.[1] || '';
      assert.equal(it.attention, look, `${it.id}: the rail and the row say the same`);
    }
    // The fixture's SLA was due days ago: "Understand the ticket" says so on its row, with the dot, and the tab counts that row.
    const understand = groupRow(ui, 'understand');
    assert.match(understand.querySelector('.ab-ins-pain-line').textContent, /^The SLA was due 9 d ago/);
    assert.ok(understand.querySelector('.ab-ins-tile-dot'));
    assert.equal(r.items[0].attention, 'danger');
    const tab = ui.$('#ab-ticket-half-tab-insights');
    assert.equal(tab.getAttribute('aria-label'), 'Insights: 1 needs a look');
    assert.equal(tab.querySelector('.ab-halfswitch-count')?.textContent, '1');

    // A click in the rail: the row opens in place and its button takes the focus.
    assert.equal(groupRow(ui, 'fix').getAttribute('aria-expanded'), 'false');
    await during(async () => store.select('ticket', 'fix'));
    assert.equal(groupRow(ui, 'fix').getAttribute('aria-expanded'), 'true');
    assert.equal(focused(), groupRow(ui, 'fix'));
    assert.ok(ui.$('li[data-group="fix"] li[data-card="steps"] > .ab-ins-card-toggle'), 'its cards as rows of their own');
    await during(async () => store.select('ticket', ALL_TOOLS));
    assert.deepEqual(opened, ['ticket-insights'], 'All tools, at the Insights of this ticket');
  } finally {
    await ui.unmount();
  }
});

test('another screen on show, or the screen gone: no rail', async () => {
  await setup();
  const store = createRailStore();
  const eff = effOf();
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(6);
    assert.ok(rail(store));
    await ui.rerender(drawn(store, { eff, active: false }));
    assert.equal(rail(store), null, 'not on show: no rail');
    await ui.rerender(drawn(store, { eff }));
    assert.ok(rail(store));
  } finally {
    await ui.unmount();
  }
  assert.equal(rail(store), null, 'unmounted: no rail');
});

test('AI Assist on: the five actions, waiting while AI is not set up; with AI ready a click is a click in AI Assist (preview first)', async () => {
  const fake = await setup();
  const store = createRailStore();
  const opened = [];
  const ui = await mount(drawn(store, { eff: effOf() }, opened));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    let r = rail(store);
    assert.equal(r.title, 'AI Assist');
    const plan = actionPlan({ record, header, eff: effOf() });
    assert.deepEqual(r.items.map((i) => i.id), [...plan.five.map((f) => f.item.feature.id), ALL_TOOLS]);
    assert.ok(r.items.slice(0, -1).every((i) => i.ai && i.disabled), 'no key: every action waits (AI Assist says how to set it up)');
    assert.equal(r.items.at(-1).disabled, false);

    const eff = effOf({ previewMode: 'always' }, {}, KEY);
    await ui.rerender(drawn(store, { eff }, opened));
    r = rail(store);
    assert.ok(r.items.every((i) => !i.disabled), 'AI ready');
    await during(async () => store.select('ticket', 'reply-draft'));
    await settle(6);
    // (the "Ready to resolve?" card reads the ticket for its own check; the run reads it for the action)
    assert.deepEqual(fake.readsOf('pack').map((a) => a.feature).filter((f) => f !== 'resolution-check'), ['reply-draft'], 'the run read the ticket for that action');
    assert.ok(ui.$('[role="dialog"]'), 'the check before sending, as for a click in AI Assist');
    assert.equal(globalThis.fetch.calls.length, 0, 'nothing sent before the person says so');
    assert.ok(rail(store).items.slice(0, -1).every((i) => i.disabled), 'while a run is on its way the actions wait');
    assert.equal(store.select('ticket', 'record-summary'), false);
    await during(async () => store.select('ticket', ALL_TOOLS));
    assert.deepEqual(opened, ['ticket-assist'], 'All tools, at the AI actions of this ticket');
  } finally {
    await ui.unmount();
  }
});

test('AI Assist on: the action whose answer is on show is the one marked in the rail', async () => {
  await setup();
  const store = createRailStore();
  const eff = effOf({ previewMode: 'never' }, {}, KEY);
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), []);
    await during(async () => store.select('ticket', 'reply-draft'));
    await settle(10);
    assert.equal(globalThis.fetch.calls.length, 1, 'sent (no preview asked for in this test)');
    assert.ok(ui.$('section.ab-answer'), 'its answer is on show');
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['reply-draft']);
  } finally {
    await ui.unmount();
  }
});

test('AI switched off by the organisation: no tabs, and the rail is the Insights rail', async () => {
  await setup();
  const store = createRailStore();
  const ui = await mount(drawn(store, { eff: effOf({}, { aiEnabled: false }, KEY) }));
  try {
    await settle(6);
    assert.equal(ui.$('[role="tablist"]'), null);
    assert.equal(rail(store).title, 'Insights');
    assert.ok(rail(store).items.every((i) => !i.ai));
  } finally {
    await ui.unmount();
  }
});

// ---- what All tools, a shortcut or the bar on the ServiceNow page asks for -----------------------------------------------------

test('"Ready to resolve?" from the bar on the ServiceNow page: that card alone in Insights; its row is the one marked in the rail', async () => {
  await setup();
  const store = createRailStore();
  let done = 0;
  const ui = await mount(drawn(store, { eff: effOf() }));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    await ui.rerender(drawn(store, { eff: effOf(), launch: launchOf('card:ready'), onLaunchDone: () => (done += 1) }));
    await settle(4);
    assert.equal(done, 1);
    assert.equal(ui.$('#ab-ticket-half-tab-insights').getAttribute('aria-selected'), 'true');
    assert.deepEqual(ui.$$('[data-card]').map((el) => el.getAttribute('data-card')), ['resolve'], 'that card alone');
    assert.equal(ui.$('[data-card="resolve"] h3.ab-ins-focus-title')?.textContent, 'Ready to resolve?');
    assert.equal(focused(), ui.$('[data-card="resolve"] h3.ab-ins-focus-title'));
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['close']);
    // Back: the five again, the focus on the row the card is in (opened for it).
    await click(ui.button('Back'));
    assert.equal(ui.$('.ab-ins-back'), null);
    assert.equal(ui.$$('li[data-group]').length, 5);
    assert.equal(groupRow(ui, 'close').getAttribute('aria-expanded'), 'true');
    assert.equal(focused(), groupRow(ui, 'close'));
  } finally {
    await ui.unmount();
  }
});

test('a card of the rest from All tools (show:<id>): mounted when asked for, alone, then kept; back to the five, the focus on "More for this ticket"', async () => {
  const fake = await setup();
  const store = createRailStore();
  const ui = await mount(drawn(store, { eff: effOf() }));
  try {
    await settle(6);
    assert.equal(ui.$('[data-card="knownErrors"]', { all: true }), null, 'a card of the rest is not mounted before it is asked for');
    assert.equal(fake.readsOf('knownErrors').length, 0, 'and reads nothing');
    const more = ui.$('.ab-more-tools');
    const rest = focusCards(cardIdsFor(record, header, effOf()).map((id) => ({ id }))).rest.length;
    assert.equal(more.textContent, `More for this ticket: ${rest} Insights`);

    await ui.rerender(drawn(store, { eff: effOf(), launch: launchOf('show:knownErrors') }));
    await settle(4);
    assert.deepEqual(ui.$$('[data-card]').map((el) => el.getAttribute('data-card')), ['knownErrors']);
    assert.equal(ui.$('h3.ab-ins-focus-title')?.textContent, 'Known errors and open problems');
    assert.equal(ui.$$('li[data-group]').length, 0, 'the five are out of sight');
    assert.equal(fake.readsOf('knownErrors').length, 1, 'it reads now');
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), [], 'a card of the rest is no row of the five');

    await click(ui.button('Back'));
    assert.equal(ui.$$('li[data-group]').length, 5);
    assert.equal(focused(), ui.$('.ab-more-tools'), 'the way back to it');
    assert.ok(ui.$('[data-card="knownErrors"]', { all: true }), 'still mounted, hidden: it keeps what was typed in it');
    assert.equal(ui.$('[data-card="knownErrors"]'), null);

    // A card this record does not have: nothing happens (the five stay).
    await ui.rerender(drawn(store, { eff: effOf(), launch: launchOf('show:article') }));
    await settle(2);
    assert.equal(ui.$('.ab-ins-back'), null);
    assert.equal(ui.$('.ab-note-warn[role="status"]'), null, 'no note either');
  } finally {
    await ui.unmount();
  }
});

test('"Ask about this ticket" (ask:ticket): AI Assist, the question box at its top with the focus in it; it stays for that record', async () => {
  await setup();
  const store = createRailStore();
  const eff = effOf({ previewMode: 'always' }, {}, KEY);
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    assert.equal(ui.$('form.ab-ask'), null, 'not drawn until it is asked for');
    await ui.rerender(drawn(store, { eff, launch: launchOf('ask:ticket') }));
    await settle(4);
    const form = ui.$('#ab-ticket-half-panel-assist form.ab-ask');
    assert.ok(form, 'drawn in AI Assist');
    const panelKids = [...ui.$('#ab-ticket-half-panel-assist').querySelectorAll('form.ab-ask, section.ab-acts')];
    assert.equal(panelKids[0], form, 'above the five');
    assert.equal(focused(), form.querySelector('input'), 'the focus in its box');
    await click(ui.tab(/^Insights/));
    await click(ui.tab('AI Assist'));
    assert.ok(ui.$('form.ab-ask'), 'still there for this record');
  } finally {
    await ui.unmount();
  }
});

test('"Ask about this ticket" with AI not set up: a note says so, nothing opens', async () => {
  await setup();
  const store = createRailStore();
  const ui = await mount(drawn(store, { eff: effOf() }));
  try {
    await settle(6);
    await ui.rerender(drawn(store, { eff: effOf(), launch: launchOf('ask:ticket') }));
    await settle(2);
    assert.match(ui.$('.ab-note-warn[role="status"]')?.textContent || '', /AI/);
    assert.equal(ui.$('form.ab-ask', { all: true }), null);
  } finally {
    await ui.unmount();
  }
});

test('AI Assist shows five rows: the pain point above each, the action\'s title first on its button, one "Start"; the rest in All tools', async () => {
  await setup();
  const store = createRailStore();
  const opened = [];
  const eff = effOf({ previewMode: 'always' }, {}, KEY);
  const ui = await mount(drawn(store, { eff }, opened));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    const plan = actionPlan({ record, header, eff });
    const items = ui.$$('#ab-ticket-half-panel-assist li.ab-act-item');
    assert.equal(items.length, plan.five.length);
    assert.ok(items.length >= 3 && items.length <= 5, String(items.length));
    for (const [i, li] of items.entries()) {
      const { painTitle, item: it } = plan.five[i];
      assert.equal(li.querySelector('.ab-act-pain').textContent, painTitle, 'the pain point, above');
      const button = li.querySelector('button.ab-act-row');
      const kids = li.childNodes.filter((n) => n.nodeType === 1);
      assert.ok(kids[0].getAttribute('class') === 'ab-act-pain' && kids[1] === button, 'outside the button, right above it');
      assert.equal(button.querySelector('.ab-act-pain'), null);
      assert.ok(button.textContent.trim().startsWith(featureById(it.feature.id).title), `${it.feature.id}: the title first`);
    }
    assert.equal(ui.$$('.ab-act-primary').length, 1);
    assert.equal(ui.$('.ab-act-primary').getAttribute('data-feature'), 'reply-draft', 'in progress: reply');
    assert.ok(!ui.hasButton(/^More actions/), 'no folded list any more');
    const more = ui.$('#ab-ticket-half-panel-assist .ab-more-tools');
    assert.equal(more.textContent, `More for this ticket: ${plan.rest.length} AI actions`);
    await click(more);
    assert.deepEqual(opened, ['ticket-assist']);
  } finally {
    await ui.unmount();
  }
});

test('an action that is not one of the five, asked for by All tools: started all the same (preview first)', async () => {
  const fake = await setup();
  const store = createRailStore();
  const eff = effOf({ previewMode: 'always' }, {}, KEY);
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(6);
    const plan = actionPlan({ record, header, eff });
    const other = plan.rest.find((it) => !it.reason)?.feature.id;
    assert.ok(other, 'the record offers more than the five');
    await ui.rerender(drawn(store, { eff, launch: launchOf(other) }));
    await settle(6);
    assert.equal(ui.$('#ab-ticket-half-tab-assist').getAttribute('aria-selected'), 'true');
    assert.ok(fake.readsOf('pack').some((a) => a.feature === other));
    assert.ok(ui.$('[role="dialog"]'), 'the check before sending');
  } finally {
    await ui.unmount();
  }
});
