import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/lib/messages.js';
import { contentScriptOrigin } from '../src/lib/senderCheck.js';
import { BAR_TYPES, handleBarMessage } from '../src/background/bar.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { QUICK_DEFAULTS } from '../src/features/quick.js';

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
  for (const table of ['', 'a b', '../x', '1incident', 'x-y', 5, undefined]) await assert.rejects(handleBarMessage({ ...actions, table }, fromPage(), deps()), /valid record/, String(table));
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
  assert.deepEqual((await handleBarMessage(actions, fromPage(), d)).actions, [{ id: 'handoff-brief', label: 'Hand-off brief' }]);
});

test('BAR_ACTIONS answers with nothing when the person switched the bar off', async () => {
  const d = deps({ loadSettings: async () => ({ pageBar: false }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [] });
});

test('BAR_ACTIONS answers with nothing when the organisation switched the bar off, whatever the person chose', async () => {
  const d = deps({ loadSettings: async () => ({ pageBar: true }), loadPolicy: async () => normalizePolicy({ disablePageBar: true }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [] });
  await assert.rejects(handleBarMessage(launch, fromPage(), d), /not available/);
  assert.deepEqual(d.calls.saved, []);
});

test('BAR_ACTIONS answers with nothing for a table the organisation blocked', async () => {
  const d = deps({ loadPolicy: async () => normalizePolicy({ blockedTables: ['incident'] }) });
  assert.deepEqual(await handleBarMessage(actions, fromPage(), d), { actions: [] });
});

test('BAR_ACTIONS answers with nothing on HR content unless the organisation allows it', async () => {
  const hr = { ...actions, table: 'sn_hr_core_case' };
  assert.deepEqual(await handleBarMessage(hr, fromPage(), deps()), { actions: [] });
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
