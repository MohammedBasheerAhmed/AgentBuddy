import { CHECKLIST_KEY, createChecklistStore } from '../../checks/checklistStore.js';
import { auditSalt } from '../../lib/storage.js';

// A stand-in for chrome.storage.session when a browser does not offer it: the ticks then live as long as this panel does.
const memory = new Map();
const memoryArea = {
  get: async (key) => (memory.has(key) ? { [key]: memory.get(key) } : {}),
  set: async (obj) => Object.entries(obj).forEach(([k, v]) => memory.set(k, v)),
};

let legacyForgotten = false;

/**
 * Earlier versions kept the ticks in chrome.storage.local under the raw record id, with no end date. Delete that copy the first
 * time the checklist is used. (The ticks are a convenience: losing the old ones costs a re-tick, nothing else.)
 */
function forgetLegacy() {
  if (legacyForgotten) return;
  legacyForgotten = true;
  try {
    chrome.storage.local.remove(CHECKLIST_KEY).catch(() => {});
  } catch {
    /* no storage: nothing to forget */
  }
}

/**
 * The checklist store on the browser's session storage (memory only, cleared when the browser closes), keyed by the salted record
 * hash the audit log uses, with a lock so two panels or tabs never undo each other's ticks.
 */
export function panelChecklistStore() {
  forgetLegacy();
  const lock = typeof navigator !== 'undefined' && navigator.locks ? (fn) => navigator.locks.request('agentbuddy-checklists', fn) : undefined;
  const area = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session ? chrome.storage.session : memoryArea;
  return createChecklistStore({ storage: area, salt: auditSalt, lock });
}
