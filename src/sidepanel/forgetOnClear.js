import { useEffect } from 'react';
import { SETTINGS_KEY } from '../lib/storage.js';
import { AUDIT_SALT_KEY } from '../audit/auditLog.js';
import { forgetAnswers } from './ticket/assist/answers/session.js';
import { insightStore } from './ticket/cards/useInsight.js';
import { forgetInserts } from './insertFlow.js';

// What the panel holds in memory about tickets goes when the person clears their data in Settings ("Clear everything stored by
// Agent Buddy") or turns a ServiceNow site off: the Ticket screen's answers and runs (real names put back), the Insights cards' reads
// and the text last put into each box. All of it is memory only (build rule 7), but someone who just removed everything, or turned
// a site off, expects it gone now, not when the panel closes.
//
// The panel learns both from chrome.storage, whichever page did it: "Clear everything" removes every agentbuddy_* key, the settings
// and the activity log's salt among them (src/lib/storedData.js; only it removes those two), and turning a site off saves the
// settings without that site (src/background/service-worker.js disableInstance).

const CLEARED_ONLY_BY_EVERYTHING = [SETTINGS_KEY, AUDIT_SALT_KEY];

const sitesOf = (settings) => (Array.isArray(settings?.instances) ? settings.instances.filter((o) => typeof o === 'string') : []);

/** Does this chrome.storage change mean the panel must forget: everything was cleared, or a site was turned off? Pure. */
export function forgetsPanelMemory(changes, areaName) {
  if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
  const removed = (key) => Object.prototype.hasOwnProperty.call(changes, key) && changes[key]?.newValue === undefined;
  if (CLEARED_ONLY_BY_EVERYTHING.some(removed)) return true;
  const settings = changes[SETTINGS_KEY];
  if (!settings) return false;
  const now = new Set(sitesOf(settings.newValue));
  return sitesOf(settings.oldValue).some((origin) => !now.has(origin));
}

/** Forget every answer and run, the cards' reads and what was inserted where. */
export function forgetPanelMemory() {
  forgetAnswers();
  insightStore.clear();
  forgetInserts();
}

/**
 * Listen to `storage.onChanged` (chrome.storage) and forget when forgetsPanelMemory says so. Returns the function that stops it.
 * `forget` is for tests.
 */
export function watchForClears(storage, forget = forgetPanelMemory) {
  const onChanged = storage?.onChanged;
  if (!onChanged || typeof onChanged.addListener !== 'function') return () => {};
  const listener = (changes, areaName) => {
    if (forgetsPanelMemory(changes, areaName)) forget();
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

/** The panel's one place for it (src/sidepanel/App.jsx): listening for as long as the panel is open. */
export function useForgetOnClear() {
  useEffect(() => watchForClears(typeof chrome !== 'undefined' ? chrome.storage : null), []);
}
