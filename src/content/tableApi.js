// READ-ONLY, same-origin calls to the current ServiceNow instance, made with the signed-in user's own session.
// ACLs therefore apply to everything returned here. Never try to escalate or bypass them.
//
// SECURITY: Agent Buddy never writes to the instance through the API. There is deliberately no create/update/delete here,
// and instanceFetch() refuses any method other than GET (tests/readonly.test.js also scans the source for write verbs).
// "Insert" in the UI only fills a field on the open form; the agent presses the form's own Save.

import { forgetSessionToken, getSessionUser, sessionHeaders } from './sessionToken.js';
import { FIELD_RE, TABLE_RE, oneLine } from '../context/util.js';
import { NOTE_TEXT, READ_CODE, READ_REASON, READ_TEXT, deniedReason, isMissingColumn, isMissingTable } from '../context/access.js';

// Hard ceiling on rows per request. Guards against a mistyped query pulling tens of thousands of rows into memory.
const MAX_LIMIT = 1000;

// A table name is a plain identifier. Every caller validates it already; this is the last check before it becomes part of the
// address, because encodeURIComponent leaves "." alone and "/api/now/table/.." would be a request for another path.
function checkTable(table) {
  if (typeof table !== 'string' || !TABLE_RE.test(table)) throw invalidRead('That is not a valid table name.');
}

// An error whose `message` is what a person may read (a fixed plain sentence, src/context/access.js) and whose `detail` keeps the
// technical words for whoever debugs it (the panel never shows `detail`; the logic that tells a missing table from a refusal reads it).
function friendlyError(message, { detail = '', code = '', reason = READ_REASON.ERROR, status = 0 } = {}) {
  const err = new Error(message);
  if (detail) err.detail = detail;
  if (code) err.code = code;
  err.reason = reason;
  if (status) err.status = status;
  return err;
}

// A read that was asked for something Agent Buddy cannot read (a name that is not a table or a column). The mistake is the code's; the
// person is told to choose another option, never which name was wrong.
const invalidRead = (detail) => friendlyError(READ_TEXT.invalid, { detail, code: 'INVALID_READ' });

// Rows per request: 1 to MAX_LIMIT. A negative, zero or non-numeric limit must never reach the instance as "no limit".
export function clampLimit(limit) {
  const n = Number(limit);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// ---- Session and error handling shared by every request ------------------------------------

// (the text is kept with the other reasons in src/context/access.js, READ_TEXT, so the panel can show it in the person's language)
export const SESSION_EXPIRED_MESSAGE = READ_TEXT.session;

// Every read has a time limit. An instance that is busy or a network that stalls must not leave the panel waiting for minutes with
// nothing to say: after READ_TIMEOUT_MS the read stops with a plain reason (code SN_TIMEOUT) and the panel offers "Try again". The
// time covers the whole read: the request, a retry on 429/503, and the answer's body.
export const READ_TIMEOUT_MS = 20000;
export const READ_TIMEOUT_CODE = 'SN_TIMEOUT';

// (the person's sentence: no number of seconds, and the same words as every other timeout, so it has its Arabic)
export const READ_TIMEOUT_MESSAGE = READ_TEXT.timeout;

/** The error for a read that ran out of time (the person's sentence names no table or API: it says what happened and what to do). */
export function readTimeoutError() {
  const err = new Error(READ_TIMEOUT_MESSAGE);
  err.code = READ_TIMEOUT_CODE;
  err.reason = READ_REASON.TIMEOUT;
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
  err.reason = READ_REASON.SESSION;
  return err;
}

const looksLikeHtml = (text) => /^s*</.test(text || '');

// A REST API access policy can answer 401 "User Not Authenticated" to a person who is signed in (the same words as a lost sign-in).
// Only words that name a policy, or the header ServiceNow sets on every answer (X-Is-Logged-In: true), say that the sign-in is fine
// and the organisation is the one refusing. Anything else with a 401 is a lost sign-in. Unverified: docs/live-questions/audit-1107-notes.md.
const POLICY_401 = /access polic|api access|snc_platform_rest_api_access|api[- ]level/i;

/**
 * The error for an answer that is not OK (after the retries of instanceFetch). Every refusal is said as one, and none of them is retried
 * here or read another way (build rule 9). The message is a fixed plain sentence (src/context/access.js); the technical words (what
 * was read, the HTTP status, ServiceNow's own text) stay in `detail` and `status`, which the logic reads and no view shows:
 *   403  ACCESS_DENIED: an access rule (reason 'acl') or the organisation's restriction of this kind of read ('policy')
 *   401 with a live sign-in  ACCESS_DENIED, 'policy' (see POLICY_401)
 *   429  the instance is limiting requests; 503, 502, 504: busy or under maintenance
 *   400 about a table or column this instance does not have, and 404: 'missing' (left out quietly by the readers)
 *   any other status with a page instead of a JSON error: 'not-data'
 */
function refusalError(status, text, what) {
  const said = serviceNowErrorText(text);
  const detail = `${what} failed (${status})${said ? `: ${said}` : ''}`;
  if (status === 401) return friendlyError(READ_TEXT.policy, { detail, code: 'ACCESS_DENIED', reason: READ_REASON.POLICY, status });
  if (status === 403) {
    const reason = deniedReason(said);
    return friendlyError(reason === READ_REASON.POLICY ? READ_TEXT.policy : NOTE_TEXT.denied, { detail, code: 'ACCESS_DENIED', reason, status });
  }
  if (status === 429) return friendlyError(READ_TEXT.rateLimited, { detail, code: READ_CODE.RATE_LIMITED, reason: READ_REASON.RATE_LIMITED, status });
  if (status === 502 || status === 503 || status === 504) return friendlyError(READ_TEXT.unavailable, { detail, code: READ_CODE.UNAVAILABLE, reason: READ_REASON.UNAVAILABLE, status });
  if (status === 404 || (status === 400 && (isMissingTable(said) || isMissingColumn(said)))) return friendlyError(NOTE_TEXT.missing, { detail, reason: READ_REASON.MISSING, status });
  if (!said && looksLikeHtml(text)) return friendlyError(READ_TEXT.notData, { detail, code: READ_CODE.NOT_DATA, reason: READ_REASON.NOT_DATA, status });
  return friendlyError(NOTE_TEXT.error, { detail, status });
}

// A 401 is a lost sign-in unless the answer shows the sign-in is fine and a policy is refusing (POLICY_401, X-Is-Logged-In: true).
function isPolicyRefusal(response, text) {
  if (response.status !== 401) return false;
  return response.headers?.get?.('x-is-logged-in') === 'true' || POLICY_401.test(serviceNowErrorText(text));
}

function isSessionExpired(response, text) {
  if (response.status === 401) return !isPolicyRefusal(response, text);
  if (response.headers?.get?.('x-is-logged-in') === 'false') return true;
  if (response.redirected && LOGIN_URL.test(response.url || '')) return true;
  return /^s*</.test(text || '') && LOGIN_PAGE.test(text);
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
 * generically; every other refusal or limit says why (refusalError). Returns null for an empty body. A failure always throws:
 * nothing that failed can come back as an empty answer a caller would keep.
 */
export async function readJson(response, what) {
  // An abort while the body is read is the caller's own cancel: it must not turn into an empty (and cacheable) answer.
  const text = await response.text().catch((err) => {
    if (err?.name === 'AbortError') throw err;
    return '';
  });
  if (isSessionExpired(response, text)) {
    // The token belongs to the session that ended: a new sign-in gets a new one, so it is read again from the page next time
    // instead of being sent (and refused) for the rest of the five minutes it would otherwise be kept. So are the labels kept for the
    // person who was signed in (clearTableMeta): whoever signs in next may be someone else.
    forgetSessionToken();
    clearTableMeta();
    throw sessionExpiredError();
  }
  if (!response.ok) throw refusalError(response.status, text, what);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A page (an SSO step the login checks above did not recognise, a maintenance page, a proxy's page) or something else where data
    // was asked for. The token is dropped too: if this was a sign-in page, the sign-in that follows brings a new one.
    forgetSessionToken();
    clearTableMeta();
    throw friendlyError(READ_TEXT.notData, { detail: `${what} was not data`, code: READ_CODE.NOT_DATA, reason: READ_REASON.NOT_DATA, status: response.status });
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
  if (!Number.isFinite(count)) throw friendlyError(NOTE_TEXT.error, { detail: 'The instance returned no count.' });
  return count;
}

/**
 * Counts per value of one column over `query`, via the Aggregate API (nothing but the counts is transferred).
 * Returns the raw `result` array: [{ stats: { count }, groupby_fields: [{ field, value, display_value }] }].
 */
export async function countByColumn(table, query, column, { signal } = {}) {
  checkTable(table);
  if (!AGGREGATE_COLUMN_RE.test(String(column))) throw invalidRead('That is not a valid column name.');
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
    if (!AGGREGATE_COLUMN_RE.test(String(name))) throw invalidRead('That is not a valid column name.');
  });
  if (having && !AGGREGATE_HAVING_RE.test(String(having))) throw invalidRead('That is not a valid group filter.');
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

// ---- The words of a table's columns and choices: the one read that is not a table read ------------------------------------------
//
// A plain agent cannot read the choice list (sys_choice answers 403 in every query shape, measured on dev364920 on 2026-11-07,
// docs/live-checks-2026-11-07.md), but the UI meta service answers for an agent and for a person with no role, with each column's
// `label` and `choices` ([{ value, label }]) in the person's own language. So this is the ONE address besides /api/now/table and
// /api/now/stats the read layer asks for, and it is as narrow as the others: GET only (instanceFetch), same origin, the same headers,
// the same time limit and the same sorting of refusals (readJson), the table checked as an identifier before it becomes part of the
// address, no query string at all, and the organisation's blockedTables applied by the caller (src/context/choices.js asks the policy
// guard first, so a blocked table is never asked for). Of the answer only the wanted columns' label and choices are kept (cut to
// size); every other thing the service says about the table is dropped here, never passed on. Kept in MEMORY only, per signed-in
// person and table, for ten minutes, and dropped when the sign-in ends (build rule 7: nothing is stored).

const META_MAX_COLUMNS = 12;
const META_MAX_CHOICES = 200;
const META_TTL_MS = 10 * 60 * 1000;
const META_CACHE_MAX = 60;
const metaCache = new Map(); // `${person}|${table}|${columns}` -> { at, value }
const metaInflight = new Map(); // the same key -> the read on its way (shared by callers that did not bring their own cancel)

/** Forget the labels kept for the person who was signed in (the sign-in ended; tests). */
export function clearTableMeta() {
  metaCache.clear();
  metaInflight.clear();
}

/** The service's answer reduced to what was asked for: { [column]: { label, choices: [{ value, label }] } }, only for columns it has. */
export function reduceTableMeta(data, columns) {
  const result = data && typeof data === 'object' ? data.result : null;
  const all = result && typeof result === 'object' ? (result.columns && typeof result.columns === 'object' ? result.columns : result) : null;
  const out = {};
  if (!all) return out;
  for (const name of columns) {
    // (own properties only: a column name is an identifier, but nothing is looked up on the prototype)
    const column = Object.hasOwn(all, name) ? all[name] : null;
    if (!column || typeof column !== 'object') continue;
    const choices = [];
    for (const choice of Array.isArray(column.choices) ? column.choices.slice(0, META_MAX_CHOICES) : []) {
      const value = choice && (typeof choice.value === 'string' || typeof choice.value === 'number') ? String(choice.value).trim().slice(0, 80) : '';
      const label = choice && typeof choice.label === 'string' ? oneLine(choice.label, 80, { html: false }) : '';
      if (value && label) choices.push({ value, label });
    }
    out[name] = { label: typeof column.label === 'string' ? oneLine(column.label, 80, { html: false }) : '', choices };
  }
  return out;
}

/**
 * The labels of some columns of a table and the choices of each, in the signed-in person's language, from the UI meta service.
 * Asked for the columns it needs only (at most twelve identifiers). A column the person may not read, or the table has not, is left
 * out of the answer. Failures are thrown like every other read's (readJson): a refusal says so, a lost sign-in is SESSION_EXPIRED.
 * @param {string} table
 * @param {string[]} columns
 * @param {{ signal?: AbortSignal, userKey?: string }} [options] `userKey`: who the answer is kept for (the signed-in person's id, taken
 *   from the page when absent); with no way to tell who is signed in nothing is kept.
 * @returns {Promise<Record<string, { label: string, choices: { value: string, label: string }[] }>>}
 */
export async function readTableMeta(table, columns = [], { signal, userKey } = {}) {
  checkTable(table);
  const wanted = [...new Set(Array.isArray(columns) ? columns : [])];
  if (!wanted.length || wanted.length > META_MAX_COLUMNS || wanted.some((name) => typeof name !== 'string' || !FIELD_RE.test(name))) throw invalidRead('That is not a valid column name.');
  // Who is signed in: asked of the page alone (getSessionUser without a table reader makes no read of its own, so no policy is skipped).
  const person = typeof userKey === 'string' ? userKey : (await getSessionUser().catch(() => null))?.userId || '';
  const key = person ? `${person}|${table}|${[...wanted].sort().join(',')}` : '';
  const kept = key ? metaCache.get(key) : null;
  if (kept && Date.now() - kept.at < META_TTL_MS) return kept.value;
  if (key && !signal && metaInflight.has(key)) return metaInflight.get(key);

  // (started before anything is awaited again, so a second reader that arrives meanwhile finds this one in metaInflight)
  const read = (async () => {
    const data = await readWithLimit(
      `/api/now/ui/meta/${encodeURIComponent(table)}`,
      { method: 'GET', credentials: 'same-origin', headers: await sessionHeaders(), ...(signal ? { signal } : {}) },
      `Labels of "${table}"`
    );
    const value = reduceTableMeta(data, wanted);
    if (key) {
      metaCache.delete(key);
      metaCache.set(key, { at: Date.now(), value });
      while (metaCache.size > META_CACHE_MAX) metaCache.delete(metaCache.keys().next().value);
    }
    return value;
  })();
  if (!key || signal) return read;
  metaInflight.set(key, read);
  const done = () => {
    if (metaInflight.get(key) === read) metaInflight.delete(key);
  };
  read.then(done, done);
  return read;
}
