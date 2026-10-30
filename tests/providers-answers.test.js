import test from 'node:test';
import assert from 'node:assert/strict';
import { sendChat, truncationNote } from '../src/providers/index.js';
import { resolveProviderConfig, PROVIDERS, ANTHROPIC_VERSION } from '../src/providers/config.js';
import { fromOpenAIResponse, fromAnthropicResponse } from '../src/providers/messages.js';
import { createFirewall } from '../src/pii/index.js';

// The two wire formats against their current shape: what is sent (headers, limits, no sampling for Claude), and what a stop
// reason means (an answer cut short is said to be cut short; a refusal or a filter is a plain message).

const sealed = () =>
  createFirewall({ mode: 'standard', people: [] }).buildRequest({
    feature: 'record-summary',
    table: 'incident',
    system: 'Summarise.',
    parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }],
  });
function recorder(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: next.headers || {} });
  };
  fn.calls = calls;
  return fn;
}
const CLAUDE_OK = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Short summary.' }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 4 } };

test('the Claude presets are the current ids and the default is the fast tier', () => {
  assert.deepEqual(PROVIDERS.anthropic.models.map((m) => m.id).sort(), ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(PROVIDERS.anthropic.defaultModel, 'claude-sonnet-5-5');
  assert.equal(PROVIDERS.openrouter.defaultModel, 'anthropic/claude-sonnet-5.5', 'OpenRouter writes the minor version with a dot');
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (def.defaultModel) assert.ok(def.freeModel || def.models.some((m) => m.id === def.defaultModel), `${id}: the default is on its own list`);
  }
});

test('Anthropic: the Messages API request has the required headers, max_tokens, effort, and no sampling parameters', async () => {
  const fetchFn = recorder({ body: CLAUDE_OK });
  const out = await sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test-1234567890'), sealed(), { skipBudget: true, fetchFn });
  assert.equal(out.content, 'Short summary.', 'thinking blocks are not part of the answer');
  assert.equal(out.truncated, false);
  const [call] = fetchFn.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'sk-ant-test-1234567890');
  assert.equal(call.headers['anthropic-version'], ANTHROPIC_VERSION);
  assert.equal(call.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(!('Authorization' in call.headers));
  assert.equal(call.body.model, 'claude-sonnet-5-5');
  assert.equal(call.body.max_tokens, 16000);
  assert.deepEqual(call.body.output_config, { effort: 'low' });
  for (const field of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) assert.ok(!(field in call.body), field);
  assert.equal(typeof call.body.system, 'string');
});

test("Anthropic: stop_reason max_tokens (or a full context window) means the answer was cut short, and the reply says so", async () => {
  const cut = await sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'k-1234567'), sealed(), { skipBudget: true, fetchFn: recorder({ body: { ...CLAUDE_OK, stop_reason: 'max_tokens' } }) });
  assert.equal(cut.truncated, true);
  assert.equal(cut.stopReason, 'max_tokens');
  assert.match(truncationNote(cut), /cut short/);
  assert.equal(fromAnthropicResponse({ ...CLAUDE_OK, stop_reason: 'model_context_window_exceeded' }).truncated, true);
  assert.equal(truncationNote({ truncated: false }), '');
  assert.throws(() => fromAnthropicResponse({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }), (err) => err.code === 'CUT_SHORT');
});

test('Anthropic: a refusal is a plain message with its category, and an odd category is not repeated', () => {
  assert.throws(() => fromAnthropicResponse({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }), (err) => err.code === 'REFUSED' && /declined this request \(cyber\)/.test(err.message));
  assert.throws(() => fromAnthropicResponse({ content: [], stop_reason: 'refusal', stop_details: { category: '<b>ticket text</b>' } }), (err) => !/ticket text/.test(err.message));
});

test('Anthropic: overloaded (529) is retried, then "busy"; an older model behind a proxy that refuses effort gets one try without it', async () => {
  const busy = recorder({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, { body: CLAUDE_OK });
  const out = await sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'k-1234567'), sealed(), { skipBudget: true, fetchFn: busy, sleep: async () => {} });
  assert.equal(out.content, 'Short summary.');
  assert.equal(busy.calls.length, 2);

  const always = recorder({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } });
  await assert.rejects(() => sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'k-1234567'), sealed(), { skipBudget: true, fetchFn: always, sleep: async () => {} }), (err) => err.code === 'BUSY' && err.message === 'Anthropic is busy. Try again in a minute.');
  assert.equal(always.calls.length, 3, 'three tries in all');

  const proxy = resolveProviderConfig({ provider: 'anthropic', baseUrls: { anthropic: 'https://llm-proxy.corp.example/v1' }, models: { anthropic: 'claude-older' } }, 'k-1234567');
  const effort = recorder({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.effort: Extra inputs are not permitted' } } }, { body: CLAUDE_OK });
  await sendChat(proxy, sealed(), { skipBudget: true, fetchFn: effort });
  assert.equal(effort.calls[0].url, 'https://llm-proxy.corp.example/v1/messages');
  assert.ok('output_config' in effort.calls[0].body);
  assert.ok(!('output_config' in effort.calls[1].body));
  assert.equal(effort.calls[1].body.max_tokens, 16000, 'max_tokens is required and stays');
});

test('Anthropic: an account out of credit (400 "credit balance is too low") says so, instead of blaming the model name', async () => {
  const broke = recorder({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } });
  await assert.rejects(
    () => sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'k-1234567'), sealed(), { skipBudget: true, fetchFn: broke }),
    (err) => err.code === 'NO_CREDIT' && /^Anthropic says the account has no balance left/.test(err.message)
  );
  assert.equal(broke.calls.length, 1);
});

test('OpenAI: finish_reason length is a cut-short answer; with no text at all it is a plain error', () => {
  const cut = fromOpenAIResponse({ choices: [{ message: { content: 'Partial' }, finish_reason: 'length' }] });
  assert.equal(cut.truncated, true);
  assert.equal(cut.stopReason, 'max_tokens');
  assert.equal(fromOpenAIResponse({ choices: [{ message: { content: 'Whole' }, finish_reason: 'stop' }] }).truncated, false);
  assert.throws(() => fromOpenAIResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), (err) => err.code === 'CUT_SHORT' && /cut short before any text/.test(err.message));
  assert.throws(() => fromOpenAIResponse({ choices: [{ message: { content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] }), (err) => err.code === 'REFUSED');
  assert.throws(() => fromOpenAIResponse({}, 'DeepSeek'), (err) => err.code === 'BAD_ANSWER' && /^DeepSeek/.test(err.message));
});

test('OpenAI: its own API gets max_completion_tokens; other compatible servers keep their own limit; reasoning names get no temperature', async () => {
  const OK = { body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } };
  const own = recorder(OK);
  await sendChat(resolveProviderConfig({ provider: 'openai', models: { openai: 'gpt-5-mini' } }, 'sk-1234567'), sealed(), { skipBudget: true, fetchFn: own });
  assert.equal(own.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(own.calls[0].body.max_completion_tokens, 16000);
  assert.ok(!('temperature' in own.calls[0].body));
  assert.equal(own.calls[0].headers.Authorization, 'Bearer sk-1234567');

  const deepseek = recorder(OK);
  await sendChat(resolveProviderConfig({ provider: 'deepseek' }, 'sk-1234567'), sealed(), { skipBudget: true, fetchFn: deepseek });
  assert.ok(!('max_completion_tokens' in deepseek.calls[0].body) && !('max_tokens' in deepseek.calls[0].body), 'DeepSeek refuses a limit above 8192');
  assert.equal(deepseek.calls[0].body.temperature, 0.2);

  const router = recorder(OK);
  await sendChat(resolveProviderConfig({ provider: 'openrouter', models: { openrouter: 'openai/gpt-5' } }, 'sk-1234567'), sealed(), { skipBudget: true, fetchFn: router });
  assert.ok(!('temperature' in router.calls[0].body), 'a vendor prefix does not hide a reasoning model');
});

test('a cut-short answer comes back with its text and the flag, for the panel to say so', async () => {
  const fetchFn = recorder({ body: { choices: [{ message: { content: 'The first half' }, finish_reason: 'length' }] } });
  const out = await sendChat(resolveProviderConfig({ provider: 'deepseek' }, 'sk-1234567'), sealed(), { skipBudget: true, fetchFn });
  assert.equal(out.content, 'The first half');
  assert.equal(out.truncated, true);
  assert.match(truncationNote(out), /^The answer was cut short/);
});
