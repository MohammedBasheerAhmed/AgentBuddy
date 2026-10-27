import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppView } from '../src/sidepanel/App.jsx';
import { BANNER_NOT_ON, BANNER_NOT_SERVICENOW, planPanel, withVisited } from '../src/sidepanel/sections.js';
import { normalizePolicy } from '../src/policy/policy.js';
import ComposeView from '../src/sidepanel/tabs/ComposeView.jsx';
import KnowledgeToolsView from '../src/sidepanel/tabs/KnowledgeToolsView.jsx';
import RecordView from '../src/sidepanel/RecordView.jsx';
import SetupView from '../src/sidepanel/SetupView.jsx';

// The use of JSX in shared components without an import: the build uses the automatic runtime, this bundle the classic one.
globalThis.React = React;

// Integration review H1: the panel's routing. Which sections exist, which one shows and what each is given, without a browser.

const IDS = ['page', 'myday', 'team', 'write', 'kb'];
const T = 7;
const record = { status: 'record', tabId: T, href: 'https://acme.service-now.com/incident.do?sys_id=' + 'a'.repeat(32), surface: 'classic', record: { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth' } };
const list = { status: 'no-record', tabId: T, href: 'https://acme.service-now.com/home', surface: 'classic', record: null, newRecord: null, user: { name: 'Beth' } };
const off = { status: 'not-enabled', tabId: 9, origin: '' };
const loading = { status: 'loading' };
const plan = (over) => planPanel({ ids: IDS, active: 'page', visited: new Set(['page']), page: record, lastGood: record, lastSeen: record, ...over });
const paneOf = (p, id) => p.panes.find((x) => x.id === id);

test('on a record page the chosen section shows, the visited ones are mounted and nothing else exists yet', () => {
  const p = plan({ active: 'write', visited: new Set(['page', 'write']) });
  assert.equal(p.enabled, true);
  assert.equal(p.visible, 'write');
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['page', 'write']);
  assert.deepEqual(p.panes.filter((x) => x.selected).map((x) => x.id), ['write']);
  assert.equal(p.banner, '');
  assert.equal(p.showNav, true);
  assert.equal(p.showSetup, false);
  assert.equal(p.recordPage, record);
});

test('a section that was never opened is not mounted (nothing reads for it)', () => {
  const p = plan({ active: 'page', visited: new Set(['page']) });
  for (const id of ['myday', 'team', 'write', 'kb']) assert.equal(paneOf(p, id).mounted, false, id);
});

test('H1: when the active tab is not a ServiceNow page every visited section stays mounted, on the last good page, with a banner', () => {
  const p = plan({ page: off, active: 'write', visited: new Set(['page', 'write', 'kb']) });
  assert.equal(p.enabled, false);
  assert.equal(p.banner, BANNER_NOT_SERVICENOW);
  assert.equal(p.base, record);
  assert.equal(p.mountPage, record, 'the sections are given the last good page');
  assert.equal(p.showNav, true);
  assert.equal(p.visible, 'write');
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['page', 'write', 'kb']);
  assert.equal(p.recordPage, record, 'the record view is kept too');
  assert.equal(p.showSetup, true, '"This page" is about the tab that is open now: the setup help');
});

test('the banner says the right thing: a site we know but is not turned on is not "not a ServiceNow page"', () => {
  assert.equal(plan({ page: { ...off, origin: 'https://acme.service-now.com' } }).banner, BANNER_NOT_ON);
  assert.equal(plan({ page: off }).banner, BANNER_NOT_SERVICENOW);
  assert.equal(plan({ page: record }).banner, '');
  assert.equal(plan({ page: list }).banner, '');
});

test('with no page to work on there is no section bar, only the setup help, and visited sections stay mounted (hidden)', () => {
  const p = plan({ page: off, lastGood: null, lastSeen: record, active: 'write', visited: new Set(['page', 'write']) });
  assert.equal(p.showNav, false);
  assert.equal(p.visible, 'page', 'whatever was chosen, the help shows');
  assert.equal(p.banner, '');
  assert.equal(paneOf(p, 'write').mounted, true);
  assert.equal(paneOf(p, 'write').selected, false);
  assert.equal(p.mountPage, record);
  assert.equal(p.recordPage, null, 'no record view without a page behind it');
});

test('before the first answer there is nothing to mount and only the setup pane exists', () => {
  const p = plan({ page: loading, lastGood: null, lastSeen: null, active: 'write', visited: new Set(['write']) });
  assert.equal(p.showNav, false);
  assert.deepEqual(p.panes.filter((x) => x.mounted).map((x) => x.id), ['page']);
  assert.equal(p.mountPage, null);
});

test('on a page that is not a record "This page" shows the setup help and there is no record view', () => {
  const p = plan({ page: list, lastGood: list, lastSeen: list });
  assert.equal(p.showSetup, true);
  assert.equal(p.recordPage, null);
  assert.equal(p.showNav, true);
});

test('withVisited adds an id and hands back the same set when nothing changes', () => {
  const v = new Set(['page']);
  assert.equal(withVisited(v, 'page'), v);
  const w = withVisited(v, 'write');
  assert.notEqual(w, v);
  assert.deepEqual([...w], ['page', 'write']);
});

// ---- the panel drawn (first render only: effects do not run in a static render) ------------------------------------------------

const eff = {
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {} },
  locked: {},
  policy: normalizePolicy({}),
  apiKey: 'sk-ant-test',
  keyLocked: false,
};
// (PendingDraft listens to a store with useSyncExternalStore, which a static render cannot do: it is left out here.)
const draw = (props) => renderToStaticMarkup(React.createElement(AppView, { eff, onChoose() {}, onChanged() {}, Pending: () => null, ...props }));
const paneMarkup = (markup, id) => {
  const start = markup.indexOf(`id="ab-sec-panel-${id}"`);
  assert.ok(start >= 0, `pane ${id} exists`);
  const open = markup.lastIndexOf('<div', start);
  return markup.slice(open, markup.indexOf('</main>', start));
};
const hiddenPanes = (markup) => IDS.filter((id) => new RegExp(`<div id="ab-sec-panel-${id}"[^>]*\\shidden=""`).test(markup));

test('drawn on a record page: five tabs, five panels, only the chosen one visible', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record, section: 'write', visited: new Set(['page', 'write']) });
  assert.equal((markup.match(/role="tab"/g) || []).length, 5 + 3 + 4, 'the five sections, the three tabs of an incident, the four Write tools');
  assert.match(markup, /<div[^>]*role="tablist"[^>]*aria-label="Agent Buddy sections"/);
  assert.equal((markup.match(/id="ab-sec-panel-/g) || []).length, 5);
  assert.deepEqual(hiddenPanes(markup), ['page', 'myday', 'team', 'kb']);
  assert.match(markup, /id="ab-sec-tab-write"[^>]*aria-selected="true"/);
  assert.ok(markup.includes('id="ab-rewrite-text"'), 'the Write section is mounted');
  assert.ok(markup.includes('INC0010001'), 'the record view of the visited "This page" is mounted (hidden)');
  assert.ok(!markup.includes('Find near-duplicate'), 'a section never opened is not mounted');
});

test('drawn when the tab stops being a ServiceNow page: banner, section bar, Write and the record view still in the page', () => {
  const markup = draw({ page: off, lastGood: record, lastSeen: record, section: 'write', visited: new Set(['page', 'write']) });
  assert.match(markup, /This tab is not a ServiceNow page\./);
  assert.ok(markup.includes('role="tablist"'));
  assert.ok(markup.includes('id="ab-rewrite-text"'), 'the Rewrite box is still there: what was typed in it survives');
  assert.ok(markup.includes('INC0010001'), 'and so is the record view');
  assert.deepEqual(hiddenPanes(markup), ['page', 'myday', 'team', 'kb']);
  assert.ok(!markup.includes('Not turned on for this page'), 'the setup help is only drawn when "This page" shows');
});

test('drawn on "This page" of such a tab: the setup help shows and the record view is kept hidden', () => {
  const markup = draw({ page: off, lastGood: record, lastSeen: record, section: 'page', visited: new Set(['page', 'write']) });
  assert.match(markup, /This tab is not a ServiceNow page\./);
  assert.match(markup, /Not turned on for this page/);
  assert.match(markup, /<div class="ab-pane" hidden="">[\s\S]*INC0010001/);
  assert.deepEqual(hiddenPanes(markup), ['myday', 'team', 'write', 'kb']);
});

test('drawn with no page to work on: no section bar, the setup help, the visited Write section kept hidden', () => {
  const markup = draw({ page: off, lastGood: null, lastSeen: record, section: 'write', visited: new Set(['page', 'write']) });
  assert.ok(!markup.includes('aria-label="Agent Buddy sections"'), 'no section bar');
  assert.ok(!/id="ab-sec-panel-[a-z]+"[^>]*role="tabpanel"|role="tabpanel"[^>]*id="ab-sec-panel/.test(markup), 'no section bar, so the panes are not tab panels');
  assert.match(markup, /Open your ServiceNow instance in this tab/);
  assert.match(paneMarkup(markup, 'write'), /^<div[^>]*hidden=""/);
  assert.ok(markup.includes('id="ab-rewrite-text"'));
});

test('a held page (a page that is reloading) draws exactly like the live one, with no banner', () => {
  const markup = draw({ page: { ...record }, lastGood: record, lastSeen: record, section: 'page', visited: new Set(['page']) });
  assert.ok(!/ab-note ab-note-warn" role="status">This tab/.test(markup));
  assert.match(markup, /INC0010001/);
});

// ---- the proof that what was typed survives: the Write section keeps its place in the element tree -------------------------------
//
// React keeps a component's state (the Rewrite text, the email draft, the Duplicates results) as long as the component is rendered
// at the same place in the tree, with the same type and key, from one render to the next. Without a browser (no jsdom here) the
// closest thing to proving "the typed text survives" is to prove exactly that: build the panel's element tree for the states the
// person goes through and check that ComposeView, KnowledgeToolsView and the record view always sit at the same path. (AppView only
// uses useRef, so it can be called directly with a stub for it.)

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
const where = (props, View) => pathTo(treeOf(props), (el) => el.type === View);

test('H1: the panel is built so that ComposeView, KnowledgeToolsView and the record view never move while the page changes under them', () => {
  const visited = new Set(['page', 'write', 'kb']);
  const states = {
    'a record page, Write on show': { page: record, lastGood: record, lastSeen: record, section: 'write' },
    'a record page, Knowledge on show': { page: record, lastGood: record, lastSeen: record, section: 'kb' },
    'the same page, held through a missing answer': { page: { ...record }, lastGood: record, lastSeen: record, section: 'write' },
    'the tab became a wiki page (not enabled)': { page: off, lastGood: record, lastSeen: record, section: 'write' },
    'the wiki page, "This page" on show': { page: off, lastGood: record, lastSeen: record, section: 'page' },
    'the ServiceNow tab was closed': { page: off, lastGood: null, lastSeen: record, section: 'write' },
    'a list page of the instance (enabled, no record)': { page: list, lastGood: list, lastSeen: list, section: 'write' },
  };
  const paths = (View) => Object.fromEntries(Object.entries(states).map(([name, s]) => [name, where({ ...s, visited }, View)]));
  for (const View of [ComposeView, KnowledgeToolsView]) {
    const found = paths(View);
    for (const [name, path] of Object.entries(found)) assert.ok(path, `${nameOf(View)} is drawn: ${name}`);
    assert.equal(new Set(Object.values(found)).size, 1, `${nameOf(View)} keeps one place in the tree:\n${JSON.stringify(found, null, 1)}`);
  }
  // The record view keeps its place while the tab is not a ServiceNow page; it goes only when the page is a list (as before).
  const keep = ['a record page, Write on show', 'the same page, held through a missing answer', 'the tab became a wiki page (not enabled)', 'the wiki page, "This page" on show'];
  const record_ = Object.fromEntries(Object.entries(states).map(([name, s]) => [name, where({ ...s, visited }, RecordView)]));
  assert.equal(new Set(keep.map((k) => record_[k])).size, 1, JSON.stringify(record_, null, 1));
  assert.ok(record_[keep[0]]);
  assert.equal(record_['a list page of the instance (enabled, no record)'], null);
  // The setup help is a different thing in a different place: it never takes the place of a section.
  assert.notEqual(where({ ...states['the wiki page, "This page" on show'], visited }, SetupView), where({ ...states['the wiki page, "This page" on show'], visited }, ComposeView));
});

test('H1: the checker catches a layout that would throw the Write section away (it is the old App)', () => {
  // The old App: the section is drawn instead of the record view or the setup help, depending on the page. Same type, other place.
  const oldApp = (enabled) => React.createElement('main', null, enabled ? React.createElement(ComposeView, { page: record, eff }) : React.createElement(SetupView, { page: off, eff }));
  assert.equal(pathTo(oldApp(true), (el) => el.type === ComposeView), 'main > ComposeView');
  assert.equal(pathTo(oldApp(false), (el) => el.type === ComposeView), null, 'gone when the page is not enabled: its state would be destroyed');
});
