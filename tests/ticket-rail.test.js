import { mount, click, settle, during, makeChrome, fakeAiFetch } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import { cardIdsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { ALL_INSIGHTS, SUGGESTED, actionLabel, answerAction, assistRail, insightsRail, reveal } from '../src/sidepanel/ticket/ticketRail.js';
import { actionPlan } from '../src/sidepanel/ticket/assist/actions/index.js';
import { forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { RailContext } from '../src/sidepanel/shell/SideRail.jsx';
import { createRailStore } from '../src/sidepanel/shell/railStore.js';
import { assistDefaultOrder } from '../src/features/railLayout.js';
import { featureById } from '../src/features/registry.js';
import { makeLaunch } from '../src/lib/launch.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import insightOps from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';

// The Ticket screen's side rail (docs/rail-layout.md A): with Insights on, "All insights" and every card (a dot on the ones that need
// a look; a click shows that card alone); with AI Assist on, "Suggested" and every AI action this record offers (a click starts it as
// a click in AI Assist does: preview first). The pure part first, then the screen in a small DOM with the shell's real rail store.

const cards = [
  { id: 'steps', title: 'Steps that worked before' },
  { id: 'related', title: 'Related tickets' },
  { id: 'email', title: 'Which email fits' },
  { id: 'journey', title: 'Ticket journey' },
];

test('Insights rail: "All insights", a line, then every card in the record\'s order with its own icon; a dot only for a look', () => {
  const items = insightsRail({ cards, reports: { related: { attention: 'warn' }, email: { attention: 'danger' }, steps: { attention: 'ok' }, journey: { attention: 'clear' } }, kind: 'incident' });
  assert.deepEqual(items.map((i) => i.id), [ALL_INSIGHTS, 'steps', 'related', 'email', 'journey']);
  assert.deepEqual(items[0], { id: 'all', label: 'All insights', icon: 'list', attention: '', separator: false, current: true });
  assert.deepEqual(items.map((i) => i.separator), [false, true, false, false, false], 'the line comes after "All insights"');
  assert.deepEqual(items.map((i) => i.attention), ['', '', 'warn', 'danger', '']);
  assert.deepEqual(items.slice(1).map((i) => i.icon), ['enter', 'link', 'mail', 'clock']);
  assert.ok(items.every((i) => !i.ai), 'no Insights item is an AI item');
  const focused = insightsRail({ cards, kind: 'incident', focus: 'email' });
  assert.deepEqual(focused.filter((i) => i.current).map((i) => i.id), ['email']);
});

test('Insights rail: the person\'s arrangement for the kind (their order first, what they hid left out); another kind keeps the defaults', () => {
  const layout = { incident: { insights: { order: ['journey', 'gone'], hidden: ['email'] } } };
  assert.deepEqual(insightsRail({ cards, layout, kind: 'incident' }).map((i) => i.id), ['all', 'journey', 'steps', 'related']);
  assert.deepEqual(insightsRail({ cards, layout, kind: 'case' }).map((i) => i.id), ['all', 'steps', 'related', 'email', 'journey']);
});

const item = (id, reason = '') => ({ feature: featureById(id), reason, caution: '' });
const offered = ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'kb-article-draft'].map((id) => item(id));

test('AI Assist rail: "Suggested", a line, then every action, what fits the ticket\'s state first; short names, AI marked', () => {
  const items = assistRail({ items: offered, kind: 'incident', stage: 'resolve' });
  assert.deepEqual(items[0], { id: SUGGESTED, label: 'Suggested', icon: 'sparkle', ai: false, separator: false, current: true, disabled: false });
  assert.deepEqual(items.slice(1).map((i) => i.id), assistDefaultOrder(offered.map((it) => it.feature.id), { kind: 'incident', stage: 'resolve' }));
  assert.equal(items[1].id, 'resolution-notes', 'a resolved incident: the resolution notes first');
  assert.ok(items.slice(1).every((i) => i.ai && !i.disabled));
  assert.equal(items[1].separator, true);
  assert.equal(items.find((i) => i.id === 'reply-draft').label, 'Draft a reply', 'the short label, as on the page\'s bar');
  assert.equal(items.find((i) => i.id === 'reply-draft').icon, 'reply');
  // The state is not followed when the person switched that off: the registry's order.
  assert.deepEqual(assistRail({ items: offered, kind: 'incident', stage: 'resolve', byState: false }).slice(1).map((i) => i.id), offered.map((it) => it.feature.id));
  // Their own arrangement wins; a hidden action is not in the rail.
  const layout = { incident: { assist: { order: ['handoff-brief'], hidden: ['kb-article-draft'] } } };
  const mine = assistRail({ items: offered, kind: 'incident', stage: 'resolve', layout }).slice(1).map((i) => i.id);
  assert.equal(mine[0], 'handoff-brief');
  assert.ok(!mine.includes('kb-article-draft'));
});

test('AI Assist rail: disabled while AI cannot be used now, and an action with a reason of its own; the action on show is marked', () => {
  const items = assistRail({ items: [item('record-summary'), item('reply-draft', 'Needs Strict privacy mode. Change it in Settings.')], kind: 'incident', current: 'record-summary' });
  assert.deepEqual(items.map((i) => [i.id, i.disabled, i.current]), [['suggested', false, false], ['record-summary', false, true], ['reply-draft', true, false]]);
  const off = assistRail({ items: offered, kind: 'incident', off: true });
  assert.ok(off.slice(1).every((i) => i.disabled), 'no key, AI skipped, a record block, an answer on its way');
  assert.equal(off[0].disabled, false, '"Suggested" still goes back to the top');
  assert.equal(assistRail({ items: offered, kind: 'incident', current: 'gone' })[0].current, true, 'an answer of an action not in the rail: "Suggested"');
  assert.equal(actionLabel({ id: 'not-a-short-one', title: 'Some long title' }), 'Some long title');
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

const drawn = (store, props) => (
  <RailContext.Provider value={store}>
    <TicketView page={page} eff={effOf()} active {...props} />
  </RailContext.Provider>
);
const rail = (store) => store.getSnapshot().ticket || null;
const shownCards = (ui) => ui.$$('li[data-card]').map((li) => li.getAttribute('data-card'));

test('the screen publishes the Insights rail: every card it draws, the dots its rows show; a click shows that card alone, "All insights" goes back', async () => {
  await setup();
  const store = createRailStore();
  const eff = effOf();
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(8);
    const r = rail(store);
    assert.equal(r.title, 'Insights');
    assert.deepEqual(r.items.map((i) => i.id), ['all', ...cardIdsFor(record, header, eff)]);
    for (const it of r.items.slice(1)) {
      const li = ui.$(`li[data-card="${it.id}"]`, { all: true });
      const look = /\bis-(warn|danger)\b/.exec(li.getAttribute('class'))?.[1] || '';
      assert.equal(it.attention, look, `${it.id}: the rail and the row say the same`);
    }
    // The fixture's SLA was due days ago: the first row of Insights says so (not a card, so not in the rail), and the tab counts it.
    const first = ui.$('ul.ab-ins-cards > li');
    assert.equal(first.getAttribute('data-need'), 'sla');
    assert.match(first.textContent, /^The SLA was due 9 d ago/);
    assert.ok(!r.items.some((i) => i.attention), 'no card has said it needs a look here (their reads do not answer in this test)');
    const tab = ui.$('#ab-ticket-half-tab-insights');
    assert.equal(tab.getAttribute('aria-label'), 'Insights: 1 needs a look');
    assert.equal(tab.querySelector('.ab-halfswitch-count')?.textContent, '1');

    await during(async () => store.select('ticket', 'related'));
    assert.deepEqual(shownCards(ui), ['related'], 'that card alone');
    assert.ok(ui.$('li[data-card="related"] h3.ab-ins-focus-title'));
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['related']);
    await during(async () => store.select('ticket', 'all'));
    assert.ok(shownCards(ui).length > 3, 'the list again');
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['all']);
    // The back button above a card alone does the same.
    await during(async () => store.select('ticket', 'journey'));
    await click(ui.button('All insights'));
    assert.ok(shownCards(ui).length > 3);
    assert.equal(ui.$('.ab-ins-back'), null);
  } finally {
    await ui.unmount();
  }
});

test('the person\'s arrangement shapes the rail, not the list; another screen on show, or the screen gone: no rail', async () => {
  await setup();
  const store = createRailStore();
  const eff = effOf({ railLayout: { incident: { insights: { order: ['journey'], hidden: ['email'] } } } });
  const ui = await mount(drawn(store, { eff }));
  try {
    await settle(8);
    const ids = rail(store).items.map((i) => i.id);
    assert.equal(ids[1], 'journey');
    assert.ok(!ids.includes('email'));
    assert.ok(ui.$('li[data-card="email"]', { all: true }), 'the card is still in the list');
    await ui.rerender(drawn(store, { eff, active: false }));
    assert.equal(rail(store), null, 'not on show: no rail');
    await ui.rerender(drawn(store, { eff }));
    assert.ok(rail(store));
  } finally {
    await ui.unmount();
  }
  assert.equal(rail(store), null, 'unmounted: no rail');
});

test('AI Assist on: "Suggested" and every action, waiting while AI is not set up; with AI ready a click is a click in AI Assist (preview first)', async () => {
  const fake = await setup();
  const store = createRailStore();
  const ui = await mount(drawn(store, { eff: effOf() }));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    let r = rail(store);
    assert.equal(r.title, 'AI Assist');
    const plan = actionPlan({ record, header, eff: effOf() });
    assert.deepEqual(r.items.map((i) => i.id), ['suggested', ...assistDefaultOrder(plan.items.map((it) => it.feature.id), { kind: 'incident', stage: plan.stage })]);
    assert.ok(r.items.slice(1).every((i) => i.ai && i.disabled), 'no key: every action waits (AI Assist says how to set it up)');

    const eff = effOf({ previewMode: 'always' }, {}, KEY);
    await ui.rerender(drawn(store, { eff }));
    r = rail(store);
    assert.ok(r.items.slice(1).every((i) => !i.disabled), 'AI ready');
    await during(async () => store.select('ticket', 'reply-draft'));
    await settle(6);
    // (the "Ready to resolve?" card reads the ticket for its own check; the run reads it for the action)
    assert.deepEqual(fake.readsOf('pack').map((a) => a.feature).filter((f) => f !== 'resolution-check'), ['reply-draft'], 'the run read the ticket for that action');
    assert.ok(ui.$('[role="dialog"]'), 'the check before sending, as for a click in AI Assist');
    assert.equal(globalThis.fetch.calls.length, 0, 'nothing sent before the person says so');
    assert.ok(rail(store).items.slice(1).every((i) => i.disabled), 'while a run is on its way the actions wait');
    assert.equal(store.select('ticket', 'record-summary'), false);
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
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['suggested']);
    await during(async () => store.select('ticket', 'reply-draft'));
    await settle(10);
    assert.equal(globalThis.fetch.calls.length, 1, 'sent (no preview asked for in this test)');
    assert.ok(ui.$('section.ab-answer'), 'its answer is on show');
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['reply-draft']);
    await during(async () => store.select('ticket', 'suggested'));
    assert.ok(rail(store), '"Suggested" only brings the top back into view');
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

test('"Ready to resolve?" asked for from the bar on the ServiceNow page: that card alone in Insights, as a click in the rail does', async () => {
  await setup();
  const store = createRailStore();
  let done = 0;
  const ui = await mount(drawn(store, { eff: effOf() }));
  try {
    await settle(6);
    await click(ui.tab('AI Assist'));
    const launch = makeLaunch({ tabId: page.tabId, table: 'incident', sysId: INCIDENT_ID, featureId: 'card:ready', now: Date.now() });
    await ui.rerender(drawn(store, { eff: effOf(), launch, onLaunchDone: () => (done += 1) }));
    await settle(4);
    assert.equal(done, 1);
    assert.equal(ui.$('#ab-ticket-half-tab-insights').getAttribute('aria-selected'), 'true');
    assert.deepEqual(shownCards(ui), ['resolve']);
    assert.deepEqual(rail(store).items.filter((i) => i.current).map((i) => i.id), ['resolve']);
  } finally {
    await ui.unmount();
  }
});
