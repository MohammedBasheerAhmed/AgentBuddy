import { mount, settle, makeChrome, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { usePage } from '../src/sidepanel/usePage.js';

// usePage follows the active browser tab. A switch of tab (or a navigation) while the previous look is still waiting for its answer
// used to be dropped: the panel then kept showing the page it had, for up to one poll (2.5 seconds), and an action clicked in that time
// went to the wrong ticket's view.

const SYS = 'a'.repeat(32);
const stateFor = (tabId, number) => ({ href: `https://acme.service-now.com/incident.do?sys_id=${SYS}`, surface: 'classic', record: { table: 'incident', sysId: SYS, number, kind: 'incident' }, user: { name: 'Beth' }, form: null });

function Probe() {
  const { page } = usePage();
  return <p>{`${page.status}|${page.tabId ?? ''}|${page.record?.number ?? ''}`}</p>;
}

test('a tab switch while the last look is still on its way is followed at once, not at the next poll', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const slow = deferred();
  fake.activeTab = { id: 7, url: 'https://acme.service-now.com/incident.do' };
  fake.onPageState((tabId) => (tabId === 7 ? slow.promise : stateFor(8, 'INC0000008')));
  const ui = await mount(<Probe />);
  assert.match(ui.text(), /^loading/);

  // The person switches to another ServiceNow tab while the first look still waits.
  fake.activeTab = { id: 8, url: 'https://acme.service-now.com/incident.do' };
  fake.chrome.tabs.onActivated.fire({ tabId: 8 });
  await during(() => slow.resolve(stateFor(7, 'INC0000007')));
  await settle(4);
  assert.equal(ui.text(), 'record|8|INC0000008', 'the panel is on the tab that is active now');
  await ui.unmount();
});

test('the listeners and the poll stop when the panel goes away', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onPageState(() => stateFor(7, 'INC0000007'));
  const ui = await mount(<Probe />);
  assert.equal(ui.text(), 'record|7|INC0000007');
  assert.equal(fake.chrome.tabs.onActivated.count, 1);
  await ui.unmount();
  assert.equal(fake.chrome.tabs.onActivated.count, 0);
  assert.equal(fake.chrome.tabs.onUpdated.count, 0);
  assert.equal(fake.chrome.tabs.onRemoved.count, 0);
});
