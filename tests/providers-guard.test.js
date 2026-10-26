const test = require('node:test');
const assert = require('node:assert/strict');
import { sendChat } from '../src/providers/index.js';
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
