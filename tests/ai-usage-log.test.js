import test from 'node:test';
import assert from 'node:assert/strict';
import { sendChat } from '../src/providers/index.js';
import { readBudgetState, assertWithinCaps } from '../src/providers/budget.js';
import { fromOpenAIResponse, fromAnthropicResponse } from '../src/providers/messages.js';
import { createFirewall } from '../src/pii/index.js';
import { LOG_LIMIT, USAGE_KEY, appendEntry, checkCaps, makeEntry, summarize, tokensUsedToday } from '../src/lib/aiUsage.js';

// The usage log is what the person's caps and the organisation's daily token budget are counted from. It must count every call that
// was billed, also past 500 calls a day, and hold nothing but numbers and names of providers and models.

function installChrome() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, JSON.parse(JSON.stringify(data[k]))]));
        },
        async set(obj) {
          Object.assign(data, JSON.parse(JSON.stringify(obj)));
        },
      },
    },
  };
  return data;
}

const answer = (body) => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const sealed = () => createFirewall({ mode: 'standard' }).buildRequest({ feature: 'x', table: 'incident', system: 'S', parts: [{ field: 'description', text: 'Printer on floor 3 is jammed' }], userInstruction: 'Go' });
const OPENAI = { provider: 'openai', model: 'gpt-5-mini', apiKey: 'sk-test-0123456789', baseUrl: '', keyOptional: false, local: false };
const CLAUDE = { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0123456789', baseUrl: '', keyOptional: false, local: false };

// ---- P1.11: an answer that was billed but could not be used is still counted --------------------------------------------------

test('an answer billed but refused, cut short before any text, empty or filtered carries its usage on the error', () => {
  const usage = { prompt_tokens: 120, completion_tokens: 16000 };
  const cases = [
    [{ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage }, 'CUT_SHORT'],
    [{ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }], usage }, 'CONTENT_FILTER'],
    [{ choices: [{ message: { content: null, refusal: 'No.' }, finish_reason: 'stop' }], usage }, 'REFUSED'],
    [{ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage }, 'EMPTY_ANSWER'],
  ];
  for (const [body, code] of cases) {
    assert.throws(() => fromOpenAIResponse(body), (err) => err.code === code && err.usage.input === 120 && err.usage.output === 16000, code);
  }
  const claude = { usage: { input_tokens: 90, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 } };
  assert.throws(() => fromAnthropicResponse({ ...claude, content: [], stop_reason: 'refusal' }), (err) => err.code === 'REFUSED' && err.usage.input === 90 && err.usage.cacheRead === 3);
  assert.throws(() => fromAnthropicResponse({ ...claude, content: [], stop_reason: 'max_tokens' }), (err) => err.code === 'CUT_SHORT' && err.usage.output === 7);
  assert.throws(() => fromAnthropicResponse({ ...claude, content: [], stop_reason: 'end_turn' }), (err) => err.code === 'EMPTY_ANSWER' && err.usage.input === 90);
  // A whole answer reports the same numbers as before.
  assert.deepEqual(fromAnthropicResponse({ ...claude, content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' }).usage, { input: 90, output: 7, cacheRead: 3, cacheWrite: 0 });
});

test('sendChat records a billed answer it rejects before passing the error on, so the caps and the daily budget count it', async () => {
  const data = installChrome();
  try {
    await sendChat(OPENAI, sealed(), { fetchFn: answer({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } }) });
    // A reasoning model spends the whole output limit thinking and returns nothing: billed, and refused here.
    await assert.rejects(
      () => sendChat(OPENAI, sealed(), { fetchFn: answer({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 16000 } }) }),
      (err) => err.code === 'CUT_SHORT'
    );
    await assert.rejects(() => sendChat(CLAUDE, sealed(), { fetchFn: answer({ content: [], stop_reason: 'refusal', usage: { input_tokens: 50, output_tokens: 5 } }) }), (err) => err.code === 'REFUSED');
    const { log } = await readBudgetState();
    assert.equal(log.length, 3, 'all three calls are in the log');
    assert.equal(tokensUsedToday(log), 110 + 16100 + 55);
    assert.deepEqual(log.map((e) => e.provider), ['openai', 'openai', 'anthropic']);
    // Nothing from the ticket or the answer is kept: only numbers, and the names of the provider, model and kind.
    assert.ok(!/Printer|jammed/.test(JSON.stringify(data[USAGE_KEY])));
    const words = data[USAGE_KEY].flatMap((e) => Object.entries(e).filter(([, v]) => typeof v === 'string').map(([k]) => k));
    assert.deepEqual([...new Set(words)].sort(), ['host', 'kind', 'model', 'provider', 'time']);
    // A request that never got an answer (a refused key) is not a billed call.
    const before = (await readBudgetState()).log.length;
    await assert.rejects(() => sendChat(OPENAI, sealed(), { fetchFn: async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' }) }));
    assert.equal((await readBudgetState()).log.length, before);
  } finally {
    delete globalThis.chrome;
  }
});

// ---- P1.12: past 500 calls a day ---------------------------------------------------------------------------------------------

const NOW = new Date(2026, 10, 20, 15, 0, 0); // 20 November, in the time zone the tests run in
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);
const call = (when, over = {}) => makeEntry({ now: when, provider: 'openai', model: 'gpt-5-mini', ms: 10, usage: { input: 100, output: 20 }, host: 'acme.service-now.com', ...over });

function busyLog() {
  let log = [];
  // Last month (does not count anywhere), 300 calls earlier this month, then 600 calls today.
  for (let i = 0; i < 50; i += 1) log = appendEntry(log, call(new Date(2026, 9, 30, 10, i % 60)));
  for (let i = 0; i < 300; i += 1) log = appendEntry(log, call(at(10 + (i % 5), 9, i % 60)));
  for (let i = 0; i < 600; i += 1) log = appendEntry(log, call(at(20, 8 + Math.floor(i / 60), i % 60)));
  return log;
}

test('a daily call limit above 500 can be reached, and the day\'s tokens are all counted', () => {
  const log = busyLog();
  assert.equal(tokensUsedToday(log, NOW), 600 * 120, 'every one of today\'s 600 calls');
  assert.equal(checkCaps(log, { dailyCalls: 550 }, NOW).status, 'blocked');
  assert.equal(checkCaps(log, { dailyCalls: 600 }, NOW).status, 'blocked');
  assert.equal(checkCaps(log, { dailyCalls: 700 }, NOW).status, 'warn');
  assert.equal(checkCaps(log, { dailyTokens: 600 * 120 }, NOW).status, 'blocked');
  const { today, month } = summarize(log, NOW);
  assert.equal(today.calls, 600);
  assert.equal(month.calls, 900, 'the month too: 300 earlier calls and today\'s 600');
  assert.equal(month.tokens, 900 * 120);
});

test('the log stays small and holds no more than before: the newest calls one by one, older ones as totals per day, no instance', () => {
  const log = busyLog();
  const single = log.filter((e) => e.calls === undefined);
  const totals = log.filter((e) => e.calls !== undefined);
  assert.equal(single.length, LOG_LIMIT);
  assert.ok(totals.length <= 6, `${totals.length} totals: one per day of this month, none for last month`);
  assert.ok(totals.every((e) => e.host === '' && e.time.startsWith('2026-11')), 'a total names no instance');
  const allowed = new Set(['time', 'provider', 'model', 'ms', 'inputTokens', 'outputTokens', 'cacheRead', 'cacheWrite', 'host', 'kind', 'calls']);
  assert.deepEqual(totals.flatMap((e) => Object.keys(e)).filter((k) => !allowed.has(k)), []);
  // The newest call is last.
  assert.equal(log[log.length - 1].time, call(at(20, 17, 59)).time);
  // Appending more keeps it the same size.
  assert.equal(appendEntry(log, call(at(20, 18))).length, log.length);
  // Under the limit nothing changes.
  const few = appendEntry([call(at(20, 9))], call(at(20, 10)));
  assert.equal(few.length, 2);
  assert.ok(few.every((e) => e.calls === undefined));
});

test('key checks are folded on their own and still never count against a cap', async () => {
  let log = [];
  for (let i = 0; i < LOG_LIMIT + 40; i += 1) log = appendEntry(log, call(at(20, 9, i % 60), { kind: i < 40 ? 'validate' : 'chat' }));
  assert.equal(checkCaps(log, { dailyCalls: LOG_LIMIT }, NOW).status, 'blocked', 'the 500 real calls');
  assert.equal(checkCaps(log, { dailyCalls: LOG_LIMIT + 1 }, NOW).status, 'warn', 'not the 40 key checks');
  // And the stored budget check reads the totals as well.
  const data = installChrome();
  try {
    data[USAGE_KEY] = log;
    data.agentbuddy_ai_caps = { dailyCalls: LOG_LIMIT };
    await assert.rejects(() => assertWithinCaps(NOW), (err) => err.code === 'BUDGET');
  } finally {
    delete globalThis.chrome;
  }
});
