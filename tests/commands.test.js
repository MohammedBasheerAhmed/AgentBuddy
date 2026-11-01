import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COMMAND_FEATURES, handleCommand } from '../src/background/commands.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The keyboard shortcuts: which key opens the panel, which one starts an action, and that the rules of the page bar hold for them too.

const ORIGIN = 'https://dev1.service-now.com';
const SYS = 'a'.repeat(32);
const TAB = { id: 7, url: `${ORIGIN}/incident.do?sys_id=${SYS}` };

function deps(over = {}) {
  const calls = { opened: [], launches: [], asked: [] };
  return {
    calls,
    deps: {
      openPanel: async (tabId) => void calls.opened.push(tabId),
      pageState: async (tabId) => (calls.asked.push(tabId), { record: { table: 'incident', sysId: SYS, number: 'INC0010001' } }),
      activeInstances: async () => [ORIGIN],
      loadSettings: async () => ({ quickPins: {} }),
      loadPolicy: async () => normalizePolicy({}),
      aiOn: async () => true,
      saveLaunch: async (launch) => void calls.launches.push(launch),
      now: () => 1000,
      ...over,
    },
  };
}

test('the manifest declares the three commands, with keys for Windows and Mac, and no new permission', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.commands).sort(), Object.keys(COMMAND_FEATURES).sort());
  for (const [name, c] of Object.entries(manifest.commands)) {
    assert.match(c.suggested_key.default, /^Alt\+Shift\+[0-9]$/, name);
    assert.match(c.suggested_key.mac, /^MacCtrl\+Shift\+[0-9]$/, name);
    assert.ok(c.description.length > 5);
  }
  assert.deepEqual(manifest.permissions, ['storage', 'sidePanel', 'scripting', 'activeTab']);
  assert.ok(Object.keys(manifest.commands).length <= 4, 'a browser takes at most four suggested keys');
});

test('open-panel only opens the panel, and does not look at the page', async () => {
  const { calls, deps: d } = deps();
  assert.deepEqual(await handleCommand('open-panel', TAB, d), { opened: true, started: false });
  assert.deepEqual(calls.opened, [7]);
  assert.deepEqual(calls.asked, []);
  assert.deepEqual(calls.launches, []);
});

test('summarise and reply open the panel and leave one request for the record that is open', async () => {
  for (const [command, featureId] of [['summarise', 'record-summary'], ['reply', 'reply-draft']]) {
    const { calls, deps: d } = deps();
    assert.deepEqual(await handleCommand(command, TAB, d), { opened: true, started: true }, command);
    assert.deepEqual(calls.launches, [{ tabId: 7, table: 'incident', sysId: SYS, featureId, at: 1000 }], command);
  }
});

test('the panel is opened before anything is waited for (the browser allows it only while the key press is handled)', async () => {
  const order = [];
  const { deps: d } = deps({
    openPanel: (tabId) => (order.push('open'), Promise.resolve(tabId)),
    activeInstances: async () => (order.push('instances'), [ORIGIN]),
  });
  const done = handleCommand('summarise', TAB, d);
  assert.equal(order[0], 'open', 'the panel is opened in the same turn as the key press, before the first thing that is asked for');
  await done;
  assert.deepEqual(order, ['open', 'instances']);
});

test('no request is left when it should not start: unknown command, no tab, other site, no record, blocked table, action not offered', async () => {
  let r = deps();
  assert.deepEqual(await handleCommand('nonsense', TAB, r.deps), { opened: false, started: false });
  assert.deepEqual(r.calls.opened, []);
  r = deps();
  assert.deepEqual(await handleCommand('summarise', undefined, r.deps), { opened: false, started: false });
  assert.deepEqual(await handleCommand('summarise', { id: -1 }, r.deps), { opened: false, started: false });

  r = deps({ activeInstances: async () => ['https://other.service-now.com'] });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false }, 'a site that is not turned on');
  assert.deepEqual(r.calls.launches, []);

  r = deps({ pageState: async () => ({ record: null }) });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false }, 'no record open');
  r = deps({ pageState: async () => { throw new Error('no content script'); } });
  assert.deepEqual(await handleCommand('reply', TAB, r.deps), { opened: true, started: false }, 'the page does not answer');

  r = deps({ loadPolicy: async () => normalizePolicy({ blockedTables: ['incident'] }) });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false }, 'a table the organisation blocked');
  assert.deepEqual(r.calls.launches, []);

  r = deps({ pageState: async () => ({ record: { table: 'sn_hr_core_case', sysId: SYS } }) });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false }, 'HR content the organisation did not allow');

  r = deps({ aiOn: async () => false });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false }, 'AI is off: only Insights items are offered, not Summarise');
  assert.deepEqual(r.calls.launches, []);
});

test('a panel that cannot be opened does not stop the request being left, and a failure anywhere leaves the panel open', async () => {
  let r = deps({ openPanel: async () => { throw new Error('no window'); } });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: false, started: true });
  r = deps({ saveLaunch: async () => { throw new Error('storage'); } });
  assert.deepEqual(await handleCommand('summarise', TAB, r.deps), { opened: true, started: false });
});
