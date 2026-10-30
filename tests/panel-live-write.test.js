import { mount, click, type, settle, focused, makeChrome, fakeAiFetch, fakeClipboard } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ComposeView from '../src/sidepanel/tabs/ComposeView.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { MSG } from '../src/lib/messages.js';

// The Write section driven like a person would: a rewrite inserted through the shared insert flow (record binding, review, one
// insert per click), a rewrite that is not offered for another ticket, the snippet editor's focus, and the way to Settings.

const ORIGIN = 'https://acme.service-now.com';
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const pageOf = (sysId, number) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/incident.do?sys_id=${sysId}`, surface: 'classic', portal: null, record: { table: 'incident', sysId, number, kind: 'incident' }, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = (apiKey = 'sk-ant-test-0123456789') => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never' }, {}), apiKey, keyLocked: false });

function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Thanks for waiting. The VPN works again.');
  fakeClipboard();
  fake.onRead('pack', (args) => ({ version: 1, table: 'incident', sysId: args.sysId, number: args.sysId === A ? 'INC0010001' : 'INC0010002', kind: 'incident', fields: { short_description: 'VPN drops' }, people: [], journal: [], related: {}, access: [] }));
  fake.onFill(async () => ({ ok: true, method: 'g_form' }));
  return fake;
}

async function rewrite(ui) {
  await click(ui.tab('Rewrite'));
  await type(ui.field('Text to rewrite'), 'thx for waiting, vpn is back now');
  await click(ui.button('Shorter'));
  await settle(6);
}

test('a rewrite goes into the form through the shared insert flow: the record it was made for, added below, once', async () => {
  const fake = setup();
  const ui = await mount(<ComposeView page={pageOf(A, 'INC0010001')} eff={eff()} />);
  await rewrite(ui);
  assert.match(ui.text(), /Thanks for waiting\. The VPN works again\./);
  assert.match(ui.text(), /Goes into: Customer comment/);
  const add = ui.button('Add below');
  await click(add);
  const fills = fake.fills();
  assert.equal(fills.length, 1);
  assert.equal(fills[0].type, MSG.FILL_FIELD);
  assert.equal(fills[0].field, 'comments');
  assert.equal(fills[0].mode, 'append');
  assert.deepEqual(fills[0].expect, { table: 'incident', sysId: A }, 'bound to the record the rewrite was made on');
  assert.equal(ui.button('Inserted').disabled, true, 'the button says it is done and cannot add the text twice');
  await click(ui.button('Inserted', { all: true }));
  assert.equal(fake.fills().length, 1);
  await ui.unmount();
});

test('a rewrite made on one ticket is not offered for another: the buttons are off and the panel says which ticket it is for', async () => {
  const fake = setup();
  const ui = await mount(<ComposeView page={pageOf(A, 'INC0010001')} eff={eff()} />);
  await rewrite(ui);
  await ui.rerender(<ComposeView page={pageOf(B, 'INC0010002')} eff={eff()} />);
  assert.match(ui.text(), /This was written for INC0010001/);
  assert.equal(ui.button('Add below').disabled, true);
  assert.equal(ui.button('Replace what is in the form').disabled, true);
  await click(ui.button('Copy'));
  assert.equal(fake.fills().length, 0, 'Copy works; nothing went into the other ticket');
  await ui.unmount();
});

test('what was typed in one Write tool survives a look at the others', async () => {
  setup();
  const ui = await mount(<ComposeView page={pageOf(A, 'INC0010001')} eff={eff()} />);
  await click(ui.tab('Rewrite'));
  await type(ui.field('Text to rewrite'), 'half a draft');
  await click(ui.tab('Notes to ticket'));
  await type(ui.field('Rough notes from the call, chat or visit'), 'vpn down since 9');
  await click(ui.tab('Snippets'));
  await click(ui.tab('Rewrite'));
  assert.equal(ui.field('Text to rewrite').value, 'half a draft');
  await click(ui.tab('Notes to ticket'));
  assert.equal(ui.field('Rough notes from the call, chat or visit').value, 'vpn down since 9');
  await ui.unmount();
});

test('the snippet editor takes the focus when it opens and gives it back when it closes', async () => {
  setup();
  const ui = await mount(<ComposeView page={pageOf(A, 'INC0010001')} eff={eff()} />);
  await click(ui.tab('Snippets'));
  await click(ui.button('New snippet'));
  assert.equal(focused().id, 'ab-snip-title', 'the focus is in the Title box');
  await click(ui.button('Cancel'));
  assert.equal(focused().textContent, 'New snippet', 'the focus is back where the editor was opened from');
  await ui.unmount();
});

test('without an AI key each tool says so and offers the way to Settings', async () => {
  const fake = setup();
  const ui = await mount(<ComposeView page={pageOf(A, 'INC0010001')} eff={eff('')} />);
  await click(ui.tab('Rewrite'));
  assert.match(ui.text(), /Add an AI key in Settings to use this\./);
  await click(ui.button('Open Settings'));
  assert.equal(fake.optionsOpened, 1);
  await ui.unmount();
});
