// What the Settings page says about limits and the organisation's policy. Pure (no chrome.*, no React), so it is unit-tested
// (tests/options-notes.test.js).
import { FEATURES } from '../features/registry.js';
import { effectiveDailyTokenCap, isAzureDeployment } from '../lib/aiUsage.js';

// Ids that `disabledFeatures` switches off but that are not features in the registry: 'reports' hides the whole Team section
// (src/sidepanel/reports/ReportsDashboard.jsx). Add an id here when code checks isFeatureEnabled() with a name of its own.
export const EXTRA_FEATURE_IDS = Object.freeze(['reports']);

/** Every id `disabledFeatures` can name, in lower case (the policy compares in lower case). */
export const knownFeatureIds = (features = FEATURES) => new Set([...features.map((f) => String(f.id).toLowerCase()), ...EXTRA_FEATURE_IDS]);

/**
 * The ids in the policy's disabledFeatures that match no feature (a typo, or a feature of another version), once each, as the
 * policy reads them (trimmed, lower case). An administrator sees these in Settings: a misspelt id switches nothing off.
 */
export function unknownDisabledFeatures(disabled, known = knownFeatureIds()) {
  const out = [];
  for (const raw of Array.isArray(disabled) ? disabled : []) {
    const id = String(raw ?? '').trim().toLowerCase();
    if (id && !known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

const n = (value) => Math.round(value).toLocaleString('en-US');

/**
 * The daily token limit that applies and where it comes from: the smaller of the organisation's (policy tokenBudgetPerDay) and the
 * person's own (Settings). `usedToday` is from the usage log on this computer.
 * @returns {{ limit: number, source: 'none' | 'policy' | 'own', left: number | null, text: string }}
 */
export function dailyTokenLimit({ policyBudget = 0, ownCap = 0, usedToday = 0 } = {}) {
  const org = Number(policyBudget) > 0 ? Math.floor(Number(policyBudget)) : 0;
  const own = Number(ownCap) > 0 ? Math.floor(Number(ownCap)) : 0;
  const limit = effectiveDailyTokenCap(org, own);
  const used = Math.max(0, Number(usedToday) || 0);
  if (!limit) return { limit: 0, source: 'none', left: null, text: 'No daily token limit applies.' };
  // When both are the same, the organisation's is the one that cannot be changed here, so it is named.
  const source = org && org <= (own || Infinity) ? 'policy' : 'own';
  const left = Math.max(0, limit - used);
  const other =
    source === 'policy' && own ? ` Your own limit (${n(own)}) is higher, so your organisation's applies.` : source === 'own' && org ? ` Your organisation allows up to ${n(org)}.` : '';
  const who = source === 'policy' ? "Your organisation's limit" : 'Your own limit';
  return { limit, source, left, text: `${who} applies: ${n(limit)} tokens a day.${other} Used today: ${n(used)}, ${n(left)} left.` };
}

/**
 * A limit typed by the person: '' or 0 is "no limit", otherwise a whole number of 1 or more.
 * @returns {{ ok: boolean, value: number, error?: string }}
 */
export function parseLimit(text) {
  const raw = String(text ?? '').trim().replace(/[\s,_]/g, '');
  if (!raw) return { ok: true, value: 0 };
  if (!/^\d{1,12}$/.test(raw)) return { ok: false, value: 0, error: 'Enter a whole number, or leave it empty for no limit.' };
  return { ok: true, value: Number(raw) };
}

/**
 * The deployment names typed in "Other deployments" (comma, space or line separated). Returns the valid names, once each, and the
 * ones Azure would not accept.
 */
export function parseDeployments(text) {
  const ids = [];
  const bad = [];
  for (const part of String(text ?? '').split(/[\s,;]+/)) {
    const id = part.trim();
    if (!id) continue;
    if (!isAzureDeployment(id)) bad.push(id.slice(0, 40));
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids: ids.slice(0, 50), bad };
}

// ---- Policy floors: the person may choose stricter, never looser ---------------------------------------------------------------

// Strictness, stricter later: the same order src/policy/policy.js uses to raise a choice to the floor (PII_MODES; PREVIEW_RANK).
// tests/options-settings.test.js checks the two agree through effectiveSettings().
const PII_ORDER = ['standard', 'strict', 'local-only'];
const PREVIEW_ORDER = ['never', 'first', 'always'];

/** Is `mode` looser than the organisation's floor for this setting ('piiMode' or 'previewMode')? No floor: never. */
export function looserThanFloor(setting, mode, floor) {
  if (!floor) return false;
  const order = setting === 'piiMode' ? PII_ORDER : setting === 'previewMode' ? PREVIEW_ORDER : null;
  if (!order || !order.includes(floor)) return false;
  return order.indexOf(mode) < order.indexOf(floor);
}

// ---- Providers the organisation allows -------------------------------------------------------------------------------------------

/**
 * The provider ids to offer: all of `ids`, or only those in the policy's allowedProviders (compared in lower case) when it is a list.
 * An id in the list that this version does not know is simply not offered.
 */
export function allowedProviderIds(ids, policy) {
  if (!Array.isArray(policy?.allowedProviders)) return [...ids];
  const allowed = policy.allowedProviders.map((id) => String(id ?? '').trim().toLowerCase());
  return ids.filter((id) => allowed.includes(id));
}

// ---- Host access: asked for site by site, or granted when the extension was installed -----------------------------------------

/**
 * 'granted' for a build that was given its hosts when it was installed (the enterprise build: fixed host_permissions and no optional
 * ones, so the browser never asks), 'prompt' for the normal build (optional hosts: the browser asks for each site the first time).
 */
export function hostAccessMode(manifest) {
  const optional = Array.isArray(manifest?.optional_host_permissions) ? manifest.optional_host_permissions : [];
  const fixed = Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : [];
  return !optional.length && fixed.length ? 'granted' : 'prompt';
}
