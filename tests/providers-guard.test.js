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

test('AI errors say what to do: no balance (402), rate limit (429), unreachable, bad key (401); other errors keep the status and a short body', async () => {
  const config = resolveProviderConfig({ provider: 'deepseek' }, 'sk-deepseek-test');
  const real = globalThis.fetch;
  const answer = (status, body) => async () => new Response(body, { status });
  try {
    globalThis.fetch = answer(402, JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error' } }));
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), /DeepSeek says the account has no balance left \(Insufficient Balance\)\. Add credit/);

    globalThis.fetch = answer(429, JSON.stringify({ error: { message: 'Rate limit reached' } }));
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), /DeepSeek is limiting requests \(Rate limit reached\)\. Wait a minute/);

    globalThis.fetch = answer(401, '{"error":{"message":"Authentication Fails"}}');
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), /DeepSeek rejected the API key\. Check it in Agent Buddy settings\./);

    globalThis.fetch = answer(500, 'x'.repeat(1000));
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), (err) => /DeepSeek request failed \(500\): x+/.test(err.message) && err.message.length < 400);

    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), /Could not reach api\.deepseek\.com\. Check your internet connection, VPN or proxy/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a request with no key says so by name, and never reaches the network', async () => {
  const config = resolveProviderConfig({ provider: 'deepseek' }, '');
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    return new Response('{}');
  };
  try {
    await assert.rejects(() => sendChat(config, sealedRequest(), { skipBudget: true }), /Missing API key for DeepSeek/);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = real;
  }
});
