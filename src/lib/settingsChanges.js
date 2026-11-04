// Which storage changes the settings are read again for, by the Settings page (src/options/Options.jsx) and the side panel
// (src/sidepanel/useEffective.js). Both show the person's settings, the organisation's policy and the AI key (where it is kept, and
// whether it is there); nothing else. Everything else written to storage (the usage and activity logs on every AI call and insert,
// snippets, checklist ticks, saved dashboards, the bar's request...) changes none of that, and reading the settings, the policy and
// the key vault (IndexedDB) again for each of those is wasted work.
import { SETTINGS_KEY } from './storage.js';
import { KEY_CHANGED_KEY, KEY_SLOT_PREFIX } from './keyStore.js';

/** True when a chrome.storage.onChanged event (`changes`, `areaName`) can change the settings, the policy or the key. */
export function settingsChangeMatters(changes, areaName) {
  const keys = Object.keys(changes || {});
  // The organisation's policy: any change to it.
  if (areaName === 'managed') return true;
  // The settings, and the stamp the key store changes with the vault (IndexedDB fires no storage event of its own).
  if (areaName === 'local') return keys.some((k) => k === SETTINGS_KEY || k === KEY_CHANGED_KEY);
  // A key kept in memory (memory only, or an encrypted key unlocked for this browser session): no stamp is changed for that.
  if (areaName === 'session') return keys.some((k) => k.startsWith(KEY_SLOT_PREFIX));
  return false;
}
