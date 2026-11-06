import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, SITE_OFF_CODE } from '../src/lib/messages.js';
import { contentMessageAction, contentScriptOrigin } from '../src/lib/senderCheck.js';
import { BAR_TYPES, handleBarMessage, restrictStorageAccess, retireOpenTabs } from '../src/background/bar.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { QUICK_DEFAULTS } from '../src/features/quick.js';
import { openPanel } from '../src/lib/platform.js';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const SITE = 'https://acme.service-now.com';
const SYS = 'a'.repeat(32);
const fromPage = (over = {}) => ({ id: ID, tab: { id: 7 }, frameId: 0, origin: SITE, url: `${SITE}/incident.do`, ...over });

function deps(over = {}) {
  const calls = { open: [], saved: [] };
  const d = {
    runtimeId: ID,
    calls,
    activeInstances: async () => [SITE],
    loadSettings: async () => ({}),
    loadPolicy: async () => normalizePolicy({}),
    now: () => 5000,
    openPanel: async (tabId) => void calls.open.push(tabId),
    saveLaunch: async (launch) => void calls.saved.push(launch),
    ...over,
  };
  return d;
}
const actions = { type: MSG.BAR_ACTIONS, table: 'incident' };
const launch = { type: MSG.BAR_LAUNCH, table: 'incident', sysId: SYS, featureId: 'record-summary' };

// ---- who may ask -------------------------------------------------------------------------------------------------

test('contentScriptOrigin accepts this extension\'s content script in the top frame of an https page', () => {
  assert.equal(contentScriptOrigin(fromPage(), ID), SITE);
  assert.equal(contentScriptOrigin(fromPage({ origin: undefined, url: `${SITE}/x` }), ID), SITE, 'falls back to the sender url');
});

test('contentScriptOrigin refuses everything else', () => {
  const no = (sender, runtimeId = ID) => assert.equal(contentScriptOrigin(sender, runtimeId), '', JSON.stringify(sender));
  no(fromPage({ id: 'someone-else' }));
  no(fromPage({ id: undefined }));
  no(fromPage({ frameId: 3 }), ID);
  no(fromPage({ frameId: undefined }));
  no(fromPage({ tab: undefined }), ID);
  no(fromPage({ tab: { id: -1 } }), ID);
  no(fromPage({ tab: { id: '7' } }), ID);
  no(fromPage({ origin: 'http://acme.service-now.com' }), ID);
  no(fromPage({ origin: `chrome-extension://${ID}`, url: `chrome-extension://${ID}/sidepanel.html` }), ID);
  no(fromPage({ origin: 'null', url: 'about:blank' }), ID);
  no(fromPage({ origin: undefined, url: `moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/sidepanel.html` }), ID);
  no(fromPage({ origin: 'safari-web-extension://8E1F2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B' }), ID);
  no(null);
  no(fromPage(), '');
});

test('the bar\'s two requests are the only ones routed to the bar handler', () => {
  assert.deepEqual([...BAR_TYPES].sort(), [MSG.BAR_ACTIONS, MSG.BAR_LAUNCH].sort());
  for (const type of [MSG.ENABLE_INSTANCE, MSG.DISABLE_INSTANCE, MSG.LIST_INSTANCES, MSG.READ, MSG.FILL_FIELD, MSG.PAGE_STATE]) assert.ok(!BAR_TYPES.has(type), type);
});

test('a sender that is not a content script is refused before anything happens', async () => {
  for (const sender of [fromPage({ id: 'other' }), fromPage({ frameId: 2 }), { id: ID, origin: `chrome-extension://${ID}` }]) {
    const d = deps();
    await assert.rejects(handleBarMessage(launch, sender, d), /only allowed/);
    assert.deepEqual(d.calls.open, []);
    assert.deepEqual(d.calls.saved, []);
  }
});

test('a page of a site that is not turned on is refused, and nothing is saved', async () => {
  const d = deps({ activeInstances: async () => ['https://other.service-now.com'] });
  await assert.rejects(handleBarMessage(actions, fromPage(), d), /not turned on/);
  await assert.rejects(handleBarMessage(launch, fromPage(), d), /not turned on/);
  assert.deepEqual(d.calls.saved, []);
});

test('a table that is not a table name is refused', async () => {
  for (const table of ['', 'a b', '../x', '1incident', 'x-y', 5, null]) await assert.rejects(handleBarMessage({ ...actions, table }, fromPage(), deps()), /valid record/, String(table));
  // a launch always names a table (only BAR_ACTIONS may leave it out: "is the bar on here?")
  for (const table of ['', undefined, 'a b']) await assert.rejects(handleBarMessage({ ...launch, table }, fromPage(), deps()), /valid record/, String(table));
});

// ---- BAR_ACTIONS ---------------------------------------------------------------------------------------------------

test('BAR_ACTIONS answers with the defaults for the table\'s kind', async () => {
  const answer = await handleBarMessage(actions, fromPage(), deps());
  assert.deepEqual(answer.actions.map((a) => a.id), QUICK_DEFAULTS.incident);
  const change = await handleBarMessage({ ...actions, table: 'change_request' }, fromPage(), deps());
  assert.deepEqual(change.actions.map((a) => a.id), QUICK_DEFAULTS.change);
});

test('BAR_ACTIONS uses the person\'s pins', async () => {
  const d = deps({ loadSettings: async () => ({ quickPins: { incident: ['handoff-brief'] } }) });
  assert.deepEqual((await handleBarMessage(actions, fromPage(), d)).actions, [{ id: 'handoff-brief', label: 'Hand-off brief', ai: true }]);
});

test('BAR_ACTIONS answers with nothing when the person switched the bar off', async () => {
  const d = deps({ loadSettings: async () => ({ pageBar: false }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [], bar: false, language: 'en', theme: '' });
});

test('BAR_ACTIONS answers with nothing when the organisation switched the bar off, whatever the person chose', async () => {
  const d = deps({ loadSettings: async () => ({ pageBar: true }), loadPolicy: async () => normalizePolicy({ disablePageBar: true }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [], bar: false, language: 'en', theme: '' });
  await assert.rejects(handleBarMessage(launch, fromPage(), d), /not available/);
  assert.deepEqual(d.calls.saved, []);
});

test('BAR_ACTIONS answers with nothing for a table the organisation blocked', async () => {
  const d = deps({ loadPolicy: async () => normalizePolicy({ blockedTables: ['incident'] }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [], bar: true, language: 'en', theme: '' });
});

test('BAR_ACTIONS answers with nothing on HR content unless the organisation allows it', async () => {
  const hr = { ...actions, table: 'sn_hr_core_case' };
  assert.deepEqual(await handleBarMessage(hr, fromPage(), deps()), { actions: [], bar: true, language: 'en', theme: '' });
  const allowed = deps({ loadPolicy: async () => normalizePolicy({ allowHrContent: true }) });
  assert.ok((await handleBarMessage(hr, fromPage(), allowed)).actions.length > 0);
});

test('BAR_ACTIONS leaves out an action the policy switched off', async () => {
  const d = deps({ loadPolicy: async () => normalizePolicy({ disabledFeatures: ['reply-draft'] }) });
  assert.deepEqual((await handleBarMessage(actions, fromPage(), d)).actions.map((a) => a.id), ['record-summary', 'resolution-notes']);
});

test('BAR_ACTIONS never opens the panel or saves a request', async () => {
  const d = deps();
  await handleBarMessage(actions, fromPage(), d);
  assert.deepEqual(d.calls.open, []);
  assert.deepEqual(d.calls.saved, []);
});

// ---- BAR_LAUNCH ----------------------------------------------------------------------------------------------------

test('BAR_LAUNCH opens the panel for that tab and leaves a request for the record', async () => {
  const d = deps();
  assert.deepEqual(await handleBarMessage(launch, fromPage(), d), { opened: true });
  assert.deepEqual(d.calls.open, [7]);
  assert.deepEqual(d.calls.saved, [{ tabId: 7, table: 'incident', sysId: SYS, featureId: 'record-summary', at: 5000 }]);
});

test('BAR_LAUNCH asks the browser to open the panel BEFORE it waits for anything (the click\'s permission to do so ends then)', () => {
  const d = deps();
  const pending = handleBarMessage(launch, fromPage(), d); // not awaited: only the synchronous part has run
  assert.deepEqual(d.calls.open, [7]);
  return pending;
});

test('BAR_LAUNCH says so when the panel could not be opened, and still leaves the request for when it is', async () => {
  const d = deps({ openPanel: async () => { throw new Error('may only be called in response to a user gesture'); } });
  assert.deepEqual(await handleBarMessage(launch, fromPage(), d), { opened: false });
  assert.equal(d.calls.saved.length, 1);
  const noApi = deps({ openPanel: () => { throw new TypeError('chrome.sidePanel is undefined'); } });
  assert.deepEqual(await handleBarMessage(launch, fromPage(), noApi), { opened: false });
});

test('Firefox: a click on the bar cannot open the sidebar; the answer says whether it was open already, and the request is left either way', async () => {
  for (const alreadyOpen of [true, false]) {
    const asked = [];
    const sidebarAction = {
      open: () => (asked.push('open'), Promise.reject(new Error('sidebarAction.open may only be called from a user input handler'))),
      isOpen: async () => (asked.push('isOpen'), alreadyOpen),
    };
    const d = deps({ openPanel: (tabId) => openPanel({ sidebarAction }, tabId) });
    const pending = handleBarMessage(launch, fromPage(), d);
    assert.deepEqual(asked, ['open'], 'asked at once, as in Chrome');
    // open: the sidebar picks the request up itself. Closed: the bar says "Click the Agent Buddy button in your browser toolbar".
    assert.deepEqual(await pending, { opened: alreadyOpen });
    assert.equal(d.calls.saved.length, 1);
  }
});

test('BAR_LAUNCH refuses an action the bar was not allowed to offer here', async () => {
  for (const featureId of ['coaching-snapshot', 'change-cab-brief', 'nope', '', undefined, '../../x']) {
    const d = deps();
    await assert.rejects(handleBarMessage({ ...launch, featureId }, fromPage(), d), /not available|valid/, String(featureId));
    assert.deepEqual(d.calls.saved, [], String(featureId));
  }
});

test('BAR_LAUNCH refuses an action the policy switched off, and a bar that is switched off', async () => {
  const policyOff = deps({ loadPolicy: async () => normalizePolicy({ disabledFeatures: ['record-summary'] }) });
  await assert.rejects(handleBarMessage(launch, fromPage(), policyOff), /not available/);
  const barOff = deps({ loadSettings: async () => ({ pageBar: false }) });
  await assert.rejects(handleBarMessage(launch, fromPage(), barOff), /not available/);
  assert.deepEqual(policyOff.calls.saved.concat(barOff.calls.saved), []);
});

test('BAR_LAUNCH refuses a record that is not a sys_id', async () => {
  for (const sysId of [undefined, '', 'abc', 'z'.repeat(32), 12]) {
    const d = deps();
    await assert.rejects(handleBarMessage({ ...launch, sysId }, fromPage(), d), /valid request/, String(sysId));
    assert.deepEqual(d.calls.saved, []);
  }
});

test('BAR_LAUNCH accepts a pinned action', async () => {
  const d = deps({ loadSettings: async () => ({ quickPins: { incident: ['handoff-brief'] } }) });
  assert.deepEqual(await handleBarMessage({ ...launch, featureId: 'handoff-brief' }, fromPage(), d), { opened: true });
  assert.equal(d.calls.saved[0].featureId, 'handoff-brief');
});

// ---- a site that was turned off (security audit 2, AB2-01 / AB2-02) --------------------------------------------------

test('a page of a site that is no longer turned on is answered with the code SITE_OFF, for both requests and for the probe', async () => {
  const d = deps({ activeInstances: async () => [] });
  for (const message of [actions, launch, { type: MSG.BAR_ACTIONS }]) {
    const err = await handleBarMessage(message, fromPage(), d).then(() => null, (e) => e);
    assert.ok(err, JSON.stringify(message));
    assert.equal(err.code, SITE_OFF_CODE, JSON.stringify(message));
  }
  assert.deepEqual(d.calls.saved, []);
});

test('BAR_ACTIONS without a table only says whether the bar is on here (nothing about any record)', async () => {
  assert.deepEqual(await handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), deps()), { actions: [], bar: true, language: 'en', theme: '' });
  assert.deepEqual(await handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), deps({ loadSettings: async () => ({ pageBar: false }) })), { actions: [], bar: false, language: 'en', theme: '' });
  const org = deps({ loadPolicy: async () => normalizePolicy({ disablePageBar: true }) });
  assert.deepEqual(await handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), org), { actions: [], bar: false, language: 'en', theme: '' });
  // and it is still only for a content script of a turned-on site
  await assert.rejects(handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage({ frameId: 1 }), deps()), /only allowed/);
  assert.deepEqual(org.calls.open, []);
});

test('turning a site off tells its open tabs to retire, and a tab that cannot be told does not stop the others', async () => {
  const sent = [];
  const count = await retireOpenTabs('https://acme.service-now.com/*', {
    queryTabs: async (q) => {
      assert.deepEqual(q, { url: 'https://acme.service-now.com/*' });
      return [{ id: 3 }, { id: 4 }, { id: -1 }, {}, null];
    },
    sendToTab: async (id, message) => {
      sent.push([id, message.type]);
      if (id === 3) throw new Error('Could not establish connection. Receiving end does not exist.');
    },
  });
  assert.equal(count, 2);
  assert.deepEqual(sent.sort(), [[3, MSG.SITE_OFF], [4, MSG.SITE_OFF]]);
  assert.equal(await retireOpenTabs('x', { queryTabs: async () => { throw new Error('no'); }, sendToTab: async () => {} }), 0);
});

test('the content script retires on SITE_OFF from this extension, and answers nothing after that', () => {
  const panel = { id: ID, origin: `chrome-extension://${ID}`, url: `chrome-extension://${ID}/sidepanel.html` };
  const worker = { id: ID, url: `chrome-extension://${ID}/background.bundle.js` };
  const read = { type: MSG.READ, op: 'pack' };
  const own = { id: ID, origin: `chrome-extension://${ID}` };
  assert.equal(contentMessageAction(read, panel, own), 'answer');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, worker, own), 'retire');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, { id: ID }, own), 'retire', 'the worker may not report an origin');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, { id: 'another-extension' }, own), 'ignore');
  assert.equal(contentMessageAction(read, { id: 'another-extension', origin: 'chrome-extension://another-extension' }, own), 'ignore');
  assert.equal(contentMessageAction(read, fromPage(), own), 'ignore', 'a content script is not an extension page');
  // retired: nothing at all, not even another SITE_OFF
  assert.equal(contentMessageAction(read, panel, own, true), 'ignore');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, worker, own, true), 'ignore');
  // "this extension" not known (no id): nothing, not even SITE_OFF
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, worker, { origin: own.origin }), 'ignore');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, worker, ID), 'ignore', 'the bare id is not enough: the origin of our pages is needed too');
});

test('Firefox: the content script answers the sidebar (moz-extension://<uuid>), and retires on SITE_OFF from the event page', () => {
  const GECKO = 'agentbuddy@ifbash.example';
  const UUID = '5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37';
  const own = { id: GECKO, origin: `moz-extension://${UUID}` };
  const read = { type: MSG.READ, op: 'pack' };
  assert.equal(contentMessageAction(read, { id: GECKO, url: `moz-extension://${UUID}/sidepanel.html` }, own), 'answer');
  assert.equal(contentMessageAction({ type: MSG.SITE_OFF }, { id: GECKO, url: `moz-extension://${UUID}/_generated_background_page.html` }, own), 'retire');
  assert.equal(contentMessageAction(read, { id: GECKO, url: `moz-extension://${UUID.replace('5b', '6c')}/sidepanel.html` }, own), 'ignore', 'another install\'s pages');
  // and the bar's requests from a content script in Firefox are told apart from the sidebar the same way
  assert.equal(contentScriptOrigin(fromPage({ id: GECKO, origin: undefined }), GECKO), SITE);
  assert.equal(contentScriptOrigin({ id: GECKO, tab: { id: 7 }, frameId: 0, url: `moz-extension://${UUID}/sidepanel.html` }, GECKO), '');
});

// ---- storage closed to content scripts (security audit 2, AB2-03) ----------------------------------------------------

test('the worker closes storage.session, storage.local and storage.sync to content scripts where the browser allows it', async () => {
  const calls = [];
  const area = (name, fail) => ({ setAccessLevel: async (o) => { calls.push([name, o.accessLevel]); if (fail) throw new Error('This StorageArea is not available for setting access level'); } });
  const result = await restrictStorageAccess({ session: area('session'), local: area('local', true), sync: area('sync'), managed: area('managed') });
  assert.deepEqual(calls, [['session', 'TRUSTED_CONTEXTS'], ['local', 'TRUSTED_CONTEXTS'], ['sync', 'TRUSTED_CONTEXTS']]);
  assert.deepEqual(result, { session: 'closed', local: 'unchanged', sync: 'closed' }, 'an area the browser cannot close is reported, not thrown');
  // managed is left alone: the content script reads the organisation's policy from it
  assert.ok(!calls.some(([name]) => name === 'managed'));
  assert.deepEqual(await restrictStorageAccess({}), { session: 'unchanged', local: 'unchanged', sync: 'unchanged' });
  assert.deepEqual(await restrictStorageAccess(undefined), { session: 'unchanged', local: 'unchanged', sync: 'unchanged' });
});

test('the service worker closes storage first thing, and retires open tabs before it removes a site\'s permission', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'background', 'service-worker.js'), 'utf8');
  assert.match(src, /^restrictStorageAccess\(chrome\.storage\)/m, 'called at the top level of the worker, on every start');
  const disable = src.slice(src.indexOf('async function disableInstance'));
  const retireAt = disable.indexOf('retireOpenTabs(');
  const removeAt = disable.indexOf('chrome.permissions.remove');
  assert.ok(retireAt > 0 && removeAt > retireAt, 'the tabs are told while the worker can still find them');
});

test('no content-script code reads or writes chrome.storage.local, .session or .sync (closing them breaks nothing)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src', 'content');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(dir);
  walk(path.join(__dirname, '..', 'src', 'page'));
  for (const f of files) assert.ok(!/storage\??\.(local|session|sync)\b/.test(fs.readFileSync(f, 'utf8')), f);
});

test('the bar has the colours of the panel: light or dark when the person chose one, nothing when it follows the computer', async () => {
  const answer = (settings) => handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), deps({ loadSettings: async () => settings }));
  assert.equal((await answer({ theme: 'dark' })).theme, 'dark');
  assert.equal((await answer({ theme: 'light' })).theme, 'light');
  assert.equal((await answer({ theme: 'system' })).theme, '');
  assert.equal((await answer({ theme: 'purple' })).theme, '', 'an unknown word means the computer');
  assert.equal((await answer({})).theme, '');
});

test('the bar speaks the language of the panel: the worker says which one, and the labels of the actions come in it', async () => {
  const arabic = /[؀-ۿ]/;
  try {
    const ar = await handleBarMessage(actions, fromPage(), deps({ loadSettings: async () => ({ language: 'ar' }) }));
    assert.equal(ar.language, 'ar');
    assert.ok(ar.actions.length > 0 && ar.actions.every((a) => arabic.test(a.label)), JSON.stringify(ar.actions.map((a) => a.label)));
    assert.equal((await handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), deps({ loadSettings: async () => ({ language: 'ar' }) }))).language, 'ar', 'the question "is the bar on?" carries it too');
    const en = await handleBarMessage(actions, fromPage(), deps({ loadSettings: async () => ({ language: 'en' }) }));
    assert.equal(en.language, 'en');
    assert.ok(en.actions.every((a) => !arabic.test(a.label)));
  } finally {
    const { setLanguage } = await import('../src/i18n/index.js');
    setLanguage('en');
  }
});
