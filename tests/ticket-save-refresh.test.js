import { mount, settle, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView, { SAVE_SETTLE_MS } from '../src/sidepanel/ticket/TicketView.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// N1: the ticket header follows a Save on the page. The content script's formStamp changes when the form reloads after Save (or a
// Workspace's Save is pressed); the Ticket screen then reads the header of the same record again, once, after a short wait.

const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';
const eff = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'], profilesConfirmed: true }, {}), apiKey: '', keyLocked: false };
const pageOf = (sysId, formStamp) => ({
  status: 'record',
  tabId: 7,
  href: `${ORIGIN}/incident.do?sys_id=${sysId}`,
  surface: 'classic',
  portal: null,
  record: { table: 'incident', sysId, number: sysId === SYS ? 'INC0010001' : 'INC0010002', kind: 'incident' },
  newRecord: null,
  user: { name: 'Beth Anglin' },
  formStamp,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  let state = 'In Progress';
  fake.onRead('header', (args) => ({ number: args.sysId === SYS ? 'INC0010001' : 'INC0010002', short_description: 'VPN drops', state, priority: '3 - Moderate' }));
  return { fake, setState: (s) => (state = s) };
}

test('a Save on the page (a new form stamp, same record) reads the header again, and shows the new state', async () => {
  const { fake, setState } = setup();
  const ui = await mount(<TicketView page={pageOf(SYS, '1730000000000:0')} eff={eff} />);
  assert.equal(fake.readsOf('header').length, 1);
  // The page polls again with nothing new: nothing is read.
  await ui.rerender(<TicketView page={pageOf(SYS, '1730000000000:0')} eff={eff} />);
  assert.equal(fake.readsOf('header').length, 1);
  // Saved: the form reloaded (a new load time). The header is read after the wait, not at once.
  setState('Resolved');
  await ui.rerender(<TicketView page={pageOf(SYS, '1730000009999:0')} eff={eff} />);
  assert.equal(fake.readsOf('header').length, 1, 'not before the wait');
  await wait(SAVE_SETTLE_MS + 100);
  await settle();
  assert.equal(fake.readsOf('header').length, 2);
  assert.match(ui.text(), /Resolved/);
  // A Workspace Save (the count goes up, no reload) does the same.
  await ui.rerender(<TicketView page={pageOf(SYS, '1730000009999:1')} eff={eff} />);
  await wait(SAVE_SETTLE_MS + 100);
  await settle();
  assert.equal(fake.readsOf('header').length, 3);
  await ui.unmount();
});

test('another record is read once by its own change, never twice because its stamp differs too', async () => {
  const { fake } = setup();
  const ui = await mount(<TicketView page={pageOf(SYS, '1730000000000:0')} eff={eff} />);
  await ui.rerender(<TicketView page={pageOf(SYS_B, '1730000005555:0')} eff={eff} />);
  await wait(SAVE_SETTLE_MS + 100);
  await settle();
  assert.deepEqual(fake.readsOf('header').map((a) => a.sysId), [SYS, SYS_B]);
  await ui.unmount();
});

test('a page without a stamp (an older content script) never triggers a read', async () => {
  const { fake } = setup();
  const ui = await mount(<TicketView page={pageOf(SYS, undefined)} eff={eff} />);
  await ui.rerender(<TicketView page={pageOf(SYS, '1730000000000:0')} eff={eff} />);
  await wait(SAVE_SETTLE_MS + 100);
  await settle();
  assert.equal(fake.readsOf('header').length, 1);
  await ui.unmount();
});
