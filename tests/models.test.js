import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelIds, listModels, MAX_MODELS } from '../src/providers/models.js';
import { modelChoices } from '../src/lib/modelChoices.js';
import { resolveProviderConfig, PROVIDERS } from '../src/providers/config.js';

const answer = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('parseModelIds: OpenAI, "models" and bare lists; names cleaned, sorted, once each; odd ids dropped', () => {
  assert.deepEqual(parseModelIds({ object: 'list', data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }, { id: 'gpt-5' }] }), ['gpt-5', 'gpt-5-mini']);
  assert.deepEqual(parseModelIds({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }] }), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.deepEqual(parseModelIds(['b-model', 'a-model']), ['a-model', 'b-model']);
  assert.deepEqual(parseModelIds({ data: [{ id: 'anthropic/claude-x' }, { id: 'llama3.1:8b' }, { id: 'has space' }, { id: '<script>' }, { id: 42 }, null, {}] }), ['anthropic/claude-x', 'llama3.1:8b']);
  assert.deepEqual(parseModelIds(null), []);
  assert.deepEqual(parseModelIds('nope'), []);
  assert.ok(parseModelIds({ data: Array.from({ length: 900 }, (_, i) => ({ id: `m-${i}` })) }).length <= MAX_MODELS);
});

test('listModels: GET <address>/models with only the key; the gateway address is used, OpenAI\'s own when there is none', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ data: [{ id: 'gpt-5-mini-preprod' }, { id: 'gpt-5-mini' }] }), { status: 200 });
  };
  const gateway = resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://ai.corp.example/v1/' } }, 'sk-gw');
  assert.deepEqual(await listModels(gateway, fetchFn), ['gpt-5-mini', 'gpt-5-mini-preprod']);
  assert.equal(seen[0].url, 'https://ai.corp.example/v1/models');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-gw');
  assert.equal(seen[0].init.body, undefined, 'no body: nothing from a ticket');

  const own = resolveProviderConfig({ provider: 'openai' }, 'sk-own');
  await listModels(own, fetchFn);
  assert.equal(seen[1].url, 'https://api.openai.com/v1/models');

  const deepseek = resolveProviderConfig({ provider: 'deepseek' }, 'sk-ds');
  await listModels(deepseek, fetchFn);
  assert.equal(seen[2].url, 'https://api.deepseek.com/v1/models', 'a preset lists from its own fixed address');
});

test('listModels: plain sentences for a missing key, a bad key, no list, no models, no network, and Anthropic', async () => {
  const gateway = resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://ai.corp.example/v1' } }, 'sk-gw');
  await assert.rejects(() => listModels(resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://ai.corp.example/v1' } }, ''), answer(200, {})), /Enter your key first/);
  await assert.rejects(() => listModels(gateway, answer(401, '{}')), /ai\.corp\.example rejected the API key/);
  await assert.rejects(() => listModels(gateway, answer(403, '{}')), /rejected the API key/);
  await assert.rejects(() => listModels(gateway, answer(404, 'not found')), /does not give a list of its models \(answer 404\)\. Type the model name instead\./);
  await assert.rejects(() => listModels(gateway, answer(200, { data: [] })), /answered, but with no models/);
  await assert.rejects(() => listModels(gateway, answer(200, '<html>login</html>')), /answered, but with no models/);
  await assert.rejects(() => listModels(gateway, async () => { throw new TypeError('Failed to fetch'); }), /Could not reach ai\.corp\.example/);
  await assert.rejects(() => listModels(resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant'), answer(200, {})), /no list to load here/);
  // A server on this computer needs no key.
  const local = resolveProviderConfig({ provider: 'custom', baseUrls: { custom: 'http://localhost:11434/v1' } }, '');
  assert.deepEqual(await listModels(local, answer(200, { data: [{ id: 'llama3.1' }] })), ['llama3.1']);
});

test('modelChoices: the one in use first, then the loaded ones, then the provider\'s own; once each; policy limits the list', () => {
  const def = PROVIDERS.openai;
  const choices = modelChoices({ def, current: 'gpt-5-mini-preprod', loaded: ['gpt-5', 'gpt-5-mini-preprod', 'o4'] });
  assert.deepEqual(choices.map((c) => c.id), ['gpt-5-mini-preprod', 'gpt-5', 'o4', 'gpt-5-mini']);
  assert.equal(choices.find((c) => c.id === 'gpt-5-mini').label, 'GPT-5 mini', 'a known model keeps its label');
  assert.equal(choices[0].label, 'gpt-5-mini-preprod', 'an unknown one is shown by its name');

  const limited = modelChoices({ def, current: 'gpt-5', loaded: ['gpt-5', 'o4', 'gpt-5-mini'], allowed: ['gpt-5-mini', 'gpt-5'] });
  assert.deepEqual(limited.map((c) => c.id), ['gpt-5', 'gpt-5-mini'], 'only what the organisation allows');
  assert.deepEqual(modelChoices({ def: PROVIDERS.custom, current: '', loaded: undefined }), []);
  assert.deepEqual(modelChoices({ def, current: 'x', loaded: 'not a list', allowed: [] }).map((c) => c.id), ['x', 'gpt-5-mini', 'gpt-5']);
});
