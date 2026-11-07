import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/lib/messages.js';
import { barActions, handleBarMessage } from '../src/background/bar.js';
import { handleCommand } from '../src/background/commands.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { QUICK_DEFAULTS } from '../src/features/quick.js';

// The bar on the page and the keyboard shortcuts offer no AI action on a page that is not a ticket's (audit of 2026-11-07, part 2:
// on /ui_page.do?sys_id=... the dock offered "Summarise" and "Summarise discussion").

const RUNTIME = 'abcdefghijklmnopabcdefghijklmnop';
const SITE = 'https://dev364920.service-now.com';
const SYS = 'a'.repeat(32);
const fromPage = () => ({ id: RUNTIME, tab: { id: 7 }, frameId: 0, origin: SITE, url: `${SITE}/ui_page.do` });

function barDeps(over = {}) {
  const calls = { open: [], saved: [] };
  return {
    runtimeId: RUNTIME,
    calls,
    activeInstances: async () => [SITE],
    loadSettings: async () => ({}),
    loadPolicy: async () => normalizePolicy({}),
    now: () => 5000,
    openPanel: async (tabId) => void calls.open.push(tabId),
    saveLaunch: async (launch) => void calls.saved.push(launch),
    ...over,
  };
}

const ids = (list) => list.map((a) => a.id);

test('barActions: nothing for a table that is not a ticket\'s, the usual actions for one that is', async () => {
  const settings = {};
  const policy = normalizePolicy({});
  const deps = { aiOn: async () => true };
  for (const table of ['ui_page', 'sys_ui_page', 'home', 'sys_user', 'sc_cat_item', 'u_facilities_request', 'x_acme_visit']) {
    assert.deepEqual(await barActions({ table, settings, policy, deps }), [], table);
  }
  assert.deepEqual(ids(await barActions({ table: 'incident', settings, policy, deps })), QUICK_DEFAULTS.incident);
  assert.deepEqual(ids(await barActions({ table: 'kb_knowledge', settings, policy, deps })), QUICK_DEFAULTS.knowledge);
  // (a security incident is a sensitive family: every function on it needs Strict privacy mode, so the bar offers nothing in the usual mode)
  assert.deepEqual(await barActions({ table: 'sn_si_incident', settings, policy, deps }), []);
  assert.deepEqual(ids(await barActions({ table: 'sn_si_incident', settings: { piiMode: 'strict' }, policy, deps })), QUICK_DEFAULTS.other);
});

test('barActions: also nothing without AI for a page that is not a ticket\'s (no Insights items either)', async () => {
  const deps = { aiOn: async () => false };
  assert.deepEqual(await barActions({ table: 'ui_page', settings: {}, policy: normalizePolicy({}), deps }), []);
  assert.ok((await barActions({ table: 'incident', settings: {}, policy: normalizePolicy({}), deps })).length > 0);
});

test('barActions: a customer\'s own table is offered the actions when its form proved a number, or the policy names its family', async () => {
  const deps = { aiOn: async () => true };
  assert.deepEqual(ids(await barActions({ table: 'u_facilities_request', settings: {}, policy: normalizePolicy({}), deps, proven: true })), QUICK_DEFAULTS.other);
  assert.deepEqual(await barActions({ table: 'u_facilities_request', settings: {}, policy: normalizePolicy({}), deps, proven: false }), []);
  assert.deepEqual(await barActions({ table: 'u_facilities_request', settings: {}, policy: normalizePolicy({}), deps, proven: 'true' }), [], 'only a real true');
  const policy = normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'] });
  assert.deepEqual(ids(await barActions({ table: 'x_acme_hr_case', settings: { piiMode: 'strict' }, policy, deps })), QUICK_DEFAULTS.other);
  assert.deepEqual(await barActions({ table: 'x_acme_visit', settings: {}, policy, deps }), []);
});

test('the bar\'s request for a page that is not a ticket\'s answers with no actions, and a launch for one is refused', async () => {
  const d = barDeps();
  const answer = await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'ui_page' }, fromPage(), d);
  assert.deepEqual(answer.actions, []);
  assert.equal(answer.bar, true);
  await assert.rejects(handleBarMessage({ type: MSG.BAR_LAUNCH, table: 'ui_page', sysId: SYS, featureId: 'record-summary' }, fromPage(), d), /isn't available on this page/);
  assert.deepEqual(d.calls.saved, [], 'nothing was left for the panel');
  // the question "is the bar on here?" is unchanged
  assert.deepEqual((await handleBarMessage({ type: MSG.BAR_ACTIONS }, fromPage(), barDeps())).actions, []);
});

test('the bar\'s request for a ticket is unchanged, and `proven` opens a customer\'s own table', async () => {
  const d = barDeps();
  assert.deepEqual(ids((await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'incident' }, fromPage(), d)).actions), QUICK_DEFAULTS.incident);
  assert.deepEqual((await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'u_facilities_request' }, fromPage(), d)).actions, []);
  assert.deepEqual((await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'u_facilities_request', proven: 'yes' }, fromPage(), d)).actions, []);
  assert.deepEqual(ids((await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'u_facilities_request', proven: true }, fromPage(), d)).actions), QUICK_DEFAULTS.other);
  const launched = await handleBarMessage({ type: MSG.BAR_LAUNCH, table: 'u_facilities_request', sysId: SYS, featureId: 'record-summary', proven: true }, fromPage(), barDeps());
  assert.equal(typeof launched.opened, 'boolean');
  await assert.rejects(handleBarMessage({ type: MSG.BAR_LAUNCH, table: 'u_facilities_request', sysId: SYS, featureId: 'record-summary' }, fromPage(), barDeps()), /isn't available on this page/);
});

// ---- the keyboard shortcuts ----------------------------------------------------------------------------------------------------

function commandDeps(record) {
  const calls = { launches: [] };
  return {
    calls,
    deps: {
      openPanel: async () => {},
      pageState: async () => ({ record }),
      activeInstances: async () => [SITE],
      loadSettings: async () => ({ quickPins: {} }),
      loadPolicy: async () => normalizePolicy({}),
      aiOn: async () => true,
      saveLaunch: async (launch) => void calls.launches.push(launch),
      now: () => 1000,
    },
  };
}
const TAB = { id: 7, url: `${SITE}/ui_page.do?sys_id=${SYS}` };

test('a shortcut on a page that is not a ticket\'s opens the panel and starts nothing', async () => {
  for (const command of ['summarise', 'reply']) {
    const { calls, deps } = commandDeps({ table: 'ui_page', sysId: SYS, number: '' });
    assert.deepEqual(await handleCommand(command, TAB, deps), { opened: true, started: false }, command);
    assert.deepEqual(calls.launches, []);
  }
});

test('a shortcut on a ticket starts as before; on a customer\'s own table only when the record carries a number', async () => {
  const ticket = commandDeps({ table: 'incident', sysId: SYS, number: '' });
  assert.deepEqual(await handleCommand('summarise', TAB, ticket.deps), { opened: true, started: true });
  assert.equal(ticket.calls.launches.length, 1);
  const own = commandDeps({ table: 'u_facilities_request', sysId: SYS, number: 'FAC0001234' });
  assert.deepEqual(await handleCommand('summarise', TAB, own.deps), { opened: true, started: true });
  assert.equal(own.calls.launches[0].table, 'u_facilities_request');
  const unnumbered = commandDeps({ table: 'u_facilities_request', sysId: SYS, number: '' });
  assert.deepEqual(await handleCommand('summarise', TAB, unnumbered.deps), { opened: true, started: false });
});
