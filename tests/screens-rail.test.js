import { mount as mountView, click, settle, during, focused, makeChrome, fakeAiFetch, window } from './fixtures/panel-dom.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import ScreenView from '../src/sidepanel/shell/ScreenView.jsx';
import { RailContext, RailSectionsContext, useSectionRegistry } from '../src/sidepanel/shell/SideRail.jsx';
import { createRailStore } from '../src/sidepanel/shell/railStore.js';
import { PATHS } from '../src/sidepanel/ui/iconPaths.js';
import { catalogueOf, setLanguage } from '../src/i18n/index.js';
import { MYWORK_SECTIONS } from '../src/sidepanel/mywork/railSections.js';
import { TEAM_ASSIST_SECTIONS } from '../src/sidepanel/team/railSections.js';
import { WRITE_SECTIONS } from '../src/sidepanel/write/railSections.js';
import { KNOWLEDGE_SECTIONS } from '../src/sidepanel/knowledgeScreen/railSections.js';
import { DASHBOARD_SECTIONS, widgetRail } from '../src/sidepanel/reports/railSections.js';
import { REPORT_SECTIONS } from '../src/sidepanel/reports/sections.js';
import { RailCard } from '../src/sidepanel/reports/RailCard.jsx';
import { Section } from '../src/sidepanel/write/Section.jsx';
import MyWorkView from '../src/sidepanel/mywork/index.js';
import { TeamInsights, TeamAssist } from '../src/sidepanel/team/index.js';
import { resetTeamShares } from '../src/sidepanel/team/teamShare.js';
import { WriteInsights, WriteAssist } from '../src/sidepanel/write/index.js';
import { KnowledgeInsights, KnowledgeAssist } from '../src/sidepanel/knowledgeScreen/index.js';
import { clearShared } from '../src/sidepanel/knowledgeScreen/shared.js';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { DEFAULT_SETTINGS, effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { DAY, HOUR } from '../src/mywork/time.js';
import { handoverWorld, USER, NOW, GROUP_A } from './reports-ai-fixtures.js';

// The side rail on the My work, Team, Write and Knowledge screens (docs/rail-layout.md B): every section a person sees is an item of
// the rail of its half, named by its heading, with an icon of its own; a click brings it into view and opens it first if it folds.
// First the tables the sections take their names and icons from, then the screens mounted the way the panel mounts them (ScreenView
// inside the shell's rail store), so what registers, in which order, and what a click does are seen as the rail sees them.

const TABLES = { mywork: MYWORK_SECTIONS, team: TEAM_ASSIST_SECTIONS, write: WRITE_SECTIONS, knowledge: KNOWLEDGE_SECTIONS };
const english = (fn) => {
  setLanguage('en');
  return fn();
};
const arabic = (fn) => {
  setLanguage('ar');
  try {
    return fn();
  } finally {
    setLanguage('en');
  }
};
const AR = catalogueOf('ar');

// ---- the tables -------------------------------------------------------------------------------------------------------------------

for (const [screen, table] of Object.entries(TABLES)) {
  test(`${screen}: every section has a unique id, a half, an icon that can be drawn (one per half) and a label in both languages`, () => {
    const entries = Object.values(table);
    const ids = entries.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique on the screen');
    for (const e of entries) {
      assert.ok(e.half === 'insights' || e.half === 'assist', `${e.id}: a half`);
      assert.equal(typeof PATHS[e.icon], 'string', `${e.id}: ${e.icon} can be drawn`);
      const en = english(() => e.label());
      assert.ok(en && typeof en === 'string', `${e.id}: a label`);
      assert.equal(typeof AR[en], 'string', `${e.id}: "${en}" has its Arabic`);
      assert.notEqual(arabic(() => e.label()), en, `${e.id}: shown in Arabic`);
    }
    for (const half of ['insights', 'assist']) {
      const icons = entries.filter((e) => e.half === half).map((e) => e.icon);
      assert.equal(new Set(icons).size, icons.length, `${half}: a different icon for each section`);
    }
  });
}

test('knowledge: the articles for the open ticket are named after the ticket, in both languages', () => {
  const s = KNOWLEDGE_SECTIONS.ticket;
  assert.equal(english(() => s.label({ number: 'INC0010001' })), 'Articles for INC0010001');
  assert.equal(english(() => s.label()), 'Articles for the open ticket');
  assert.equal(typeof AR['Articles for {number}'], 'string');
  assert.match(arabic(() => s.label({ number: 'INC0010001' })), /INC0010001/);
});

test('team dashboard: every section the dashboard can draw has an entry (and a custom report), each icon can be drawn, once', () => {
  assert.deepEqual(Object.keys(DASHBOARD_SECTIONS).sort(), [...REPORT_SECTIONS.map((s) => s.id), 'builder'].sort());
  const icons = Object.values(DASHBOARD_SECTIONS).map((e) => e.icon);
  assert.equal(new Set(icons).size, icons.length, 'a different icon for each kind of section');
  for (const [id, e] of Object.entries(DASHBOARD_SECTIONS)) {
    assert.equal(typeof PATHS[e.icon], 'string', `${id}: ${e.icon} can be drawn`);
    const en = english(() => e.label());
    assert.equal(typeof AR[en], 'string', `${id}: "${en}" has its Arabic`);
  }
});

test('team dashboard: a widget is named by the heading it draws; a custom report by its result, its own title, or "Custom report"', () => {
  setLanguage('en');
  assert.deepEqual(widgetRail({ id: 'w1', type: 'section', section: 'sla' }), { id: 'w1', label: 'SLA risk radar', icon: 'clock' });
  assert.deepEqual(widgetRail({ id: 'w2', type: 'section', section: 'overview' }), { id: 'w2', label: 'Overview', icon: 'monitor' });
  const builder = { id: 'w3', type: 'builder', builder: { title: 'My incidents' } };
  assert.equal(widgetRail(builder, { title: 'Incidents: number of tickets by state' }).label, 'Incidents: number of tickets by state');
  assert.equal(widgetRail(builder).label, 'My incidents');
  assert.deepEqual(widgetRail({ id: 'w4', type: 'builder', builder: {} }), { id: 'w4', label: 'Custom report', icon: 'file' });
  assert.equal(widgetRail({ id: 'w5', type: 'section', section: 'gone' }), null, 'a section the dashboard does not draw is not listed');
  assert.equal(widgetRail({ id: 'w6', type: 'section', section: 'constructor' }), null);
  assert.equal(widgetRail({ id: 'w7', type: 'section', section: 'builder' }), null);
  assert.equal(widgetRail({ type: 'section', section: 'sla' }), null, 'no id, no item');
});

// ---- mounting -----------------------------------------------------------------------------------------------------------------------

// goToSection waits one tick before it scrolls; the small DOM's window has no timers of its own.
window.setTimeout = (fn, ms) => setTimeout(fn, ms);
window.matchMedia = () => ({ matches: true });

const mounted = new Set();
async function mount(element) {
  const ui = await mountView(element);
  const unmount = ui.unmount;
  ui.unmount = async () => {
    if (!mounted.delete(ui)) return;
    await unmount();
  };
  mounted.add(ui);
  return ui;
}
afterEach(async () => {
  for (const ui of [...mounted]) await ui.unmount();
  setLanguage('en');
});

/** A screen as the panel draws it: ScreenView (both halves, the rail of the half on show) inside the shell's rail store. */
async function onScreen(screen, label, { Insights, Assist = null, page, eff, extra = {} }) {
  const store = createRailStore();
  const ui = await mount(
    <RailContext.Provider value={store}>
      <ScreenView screen={screen} label={label} Insights={Insights} Assist={Assist} page={page} eff={eff} active extra={extra} />
    </RailContext.Provider>
  );
  assert.equal(ui.errors.length, 0, ui.errors.join('\n'));
  const rail = () => store.getSnapshot()[screen] || null;
  return {
    ui,
    store,
    rail,
    items: () => (rail()?.items || []).map(({ id, label: name, icon, attention }) => ({ id, label: name, icon, attention })),
    ids: () => (rail()?.items || []).map((it) => it.id),
    select: (id) => during(() => store.select(screen, id)),
  };
}

const entry = (e, more = {}) => ({ id: e.id, label: e.label(), icon: e.icon, attention: '', ...more });

// ---- My work ---------------------------------------------------------------------------------------------------------------------------

const M = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };
let n = 0;
function ticket(over = {}) {
  n += 1;
  const now = Date.now();
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, 'a'), number: `INC00${String(n).padStart(5, '0')}`, title: `Ticket ${n}`, priority: '3 - Moderate', state: 'In Progress', holdReason: '', work: 'open', updatedAt: now - 2 * HOUR, openedAt: now - DAY, ci: null, group: null, sla: null, marker: M, ...over };
}
function myWork({ items = [], approvals = [], groups = [] } = {}) {
  return {
    version: 1,
    readAt: Date.now(),
    queue: { items, totals: {}, total: items.length, more: false, empty: items.length ? null : 'nothing', names: {}, listQuery: `assigned_to=${USER}^active=true` },
    approvals: { items: approvals, total: approvals.length, listQuery: `approver=${USER}^state=requested` },
    groups: { groups: [{ id: 'g'.repeat(32), name: 'Service Desk' }], items: groups, total: groups.length, more: false, listQuery: 'assignment_groupINx^assigned_toISEMPTY^active=true', names: {}, note: '' },
    access: [],
  };
}
const myWorkEff = () => ({ ready: true, values: {}, locked: {}, policy: normalizePolicy({}) });
const myWorkPage = { status: 'other', tabId: 7, href: 'https://acme.service-now.com/now/nav/ui/home', surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth' } };

async function myWorkScreen(answer) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('myWork', () => answer);
  return onScreen('mywork', 'My work', { Insights: MyWorkView, page: myWorkPage, eff: myWorkEff(), extra: { onOpenTicket: () => {} } });
}

test('My work: the rail lists its four sections in the page\'s order, named as on screen, marked where a breach or a late approval is', async () => {
  const now = Date.now();
  const breached = ticket({ title: 'Printer offline', sla: { breached: true, paused: false, percentage: 140, dueAt: now - DAY, risk: 'breached' } });
  const late = { sysId: 'c'.repeat(32), number: 'RITM0010001', title: 'New laptop', requestedAt: now - 2 * DAY, dueAt: now - HOUR };
  const s = await myWorkScreen(myWork({ items: [breached, ticket()], approvals: [late], groups: [ticket()] }));
  assert.equal(s.rail().title, 'My work', 'one half: the rail is titled by the screen');
  const S = MYWORK_SECTIONS;
  assert.deepEqual(s.items(), [entry(S.queue, { attention: 'warn' }), entry(S.approvals, { attention: 'warn' }), entry(S.followUps), entry(S.groups)]);
  // The cards are still siblings (the line between two cards needs that): nothing is wrapped around them, the rail's mark is hidden.
  const cards = s.ui.$$('.ab-mywork > .ab-cardx');
  assert.deepEqual(cards.map((c) => c.getAttribute('data-card')), ['mywork-queue', 'mywork-approvals', 'mywork-followups', 'mywork-groups']);
  assert.deepEqual(cards.map((c) => c.getAttribute('data-rail-section')), ['mywork-queue', 'mywork-approvals', 'mywork-followups', 'mywork-groups']);
  assert.match(s.ui.text(), /My queue 2 open, 1 SLA breached/);
});

test('My work: a section that is not drawn is not in the rail; nothing marked when nothing is breached or late', async () => {
  const s = await myWorkScreen(myWork({ items: [ticket()] }));
  assert.deepEqual(s.ids(), ['mywork-queue', 'mywork-followups', 'mywork-groups'], 'no approvals: no approvals card, no item');
  assert.ok(s.items().every((it) => it.attention === ''));
});

test('My work: a click in the rail opens a card the person folded, then puts the focus on it', async () => {
  const s = await myWorkScreen(myWork({ items: [ticket()] }));
  const toggle = () => s.ui.$('[data-card="mywork-groups"] .ab-cardx-toggle');
  await click(toggle());
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'folded by the person');
  await s.select('mywork-groups');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true', 'opened by the rail');
  assert.equal(focused(), toggle(), 'the focus is on the title of the card: its fold button');
  assert.equal(s.rail().items.find((it) => it.id === 'mywork-groups').current, true, 'the item chosen is marked');
  await click(toggle());
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'the card still folds by its own button');
});

// ---- Team -------------------------------------------------------------------------------------------------------------------------------

const teamEff = (policy = {}) => ({
  ready: true,
  apiKey: 'sk-test',
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it', 'lead'] },
  locked: {},
  policy: normalizePolicy(policy),
});
const teamPage = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic', record: null, newRecord: null };
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
async function teamScreen(policy = {}) {
  resetTeamShares();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const inst = handoverWorld();
  const runtime = createRuntime();
  fake.onRead('reportContext', () => CONTEXT);
  fake.onRead('reportClear', () => ({ ok: true }));
  fake.onRead('reportRun', (args) => runReport({ kind: args.kind, section: args.section, scope: args.scope, tables: args.tables, params: {}, config: args.config }, { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 }));
  const s = await onScreen('team', 'Team', { Insights: TeamInsights, Assist: TeamAssist, page: teamPage, eff: teamEff(policy) });
  await settle(8);
  return s;
}

test('Team, Insights: one item per section of the dashboard, in its order, named by the heading the section draws', async () => {
  const s = await teamScreen();
  assert.equal(s.rail().title, 'Insights');
  const slots = s.ui.$$('.ab-widgets > .ab-widget-slot');
  assert.ok(slots.length >= 2, 'the dashboard drew its sections');
  const items = s.items();
  assert.equal(items.length, slots.length, 'every section is listed');
  for (const [i, it] of items.entries()) {
    assert.equal(slots[i].getAttribute('data-rail-section'), it.id, 'the page\'s order');
    assert.equal(slots[i].querySelector('.ab-widget-title').textContent, it.label, 'the heading the section draws');
    assert.ok(Object.values(DASHBOARD_SECTIONS).some((e) => e.icon === it.icon), `${it.label}: an icon of the table`);
  }
  assert.ok(items.some((it) => it.label === 'SLA risk radar' && it.icon === 'clock'));
  await s.select(items[1].id);
  assert.equal(focused()?.textContent, items[1].label, 'the focus is on the section\'s heading');
});

test('Team, AI Assist: the hand-over note, "Explain this dashboard" and (when allowed) coaching; a click opens the folded coaching card', async () => {
  const s = await teamScreen({ coachingEnabled: true });
  await click(s.ui.tab(/AI Assist/));
  await settle(8);
  assert.equal(s.rail().title, 'AI Assist');
  const S = TEAM_ASSIST_SECTIONS;
  assert.deepEqual(s.items(), [entry(S.handover), entry(S.explain), entry(S.coaching)]);
  const toggle = () => s.ui.$('[data-card="team-coaching"] .ab-cardx-toggle', { all: true });
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'coaching starts folded');
  await s.select('team-coaching');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  // Back to Insights: the rail lists the dashboard again.
  await click(s.ui.tab(/Insights/));
  assert.equal(s.rail().title, 'Insights');
  assert.ok(!s.ids().includes('team-coaching'));
});

test('Team, AI Assist: coaching that the organisation has not switched on is one line, not a section, and not in the rail', async () => {
  const s = await teamScreen();
  await click(s.ui.tab(/AI Assist/));
  await settle(8);
  assert.deepEqual(s.ids(), ['team-handover', 'team-explain']);
});

// ---- Write ------------------------------------------------------------------------------------------------------------------------------

const ORIGIN = 'https://acme.service-now.com';
const A = 'a'.repeat(32);
const recordPage = { status: 'record', tabId: 7, href: `${ORIGIN}/incident.do?sys_id=${A}`, surface: 'classic', portal: null, record: { table: 'incident', sysId: A, number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth Anglin' } };
const homePage = { status: 'no-record', tabId: 7, href: `${ORIGIN}/home`, surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth Anglin' } };
const panelEff = (profiles) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', profiles }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });

test('Write: the safe-to-send check and the snippets on Insights; Rewrite and Notes to ticket on AI Assist', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('An answer.');
  fake.onRead('header', () => ({ number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High' }));
  const s = await onScreen('write', 'Write', { Insights: WriteInsights, Assist: WriteAssist, page: recordPage, eff: panelEff(['it']) });
  const S = WRITE_SECTIONS;
  assert.equal(s.rail().title, 'Insights');
  assert.deepEqual(s.items(), [entry(S.check), entry(S.snippets)]);
  await s.select('write-snippets');
  assert.equal(focused()?.textContent, 'Snippets', 'the focus is on the section\'s heading');
  await click(s.ui.tab(/AI Assist/));
  assert.equal(s.rail().title, 'AI Assist');
  assert.deepEqual(s.items(), [entry(S.rewrite), entry(S.notes)]);
  // The headings are the rail's labels, and the sections keep the ids the tests and scenarios find them by.
  assert.deepEqual(s.ui.$$('[data-half="assist"] .ab-wk-title').map((h) => h.textContent), ['Rewrite', 'Notes to ticket']);
  assert.deepEqual(s.ui.$$('[data-half="assist"] section[data-card]').map((x) => x.getAttribute('data-card')), ['write-rewrite', 'write-notes']);
  assert.deepEqual(s.ui.$$('[data-half="assist"] section[data-card]').map((x) => x.getAttribute('data-rail-section')), ['write-rewrite', 'write-notes']);
});

// ---- Knowledge -------------------------------------------------------------------------------------------------------------------------

function knowledgeChrome() {
  clearShared();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('An answer.');
  fake.onRead('header', () => ({ number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High' }));
  fake.onRead('kbSearch', () => ({ hits: [], keywords: [], more: false, access: [] }));
  fake.onRead('kbScopes', () => ({ items: [], access: [] }));
  fake.onRead('kbGapScopes', () => ({ categories: [], total: 0, access: [] }));
  return fake;
}

test('Knowledge for a knowledge manager: the articles for the open ticket, the search, and the two folded tools; a click opens one', async () => {
  const fake = knowledgeChrome();
  const s = await onScreen('knowledge', 'Knowledge', { Insights: KnowledgeInsights, Assist: KnowledgeAssist, page: recordPage, eff: panelEff(['it', 'km']) });
  const S = KNOWLEDGE_SECTIONS;
  assert.deepEqual(s.items(), [{ ...entry(S.ticket), label: 'Articles for INC0010001' }, entry(S.search), entry(S.duplicates), entry(S.gaps)]);
  const toggle = () => s.ui.$('[data-card="kb-duplicates"] .ab-wk-toggle');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(fake.readsOf('kbScopes').length, 0, 'the duplicate finder reads nothing while folded');
  await s.select('kb-duplicates');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true', 'opened by the rail, as by its heading');
  assert.ok(fake.readsOf('kbScopes').length >= 1, 'and it starts reading, as when opened by its heading');
  assert.equal(focused()?.tagName, 'H2', 'the focus is on its heading');
  await click(s.ui.tab(/AI Assist/));
  assert.deepEqual(s.items(), [entry(S.merge), entry(S.outline)]);
});

test('Knowledge for everyone else: no ticket open, one half, the search alone', async () => {
  knowledgeChrome();
  const s = await onScreen('knowledge', 'Knowledge', { Insights: KnowledgeInsights, Assist: KnowledgeAssist, page: homePage, eff: panelEff(['it']) });
  assert.equal(s.rail().title, 'Knowledge', 'no AI half: the rail is titled by the screen');
  assert.deepEqual(s.ids(), ['kb-search'], 'the line asking to open a ticket has no heading: it is not a section');
});

// ---- the two pieces the sections are built with -----------------------------------------------------------------------------------

/** A half with a section registry, as ScreenView gives one; `seen` gets the entries each time they change. */
function Half({ seen, children }) {
  const [registry, entries] = useSectionRegistry();
  seen(entries);
  return <RailSectionsContext.Provider value={registry}>{children}</RailSectionsContext.Provider>;
}

test('Section: listed with its heading, its icon and its warning, only when it has a rail entry; folded, the rail opens it', async () => {
  let entries = [];
  const rail = { id: 'x-one', label: () => 'Snippets', icon: 'clipboard' };
  const ui = await mount(
    <Half seen={(e) => (entries = e)}>
      <Section rail={rail} attention="warn" fold defaultOpen={false}>
        <p>inside</p>
      </Section>
      <Section id="x-two" title="Not listed">
        <p>other</p>
      </Section>
    </Half>
  );
  assert.deepEqual(entries.map(({ id, label, icon, attention }) => ({ id, label, icon, attention })), [{ id: 'x-one', label: 'Snippets', icon: 'clipboard', attention: 'warn' }]);
  assert.equal(ui.$('[data-card="x-one"]').getAttribute('data-rail-section'), 'x-one', 'the id and the title come from the entry');
  assert.equal(ui.$('[data-card="x-two"]').getAttribute('data-rail-section'), null);
  assert.equal(ui.$('.ab-wk-toggle').getAttribute('aria-expanded'), 'false');
  await during(() => entries[0].open());
  assert.equal(ui.$('.ab-wk-toggle').getAttribute('aria-expanded'), 'true');
  await during(() => entries[0].open());
  assert.equal(ui.$('.ab-wk-toggle').getAttribute('aria-expanded'), 'true', 'an open section stays open');
});

test('RailCard: a card the rail lists, its own element registered, its mark on the rail only; outside a screen it registers nowhere', async () => {
  let entries = [];
  const rail = { id: 'x-card', label: () => 'My queue', icon: 'inbox' };
  const ui = await mount(
    <Half seen={(e) => (entries = e)}>
      <RailCard rail={rail} railAttention="warn" summary="2 open" defaultOpen={false}>
        <p>rows</p>
      </RailCard>
    </Half>
  );
  const card = ui.$('[data-card="x-card"]');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].el, card, 'the card\'s own section, not a wrapper or the mark');
  assert.equal(entries[0].attention, 'warn');
  assert.equal(ui.$$('.ab-cardx-warn, .ab-cardx-danger', { all: true }).length, 0, 'the card itself stays calm');
  assert.equal(card.getAttribute('aria-label'), 'My queue');
  assert.equal(ui.$('.ab-cardx-toggle').getAttribute('aria-expanded'), 'false');
  await during(() => entries[0].open());
  assert.equal(ui.$('.ab-cardx-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(ui.text(), 'My queue 2 open rows', 'nothing else to see');
  const alone = await mount(<RailCard rail={rail}>x</RailCard>);
  assert.equal(alone.errors.length, 0, alone.errors.join('\n'));
  assert.match(alone.text(), /My queue/);
});
