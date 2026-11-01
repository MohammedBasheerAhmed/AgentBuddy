import { mount, click, settle, focused, makeChrome, fakeAiFetch, fakeClipboard, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import RecordView from '../src/sidepanel/RecordView.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// The record view driven like a person would: tabs, actions, results, Close, another record. These run the real useRun flow (policy,
// privacy filter, preview decision, provider call through a fake fetch, re-hydration) and the real result card.

const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const ITEM = 'c'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';

const effOf = (values = {}, apiKey = 'sk-ant-test-0123456789') => ({
  ready: true,
  ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', ...values }, {}),
  apiKey,
  keyLocked: false,
});

const pageOf = (record) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/${record.table}.do?sys_id=${record.sysId}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const TASK = { table: 'sc_task', sysId: SYS, number: 'SCTASK0010001', kind: 'catalog_task' };
const INC = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' };
const INC_B = { table: 'incident', sysId: SYS_B, number: 'INC0010002', kind: 'incident' };

const packOf = (record, fields = {}) => ({
  version: 1,
  table: record.table,
  sysId: record.sysId,
  number: record.number,
  kind: record.kind,
  fields: { number: record.number, short_description: 'New laptop for Priya', state: 'Open', ...fields },
  people: [],
  journal: [],
  related: {},
  access: [],
});

function setup({ answer = 'An answer from the AI.' } = {}) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch(answer);
  fakeClipboard();
  fake.onRead('header', (args) => ({ number: args.sysId === SYS_B ? 'INC0010002' : 'INC0010001', short_description: 'VPN drops', state: 'In Progress', priority: '3 - Moderate' }));
  fake.onRead('pack', (args) => {
    if (args.table === 'sc_req_item') return packOf({ table: 'sc_req_item', sysId: ITEM, number: 'RITM0010001', kind: 'requested_item' });
    if (args.table === 'sc_task') return packOf(TASK, { description: '1. Image the laptop\n2. Ship it to the user' });
    return packOf(args.sysId === SYS_B ? INC_B : INC, { description: 'The VPN drops every hour.' });
  });
  fake.onRead('requestTarget', () => ({ table: 'sc_req_item', sysId: ITEM, note: '' }));
  fake.onRead('resolutionFacts', () => ({ form: null, links: null }));
  fake.onRead('requestFacts', () => ({}));
  return fake;
}

const steps = (ui) => ui.$$('ul[aria-label="Steps"] li').map((li) => li.textContent.trim());

test('record tabs keep what was done in them: an AI checklist the person chose survives a look at another tab', async () => {
  setup({ answer: '1. Install the VPN client\n2. Add it to the asset register\n3. Ship it to the user' });
  const ui = await mount(<RecordView page={pageOf(TASK)} eff={effOf()} />);
  await click(ui.tab('Checklist'));
  assert.deepEqual(steps(ui), ['Image the laptop', 'Ship it to the user']);
  await click(ui.button('Draft a checklist from the instructions'));
  await settle(6);
  await click(ui.button('Use this list'));
  assert.deepEqual(steps(ui), ['Install the VPN client', 'Add it to the asset register', 'Ship it to the user']);
  await click(ui.button('Close'));
  await click(ui.tab('Related'));
  await click(ui.tab('Checklist'));
  assert.deepEqual(steps(ui), ['Install the VPN client', 'Add it to the asset register', 'Ship it to the user'], 'the list the person chose is still the one shown');
  await ui.unmount();
});

test('the result card says which ticket it was written for, takes the focus, and Close gives the focus back to the action', async () => {
  setup({ answer: 'The VPN drops every hour since the certificate expired.' });
  const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf()} />);
  await click(ui.button(/^Summarise this ticket/));
  await settle(6);
  const card = ui.$('.ab-output')?.closest('section');
  assert.ok(card, 'the answer is on screen');
  assert.match(card.textContent, /INC0010001/, 'the card names the ticket the answer is for');
  assert.equal(focused().tagName, 'H2', 'the focus moved to the answer, so a keyboard or screen reader user lands on it');
  assert.ok(card.contains(focused()));
  await click(ui.button('Close'));
  assert.match(focused().textContent, /Summarise this ticket/, 'the focus is back on the action that was used');
  await ui.unmount();
});

test('one tab that breaks (a malformed answer from the page) does not take the record, its quick actions or its other tabs with it', async () => {
  const fake = setup();
  fake.onRead('chatOverview', () => ({ access: [] })); // no overview at all: data from the page is untrusted
  const CHAT = { table: 'interaction', sysId: SYS, number: 'IMS0001', kind: 'chat' };
  const ui = await mount(<RecordView page={pageOf(CHAT)} eff={effOf()} />);
  await click(ui.tab('Chat'));
  assert.match(ui.text(), /IMS0001/, 'the record card is still there');
  assert.ok(!/Something went wrong/.test(ui.text()) || ui.hasButton('Actions') || ui.$('[role="tab"]'), 'the tabs are still there');
  assert.ok(ui.$$('[role="tab"]').length >= 3, 'the tab list is still there');
  assert.match(ui.text(), /could not be read|went wrong/i, 'the broken tab says so in words');
  await click(ui.tab('Actions'));
  assert.ok(ui.hasButton(/^Summarise this chat/), 'the other tabs still work');
  await ui.unmount();
});

test('without an AI key the record says what to do next and offers the way there; the tools that need no AI are named', async () => {
  const fake = setup();
  const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf({}, '')} />);
  assert.match(ui.text(), /Add an AI key in Settings/);
  await click(ui.button('Open Settings'));
  assert.equal(fake.optionsOpened, 1);
  assert.match(ui.text(), /Related and Check work without/i);
  await ui.unmount();
});

test('a new record keeps the tab the person is working in when that record has it too', async () => {
  setup();
  const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf()} />);
  await click(ui.tab('Check'));
  await ui.rerender(<RecordView page={pageOf(INC_B)} eff={effOf()} />);
  assert.equal(ui.tab('Check').getAttribute('aria-selected'), 'true');
  assert.match(ui.text(), /Check before you resolve/);
  await ui.rerender(<RecordView page={pageOf(TASK)} eff={effOf()} />);
  assert.equal(ui.tab('Check').getAttribute('aria-selected'), 'true');
  await ui.unmount();
});

test('an answer that arrives after the person moved to another ticket is never shown there', async () => {
  const fake = setup();
  const held = deferred();
  globalThis.fetch = async (...args) => {
    await held.promise;
    return fakeAiFetch('Answer for the FIRST ticket.')(...args);
  };
  const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf()} />);
  await click(ui.button(/^Summarise this ticket/));
  await ui.rerender(<RecordView page={pageOf(INC_B)} eff={effOf()} />);
  await during(() => held.resolve());
  assert.ok(!/FIRST ticket/.test(ui.text()), ui.text().slice(0, 200));
  assert.equal(ui.$('.ab-output'), null);
  assert.equal(fake.fills().length, 0);
  await ui.unmount();
});

test('every record tab has its own error boundary: a tab that throws while it draws leaves the record and the other tabs working', async () => {
  setup();
  const { RECORD_TABS } = await import('../src/sidepanel/recordTabs.js');
  const Boom = () => {
    throw new Error('ticket text that must not be shown: Abel Tuter');
  };
  RECORD_TABS.push({ id: 'boom', label: 'Boom', kinds: ['incident'], View: Boom });
  const original = console.error;
  console.error = () => {}; // (React reports the caught error in development builds; the panel itself logs nothing)
  try {
    const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf()} />);
    await click(ui.tab('Boom'));
    assert.match(ui.text(), /Something went wrong in this part of Agent Buddy/);
    assert.ok(!ui.text().includes('Abel Tuter'), 'the error text is never shown');
    assert.match(ui.text(), /INC0010001/, 'the record card is still there');
    assert.ok(ui.hasButton('Summarise'), 'the quick actions are still there');
    await click(ui.tab('Actions'));
    assert.ok(ui.hasButton(/^Summarise this ticket/), 'the other tabs still work');
    await ui.unmount();
  } finally {
    console.error = original;
    RECORD_TABS.splice(RECORD_TABS.findIndex((t) => t.id === 'boom'), 1);
  }
});

test('keyboard: the record tabs move with the arrow keys and take the focus with them; one tab stop', async () => {
  setup();
  const { press } = await import('./fixtures/panel-dom.js');
  const ui = await mount(<RecordView page={pageOf(INC)} eff={effOf()} />);
  const tabs = () => ui.$$('[role="tablist"][aria-label="Record tools"] [role="tab"]');
  assert.deepEqual(tabs().map((t) => t.getAttribute('tabindex')), ['0', '-1', '-1']);
  await press(ui.tab('Actions'), 'ArrowRight');
  assert.equal(ui.tab('Related').getAttribute('aria-selected'), 'true');
  assert.equal(focused(), ui.tab('Related'));
  await press(ui.tab('Related'), 'End');
  assert.equal(focused(), ui.tab('Check'));
  assert.match(ui.text(), /Check before you resolve/);
  await press(ui.tab('Check'), 'Home');
  assert.equal(focused(), ui.tab('Actions'));
  assert.ok(ui.hasButton(/^Summarise this ticket/));
  await ui.unmount();
});
