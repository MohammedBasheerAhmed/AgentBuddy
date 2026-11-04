import { mount, click, settle, during, deferred, makeChrome, fakeAiFetch, fakeClipboard } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { forgetsPanelMemory, forgetPanelMemory, useForgetOnClear, watchForClears } from '../src/sidepanel/forgetOnClear.js';
import { useAnswers, AnswerArea, forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { store as answerStore } from '../src/sidepanel/ticket/assist/answers/session.js';
import { insightStore, useInsight } from '../src/sidepanel/ticket/cards/useInsight.js';
import { createInsightStore } from '../src/insights/cache.js';
import { forgetInserts, insertTargets, insertText } from '../src/sidepanel/insertFlow.js';
import { clearPending, getPending, setPending } from '../src/sidepanel/pendingDraft.js';
import { featureById } from '../src/features/registry.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { AUDIT_KEY, AUDIT_SALT_KEY } from '../src/audit/auditLog.js';

// Settings "Clear everything stored by Agent Buddy" and a site turned off empty what the panel holds in memory about tickets: the
// answers (with the real names put back), the Insights cards' reads and the text last inserted into each box (audit P1.23).

const ACME = 'https://acme.service-now.com';
const GLOBEX = 'https://globex.service-now.com';
const SYS = 'a'.repeat(32);
const INC = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' };

// ---- when to forget ----------------------------------------------------------------------------------------------------------

test('forget on "Clear everything" (the settings or the activity log\'s salt removed) and when a site is turned off', () => {
  const settings = (oldValue, newValue) => ({ [SETTINGS_KEY]: { ...(oldValue === undefined ? {} : { oldValue }), ...(newValue === undefined ? {} : { newValue }) } });
  // everything removed: the settings go...
  assert.equal(forgetsPanelMemory(settings({ instances: [ACME], theme: 'dark' }, undefined), 'local'), true);
  // ...and so does the salt, even for a person who never saved a setting
  assert.equal(forgetsPanelMemory({ [AUDIT_SALT_KEY]: { oldValue: 'salt' }, [AUDIT_KEY]: { oldValue: [] } }, 'local'), true);
  // a site turned off (one of two)
  assert.equal(forgetsPanelMemory(settings({ instances: [ACME, GLOBEX] }, { instances: [GLOBEX] }), 'local'), true);
  assert.equal(forgetsPanelMemory(settings({ instances: [ACME] }, { instances: [] }), 'local'), true);
  assert.equal(forgetsPanelMemory(settings({ instances: [ACME] }, {}), 'local'), true);
});

test('no forgetting for anything else: a site turned on, another setting, the activity log cleared, other areas', () => {
  const change = (oldValue, newValue) => ({ [SETTINGS_KEY]: { oldValue, newValue } });
  assert.equal(forgetsPanelMemory(change({ instances: [ACME] }, { instances: [ACME, GLOBEX] }), 'local'), false, 'turned on');
  assert.equal(forgetsPanelMemory(change({ instances: [ACME], theme: 'light' }, { instances: [ACME], theme: 'dark' }), 'local'), false);
  assert.equal(forgetsPanelMemory({ [SETTINGS_KEY]: { newValue: { instances: [ACME] } } }, 'local'), false, 'the first save');
  assert.equal(forgetsPanelMemory({ [AUDIT_KEY]: { oldValue: [{}] } }, 'local'), false, 'Clear log in Settings');
  assert.equal(forgetsPanelMemory({ agentbuddy_snippets: { oldValue: [] } }, 'local'), false);
  assert.equal(forgetsPanelMemory({ [SETTINGS_KEY]: { oldValue: { instances: [ACME] } } }, 'session'), false, 'not where settings live');
  assert.equal(forgetsPanelMemory({ [SETTINGS_KEY]: { oldValue: { instances: [ACME] } } }, 'managed'), false);
  for (const bad of [null, undefined, 'x', 3]) assert.equal(forgetsPanelMemory(bad, 'local'), false, String(bad));
  assert.equal(forgetsPanelMemory(change({ instances: 'nonsense' }, { instances: null }), 'local'), false);
});

test('watchForClears listens to chrome.storage, forgets only when it should, and stops when asked', async () => {
  const fake = makeChrome();
  let forgotten = 0;
  const stop = watchForClears(fake.chrome.storage, () => (forgotten += 1));
  assert.equal(fake.chrome.storage.onChanged.count, 1);
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME, GLOBEX] } });
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME, GLOBEX], theme: 'dark' } });
  assert.equal(forgotten, 0);
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME], theme: 'dark' } });
  assert.equal(forgotten, 1, 'globex turned off');
  await fake.chrome.storage.local.remove([SETTINGS_KEY]);
  assert.equal(forgotten, 2, 'everything cleared');
  stop();
  assert.equal(fake.chrome.storage.onChanged.count, 0);
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME] } });
  await fake.chrome.storage.local.remove([SETTINGS_KEY]);
  assert.equal(forgotten, 2);
  // no storage to listen to: nothing to stop, nothing thrown
  assert.equal(typeof watchForClears(null), 'function');
  assert.equal(typeof watchForClears({}), 'function');
});

// ---- what is forgotten -------------------------------------------------------------------------------------------------------

test('forgetPanelMemory empties the answers, the cards\' reads and what was inserted where', async () => {
  forgetAnswers();
  forgetInserts();
  const key = `acme.service-now.com|incident:${SYS}`;
  answerStore.add(key, { text: 'Abel Tuter says the VPN drops.' });
  await insightStore.get('7|incident:aaa|glance', async () => ({ caller: 'Abel Tuter' }));
  const page = { tabId: 7, href: `${ACME}/incident.do?sys_id=${SYS}`, surface: 'classic', record: { ...INC } };
  const target = insertTargets(featureById('handoff-brief'), { record: INC, page })[0];
  const sent = [];
  const send = async (_tab, message) => {
    sent.push(message);
    return { ok: true, method: 'g_form' };
  };
  const source = { expect: { table: 'incident', sysId: SYS }, number: INC.number };
  await insertText({ page, target, text: 'Brief for Abel Tuter', source, send });
  await insertText({ page, target, text: 'Brief two', source, send });
  assert.equal(sent[1].replacing, 'Brief for Abel Tuter', 'the panel remembers what it put into the box');
  assert.equal(answerStore.list(key).length, 1);
  assert.ok(insightStore.peek('7|incident:aaa|glance'));

  forgetPanelMemory();
  assert.deepEqual(answerStore.list(key), []);
  assert.equal(insightStore.peek('7|incident:aaa|glance'), null);
  await insertText({ page, target, text: 'Brief three', source, send });
  assert.equal(sent[2].replacing, undefined, 'nothing remembered: the earlier text is not swapped out');
});

test('forgetPanelMemory drops a draft carried to another form (an article form, or a ticket\'s email form: kept 15 minutes)', () => {
  clearPending();
  const feature = featureById('kb-article-draft');
  assert.equal(setPending({ feature, text: 'How Abel Tuter fixed the VPN', people: [{ name: 'Abel Tuter' }], scan: null, origin: ACME }), true);
  assert.ok(getPending());
  forgetPanelMemory();
  assert.equal(getPending(), null);
  assert.equal(setPending({ feature: featureById('email-resolution'), text: 'Subject: Fixed\n\nDear Abel Tuter, it works again.', origin: ACME, email: { table: 'incident', sysId: SYS } }), true);
  forgetPanelMemory();
  assert.equal(getPending(), null, 'an email draft too');
});

test('the cards\' store tells its subscribers when clear() drops their key (with a prefix: only those keys)', async () => {
  const store = createInsightStore();
  await store.get('7|incident:a|glance', async () => ({ caller: 'Abel Tuter' }));
  await store.get('8|incident:b|glance', async () => ({ caller: 'Beth Anglin' }));
  const seen = { a: [], b: [] };
  store.subscribe('7|incident:a|glance', (entry) => seen.a.push(entry));
  store.subscribe('8|incident:b|glance', (entry) => seen.b.push(entry));
  store.clear('7|');
  assert.deepEqual(seen.a, [null]);
  assert.deepEqual(seen.b, [], 'another key is left alone');
  assert.ok(store.peek('8|incident:b|glance'));
  // a read on its way when everything is cleared: its subscriber hears null, and the late answer is not kept
  const slow = deferred();
  const late = store.get('9|incident:c|glance', () => slow.promise);
  const seenC = [];
  store.subscribe('9|incident:c|glance', (entry) => seenC.push(entry));
  store.clear();
  assert.deepEqual(seen.b, [null]);
  assert.deepEqual(seenC, [null]);
  slow.resolve({ caller: 'Abel Tuter' });
  await late;
  assert.equal(store.peek('9|incident:c|glance'), null);
  assert.equal(store.size(), 0);
});

function Card() {
  useForgetOnClear();
  const read = useInsight({ key: '7|incident:aaa|glance', load: async () => ({ caller: 'Abel Tuter' }), active: true });
  return <p>{read.data?.caller || 'nothing to show'}</p>;
}

test('in the panel: a card on screen lets go of what it read after "Clear everything"', async () => {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME] } });
  const ui = await mount(<Card />);
  try {
    assert.match(ui.text(), /Abel Tuter/);
    await during(() => fake.chrome.storage.local.remove(Object.keys(fake.chrome.storage.local.data)));
    assert.ok(!/Abel Tuter/.test(ui.text()), 'gone from the screen');
    assert.match(ui.text(), /nothing to show/);
  } finally {
    await ui.unmount();
  }
});

function Screen({ page, eff }) {
  useForgetOnClear();
  const assist = useAnswers({ page, eff, record: page.record });
  return (
    <div>
      <AnswerArea assist={assist} page={page} eff={eff} record={page.record} active />
      <button type="button" disabled={assist.busy} onClick={() => assist.run(featureById('record-summary'))}>Summarise</button>
    </div>
  );
}

test('in the panel: the answer on screen goes when the site is turned off, and again after "Clear everything"', async () => {
  forgetAnswers();
  forgetInserts();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Issue: Abel Tuter cannot use the VPN.');
  fakeClipboard();
  fake.onRead('pack', () => ({ version: 1, ...INC, fields: { number: INC.number, short_description: 'VPN drops', description: 'Abel Tuter says the VPN drops.' }, people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }], journal: [], related: {}, access: [] }));
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME, GLOBEX] } });
  const eff = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never' }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false };
  const page = { status: 'record', tabId: 7, href: `${ACME}/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record: INC, newRecord: null, user: { name: 'Beth Anglin' } };
  const ui = await mount(<Screen page={page} eff={eff} />);
  try {
    const answer = async () => {
      await click(ui.button('Summarise'));
      await settle(6);
      assert.match(ui.text(), /Abel Tuter cannot use the VPN/);
    };
    await answer();
    // another setting changes: the answer stays
    await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [ACME, GLOBEX], theme: 'dark' } }));
    assert.match(ui.text(), /Abel Tuter cannot use the VPN/);
    // Settings > Turn off (the worker saves the settings without the site)
    await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { instances: [GLOBEX], theme: 'dark' } }));
    assert.ok(!/Abel Tuter/.test(ui.text()), 'gone from the screen');
    assert.equal(ui.$$('section.ab-answer').length, 0);
    // Settings > Clear everything (every agentbuddy_* key removed)
    await answer();
    await during(() => fake.chrome.storage.local.remove(Object.keys(fake.chrome.storage.local.data)));
    assert.ok(!/Abel Tuter/.test(ui.text()));
  } finally {
    await ui.unmount();
  }
  assert.equal(fake.chrome.storage.onChanged.count, 0, 'the panel stops listening when it goes');
});
