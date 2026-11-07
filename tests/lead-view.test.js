import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamInsights } from '../src/sidepanel/team/index.js';
import { resetTeamShares } from '../src/sidepanel/team/teamShare.js';
import { AttentionBody, attentionCount, attentionFacts } from '../src/sidepanel/reports/AttentionView.jsx';
import { REPORT_SECTIONS, sectionById } from '../src/sidepanel/reports/sections.js';
import { DASHBOARD_SECTIONS, widgetRail } from '../src/sidepanel/reports/railSections.js';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { composeAttention, ATTENTION_REASONS } from '../src/reports/engine/attention.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { catalogueOf, registerCatalogue, setLanguage, t, tn } from '../src/i18n/index.js';
import { AR } from '../src/i18n/ar/index.js';
import { AR_LEAD } from '../src/i18n/ar/lead.js';
import { handoverWorld, USER, NOW, GROUP_A } from './reports-ai-fixtures.js';

// Needs attention now as a person sees it: the rows and their words, each ticket a link that opens in a NEW tab, the honest lines, the
// Arabic, and the Team screen itself with the section first and every fold closed.

const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const text = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const id = (n) => String(n).padStart(32, '0');
const classic = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic' };

const item = (n, facts = {}, extra = {}) => ({ sysId: id(n), table: 'incident', number: `INC00${n}`, title: `Printer ${n} is jammed`, priority: '2 - High', owner: 'Ann Lee', group: 'Service Desk', facts, ...extra });
const src = (items = [], extra = {}) => ({ ok: true, population: items.length, atLeast: false, listedAll: true, items, ...extra });
const sources = (over = {}) => ({ ...Object.fromEntries(ATTENTION_REASONS.map((r) => [r, src()])), ...over });
const slaFacts = (breached) => ({ breached, percent: breached ? 130 : 88, plannedEnd: '2026-10-27 15:00:00', endMs: NOW - 2 * 3600000, paused: false });

const dataOf = (over, options) => composeAttention(sources(over), options);
const render = (d, env = { page: classic }) => html(h(AttentionBody, { d, env, now: NOW }));

// ---- the rows ---------------------------------------------------------------------------------------------------------------------

test('each row: the number as a link, the title, ONE reason chip, then when, who and how urgent', () => {
  const d = dataOf({
    breached: src([item(1, slaFacts(true))]),
    closest: src([item(2, slaFacts(false))]),
    approval: src([item(3, { ageDays: 7, state: 'Awaiting Approval' })]),
    reassigned: src([item(4, { n: 5 })]),
    oldest: src([item(5, { ageDays: 41 })]),
    customer: src([item(6, { ageDays: 9, state: 'Awaiting Caller' })]),
  });
  const markup = render(d);
  const chips = [...markup.matchAll(/<span class="ab-chip ab-chip-(\w+)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(chips, [['danger', 'Breached'], ['warn', 'Closest to breaking'], ['neutral', 'Waiting for approval'], ['warn', 'Reassigned 5 times'], ['neutral', 'Oldest open'], ['neutral', 'Customer waiting']]);
  assert.equal(chips.length, d.rows.length, 'one chip per ticket');
  const rows = markup.split('<li ').slice(1).map((r) => text(r.replace(/^[^>]*>/, '')));
  assert.match(rows[0], /^INC001 Printer 1 is jammed Breached Breached 2 h ago · Ann Lee · 2 - High$/);
  assert.match(rows[1], /Closest to breaking Overdue by 2 h · 88% used · Ann Lee/);
  assert.match(rows[2], /Waiting for approval Open 7 days · Ann Lee/);
  assert.match(rows[3], /Reassigned 5 times Ann Lee/);
  assert.match(rows[4], /Oldest open 41 days old/);
  assert.match(rows[5], /Customer waiting Open 9 days/);
  // plain words, in one place: no table, no column, no id, no code
  assert.ok(!/sys_id|task_sla|_list|\bHTTP\b|\b40\d\b|\bincident\b/.test(text(markup)), text(markup));
});

test('a ticket with several reasons is one row with a short count of the others', () => {
  const d = dataOf({ breached: src([item(1, slaFacts(true))]), reassigned: src([item(1, { n: 4 })]), oldest: src([item(1, { ageDays: 20 })]) });
  const markup = render(d);
  assert.equal(d.rows.length, 1);
  assert.equal(markup.split('<li ').length - 1, 1);
  assert.match(text(markup), /Breached 2 h ago · Ann Lee · 2 - High · \+2 more reasons/);
  assert.equal(attentionFacts({ ...d.rows[0], more: 1 }, NOW).at(-1), '+1 more reason');
});

test('a person nobody can name, or one this user may not see, is said as such', () => {
  const nobody = dataOf({ breached: src([item(1, slaFacts(true), { owner: '' })]) });
  assert.match(text(render(nobody)), /Ann Lee|Unassigned/);
  assert.match(text(render(nobody)), /Unassigned/);
  const hidden = dataOf({ breached: src([item(1, slaFacts(true), { owner: 'Not shown to you' })]) });
  assert.match(text(render(hidden)), /Not shown to you/);
  assert.ok(!/Unassigned/.test(text(render(hidden))));
});

// ---- the link: look at it, in a new tab -------------------------------------------------------------------------------------------------

test('each ticket is a real link that opens in a new tab, on the classic UI, a Workspace and a portal', () => {
  const d = dataOf({ breached: src([item(1, slaFacts(true))]) });
  const link = (page) => /<a ([^>]*)>INC001<\/a>/.exec(render(d, { page }))?.[1] || '';
  const classicLink = link(classic);
  assert.match(classicLink, /href="https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=incident\.do%3Fsys_id%3D0{31}1"/);
  assert.match(classicLink, /target="_blank"/);
  assert.match(classicLink, /rel="noopener noreferrer"/);
  assert.match(classicLink, /data-ab-link="record"/);
  const workspace = link({ tabId: 7, href: `https://acme.service-now.com/now/sow/record/incident/${id(8)}`, surface: 'workspace' });
  assert.match(workspace, /href="https:\/\/acme\.service-now\.com\/now\/sow\/record\/incident\/0{31}1"/);
  const portal = link({ tabId: 7, href: 'https://acme.service-now.com/esc?id=home', surface: 'portal', portal: { base: '/esc' } });
  assert.match(portal, /href="https:\/\/acme\.service-now\.com\/esc\?id=ticket&amp;table=incident&amp;sys_id=0{31}1"/);
  // an address that cannot be built safely is text, not a link
  assert.ok(!/<a /.test(render(d, { page: { tabId: 1, href: 'http://insecure.example/nav_to.do', surface: 'classic' } })));
  assert.ok(!/<a /.test(render(d, {})));
});

// ---- honest: what it says about what it could not read ------------------------------------------------------------------------------

test('"Nothing needs attention" only when every source was read; otherwise the line about what could not be read', () => {
  const calm = render(dataOf({}));
  assert.match(text(calm), /Nothing needs attention right now\./);
  assert.ok(!/Based on what you can see/.test(calm));
  assert.ok(!/ab-chip/.test(calm));

  const blind = render(dataOf({ breached: { ok: false, population: null, atLeast: false, listedAll: false, items: [] }, closest: { ok: false, population: null, atLeast: false, listedAll: false, items: [] } }));
  assert.ok(!/Nothing needs attention/.test(blind), 'a source that could not be read is not a quiet day');
  assert.match(text(blind), /Based on what you can see; some data could not be read\./);
  assert.match(text(blind), /No ticket stands out in what could be read\./);

  const some = render(dataOf({ breached: src([item(1, slaFacts(true))]), reassigned: { ok: false, population: null, atLeast: false, listedAll: false, items: [] } }));
  assert.match(text(some), /Based on what you can see; some data could not be read\./);
  assert.match(some, /ab-chip/, 'and the rest is still shown');

  // a count that is only a lower bound (the SLA read stopped early) is the same kind of line
  assert.match(text(render(dataOf({ breached: src([item(1, slaFacts(true))], { atLeast: true }) }))), /some data could not be read/);
});

test('how many there are: exact, "at least", or nothing to say when the rows are all of them', () => {
  const nine = Array.from({ length: 9 }, (_, i) => item(i + 1, slaFacts(true)));
  const exact = dataOf({ breached: src(nine) });
  assert.equal(attentionCount(exact), 'Showing 8 of 9.');
  assert.match(text(render(exact)), /Showing 8 of 9\./);
  const atLeast = dataOf({ breached: src(nine.slice(0, 3), { population: 20, listedAll: false }) });
  assert.equal(atLeast.total, 20);
  assert.equal(attentionCount(atLeast), 'Showing 3 of at least 20.');
  assert.equal(attentionCount(dataOf({ breached: src(nine.slice(0, 2)) })), '');
});

test('hostile text in a title is inert', () => {
  const d = dataOf({ breached: src([item(1, slaFacts(true), { title: '<img src=x onerror=alert(1)> <script>alert(1)</script>' })]) });
  const markup = render(d);
  assert.ok(!/<(img|script)\b/i.test(markup));
  assert.ok(!/\son[a-z]+="/i.test(markup));
  assert.ok(!/\sstyle="/.test(markup), 'no inline style (the extension\'s CSP)');
  assert.match(markup, /&lt;img src=x/);
});

// ---- the registry, the rail and Arabic ----------------------------------------------------------------------------------------------------

test('it is a section of the registry (first, so Customize offers it) and has its rail entry', () => {
  assert.equal(REPORT_SECTIONS[0].id, 'attention');
  assert.equal(sectionById('attention').label, 'Needs attention now');
  assert.equal(typeof sectionById('attention').View, 'function');
  assert.ok(sectionById('attention').description.length > 20);
  assert.deepEqual(widgetRail({ id: 'w-1', type: 'section', section: 'attention' }), { id: 'w-1', label: 'Needs attention now', icon: 'alert' });
  assert.equal(DASHBOARD_SECTIONS.attention.icon, 'alert');
});

test('every new text has its Arabic with the same {names}, and the plurals have all six forms', () => {
  const names = (s) => [...String(s).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [key, value] of Object.entries(AR_LEAD)) {
    const english = key.split('|')[0];
    if (typeof value === 'string') {
      assert.equal(names(value), names(english), key);
      assert.ok(/[؀-ۿ]/.test(value), key);
    } else {
      assert.deepEqual(Object.keys(value).sort(), ['few', 'many', 'one', 'other', 'two', 'zero'], key);
      for (const form of Object.values(value)) assert.equal(names(form), names(english), key);
    }
    // (a key defined in two Arabic files is caught by tests/i18n.test.js; this file is wired into src/i18n/ar/index.js)
  }
});

test('in Arabic the section reads in Arabic: reasons, honest lines, counts and the folds', () => {
  registerCatalogue('ar', { ...AR, ...AR_LEAD });
  setLanguage('ar');
  try {
    const d = dataOf({ breached: src([item(1, slaFacts(true))]), approval: src([item(3, { ageDays: 7 })]), reassigned: src([item(4, { n: 5 })]), customer: { ok: false, population: null, atLeast: false, listedAll: false, items: [] } }, { limit: 8 });
    const markup = text(render(d));
    for (const english of ['Breached', 'Waiting for approval', 'Reassigned 5 times', 'Based on what you can see; some data could not be read.']) assert.ok(!markup.includes(english), `${english} is still English`);
    assert.match(markup, /بانتظار موافقة/);
    assert.match(markup, /بناء على ما يظهر لك/);
    assert.equal(t('Needs attention now'), 'يحتاج إلى اهتمام الآن');
    assert.equal(tn(2, '+{n} more reason', '+{n} more reasons'), '+2 سببان آخران');
    assert.equal(t('Open work by person and group'), 'العمل المفتوح حسب الشخص والمجموعة');
    // every single text of the file answers in Arabic (the plurals are checked above and through tn)
    for (const key of Object.keys(AR_LEAD)) if (!key.includes('|')) assert.notEqual(t(key), key, key);
    assert.ok(catalogueOf('ar')['Waiting for approval']);
  } finally {
    setLanguage('en');
  }
});

// ---- the Team screen ----------------------------------------------------------------------------------------------------------------------

const eff = () => ({ ready: true, apiKey: 'sk-test', values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it', 'lead'] }, locked: {}, policy: normalizePolicy({}) });
const CONTEXT = {
  user: { name: 'Beth Anglin' },
  tables: [{ table: 'incident', label: 'Incidents', status: 'ok', note: '', usable: true }, { table: 'sc_req_item', label: 'Requested items', status: 'ok', note: '', usable: true }],
  groups: [{ id: GROUP_A, name: 'Service Desk' }],
  groupsTotal: 1,
  groupsNote: '',
  zone: { id: 'UTC', source: 'servicenow', note: '' },
  readAt: NOW,
};
const mounted = [];
test.afterEach(async () => {
  while (mounted.length) {
    try {
      await mounted.pop().unmount();
    } catch {
      /* already gone */
    }
  }
});

function teamWorld() {
  resetTeamShares();
  const fake = makeChrome();
  const created = [];
  fake.chrome.tabs.create = (props) => {
    created.push(props);
    return Promise.resolve({ id: 99 });
  };
  fake.chrome.tabs.get = async () => ({ id: 7, index: 3, windowId: 1 });
  globalThis.chrome = fake.chrome;
  const inst = handoverWorld();
  const runtime = createRuntime();
  fake.onRead('reportContext', () => CONTEXT);
  fake.onRead('reportClear', () => ({ ok: true }));
  fake.onRead('reportRun', (args) => runReport({ kind: args.kind, section: args.section, scope: args.scope, tables: args.tables, params: args.params || {} }, { deps: inst.deps, userId: USER, runtime, now: NOW, offsetMin: 0 }));
  return { fake, created };
}

test('the Team screen: Needs attention now is first, the fold lines are closed, and a click on a ticket opens a new tab and leaves the ServiceNow tab where it is', async () => {
  const { fake, created } = teamWorld();
  const ui = await mount(<TeamInsights page={classic} eff={eff()} active />);
  mounted.push(ui);
  await settle(16);
  const widgets = ui.$$('section.ab-widget', { all: true });
  assert.equal(widgets[0].getAttribute('aria-label'), 'Needs attention now', widgets.map((w) => w.getAttribute('aria-label')).join(' | '));
  assert.deepEqual(widgets.map((w) => w.getAttribute('aria-label')).slice(0, 3), ['Needs attention now', 'Overview', 'Workload and ageing']);
  assert.equal(widgets[0].getAttribute('data-state'), 'ready');

  // the fold lines: every one closed, each with its own title
  const folds = ui.$$('details[data-fold]', { all: true });
  assert.ok(folds.length >= 4, `${folds.length} folds`);
  assert.ok(folds.every((f) => !f.hasAttribute('open')), 'closed when the screen is first shown');
  const titles = folds.map((f) => f.querySelector('summary').textContent.trim());
  for (const wanted of ['Ageing of open work', 'Tickets reassigned 3+ times', 'Quality measures']) assert.ok(titles.includes(wanted), `${wanted} in ${titles.join(' | ')}`);
  // and the section reads from the others: one more read of the Team screen, no new kind of read
  assert.ok(fake.readsOf('reportRun').some((a) => a.section === 'attention'));
  assert.ok(fake.readsOf('reportRun').every((a) => ['attention', 'overview', 'workload', 'sla', 'quality', 'fulfilment'].includes(a.section)));

  // a click on a ticket: a new tab next to the one it came from; the ServiceNow tab is not navigated
  const links = widgets[0].querySelectorAll('a[data-ab-link="record"]');
  assert.ok(links.length >= 1, 'the rows are links');
  assert.equal(links[0].getAttribute('target'), '_blank');
  await click(links[0]);
  assert.equal(created.length, 1);
  assert.match(created[0].url, /^https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=incident\.do/);
  assert.equal(created[0].active, true);
  assert.equal(created[0].index, 4, 'right after the ServiceNow tab');
  assert.equal(fake.updates.length, 0, 'the tab the person works in is not replaced');
  await ui.unmount();
});

test('printing: the folded parts are opened for the print and closed again after, and a part the person opened stays open', async () => {
  const listeners = new Map();
  const had = { add: window.addEventListener, drop: window.removeEventListener };
  window.addEventListener = (type, fn) => listeners.set(type, fn);
  window.removeEventListener = (type) => listeners.delete(type);
  try {
    teamWorld();
    const ui = await mount(<TeamInsights page={classic} eff={eff()} active />);
    mounted.push(ui);
    await settle(16);
    const folds = () => ui.$$('details[data-fold]', { all: true });
    assert.ok(folds().length >= 4);
    assert.ok(folds().every((f) => !f.hasAttribute('open')));
    folds()[0].setAttribute('open', ''); // the person opens one (the browser does this on a tap; the test DOM does not)
    assert.ok(folds()[0].hasAttribute('open'));
    assert.ok(listeners.has('beforeprint') && listeners.has('afterprint'));
    listeners.get('beforeprint')();
    assert.ok(folds().every((f) => f.hasAttribute('open')), 'everything is in the print');
    listeners.get('afterprint')();
    assert.ok(folds()[0].hasAttribute('open'), 'the one the person opened stays open');
    assert.ok(folds().slice(1).every((f) => !f.hasAttribute('open')), 'the others are closed again');
    await ui.unmount();
    assert.equal(listeners.size, 0, 'and the listeners go with the screen');
  } finally {
    window.addEventListener = had.add;
    window.removeEventListener = had.drop;
  }
});
