import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeRecordView from '../src/sidepanel/tabs/KnowledgeRecordView.jsx';
import ChatRecordView from '../src/sidepanel/tabs/ChatRecordView.jsx';
import KnowledgeToolsView from '../src/sidepanel/tabs/KnowledgeToolsView.jsx';
import DuplicatesPanel from '../src/sidepanel/knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../src/sidepanel/knowledge/GapsPanel.jsx';
import Notes from '../src/sidepanel/knowledge/Notes.jsx';
import { RECORD_TABS } from '../src/sidepanel/recordTabs.js';
import { normalizePolicy } from '../src/policy/policy.js';

// Some shared components use JSX without importing React; the build uses the automatic runtime, this bundle the classic one.
globalThis.React = React;

// First render only (effects do not run in a static render): enough to catch a broken import or a typo in a render path and to
// look at the structure and safety of the markup. Behaviour after the first read is covered by the pure-module and op tests;
// none of this replaces using the panel in a real browser.
const eff = (over = {}) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {} },
  locked: {},
  policy: normalizePolicy({}),
  apiKey: 'sk-ant-test',
  keyLocked: false,
  ...over,
});
const page = (table, kind) => ({
  status: 'record',
  tabId: 7,
  href: 'https://acme.service-now.com/nav_to.do',
  surface: 'classic',
  record: { table, sysId: 'a'.repeat(32), number: 'X1', kind },
  newRecord: null,
  user: { name: 'Beth Anglin' },
});
const run = (over = {}) => ({ busy: false, phase: 'idle', run() {}, reset() {}, ...over });
const html = (View, props) => renderToStaticMarkup(React.createElement(View, props));

test('the Article and Chat tabs are registered for their kinds only', () => {
  const tab = (id) => RECORD_TABS.find((t) => t.id === id);
  assert.deepEqual(tab('article').kinds, ['knowledge']);
  assert.deepEqual(tab('chat').kinds, ['chat']);
  assert.equal(tab('article').View, KnowledgeRecordView);
  assert.equal(tab('chat').View, ChatRecordView);
});

test('the Article tab starts by reading, offers the AI button, and enables it only with a key and when policy allows', () => {
  const p = page('kb_knowledge', 'knowledge');
  const props = { page: p, eff: eff(), record: p.record, header: null, run: run(), aiReady: true };
  const ready = html(KnowledgeRecordView, props);
  assert.match(ready, /Checks on this article/);
  assert.match(ready, /Reading the article/);
  assert.match(ready, /Nothing here is sent to an AI/);
  assert.match(ready, /<button[^>]*class="ab-btn ab-btn-primary"[^>]*>Suggest improvements<\/button>/);
  assert.doesNotMatch(ready, /class="ab-btn ab-btn-primary"[^>]*disabled/);
  const noKey = html(KnowledgeRecordView, { ...props, aiReady: false });
  assert.match(noKey, /class="ab-btn ab-btn-primary"[^>]*disabled=""[^>]*>Suggest improvements/);
  const off = html(KnowledgeRecordView, { ...props, eff: eff({ policy: normalizePolicy({ disabledFeatures: ['article-optimise'] }) }) });
  assert.match(off, /Your organisation has switched this off/);
  assert.match(off, /disabled=""[^>]*>Suggest improvements/);
});

test('the Chat tab starts by reading and has both AI buttons, disabled while a run is busy', () => {
  const p = page('interaction', 'chat');
  const props = { page: p, eff: eff(), record: p.record, header: null, run: run(), aiReady: true };
  const idle = html(ChatRecordView, props);
  assert.match(idle, /Reading the conversation/);
  assert.match(idle, />Summarise this chat<\/button>/);
  assert.match(idle, />Suggest replies<\/button>/);
  assert.match(idle, /copy the one you want into the chat/);
  const busy = html(ChatRecordView, { ...props, run: run({ busy: true }) });
  assert.ok((busy.match(/disabled=""/g) || []).length >= 2);
});

test('the Knowledge section has Duplicates and Gaps tabs with the standard tab roles; Duplicates is first', () => {
  const markup = html(KnowledgeToolsView, { page: page('incident', 'incident'), eff: eff() });
  assert.match(markup, /role="tablist"/);
  assert.equal((markup.match(/role="tab"/g) || []).length, 2);
  // (the shared tab list also names the panel each tab controls and keeps one tab stop: tests/panel-tabs.test.js)
  assert.match(markup, /id="ab-kbt-tab-duplicates"[^>]*aria-selected="true"[^>]*class="ab-btn ab-btn-sm ab-btn-primary">Duplicates</);
  assert.match(markup, />Gaps<\/button>/);
  assert.match(markup, /Find near-duplicate articles/);
  const noKey = html(KnowledgeToolsView, { page: page('incident', 'incident'), eff: eff({ apiKey: '' }) });
  assert.match(noKey, /Finding duplicates and gaps needs no AI/);
});

test('the Gaps tool renders its controls with labels, and nothing is read before the person asks', () => {
  const markup = html(GapsPanel, { page: page('incident', 'incident'), eff: eff(), run: run(), aiReady: true });
  assert.match(markup, /Articles to write/);
  assert.ok(markup.includes('id="ab-gap-days"') && markup.includes('for="ab-gap-days"'));
  assert.match(markup, /Find topics<\/button>/);
  assert.match(markup, /nothing is sent to an AI/);
  assert.doesNotMatch(markup, /Looked at/);
});

test('the Duplicates tool starts by looking for knowledge bases', () => {
  const markup = html(DuplicatesPanel, { page: page('incident', 'incident'), eff: eff(), run: run(), aiReady: true });
  assert.match(markup, /Looking for knowledge bases/);
  assert.doesNotMatch(markup, /Find duplicates<\/button>/, 'no search button until there is something to choose');
});

// Changed with the integration review (L7): a person cannot act on a table name, so the source and the table names inside the note
// are put into plain words (src/sidepanel/plainAccess.js; the wording itself is tested in tests/panel-parts.test.js).
test('notes show only what could not be read, in plain words (no table names), as text', () => {
  const markup = html(Notes, {
    access: [
      { source: 'kb_use', status: 'denied', note: 'Your user cannot read kb_use.' },
      { source: 'm2m_kb_task', status: 'ok', note: '' },
      { source: 'chat', status: 'empty-or-hidden', note: '<img src=x onerror=alert(1)> No chat messages are available to you.' },
      { source: 'x', status: 'error', note: '' },
    ],
  });
  assert.match(markup, /Article links: You cannot read article links\./);
  assert.ok(!markup.includes('kb_use'), 'no table name');
  assert.match(markup, /X: not available to you\./);
  assert.ok(!markup.includes('m2m_kb_task'));
  assert.ok(!markup.includes('<img'), 'text is escaped, never markup');
  assert.match(markup, /&lt;img/);
  assert.equal(html(Notes, { access: [{ source: 'a', status: 'ok' }] }), '');
  assert.equal(html(Notes, {}), '');
});
