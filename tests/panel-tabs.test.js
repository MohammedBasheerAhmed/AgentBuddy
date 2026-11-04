import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import Tabs from '../src/sidepanel/Tabs.jsx';
import { nextTabIndex, panelId, tabId } from '../src/sidepanel/tabKeys.js';

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
