// Everything Agent Buddy keeps in the browser, in one list, and the one function that removes all of it. Pure: the storage areas are
// passed in (chrome.storage.local, chrome.storage.session and the key vault in Settings, fakes in tests/insert-stored-data.test.js).
//
// What is kept is configuration and counts, never ticket content (build rule 7), with one named exception: the record ids, tables and
// times of the tickets opened in the panel, for "since you last looked" (src/lib/lastViewed.js; no number, title, text or names). The
// list is what Settings shows under "Stored data", so a security reviewer can see it in one place; a test fails when a key appears in
// the code that is not described here.

import { tm } from '../i18n/index.js';
import { LAST_VIEWED_KEY, countLastViewed } from './lastViewed.js';

export const KEY_PREFIX = 'agentbuddy_';

/**
 * area: where it lives. 'local' stays until removed; 'session' is memory only and goes when the browser closes; 'vault' is Agent
 * Buddy's own database in this browser (IndexedDB of the extension), which ServiceNow pages and Agent Buddy's page scripts cannot open.
 * keys: exact key names; prefixes: key families (one key per provider, say).
 * title and detail are English texts marked with tm(); the Settings page shows them in the language of the page.
 */
export const STORED_DATA = Object.freeze([
  { id: 'settings', title: tm('Settings'), detail: tm('Your choices: AI provider and model, privacy mode, which ServiceNow sites you turned on.'), area: 'local', keys: ['agentbuddy_settings'] },
  {
    id: 'key',
    title: tm('AI key'),
    detail: tm(
      "The key you saved, one per provider, the way you chose: in Agent Buddy's own storage in this browser, in memory only, or encrypted with your passphrase. ServiceNow pages cannot read it. Also a time stamp of the last change, which holds nothing about the key."
    ),
    area: 'vault and session',
    keys: ['agentbuddy_keyvault_stamp', 'agentbuddy_vault'],
    prefixes: ['agentbuddy_key_', 'agentbuddy_keyenc_'],
  },
  { id: 'snippets', title: tm('Snippets'), detail: tm('The reply templates you wrote.'), area: 'local', keys: ['agentbuddy_snippets'] },
  { id: 'usage', title: tm('AI usage log'), detail: tm('How many calls and tokens each AI request used, and the prices and limits you entered. No text.'), area: 'local', keys: ['agentbuddy_ai_usage', 'agentbuddy_ai_prices', 'agentbuddy_ai_caps'] },
  { id: 'audit', title: tm('Activity log'), detail: tm('What Agent Buddy did: action, table, number of masked items, outcome. A salted code for the record, never its text. Also the random salt itself.'), area: 'local', keys: ['agentbuddy_audit', 'agentbuddy_audit_salt'] },
  { id: 'checklist', title: tm('Checklist ticks'), detail: tm('Which steps you ticked on a task, under a salted code for the record and encrypted. Memory only: gone when the browser closes.'), area: 'session', keys: ['agentbuddy_checklists'] },
  { id: 'dashboards', title: tm('Saved dashboards'), detail: tm('The settings of dashboards you saved (what to count, how to group it). No ticket data.'), area: 'local', keys: ['agentbuddy_dashboards'] },
  // "Since you last looked" (src/lib/lastViewed.js): the one exception to "no ticket content" (docs/build-rules.md rule 7). Settings
  // shows how many (lastViewedCount below); the organisation can turn it off (policy rememberLastViewed).
  {
    id: 'lastViewed',
    title: tm('Tickets you opened'),
    detail: tm('When you last opened each ticket in the panel, so it can say what is new since then: the record id, its table and the time, never its number, title, text or names. At most 500 tickets, none older than 30 days.'),
    area: 'local',
    keys: ['agentbuddy_last_viewed'],
  },
]);

export const AREAS = Object.freeze(['local', 'session', 'vault and session']);

const ownsKey = (item, key) => (item.keys || []).includes(key) || (item.prefixes || []).some((p) => key.startsWith(p));

/** The inventory item a storage key belongs to, or null (a key nobody described). */
export const describeKey = (key) => STORED_DATA.find((item) => ownsKey(item, key)) || null;

/**
 * The inventory with a `present` flag for each item, from the keys found in each area. For the Settings list.
 * @param {string[]} localKeys
 * @param {string[]} sessionKeys
 * @param {string[]} vaultKeys
 * @param {{ counts?: Record<string, number> }} [options] counts: how many an item holds, by item id (storedCounts), shown with it
 */
export function summarizeStored(localKeys = [], sessionKeys = [], vaultKeys = [], { counts = {} } = {}) {
  const keys = [...localKeys, ...sessionKeys, ...vaultKeys].filter((k) => typeof k === 'string' && k.startsWith(KEY_PREFIX) && k !== 'agentbuddy_keyvault_stamp');
  return STORED_DATA.map((item) => {
    const present = keys.some((k) => ownsKey(item, k));
    const count = Object.prototype.hasOwnProperty.call(counts || {}, item.id) && Number.isFinite(counts[item.id]) ? counts[item.id] : null;
    return count === null ? { ...item, present } : { ...item, present: present && count > 0, count };
  });
}

/**
 * The counts Settings shows next to an item, from the values in chrome.storage.local: { lastViewed: number of tickets remembered }.
 * Only what can be counted without reading anything but the item's own key. Pure.
 */
export function storedCounts(localValues = {}, now = Date.now()) {
  const values = localValues && typeof localValues === 'object' ? localValues : {};
  return { lastViewed: countLastViewed(values[LAST_VIEWED_KEY], now) };
}

/**
 * Remove every `agentbuddy_*` key from the given areas. Keys that do not start with the prefix are never touched.
 * @param {{ local?: { get: Function, remove: Function }, session?: { get: Function, remove: Function }, vault?: { get: Function, remove: Function } | null }} areas
 * @param {{ keep?: string[] }} [options] keep: exact keys to leave in place (the usage log while the organisation sets a daily
 *   token budget: it is what the budget is counted from, so clearing it must not reset the count). Kept keys are not "remaining".
 * @returns {Promise<{ removed: { local: number, session: number, vault: number }, remaining: string[], kept: string[] }>} remaining: keys still there afterwards (empty when it worked)
 */
export async function clearAllStored({ local, session, vault } = {}, { keep = [] } = {}) {
  const removed = { local: 0, session: 0, vault: 0 };
  const remaining = [];
  const kept = [];
  const ours = (k) => k.startsWith(KEY_PREFIX);
  // The areas are separate stores and are cleared together; within one, the second read is what the removal left behind.
  const clearArea = async ([name, area]) => {
    const all = Object.keys((await area.get(null)) || {}).filter(ours);
    const found = all.filter((k) => !keep.includes(k));
    if (found.length) await area.remove(found);
    const left = Object.keys((await area.get(null)) || {}).filter((k) => ours(k) && !keep.includes(k));
    return { name, kept: all.filter((k) => keep.includes(k)), removed: found.length, left };
  };
  const areas = [['local', local], ['session', session], ['vault', vault]].filter(([, area]) => area);
  for (const done of await Promise.all(areas.map(clearArea))) {
    kept.push(...done.kept.map((k) => `${done.name}:${k}`));
    removed[done.name] = done.removed;
    remaining.push(...done.left.map((k) => `${done.name}:${k}`));
  }
  if (!vault) delete removed.vault;
  return kept.length ? { removed, remaining, kept } : { removed, remaining };
}
