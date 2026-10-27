import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Tabs, { TabPanel } from '../src/sidepanel/Tabs.jsx';
import { nextTabIndex, panelId, sharedPanelId, tabId } from '../src/sidepanel/tabKeys.js';
import RecordView from '../src/sidepanel/RecordView.jsx';
import KnowledgeToolsView from '../src/sidepanel/tabs/KnowledgeToolsView.jsx';
import { normalizePolicy } from '../src/policy/policy.js';

globalThis.React = React;

// Integration review M10: one tab list for the whole panel, with the keyboard behaviour its roles promise.

test('arrow keys move one tab and wrap; Home and End go to the ends; other keys mean nothing', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0, 'wraps to the first');
  assert.equal(nextTabIndex('ArrowLeft', 1, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2, 'wraps to the last');
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  for (const key of ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp', 'a', 'Escape']) assert.equal(nextTabIndex(key, 1, 3), -1, key);
});

test('a list with one tab, or none, or an unknown position cannot get lost', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 1), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 1), 0);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), -1);
  assert.equal(nextTabIndex('End', -1, 4), 3);
  assert.equal(nextTabIndex('ArrowRight', -1, 4), 1, 'no selected tab counts as the first');
  assert.equal(nextTabIndex('ArrowRight', 9, 4), 1);
});

test('ids: a tab and its panel always point at each other', () => {
  assert.equal(tabId('ab-sec', 'write'), 'ab-sec-tab-write');
  assert.equal(panelId('ab-sec', 'write'), 'ab-sec-panel-write');
  assert.equal(sharedPanelId('ab-rec'), 'ab-rec-panel');
});

const TABS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }];
const tabs = (props = {}) => renderToStaticMarkup(<Tabs idBase="x" label="Things" tabs={TABS} value="b" onChange={() => {}} {...props} />);

test('Tabs: one tab stop, aria-selected on the chosen one, every tab names its panel', () => {
  const markup = tabs();
  assert.match(markup, /role="tablist"[^>]*aria-label="Things"|aria-label="Things"[^>]*role="tablist"/);
  assert.equal((markup.match(/role="tab"/g) || []).length, 3);
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((markup.match(/tabindex="-1"/g) || []).length, 2);
  assert.match(markup, /id="x-tab-b"[^>]*aria-selected="true"[^>]*aria-controls="x-panel-b"[^>]*tabindex="0"/);
  assert.match(markup, /id="x-tab-a"[^>]*aria-selected="false"[^>]*aria-controls="x-panel-a"[^>]*tabindex="-1"/);
});

test('Tabs: a value that is not a tab (the record changed kind) still leaves one way into the list', () => {
  const markup = tabs({ value: 'gone' });
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1);
  assert.match(markup, /id="x-tab-a"[^>]*aria-selected="true"/);
});

test('Tabs shared: all tabs control the one panel, which is labelled by the chosen tab', () => {
  const markup = renderToStaticMarkup(
    <>
      <Tabs idBase="x" label="Things" tabs={TABS} value="c" onChange={() => {}} shared />
      <TabPanel idBase="x" shared value="c">content</TabPanel>
    </>
  );
  assert.equal((markup.match(/aria-controls="x-panel"/g) || []).length, 3);
  assert.match(markup, /<div id="x-panel" role="tabpanel" aria-labelledby="x-tab-c">content<\/div>/);
});

test('TabPanel per tab: labelled by its tab, hidden when it is not the chosen one', () => {
  const markup = renderToStaticMarkup(
    <>
      <TabPanel idBase="x" id="a" hidden>one</TabPanel>
      <TabPanel idBase="x" id="b">two</TabPanel>
    </>
  );
  assert.match(markup, /<div id="x-panel-a" role="tabpanel" aria-labelledby="x-tab-a" hidden="">one<\/div>/);
  assert.match(markup, /<div id="x-panel-b" role="tabpanel" aria-labelledby="x-tab-b">two<\/div>/);
});

// ---- where it is used ------------------------------------------------------------------------------------------------------------

const eff = (over = {}) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {} },
  locked: {},
  policy: normalizePolicy({}),
  apiKey: 'sk-ant-test',
  keyLocked: false,
  ...over,
});
const page = (kind, table) => ({ status: 'record', tabId: 1, href: 'https://acme.service-now.com/x', surface: 'classic', record: { table, sysId: 'a'.repeat(32), number: 'X1', kind }, newRecord: null, user: null });

test('a record view has one labelled tab list and one panel those tabs control', () => {
  const markup = renderToStaticMarkup(<RecordView page={page('incident', 'incident')} eff={eff()} />);
  assert.match(markup, /aria-label="Record tools"/);
  assert.ok(!markup.includes('Panel sections'));
  for (const label of ['Actions', 'Related', 'Check']) assert.ok(markup.includes(`>${label}</button>`), label);
  assert.equal((markup.match(/aria-controls="ab-rec-panel"/g) || []).length, 3);
  assert.match(markup, /<div id="ab-rec-panel" role="tabpanel" aria-labelledby="ab-rec-tab-actions"/);
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1);
});

test('the tabs of a record view follow its kind', () => {
  const labels = (kind, table) => [...renderToStaticMarkup(<RecordView page={page(kind, table)} eff={eff()} />).matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels('incident', 'incident'), ['Actions', 'Related', 'Check']);
  assert.deepEqual(labels('catalog_task', 'sc_task'), ['Actions', 'Related', 'Request', 'Check', 'Checklist']);
  assert.deepEqual(labels('knowledge', 'kb_knowledge'), ['Actions', 'Related', 'Article']);
});

test('the Knowledge tools are one tab list, a panel for each tool, the second one hidden and still there', () => {
  const markup = renderToStaticMarkup(<KnowledgeToolsView page={page('incident', 'incident')} eff={eff()} />);
  assert.match(markup, /aria-label="Knowledge tools"/);
  assert.match(markup, /id="ab-kbt-tab-duplicates"[^>]*aria-selected="true"[^>]*aria-controls="ab-kbt-panel-duplicates"/);
  assert.match(markup, /id="ab-kbt-tab-gaps"[^>]*aria-selected="false"[^>]*aria-controls="ab-kbt-panel-gaps"[^>]*tabindex="-1"/);
  assert.match(markup, /<div id="ab-kbt-panel-duplicates" role="tabpanel" aria-labelledby="ab-kbt-tab-duplicates" class="ab-pane">/);
  assert.match(markup, /<div id="ab-kbt-panel-gaps" role="tabpanel" aria-labelledby="ab-kbt-tab-gaps" class="ab-pane" hidden="">/);
  assert.match(markup, /Articles to write/, 'the Gaps tool is mounted, so what it found survives a look at the other one');
});
