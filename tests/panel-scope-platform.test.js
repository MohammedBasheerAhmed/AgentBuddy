import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_PAGE, canScopePanel, openPanel, panelEnabledFor, setPanelDefault, setPanelForTab, wireToolbarButton } from '../src/lib/platform.js';
import { world } from './panel-scope-fake.js';

// src/lib/platform.js, the part that switches the side panel on and off tab by tab and opens it with it. With the fake Chrome of
// tests/panel-scope-fake.js. The click, the shortcuts and the tab events are in tests/panel-scope-wire.test.js.

const ON = { path: PANEL_PAGE, enabled: true };

test('which browsers can switch the panel tab by tab: Chrome and Edge 116 and later, not Firefox, Safari or a browser without setOptions', () => {
  assert.equal(canScopePanel(world().api), true);
  assert.equal(canScopePanel({ sidePanel: { open: () => {} } }), false, 'a side panel that cannot be set per tab is left as it is');
  assert.equal(canScopePanel({ sidebarAction: { open: () => {} } }), false);
  assert.equal(canScopePanel({}), false);
  assert.equal(canScopePanel(undefined), false);
});

test('the default is said "off" every time, whatever the browser says it has', async () => {
  const w = world();
  assert.equal(await setPanelDefault(w.api, false), true);
  assert.equal(await setPanelDefault(w.api, false), true);
  assert.deepEqual(w.writes(), [['setOptions', { enabled: false }], ['setOptions', { enabled: false }]]);
  assert.equal(w.defaultOptions().enabled, false);
  assert.equal(await setPanelDefault({ sidebarAction: { open: () => {} } }, false), false, 'Firefox: nothing');
});

test('a tab is switched on with the panel page, off with nothing else, and only when it is not so already', async () => {
  const w = world({ tabs: [{ id: 1 }] });
  await setPanelDefault(w.api, false);
  w.forget();
  assert.equal(await setPanelForTab(w.api, 1, false), false, 'off by the default already');
  assert.equal(await setPanelForTab(w.api, 1, true), true);
  assert.equal(await setPanelForTab(w.api, 1, true), false, 'on already, with the right page');
  assert.equal(await setPanelForTab(w.api, 1, false), true);
  assert.equal(await setPanelForTab(w.api, 1, false), false);
  assert.deepEqual(w.writes(), [['setOptions', { tabId: 1, ...ON }], ['setOptions', { tabId: 1, enabled: false }]]);
});

test('a tab on with another page, or an answer the browser cannot give, is set again (better twice than wrong)', async () => {
  const other = world({ tabs: [{ id: 1 }] });
  other.api.sidePanel.setOptions({ tabId: 1, path: 'other.html', enabled: true });
  other.forget();
  assert.equal(await setPanelForTab(other.api, 1, true), true);
  assert.deepEqual(other.writes(), [['setOptions', { tabId: 1, ...ON }]]);

  const silent = world({ tabs: [{ id: 1 }], failGetOptions: true });
  assert.equal(await setPanelForTab(silent.api, 1, true), true);
  assert.equal(await setPanelForTab(silent.api, 1, true), true);
  assert.equal(await panelEnabledFor(silent.api, 1), null);

  const noGet = world({ tabs: [{ id: 1 }] });
  delete noGet.api.sidePanel.getOptions;
  assert.equal(await setPanelForTab(noGet.api, 1, false), true);
  assert.equal(await panelEnabledFor(noGet.api, 1), null);
});

test('a tab number that is not one, or a browser that cannot, changes nothing', async () => {
  const w = world();
  for (const id of [undefined, null, -1, 1.5, '3', NaN]) {
    assert.equal(await setPanelForTab(w.api, id, true), false, String(id));
    assert.equal(await panelEnabledFor(w.api, id), null, String(id));
  }
  assert.equal(await setPanelForTab({ sidebarAction: { open: () => {} } }, 1, true), false);
  assert.deepEqual(w.writes(), []);
});

test('a refusal by the browser is a rejection the caller handles, not a crash', async () => {
  const w = world({ tabs: [{ id: 1 }] });
  await setPanelDefault(w.api, false);
  w.flags.failSetOptions = true;
  await assert.rejects(setPanelForTab(w.api, 1, true), /No tab/);
  await assert.rejects(setPanelDefault(w.api, false), /No tab/);
});

test('is the panel on for a tab: the tab\'s own setting, else the default', async () => {
  const w = world({ tabs: [{ id: 1 }, { id: 2 }] });
  assert.equal(await panelEnabledFor(w.api, 1), true, 'the manifest\'s default is on until the worker says otherwise');
  await setPanelDefault(w.api, false);
  await setPanelForTab(w.api, 2, true);
  assert.equal(await panelEnabledFor(w.api, 1), false);
  assert.equal(await panelEnabledFor(w.api, 2), true);
});

// ---- opening ----------------------------------------------------------------------------------------------------------------------------

test('open with `enable`: the panel is switched on for the tab and opened in the same turn, in that order, neither awaited first', async () => {
  const w = world({ tabs: [{ id: 5 }] });
  await setPanelDefault(w.api, false);
  w.forget();
  const pending = w.userDoes(() => openPanel(w.api, 5, { enable: true }));
  assert.deepEqual(w.writes(), [['setOptions', { tabId: 5, ...ON }], ['open', { tabId: 5 }]], 'both asked before this returned');
  await pending;
  assert.equal(w.openPanels.has(5), true);
});

test('open without `enable` only opens; the browser refuses a tab that is off, and that is a rejection', async () => {
  const w = world({ tabs: [{ id: 5 }] });
  await setPanelDefault(w.api, false);
  w.forget();
  await assert.rejects(w.userDoes(() => openPanel(w.api, 5)), /No active side panel/);
  assert.deepEqual(w.writes(), [['open', { tabId: 5 }]]);
  await assert.rejects(w.userDoes(() => openPanel(w.api, 5, {})), /No active side panel/);
  await assert.rejects(w.userDoes(() => openPanel(w.api, 5, { enable: false })), /No active side panel/);
});

test('open with `enable` when switching on fails: the failure is the open\'s, nothing is left unhandled', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const w = world({ tabs: [{ id: 5 }] });
    await setPanelDefault(w.api, false);
    w.flags.failSetOptions = true; // (switching on is refused, so the panel is still off for the tab and open() says so)
    await assert.rejects(w.userDoes(() => openPanel(w.api, 5, { enable: true })), /No active side panel/);
    const throwing = world();
    throwing.api.sidePanel.setOptions = () => { throw new TypeError('bad arguments'); };
    await throwing.userDoes(() => openPanel(throwing.api, 5, { enable: true })).catch(() => {});
    assert.deepEqual(throwing.writes(), [['open', { tabId: 5 }]], 'a setOptions that throws does not stop the open');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('Firefox ignores `enable`: its sidebar is asked as before, nothing is switched', async () => {
  const calls = [];
  const sidebarAction = { open: () => (calls.push('open'), Promise.resolve()), isOpen: async () => true, setOptions: () => calls.push('setOptions') };
  await openPanel({ sidebarAction }, 7, { enable: true });
  assert.deepEqual(calls, ['open']);
});

// ---- the click handler's plumbing -------------------------------------------------------------------------------------------------------

test('the toolbar button hands the clicked tab to the handler inside the click; a handler that throws or rejects never breaks the browser\'s listener', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const seen = [];
    const w = world();
    wireToolbarButton(w.api, (tab) => seen.push(tab));
    w.events.actionClicked.fire({ id: 3, url: 'https://ifbash.com/' });
    assert.deepEqual(seen, [{ id: 3, url: 'https://ifbash.com/' }], 'called in the turn of the click');

    const throwing = world();
    wireToolbarButton(throwing.api, () => { throw new Error('boom'); });
    assert.doesNotThrow(() => throwing.events.actionClicked.fire({ id: 3 }));

    const rejecting = world();
    wireToolbarButton(rejecting.api, () => Promise.reject(new Error('later')));
    assert.doesNotThrow(() => rejecting.events.actionClicked.fire({ id: 3 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a handler without a toolbar button API to listen on leaves the browser to open the panel itself', () => {
  const w = world();
  delete w.api.action;
  wireToolbarButton(w.api, () => {});
  assert.deepEqual(w.writes(), [['behavior', { openPanelOnActionClick: true }]], 'nobody would hear the click: the browser keeps opening the panel');
});
