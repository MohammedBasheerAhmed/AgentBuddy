// READ-ONLY, same-origin calls to the current ServiceNow instance, made with the signed-in user's own session.
// ACLs therefore apply to everything returned here. Never try to escalate or bypass them.
//
// SECURITY: Agent Buddy never writes to the instance through the API. There is deliberately no create/update/delete here,
// and instanceFetch() refuses any method other than GET (tests/readonly.test.js also scans the source for write verbs).
// "Insert" in the UI only fills a field on the open form; the agent presses the form's own Save.

import { forgetSessionToken, sessionHeaders } from './sessionToken.js';

// Hard ceiling on rows per request. Guards against a mistyped query pulling tens of thousands of rows into memory.
const MAX_LIMIT = 1000;

// A table name is a plain identifier. Every caller validates it already; this is the last check before it becomes part of the
// address, because encodeURIComponent leaves "." alone and "/api/now/table/.." would be a request for another path.
const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,79}$/;
function checkTable(table) {
  if (typeof table !== 'string' || !TABLE_NAME_RE.test(table)) throw new Error('That is not a valid table name.');
}

// Rows per request: 1 to MAX_LIMIT. A negative, zero or non-numeric limit must never reach the instance as "no limit".
export function clampLimit(limit) {
  const n = Number(limit);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// ---- Session and error handling shared by every request ------------------------------------

export const SESSION_EXPIRED_MESSAGE = 'Your ServiceNow session has expired. Sign in to ServiceNow again (reload the page), then try again.';

// Every read has a time limit. An instance that is busy or a network that stalls must not leave the panel waiting for minutes with
// nothing to say: after READ_TIMEOUT_MS the read stops with a plain reason (code SN_TIMEOUT) and the panel offers "Try again". The
// time covers the whole read: the request, a retry on 429/503, and the answer's body.
export const READ_TIMEOUT_MS = 20000;
export const READ_TIMEOUT_CODE = 'SN_TIMEOUT';

export const READ_TIMEOUT_MESSAGE = `ServiceNow did not answer within ${Math.round(READ_TIMEOUT_MS / 1000)} seconds. It may be busy: try again in a moment.`;

/** The error for a read that ran out of time (the person's sentence names no table or API: it says what happened and what to do). */
export function readTimeoutError() {
  const err = new Error(READ_TIMEOUT_MESSAGE);
  err.code = READ_TIMEOUT_CODE;
  return err;
}

/**
 * Run one read under the time limit. `run(signal)` does the read with the signal it is given: the caller's own when it has one
 * (its cancel then works as before, and the caller's signal reaches the request unchanged), otherwise one this function aborts when
 * the time is up. Past `ms` the read stops waiting with readTimeoutError (code SN_TIMEOUT); a caller's own cancel stays its
 * AbortError. The timers are injected so a test can run the clock itself.
 */
export async function withReadLimit(run, { signal = null, ms = READ_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const own = signal ? null : new AbortController();
  let timer;
  let timedOut = false;
  const limit = new Promise((_, reject) => {
    timer = setTimer(() => {
      timedOut = true;
      own?.abort(); // a request with no caller's signal is really stopped, not only no longer waited for
      reject(readTimeoutError());
    }, ms);
  });
  const work = Promise.resolve().then(() => run(signal || own.signal));
  work.catch(() => {}); // when the time ran out first, the read's own failure that follows is expected
  try {
    return await Promise.race([work, limit]);
  } catch (err) {
    throw timedOut ? readTimeoutError() : err;
  } finally {
    clearTimer(timer);
  }
}

/** One GET read of a JSON answer, start to finish (the request, retries, the body) under the time limit. */
function readWithLimit(path, init, what) {
  return withReadLimit(
    async (signal) => {
      const response = await instanceFetch(path, { ...init, signal });
      return readJson(response, what);
    },
    { signal: init.signal || null }
  );
}

// Busy instance (rate limit, node overloaded): GETs are retried after these delays.
const RETRY_STATUSES = new Set([429, 503]);
const RETRY_DELAYS_MS = [400, 1200];
const MAX_RETRY_AFTER_MS = 5000;

// A login form served with HTTP 200 instead of the JSON that was asked for.
const LOGIN_PAGE = /<form[^>]*login\.do|name=["']user_password["']|id=["']user_password["']|sysverb_login|<title>[^<]*log ?in\b/i;
const LOGIN_URL = /\/(?:login|logout|login_redirect|external_logout_complete)\.do\b|\/login\b|saml|\/sso\b/i;

function sessionExpiredError() {
  const err = new Error(SESSION_EXPIRED_MESSAGE);
  err.code = 'SESSION_EXPIRED';
  return err;
}

function isSessionExpired(response, text) {
  if (response.status === 401) return true;
  if (response.headers?.get?.('x-is-logged-in') === 'false') return true;
  if (response.redirected && LOGIN_URL.test(response.url || '')) return true;
  return /^\s*</.test(text || '') && LOGIN_PAGE.test(text);
}

/** ServiceNow's own explanation from a JSON error body: "message - detail", or ''. */
export function serviceNowErrorText(text) {
  try {
    const err = JSON.parse(text)?.error;
    if (!err) return '';
    if (typeof err === 'string') return err;
    const message = typeof err.message === 'string' ? err.message : '';
    const detail = typeof err.detail === 'string' && err.detail !== message ? err.detail : '';
    return [message, detail].filter(Boolean).join(' - ');
  } catch {
    return '';
  }
}

function retryDelay(response, attempt) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return RETRY_DELAYS_MS[attempt];
}

export class ReadOnlyViolation extends Error {
  constructor(method) {
    super(`Agent Buddy only reads from ServiceNow. ${method} requests are not allowed.`);
    this.name = 'ReadOnlyViolation';
  }
}

/** fetch() on the instance; a GET answered 429/503 is retried briefly with backoff. Anything but GET is refused. */
export async function instanceFetch(path, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  if (method !== 'GET') throw new ReadOnlyViolation(method);
  for (let attempt = 0; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- retries are sequential by design.
    const response = await fetch(path, { credentials: 'same-origin', ...init, method: 'GET' });
    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_DELAYS_MS.length) return response;
    // eslint-disable-next-line no-await-in-loop
    await waitUnlessAborted(retryDelay(response, attempt), init.signal);
  }
}

// The wait before a retry ends early when the caller aborts, so a cancelled request does not sit out a Retry-After.
function waitUnlessAborted(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', done);
      resolve();
    }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

/**
 * Read a JSON answer. Throws one clear error for an expired session (401, a login redirect or a login page served as
 * 200). A 403 becomes an error with code ACCESS_DENIED so callers can say "you don't have access" instead of failing
 * generically. Returns null for an empty body.
 */
export async function readJson(response, what) {
  // An abort while the body is read is the caller's own cancel: it must not turn into an empty (and cacheable) answer.
  const text = await response.text().catch((err) => {
    if (err?.name === 'AbortError') throw err;
    return '';
  });
  if (isSessionExpired(response, text)) {
    // The token belongs to the session that ended: a new sign-in gets a new one, so it is read again from the page next time
    // instead of being sent (and refused) for the rest of the five minutes it would otherwise be kept.
    forgetSessionToken();
    throw sessionExpiredError();
  }
  if (!response.ok) {
    const detail = serviceNowErrorText(text);
    if (response.status === 403) {
      const err = new Error(`Your user is not allowed to read this (403)${detail ? `: ${detail}` : ''}.`);
      err.code = 'ACCESS_DENIED';
      throw err;
    }
    if (RETRY_STATUSES.has(response.status)) {
      throw new Error(`${what} failed (${response.status}): the instance is busy${detail ? ` (${detail})` : ''}. Wait a moment and retry.`);
    }
    throw new Error(`${what} failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const kind = /^\s*</.test(text) ? 'an HTML page' : 'something else';
    throw new Error(`${what} returned ${kind} instead of JSON (${response.status}). Reload the page and try again.`);
  }
}

export async function queryTable(table, query, fields = [], options = {}) {
  const { limit = 50, displayValue = false, offset = 0, signal } = options;
  checkTable(table);
  const start = Math.max(0, Math.floor(Number(offset) || 0));

  const params = new URLSearchParams();
  if (query) params.set('sysparm_query', query);
  if (fields.length) params.set('sysparm_fields', fields.join(','));
  params.set('sysparm_limit', String(clampLimit(limit)));
  if (start) params.set('sysparm_offset', String(start));
  params.set('sysparm_display_value', displayValue ? 'all' : 'false');
  params.set('sysparm_exclude_reference_link', 'true');

  const data = await readWithLimit(
    `/api/now/table/${encodeURIComponent(table)}?${params.toString()}`,
    { method: 'GET', credentials: 'same-origin', headers: await sessionHeaders(), ...(signal ? { signal } : {}) },
    `Table API query on "${table}"`
  );
  return data?.result || [];
}

/** Fetch a single record by sys_id. Returns null when it does not exist (or is not visible to this user). */
export async function fetchRecord(table, sysId, fields = [], options = {}) {
  if (!sysId) return null;
  const rows = await queryTable(table, `sys_id=${sysId}`, fields, { ...options, limit: 1 });
  return rows[0] || null;
}

/** Number of rows matching `query`, via the Aggregate API (no rows transferred). */
export async function countRecords(table, query = '', { signal } = {}) {
  checkTable(table);
  const params = new URLSearchParams({ sysparm_count: 'true' });
  if (query) params.set('sysparm_query', query);
  const data = await readWithLimit(
    `/api/now/stats/${encodeURIComponent(table)}?${params.toString()}`,
    { credentials: 'same-origin', headers: await sessionHeaders(), ...(signal ? { signal } : {}) },
    `Count on "${table}"`
  );
  const count = Number(data?.result?.stats?.count);
  if (!Number.isFinite(count)) throw new Error('The instance returned no count.');
  return count;
}

/**
 * Counts per value of one column over `query`, via the Aggregate API (nothing but the counts is transferred).
 * Returns the raw `result` array: [{ stats: { count }, groupby_fields: [{ field, value, display_value }] }].
 */
export async function countByColumn(table, query, column, { signal } = {}) {
  checkTable(table);
  if (!AGGREGATE_COLUMN_RE.test(String(column))) throw new Error('That is not a valid column name.');
  const params = new URLSearchParams({ sysparm_count: 'true', sysparm_group_by: column, sysparm_display_value: 'all' });
  if (query) params.set('sysparm_query', query);
  const data = await readWithLimit(
    `/api/now/stats/${encodeURIComponent(table)}?${params.toString()}`,
    { credentials: 'same-origin', headers: await sessionHeaders(), ...(signal ? { signal } : {}) },
    `Breakdown of "${table}" by ${column}`
  );
  return data?.result || [];
}

const AGGREGATE_COLUMN_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,2}$/;
// A group filter on the count only ("count^assigned_to^>^2"): enough to drop small groups, nothing that could carry other query text.
const AGGREGATE_HAVING_RE = /^count\^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,2}\^(>|<|=|>=|<=)\^\d{1,6}$/;

/**
 * One Aggregate API read, GET only: counts (always), optionally per value of up to two columns and with the average of
 * numeric columns. `having` keeps only the groups whose count passes a comparison. Returns the raw `result`: an object
 * `{ stats: { count, avg? } }` without a grouping, an array `[{ stats, groupby_fields: [{ field, value, display_value }] }]` with
 * one. Used by the reports engine (src/reports/engine).
 */
export async function aggregate(table, { query = '', groupBy = [], avgFields = [], having = '', signal } = {}) {
  checkTable(table);
  [...groupBy, ...avgFields].forEach((name) => {
    if (!AGGREGATE_COLUMN_RE.test(String(name))) throw new Error('That is not a valid column name.');
  });
  if (having && !AGGREGATE_HAVING_RE.test(String(having))) throw new Error('That is not a valid group filter.');
  const params = new URLSearchParams({ sysparm_count: 'true' });
  if (query) params.set('sysparm_query', query);
  if (groupBy.length) {
    params.set('sysparm_group_by', groupBy.join(','));
    params.set('sysparm_display_value', 'all');
  }
  if (avgFields.length) params.set('sysparm_avg_fields', avgFields.join(','));
  if (having) params.set('sysparm_having', having);
  const data = await readWithLimit(
    `/api/now/stats/${encodeURIComponent(table)}?${params.toString()}`,
    { credentials: 'same-origin', headers: await sessionHeaders(), ...(signal ? { signal } : {}) },
    `Report on "${table}"`
  );
  return data?.result ?? null;
}
