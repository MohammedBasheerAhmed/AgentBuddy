// Everything Agent Buddy keeps in the browser, in one list, and the one function that removes all of it. Pure: the storage areas are
// passed in (chrome.storage.local, chrome.storage.session and the key vault in Settings, fakes in tests/insert-stored-data.test.js).
//
// What is kept is configuration and counts, never ticket content (build rule 7). The list is what Settings shows under
// "Stored data", so a security reviewer can see it in one place; a test fails when a key appears in the code that is not described here.

import { tm } from '../i18n/index.js';

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
 */
export function summarizeStored(localKeys = [], sessionKeys = [], vaultKeys = []) {
  const keys = [...localKeys, ...sessionKeys, ...vaultKeys].filter((k) => typeof k === 'string' && k.startsWith(KEY_PREFIX) && k !== 'agentbuddy_keyvault_stamp');
  return STORED_DATA.map((item) => ({ ...item, present: keys.some((k) => ownsKey(item, k)) }));
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
  for (const [name, area] of [['local', local], ['session', session], ['vault', vault]]) {
    if (!area) continue;
    const all = Object.keys((await area.get(null)) || {}).filter(ours);
    kept.push(...all.filter((k) => keep.includes(k)).map((k) => `${name}:${k}`));
    const found = all.filter((k) => !keep.includes(k));
    if (found.length) await area.remove(found);
    removed[name] = found.length;
    const left = Object.keys((await area.get(null)) || {}).filter((k) => ours(k) && !keep.includes(k));
    remaining.push(...left.map((k) => `${name}:${k}`));
  }
  if (!vault) delete removed.vault;
  return kept.length ? { removed, remaining, kept } : { removed, remaining };
}
