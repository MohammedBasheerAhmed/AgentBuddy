import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INSTANCES_SETTINGS_PAGE, wirePanelScope } from '../src/background/panelScopeWire.js';
import { clickPlan } from '../src/background/panelScope.js';
import { handleCommand } from '../src/background/commands.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { PANEL_PAGE, openPanel, wireToolbarButton } from '../src/lib/platform.js';
import { settingsPageFromHash } from '../src/options/Options.jsx';
import { EXT_ID, world } from './panel-scope-fake.js';

// The panel only on the sites the person added (Chrome and Edge), with a fake Chrome (tests/panel-scope-fake.js): the default is off
// when the worker starts, every tab is set, tab events set that tab, the toolbar button and the shortcuts open the panel in the turn of
// the click, and nothing here throws out of a listener. The rules themselves are in tests/panel-scope-rules.test.js.

const A = 'https://acme.service-now.com';
const SN_NOT_ADDED = 'https://dev1.service-now.com';
const CUSTOM = 'https://servicenow.acme.example';
const ON = { path: PANEL_PAGE, enabled: true };

const wire = (w) => wirePanelScope(w.api, { activeOrigins: w.activeOrigins });
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const instancesChanged = (from, to) => ({ [SETTINGS_KEY]: { oldValue: { instances: from }, newValue: { instances: to } } });

// ---- at every start -------------------------------------------------------------------------------------------------------------------

test('at start the default is off and every open tab is set: on for the pages of added sites only', async () => {
  const w = world({
    tabs: [
      { id: 1, url: `${A}/incident.do` },
      { id: 2, url: 'https://ifbash.com/' },
      { id: 3, url: 'chrome://extensions/' },
      { id: 4 },
      { id: 5, url: `${SN_NOT_ADDED}/` },
      { id: 6, url: `${CUSTOM}/incident.do` },
    ],
    active: [A, CUSTOM],
  });
  const scope = wire(w);
  assert.equal(scope.active, true);
  assert.deepEqual(w.writes()[0], ['setOptions', { enabled: false }], 'the default first, in the turn the worker starts');
  await scope.idle();
  assert.deepEqual(w.defaultOptions().enabled, false);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => w.enabled(id)), [true, false, false, false, false, true]);
  assert.deepEqual(w.panelOptions(1), ON, 'an added tab gets the panel page');
  assert.deepEqual(w.writes().filter(([name, options]) => name === 'setOptions' && options.tabId !== undefined), [
    ['setOptions', { tabId: 1, ...ON }],
    ['setOptions', { tabId: 6, ...ON }],
  ], 'tabs that are off already are not asked again');
});

test('the worker waking up again (it is stopped when idle) recomputes everything from the browser, and changes nothing that is right', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }, { id: 2, url: 'https://ifbash.com/' }], active: [A] });
  await wire(w).idle();
  w.forget();
  w.restart();
  await wire(w).idle();
  assert.deepEqual(w.writes(), [['setOptions', { enabled: false }]], 'the default is said again; no tab is asked: the browser has them right already');
  assert.deepEqual([w.enabled(1), w.enabled(2)], [true, false]);

  // the list of sites changed while the worker was stopped (the person turned a site off in Settings): the next wake-up puts it right
  w.forget();
  w.restart();
  w.active = [];
  w.granted = [];
  await wire(w).idle();
  assert.equal(w.enabled(1), false);
  assert.deepEqual(w.writes(), [['setOptions', { enabled: false }], ['setOptions', { tabId: 1, enabled: false }]]);
});

test('with no site added no tab has the panel; a browser start with the panel on from before is switched off', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }, { id: 2, url: 'https://ifbash.com/' }], active: [] });
  await wire(w).idle();
  assert.deepEqual([w.enabled(1), w.enabled(2)], [false, false]);
});

// ---- tab events -----------------------------------------------------------------------------------------------------------------------

test('a tab that goes to an added site gets the panel; one that leaves it loses it, and an open panel there closes', async () => {
  const w = world({ tabs: [{ id: 2, url: 'https://ifbash.com/' }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.setUrl(2, `${A}/incident.do`);
  w.events.tabsUpdated.fire(2, { url: `${A}/incident.do` }, {});
  await scope.idle();
  assert.equal(w.enabled(2), true);
  w.openPanels.add(2); // (the person opened it)
  w.setUrl(2, 'https://ifbash.com/');
  w.events.tabsUpdated.fire(2, { status: 'complete' }, {});
  await scope.idle();
  assert.equal(w.enabled(2), false);
  assert.equal(w.openPanels.has(2), false, 'a panel on a tab that became disabled closes by itself');
});

test('moving inside an added site, or a load on it, leaves an open panel alone (nothing is asked of the browser)', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  w.setUrl(1, `${A}/incident.do?sys_id=1`);
  for (const change of [{ status: 'loading' }, { url: `${A}/incident.do?sys_id=1` }, { status: 'complete' }]) w.events.tabsUpdated.fire(1, change, {});
  await scope.idle();
  assert.deepEqual(w.writes(), []);
});

test('a title, a sound or an icon changing is not looked at', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  for (const change of [{ title: 'x' }, { audible: true }, { favIconUrl: 'x' }, {}]) w.events.tabsUpdated.fire(1, change, {});
  await scope.idle();
  assert.deepEqual(w.reads, [], 'not even a question');
});

test('a tab made, shown or replaced is looked at (tabs made before the worker woke are covered by the start)', async () => {
  const w = world({ tabs: [], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.addTab({ id: 7, url: `${A}/` }); // e.g. "duplicate tab" of an added site
  w.events.tabsCreated.fire({ id: 7 });
  await scope.idle();
  assert.equal(w.enabled(7), true);

  w.addTab({ id: 8, url: `${A}/` });
  w.events.tabsActivated.fire({ tabId: 8, windowId: 1 });
  await scope.idle();
  assert.equal(w.enabled(8), true);

  w.closeTab(7);
  w.addTab({ id: 9, url: `${A}/` });
  w.events.tabsReplaced.fire(9, 7);
  await scope.idle();
  assert.equal(w.enabled(9), true);

  w.setUrl(8, 'https://ifbash.com/');
  w.events.tabsActivated.fire({ tabId: 8 });
  await scope.idle();
  assert.equal(w.enabled(8), false);
});

test('a tab that closed before its turn, or an event with no tab, is ignored', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  w.events.tabsUpdated.fire(404, { status: 'complete' }, {});
  w.events.tabsActivated.fire({});
  w.events.tabsActivated.fire(undefined);
  w.events.tabsCreated.fire(undefined);
  w.events.tabsReplaced.fire(undefined, 3);
  await scope.idle();
  assert.deepEqual(w.writes(), []);
});

test('a tab looked at again after the page changed under a slow answer ends up right (the address is read afresh in its turn)', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A], afterQuery: () => w.setUrl(1, 'https://ifbash.com/') });
  const scope = wire(w);
  await scope.idle(); // the start's query saw the added site; by the time its turn came the tab was elsewhere
  assert.equal(w.enabled(1), false);
});

// ---- permissions and storage ----------------------------------------------------------------------------------------------------------

test('a permission added for an organisation\'s site switches its open tab on; one removed switches it off', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [], granted: [] });
  const scope = wire(w);
  await scope.idle();
  assert.equal(w.enabled(1), false, 'the address is not visible and the site is not added');
  w.active = [A];
  w.granted = [A];
  w.events.permAdded.fire({ origins: [`${A}/*`] });
  await scope.idle();
  assert.equal(w.enabled(1), true);
  w.active = [];
  w.granted = [];
  w.events.permRemoved.fire({ origins: [`${A}/*`] });
  await scope.idle();
  assert.equal(w.enabled(1), false);
});

test('"Turn on for this site": the permission arrives before the site is saved, and the panel the person is using stays open throughout', async () => {
  const w = world({ tabs: [{ id: 1, url: `${SN_NOT_ADDED}/` }], active: [], granted: [] });
  const scope = wire(w);
  await scope.idle();
  assert.equal(w.enabled(1), false);
  // the click on the toolbar button opens the panel on a ServiceNow page that is not added yet
  assert.equal(await w.userDoes(() => scope.onToolbarClick(w.clickTab(1))), 'opened');
  assert.equal(w.openPanels.has(1), true);
  // the panel asks for the permission; the browser grants it; the worker hears of it first ...
  w.granted = [SN_NOT_ADDED];
  w.events.permAdded.fire({ origins: [`${SN_NOT_ADDED}/*`] });
  await scope.idle();
  assert.equal(w.openPanels.has(1), true, 'the site is not saved yet, but the panel is not switched off under the person');
  // ... then the panel asks the worker to save the site
  w.active = [SN_NOT_ADDED];
  w.events.storageChanged.fire(instancesChanged([], [SN_NOT_ADDED]), 'local');
  await scope.idle();
  assert.equal(w.openPanels.has(1), true);
  assert.equal(w.enabled(1), true);
  // turning the site off in Settings closes it
  w.active = [];
  w.granted = [];
  w.events.storageChanged.fire(instancesChanged([SN_NOT_ADDED], []), 'local');
  await scope.idle();
  assert.equal(w.enabled(1), false);
  assert.equal(w.openPanels.has(1), false);
});

test('only a change to the list of sites or to the organisation\'s policy looks at the tabs again', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  w.events.storageChanged.fire({ some_log: { newValue: 1 } }, 'local');
  w.events.storageChanged.fire({ [SETTINGS_KEY]: { oldValue: { instances: [A], model: 'a' }, newValue: { instances: [A], model: 'b' } } }, 'local');
  w.events.storageChanged.fire(instancesChanged([], [A]), 'session');
  await scope.idle();
  assert.deepEqual(w.reads, [], 'nothing asked');

  w.active = [];
  w.events.storageChanged.fire({ allowedInstances: { newValue: ['https://other.service-now.com'] } }, 'managed');
  await scope.idle();
  assert.equal(w.enabled(1), false, 'the policy changed: every tab looked at again');
});

// ---- the toolbar button ---------------------------------------------------------------------------------------------------------------

test('the toolbar button: the browser opens nothing by itself, the extension handles the click', () => {
  const w = world({ tabs: [], active: [] });
  const scope = wire(w);
  assert.equal(wireToolbarButton(w.api, scope.onToolbarClick), 'side-panel');
  assert.deepEqual(w.writes().filter(([name]) => name === 'behavior'), [['behavior', { openPanelOnActionClick: false }]]);
  assert.equal(w.events.actionClicked.listeners.length, 1);
  assert.equal(wireToolbarButton(w.api, scope.onToolbarClick), 'side-panel');
  assert.equal(w.events.actionClicked.listeners.length, 1, 'wired once');
});

test('without a click handler the browser keeps opening the panel itself; Firefox and Safari ignore a handler', () => {
  const plain = world();
  wireToolbarButton(plain.api);
  assert.deepEqual(plain.writes(), [['behavior', { openPanelOnActionClick: true }]]);
  assert.equal(plain.events.actionClicked.listeners.length, 0);

  const calls = [];
  const firefox = { sidebarAction: { open: () => Promise.resolve(), toggle: () => (calls.push('toggle'), Promise.resolve()) }, action: { onClicked: { listeners: [], addListener(fn) { this.listeners.push(fn); } } } };
  wireToolbarButton(firefox, () => calls.push('handler'));
  firefox.action.onClicked.listeners[0]({ id: 1 });
  assert.deepEqual(calls, ['toggle'], 'the sidebar is toggled as before; the handler is not used');
});

test('a click on an added site opens the panel, in the turn of the click (the panel is on for the tab before the click)', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/incident.do` }, { id: 6, url: `${CUSTOM}/incident.do` }], active: [A, CUSTOM] });
  const scope = wire(w);
  wireToolbarButton(w.api, scope.onToolbarClick);
  await scope.idle();
  assert.equal(w.enabled(1), true, 'on before the click');
  w.forget();

  // a site on its own web address: only open() is asked
  w.userDoes(() => w.events.actionClicked.fire(w.clickTab(6)));
  assert.deepEqual(w.writes(), [['open', { tabId: 6 }]], 'asked inside the click, before anything is awaited');
  await settle();
  assert.equal(w.openPanels.has(6), true);

  // a *.service-now.com site: the panel is also (re)asserted on in the same turn, which changes nothing there
  w.forget();
  const result = w.userDoes(() => scope.onToolbarClick(w.clickTab(1)));
  assert.deepEqual(w.writes(), [['setOptions', { tabId: 1, ...ON }], ['open', { tabId: 1 }]], 'both in the turn of the click, in this order');
  assert.equal(await result, 'opened');
  assert.equal(w.openPanels.has(1), true);
});

test('a click on a ServiceNow page that is not added switches the panel on for that tab and opens it, for "Turn on for this site"', async () => {
  const w = world({ tabs: [{ id: 5, url: `${SN_NOT_ADDED}/incident.do` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  assert.equal(w.enabled(5), false);
  w.forget();
  const result = w.userDoes(() => scope.onToolbarClick(w.clickTab(5)));
  assert.deepEqual(w.writes(), [['setOptions', { tabId: 5, ...ON }], ['open', { tabId: 5 }]], 'setOptions is not awaited: open() follows in the same turn');
  assert.equal(await result, 'opened');
  assert.equal(w.openPanels.has(5), true);
  assert.deepEqual(w.writes().filter(([name]) => name === 'tabs.create'), [], 'Settings is not opened');
});

test('a click on any other page does not open the panel: it opens Settings at the ServiceNow sites', async () => {
  const w = world({ tabs: [{ id: 2, url: 'https://ifbash.com/' }, { id: 3, url: 'chrome://newtab/' }, { id: 4 }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  for (const id of [2, 3, 4]) {
    w.forget();
    const result = w.userDoes(() => scope.onToolbarClick(w.clickTab(id)));
    assert.deepEqual(w.writes(), [['open', { tabId: id }]], 'the browser is asked first, and refuses: the panel is off there');
    assert.equal(await result, 'settings');
    assert.deepEqual(w.writes(), [['open', { tabId: id }], ['tabs.create', { url: `chrome-extension://${EXT_ID}/options.html#h-instances` }]]);
    assert.equal(w.openPanels.has(id), false);
    assert.equal(w.enabled(id), false, 'and it is not switched on for the tab');
  }
});

test('a page of a site on its own web address that is not added yet: the click takes the person to Settings, where it is added', async () => {
  const w = world({ tabs: [{ id: 6, url: `${CUSTOM}/incident.do` }], active: [A] });
  const scope = wire(w);
  await scope.idle();
  assert.equal(await w.userDoes(() => scope.onToolbarClick(w.clickTab(6))), 'settings');
});

test('if the tab cannot be opened in a new page, Settings opens the usual way; if that fails too, nothing throws', async () => {
  const w = world({ tabs: [{ id: 2, url: 'https://ifbash.com/' }], active: [], createFails: true });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  assert.equal(await w.userDoes(() => scope.onToolbarClick(w.clickTab(2))), 'settings');
  assert.deepEqual(w.writes().map(([name]) => name), ['open', 'tabs.create', 'openOptionsPage']);
  w.api.runtime.openOptionsPage = () => Promise.reject(new Error('no'));
  assert.equal(await w.userDoes(() => scope.onToolbarClick(w.clickTab(2))), 'settings');
});

test('a click on an added site whose panel was not on yet (the browser has just started): nothing opens, Settings does not either, and the tab is put right for the next click', async () => {
  const w = world({ tabs: [{ id: 1, url: `${CUSTOM}/` }], active: [CUSTOM] });
  const scope = wire(w);
  // (before the start finished: nothing is on yet)
  const result = w.userDoes(() => scope.onToolbarClick(w.clickTab(1)));
  assert.equal(await result, 'failed');
  assert.deepEqual(w.writes().filter(([name]) => name === 'tabs.create'), [], 'Settings is the answer for a page that is not a site to add');
  await scope.idle();
  assert.equal(w.enabled(1), true);
  assert.equal(await w.userDoes(() => scope.onToolbarClick(w.clickTab(1))), 'opened');
});

test('the fake is honest: a click that awaits before asking is refused (so the order of calls above is a real test)', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
  await wire(w).idle();
  await assert.rejects(
    w.userDoes(async () => {
      await null;
      return openPanel(w.api, 1);
    }),
    /user gesture/
  );
  assert.equal(w.openPanels.has(1), false);
});

test('a click with no tab, or a tab with no id, is ignored', async () => {
  const w = world({ tabs: [], active: [] });
  const scope = wire(w);
  await scope.idle();
  w.forget();
  assert.equal(await scope.onToolbarClick(undefined), 'ignored');
  assert.equal(await scope.onToolbarClick({ url: 'https://ifbash.com/' }), 'ignored');
  assert.equal(await scope.onToolbarClick({ id: -1 }), 'ignored');
  assert.deepEqual(w.writes(), []);
});

// ---- the keyboard shortcuts and the bar ---------------------------------------------------------------------------------------------

function commandDeps(w) {
  const asked = [];
  return {
    asked,
    deps: {
      // exactly as the worker builds it (src/background/service-worker.js)
      openPanel: (tabId, tab) => (asked.push([tabId, tab?.url]), openPanel(w.api, tabId, clickPlan(tab))),
      pageState: async () => ({ record: null }),
      activeInstances: async () => [...w.active],
      loadSettings: async () => ({ quickPins: {} }),
      loadPolicy: async () => normalizePolicy({}),
      aiOn: async () => true,
      saveLaunch: async () => {},
      now: () => 1000,
    },
  };
}

test('the shortcut opens the panel on an added site, quietly does nothing on any other page, and uses "Turn on" on an unadded ServiceNow page', async () => {
  const w = world({ tabs: [{ id: 1, url: `${A}/` }, { id: 2, url: 'https://ifbash.com/' }, { id: 5, url: `${SN_NOT_ADDED}/` }, { id: 6, url: `${CUSTOM}/` }], active: [A, CUSTOM] });
  const scope = wire(w);
  await scope.idle();
  const { asked, deps } = commandDeps(w);

  w.forget();
  assert.deepEqual(await w.userDoes(() => handleCommand('open-panel', w.clickTab(1), deps)), { opened: true, started: false });
  assert.deepEqual(w.writes()[w.writes().length - 1], ['open', { tabId: 1 }]);
  assert.equal(w.openPanels.has(1), true);

  w.forget();
  assert.deepEqual(await w.userDoes(() => handleCommand('open-panel', w.clickTab(6), deps)), { opened: true, started: false });
  assert.deepEqual(w.writes(), [['open', { tabId: 6 }]]);

  w.forget();
  assert.deepEqual(await w.userDoes(() => handleCommand('open-panel', w.clickTab(2), deps)), { opened: false, started: false }, 'ifbash.com: the panel is off there and stays off');
  assert.deepEqual(w.writes(), [['open', { tabId: 2 }]], 'no setOptions, no new tab');
  assert.equal(w.openPanels.has(2), false);
  assert.equal(w.enabled(2), false);

  w.forget();
  assert.deepEqual(await w.userDoes(() => handleCommand('summarise', w.clickTab(5), deps)), { opened: true, started: false }, 'the panel for "Turn on for this site"; no action is started');
  assert.deepEqual(w.writes(), [['setOptions', { tabId: 5, ...ON }], ['open', { tabId: 5 }]]);
  assert.equal(w.openPanels.has(5), true);

  assert.deepEqual(asked.map(([id]) => id), [1, 6, 2, 5], 'the tab is handed to the opener');
  assert.equal(asked[0][1], `${A}/`);
});

test('the shortcut on a page that is not an added site also leaves the reply and summarise commands without a panel', async () => {
  const w = world({ tabs: [{ id: 2, url: 'https://ifbash.com/' }], active: [A] });
  await wire(w).idle();
  const { deps } = commandDeps(w);
  for (const command of ['summarise', 'reply']) {
    assert.deepEqual(await w.userDoes(() => handleCommand(command, w.clickTab(2), deps)), { opened: false, started: false }, command);
  }
  assert.equal(w.openPanels.size, 0);
});

test('the bar on an added site opens the panel by tab id alone, as before (the tab is on already)', async () => {
  const w = world({ tabs: [{ id: 1, url: `${CUSTOM}/` }], active: [CUSTOM] });
  await wire(w).idle();
  w.forget();
  await w.userDoes(() => openPanel(w.api, 1, clickPlan(undefined)));
  assert.deepEqual(w.writes(), [['open', { tabId: 1 }]]);
  assert.equal(w.openPanels.has(1), true);
});

// ---- nothing throws out of a listener ---------------------------------------------------------------------------------------------------

test('the browser refusing a call, a tab that vanishes or an unreadable list of sites never throws out of a listener, nor leaves a promise unhandled', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const flags of [{ failSetOptions: true }, { failGetOptions: true }, { failTabsGet: true }, { createFails: true }]) {
      const w = world({ tabs: [{ id: 1, url: `${A}/` }, { id: 2, url: 'https://ifbash.com/' }], active: [A], ...flags });
      let scope;
      assert.doesNotThrow(() => { scope = wire(w); }, JSON.stringify(flags));
      wireToolbarButton(w.api, scope.onToolbarClick);
      assert.doesNotThrow(() => {
        w.events.tabsUpdated.fire(1, { status: 'complete' }, {});
        w.events.tabsCreated.fire({ id: 2 });
        w.events.tabsActivated.fire({ tabId: 1 });
        w.events.tabsReplaced.fire(2, 3);
        w.events.permAdded.fire({});
        w.events.permRemoved.fire({});
        w.events.storageChanged.fire({}, 'managed');
      }, JSON.stringify(flags));
      await scope.idle();
      assert.doesNotThrow(() => w.userDoes(() => w.events.actionClicked.fire(w.clickTab(2))), JSON.stringify(flags));
      assert.doesNotThrow(() => w.userDoes(() => w.events.actionClicked.fire(w.clickTab(1))), JSON.stringify(flags));
      await scope.idle();
    }
    // a failing list of sites: nothing is changed (reading badly must not switch every panel off)
    const w = world({ tabs: [{ id: 1, url: `${A}/` }], active: [A] });
    let broken = false;
    const scope = wirePanelScope(w.api, { activeOrigins: async () => { if (broken) throw new Error('storage is gone'); return [...w.active]; } });
    await scope.idle();
    assert.equal(w.enabled(1), true);
    broken = true;
    w.forget();
    w.events.permRemoved.fire({});
    w.events.tabsUpdated.fire(1, { status: 'complete' }, {});
    await scope.idle();
    assert.equal(w.enabled(1), true);
    assert.deepEqual(w.writes(), []);
    await settle(5);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// ---- the other browsers --------------------------------------------------------------------------------------------------------------

test('Firefox and Safari are left as they are: no listener, no call, no handler', async () => {
  const calls = [];
  const spy = () => ({ addListener: () => calls.push('listener') });
  const firefox = { sidebarAction: { open: () => Promise.resolve() }, tabs: { onCreated: spy(), onUpdated: spy(), query: () => (calls.push('query'), Promise.resolve([])) }, permissions: { onAdded: spy(), onRemoved: spy() }, storage: { onChanged: spy() } };
  for (const api of [firefox, {}, undefined, null]) {
    const scope = wirePanelScope(api, { activeOrigins: async () => [A] });
    assert.equal(scope.active, false);
    assert.equal(scope.onToolbarClick, undefined);
    await scope.idle();
    await scope.syncAll();
    await scope.syncTab(1);
  }
  assert.deepEqual(calls, []);
});

// ---- the page the panel is, and where Settings opens ------------------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('the manifest is untouched by this: no tabs permission, the same panel page, the same Settings page', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.permissions, ['storage', 'sidePanel', 'scripting', 'activeTab'], 'no `tabs` permission');
  assert.equal(manifest.side_panel.default_path, PANEL_PAGE, 'the page switched on per tab is the manifest\'s');
  assert.equal(manifest.options_ui.page, INSTANCES_SETTINGS_PAGE.split('#')[0]);
});

test('Settings opens on the ServiceNow sites section: the address names the heading that is there', () => {
  assert.equal(INSTANCES_SETTINGS_PAGE, 'options.html#h-instances');
  assert.match(read('src', 'options', 'basics', 'InstancesSection.jsx'), /SectionHead id="h-instances"/);
  assert.equal(settingsPageFromHash('#h-instances'), 'basics', 'on the page called Basics');
  // the page follows an address that names a section: it pins it in the menu and scrolls to it (src/options/Options.jsx SettingsPages)
  assert.match(read('src', 'options', 'Options.jsx'), /\^h-\[a-z-\]\+\$/);
  assert.ok(/^h-[a-z-]+$/.test('h-instances'));
});

test('the worker wires it at the top level, on every start, and only platform.js talks to the browser\'s panel', () => {
  const worker = read('src', 'background', 'service-worker.js');
  assert.match(worker, /^const panelScope = wirePanelScope\(api, \{ activeOrigins: \(\) => activeInstances\(\) \}\);$/m);
  assert.match(worker, /^wireToolbarButton\(api, panelScope\.onToolbarClick\);$/m);
  const wireSource = read('src', 'background', 'panelScopeWire.js') + read('src', 'background', 'panelScope.js');
  assert.ok(!/\.(sidePanel|sidebarAction)\b|setPanelBehavior\(/.test(wireSource), 'platform.js is the only place that knows the panel API');
  assert.ok(!/localStorage|sessionStorage|chrome\.storage/.test(wireSource), 'nothing is remembered: the browser is the state');
});
