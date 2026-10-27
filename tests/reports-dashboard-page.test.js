const test = require('node:test');
const assert = require('node:assert/strict');
import { parseTabId, checkSourceTab } from '../src/dashboard/sourceTab.js';
import { listUrl, openList, openTicket, openInPageTab } from '../src/sidepanel/reports/drill.js';
import { MSG } from '../src/lib/messages.js';

const SN = 'https://acme.service-now.com';
const fakeApi = ({ tab = { id: 7, url: `${SN}/incident_list.do`, windowId: 3 }, ping = { ok: true }, tabError, pingError } = {}) => {
  const sent = [];
  return {
    sent,
    tabs: {
      get: async (id) => {
        if (tabError) throw new Error('No tab with id');
        return id === tab?.id ? tab : undefined;
      },
      sendMessage: async (id, message) => {
        sent.push({ id, message });
        if (pingError) throw new Error('Could not establish connection. Receiving end does not exist.');
        return ping;
      },
    },
  };
};

test('the tab id comes from the address, and only a real positive id counts', () => {
  assert.equal(parseTabId('?tab=7'), 7);
  assert.equal(parseTabId('?x=1&tab=1234'), 1234);
  for (const bad of ['', '?tab=', '?tab=0', '?tab=-3', '?tab=1.5', '?tab=abc', '?tab=7;rm', '?tab=99999999999', null, undefined]) assert.equal(parseTabId(bad), 0, String(bad));
});

test('a live, enabled ServiceNow tab is ready, and the page learns its address and window', async () => {
  const api = fakeApi();
  const out = await checkSourceTab(7, api);
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.page, { tabId: 7, href: `${SN}/incident_list.do`, windowId: 3, surface: 'classic', status: 'no-record' });
  assert.deepEqual(api.sent, [{ id: 7, message: { type: MSG.PING } }], 'it asks the content script of that tab, nothing else');
});

test('no tab in the address, a closed tab, and a tab without the content script are told apart', async () => {
  assert.deepEqual(await checkSourceTab(0, fakeApi()), { status: 'no-tab' });
  assert.deepEqual(await checkSourceTab(7, fakeApi({ tabError: true })), { status: 'gone' });
  assert.deepEqual(await checkSourceTab(8, fakeApi()), { status: 'gone' }, 'the browser has no such tab');
  assert.deepEqual(await checkSourceTab(7, fakeApi({ pingError: true })), { status: 'not-enabled' });
  assert.deepEqual(await checkSourceTab(7, fakeApi({ ping: { ok: false } })), { status: 'not-enabled' });
  assert.deepEqual(await checkSourceTab(7, fakeApi({ ping: null })), { status: 'not-enabled' });
});

test('a tab whose address is not a web page is not used', async () => {
  for (const url of ['', undefined, 'chrome://extensions', 'file:///etc/passwd', 'chrome-extension://abc/x.html']) {
    assert.deepEqual(await checkSourceTab(7, fakeApi({ tab: { id: 7, url, windowId: 1 } })), { status: 'not-enabled' }, String(url));
  }
});

test('a list address is nav_to.do with the query encoded twice, on the instance of the page only', () => {
  const page = { href: `${SN}/now/nav/ui/classic/params/target/incident_list.do`, tabId: 7 };
  const url = listUrl(page, 'incident', 'active=true^assigned_to=abc');
  assert.equal(url, `${SN}/nav_to.do?uri=${encodeURIComponent('incident_list.do?sysparm_query=active%3Dtrue%5Eassigned_to%3Dabc')}`);
  // Decoding once (what nav_to does) leaves a normal list address.
  const uri = new URL(url).searchParams.get('uri');
  assert.equal(uri, 'incident_list.do?sysparm_query=active%3Dtrue%5Eassigned_to%3Dabc');
  assert.equal(decodeURIComponent(new URL(`${SN}/x?${uri.split('?')[1]}`).searchParams.get('sysparm_query')), 'active=true^assigned_to=abc');
  assert.equal(listUrl(page, 'task_sla', 'a=1'), `${SN}/nav_to.do?uri=${encodeURIComponent('task_sla_list.do?sysparm_query=a%3D1')}`);
});

test('a list address refuses a bad table, a huge query and a page without an address', () => {
  const page = { href: `${SN}/x`, tabId: 7 };
  for (const table of ['', 'a;b', '../x', 'A', 'a b', null]) assert.equal(listUrl(page, table, 'a=1'), '', String(table));
  assert.equal(listUrl(page, 'incident', 'x'.repeat(7000)), '');
  assert.equal(listUrl({ href: 'not a url', tabId: 7 }, 'incident', 'a=1'), '');
  assert.equal(listUrl({ tabId: 7 }, 'incident', 'a=1'), '');
});

test('opening goes to the page\'s own tab and instance; the full page also brings that tab forward', () => {
  const updates = [];
  const windows = [];
  globalThis.chrome = { tabs: { update: (id, props) => updates.push({ id, props }) }, windows: { update: (id, props) => windows.push({ id, props }) } };
  const page = { href: `${SN}/x`, tabId: 7, windowId: 3, surface: 'classic' };
  assert.equal(openList(page, 'incident', 'active=true'), true);
  assert.deepEqual(updates[0], { id: 7, props: { url: listUrl(page, 'incident', 'active=true') } });
  assert.equal(windows.length, 0);
  assert.equal(openList(page, 'incident', 'active=true', { focus: true }), true);
  assert.equal(updates[1].props.active, true);
  assert.deepEqual(windows[0], { id: 3, props: { focused: true } });
  const sysId = 'a'.repeat(32);
  assert.equal(openTicket(page, { table: 'incident', sysId }), true);
  assert.match(updates[2].props.url, new RegExp(`^${SN}/nav_to\\.do\\?uri=incident\\.do`));
});

test('nothing outside the instance of the page is ever opened', () => {
  const updates = [];
  globalThis.chrome = { tabs: { update: (id, props) => updates.push({ id, props }) } };
  const page = { href: `${SN}/x`, tabId: 7 };
  assert.equal(openInPageTab(page, 'https://evil.example/nav_to.do'), false);
  assert.equal(openInPageTab(page, `${SN}.evil.example/x`), false);
  assert.equal(openInPageTab(page, 'javascript:alert(1)'), false);
  assert.equal(openInPageTab(page, ''), false);
  assert.equal(openTicket(page, { table: 'incident', sysId: 'short' }), false);
  assert.equal(updates.length, 0);
});

test('a tab that went away does not throw', () => {
  globalThis.chrome = { tabs: { update: () => { throw new Error('No tab with id'); } } };
  assert.equal(openList({ href: `${SN}/x`, tabId: 7 }, 'incident', 'a=1'), false);
});
