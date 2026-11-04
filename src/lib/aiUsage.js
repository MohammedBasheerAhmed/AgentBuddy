// How many AI calls and tokens were used, and the person's own daily limits for them; also the checks of the AI address typed in
// Settings. Pure: no chrome.* and no network, so it is unit-tested (tests/ai-usage-log.test.js, tests/budget-caps.test.js). The side
// panel (src/providers/budget.js) feeds it the stored log and caps.
//
// Every model call is logged (numbers and the names of the provider and model only); the caps count calls and tokens per day in the
// user's own time zone, warn from 80% and refuse at 100%.
// (core.js, not index.js: the service worker's bundle carries this file, and it has no Arabic catalogue to carry)
import { t, tn } from '../i18n/core.js';

export const USAGE_KEY = 'agentbuddy_ai_usage';
export const CAPS_KEY = 'agentbuddy_ai_caps';
export const LOG_LIMIT = 500;
export const WARN_AT = 0.8;

// --- Endpoints --------------------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Plain http:// reaches only the two names the manifest lets Agent Buddy call over http (optional_host_permissions and the pages'
// connect-src): localhost and 127.0.0.1. http://[::1] is this computer too, but the browser would refuse every call to it.
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Check a base URL typed by the user. https only, except http to this machine (Ollama, LM Studio) by the name localhost or
 * 127.0.0.1; no user:password@, no query string or fragment; a trailing slash is dropped. An empty string means "use the provider's
 * own endpoint".
 * @returns {{ ok: boolean, url: string, host: string, origin: string, local: boolean, error?: string }}
 */
export function validateBaseUrl(input) {
  const text = String(input ?? '').trim();
  const empty = { ok: true, url: '', host: '', origin: '', local: false };
  if (!text) return empty;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ...empty, ok: false, error: t('That is not a web address. Start with https://') };
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol === 'http:' && local && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) {
    return { ...empty, ok: false, error: t('Write http://localhost or http://127.0.0.1 instead of [::1]. The browser lets Agent Buddy reach a server on this computer over http:// only by those two names.') };
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    return { ...empty, ok: false, error: t('Use https://. Plain http:// is only allowed for localhost or 127.0.0.1.') };
  }
  if (parsed.username || parsed.password) return { ...empty, ok: false, error: t('Do not put a user name or password in the address. The key goes in the key field.') };
  if (parsed.search || parsed.hash || /[?#]/.test(text)) return { ...empty, ok: false, error: t('Leave off the ?query and #fragment.') };
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.origin}${path}`, host: parsed.host, origin: parsed.origin, local };
}

/** `<base>/chat/completions` for OpenAI-compatible servers. */
export const chatCompletionsUrl = (base) => `${base}/chat/completions`;

/** `<base>/models`: the list of models an OpenAI-compatible server offers. */
export const modelsUrl = (base) => `${base}/models`;

/** `<base>/messages` for an Anthropic-compatible proxy (the base already ends in /v1 for the real API). */
export const anthropicMessagesUrl = (base) => `${base}/messages`;

// --- Azure OpenAI ---------------------------------------------------------------------------------------------------
//
// Azure has two address forms, and both take the key in an `api-key` header (never `Authorization: Bearer`):
//   v1 (the current one):  <resource>/openai/v1/chat/completions                      the deployment name goes in the body as `model`
//   deployment (classic):  <resource>/openai/deployments/<deployment>/chat/completions?api-version=<version>
// The person enters the resource address only (https://<name>.openai.azure.com). The one query Agent Buddy ever adds is the
// api-version of the classic form, built here from a checked value; a typed address may still carry no query at all.

export const AZURE_API_FORMS = ['v1', 'deployment'];
export const AZURE_DEFAULT_API_VERSION = '2024-10-21';
const AZURE_VERSION_RE = /^\d{4}-\d{2}-\d{2}(-preview)?$/;
// What Azure allows in a deployment name (letters, digits, - _ .), which also makes it safe in a URL path.
const AZURE_DEPLOYMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// The host names Azure OpenAI resources use. Another host (an API Management gateway in front of Azure) works too; Settings only
// says that it is not one of these.
const AZURE_HOST_RE = /\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com|azure-api\.net)$/i;

export const isAzureApiVersion = (value) => AZURE_VERSION_RE.test(String(value ?? '').trim());
export const isAzureDeployment = (value) => AZURE_DEPLOYMENT_RE.test(String(value ?? '').trim());
export const isAzureHost = (host) => AZURE_HOST_RE.test(String(host ?? '').replace(/:\d+$/, ''));

/** { form, apiVersion } from what is saved; anything unknown falls back to v1 and the default version. */
export function azureOptions(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const form = AZURE_API_FORMS.includes(s.form) ? s.form : 'v1';
  const typed = String(s.apiVersion ?? '').trim();
  return { form, apiVersion: typed || AZURE_DEFAULT_API_VERSION, apiVersionOk: !typed || isAzureApiVersion(typed) };
}

// A resource address may be typed with the part Azure's own pages show after it (/openai or /openai/v1); the URLs below add it back.
const azureRoot = (base) => String(base || '').replace(/\/openai(\/v1)?$/i, '');

/** The chat address for an Azure resource. `base` is a validated resource address; `deployment` is checked by the caller. */
export function azureChatUrl(base, { form, apiVersion }, deployment) {
  const root = azureRoot(base);
  if (form === 'deployment') return `${root}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  return `${root}/openai/v1/chat/completions`;
}

/**
 * Split an Azure address someone pasted whole (the "Target URI" Azure shows, or a v1 address) into its parts, so each lands in its own
 * field instead of the address carrying a path and a query. Returns null when there is nothing to split (a plain resource address, or
 * not an Azure-shaped address at all). Never accepts a query other than api-version, a user name or password, or plain http.
 * @returns {{ ok: boolean, base?: string, form?: string, deployment?: string, apiVersion?: string, error?: string } | null}
 */
export function splitAzureAddress(input) {
  const text = String(input ?? '').trim();
  if (!text || !/\/openai\/(deployments|v1)\b|[?&]api-version=/i.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const keys = [...url.searchParams.keys()];
  if (url.hash || keys.some((k) => k !== 'api-version')) return { ok: false, error: t('Only api-version may follow the ? in an Azure address. Leave off everything else.') };
  const root = validateBaseUrl(`${url.origin}${url.pathname.replace(/\/openai\/.*$/i, '')}`);
  if (!root.ok) return { ok: false, error: root.error };
  if (url.username || url.password) return { ok: false, error: t('Do not put a user name or password in the address. The key goes in the key field.') };
  const deployment = (url.pathname.match(/\/openai\/deployments\/([^/]+)/i) || [])[1];
  const apiVersion = url.searchParams.get('api-version') || '';
  if (apiVersion && !isAzureApiVersion(apiVersion)) return { ok: false, error: t('The api-version in that address does not look like 2024-10-21.') };
  if (deployment) {
    const name = decodeURIComponent(deployment);
    if (!isAzureDeployment(name)) return { ok: false, error: t('The deployment name in that address has characters Azure does not allow.') };
    return { ok: true, base: root.url, form: 'deployment', deployment: name, apiVersion: apiVersion || AZURE_DEFAULT_API_VERSION };
  }
  // A v1 address, or only an api-version after a resource address (form '' = keep the form chosen in Settings).
  return { ok: true, base: root.url, form: /\/openai\/v1(\/|$)/i.test(url.pathname) ? 'v1' : '', deployment: '', apiVersion };
}

/** The match pattern Chrome asks permission for: any port on that host. */
export function originPattern(url) {
  const checked = validateBaseUrl(url);
  if (!checked.ok || !checked.url) return '';
  const parsed = new URL(checked.url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

// --- Tokens -----------------------------------------------------------------------------------------------------

const num = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

export const totalTokens = (entry) => num(entry?.inputTokens) + num(entry?.outputTokens) + num(entry?.cacheRead) + num(entry?.cacheWrite);

// --- The log ----------------------------------------------------------------------------------------------------

/**
 * { time, provider, model, ms, inputTokens, outputTokens, cacheRead, cacheWrite, host, kind }: one call. A day's total (see
 * appendEntry) has the same fields, summed, plus `calls`, and no host.
 */
export function makeEntry({ now = new Date(), provider, model, ms = 0, usage = {}, host = '', kind = 'chat' } = {}) {
  return {
    time: new Date(now).toISOString(),
    provider: String(provider || ''),
    model: String(model || ''),
    ms: Math.max(0, Math.round(ms)),
    inputTokens: num(usage.input),
    outputTokens: num(usage.output),
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
    host: String(host || ''),
    kind: ['chat', 'agent', 'validate'].includes(kind) ? kind : 'chat',
  };
}

/** A day's total rather than one call (appendEntry folds old calls into these). */
const isTotal = (entry) => typeof entry?.calls === 'number';

/** How many calls an entry stands for: 1, or a day's total's `calls`. */
export const callsOf = (entry) => (isTotal(entry) ? Math.max(0, Math.floor(num(entry.calls))) : 1);

/**
 * Append, keeping the newest `limit` calls one by one (the buffer is stored oldest first). A call that falls out is not forgotten
 * while it still counts against a cap: it is folded into one total per day, provider, model and kind (the number of calls and the
 * sums of tokens and time; the same kind of numbers, no instance), and totals from before the month of the newest call are
 * dropped. With only the newest 500 calls kept, a daily limit above 500 calls could never be reached, and the tokens of a busy day
 * or month (and the organisation's daily token budget) were counted short.
 */
export function appendEntry(log, entry, limit = LOG_LIMIT) {
  const next = [...(Array.isArray(log) ? log : []), entry];
  const calls = next.filter((e) => !isTotal(e));
  if (calls.length <= limit) return next;
  const month = monthKey(entry?.time);
  const totals = new Map();
  const fold = (e) => {
    if (!e?.time || monthKey(e.time) !== month) return; // an earlier month counts against no cap
    const key = [dayKey(e.time), e.provider, e.model, e.kind].join('|');
    const total = totals.get(key) || { time: e.time, provider: e.provider, model: e.model, ms: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, host: '', kind: e.kind, calls: 0 };
    total.calls += callsOf(e);
    total.ms += num(e.ms);
    total.inputTokens += num(e.inputTokens);
    total.outputTokens += num(e.outputTokens);
    total.cacheRead += num(e.cacheRead);
    total.cacheWrite += num(e.cacheWrite);
    totals.set(key, total);
  };
  next.filter(isTotal).forEach(fold);
  calls.slice(0, calls.length - limit).forEach(fold);
  return [...totals.values(), ...calls.slice(calls.length - limit)];
}

// --- Day and month windows (the user's own time zone) -------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthKey = (date) => dayKey(date).slice(0, 7);

function sum(entries) {
  let calls = 0;
  let tokens = 0;
  entries.forEach((e) => {
    calls += callsOf(e);
    tokens += totalTokens(e);
  });
  return { calls, tokens };
}

/** Today's and this month's calls and tokens (Settings > Usage and limits). Key-validation pings count here, not against caps. */
export function summarize(log, now = new Date()) {
  const list = (Array.isArray(log) ? log : []).filter((e) => e && e.time);
  const today = dayKey(now);
  const month = monthKey(now);
  return {
    today: sum(list.filter((e) => dayKey(e.time) === today)),
    month: sum(list.filter((e) => monthKey(e.time) === month)),
  };
}

// --- Caps ---------------------------------------------------------------------------------------------------------

/** caps: { dailyCalls, dailyTokens }. Anything missing or not a positive number is 0, "no cap". */
export function normalizeCaps(caps) {
  const c = caps && typeof caps === 'object' ? caps : {};
  return { dailyCalls: Math.floor(num(c.dailyCalls)), dailyTokens: Math.floor(num(c.dailyTokens)) };
}

const where = () => t('Agent Buddy settings > Usage and limits'); // where the caps are set, said when the message is made

/**
 * Where today's use (every provider's) stands against the person's own caps.
 * @returns {{ status: 'ok' | 'warn' | 'blocked', items: Array, worst: object | null, message: string }}
 */
export function checkCaps(log, capsInput, now = new Date()) {
  const caps = normalizeCaps(capsInput);
  // Pings that only validate a key never count; they should not lock anybody out of fixing their key.
  const list = (Array.isArray(log) ? log : []).filter((e) => e && e.time && e.kind !== 'validate');
  const today = dayKey(now);
  const items = [];
  const add = (name, used, limit, format) => {
    if (!limit) return;
    items.push({ name, used, limit, pct: used / limit, format });
  };
  const todayAll = list.filter((e) => dayKey(e.time) === today);
  add(t('Daily calls'), todayAll.reduce((total, e) => total + callsOf(e), 0), caps.dailyCalls, (n) => tn(Math.round(n), '{n} call', '{n} calls'));
  add(t('Daily tokens'), todayAll.reduce((total, e) => total + totalTokens(e), 0), caps.dailyTokens, (n) => tn(Math.round(n), '{n} token', '{n} tokens', { n: Math.round(n).toLocaleString('en-US') }));

  const worst = items.length ? [...items].sort((a, b) => b.pct - a.pct)[0] : null;
  const status = !worst ? 'ok' : worst.pct >= 1 ? 'blocked' : worst.pct >= WARN_AT ? 'warn' : 'ok';
  let message = '';
  if (status === 'blocked') {
    message = t('{name} cap reached ({used} of {limit}). It resets at the start of the next {period}, or raise the cap in {where}.', {
      name: worst.name,
      used: worst.format(worst.used),
      limit: worst.format(worst.limit),
      period: t('day'),
      where: where(),
    });
  } else if (status === 'warn') {
    message = t('{name}: {percent}% of the {limit} cap used.', { name: worst.name, percent: Math.round(worst.pct * 100), limit: worst.format(worst.limit) });
  }
  return { status, items, worst, message };
}

// --- The organisation's daily token budget (managed policy `tokenBudgetPerDay`) ---------------------------------------

/** Tokens used today in the user's time zone, counting every real call and not the key-validation pings. */
export function tokensUsedToday(log, now = new Date()) {
  const today = dayKey(now);
  return (Array.isArray(log) ? log : [])
    .filter((e) => e && e.time && e.kind !== 'validate' && dayKey(e.time) === today)
    .reduce((total, e) => total + totalTokens(e), 0);
}

/**
 * The daily token cap that applies: the smaller of the organisation's and the person's own (each 0 = none). 0 means no cap.
 * The person's own cap is enforced by checkCaps; this is what Settings shows as "the limit that applies".
 */
export function effectiveDailyTokenCap(policyCap, ownCap) {
  const caps = [num(policyCap), num(ownCap)].filter((n) => n > 0);
  return caps.length ? Math.floor(Math.min(...caps)) : 0;
}

/**
 * The reader the pipeline wants (`async () => tokens used today`), from a function that reads the stored log:
 *   tokensUsedToday: tokensTodayReader(async () => (await readBudgetState()).log)
 */
export const tokensTodayReader = (readLog, now = () => new Date()) => async () => tokensUsedToday(await readLog(), now());
