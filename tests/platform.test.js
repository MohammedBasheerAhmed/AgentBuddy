import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXTENSION_SCHEMES,
  browserApi,
  canOpenShortcutSettings,
  extensionIdentity,
  extensionOrigin,
  extensionUrlOrigin,
  openPanel,
  openShortcutSettings,
  panelKind,
  wireToolbarButton,
} from '../src/lib/platform.js';

// src/lib/platform.js: the browser differences, with a fake of each kind of browser. The fakes behave as the browsers do in the part that
// matters: Chrome opens its side panel when asked; Firefox opens its sidebar only while a click or key press on the browser itself is
// being handled (the toolbar button, a keyboard shortcut), and that ends with the listener's first turn; Safari has no panel API yet.

const CHROME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const GECKO_ID = 'agentbuddy@ifbash.example';
const UUID = '5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37';
const SAFARI_UUID = '8E1F2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B';

function event() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn) };
}

function chromeLike({ openFails = false, behaviorFails = false } = {}) {
  const calls = [];
  const api = {
    runtime: { id: CHROME_ID, getURL: (p) => `chrome-extension://${CHROME_ID}/${p}` },
    sidePanel: {
      open: (options) => {
        calls.push(['open', options]);
        return openFails ? Promise.reject(new Error('`sidePanel.open()` may only be called in response to a user gesture.')) : Promise.resolve();
      },
      setPanelBehavior: (options) => {
        calls.push(['behavior', options]);
        return behaviorFails ? Promise.reject(new Error('not now')) : Promise.resolve();
      },
    },
    action: { onClicked: event() },
    commands: { getAll: async () => [] },
    tabs: { create: (options) => (calls.push(['tab', options]), Promise.resolve({ id: 9 })) },
  };
  return { api, calls };
}

function firefoxLike({ sidebarOpen = false, toggle = true, shortcutsPage = true, isOpenFails = false } = {}) {
  const calls = [];
  const state = { open: sidebarOpen, userAction: false };
  const refuse = () => Promise.reject(new Error('sidebarAction.open may only be called from a user input handler'));
  const sidebarAction = {
    open: () => {
      calls.push(['open', state.userAction]);
      if (!state.userAction) return refuse();
      state.open = true;
      return Promise.resolve();
    },
    isOpen: async (details) => {
      calls.push(['isOpen', details]);
      if (isOpenFails) throw new Error('no window');
      return state.open;
    },
  };
  if (toggle) {
    sidebarAction.toggle = () => {
      calls.push(['toggle', state.userAction]);
      if (!state.userAction) return refuse();
      state.open = !state.open;
      return Promise.resolve();
    };
  }
  const api = {
    runtime: { id: GECKO_ID, getURL: (p) => `moz-extension://${UUID}/${p}` },
    sidebarAction,
    action: { onClicked: event() },
    commands: { getAll: async () => [], ...(shortcutsPage ? { openShortcutSettings: async () => void calls.push(['shortcuts']) } : {}) },
    tabs: { create: (options) => (calls.push(['tab', options]), Promise.reject(new Error('Illegal URL'))) },
  };
  // The browser handles a click or a key press: what the listener does in its first turn counts as the person's action, nothing after.
  const userDoes = (fn) => {
    state.userAction = true;
    try {
      return fn();
    } finally {
      state.userAction = false;
    }
  };
  const clickButton = () => userDoes(() => api.action.onClicked.listeners.forEach((fn) => fn({ id: 1 })));
  return { api, calls, state, userDoes, clickButton };
}

// Neither a side panel nor a sidebar (Safari, until its panel window is built).
function neitherLike() {
  const calls = [];
  const api = {
    runtime: { id: 'com.ifbash.agentbuddy.Extension (TEAM123456)', getURL: (p) => `safari-web-extension://${SAFARI_UUID}/${p}` },
    action: { onClicked: event() },
    commands: { getAll: async () => [] },
    tabs: { create: (options) => (calls.push(['tab', options]), Promise.resolve({ id: 9 })) },
  };
  return { api, calls };
}

// ---- which panel ---------------------------------------------------------------------------------------------------------------

test('which panel the browser has, by what its API offers', () => {
  assert.equal(panelKind(chromeLike().api), 'side-panel');
  assert.equal(panelKind(firefoxLike().api), 'sidebar');
  assert.equal(panelKind(neitherLike().api), 'none');
  for (const api of [undefined, null, {}, { sidePanel: {} }, { sidebarAction: { open: 'yes' } }]) assert.equal(panelKind(api), 'none', JSON.stringify(api));
  // a browser that has both is treated as Chrome
  assert.equal(panelKind({ ...firefoxLike().api, sidePanel: chromeLike().api.sidePanel }), 'side-panel');
});

test('the browser\'s API: `browser` where it really is the API, else `chrome` (a page element called "browser" is not it)', () => {
  const chrome = chromeLike().api;
  const firefox = firefoxLike().api;
  assert.equal(browserApi({ chrome }), chrome);
  assert.equal(browserApi({ chrome, browser: firefox }), firefox);
  assert.equal(browserApi({ chrome, browser: { tagName: 'DIV', id: 'browser', runtime: { tagName: 'INPUT' } } }), chrome, 'DOM clobbering');
  assert.equal(browserApi({}), null);
  assert.equal(browserApi(null), null);
});

// ---- opening the panel -----------------------------------------------------------------------------------------------------------

test('Chrome and Edge: the side panel of the tab is asked for at once, before the returned promise is awaited', async () => {
  const { api, calls } = chromeLike();
  const pending = openPanel(api, 7);
  assert.deepEqual(calls, [['open', { tabId: 7 }]], 'called synchronously');
  assert.equal(await pending, undefined);
});

test('Chrome and Edge: a refusal or a missing API rejects (the bar then tells the person to use the toolbar button); it never throws', async () => {
  await assert.rejects(openPanel(chromeLike({ openFails: true }).api, 7), /user gesture/);
  const broken = { sidePanel: { open: () => { throw new TypeError('no tab'); } } };
  let pending;
  assert.doesNotThrow(() => { pending = openPanel(broken, 7); });
  await assert.rejects(pending, /no tab/);
});

test('Firefox: from a keyboard shortcut (a key press the browser is handling) the sidebar opens, because it is asked at once', async () => {
  const { api, calls, state, userDoes } = firefoxLike();
  const pending = userDoes(() => openPanel(api, 7));
  assert.deepEqual(calls, [['open', true]], 'asked inside the key press');
  await pending;
  assert.equal(state.open, true);
  // what goes wrong when something is awaited first: the key press is over and Firefox refuses
  const late = firefoxLike();
  const lateOpen = late.userDoes(async () => {
    await null;
    return openPanel(late.api, 7);
  });
  await assert.rejects(lateOpen, /user input handler/);
  assert.equal(late.state.open, false);
});

test('Firefox: a click on the bar (a message from the page, not a user action) counts as opened only when the sidebar is open already', async () => {
  const open = firefoxLike({ sidebarOpen: true });
  const pending = openPanel(open.api, 7);
  assert.deepEqual(open.calls, [['open', false]], 'open() is still asked at once');
  await pending; // resolves: the open sidebar picks up the request (src/sidepanel/useLaunch.js)
  assert.deepEqual(open.calls, [['open', false], ['isOpen', {}]]);

  const closed = firefoxLike({ sidebarOpen: false });
  await assert.rejects(openPanel(closed.api, 7), /user input handler/, 'closed: the bar says "Click the Agent Buddy button in your browser toolbar"');
  assert.equal(closed.state.open, false);

  await assert.rejects(openPanel(firefoxLike({ isOpenFails: true }).api, 7), /user input handler/, 'not known whether it is open: treated as closed');
});

test('Firefox: an open() that throws at once is a rejection, and still asks whether the sidebar is open', async () => {
  const sidebarAction = { open: () => { throw new Error('boom'); }, isOpen: async () => true };
  let pending;
  assert.doesNotThrow(() => { pending = openPanel({ sidebarAction }, 7); });
  await pending;
  await assert.rejects(openPanel({ sidebarAction: { ...sidebarAction, isOpen: async () => false } }, 7), /boom/);
});

test('neither (Safari for now): opening rejects and touches nothing', async () => {
  const { api, calls } = neitherLike();
  await assert.rejects(openPanel(api, 7), /no panel/);
  await assert.rejects(openPanel(undefined, 7), /no panel/);
  assert.deepEqual(calls, []);
});

// ---- the toolbar button -----------------------------------------------------------------------------------------------------------

test('Chrome and Edge: without a click handler the toolbar button opens the side panel through setPanelBehavior, set once per start of the worker', async () => {
  const { api, calls } = chromeLike();
  assert.equal(wireToolbarButton(api), 'side-panel');
  assert.equal(wireToolbarButton(api), 'side-panel');
  assert.deepEqual(calls, [['behavior', { openPanelOnActionClick: true }]]);
  assert.equal(api.action.onClicked.listeners.length, 0, 'the browser opens the panel itself: no click listener');
  // a refusal is swallowed (no unhandled rejection)
  const failing = chromeLike({ behaviorFails: true });
  assert.equal(wireToolbarButton(failing.api), 'side-panel');
  await new Promise((resolve) => setImmediate(resolve));
});

test('Firefox: a click on the toolbar button toggles the sidebar, asked inside the click; wiring twice adds one listener', () => {
  const { api, calls, state, clickButton } = firefoxLike();
  assert.equal(wireToolbarButton(api), 'sidebar');
  assert.equal(wireToolbarButton(api), 'sidebar');
  assert.equal(api.action.onClicked.listeners.length, 1, 'two listeners would open and shut the sidebar on one click');
  clickButton();
  assert.deepEqual(calls, [['toggle', true]]);
  assert.equal(state.open, true);
  clickButton();
  assert.equal(state.open, false);
});

test('Firefox: without toggle() the button opens the sidebar; an older Firefox (browserAction) works too; no button API is no listener', () => {
  const noToggle = firefoxLike({ toggle: false });
  wireToolbarButton(noToggle.api);
  noToggle.clickButton();
  assert.deepEqual(noToggle.calls, [['open', true]]);
  assert.equal(noToggle.state.open, true);

  const mv2 = firefoxLike();
  mv2.api.browserAction = mv2.api.action;
  delete mv2.api.action;
  assert.equal(wireToolbarButton(mv2.api), 'sidebar');
  assert.equal(mv2.api.browserAction.onClicked.listeners.length, 1);

  const none = firefoxLike();
  delete none.api.action;
  assert.equal(wireToolbarButton(none.api), 'sidebar');
});

test('neither (Safari for now): the toolbar button is left alone', () => {
  const { api, calls } = neitherLike();
  assert.equal(wireToolbarButton(api), 'none');
  assert.equal(api.action.onClicked.listeners.length, 0);
  assert.deepEqual(calls, []);
  assert.equal(wireToolbarButton(undefined), 'none');
});

// ---- the origin of the extension's own pages --------------------------------------------------------------------------------------

test('the origin of our own pages, in all three browsers (Node says "null" for these schemes; it is built from scheme and host)', () => {
  assert.deepEqual(EXTENSION_SCHEMES, ['chrome-extension:', 'moz-extension:', 'safari-web-extension:']);
  assert.equal(extensionOrigin(chromeLike().api.runtime), `chrome-extension://${CHROME_ID}`);
  assert.equal(extensionOrigin(firefoxLike().api.runtime), `moz-extension://${UUID}`);
  assert.equal(extensionOrigin(neitherLike().api.runtime), `safari-web-extension://${SAFARI_UUID}`, 'Safari\'s upper case is kept');
  const id = extensionIdentity(firefoxLike().api.runtime);
  assert.deepEqual({ ...id }, { id: GECKO_ID, origin: `moz-extension://${UUID}` });
  assert.ok(Object.isFrozen(id));
});

test('anything else is not an extension origin', () => {
  for (const url of [
    '',
    undefined,
    null,
    'not a url',
    'https://acme.service-now.com/',
    'http://localhost/',
    'about:blank',
    'chrome://extensions/shortcuts',
    `chrome-extension://${CHROME_ID}:8080/`,
    `chrome-extension://user@${CHROME_ID}/`,
    `chrome-extension://user:pw@${CHROME_ID}/`,
    `chrome-extension://${CHROME_ID}.evil/`,
    'chrome-extension:///sidepanel.html',
    `chrome-extension:${CHROME_ID}`,
    'moz-extension://{5b0c3e2a}/',
    `moz-extension://${'a'.repeat(65)}/`,
    `web+extension://${CHROME_ID}/`,
  ]) {
    assert.equal(extensionUrlOrigin(url), '', String(url));
  }
  assert.equal(extensionUrlOrigin(`CHROME-EXTENSION://${CHROME_ID}/x`), `chrome-extension://${CHROME_ID}`, 'the scheme is not case sensitive; the host is kept as written');
  assert.equal(extensionUrlOrigin(`chrome-extension://${CHROME_ID.toUpperCase()}/x`), `chrome-extension://${CHROME_ID.toUpperCase()}`);
});

test('a runtime that cannot say its address gives no origin (and so accepts no page)', () => {
  assert.equal(extensionOrigin({ getURL: () => { throw new Error('Extension context invalidated.'); } }), '');
  assert.equal(extensionOrigin({ getURL: () => 'https://evil.example/' }), '');
  assert.equal(extensionOrigin({}), '');
  assert.equal(extensionOrigin(undefined), '');
  assert.deepEqual({ ...extensionIdentity(undefined) }, { id: '', origin: '' });
  assert.deepEqual({ ...extensionIdentity({ id: 5, getURL: () => `chrome-extension://${CHROME_ID}/` }) }, { id: '', origin: `chrome-extension://${CHROME_ID}` });
});

// ---- the keyboard shortcuts page ---------------------------------------------------------------------------------------------------

test('the shortcuts page: Firefox opens its own, Chrome and Edge open theirs in a tab, the others cannot', async () => {
  const firefox = firefoxLike();
  assert.equal(canOpenShortcutSettings(firefox.api), true);
  await openShortcutSettings(firefox.api, 'chrome://extensions/shortcuts');
  assert.deepEqual(firefox.calls, [['shortcuts']], 'not a tab: Firefox refuses about: and chrome: addresses there');

  const chrome = chromeLike();
  assert.equal(canOpenShortcutSettings(chrome.api), true);
  await openShortcutSettings(chrome.api, 'edge://extensions/shortcuts');
  assert.deepEqual(chrome.calls, [['tab', { url: 'edge://extensions/shortcuts' }]]);

  const oldFirefox = firefoxLike({ shortcutsPage: false });
  assert.equal(canOpenShortcutSettings(oldFirefox.api), false);
  await assert.rejects(openShortcutSettings(oldFirefox.api, 'chrome://extensions/shortcuts'), /cannot open/);
  assert.deepEqual(oldFirefox.calls, []);

  const neither = neitherLike();
  assert.equal(canOpenShortcutSettings(neither.api), false);
  await assert.rejects(openShortcutSettings(neither.api, 'chrome://extensions/shortcuts'), /cannot open/);
  assert.equal(canOpenShortcutSettings(undefined), false);
});

// ---- the rest of the code asks here --------------------------------------------------------------------------------------------------

const SRC = path.join(__dirname, '..', 'src');
function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('only platform.js uses the panel APIs of the browsers (sidePanel, sidebarAction, setPanelBehavior)', () => {
  const users = sourceFiles()
    .filter((f) => /\.(sidePanel|sidebarAction)\b|setPanelBehavior\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
  assert.deepEqual(users, ['lib/platform.js']);
});

test('the background runs as a Chrome service worker and as a Firefox event page: nothing only a service worker has, and the button is wired on every start', () => {
  const dir = path.join(SRC, 'background');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\bself\.registration\b|\bclients\.|\bskipWaiting\b|\bimportScripts\b|\bServiceWorkerGlobalScope\b|\boninstall\b|\bonactivate\b/.test(src), f);
  }
  const worker = fs.readFileSync(path.join(dir, 'service-worker.js'), 'utf8');
  // (the click handler of the panel scope goes in with the button, tests/panel-scope-wire.test.js: the old `wireToolbarButton(api)`
  // let the browser open the panel on every page, which is what the scope exists to stop)
  assert.match(worker, /^wireToolbarButton\(api, panelScope\.onToolbarClick\);$/m, 'at the top level, not inside onInstalled or onStartup');
  assert.match(worker, /^const panelScope = wirePanelScope\(api, /m, 'at the top level too');
  assert.match(worker, /openPanel: \(tabId, tab\) => openPanel\(api, tabId, clickPlan\(tab\)\)/);
  assert.match(worker, /checkExtensionSender\(sender, OWN\)/);
});
