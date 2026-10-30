import { mount, click, choose, settle, makeChrome, fakeAiFetch, fakeClipboard, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import KnowledgeToolsView from '../src/sidepanel/tabs/KnowledgeToolsView.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// The Knowledge section driven like a person would: choose a knowledge base and a category, find, compare, draft, look at the other
// tool and come back. Reads are answered by a fake content script; the AI by a fake fetch, through the real useRun flow.

const ORIGIN = 'https://acme.service-now.com';
const page = { status: 'no-record', tabId: 7, href: `${ORIGIN}/home`, surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth Anglin' } };
const eff = (apiKey = 'sk-ant-test-0123456789') => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never' }, {}), apiKey, keyLocked: false });
const sys = (c) => c.repeat(32);
const article = (n, c) => ({ sysId: sys(c), number: `KB000000${n}`, title: `Reset your VPN password ${n}`, views: 10 * n, updated: '2026-10-01 10:00:00' });
const CLUSTERS = { scanned: 12, clusters: [{ id: 'g1', articles: [article(1, 'a'), article(2, 'b')], exactTitle: false, sharedWords: ['vpn', 'password'], keep: { number: 'KB0000002' } }], access: [] };

function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('# Reset your VPN password\n\n1. Open the portal.\n2. Choose Reset.');
  fakeClipboard();
  fake.onRead('kbScopes', (args) => (args.knowledgeBase ? { items: [{ id: 'c1', name: 'Network', count: 3 }, { id: 'c2', name: 'Email', count: 4 }], access: [] } : { items: [{ id: 'kb1', name: 'IT', count: 12 }], access: [] }));
  fake.onRead('kbDuplicates', () => CLUSTERS);
  fake.onRead('kbArticleTexts', () => ({
    pairs: [{ a: 'KB0000001', b: 'KB0000002', containment: 0.8, jaccard: 0.5 }],
    articles: [
      { ...article(1, 'a'), text: 'Open the portal and choose Reset.' },
      { ...article(2, 'b'), text: 'Go to the portal, then Reset.' },
    ],
    access: [],
    people: [],
  }));
  fake.onRead('kbGaps', () => ({ scanned: 0, days: 60, withArticle: 0, link: { known: true }, clusters: [], access: [], truncated: false, note: '' }));
  return fake;
}

test('a category chosen while "Find duplicates" is still reading: the late answer (for all categories) is not shown as the category\'s', async () => {
  const fake = setup();
  const held = deferred();
  fake.onRead('kbDuplicates', () => held.promise);
  const ui = await mount(<KnowledgeToolsView page={page} eff={eff()} />);
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /Comparing titles/);
  await choose(ui.field('Category (optional)'), 'c1');
  await during(() => held.resolve(CLUSTERS));
  assert.ok(!/Compared 12 titles/.test(ui.text()), 'the groups found for all categories are not shown under "Network"');
  assert.ok(!ui.hasButton('Compare'));
  await ui.unmount();
});

test('a long search can be stopped; its answer is then dropped', async () => {
  const fake = setup();
  const held = deferred();
  fake.onRead('kbDuplicates', () => held.promise);
  const ui = await mount(<KnowledgeToolsView page={page} eff={eff()} />);
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  await click(ui.button('Stop'));
  assert.ok(!/Comparing titles/.test(ui.text()));
  assert.equal(ui.button('Find duplicates').disabled, false, 'the person can search again at once');
  await during(() => held.resolve(CLUSTERS));
  assert.ok(!/Compared 12 titles/.test(ui.text()));
  await ui.unmount();
});

test('a merged draft survives a look at the Gaps tool and back', async () => {
  setup();
  const ui = await mount(<KnowledgeToolsView page={page} eff={eff()} />);
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /Compared 12 titles/);
  await click(ui.button('Compare'));
  await click(ui.button('Compare their text'));
  await click(ui.button('Draft a merged article'));
  await settle(6);
  assert.match(ui.text(), /Open the portal\./, 'the draft is on screen');
  await click(ui.tab('Gaps'));
  assert.ok(!/Open the portal\./.test(ui.text()), 'the Gaps tool does not show the Duplicates draft');
  await click(ui.tab('Duplicates'));
  assert.match(ui.text(), /Open the portal\./, 'the draft is still there');
  await ui.unmount();
});

test('the Gaps tool: its choices cannot change under a search that is reading, and the search can be stopped', async () => {
  const fake = setup();
  const held = deferred();
  fake.onRead('kbGaps', () => held.promise);
  const ui = await mount(<KnowledgeToolsView page={page} eff={eff()} />);
  await click(ui.tab('Gaps'));
  await click(ui.button('Find topics'));
  assert.equal(ui.field('Resolved in the last').disabled, true);
  await click(ui.button('Stop'));
  assert.equal(ui.field('Resolved in the last').disabled, false);
  await during(() => held.resolve({ scanned: 5, days: 60, withArticle: 0, link: { known: true }, clusters: [], access: [], truncated: false, note: '' }));
  assert.ok(!/Looked at 5/.test(ui.text()));
  await ui.unmount();
});

test('a read that fails says so in plain words and offers to try again', async () => {
  const fake = setup();
  let calls = 0;
  fake.onRead('kbDuplicates', () => {
    calls += 1;
    if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return CLUSTERS;
  });
  const ui = await mount(<KnowledgeToolsView page={page} eff={eff()} />);
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /lost touch with this page/);
  assert.ok(!/Receiving end/.test(ui.text()));
  await click(ui.button('Try again'));
  assert.match(ui.text(), /Compared 12 titles/);
  await ui.unmount();
});
