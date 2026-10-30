import { mount, click, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderSection } from '../src/options/Options.jsx';
import { effectiveSettings } from '../src/policy/policy.js';

// Settings' "Test connection" and "Load models" carry the key to the AI address, so the organisation's provider and address rules
// (checkProviderAllowed) apply to them as to every run: a provider the policy does not allow is refused before the browser is asked
// for permission and before any request.

const GATEWAY = 'https://ai-gateway.corp.example/v1';
const ORG_KEY = 'sk-org-0123456789abcdef';
const effFor = (settings, policy) => {
  const e = effectiveSettings(settings, policy);
  return { values: e.values, locked: e.locked, policy: e.policy, apiKey: e.values.providedApiKey, keyLocked: false };
};

function setup() {
  const fake = makeChrome();
  const asked = [];
  fake.chrome.permissions = {
    contains: async () => false,
    request: async ({ origins }) => {
      asked.push(...origins);
      return true;
    },
  };
  globalThis.chrome = fake.chrome;
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (/\/models$/.test(String(url))) return new Response(JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  return { fake, asked, calls, restore: () => (globalThis.fetch = real) };
}

test('policy {aiBaseUrl, providedApiKey} with provider gemini: Test connection and Load models refuse, with no fetch and no permission prompt', async () => {
  const env = setup();
  try {
    const eff = effFor({ provider: 'gemini' }, { aiBaseUrl: GATEWAY, providedApiKey: ORG_KEY });
    const ui = await mount(<ProviderSection eff={eff} reload={() => {}} />);
    await click(ui.button('Test connection'));
    assert.match(ui.text(), /Your organisation requires its own AI endpoint/);
    await click(ui.button('Load models from the server'));
    assert.match(ui.text(), /Your organisation requires its own AI endpoint/);
    assert.deepEqual(env.calls, [], 'nothing was fetched');
    assert.deepEqual(env.asked, [], 'the browser was not asked for permission to contact the Gemini address');
    assert.ok(!ui.text().includes(ORG_KEY), 'the organisation key is never on the page');
    await ui.unmount();
  } finally {
    env.restore();
  }
});

test('the allowed set-up (the pinned gateway) is tested and listed normally, with the safe fetch options', async () => {
  const env = setup();
  try {
    const eff = effFor({ provider: 'openai' }, { aiProvider: 'openai', aiBaseUrl: GATEWAY, providedApiKey: ORG_KEY, allowedModels: ['gpt-5-mini'] });
    const ui = await mount(<ProviderSection eff={eff} reload={() => {}} />);
    await click(ui.button('Test connection'));
    assert.match(ui.text(), /Connected\. The model answered: OK/);
    assert.deepEqual(env.asked, ['https://ai-gateway.corp.example/*']);
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].url, `${GATEWAY}/chat/completions`);
    for (const [k, v] of Object.entries({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })) assert.equal(env.calls[0].init[k], v, k);
    await ui.unmount();
  } finally {
    env.restore();
  }
});

test('Load models: the model rule is not applied to the list call itself (the list is cut to the allowed models afterwards)', async () => {
  const env = setup();
  try {
    // The model in use is not on the allowed list yet: the list may still be loaded from the pinned address.
    const eff = effFor({ provider: 'openai', models: { openai: 'something-else' } }, { aiBaseUrl: GATEWAY, providedApiKey: ORG_KEY });
    const ui = await mount(<ProviderSection eff={eff} reload={() => {}} />);
    await click(ui.button('Load models from the server'));
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].url, `${GATEWAY}/models`);
    assert.equal(env.calls[0].init.method, 'GET');
    await ui.unmount();
  } finally {
    env.restore();
  }
});
