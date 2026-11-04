import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppView } from '../src/sidepanel/App.jsx';
import { BANNER_NOT_ON, BANNER_NOT_SERVICENOW, planPanel, withVisited } from '../src/sidepanel/sections.js';
import { effectiveSettings } from '../src/policy/policy.js';
import ScreenView from '../src/sidepanel/shell/ScreenView.jsx';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import SetupView from '../src/sidepanel/SetupView.jsx';

// The panel's routing (integration review H1, carried over to the round-3 screens): which screens exist, which one shows and what
// each is given, without a browser. What is INSIDE a screen belongs to its area and is tested there.

const IDS = ['ticket', 'mywork', 'team', 'write', 'knowledge'];
const T = 7;
const record = { status: 'record', tabId: T, href: 'https://acme.service-now.com/incident.do?sys_id=' + 'a'.repeat(32), surface: 'classic', record: { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth' } };
const list = { status: 'no-record', tabId: T, href: 'https://acme.service-now.com/home', surface: 'classic', record: null, newRecord: null, user: { name: 'Beth' } };
const off = { status: 'not-enabled', tabId: 9, origin: '' };
const loading = { status: 'loading' };
const plan = (over) => planPanel({ ids: IDS, active: 'ticket', visited: new Set(['ticket']), page: record, lastGood: record, lastSeen: record, ...over });
const paneOf = (p, id) => p.panes.find((x) => x.id === id);

test('on a record page the chosen screen shows, the visited ones are mounted and nothing else exists yet', () => {
  const p = plan({ active: 'write', visited: new Set(['ticket', 'write']) });
  assert.equal(p.enabled, true);
  assert.equal(p.visible, 'write');
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['ticket', 'write']);
  assert.deepEqual(p.panes.filter((x) => x.selected).map((x) => x.id), ['write']);
  assert.equal(p.banner, '');
  assert.equal(p.showNav, true);
  assert.equal(p.showSetup, false);
  assert.equal(p.recordPage, record);
});

test('a screen that was never opened is not mounted (nothing reads for it)', () => {
  const p = plan({ active: 'ticket', visited: new Set(['ticket']) });
  for (const id of ['mywork', 'team', 'write', 'knowledge']) assert.equal(paneOf(p, id).mounted, false, id);
});

test('H1: when the active tab is not a ServiceNow page every visited screen stays mounted, on the last good page, with a banner', () => {
  const p = plan({ page: off, active: 'write', visited: new Set(['ticket', 'write', 'knowledge']) });
  assert.equal(p.enabled, false);
  assert.equal(p.banner, BANNER_NOT_SERVICENOW);
  assert.equal(p.base, record);
  assert.equal(p.mountPage, record, 'the screens are given the last good page');
  assert.equal(p.showNav, true);
  assert.equal(p.visible, 'write');
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['ticket', 'write', 'knowledge']);
  assert.equal(p.recordPage, record, 'the ticket view is kept too');
  assert.equal(p.showSetup, true, 'the Ticket screen is about the tab that is open now: the setup help');
});

test('the banner says the right thing: a site we know but is not turned on is not "not a ServiceNow page"', () => {
  assert.equal(plan({ page: { ...off, origin: 'https://acme.service-now.com' } }).banner, BANNER_NOT_ON);
  assert.equal(plan({ page: off }).banner, BANNER_NOT_SERVICENOW);
  assert.equal(plan({ page: record }).banner, '');
  assert.equal(plan({ page: list }).banner, '');
});

test('with no page to work on there is no screen bar, only the setup help, and visited screens stay mounted (hidden)', () => {
  const p = plan({ page: off, lastGood: null, lastSeen: record, active: 'write', visited: new Set(['ticket', 'write']) });
  assert.equal(p.showNav, false);
  assert.equal(p.visible, 'ticket', 'whatever was chosen, the help shows');
  assert.equal(p.banner, '');
  assert.equal(paneOf(p, 'write').mounted, true);
  assert.equal(paneOf(p, 'write').selected, false);
  assert.equal(p.mountPage, record);
  assert.equal(p.recordPage, null, 'no ticket view without a page behind it');
});

test('before the first answer there is nothing to mount and only the setup pane exists', () => {
  const p = plan({ page: loading, lastGood: null, lastSeen: null, active: 'write', visited: new Set(['write']) });
  assert.equal(p.showNav, false);
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['ticket']);
  assert.equal(p.mountPage, null);
});

test('on a page that is not a record the Ticket screen shows the setup help and there is no ticket view', () => {
  const p = plan({ page: list, lastGood: list, lastSeen: list });
  assert.equal(p.showSetup, true);
  assert.equal(p.recordPage, null);
  assert.equal(p.showNav, true);
});

test('withVisited adds an id and hands back the same set when nothing changes', () => {
  const v = new Set(['ticket']);
  assert.equal(withVisited(v, 'ticket'), v);
  const w = withVisited(v, 'write');
  assert.notEqual(w, v);
  assert.deepEqual([...w], ['ticket', 'write']);
});

// ---- the panel drawn (first render only: effects do not run in a static render) ------------------------------------------------

const effFor = (values = {}, policy = {}) => {
  const e = effectiveSettings({ provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it', 'lead'], ...values }, policy);
  return { ready: true, ...e, apiKey: 'sk-ant-test', keyLocked: false };
};
const eff = effFor();
// (PendingDraft listens to a store with useSyncExternalStore, which a static render cannot do: it is left out here.)
const draw = (props, e = eff) => renderToStaticMarkup(React.createElement(AppView, { eff: e, onChoose() {}, onChanged() {}, Pending: () => null, ...props }));
const hiddenPanes = (markup, ids = IDS) => ids.filter((id) => new RegExp(`<div id="ab-sec-panel-${id}"[^>]*\\shidden=""`).test(markup));
const screenTabs = (markup) => [...markup.matchAll(/id="ab-sec-tab-([a-z]+)"/g)].map((m) => m[1]);

test('drawn on a record page: the screens for the profiles, one panel each, only the chosen one visible', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record, section: 'write', visited: new Set(['ticket', 'write']) });
  assert.match(markup, /<nav[^>]*role="tablist"[^>]*aria-label="Agent Buddy screens"/);
  assert.deepEqual(screenTabs(markup), IDS);
  assert.equal((markup.match(/id="ab-sec-panel-/g) || []).length, 5);
  assert.deepEqual(hiddenPanes(markup), ['ticket', 'mywork', 'team', 'knowledge']);
  assert.match(markup, /id="ab-sec-tab-write"[^>]*aria-selected="true"/);
  assert.ok(markup.includes('id="ab-write-half-panel-insights"'), 'the Write screen is mounted');
  assert.ok(markup.includes('INC0010001'), 'the ticket view of the visited Ticket screen is mounted (hidden)');
  assert.ok(!markup.includes('id="ab-knowledge-half-panel-insights"'), 'a screen never opened is not mounted');
});

test('the header is quiet: name, the instance, the shield and settings; no footer sentence, no model picker', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket']) });
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  assert.match(header, /Agent Buddy/);
  assert.match(header, /class="ab-instance"[^>]*>acme</);
  assert.match(header, /aria-label="Settings"/);
  assert.match(header, /class="ab-shield"/);
  assert.ok(!header.includes('<select'), 'no model picker in the header');
  assert.ok(!markup.includes('ab-footer'), 'no footer sentence');
});

test('profiles decide the screens: Team only for team leads; policy hides screens, never the Ticket screen', () => {
  const it = draw({ page: record, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket']) }, effFor({ profiles: ['it'] }));
  assert.deepEqual(screenTabs(it), ['ticket', 'mywork', 'write', 'knowledge']);
  const hidden = draw({ page: record, lastGood: record, lastSeen: record, section: 'team', visited: new Set(['ticket', 'team']) }, effFor({}, { disabledSections: ['team', 'write'] }));
  assert.deepEqual(screenTabs(hidden), ['ticket', 'mywork', 'knowledge']);
  assert.match(hidden, /id="ab-sec-tab-ticket"[^>]*aria-selected="true"/, 'a hidden screen that was chosen falls back to Ticket');
});

test('the Ticket screen has the Insights / AI Assist switch; with AI switched off by policy there is no switch and no AI half', () => {
  const on = draw({ page: record, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket']) });
  assert.match(on, /role="tablist" aria-label="Insights or AI Assist"/);
  assert.ok(on.includes('id="ab-ticket-half-panel-insights"') && on.includes('id="ab-ticket-half-panel-assist"'));
  assert.match(on, /Stays in ServiceNow\. Nothing is sent anywhere\./);
  const offAi = draw({ page: record, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket']) }, effFor({}, { aiEnabled: false }));
  assert.ok(!offAi.includes('aria-label="Insights or AI Assist"'));
  assert.ok(!offAi.includes('id="ab-ticket-half-panel-assist"'));
  assert.ok(offAi.includes('id="ab-ticket-half-panel-insights"'));
});

test('drawn when the tab stops being a ServiceNow page: banner, screen bar, Write and the ticket view still in the page', () => {
  const markup = draw({ page: off, lastGood: record, lastSeen: record, section: 'write', visited: new Set(['ticket', 'write']) });
  assert.match(markup, /This tab is not a ServiceNow page\./);
  assert.ok(markup.includes('aria-label="Agent Buddy screens"'));
  assert.ok(markup.includes('id="ab-write-half-panel-insights"'), 'the Write screen is still there: what was typed in it survives');
  assert.ok(markup.includes('INC0010001'), 'and so is the ticket view');
  assert.deepEqual(hiddenPanes(markup), ['ticket', 'mywork', 'team', 'knowledge']);
  assert.ok(!markup.includes('Not turned on for this page'), 'the setup help is only drawn when the Ticket screen shows');
});

test('drawn on the Ticket screen of such a tab: the setup help shows and the ticket view is kept hidden', () => {
  const markup = draw({ page: off, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket', 'write']) });
  assert.match(markup, /This tab is not a ServiceNow page\./);
  assert.match(markup, /<div class="ab-pane" hidden="">[\s\S]*INC0010001/);
  assert.deepEqual(hiddenPanes(markup), ['mywork', 'team', 'write', 'knowledge']);
});

test('drawn with no page to work on: no screen bar, the setup help, the visited Write screen kept hidden', () => {
  const markup = draw({ page: off, lastGood: null, lastSeen: record, section: 'write', visited: new Set(['ticket', 'write']) });
  assert.ok(!markup.includes('aria-label="Agent Buddy screens"'), 'no screen bar');
  assert.ok(!/role="tabpanel"[^>]*id="ab-sec-panel|id="ab-sec-panel-[a-z]+"[^>]*role="tabpanel"/.test(markup), 'no screen bar, so the panes are not tab panels');
  assert.ok(markup.includes('id="ab-write-half-panel-insights"'));
});

test('a held page (a page that is reloading) draws exactly like the live one, with no banner', () => {
  const markup = draw({ page: { ...record }, lastGood: record, lastSeen: record, section: 'ticket', visited: new Set(['ticket']) });
  assert.ok(!/ab-note ab-note-warn" role="status">This tab/.test(markup));
  assert.match(markup, /INC0010001/);
});

// ---- the proof that what was typed survives: each screen keeps its place in the element tree --------------------------------------
//
// React keeps a component's state (the Rewrite text, a search, the answers) as long as the component is rendered at the same place in
// the tree, with the same type and key, from one render to the next. Without a browser the closest thing to proving "the typed text
// survives" is to prove exactly that: build the panel's element tree for the states the person goes through and check that every
// screen and the ticket view always sit at the same path. (AppView only uses useRef, so it can be called with a stub for it.)

const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
const treeOf = (props) => {
  const slot = internals.ReactCurrentDispatcher;
  const before = slot.current;
  slot.current = { useRef: (value) => ({ current: value }) };
  try {
    return AppView({ eff, onChoose() {}, onChanged() {}, Pending: () => null, ...props });
  } finally {
    slot.current = before;
  }
};
const nameOf = (type) => (typeof type === 'string' ? type : type.displayName || type.name || 'Anonymous');
function pathTo(node, match, path = []) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const found = pathTo(node[i], match, [...path, `[${i}]`]);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const here = [...path, `${nameOf(node.type)}${node.key === null ? '' : `#${node.key}`}`];
  return match(node) ? here.join(' > ') : pathTo(node.props.children, match, here);
}
const where = (props, match) => pathTo(treeOf(props), match);
const screen = (id) => (el) => el.type === ScreenView && el.props.screen === id;

test('H1: the panel is built so that every screen and the ticket view never move while the page changes under them', () => {
  const visited = new Set(['ticket', 'write', 'knowledge']);
  const states = {
    'a record page, Write on show': { page: record, lastGood: record, lastSeen: record, section: 'write' },
    'a record page, Knowledge on show': { page: record, lastGood: record, lastSeen: record, section: 'knowledge' },
    'the same page, held through a missing answer': { page: { ...record }, lastGood: record, lastSeen: record, section: 'write' },
    'the tab became a wiki page (not enabled)': { page: off, lastGood: record, lastSeen: record, section: 'write' },
    'the wiki page, the Ticket screen on show': { page: off, lastGood: record, lastSeen: record, section: 'ticket' },
    'the ServiceNow tab was closed': { page: off, lastGood: null, lastSeen: record, section: 'write' },
    'a list page of the instance (enabled, no record)': { page: list, lastGood: list, lastSeen: list, section: 'write' },
  };
  for (const id of ['write', 'knowledge']) {
    const found = Object.fromEntries(Object.entries(states).map(([name, s]) => [name, where({ ...s, visited }, screen(id))]));
    for (const [name, path] of Object.entries(found)) assert.ok(path, `${id} is drawn: ${name}`);
    assert.equal(new Set(Object.values(found)).size, 1, `${id} keeps one place in the tree:\n${JSON.stringify(found, null, 1)}`);
  }
  // The ticket view keeps its place while the tab is not a ServiceNow page; it goes only when the page is a list (as before).
  const keep = ['a record page, Write on show', 'the same page, held through a missing answer', 'the tab became a wiki page (not enabled)', 'the wiki page, the Ticket screen on show'];
  const ticket = Object.fromEntries(Object.entries(states).map(([name, s]) => [name, where({ ...s, visited }, (el) => el.type === TicketView)]));
  assert.equal(new Set(keep.map((k) => ticket[k])).size, 1, JSON.stringify(ticket, null, 1));
  assert.ok(ticket[keep[0]]);
  assert.equal(ticket['a list page of the instance (enabled, no record)'], null);
  // The setup help is a different thing in a different place: it never takes the place of a screen.
  const s = { ...states['the wiki page, the Ticket screen on show'], visited };
  assert.notEqual(where(s, (el) => el.type === SetupView), where(s, screen('write')));
});
