const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// After an extension update the bridge already on an open page keeps running, and the service worker injects the new one into that
// page (service-worker.js injectIntoOpenTabs). The newer bridge must take over, or every action added since answers "Unknown
// action." until the page is reloaded (audit P2.23). Here the bridge runs in a vm against a fake document that orders listeners on
// the event's target the way the browser does (Chrome 89 and later: capture listeners first, then the others, each in the order they
// were added) and honours stopImmediatePropagation.
const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
const VERSION_RE = /var BRIDGE_VERSION = (\d+);/;
const VERSION = Number(VERSION_RE.exec(BRIDGE)?.[1]);

/** The bridge's source with another version (and optional text swaps), as an older or newer release would be. */
function release(version, swaps = []) {
  let source = BRIDGE.replace(VERSION_RE, `var BRIDGE_VERSION = ${version};`);
  for (const [from, to] of swaps) {
    assert.ok(source.includes(from), `the bridge still contains ${from}`);
    source = source.replace(from, to);
  }
  return source;
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.stopped = false;
  }

  stopImmediatePropagation() {
    this.stopped = true;
  }
}

function makePage() {
  const listeners = [];
  const isCapture = (option) => option === true || Boolean(option && option.capture);
  const doc = {
    addEventListener(type, fn, option) {
      const capture = isCapture(option);
      if (!listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, option) {
      const capture = isCapture(option);
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (at !== -1) listeners.splice(at, 1);
    },
    dispatchEvent(event) {
      const mine = listeners.filter((l) => l.type === event.type);
      for (const l of [...mine.filter((m) => m.capture), ...mine.filter((m) => !m.capture)]) {
        if (event.stopped) break;
        if (listeners.includes(l)) l.fn.call(doc, event);
      }
      return true;
    },
    // a classic page with nothing on it: no g_form, no boxes
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = { document: doc, CustomEvent: FakeEvent, location: { pathname: '/incident.do', search: '', hash: '' }, frames: [] };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  let n = 0;
  return {
    win: sandbox,
    doc,
    run: (source) => vm.runInContext(source, sandbox),
    requestListeners: () => listeners.filter((l) => l.type === 'ab-page-request'),
    /** Every answer the page gives to one request. */
    ask(action, args = []) {
      const answers = [];
      const onAnswer = (event) => answers.push(JSON.parse(JSON.stringify(event.detail)));
      doc.addEventListener('ab-page-response', onAnswer);
      doc.dispatchEvent(new FakeEvent('ab-page-request', { detail: { id: `r${(n += 1)}`, action, args } }));
      doc.removeEventListener('ab-page-response', onAnswer);
      return answers;
    },
  };
}

// An action the older release did not have yet (as getBoxValues once was new).
const BOX_ARGS = [['comments'], ['Additional comments']];
const withoutBoxes = ['getBoxValues: function', 'getBoxValuesNotYet: function'];

test('the bridge has a version, a whole number above 1 (the first bridge, which had none, counts as 1)', () => {
  assert.ok(Number.isSafeInteger(VERSION) && VERSION > 1, `var BRIDGE_VERSION = <n>; is in src/page/bridge.js (found ${VERSION})`);
});

test('a page with no bridge: it installs, answers once, and leaves only its version and a stop on the window', () => {
  const page = makePage();
  page.run(BRIDGE);
  assert.deepEqual(Object.keys(page.win.__abBridge).sort(), ['stop', 'version']);
  assert.equal(page.win.__abBridge.version, VERSION);
  assert.equal(page.requestListeners().length, 1);
  const answers = page.ask('getFormMeta');
  assert.equal(answers.length, 1);
  assert.equal(answers[0].ok, true);
  // stop() is what a newer bridge calls: afterwards this one answers nothing
  page.win.__abBridge.stop();
  assert.equal(page.requestListeners().length, 0);
  assert.deepEqual(page.ask('getFormMeta'), []);
});

test('the same bridge injected twice (registered script and injection both ran) listens once and answers once', () => {
  const page = makePage();
  page.run(BRIDGE);
  const first = page.win.__abBridge;
  page.run(BRIDGE);
  assert.equal(page.win.__abBridge, first, 'the second copy did nothing');
  assert.equal(page.requestListeners().length, 1);
  assert.equal(page.ask('getFormMeta').length, 1);
});

test('after an update the newer bridge takes over: the older one stops listening, and a new action is answered', () => {
  const page = makePage();
  page.run(release(VERSION - 1, [withoutBoxes]));
  assert.equal(page.ask('getBoxValues', BOX_ARGS)[0].error, 'Unknown action.', 'the older release does not know the action');
  page.run(BRIDGE);
  assert.equal(page.win.__abBridge.version, VERSION);
  assert.equal(page.requestListeners().length, 1, "the older bridge's listener is gone");
  const answers = page.ask('getBoxValues', BOX_ARGS);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].ok, true, answers[0].error);
  assert.deepEqual(answers[0].result, {});
});

test('an older bridge arriving after a newer one does nothing', () => {
  const page = makePage();
  page.run(BRIDGE);
  page.run(release(VERSION - 1, [withoutBoxes]));
  assert.equal(page.win.__abBridge.version, VERSION);
  assert.equal(page.requestListeners().length, 1);
  assert.equal(page.ask('getBoxValues', BOX_ARGS)[0].ok, true);
});

test('a newer bridge already on the page keeps answering; this one does nothing', () => {
  const page = makePage();
  page.run(release(VERSION + 1, [["error: 'Unknown action.'", "error: 'Unknown action (newer).'"]]));
  page.run(BRIDGE);
  assert.equal(page.win.__abBridge.version, VERSION + 1);
  assert.equal(page.requestListeners().length, 1);
  assert.deepEqual(page.ask('noSuchAction').map((a) => a.error), ['Unknown action (newer).']);
});

test('the first bridge (only a flag, no handle) cannot be removed, but it no longer sees a request: one answer, from the new bridge', () => {
  const page = makePage();
  // What the first bridge left: the flag, and an ordinary listener that answers "Unknown action." to an action it does not know (and
  // would fill a field a second time if it saw a fillField).
  const seen = [];
  page.win.__abBridgeInstalled = true;
  page.doc.addEventListener('ab-page-request', (event) => {
    seen.push(event.detail.action);
    page.doc.dispatchEvent(new FakeEvent('ab-page-response', { detail: { id: event.detail.id, ok: false, error: 'Unknown action.' } }));
  });
  page.run(BRIDGE);
  assert.equal(page.win.__abBridge.version, VERSION);
  const answers = page.ask('getBoxValues', BOX_ARGS);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].ok, true, answers[0].error);
  assert.deepEqual(seen, [], 'the first bridge was never asked');
});

test('odd values a page script left on the window do not keep the bridge from starting', () => {
  for (const odd of [{ version: '99' }, { version: null, stop: 5 }, 'text', 7, null]) {
    const page = makePage();
    page.win.__abBridge = odd;
    page.run(BRIDGE);
    assert.equal(page.win.__abBridge.version, VERSION, JSON.stringify(odd));
    assert.equal(page.ask('getFormMeta').length, 1, JSON.stringify(odd));
  }
});

// The version is only worth something when it changes with the file. This pins it to the file's contents: any change to
// src/page/bridge.js fails here until BRIDGE_VERSION is raised and the pair below is updated. (Line endings do not count.)
const PINNED = { version: 3, sha256: '772278d57dd5a5621a686492985ec9dcfe5ad0118c120bb27613822c49fd915d' };

test('BRIDGE_VERSION was raised with the last change to the bridge', () => {
  const sha256 = crypto.createHash('sha256').update(BRIDGE.replace(/\r\n/g, '\n')).digest('hex');
  if (sha256 === PINNED.sha256) {
    assert.equal(VERSION, PINNED.version);
    return;
  }
  assert.fail(
    `src/page/bridge.js changed. Raise BRIDGE_VERSION in it (now ${VERSION}; it must go above ${PINNED.version}), so the new bridge takes over on pages that are already open, then set PINNED in tests/page-bridge-version.test.js to { version: <the new number>, sha256: '<the sha256 of the file after that change>' } (this one: ${sha256}).`
  );
});
