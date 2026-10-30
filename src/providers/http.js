// The one place a request to an AI provider is sent and its failures are put into words. Both adapters (openai.js, anthropic.js)
// and the model list use it, so every call gets the same protections:
//
//  - a time limit: a request that has not answered in time is stopped and says so (TIMEOUT);
//  - cancelling: the caller's AbortSignal stops the request at once, also while waiting to retry (CANCELLED);
//  - a bounded retry on "busy" answers only (429, 503, 529), honouring Retry-After / retry-after-ms and x-should-retry: false.
//    A 4xx that would come back the same (a bad key, an unknown model, a request that is too large) is never retried, a quota that is
//    used up is not retried either, and a request that timed out is not sent again (the provider may still be working on it);
//  - error text that is short and plain, never holds the API key (the provider's own reason is cleaned: anything shaped like a key is
//    hidden), and never repeats what was sent (a reason that quotes the request is dropped).
//
// Every error is an AiError with a machine `code` (the audit log records the code, never the message: src/lib/pipeline.js errorReason).

export const RETRY_STATUSES = Object.freeze([429, 503, 529]);
export const DEFAULT_TIMEOUT_MS = 120000; // a hosted model writing a long draft
export const LOCAL_TIMEOUT_MS = 300000; // a model on this computer can be much slower
export const LIST_TIMEOUT_MS = 20000; // the list of models
export const MAX_ATTEMPTS = 3; // the first try and at most two more
export const MAX_WAIT_MS = 20000; // the longest pause before another try; a longer Retry-After is reported instead of waited for
const MAX_REASON = 160;
const ECHO_WINDOW = 24; // a reason that repeats this many characters of the request in a row is taken to quote it

export class AiError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// Shapes of secrets a provider might repeat in an error ("Incorrect API key provided: sk-proj-****abcd"): vendor key prefixes, a
// bearer token, and any long unbroken run of letters and digits (Azure keys are 32 or more of them).
const KEY_SHAPES = /\b(?:sk-[\w*.-]{6,}|AIza[\w-]{10,}|gsk_\w{8,}|xai-\w{8,})|\bBearer\s+\S+|\b[A-Za-z0-9_-]{32,}\b/gi;

/**
 * The provider's own one-line reason, made safe to show: the key and anything shaped like one hidden, cut to a sentence, and dropped
 * entirely when it repeats a run of the text that was sent (some servers echo the request in their errors).
 * @param {string} reason the provider's message
 * @param {{ secrets?: string[], sent?: string }} [context] the key(s) used and the text that was sent
 */
export function safeReason(reason, { secrets = [], sent = '' } = {}) {
  let text = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) text = text.split(secret).join('[key hidden]');
  }
  text = text.replace(KEY_SHAPES, '[key hidden]');
  if (echoes(text, sent)) return '';
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1).trimEnd()}…` : text;
}

function echoes(text, sent) {
  const source = String(sent || '');
  if (!source || text.length < ECHO_WINDOW) return false;
  for (let i = 0; i + ECHO_WINDOW <= text.length; i += 1) {
    if (source.includes(text.slice(i, i + ECHO_WINDOW))) return true;
  }
  return false;
}

/** The pieces of an error body worth knowing: { message, code, type, param }; '' for what is missing or not JSON. */
export function readErrorBody(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { message: '', code: '', type: '', param: '' };
  }
  const error = data?.error && typeof data.error === 'object' ? data.error : data || {};
  const str = (value) => (typeof value === 'string' ? value : '');
  return {
    message: str(error.message) || str(data?.message),
    code: str(error.code).slice(0, 60),
    type: str(error.type).slice(0, 60),
    param: str(error.param).slice(0, 60),
  };
}

/**
 * How long to wait before trying again, in ms, or -1 when another try is not worth it (the provider said not to, or asked for a
 * wait longer than MAX_WAIT_MS). Without a hint: 1 s, then 2 s, with a little jitter so several panels do not retry in step.
 */
export function retryDelay(headers, attempt, random = Math.random) {
  const get = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  if (String(get('x-should-retry') || '').toLowerCase() === 'false') return -1;
  const msHeader = get('retry-after-ms');
  const ms = msHeader == null || msHeader === '' ? NaN : Number(msHeader);
  let wait = Number.isFinite(ms) && ms >= 0 ? ms : NaN;
  const after = get('retry-after');
  if (Number.isNaN(wait) && after != null && after !== '') {
    const seconds = Number(after);
    if (Number.isFinite(seconds)) wait = Math.max(0, seconds * 1000);
    else {
      const date = Date.parse(after);
      if (Number.isFinite(date)) wait = Math.max(0, date - Date.now());
    }
  }
  if (Number.isNaN(wait)) wait = 1000 * 2 ** attempt * (1 + 0.25 * random());
  return wait > MAX_WAIT_MS ? -1 : Math.round(wait);
}

/** "about 40 seconds" / "about 3 minutes" for a wait the provider asked for. */
function waitText(headers) {
  const get = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  const ms = Number(get('retry-after-ms') || NaN);
  let wait = Number.isFinite(ms) && ms > 0 ? ms : Number(get('retry-after') || NaN) * 1000;
  if (!Number.isFinite(wait) || wait <= 0) return '';
  if (wait < 90000) return `about ${Math.max(1, Math.round(wait / 1000))} seconds`;
  return `about ${Math.round(wait / 60000)} minutes`;
}

const minutes = (ms) => (ms >= 90000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`);

/** A pause that a cancel cuts short. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(cancelled());
    }
    signal?.addEventListener?.('abort', stop, { once: true });
  });
}

const cancelled = () => new AiError('Cancelled. No answer will be shown for this request.', 'CANCELLED');

/** The sentence for an answer that is not OK. `who` names the provider ("DeepSeek", "The endpoint ai.corp.example"). */
export function statusError(status, who, { reason = '', code = '', type = '', headers = null, deploymentWord = 'model', params = [], noCredit = false } = {}) {
  const why = reason ? ` (${reason})` : '';
  // `params`: optional request fields the provider named in its complaint (from a fixed list), so the adapter can drop them and retry.
  const extra = { status, params };
  if (status === 400 && /content_filter|content_policy/i.test(`${code} ${type}`)) {
    return new AiError(`${who} turned this request down with its content filter. Change the text, or ask your administrator about the filter.`, 'CONTENT_FILTER', extra);
  }
  if (noCredit || /insufficient_quota|billing/i.test(`${code} ${type}`) || status === 402) {
    return new AiError(`${who} says the account has no balance left${why}. Add credit on the provider's site, then try again.`, 'NO_CREDIT', extra);
  }
  switch (status) {
    case 400:
      return new AiError(`${who} could not use this request (answer 400)${why}. Check the ${deploymentWord} name in Settings, or try with less text.`, 'BAD_REQUEST', extra);
    case 401:
      return new AiError(`${who} rejected the API key. Check it in Agent Buddy settings.`, 'BAD_KEY', extra);
    case 403:
      return new AiError(`${who} refused the request (answer 403)${why}. The key may not be allowed to use this ${deploymentWord}, or a network filter blocks the address.`, 'NO_ACCESS', extra);
    case 404:
      return new AiError(`${who} answered "not found" (404)${why}. Check the address and the ${deploymentWord} name in Settings.`, 'NOT_FOUND', extra);
    case 408:
      return new AiError(`${who} gave up waiting for the request (answer 408). Try again in a minute.`, 'TIMEOUT', extra);
    case 413:
      return new AiError(`The request is too large for ${who}. Try with less text, or a ${deploymentWord} that takes more.`, 'TOO_LARGE', extra);
    case 429: {
      const wait = waitText(headers);
      return new AiError(`${who} is limiting requests${why}. ${wait ? `Try again in ${wait}.` : 'Wait a minute and try again.'}`, 'RATE_LIMIT', extra);
    }
    case 503:
    case 529:
      return new AiError(`${who} is busy. Try again in a minute.`, 'BUSY', extra);
    default:
      if (status >= 500) return new AiError(`${who} had a problem on its side (answer ${status}). Try again in a minute.`, 'SERVER_ERROR', extra);
      return new AiError(`${who} could not handle the request (answer ${status})${why}.`, 'REQUEST_FAILED', extra);
  }
}

/**
 * Send one JSON request and return the parsed JSON answer, or throw an AiError with a plain sentence.
 * @param {object} p
 * @param {string} p.url
 * @param {object} p.init fetch init (method, headers, body). The body is sent as is.
 * @param {string} p.who the provider's name for messages
 * @param {string} p.host the host, for "could not reach"
 * @param {string[]} [p.secrets] values that must never appear in a message (the key)
 * @param {string} [p.sent] the text that was sent, so a reason that quotes it is dropped
 * @param {AbortSignal} [p.signal] the caller's cancel
 * @param {number} [p.timeoutMs]
 * @param {number} [p.attempts] how many tries at most (1 = no retry)
 * @param {Function} [p.fetchFn] for tests; defaults to the global fetch at call time
 * @param {Function} [p.sleep] for tests: (ms, signal) => Promise
 * @param {string} [p.deploymentWord] 'model' or 'deployment' (Azure), for the hints in messages
 */
export async function requestJson({ url, init, who, host, secrets = [], sent = '', signal, timeoutMs = DEFAULT_TIMEOUT_MS, attempts = MAX_ATTEMPTS, fetchFn, sleep = abortableSleep, deploymentWord = 'model', random = Math.random }) {
  const doFetch = fetchFn || ((...args) => globalThis.fetch(...args));
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const stopped = () => {
      if (signal?.aborted) return cancelled();
      if (timedOut) return new AiError(`${who} did not answer within ${minutes(timeoutMs)}. Try again, or choose a faster ${deploymentWord} in Settings.`, 'TIMEOUT');
      return null;
    };
    try {
      let response;
      try {
        // The fetch options come last so nothing in `init` can loosen them:
        //  - redirect 'error': a 307/308 to another origin would make the browser send the same request, key header (x-api-key,
        //    api-key) and body included, to an address nobody approved. A provider that redirects is refused instead;
        //  - credentials 'omit': no cookies or HTTP auth of the browser profile go to the AI address;
        //  - referrerPolicy 'no-referrer': the extension page's address is not sent;
        //  - cache 'no-store': neither the request nor the answer (masked ticket text) is kept in the HTTP cache.
        response = await doFetch(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      } catch {
        // fetch only throws when nothing came back at all: offline, blocked by a firewall, VPN or proxy, no browser permission, or
        // an answer that redirects elsewhere (never followed).
        throw stopped() || new AiError(`Could not reach ${host}. Check your internet connection, VPN or proxy, that the browser allowed access to this address, and that the address does not redirect elsewhere.`, 'UNREACHABLE');
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw stopped() || new AiError(`${who} sent an answer Agent Buddy could not read. Check the address in Settings.`, 'BAD_ANSWER');
        }
      }
      let text = '';
      try {
        text = await response.text();
      } catch {
        if (stopped()) throw stopped();
      }
      const body = readErrorBody(text);
      const reason = safeReason(body.message, { secrets, sent });
      // Out of credit (OpenAI sends 429 insufficient_quota, Anthropic 400 "credit balance is too low"): waiting does not help.
      const quota = /insufficient_quota|credit balance|exceeded your current quota/i.test(`${body.code} ${body.type} ${body.message}`);
      if (RETRY_STATUSES.includes(response.status) && !quota && attempt + 1 < attempts) {
        const wait = retryDelay(response.headers, attempt, random);
        if (wait >= 0) {
          clearTimeout(timer); // the pause is not part of this try's time limit; the next try gets its own
          await sleep(wait, signal);
          continue; // eslint-disable-line no-continue -- the retry loop
        }
      }
      // Which of the optional fields we sent the provider complained about, from a fixed list only (the adapter can leave them out
      // and send again); never any of the provider's own text.
      const complaint = `${body.param} ${body.message}`.toLowerCase();
      const params = ['temperature', 'max_completion_tokens', 'max_tokens', 'output_config', 'effort'].filter((p) => complaint.includes(p));
      throw statusError(response.status, who, { reason, code: body.code, type: body.type, headers: response.headers, deploymentWord, params, noCredit: quota });
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw stopped() || err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }
}
