const test = require('node:test');
const assert = require('node:assert/strict');
import { sendChat } from '../src/providers/index.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { createFirewall } from '../src/pii/index.js';

const sealedRequest = () =>
  createFirewall({ mode: 'standard', people: [] }).buildRequest({
    feature: 'record-summary',
    table: 'incident',
    system: 'Summarise.',
    parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }],
  });

test("a 'custom' provider with no address is refused before any request, never sent to api.openai.com", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('no network in unit tests');
  };
  try {
    await assert.rejects(
      () => sendChat({ provider: 'custom', model: 'm', apiKey: 'sk-test', baseUrl: '' }, sealedRequest(), { skipBudget: true }),
      /address of your AI server/
    );
    assert.deepEqual(calls, [], 'nothing was fetched');
  } finally {
    globalThis.fetch = real;
  }
});

test('a request that did not come from the firewall is still refused first', async () => {
  await assert.rejects(() => sendChat({ provider: 'custom', model: 'm', apiKey: 'k', baseUrl: 'https://x.example/v1' }, { messages: [{ role: 'user', content: 'hi' }] }, { skipBudget: true }));
});

test('DeepSeek is a preset: its own address, a default model, any model id, the key only in the Authorization header', async () => {
  const config = resolveProviderConfig({ provider: 'deepseek' }, 'sk-deepseek-test');
  assert.equal(config.provider, 'deepseek');
  assert.equal(config.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(config.model, 'deepseek-chat');
  assert.equal(config.local, false);
  assert.equal(resolveProviderConfig({ provider: 'deepseek', models: { deepseek: 'deepseek-reasoner' } }, 'k').model, 'deepseek-reasoner');
  assert.equal(resolveProviderConfig({ provider: 'deepseek', models: { deepseek: 'a-newer-model' } }, 'k').model, 'a-newer-model', 'a model id that is not in the list is accepted');
  // A typed address is ignored: the preset's own address is fixed (a key must only go to the host it belongs to).
  assert.equal(resolveProviderConfig({ provider: 'deepseek', baseUrls: { deepseek: 'https://evil.example/v1' } }, 'k').baseUrl, 'https://api.deepseek.com/v1');

  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'All good.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const out = await sendChat(config, sealedRequest(), { skipBudget: true });
    assert.equal(out.content, 'All good.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-deepseek-test');
    assert.equal(calls[0].body.model, 'deepseek-chat');
    assert.ok(!JSON.stringify(calls[0].body).includes('sk-deepseek-test'), 'the key is not in the body');
    assert.ok(!calls[0].body.tools, 'no tools');
  } finally {
    globalThis.fetch = real;
  }
});
