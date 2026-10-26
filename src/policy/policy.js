// Managed policy: what an organisation's IT/security team can pin through Chrome/Edge enterprise policy
// (chrome.storage.managed, schema in managed_schema.json). Pure functions, no chrome.* here, so every rule is unit-tested
// (tests/policy.test.js). The panel loads the raw policy and calls effectiveSettings() to combine it with the user's own
// choices: a policy can tighten things and lock them, a user can never loosen what a policy sets.

export const PII_MODES = ['standard', 'strict', 'local-only'];
export const PREVIEW_MODES = ['always', 'first', 'never'];
export const KEY_STORAGE_MODES = ['local', 'session', 'encrypted'];

// Stricter is later in the list. A user choice below the policy floor is raised to it.
const strictness = (mode) => Math.max(0, PII_MODES.indexOf(mode));

const list = (value) => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);

/**
 * Clean whatever chrome.storage.managed returned. Unknown keys are dropped; a bad value becomes "not set" (null / []),
 * never a guess. An empty policy is the normal case for a person who installed the extension themselves.
 */
export function normalizePolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const budget = Number(p.tokenBudgetPerDay);
  return {
    allowedInstances: Array.isArray(p.allowedInstances) ? list(p.allowedInstances).map(normalizeAllowEntry).filter(Boolean) : null,
    aiProvider: typeof p.aiProvider === 'string' && p.aiProvider.trim() ? p.aiProvider.trim() : null,
    aiBaseUrl: typeof p.aiBaseUrl === 'string' && p.aiBaseUrl.trim() ? p.aiBaseUrl.trim() : null,
    allowedModels: Array.isArray(p.allowedModels) ? list(p.allowedModels) : null,
    piiMode: oneOf(p.piiMode, PII_MODES),
    previewMode: oneOf(p.previewMode, PREVIEW_MODES),
    keyStorage: oneOf(p.keyStorage, KEY_STORAGE_MODES),
    providedApiKey: typeof p.providedApiKey === 'string' ? p.providedApiKey.trim() : '',
    disabledFeatures: list(p.disabledFeatures),
    blockedTables: list(p.blockedTables).map((t) => t.toLowerCase()),
    blockedFields: list(p.blockedFields).map((f) => f.toLowerCase()),
    allowHrContent: p.allowHrContent === true,
    tokenBudgetPerDay: Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0,
    auditExport: p.auditExport !== false,
    coachingEnabled: p.coachingEnabled === true,
  };
}

/** "https://acme.service-now.com" from a URL or bare host; '' when it is not an https host. */
export function normalizeInstance(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:') return '';
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

// One allow-list entry: a full origin ("https://acme.service-now.com") or a wildcard host ("*.corp.example.com").
function normalizeAllowEntry(entry) {
  const text = String(entry || '').trim().toLowerCase();
  if (/^\*\.[a-z0-9.-]+$/.test(text)) return text;
  return normalizeInstance(text);
}

/** Origin pattern Chrome asks permission for. */
export const instancePattern = (origin) => `${normalizeInstance(origin)}/*`;

/**
 * May the extension run on `origin`? With no allow-list in the policy, any instance the user enabled themselves is fine.
 * With one, only instances on it; entries can be an exact origin or "*.example.com" style.
 */
export function isInstanceAllowed(origin, policy) {
  const o = normalizeInstance(origin);
  if (!o) return false;
  const allow = policy?.allowedInstances;
  if (!allow) return true;
  const host = new URL(o).hostname;
  return allow.some((entry) => {
    if (entry === o) return true;
    // "*.corp.example.com" matches any sub-domain, but not corp.example.com itself or a look-alike suffix.
    return entry.startsWith('*.') && host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
  });
}

export const isFeatureEnabled = (featureId, policy) => !list(policy?.disabledFeatures).includes(featureId);

/** True when the table may be read/sent at all under this policy. */
export const isTableAllowed = (table, policy) => !list(policy?.blockedTables).includes(String(table || '').toLowerCase());

/** Does the policy let this provider/model/base URL through? Returns { ok, reason }. */
export function checkProviderAllowed({ provider, model, baseUrl }, policy) {
  if (policy?.aiProvider && provider !== policy.aiProvider) {
    return { ok: false, reason: `Your organisation only allows the "${policy.aiProvider}" AI provider.` };
  }
  if (policy?.aiBaseUrl && String(baseUrl || '').replace(/\/+$/, '') !== policy.aiBaseUrl.replace(/\/+$/, '')) {
    return { ok: false, reason: 'Your organisation requires its own AI endpoint. Use the address set by your administrator.' };
  }
  if (policy?.allowedModels && policy.allowedModels.length && !policy.allowedModels.includes(model)) {
    return { ok: false, reason: `Your organisation allows these models only: ${policy.allowedModels.join(', ')}.` };
  }
  return { ok: true, reason: '' };
}

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'anthropic',
  models: {},
  baseUrls: {},
  keyStorage: 'local',
  piiMode: 'standard',
  previewMode: 'first',
  previewSeen: [],
  instances: [],
  autoSignature: false,
});

/**
 * The settings the app actually uses: the user's choices with the policy applied on top.
 * @returns {{ values: object, locked: Record<string, string> }} `locked` maps a setting name to the reason it cannot be changed.
 */
export function effectiveSettings(user, policyInput) {
  const policy = normalizePolicy(policyInput);
  const values = { ...DEFAULT_SETTINGS, ...(user && typeof user === 'object' ? user : {}) };
  const locked = {};
  const lock = (key, why) => {
    locked[key] = why;
  };

  if (policy.piiMode) {
    // The policy is a floor: a stricter personal choice is kept.
    if (strictness(values.piiMode) < strictness(policy.piiMode)) values.piiMode = policy.piiMode;
    if (values.piiMode === policy.piiMode) lock('piiMode', 'Set by your organisation.');
  }
  if (policy.previewMode) {
    values.previewMode = policy.previewMode;
    lock('previewMode', 'Set by your organisation.');
  }
  if (policy.keyStorage) {
    values.keyStorage = policy.keyStorage;
    lock('keyStorage', 'Set by your organisation.');
  }
  if (policy.aiProvider) {
    values.provider = policy.aiProvider;
    lock('provider', 'Set by your organisation.');
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
    values.instances = (values.instances || []).filter((o) => isInstanceAllowed(o, policy));
    lock('instances', 'Only instances approved by your organisation can be enabled.');
  }
  // A key supplied by the organisation wins, so people never have to handle one.
  values.providedApiKey = policy.providedApiKey;
  if (policy.providedApiKey) lock('apiKey', 'Supplied by your organisation.');

  return { values, locked, policy };
}
