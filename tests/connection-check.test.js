import { mount, click, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderSection } from '../src/options/Options.jsx';
import { connectionRefusal, testConnection, loadModelList } from '../src/lib/connectionCheck.js';
import { assertRunnable } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

// Settings' "Test connection" and "Load models" carry the key (and the test one word) to the AI address. "Local model only" promises
// that nothing leaves the computer, so both refuse a hosted provider in that mode with the same sentence as a run (NOT_LOCAL), before
// the browser is asked for permission and before any request. And an organisation that switched AI off is refused there too.

const NOT_LOCAL = /Your privacy mode only allows an AI model running on this computer/;
const effFor = (settings, policy, over = {}) => {
  const e = effectiveSettings(settings, policy);
  return { values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey: e.values.providedApiKey, keyLocked: false, ...over };
};

// Dependencies that record what was asked of them and fail the test if a refused check reaches them.
function spies() {
  const seen = { asked: [], sent: [], listed: [], firewalls: [] };
  const deps = {
    ensureAiPermission: async (cfg) => seen.asked.push(cfg.provider),
    createFirewall: (opts) => {
      seen.firewalls.push(opts);
      return { buildRequest: (req) => ({ sealed: true, req }) };
    },
    sendChat: async (cfg, request, opts) => {
      seen.sent.push({ cfg, request, opts });
      return { content: 'OK', truncated: false };
    },
    listModels: async (cfg) => {
      seen.listed.push(cfg.provider);
      return ['gpt-5-mini', 'gpt-5', 'llama3.1'];
    },
  };
  return { seen, deps };
}

test('local-only with a hosted provider: the test and the list refuse with the run\'s NOT_LOCAL sentence, before any permission or request', async () => {
  for (const [settings, policy] of [
    [{ provider: 'openai', piiMode: 'local-only' }, {}], // the person's own choice
    [{ provider: 'openai' }, { piiMode: 'local-only' }], // the organisation's floor
    [{ provider: 'anthropic', piiMode: 'local-only' }, {}],
  ]) {
    const eff = effFor(settings, policy);
    const { seen, deps } = spies();
    await assert.rejects(() => testConnection({ values: eff.values, policy: eff.policy, apiKey: 'sk-test-0123456789', deps }), NOT_LOCAL);
    await assert.rejects(() => loadModelList({ values: eff.values, policy: eff.policy, apiKey: 'sk-test-0123456789', deps }), NOT_LOCAL);
    assert.deepEqual(seen, { asked: [], sent: [], listed: [], firewalls: [] }, JSON.stringify(settings));
    // The very sentence a run would refuse with.
    const config = resolveProviderConfig(eff.values, 'sk-test-0123456789');
    let run = '';
    try {
      assertRunnable({ feature: featureById('record-summary'), pack: { table: 'incident' }, values: eff.values, policy: eff.policy, config });
    } catch (err) {
      run = err.message;
    }
    assert.equal(connectionRefusal({ config, values: eff.values, policy: eff.policy }), run);
  }
});

test('local-only with a model on this computer: the test goes through a firewall in the person\'s privacy mode', async () => {
  for (const settings of [{ provider: 'ollama' }, { provider: 'custom', baseUrls: { custom: 'http://127.0.0.1:1234/v1' }, models: { custom: 'qwen' } }]) {
    const eff = effFor({ ...settings, piiMode: 'local-only' }, {});
    const { seen, deps } = spies();
    const out = await testConnection({ values: eff.values, policy: eff.policy, apiKey: '', timeoutMs: 45000, deps });
    assert.deepEqual(out, { answer: 'OK', note: '' });
    assert.equal(seen.firewalls[0].mode, 'local-only');
    assert.equal(seen.firewalls[0].endpointIsLocal, true);
    assert.equal(seen.sent[0].request.sealed, true, 'only what the firewall built is sent');
    assert.equal(seen.sent.length, 1);
    // A key check, not a call that counts against a cap; a model on this computer keeps its own (longer) time limit.
    assert.equal(seen.sent[0].opts.kind, 'validate');
    assert.equal(seen.sent[0].opts.timeoutMs, undefined);
  }
});

test('AI switched off by the organisation: neither Settings action reaches out', async () => {
  const eff = effFor({ provider: 'openai' }, { aiEnabled: false });
  const { seen, deps } = spies();
  await assert.rejects(() => testConnection({ values: eff.values, policy: eff.policy, apiKey: 'sk-test-0123456789', deps }), /switched AI Assist off/);
  await assert.rejects(() => loadModelList({ values: eff.values, policy: eff.policy, apiKey: 'sk-test-0123456789', deps }), /switched AI Assist off/);
  assert.deepEqual(seen, { asked: [], sent: [], listed: [], firewalls: [] });
});

test('the organisation\'s rules come before the address, as in a run; the list leaves out the model rule and is cut to the allowed models', async () => {
  // An AI address in the policy that is not valid: "ask your administrator", not "The AI address is not valid".
  const bad = effFor({ provider: 'openai' }, { aiProvider: 'openai', aiBaseUrl: 'http://gw.corp.example/v1' });
  const config = resolveProviderConfig(bad.values, 'sk-x');
  assert.match(connectionRefusal({ config, values: bad.values, policy: bad.policy }), /Ask your administrator/);
  // The list: a model outside allowedModels does not stop it; what comes back is cut to the allowed ones.
  const eff = effFor({ provider: 'openai', models: { openai: 'gpt-5-mini' } }, { allowedModels: ['gpt-5'] });
  const { seen, deps } = spies();
  assert.deepEqual(await loadModelList({ values: eff.values, policy: eff.policy, apiKey: 'sk-test-0123456789', deps }), ['gpt-5']);
  assert.deepEqual(seen.asked, ['openai']);
});

test('Settings page: "Local model only" stops Test connection and Load models from calling a hosted provider, with no permission prompt', async () => {
  const fake = makeChrome();
  const asked = [];
  fake.chrome.permissions = { contains: async () => false, request: async ({ origins }) => (asked.push(...origins), true) };
  globalThis.chrome = fake.chrome;
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (/\/models$/.test(String(url))) return new Response(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const eff = effFor({ provider: 'openai', models: { openai: 'gpt-5-mini' } }, { piiMode: 'local-only' }, { apiKey: 'sk-personal-0123456789abcdef' });
    assert.equal(eff.values.piiMode, 'local-only');
    const ui = await mount(<ProviderSection eff={eff} reload={() => {}} />);
    await click(ui.button('Test connection'));
    assert.match(ui.text(), NOT_LOCAL);
    assert.ok(!/Connected/.test(ui.text()));
    await click(ui.button('Load models from the server'));
    assert.match(ui.text(), NOT_LOCAL);
    assert.deepEqual(calls, [], 'nothing was sent to the hosted provider');
    assert.deepEqual(asked, [], 'the browser was not asked for permission to contact it');
    await ui.unmount();
  } finally {
    globalThis.fetch = real;
  }
});
