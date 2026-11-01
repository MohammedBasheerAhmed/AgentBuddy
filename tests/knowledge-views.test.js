import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeRecordView from '../src/sidepanel/tabs/KnowledgeRecordView.jsx';
import ChatRecordView from '../src/sidepanel/tabs/ChatRecordView.jsx';
import { KnowledgeAssist, KnowledgeInsights } from '../src/sidepanel/knowledgeScreen/index.js';
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

// Round 3: the Knowledge screen is split into Insights (no AI) and AI Assist; search is for everyone, the knowledge-manager tools for
// the km work profile only (docs/round3.md, TRACKER.md N18, N19, N23, AI26, AI27).
const withProfiles = (profiles) => eff({ values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles } });

test('the Knowledge screen for everyone is search only; a knowledge manager also gets the duplicate finder and the gap radar, folded', () => {
  const everyone = html(KnowledgeInsights, { page: page('incident', 'incident'), eff: withProfiles(['it']), active: true });
  assert.match(everyone, /Knowledge search/);
  assert.ok(everyone.includes('id="ab-kb-search"') && everyone.includes('for="ab-kb-search"'), 'the search box has a label');
  assert.match(everyone, /<button type="button" class="ab-btn ab-btn-primary ab-btn-sm" disabled="">Search<\/button>/, 'one primary button, off until words are typed');
  assert.doesNotMatch(everyone, /Duplicate articles|Articles to write/);
  assert.equal(KnowledgeAssist.shownFor(withProfiles(['it'])), false, 'no AI half without the knowledge manager profile');

  const km = html(KnowledgeInsights, { page: page('incident', 'incident'), eff: withProfiles(['it', 'km']), active: true });
  for (const title of ['Knowledge search', 'Duplicate articles', 'Articles to write']) assert.match(km, new RegExp(title));
  assert.equal((km.match(/aria-expanded="false"/g) || []).length, 2, 'the two tools are folded until opened');
  assert.equal((km.match(/class="ab-btn ab-btn-primary/g) || []).length, 1, 'still one primary button on the screen');
  assert.equal(KnowledgeAssist.shownFor(withProfiles(['it', 'km'])), true);
  assert.equal(KnowledgeAssist.shownFor(eff({ values: { provider: 'anthropic', profiles: ['it'], showEverything: true } })), true, '"Show everything" shows it');
  assert.doesNotMatch(km, /ab-ai-badge/, 'no AI mark anywhere in Insights');
});

test('the AI Assist half: both tools carry the AI mark and say where to start when Insights has found nothing yet', () => {
  const markup = html(KnowledgeAssist, { page: page('incident', 'incident'), eff: withProfiles(['km']), active: true });
  assert.match(markup, /Merge duplicate articles/);
  assert.match(markup, /Outline a missing article/);
  assert.ok((markup.match(/ab-ai-badge/g) || []).length >= 2);
  assert.match(markup, /Find duplicate articles in Insights/);
  assert.match(markup, /Find topics under &quot;Articles to write&quot; in Insights first/);
  const noKey = html(KnowledgeAssist, { page: page('incident', 'incident'), eff: { ...withProfiles(['km']), apiKey: '' }, active: true });
  assert.match(noKey, /Add an AI key in Settings to use the merged drafts and outlines/);
  const notKm = html(KnowledgeAssist, { page: page('incident', 'incident'), eff: withProfiles(['it']), active: true });
  assert.match(notKm, /for knowledge managers/);
  assert.doesNotMatch(notKm, /<button/);
});

test('the Gaps tool renders its controls with labels and its limits, and nothing is read before the person asks', () => {
  const markup = html(GapsPanel, { page: page('incident', 'incident'), active: false });
  assert.ok(markup.includes('id="ab-gap-days"') && markup.includes('for="ab-gap-days"'));
  assert.ok(markup.includes('id="ab-gap-scope"') && markup.includes('for="ab-gap-scope"'), 'the scope has a label');
  assert.match(markup, />Everything I can see/);
  assert.match(markup, />My groups/);
  assert.match(markup, /at most the newest 500/, 'the limit is said up front');
  assert.match(markup, /Find topics<\/button>/);
  assert.doesNotMatch(markup, /Looked at/);
  assert.doesNotMatch(markup, /ab-btn-primary/, "the screen's one primary button is the search");
});

test('the Duplicates tool says its limits up front and reads nothing while it is folded', () => {
  const markup = html(DuplicatesPanel, { page: page('incident', 'incident'), active: false });
  assert.match(markup, /300 at a time, newest changed first/);
  assert.doesNotMatch(markup, /Looking for knowledge bases/);
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
