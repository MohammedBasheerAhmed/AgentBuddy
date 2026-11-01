import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describeInstances, policyInstances, reinjectAfterInstalled, wantedInstances } from '../src/background/instances.js';
import { barActions, barAiOn, handleBarMessage } from '../src/background/bar.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { MSG } from '../src/lib/messages.js';
import { makeLaunch } from '../src/lib/launch.js';

// F1: the organisation's exact instances are turned on by themselves (when the browser granted them), open tabs are given a fresh
// content script after an update, and F6: the bar on the page offers AI actions only when AI can run, else the no-AI items.

const A = 'https://acme.service-now.com';
const B = 'https://beta.service-now.com';

test('the organisation\'s exact instances are turned on; a wildcard names no site and is never turned on by itself', () => {
  const policy = normalizePolicy({ allowedInstances: [A, '*.corp.example', 'https://Beta.Service-Now.com:443/', 'not a url'] });
  assert.deepEqual(policyInstances(policy), [A, B]);
  assert.deepEqual(policyInstances(normalizePolicy({})), [], 'no policy: nothing turned on by itself');
  assert.deepEqual(policyInstances(normalizePolicy({ allowedInstances: ['*.service-now.com'] })), []);
});

test('wanted sites: the person\'s, then the organisation\'s, each once, only what the policy allows', () => {
  const policy = normalizePolicy({ allowedInstances: [A, '*.corp.example'] });
  assert.deepEqual(wantedInstances({ instances: ['https://x.corp.example', A] }, policy), ['https://x.corp.example', A]);
  assert.deepEqual(wantedInstances({ instances: [B] }, policy), [A], 'a site the policy does not allow is dropped');
  assert.deepEqual(wantedInstances({ instances: [B, 'ftp://bad'] }, normalizePolicy({})), [B]);
  assert.deepEqual(wantedInstances({}, normalizePolicy({})), []);
});

test('after install and after an update the open tabs get the content scripts; not after a browser update', () => {
  assert.equal(reinjectAfterInstalled('update'), true);
  assert.equal(reinjectAfterInstalled('install'), true);
  assert.equal(reinjectAfterInstalled('chrome_update'), false);
  assert.equal(reinjectAfterInstalled('shared_module_update'), false);
  assert.equal(reinjectAfterInstalled(undefined), false);
});

test('Settings lists the organisation\'s sites as such (no Turn off); a site the person turned on themselves is theirs', () => {
  const policy = normalizePolicy({ allowedInstances: [A, B] });
  assert.deepEqual(describeInstances([A, B], { instances: [B] }, policy), [{ origin: A, managed: true }, { origin: B, managed: false }]);
});

test('the service worker wires it in: onInstalled re-injects into open tabs, a granted site is picked up, syncs run one at a time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'background', 'service-worker.js'), 'utf8');
  assert.match(src, /onInstalled\.addListener\(async \(\{ reason \} = \{\}\) =>/);
  assert.match(src, /reinjectAfterInstalled\(reason\)/);
  assert.match(src, /injectIntoOpenTabs\(origin\)/);
  assert.match(src, /permissions\.onAdded\?\.addListener/);
  assert.match(src, /wantedInstances\(settings, policy\)/);
  assert.match(src, /let syncing = Promise\.resolve\(\);/);
});

// ---- the bar's actions and AI ---------------------------------------------------------------------------------------------------

const keyMode = (mode) => ({ keyMode: async () => mode });

test('barAiOn: AI actions only when AI can run: allowed, not skipped, a key saved (or none needed, or supplied)', async () => {
  const none = normalizePolicy({});
  assert.equal(await barAiOn({ provider: 'openai' }, none, keyMode('local')), true);
  assert.equal(await barAiOn({ provider: 'openai' }, none, keyMode('encrypted')), true, 'a locked key counts: the panel asks for the passphrase');
  assert.equal(await barAiOn({ provider: 'openai' }, none, keyMode('none')), false, 'no key: a click would only say "Add an AI key"');
  assert.equal(await barAiOn({ provider: 'openai', aiSkipped: true }, none, keyMode('local')), false, '"Skip AI for now"');
  assert.equal(await barAiOn({ provider: 'openai' }, normalizePolicy({ aiEnabled: false }), keyMode('local')), false, 'switched off by the organisation');
  assert.equal(await barAiOn({ provider: 'openai' }, normalizePolicy({ aiBaseUrl: 'not an address' }), keyMode('local')), false, 'an AI address that is not valid');
  assert.equal(await barAiOn({ provider: 'ollama' }, none, keyMode('none')), true, 'a model on this computer needs no key');
  assert.equal(await barAiOn({ provider: 'openai' }, normalizePolicy({ aiProvider: 'openai', providedApiKey: 'sk-org-0123456789' }), keyMode('none')), true, 'a key the organisation supplies');
  assert.equal(await barAiOn({ provider: 'openai' }, none, { keyMode: async () => { throw new Error('no vault'); } }), true, 'the store cannot be asked: offer, the panel says what is missing');
});

test('barActions: with AI the AI actions (marked), without AI the Insights cards, which run nothing and send nothing', async () => {
  const policy = normalizePolicy({});
  const on = await barActions({ table: 'incident', settings: {}, policy, deps: { aiOn: async () => true } });
  assert.ok(on.length > 0 && on.every((a) => a.ai === true && !a.id.startsWith('card:')), JSON.stringify(on));
  const off = await barActions({ table: 'incident', settings: {}, policy, deps: { aiOn: async () => false } });
  assert.deepEqual(off.map((a) => [a.id, a.ai]), [['card:ready', false], ['card:related', false]]);
  assert.deepEqual(await barActions({ table: 'kb_knowledge', settings: {}, policy, deps: { aiOn: async () => false } }), [], 'no cards for an article: no bar');
  assert.equal((await barActions({ table: 'incident', settings: {}, policy, deps: {} })).every((a) => a.ai), true, 'no aiOn in deps: AI on, as before');
});

test('the bar launches a card the same way as an action: only one it offered, and the request names the card', async () => {
  const saved = [];
  const d = {
    runtimeId: 'abcdefghijklmnopabcdefghijklmnop',
    activeInstances: async () => [A],
    loadSettings: async () => ({}),
    loadPolicy: async () => normalizePolicy({}),
    now: () => 5000,
    openPanel: async () => {},
    saveLaunch: async (launch) => void saved.push(launch),
    aiOn: async () => false,
  };
  const sender = { id: d.runtimeId, tab: { id: 7 }, frameId: 0, origin: A, url: `${A}/incident.do` };
  const answer = await handleBarMessage({ type: MSG.BAR_ACTIONS, table: 'incident' }, sender, d);
  assert.deepEqual(answer.actions.map((a) => a.id), ['card:ready', 'card:related']);
  await assert.rejects(handleBarMessage({ type: MSG.BAR_LAUNCH, table: 'incident', sysId: 'a'.repeat(32), featureId: 'record-summary' }, sender, d), /not available here/, 'no AI action while AI is off');
  assert.deepEqual(await handleBarMessage({ type: MSG.BAR_LAUNCH, table: 'incident', sysId: 'a'.repeat(32), featureId: 'card:ready' }, sender, d), { opened: true });
  assert.equal(saved[0].featureId, 'card:ready');
  assert.equal(makeLaunch({ tabId: 1, table: 'incident', sysId: 'a'.repeat(32), featureId: 'card:Ready', now: 1 }), null);
  assert.equal(makeLaunch({ tabId: 1, table: 'incident', sysId: 'a'.repeat(32), featureId: 'cards:ready', now: 1 }), null);
});
