import { createChecklistStore } from '../../checks/checklistStore.js';

/** The checklist store on the real chrome.storage.local, with a lock so two panels or tabs never undo each other's ticks. */
export function panelChecklistStore() {
  const lock = typeof navigator !== 'undefined' && navigator.locks ? (fn) => navigator.locks.request('agentbuddy-checklists', fn) : undefined;
  return createChecklistStore({ storage: chrome.storage.local, lock });
}
