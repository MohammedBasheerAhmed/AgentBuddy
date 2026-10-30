import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, retryDelay, safeReason, readErrorBody, AiError, MAX_ATTEMPTS, MAX_WAIT_MS } from '../src/providers/http.js';
import { sendChat } from '../src/providers/index.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { createFirewall } from '../src/pii/index.js';
import { errorReason } from '../src/lib/pipeline.js';

// Every provider call goes through http.js: a time limit, a cancel, a bounded retry on "busy" only, and short plain errors that
// never carry the key or the text that was sent.

const json = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const OK = { choices: [{ message: { role: 'assistant', content: 'Fine.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } };
const base = { url: 'https://ai.example/v1/chat/completions', init: { method: 'POST', body: '{}' }, who: 'Example AI', host: 'ai.example' };

/** A fetch that answers from a list, one per call, and remembers what it was asked. */
function scripted(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    return typeof next === 'function' ? next(url, init) : next.clone();
  };
  fn.calls = calls;
  return fn;
}
const sleeps = () => {
  const waits = [];
  const fn = async (ms) => {
    waits.push(ms);
  };
  fn.waits = waits;
  return fn;
};

test('retryDelay: Retry-After in seconds or as a date, retry-after-ms, x-should-retry: false, and a backoff without a hint', () => {
  const h = (o) => new Headers(o);
  assert.equal(retryDelay(h({ 'retry-after': '3' }), 0), 3000);
  assert.equal(retryDelay(h({ 'retry-after-ms': '250' }), 0), 250);
  const inTwo = new Date(Date.now() + 2000).toUTCString();
  const fromDate = retryDelay(h({ 'retry-after': inTwo }), 0);
  assert.ok(fromDate >= 0 && fromDate <= 2000, String(fromDate));
  assert.equal(retryDelay(h({ 'x-should-retry': 'false', 'retry-after': '1' }), 0), -1, 'the provider said not to');
  assert.equal(retryDelay(h({ 'retry-after': String(MAX_WAIT_MS / 1000 + 60) }), 0), -1, 'a long wait is reported, not waited for');
  assert.equal(retryDelay(h({}), 0, () => 0), 1000);
  assert.equal(retryDelay(h({}), 1, () => 0), 2000);
  assert.ok(retryDelay(h({}), 1, () => 1) <= 2500, 'jitter is bounded');
});

test('busy answers (503, 529, 429) are retried with a pause, at most MAX_ATTEMPTS times in all, then reported plainly', async () => {
  const sleep = sleeps();
  const fetchFn = scripted(json(503, { error: { message: 'overloaded' } }), json(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }), json(200, OK));
  const out = await requestJson({ ...base, fetchFn, sleep, random: () => 0 });
  assert.equal(out.choices[0].message.content, 'Fine.');
  assert.equal(fetchFn.calls.length, 3);
  assert.deepEqual(sleep.waits, [1000, 2000]);

  const always = scripted(json(529, { error: { message: 'Overloaded' } }));
  await assert.rejects(() => requestJson({ ...base, fetchFn: always, sleep: sleeps() }), (err) => err.code === 'BUSY' && err.message === 'Example AI is busy. Try again in a minute.');
  assert.equal(always.calls.length, MAX_ATTEMPTS);

  const limited = sleeps();
  const rate = scripted(json(429, { error: { message: 'slow down' } }, { 'retry-after': '2' }), json(200, OK));
  await requestJson({ ...base, fetchFn: rate, sleep: limited });
  assert.deepEqual(limited.waits, [2000], 'Retry-After is honoured');
});

test('a 4xx that would come back the same is never retried; a used-up quota (429 insufficient_quota) is not retried either', async () => {
  for (const status of [400, 401, 403, 404, 413]) {
    const fetchFn = scripted(json(status, { error: { message: 'no' } }));
    await assert.rejects(() => requestJson({ ...base, fetchFn, sleep: sleeps() }), AiError);
    assert.equal(fetchFn.calls.length, 1, `status ${status}`);
  }
  const quota = scripted(json(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }));
  await assert.rejects(() => requestJson({ ...base, fetchFn: quota, sleep: sleeps() }), (err) => err.code === 'NO_CREDIT' && /no balance left/.test(err.message));
  assert.equal(quota.calls.length, 1);
  // A 500 may have been half-done by the provider: not sent again.
  const broken = scripted(json(500, 'oops'));
  await assert.rejects(() => requestJson({ ...base, fetchFn: broken, sleep: sleeps() }), (err) => err.code === 'SERVER_ERROR');
  assert.equal(broken.calls.length, 1);
  // A Retry-After longer than we wait: one try, and the message says how long.
  const later = scripted(json(429, { error: { message: 'limit' } }, { 'retry-after': '600' }));
  await assert.rejects(() => requestJson({ ...base, fetchFn: later, sleep: sleeps() }), /Try again in about 10 minutes\./);
  assert.equal(later.calls.length, 1);
});

test('a request that does not answer in time is stopped and says so; it is not sent again', async () => {
  let calls = 0;
  const hang = (url, init) => {
    calls += 1;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  await assert.rejects(() => requestJson({ ...base, fetchFn: hang, timeoutMs: 30 }), (err) => err.code === 'TIMEOUT' && /did not answer within/.test(err.message));
  assert.equal(calls, 1);
});

test('cancel: an aborted signal stops the request at once, also while waiting to retry, and nothing more is sent', async () => {
  const controller = new AbortController();
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const pending = requestJson({ ...base, fetchFn: hang, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (err) => err.code === 'CANCELLED' && /Cancelled/.test(err.message));

  // Cancelled during the pause before a retry: the real (abortable) pause is cut short and no second request goes out.
  const later = new AbortController();
  const busy = scripted(json(503, {}, { 'retry-after': '5' }));
  const waiting = requestJson({ ...base, fetchFn: busy, signal: later.signal });
  setTimeout(() => later.abort(), 20);
  await assert.rejects(waiting, (err) => err.code === 'CANCELLED');
  assert.equal(busy.calls.length, 1);

  // Already cancelled: nothing is fetched.
  const none = scripted(json(200, OK));
  await assert.rejects(() => requestJson({ ...base, fetchFn: none, signal: AbortSignal.abort() }), (err) => err.code === 'CANCELLED');
  assert.equal(none.calls.length, 0);
});

test('safeReason: the key and anything shaped like a key are hidden; a reason that quotes the request is dropped; it stays short', () => {
  assert.equal(safeReason('Incorrect API key provided: sk-proj-abcdefgh1234', { secrets: ['sk-proj-abcdefgh1234'] }), 'Incorrect API key provided: [key hidden]');
  assert.equal(safeReason('bad token Bearer abc.def.ghi'), 'bad token [key hidden]');
  assert.equal(safeReason('key 0123456789abcdef0123456789abcdef is not valid'), 'key [key hidden] is not valid', 'an Azure-style 32-character key');
  assert.equal(safeReason('AIzaSyA1234567890abcdefghij rejected'), '[key hidden] rejected');
  const sent = 'Summarise this: the VPN client on the laptop keeps dropping after the update.';
  assert.equal(safeReason('Invalid content: "the VPN client on the laptop keeps dropping"', { sent }), '', 'an echo of the request is not shown');
  assert.equal(safeReason("The model 'gpt-x' does not exist", { sent }), "The model 'gpt-x' does not exist");
  assert.ok(safeReason('x '.repeat(400)).length <= 160);
  assert.equal(safeReason('  two\n lines  '), 'two lines');
  assert.deepEqual(readErrorBody('<html>'), { message: '', code: '', type: '', param: '' });
  assert.deepEqual(readErrorBody('{"error":{"message":"m","code":"c","type":"t","param":"temperature"}}'), { message: 'm', code: 'c', type: 't', param: 'temperature' });
});

test('through sendChat: whatever the provider answers, the error never holds the key or the text that was sent', async () => {
  const key = 'sk-test-SECRET-0123456789';
  const config = resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://gw.corp.example/v1' } }, key);
  const request = createFirewall({ mode: 'standard', people: [] }).buildRequest({
    feature: 'record-summary',
    table: 'incident',
    system: 'Summarise.',
    parts: [{ field: 'description', label: 'Description', text: 'The payroll export for the Northwind account fails every night at two.' }],
  });
  const echo = `Invalid request: Incorrect API key ${key}; your messages were: The payroll export for the Northwind account fails every night at two.`;
  for (const status of [400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529]) {
    const fetchFn = scripted(json(status, { error: { message: echo } }));
    await assert.rejects(
      () => sendChat(config, request, { skipBudget: true, fetchFn, sleep: async () => {} }),
      (err) => {
        assert.ok(!err.message.includes(key), `${status}: ${err.message}`);
        assert.ok(!/SECRET/.test(err.message), `${status}: ${err.message}`);
        assert.ok(!/payroll export|Northwind/.test(err.message), `${status}: ${err.message}`);
        assert.ok(err.message.length < 260, `${status}: short`);
        assert.match(err.code, /^[A-Z_]{2,30}$/, 'a code the audit log can record');
        return true;
      }
    );
  }
});

test('the audit log records the error code, never the message', async () => {
  const config = resolveProviderConfig({ provider: 'deepseek' }, 'sk-x');
  const request = createFirewall({ mode: 'standard', people: [] }).buildRequest({ feature: 'record-summary', table: 'incident', system: 'Summarise.', parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }] });
  const fetchFn = scripted(json(529, { error: { message: 'Overloaded' } }));
  const err = await sendChat(config, request, { skipBudget: true, fetchFn, sleep: async () => {} }).catch((e) => e);
  assert.equal(err.code, 'BUSY');
  assert.equal(errorReason(err), 'BUSY');
});

test('sendChat refuses an address that did not pass the check, instead of falling back to the public API with the key', async () => {
  const config = resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'http://gw.corp.example/v1' } }, 'sk-x');
  assert.equal(config.baseUrl, '');
  assert.ok(config.invalidBaseUrl);
  const request = createFirewall({ mode: 'standard', people: [] }).buildRequest({ feature: 'record-summary', table: 'incident', system: 'Summarise.', parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }] });
  const fetchFn = scripted(json(200, OK));
  await assert.rejects(() => sendChat(config, request, { skipBudget: true, fetchFn }), (err) => err.code === 'BAD_URL' && /not valid/.test(err.message));
  assert.equal(fetchFn.calls.length, 0);
});

test('every provider request is sent with redirect: error, no credentials, no referrer and no cache (chat, Azure, Anthropic, model list)', async () => {
  const SAFE = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url: String(url), init });
    if (/\/models$/.test(String(url))) return json(200, { data: [{ id: 'm-1' }] });
    if (/anthropic/.test(String(url))) return json(200, { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} });
    return json(200, OK);
  };
  const request = createFirewall({ mode: 'standard', people: [] }).buildRequest({ feature: 'record-summary', table: 'incident', system: 'Summarise.', parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }] });
  await sendChat(resolveProviderConfig({ provider: 'openai' }, 'sk-1234567'), request, { skipBudget: true, fetchFn });
  await sendChat(resolveProviderConfig({ provider: 'azure', baseUrls: { azure: 'https://contoso.openai.azure.com' }, models: { azure: 'dep-1' } }, 'az-1234567'), request, { skipBudget: true, fetchFn });
  await sendChat(resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-1234567'), request, { skipBudget: true, fetchFn });
  const { listModels } = await import('../src/providers/models.js');
  await listModels(resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://gw.corp.example/v1' } }, 'sk-1234567'), fetchFn);
  assert.deepEqual(seen.map((s) => s.url), [
    'https://api.openai.com/v1/chat/completions',
    'https://contoso.openai.azure.com/openai/v1/chat/completions',
    'https://api.anthropic.com/v1/messages',
    'https://gw.corp.example/v1/models',
  ]);
  for (const { url, init } of seen) {
    for (const [k, v] of Object.entries(SAFE)) assert.equal(init[k], v, `${url}: ${k}`);
    assert.ok(init.signal, `${url}: cancellable`);
  }
  // Nothing in the init a caller passes can loosen them.
  const loose = [];
  await requestJson({ ...base, init: { method: 'POST', body: '{}', redirect: 'follow', credentials: 'include', cache: 'default', referrerPolicy: 'unsafe-url' }, fetchFn: async (u, i) => (loose.push(i), json(200, OK)) });
  for (const [k, v] of Object.entries(SAFE)) assert.equal(loose[0][k], v, k);
});

test('a provider answer that redirects is never followed: the request fails as unreachable and the key goes nowhere else', async () => {
  // fetch with redirect: 'error' rejects on a 3xx; the stub does what the browser does.
  const fetchFn = async (url, init) => {
    if (init.redirect === 'error') throw new TypeError('Failed to fetch');
    return json(200, OK);
  };
  await assert.rejects(() => requestJson({ ...base, fetchFn }), (err) => err.code === 'UNREACHABLE' && /does not redirect elsewhere/.test(err.message));
});
