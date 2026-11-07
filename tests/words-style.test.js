import test from 'node:test';
import assert from 'node:assert/strict';
import { statusError, AiError } from '../src/providers/http.js';
import { sendOpenAI } from '../src/providers/openai.js';
import { sendAnthropic } from '../src/providers/anthropic.js';
import { providerName } from '../src/providers/config.js';
import { checkProviderAllowed } from '../src/policy/policy.js';
import { checkCaps } from '../src/lib/aiUsage.js';
import { collect, loadCatalogueFiles } from '../scripts/lib/i18nCheck.js';
import { AR_WORDS, AR_WORDS_RETIRED } from '../src/i18n/ar/words.js';
import { walkSource, isOwned, inScan } from './words-list.js';

// docs/plain-words.md in practice: what an error says (one plain clause, then one next step, never a code), what the limits say, and the
// Arabic words for site and AI service.

const NEXT_STEP = /\b(Try again|Check|Add|ask your administrator|Change|Wait|try with less)\b/i;

test('an AI service error never says a code; the code is on the error for the logic and the log', () => {
  const who = 'DeepSeek';
  const cases = [400, 401, 402, 403, 404, 408, 413, 429, 500, 502, 503, 529, 418];
  for (const status of cases) {
    for (const deploymentWord of ['model', 'deployment']) {
      const err = statusError(status, who, { reason: 'Some reason', deploymentWord, headers: new Headers({ 'retry-after': '30' }) });
      assert.ok(err instanceof AiError);
      assert.equal(err.status, status, 'the status stays on the error');
      assert.ok(err.code, 'and so does the machine code');
      assert.ok(!/\b[1-5]\d\d\b/.test(err.message.replace(/\d+ (?:second|minute)s?/g, '')), `${status}: ${err.message}`);
      assert.ok(!/\banswer\b|\(\d{3}\)|HTTP|API key|endpoint|provider|filter blocks/i.test(err.message), `${status}: ${err.message}`);
      assert.ok(err.message.length < 220, `${status}: short enough to read`);
    }
  }
  // the ones a person causes or can fix say what to do next
  for (const status of [400, 401, 403, 404, 408, 429, 500, 503]) assert.match(statusError(status, who).message, NEXT_STEP, String(status));
});

test('the 403 of the audit: a plain clause and one next step, not "answer 403 ... a network filter blocks the address"', () => {
  const err = statusError(403, 'DeepSeek', { reason: 'Forbidden' });
  assert.equal(err.message, 'DeepSeek refused this request (Forbidden). Check the AI key and the model in Settings, or ask your administrator.');
  assert.equal(err.code, 'NO_ACCESS');
  assert.equal(statusError(408, 'DeepSeek').message, 'DeepSeek gave up waiting for the request. Try again in a minute.');
  assert.equal(statusError(404, 'DeepSeek').message, 'DeepSeek could not find this model. Check the AI address and the model name in Settings.');
});

test('a missing AI key says one thing, with one next step, whichever service it is', async () => {
  const same = 'Add your AI key in Settings to use AI.';
  await assert.rejects(() => sendOpenAI({ apiKey: '', messages: [] }), (e) => e.code === 'NO_KEY' && e.message === same);
  await assert.rejects(() => sendOpenAI({ apiKey: '', messages: [], baseUrl: 'https://gw.example/v1', name: 'Example' }), (e) => e.code === 'NO_KEY' && e.message === same);
  await assert.rejects(() => sendAnthropic({ apiKey: '', model: 'm', messages: [] }), (e) => e.code === 'NO_KEY' && e.message === same);
});

test('a gateway is "the AI service at <host>", never "the endpoint"', () => {
  assert.equal(providerName({ provider: 'openai', baseUrl: 'https://ai.corp.example/v1' }), 'The AI service at ai.corp.example');
  assert.equal(providerName({ provider: 'openai', baseUrl: 'not a url' }), 'The AI service');
});

test('the organisation rules about the AI service speak of an AI service and an administrator, not a provider or an endpoint', () => {
  const reasons = [
    checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, { aiProvider: 'anthropic' }).reason,
    checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, { allowedProviders: ['anthropic', 'azure'] }).reason,
    checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, { allowedProviders: [] }).reason,
    checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: 'https://other.example/v1' }, { aiBaseUrl: 'https://gw.corp.example/v1' }).reason,
  ];
  for (const reason of reasons) {
    assert.ok(reason, 'a reason is given');
    assert.ok(!/provider|endpoint/i.test(reason), reason);
    assert.match(reason, /AI service/);
  }
  assert.match(reasons[2], /Ask your administrator/);
});

test('the daily limit says "AI limit", not "tokens" or "cap", and gives a next step', () => {
  const now = new Date('2026-11-07T10:00:00');
  const log = [{ time: '2026-11-07T09:00:00', inputTokens: 700, outputTokens: 400 }];
  const tokens = checkCaps(log, { dailyTokens: 1000 }, now);
  assert.equal(tokens.status, 'blocked');
  assert.equal(tokens.message, 'Your daily AI limit is reached. It resets tomorrow, or raise it in Settings > Usage and limits.');
  const warn = checkCaps(log, { dailyTokens: 1300 }, now);
  assert.equal(warn.status, 'warn');
  assert.equal(warn.message, '85% of your daily AI limit is used.');
  const calls = checkCaps([...Array(5)].map(() => ({ time: '2026-11-07T09:00:00' })), { dailyCalls: 5 }, now);
  assert.equal(calls.status, 'blocked');
  assert.match(calls.message, /^Your daily limit of AI calls is reached \(5 of 5\)\. It resets tomorrow, or raise it in Settings > Usage and limits\.$/);
  for (const r of [tokens, warn, calls]) assert.ok(!/token|cap/i.test(r.message), r.message);
});

test('the Arabic uses one word for a ServiceNow site and one for the AI service', () => {
  const retired = new Set(AR_WORDS_RETIRED);
  const { keys } = collect(walkSource().filter((f) => !/src[\\/](i18n|pii)[\\/]/.test(f)));
  const bad = [];
  for (const { file, table } of loadCatalogueFiles('ar')) {
    for (const [key, value] of Object.entries(table)) {
      if (retired.has(key) || !keys.has(key)) continue;
      const text = typeof value === 'string' ? value : Object.values(value).join(' ');
      if (/المثيل|مثيل|المثيلات|نقطة النهاية|نقطة نهاية|نقطة ذكاء/.test(text)) bad.push(`${file}: ${key.slice(0, 80)} -> ${text.slice(0, 80)}`);
      if (/ServiceNow site/.test(key) && !/موقع|مواقع/.test(text)) bad.push(`${file}: "site" without موقع: ${key.slice(0, 80)}`);
      if (/AI service/.test(key) && !/(?:خدمة|خدمات)[^.]*ذكاء/.test(text)) bad.push(`${file}: "AI service" without خدمة الذكاء الاصطناعي: ${key.slice(0, 80)}`);
    }
  }
  assert.equal(bad.length, 0, bad.join('\n'));
});

test('words.js: no retired text is still written in a file of the words workstream, and nothing is both new and retired', () => {
  const { keys } = collect(walkSource().filter((f) => inScan(f)));
  // (the other files wait for the lead's patch; the i18n test fails until every retired text is gone from the code)
  const stillMine = AR_WORDS_RETIRED.filter((key) => keys.has(key) && keys.get(key).some((w) => isOwned(w.file)));
  assert.deepEqual(stillMine, []);
  for (const [key, value] of Object.entries(AR_WORDS)) {
    assert.ok(typeof value === 'string' ? value : value.other, key);
    assert.ok(!AR_WORDS_RETIRED.includes(key), `${key} is both new and retired`);
  }
});
