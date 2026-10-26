// Thin wrappers over chrome.storage for settings, the managed policy and the logs. Only extension pages call these.
// Everything fails soft where it can: a storage problem must not stop the panel from opening.
import { DEFAULT_SETTINGS, effectiveSettings, normalizePolicy } from '../policy/policy.js';
import { AUDIT_KEY, AUDIT_SALT_KEY, appendAudit, makeAuditEntry, hashRecordId } from '../audit/auditLog.js';
import { createKeyStore } from './keyStore.js';

export const SETTINGS_KEY = 'agentbuddy_settings';
export const SNIPPETS_KEY = 'agentbuddy_snippets';

const hasChrome = () => typeof chrome !== 'undefined' && Boolean(chrome.storage);

export async function loadSettings() {
  if (!hasChrome()) return { ...DEFAULT_SETTINGS };
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

// Two saves at once (the address and the model typed in quick succession, or the settings page and the service worker) are
// read-modify-write: without a lock the second would start from the old settings and silently undo the first.
const withSettingsLock = (fn) => (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('agentbuddy-settings', fn) : fn());

export function saveSettings(patch) {
  return withSettingsLock(async () => {
    const next = { ...(await loadSettings()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}

/** The organisation's policy from chrome.storage.managed, normalised. An empty policy is the normal case. */
export async function loadPolicy() {
  try {
    if (!hasChrome() || !chrome.storage.managed) return normalizePolicy({});
    return normalizePolicy(await chrome.storage.managed.get(null));
  } catch {
    // The managed area throws when no policy is installed on some browsers.
    return normalizePolicy({});
  }
}

/** { values, locked, policy } for the app to use. */
export async function loadEffective() {
  const [settings, policy] = await Promise.all([loadSettings(), loadPolicy()]);
  return effectiveSettings(settings, policy);
}

export const keyStore = () => createKeyStore({ local: chrome.storage.local, session: chrome.storage.session });

// ---- audit log: no content, salted record hash -------------------------------------------------------------------

const withLock = (fn) => (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('agentbuddy-audit', fn) : fn());

async function auditSalt() {
  const stored = (await chrome.storage.local.get(AUDIT_SALT_KEY))[AUDIT_SALT_KEY];
  if (stored) return stored;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await chrome.storage.local.set({ [AUDIT_SALT_KEY]: salt });
  return salt;
}

/** Record one event. Never throws: the audit trail must not break the feature it describes. */
export async function logAudit(event) {
  try {
    if (!hasChrome()) return;
    const recordHash = event.sysId ? await hashRecordId(event.sysId, await auditSalt()) : event.recordHash || '';
    const entry = makeAuditEntry({ ...event, recordHash });
    await withLock(async () => {
      const log = (await chrome.storage.local.get(AUDIT_KEY))[AUDIT_KEY];
      await chrome.storage.local.set({ [AUDIT_KEY]: appendAudit(log, entry) });
    });
  } catch {
    /* fail soft */
  }
}

export async function readAudit() {
  if (!hasChrome()) return [];
  const log = (await chrome.storage.local.get(AUDIT_KEY))[AUDIT_KEY];
  return Array.isArray(log) ? log : [];
}

export async function clearAudit() {
  await chrome.storage.local.remove(AUDIT_KEY);
}
