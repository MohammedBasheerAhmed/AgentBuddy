// Managed policy: what an organisation's IT/security team can pin through Chrome/Edge enterprise policy
// (chrome.storage.managed, schema in managed_schema.json). Pure functions, no chrome.* here, so every rule is unit-tested
// (tests/policy.test.js, tests/policy-keys.test.js, tests/policy-enterprise.test.js). The panel loads the raw policy and calls
// effectiveSettings() to combine it with the user's own choices: a policy can tighten things and lock them, a user can never
// loosen what a policy sets.
//
// Reading a policy (normalizePolicy):
//   - unknown keys are dropped; a value of the wrong type, or a word that is not one of the allowed ones, is "not set" (the browser
//     itself drops values that do not match managed_schema.json before Agent Buddy sees them). policyProblems() lists each of these
//     so an administrator can find them (scripts/check-policy.js);
//   - case and spaces never matter where a person could not mean anything else: "Strict " is strict, "OpenAI" is openai, table and
//     feature names are lower case;
//   - addresses are compared in one canonical form (lower-case host, no default port, no trailing slash). An AI address that is not
//     valid blocks every AI call (`aiBlocked`) instead of being ignored: ignoring it would let the person choose any endpoint.
//
// An enterprise build compiles a policy into the extension (src/policy/baked.js). It is a floor under whatever the browser's managed
// policy says: the two are combined with mergePolicies(), which keeps the stricter side of every setting.
import { BAKED_POLICY } from './baked.js';
import { HIDEABLE_SCREENS, PROFILE_IDS } from '../profiles/ids.js';
import { LAYOUT_KIND, LAYOUT_MAX_CHARS, LAYOUT_VERSION, layoutEnvelopeProblem } from '../reports/layoutFile.js';

export const PII_MODES = ['standard', 'strict', 'local-only'];
export const PREVIEW_MODES = ['always', 'first', 'never'];
export const KEY_STORAGE_MODES = ['local', 'session', 'encrypted'];

/**
 * Every key an organisation can set. managed_schema.json, the key table in docs/deployment.md and this list are kept in step by
 * tests/policy-keys.test.js.
 */
export const POLICY_KEYS = Object.freeze([
  'allowedInstances',
  'aiProvider',
  'aiBaseUrl',
  'allowedProviders',
  'allowedModels',
  'piiMode',
  'previewMode',
  'keyStorage',
  'providedApiKey',
  'disabledFeatures',
  'blockedTables',
  'blockedFields',
  'sensitiveTablePrefixes',
  'allowHrContent',
  'tokenBudgetPerDay',
  'auditExport',
  'coachingEnabled',
  'disablePageBar',
  'aiEnabled',
  'disabledSections',
  'allowedProfiles',
  'lockedProfiles',
  'orgSnippets',
  'internalPhrases',
  'defaultDashboard',
  'priorityAccounts',
]);

// Stricter is later in the list. A user choice below the policy floor is raised to it.
const strictness = (mode) => Math.max(0, PII_MODES.indexOf(mode));
// Showing the outgoing text more often is stricter.
const PREVIEW_RANK = { never: 0, first: 1, always: 2 };
// Only used to combine two policies that disagree: keeping the key in memory only (session) keeps the least on disk.
const KEY_STORAGE_RANK = { local: 0, encrypted: 1, session: 2 };

const unique = (values) => [...new Set(values)];
const list = (value) => (Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : []);
const lowerList = (value) => list(value).map((v) => v.toLowerCase());
// A word from a fixed list, whatever its case or surrounding spaces; anything else is null ("not set").
const oneOf = (value, allowed) => {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return allowed.includes(word) ? word : null;
};
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Tables whose names start with one of these are sensitive (HR-family): free text and identities are only read when the
// organisation allows HR content, and the AI endpoint must be an approved one. 'sn_hr_' is always on the list; the policy key
// `sensitiveTablePrefixes` ADDS to it (a custom HR, legal or employee-relations table family), it can never remove it.
export const DEFAULT_SENSITIVE_PREFIXES = Object.freeze(['sn_hr_']);
const PREFIX_RE = /^[a-z][a-z0-9_]{1,63}$/;

function sensitivePrefixes(value) {
  const extra = lowerList(value).filter((p) => PREFIX_RE.test(p));
  return unique([...DEFAULT_SENSITIVE_PREFIXES, ...extra]);
}

// ---- Addresses --------------------------------------------------------------------------------------------------------------

// Letters, digits and hyphens in dot-separated labels (an international name arrives here in its xn-- form). No "*", no "_",
// no brackets: a host that could stand for more than one site is never an instance.
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const HAS_SPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/;

/**
 * "https://acme.service-now.com" from a URL or bare host; '' when it is not one plain https host. Lower case, default port dropped,
 * path and query dropped. Refused: http, other schemes, a user name or password ("https://acme.service-now.com@evil.example"),
 * spaces or control characters, and any host with a "*" (typing "*" in Settings must never ask the browser for every site).
 */
export function normalizeInstance(input) {
  const text = String(input || '').trim();
  if (!text || HAS_SPACE_OR_CONTROL.test(text)) return '';
  // An explicit scheme other than http(s) ("ftp://", "mailto:") is not an instance.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!HOST_RE.test(url.hostname)) return '';
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * One allow-list entry in its canonical form: an exact origin ("https://acme.service-now.com") or a wildcard host
 * ("*.corp.example.com"); '' when it is neither. A wildcard needs at least two labels after "*." ("*.com" is refused) and stands
 * for any sub-domain, never for the domain itself.
 */
export function normalizeAllowEntry(entry) {
  const text = String(entry ?? '').trim().toLowerCase();
  if (!text || HAS_SPACE_OR_CONTROL.test(text)) return '';
  if (!text.startsWith('*.')) return text.includes('*') ? '' : normalizeInstance(text);
  const rest = text.slice(2);
  if (!rest || /[*:/?#@\\[\]]/.test(rest)) return '';
  let host;
  try {
    // Through the URL parser so an international name gets its xn-- form, exactly as a page's address does.
    host = new URL(`https://x.${rest}`).hostname;
  } catch {
    return '';
  }
  if (!host.startsWith('x.')) return '';
  const suffix = host.slice(2);
  const labels = suffix.split('.');
  if (labels.length < 2 || !HOST_RE.test(suffix) || /^\d+$/.test(labels[labels.length - 1])) return '';
  return `*.${suffix}`;
}

const LOCAL_AI_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * An AI address in canonical form, with the same rules as the address box in Settings (validateBaseUrl in src/lib/aiUsage.js):
 * https only (http only for this computer), no user name or password, no ?query or #fragment, lower-case host, no default port,
 * no trailing slash. The result is what the provider layer actually calls, so the two can be compared as text.
 * @returns {{ ok: boolean, url: string, origin: string, local: boolean, error: string }}
 */
export function normalizeEndpoint(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  const bad = (error) => ({ ok: false, url: '', origin: '', local: false, error });
  if (!text) return bad('it is empty');
  if (HAS_SPACE_OR_CONTROL.test(text)) return bad('it contains a space or a control character');
  let url;
  try {
    url = new URL(text);
  } catch {
    return bad('it is not a web address');
  }
  const local = LOCAL_AI_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return bad('it must start with https:// (http:// only for localhost or 127.0.0.1)');
  if (url.username || url.password) return bad('it must not contain a user name or password');
  if (url.search || url.hash || /[?#]/.test(text)) return bad('it must not have a ?query or #fragment');
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, origin: url.origin, local, error: '' };
}

// ---- Reading one policy -----------------------------------------------------------------------------------------------------

const BLOCKED_ENDPOINT = 'The AI address in your organisation\'s policy is not valid, so Agent Buddy sends nothing. Ask your administrator.';

function budgetOf(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Organisation snippets: canned replies a team lead or the service owner publishes for everyone. Plain text only (they are inserted
// as text, never as markup); anything that is not an object with a title and a body is dropped, and the sizes are capped so a policy
// cannot fill the panel's memory.
export const ORG_SNIPPET_LIMITS = Object.freeze({ count: 200, title: 80, body: 4000, shortcut: 40 });
function readOrgSnippets(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (out.length >= ORG_SNIPPET_LIMITS.count) break;
    if (!isPlainObject(item) || typeof item.title !== 'string' || typeof item.body !== 'string') continue;
    const title = item.title.trim().slice(0, ORG_SNIPPET_LIMITS.title);
    const body = item.body.slice(0, ORG_SNIPPET_LIMITS.body);
    if (!title || !body.trim() || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const shortcut = typeof item.shortcut === 'string' ? item.shortcut.trim().slice(0, ORG_SNIPPET_LIMITS.shortcut) : '';
    out.push({ title, body, shortcut });
  }
  return out;
}

// The organisation's dashboard (N17): one dashboard layout exactly as the Team screen's "Save layout as a file" writes it,
// { kind, version, dashboard: { name, scope, tables, widgets } }. Only its envelope and size are checked here (src/reports/layoutFile.js);
// src/reports/dashboards.js cleans the dashboard inside exactly like a file a person loads, and drops one with no section it knows.
// The value may also be the file's text (a Windows registry string holds JSON). What is kept is a plain-data copy of the four parts.
// @returns {{ layout: object|null, problem: '' | 'not-layout' | 'newer' | 'too-big' }}
function parseOrgDashboard(value) {
  let parsed = value;
  if (typeof value === 'string') {
    if (value.length > LAYOUT_MAX_CHARS) return { layout: null, problem: 'too-big' };
    try {
      parsed = JSON.parse(value.replace(/^﻿/, ''));
    } catch {
      return { layout: null, problem: 'not-layout' };
    }
  }
  const problem = layoutEnvelopeProblem(parsed);
  if (problem) return { layout: null, problem };
  let text;
  try {
    const d = parsed.dashboard;
    text = JSON.stringify({ kind: LAYOUT_KIND, version: LAYOUT_VERSION, dashboard: { name: d.name, scope: d.scope, tables: d.tables, widgets: d.widgets } });
  } catch {
    return { layout: null, problem: 'not-layout' };
  }
  if (typeof text !== 'string' || text.length > LAYOUT_MAX_CHARS) return { layout: null, problem: 'too-big' };
  return { layout: JSON.parse(text), problem: '' };
}

// Priority accounts (N28): the customer accounts the organisation names as priority, written as ServiceNow shows the account's name.
// ServiceNow has no standard column for it. Text only; a name longer than the limit is dropped rather than cut (a cut name could match
// another account); repeats (whatever their case) are kept once; the list is capped so a policy cannot fill the panel's memory.
// Matching ignores case and spaces (src/insights/priorityAccount.js).
export const PRIORITY_ACCOUNT_LIMITS = Object.freeze({ count: 500, length: 100 });
function readPriorityAccounts(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (out.length >= PRIORITY_ACCOUNT_LIMITS.count) break;
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || name.length > PRIORITY_ACCOUNT_LIMITS.length || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

// Words of a fixed list (screens, profiles), lower case; anything else is dropped.
const knownWords = (value, known) => unique(lowerList(value).filter((w) => known.includes(w)));

// One policy object, cleaned. Idempotent: reading its own output gives the same object, which matters because the panel passes an
// already-read policy to effectiveSettings(). `aiBlocked` is worked out from the values every time, never taken from the input.
function readPolicy(raw) {
  const p = isPlainObject(raw) ? raw : {};
  const endpointText = typeof p.aiBaseUrl === 'string' ? p.aiBaseUrl.trim() : '';
  const endpoint = endpointText ? normalizeEndpoint(endpointText) : null;
  const provider = typeof p.aiProvider === 'string' ? p.aiProvider.trim().toLowerCase() : '';
  return {
    allowedInstances: Array.isArray(p.allowedInstances) ? unique(list(p.allowedInstances).map(normalizeAllowEntry).filter(Boolean)) : null,
    aiProvider: provider || null,
    // An address that is not valid is kept as written (it can never equal a real, checked address) and blocks every AI call.
    aiBaseUrl: endpoint ? (endpoint.ok ? endpoint.url : endpointText) : null,
    // Provider ids in lower case. An empty list allows no provider; a provider the code does not know never matches.
    allowedProviders: Array.isArray(p.allowedProviders) ? unique(lowerList(p.allowedProviders)) : null,
    allowedModels: Array.isArray(p.allowedModels) ? unique(list(p.allowedModels)) : null,
    piiMode: oneOf(p.piiMode, PII_MODES),
    previewMode: oneOf(p.previewMode, PREVIEW_MODES),
    keyStorage: oneOf(p.keyStorage, KEY_STORAGE_MODES),
    providedApiKey: typeof p.providedApiKey === 'string' ? p.providedApiKey.trim() : '',
    // Feature ids, table names and field names are compared in lower case on both sides, so "Reply-Draft" switches off reply-draft.
    disabledFeatures: unique(lowerList(p.disabledFeatures)),
    blockedTables: unique(lowerList(p.blockedTables)),
    blockedFields: unique(lowerList(p.blockedFields)),
    sensitiveTablePrefixes: sensitivePrefixes(p.sensitiveTablePrefixes),
    allowHrContent: p.allowHrContent === true,
    tokenBudgetPerDay: budgetOf(p.tokenBudgetPerDay),
    auditExport: p.auditExport !== false,
    coachingEnabled: p.coachingEnabled === true,
    // The one thing Agent Buddy draws on a ServiceNow page is the small bar of main actions; an organisation can switch it off for everyone.
    disablePageBar: p.disablePageBar === true,
    // false hides every AI Assist half for everyone: Agent Buddy then works without AI (the Insights halves stay). Unset is on.
    aiEnabled: p.aiEnabled !== false,
    // Screens an organisation does not want (the Ticket screen cannot be hidden).
    disabledSections: knownWords(p.disabledSections, HIDEABLE_SCREENS),
    // Work profiles people may choose (null: all of them); locked ones are set for everyone and cannot be changed.
    allowedProfiles: Array.isArray(p.allowedProfiles) ? knownWords(p.allowedProfiles, PROFILE_IDS) : null,
    lockedProfiles: Array.isArray(p.lockedProfiles) ? knownWords(p.lockedProfiles, PROFILE_IDS) : null,
    orgSnippets: readOrgSnippets(p.orgSnippets),
    // More phrases the safe-to-send check treats as internal-only (team names, system names), on top of the built-in list.
    internalPhrases: unique(list(p.internalPhrases).map((s) => s.slice(0, 120))).slice(0, 200),
    // The Team screen's first dashboard for someone with none yet, and offered once to anyone else; never locked (N17).
    defaultDashboard: parseOrgDashboard(p.defaultDashboard).layout,
    // Customer accounts the Account card and the Glance mark as "Priority account" (N28).
    priorityAccounts: readPriorityAccounts(p.priorityAccounts),
    // Not a policy key: '' or the reason no AI call may be made under this policy.
    aiBlocked: endpoint && !endpoint.ok ? BLOCKED_ENDPOINT : '',
  };
}

// ---- Combining two policies (an enterprise build's compiled-in floor and the browser's managed policy) ----------------------

const isWildcard = (entry) => entry.startsWith('*.');

// Does `list` allow everything `entry` stands for? An exact origin: one of the list's entries matches it. A wildcard: the list has the
// same wildcard or a wider one ("*.corp.example" covers "*.eu.corp.example").
function coveredBy(entry, allowList) {
  if (!isWildcard(entry)) return isInstanceAllowed(entry, { allowedInstances: allowList });
  return allowList.some((other) => isWildcard(other) && (other === entry || entry.slice(1).endsWith(other.slice(1))));
}

function intersectInstances(a, b) {
  if (a === null) return b === null ? null : [...b];
  if (b === null) return [...a];
  return unique([...a.filter((entry) => coveredBy(entry, b)), ...b.filter((entry) => coveredBy(entry, a))]);
}

// Two plain allow-lists (null = everything): what both allow, in the managed list's order.
function intersectList(a, b) {
  if (a === null) return b === null ? null : [...b];
  if (b === null) return [...a];
  return b.filter((item) => a.includes(item));
}

const stricter = (x, y, rank) => {
  if (!x) return y || null;
  if (!y) return x;
  return (rank[y] ?? -1) > (rank[x] ?? -1) ? y : x;
};
const PII_RANK = Object.fromEntries(PII_MODES.map((mode, i) => [mode, i]));

/**
 * The stricter of two policies, setting by setting: allow-lists are intersected, block-lists joined, modes take the stricter one,
 * a switch that loosens (HR content, coaching, audit export) needs both, a switch that tightens (no page bar) needs either, and the
 * smaller daily budget wins; content an organisation publishes is joined (snippets, phrases, priority accounts), except its one
 * dashboard, where the managed side's wins. When the two pin different AI providers or addresses, or allow no model in common, `aiBlocked` says so
 * and no AI call is made; the managed side's value is kept so reading the result again finds the same disagreement.
 * @param {object} floorInput the compiled-in policy (enterprise build)
 * @param {object} managedInput the browser's managed policy
 */
export function mergePolicies(floorInput, managedInput) {
  const a = readPolicy(floorInput);
  const b = readPolicy(managedInput);
  const reasons = [a.aiBlocked, b.aiBlocked].filter(Boolean);
  const pinned = (key) => {
    if (a[key] && b[key] && a[key] !== b[key]) {
      reasons.push('Your organisation\'s policies name two different AI endpoints, so Agent Buddy sends nothing. Ask your administrator.');
      return b[key];
    }
    return b[key] || a[key] || null;
  };
  let allowedModels = a.allowedModels?.length ? a.allowedModels : b.allowedModels;
  if (a.allowedModels?.length && b.allowedModels?.length) {
    const common = b.allowedModels.filter((m) => a.allowedModels.includes(m));
    if (common.length) allowedModels = common;
    else {
      reasons.push('Your organisation\'s policies allow no AI model in common, so Agent Buddy sends nothing. Ask your administrator.');
      allowedModels = b.allowedModels;
    }
  }
  const budgets = [a.tokenBudgetPerDay, b.tokenBudgetPerDay].filter((n) => n > 0);
  return {
    allowedInstances: intersectInstances(a.allowedInstances, b.allowedInstances),
    aiProvider: pinned('aiProvider'),
    aiBaseUrl: pinned('aiBaseUrl'),
    // Nothing in common is an empty list, which allows no provider.
    allowedProviders: intersectList(a.allowedProviders, b.allowedProviders),
    allowedModels: allowedModels ? [...allowedModels] : null,
    piiMode: stricter(a.piiMode, b.piiMode, PII_RANK),
    previewMode: stricter(a.previewMode, b.previewMode, PREVIEW_RANK),
    keyStorage: stricter(a.keyStorage, b.keyStorage, KEY_STORAGE_RANK),
    // A compiled-in policy never holds a key (src/policy/enterprise.js refuses one), so this is the managed key when there is one.
    providedApiKey: b.providedApiKey || a.providedApiKey,
    disabledFeatures: unique([...a.disabledFeatures, ...b.disabledFeatures]),
    blockedTables: unique([...a.blockedTables, ...b.blockedTables]),
    blockedFields: unique([...a.blockedFields, ...b.blockedFields]),
    sensitiveTablePrefixes: unique([...a.sensitiveTablePrefixes, ...b.sensitiveTablePrefixes]),
    allowHrContent: a.allowHrContent && b.allowHrContent,
    tokenBudgetPerDay: budgets.length ? Math.min(...budgets) : 0,
    auditExport: a.auditExport && b.auditExport,
    coachingEnabled: a.coachingEnabled && b.coachingEnabled,
    disablePageBar: a.disablePageBar || b.disablePageBar,
    aiEnabled: a.aiEnabled && b.aiEnabled,
    disabledSections: unique([...a.disabledSections, ...b.disabledSections]),
    allowedProfiles: intersectList(a.allowedProfiles, b.allowedProfiles),
    // A profile set is not "stricter" than another: the managed side, when it locks profiles, decides.
    lockedProfiles: b.lockedProfiles ? [...b.lockedProfiles] : a.lockedProfiles ? [...a.lockedProfiles] : null,
    orgSnippets: readOrgSnippets([...a.orgSnippets, ...b.orgSnippets]),
    internalPhrases: unique([...a.internalPhrases, ...b.internalPhrases]),
    // A dashboard is not stricter or looser than another: the managed policy's, when it sets one, wins over the compiled-in one.
    defaultDashboard: parseOrgDashboard(b.defaultDashboard || a.defaultDashboard).layout,
    // Both lists name priority accounts; together they name all of them.
    priorityAccounts: readPriorityAccounts([...a.priorityAccounts, ...b.priorityAccounts]),
    aiBlocked: reasons[0] || '',
  };
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

// The compiled-in floor of an enterprise build, read once; null in the normal build.
const FLOOR = BAKED_POLICY ? deepFreeze(readPolicy(BAKED_POLICY)) : null;

/** The policy compiled into this build (enterprise builds only), already read; null otherwise. */
export const bakedPolicy = () => FLOOR;

/**
 * Clean whatever chrome.storage.managed returned. Unknown keys are dropped; a bad value becomes "not set" (null / []), never a
 * guess (see the header for the cases that do block). An empty policy is the normal case for a person who installed the extension
 * themselves. In an enterprise build the compiled-in policy is the floor.
 */
export function normalizePolicy(raw) {
  return FLOOR ? mergePolicies(FLOOR, raw) : readPolicy(raw);
}

// ---- What an administrator should hear about ---------------------------------------------------------------------------------

const KEY_TYPES = {
  allowedInstances: 'list',
  aiProvider: 'string',
  aiBaseUrl: 'string',
  allowedProviders: 'list',
  allowedModels: 'list',
  piiMode: 'string',
  previewMode: 'string',
  keyStorage: 'string',
  providedApiKey: 'string',
  disabledFeatures: 'list',
  blockedTables: 'list',
  blockedFields: 'list',
  sensitiveTablePrefixes: 'list',
  allowHrContent: 'boolean',
  tokenBudgetPerDay: 'integer',
  auditExport: 'boolean',
  coachingEnabled: 'boolean',
  disablePageBar: 'boolean',
  aiEnabled: 'boolean',
  disabledSections: 'list',
  allowedProfiles: 'list',
  lockedProfiles: 'list',
  orgSnippets: 'objects',
  internalPhrases: 'list',
  defaultDashboard: 'layout',
  priorityAccounts: 'list',
};
const NAME_RE = /^[a-z][a-z0-9_]{0,79}$/;
const FEATURE_RE = /^[a-z][a-z0-9-]{0,79}$/;
const shown = (value) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(typeof value);
  }
};

/**
 * Everything in a raw policy that Agent Buddy ignores, reads differently from how it is written, or that blocks AI calls.
 * `level: 'error'` means the value has no effect or stops Agent Buddy working; 'note' means it is read, just not as written.
 * Used by scripts/check-policy.js and the tests; never throws.
 * @param {object} raw the policy as the browser holds it
 * @param {{ providers?: string[] }} [options] providers: the provider ids this version knows (Object.keys(PROVIDERS) of
 *   src/providers/config.js). Passed in rather than imported, so the content script, which reads the policy too, does not carry the
 *   provider layer. Without it, provider names are not checked.
 *   checkDashboard: orgDashboardProblems of src/reports/dashboards.js, which checks the dashboard inside `defaultDashboard` (its
 *   sections, its name) with the reports code; passed in for the same reason. Without it, only the layout's envelope is checked.
 * @returns {{ key: string, level: 'error' | 'note', message: string }[]}
 */
export function policyProblems(raw, { providers, checkDashboard } = {}) {
  const knownProviders = Array.isArray(providers) && providers.length ? providers.map((id) => String(id).toLowerCase()) : null;
  const out = [];
  const error = (key, message) => out.push({ key, level: 'error', message });
  const note = (key, message) => out.push({ key, level: 'note', message });
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) error('', 'The policy must be an object of keys and values.');
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    const type = KEY_TYPES[key];
    if (!type) {
      const near = POLICY_KEYS.find((k) => k.toLowerCase() === key.trim().toLowerCase());
      error(key, `"${key}" is not a policy key and is ignored.${near ? ` Did you mean "${near}"?` : ''}`);
      continue;
    }
    if (type === 'list' && !Array.isArray(value)) {
      error(key, `${key} must be a list of text values; ${shown(value)} is ignored.`);
      continue;
    }
    if (type === 'boolean' && typeof value !== 'boolean') {
      error(key, `${key} must be true or false; ${shown(value)} is read as ${key === 'auditExport' || key === 'aiEnabled' ? 'true' : 'false'}.`);
      continue;
    }
    if (type === 'objects') {
      if (!Array.isArray(value)) {
        error(key, `${key} must be a list of { "title", "body" } objects; ${shown(value)} is ignored.`);
        continue;
      }
      value.forEach((item, i) => {
        if (!isPlainObject(item) || typeof item.title !== 'string' || !item.title.trim() || typeof item.body !== 'string' || !item.body.trim()) {
          error(key, `${key}[${i}] needs a text "title" and a text "body"; it is ignored.`);
        } else if (item.body.length > ORG_SNIPPET_LIMITS.body) note(key, `${key}[${i}]: the body is cut to ${ORG_SNIPPET_LIMITS.body} characters.`);
      });
      if (value.length > ORG_SNIPPET_LIMITS.count) note(key, `${key}: only the first ${ORG_SNIPPET_LIMITS.count} are used.`);
      continue;
    }
    if (type === 'layout') {
      const { layout, problem } = parseOrgDashboard(value);
      const shape = `{ "kind": "${LAYOUT_KIND}", "version": ${LAYOUT_VERSION}, "dashboard": { "name", "scope", "tables", "widgets" } }`;
      if (problem === 'newer') error(key, `${key} was saved by a newer version of Agent Buddy (this one reads version ${LAYOUT_VERSION}); it is ignored.`);
      else if (problem === 'too-big') error(key, `${key} is longer than ${LAYOUT_MAX_CHARS} characters; it is ignored.`);
      else if (problem) error(key, `${key} must be one dashboard layout as the Team screen's "Save layout as a file" writes it, ${shape}; ${shown(value).slice(0, 80)} is ignored.`);
      if (!layout) continue;
      if (typeof value === 'string') note(key, `${key} is text; it is read as the layout file's JSON.`);
      // Chrome's policy schema has no "null": a saved file says "tables": null for "every table", and the browser may refuse the key.
      else if (value.dashboard.tables === null) note(key, `${key}: "tables": null (every table) may be refused by the browser's policy check; leave "tables" out instead, which means the same.`);
      if (typeof checkDashboard === 'function') {
        for (const p of checkDashboard(layout) || []) (p.level === 'note' ? note : error)(key, `${key}: ${p.message}`);
      }
      continue;
    }
    if (type === 'integer' && !(typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
      error(key, `${key} must be a whole number of 0 or more; ${shown(value)} is read as ${budgetOf(value) || 'no budget'}.`);
      continue;
    }
    if (type === 'string' && typeof value !== 'string') {
      error(key, `${key} must be text; ${shown(value)} is ignored.`);
      continue;
    }
    if (type === 'list') {
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) error(key, `${key}[${i}]: ${shown(item)} is not a text value and is ignored.`);
      });
    }
    const allowed = { piiMode: PII_MODES, previewMode: PREVIEW_MODES, keyStorage: KEY_STORAGE_MODES }[key];
    if (allowed) {
      const read = oneOf(value, allowed);
      if (!read) error(key, `${key}: ${shown(value)} is not one of ${allowed.join(', ')}; it is ignored, as if the key were not set.`);
      else if (read !== value) note(key, `${key}: ${shown(value)} is read as "${read}".`);
    }
    if (key === 'aiProvider' && value.trim()) {
      const id = value.trim().toLowerCase();
      if (knownProviders && !knownProviders.includes(id)) error(key, `aiProvider: ${shown(value)} is not a provider Agent Buddy knows (${knownProviders.join(', ')}); every AI call is refused.`);
      else if (id !== value) note(key, `aiProvider: ${shown(value)} is read as "${id}".`);
    }
    if (key === 'allowedProviders') {
      if (!value.length) error(key, 'allowedProviders is an empty list, so no AI provider is allowed and every AI call is refused.');
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) return;
        const id = item.trim().toLowerCase();
        if (knownProviders && !knownProviders.includes(id)) error(key, `allowedProviders[${i}]: ${shown(item)} is not a provider Agent Buddy knows (${knownProviders.join(', ')}) and never matches.`);
        else if (id !== item) note(key, `allowedProviders[${i}]: ${shown(item)} is read as "${id}".`);
      });
    }
    if (key === 'aiBaseUrl' && value.trim()) {
      const endpoint = normalizeEndpoint(value);
      if (!endpoint.ok) error(key, `aiBaseUrl: ${shown(value)} is not valid (${endpoint.error}). Every AI call is refused until it is fixed.`);
      else if (endpoint.url !== value) note(key, `aiBaseUrl: ${shown(value)} is read as "${endpoint.url}".`);
    }
    if (key === 'allowedInstances') {
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) return;
        const read = normalizeAllowEntry(item);
        if (!read) error(key, `allowedInstances[${i}]: ${shown(item)} is not an https address or a "*.example.com" pattern (with at least two names after "*."); it is ignored.`);
        else if (read !== item) note(key, `allowedInstances[${i}]: ${shown(item)} is read as "${read}".`);
      });
      if (value.length && !list(value).map(normalizeAllowEntry).some(Boolean)) error(key, 'allowedInstances has no usable entry, so Agent Buddy cannot be turned on for any site.');
    }
    if (key === 'disabledFeatures' || key === 'blockedTables' || key === 'blockedFields') {
      const re = key === 'disabledFeatures' ? FEATURE_RE : NAME_RE;
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) return;
        const read = item.trim().toLowerCase();
        if (!re.test(read)) error(key, `${key}[${i}]: ${shown(item)} is not a ${key === 'disabledFeatures' ? 'feature id' : 'table or column name'} and can never match.`);
        else if (read !== item) note(key, `${key}[${i}]: ${shown(item)} is read as "${read}".`);
      });
    }
    if (key === 'disabledSections' || key === 'allowedProfiles' || key === 'lockedProfiles') {
      const known = key === 'disabledSections' ? HIDEABLE_SCREENS : PROFILE_IDS;
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) return;
        if (!known.includes(item.trim().toLowerCase())) error(key, `${key}[${i}]: ${shown(item)} is not one of ${known.join(', ')} and is ignored.`);
      });
    }
    if (key === 'sensitiveTablePrefixes') {
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !item.trim()) return;
        if (!PREFIX_RE.test(item.trim().toLowerCase())) error(key, `sensitiveTablePrefixes[${i}]: ${shown(item)} is not a table-name prefix (letters, digits and _; at least 2 characters) and is ignored.`);
      });
    }
    if (key === 'priorityAccounts') {
      value.forEach((item, i) => {
        if (typeof item === 'string' && item.trim().length > PRIORITY_ACCOUNT_LIMITS.length) error(key, `priorityAccounts[${i}] is longer than ${PRIORITY_ACCOUNT_LIMITS.length} characters and is ignored.`);
      });
      if (value.length > PRIORITY_ACCOUNT_LIMITS.count) note(key, `priorityAccounts: only the first ${PRIORITY_ACCOUNT_LIMITS.count} names are used.`);
    }
    if (key === 'providedApiKey' && value.trim()) note(key, 'providedApiKey: anyone who can read this computer\'s policy store can read this key. Prefer a gateway that authenticates people another way.');
  }
  const pins = (k) => typeof raw[k] === 'string' && Boolean(raw[k].trim());
  if (typeof raw.providedApiKey === 'string' && raw.providedApiKey.trim() && !pins('aiProvider') && !pins('aiBaseUrl')) {
    error('providedApiKey', 'providedApiKey is not used: the policy must also pin aiProvider or aiBaseUrl, because an organisation key must never be sent to whatever provider a person picks.');
  }
  if (pins('aiProvider') && Array.isArray(raw.allowedProviders) && !lowerList(raw.allowedProviders).includes(raw.aiProvider.trim().toLowerCase())) {
    error('allowedProviders', `allowedProviders does not include aiProvider ${shown(raw.aiProvider)}, so every AI call is refused.`);
  }
  if (raw.allowHrContent === true && !(typeof raw.aiProvider === 'string' && raw.aiProvider.trim()) && !(typeof raw.aiBaseUrl === 'string' && raw.aiBaseUrl.trim())) {
    note('allowHrContent', 'allowHrContent is true but the policy pins no AI endpoint (aiProvider or aiBaseUrl), so HR content is still only sent to a model on this computer.');
  }
  return out;
}

/** "https://acme.service-now.com/*": the match pattern Chrome asks permission for. */
export const instancePattern = (origin) => `${normalizeInstance(origin)}/*`;

/**
 * May the extension run on `origin`? With no allow-list in the policy, any instance the user enabled themselves is fine.
 * With one, only instances on it; entries can be an exact origin or "*.example.com" style. An allow-list that is not a list
 * allows nothing.
 */
export function isInstanceAllowed(origin, policy) {
  const o = normalizeInstance(origin);
  if (!o) return false;
  const allow = policy?.allowedInstances;
  if (allow === null || allow === undefined) return true;
  if (!Array.isArray(allow)) return false;
  const host = new URL(o).hostname;
  return allow.map(normalizeAllowEntry).some((entry) => {
    if (!entry) return false;
    if (entry === o) return true;
    // "*.corp.example.com" matches any sub-domain, but not corp.example.com itself or a look-alike suffix.
    return isWildcard(entry) && host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
  });
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** Is the feature switched on? Ids are compared in lower case on both sides (a policy set by hand may use capitals). */
export const isFeatureEnabled = (featureId, policy) => !lowerList(policy?.disabledFeatures).includes(norm(featureId));

/** True when the table may be read/sent at all under this policy. */
export const isTableAllowed = (table, policy) => !lowerList(policy?.blockedTables).includes(norm(table));

/**
 * Is this table in a sensitive (HR-family) family under this policy? `sn_hr_` always counts; the policy's
 * `sensitiveTablePrefixes` add to it. Without a policy only the default prefix applies.
 */
export function isSensitiveByPolicy(table, policy) {
  const name = norm(table);
  if (!name) return false;
  const prefixes = Array.isArray(policy?.sensitiveTablePrefixes) ? sensitivePrefixes(policy.sensitiveTablePrefixes) : DEFAULT_SENSITIVE_PREFIXES;
  return prefixes.some((prefix) => name.startsWith(prefix));
}

/** Does the policy let this provider/model/base URL through? Returns { ok, reason }. */
export function checkProviderAllowed({ provider, model, baseUrl }, policy) {
  if (policy?.aiBlocked) return { ok: false, reason: String(policy.aiBlocked) };
  const pinnedProvider = norm(policy?.aiProvider);
  if (pinnedProvider && norm(provider) !== pinnedProvider) {
    return { ok: false, reason: `Your organisation only allows the "${pinnedProvider}" AI provider.` };
  }
  // Provider ids are compared in lower case, and the list is not checked against the providers this version knows: a provider added
  // later (or one the organisation misspelt) simply matches nothing.
  if (Array.isArray(policy?.allowedProviders)) {
    const allowed = lowerList(policy.allowedProviders);
    if (!allowed.includes(norm(provider))) {
      return { ok: false, reason: allowed.length ? `Your organisation allows these AI providers only: ${allowed.join(', ')}.` : 'Your organisation allows no AI provider. Ask your administrator.' };
    }
  }
  if (policy?.aiBaseUrl) {
    // Both sides in canonical form: "https://GW.corp.example:443/v1/" in a policy is the address Settings calls https://gw.corp.example/v1.
    const want = normalizeEndpoint(policy.aiBaseUrl);
    const got = normalizeEndpoint(String(baseUrl || ''));
    if (!want.ok || !got.ok || want.url !== got.url) {
      return { ok: false, reason: 'Your organisation requires its own AI endpoint. Use the address set by your administrator.' };
    }
  }
  if (policy?.allowedModels && policy.allowedModels.length && !policy.allowedModels.includes(String(model ?? '').trim())) {
    return { ok: false, reason: `Your organisation allows these models only: ${policy.allowedModels.join(', ')}.` };
  }
  return { ok: true, reason: '' };
}

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'anthropic',
  models: {},
  modelLists: {}, // per provider: the model ids loaded from the server (Settings, "Load models"); only names, never content
  baseUrls: {},
  keyStorage: 'local',
  piiMode: 'standard',
  previewMode: 'first',
  previewSeen: [],
  instances: [],
  quickBarOpen: true, // the quick-actions bar in the side panel is open (false = folded to one strip)
  quickPins: {}, // per kind of record: the feature ids the person pinned to the bar (src/features/quick.js); {} = the defaults
  pageBar: true, // the small bar on the ServiceNow page itself (src/content/bar.js)
  // Work profiles (src/profiles): what the person works on decides which cards and actions show. [] until they confirm the suggestion.
  profiles: [],
  profilesConfirmed: false,
  showEverything: false, // every card and action, whatever the profiles say
  aiSkipped: false, // "Skip AI for now": AI Assist halves say how to set AI up instead of offering actions
  halves: {}, // per screen: 'insights' | 'assist', the half last chosen
  followUpDays: 3, // My work: a customer not updated (or not answering) for this many days is a follow-up due
});

/**
 * The settings the app actually uses: the user's choices with the policy applied on top.
 * @returns {{ values: object, locked: Record<string, string>, policy: object, floors: Record<string, string> }}
 *   `locked` maps a setting name to the reason it cannot be changed. `floors` maps a setting the policy only sets a minimum for
 *   (piiMode, previewMode) to that minimum: the person may still choose anything at or above it.
 */
export function effectiveSettings(user, policyInput) {
  const policy = normalizePolicy(policyInput);
  const values = { ...DEFAULT_SETTINGS, ...(isPlainObject(user) ? user : {}) };
  const locked = {};
  const floors = {};
  const lock = (key, why) => {
    locked[key] = why;
  };
  // A stored value that is not one of the known words (an old or hand-edited setting) means the default, never something unknown.
  if (!PII_MODES.includes(values.piiMode)) values.piiMode = DEFAULT_SETTINGS.piiMode;
  if (!PREVIEW_MODES.includes(values.previewMode)) values.previewMode = DEFAULT_SETTINGS.previewMode;
  if (!KEY_STORAGE_MODES.includes(values.keyStorage)) values.keyStorage = DEFAULT_SETTINGS.keyStorage;

  if (policy.piiMode) {
    // The policy is a floor: a stricter personal choice is kept.
    floors.piiMode = policy.piiMode;
    if (strictness(values.piiMode) < strictness(policy.piiMode)) values.piiMode = policy.piiMode;
    if (values.piiMode === policy.piiMode) lock('piiMode', 'Set by your organisation.');
  }
  if (policy.previewMode) {
    // Also a floor: a person may choose to see the outgoing text more often than the policy asks, never less often.
    floors.previewMode = policy.previewMode;
    if (PREVIEW_RANK[values.previewMode] < PREVIEW_RANK[policy.previewMode]) values.previewMode = policy.previewMode;
    if (values.previewMode === policy.previewMode) lock('previewMode', 'Set by your organisation.');
  }
  if (policy.keyStorage) {
    values.keyStorage = policy.keyStorage;
    lock('keyStorage', 'Set by your organisation.');
  }
  if (policy.aiProvider) {
    values.provider = policy.aiProvider;
    lock('provider', 'Set by your organisation.');
  } else if (policy.allowedProviders?.length && !policy.allowedProviders.includes(norm(values.provider))) {
    // A provider the organisation does not allow is replaced by the first one it does; the person may still pick among those.
    values.provider = policy.allowedProviders[0];
  }
  if (policy.aiBaseUrl) {
    values.baseUrls = { ...values.baseUrls, [values.provider]: policy.aiBaseUrl };
    lock('baseUrl', 'Set by your organisation.');
  }
  if (policy.allowedModels?.length && !policy.allowedModels.includes(values.models?.[values.provider])) {
    values.models = { ...values.models, [values.provider]: policy.allowedModels[0] };
    lock('model', `Allowed by your organisation: ${policy.allowedModels.join(', ')}.`);
  } else if (policy.allowedModels?.length) {
    lock('model', `Allowed by your organisation: ${policy.allowedModels.join(', ')}.`);
  }
  if (policy.allowedInstances) {
    values.instances = (Array.isArray(values.instances) ? values.instances : []).filter((o) => isInstanceAllowed(o, policy));
    lock('instances', 'Only instances approved by your organisation can be enabled.');
  }
  if (policy.disablePageBar) {
    values.pageBar = false;
    lock('pageBar', 'Switched off by your organisation.');
  }
  // Work profiles: only known ids; the HR profile only where the organisation has approved HR work in Agent Buddy (it names the
  // profile in allowedProfiles, or allows HR content); a policy's locked set replaces the person's choice.
  const hrApproved = Boolean(policy.allowedProfiles?.includes('hr') || policy.allowHrContent);
  let profiles = (Array.isArray(values.profiles) ? values.profiles : []).filter((id) => PROFILE_IDS.includes(id));
  if (policy.lockedProfiles) {
    profiles = [...policy.lockedProfiles];
    lock('profiles', 'Set by your organisation.');
  }
  if (policy.allowedProfiles) profiles = profiles.filter((id) => policy.allowedProfiles.includes(id));
  if (!hrApproved) profiles = profiles.filter((id) => id !== 'hr');
  values.profiles = unique(profiles);
  if (!policy.aiEnabled) lock('ai', 'Switched off by your organisation.');
  // A key supplied by the organisation wins, so people never have to handle one. It is used only when the same policy pins where it
  // goes (aiProvider or aiBaseUrl): an organisation key must never be sent to whatever provider the person picks.
  const keyUsable = Boolean(policy.providedApiKey && (policy.aiProvider || policy.aiBaseUrl));
  values.providedApiKey = keyUsable ? policy.providedApiKey : '';
  if (keyUsable) lock('apiKey', 'Supplied by your organisation.');

  return { values, locked, policy, floors };
}
