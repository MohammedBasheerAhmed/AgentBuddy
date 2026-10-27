// Everything Agent Buddy keeps in the browser, in one list, and the one function that removes all of it. Pure: the storage areas are
// passed in (chrome.storage.local and chrome.storage.session in Settings, fakes in tests/insert-stored-data.test.js).
//
// What is kept is configuration and counts, never ticket content (build rule 7). The list is what Settings shows under
// "Stored data", so a security reviewer can see it in one place; a test fails when a key appears in the code that is not described here.

export const KEY_PREFIX = 'agentbuddy_';

/**
 * area: where it lives. 'local' stays until removed; 'session' is memory only and goes when the browser closes.
 * keys: exact key names; prefixes: key families (one key per provider, say).
 */
export const STORED_DATA = Object.freeze([
  { id: 'settings', title: 'Settings', detail: 'Your choices: AI provider and model, privacy mode, which ServiceNow sites you turned on.', area: 'local', keys: ['agentbuddy_settings'] },
  { id: 'key', title: 'AI key', detail: 'The key you saved, one per provider, the way you chose: in this browser, in memory only, or encrypted with your passphrase.', area: 'local and session', prefixes: ['agentbuddy_key_', 'agentbuddy_keyenc_'] },
  { id: 'snippets', title: 'Snippets', detail: 'The reply templates you wrote.', area: 'local', keys: ['agentbuddy_snippets'] },
  { id: 'usage', title: 'AI usage log', detail: 'How many calls and tokens each AI request used, and the prices and limits you entered. No text.', area: 'local', keys: ['agentbuddy_ai_usage', 'agentbuddy_ai_prices', 'agentbuddy_ai_caps'] },
  { id: 'audit', title: 'Activity log', detail: 'What Agent Buddy did: action, table, number of masked items, outcome. A salted code for the record, never its text. Also the random salt itself.', area: 'local', keys: ['agentbuddy_audit', 'agentbuddy_audit_salt'] },
  { id: 'checklist', title: 'Checklist ticks', detail: 'Which steps you ticked on a task, under a salted code for the record and encrypted. Memory only: gone when the browser closes.', area: 'session', keys: ['agentbuddy_checklists'] },
  { id: 'dashboards', title: 'Saved dashboards', detail: 'The settings of dashboards you saved (what to count, how to group it). No ticket data.', area: 'local', keys: ['agentbuddy_dashboards'] },
]);

const ownsKey = (item, key) => (item.keys || []).includes(key) || (item.prefixes || []).some((p) => key.startsWith(p));

/** The inventory item a storage key belongs to, or null (a key nobody described). */
export const describeKey = (key) => STORED_DATA.find((item) => ownsKey(item, key)) || null;

/**
 * The inventory with a `present` flag for each item, from the keys found in each area. For the Settings list.
 * @param {string[]} localKeys
 * @param {string[]} sessionKeys
 */
export function summarizeStored(localKeys = [], sessionKeys = []) {
  const keys = [...localKeys, ...sessionKeys].filter((k) => typeof k === 'string' && k.startsWith(KEY_PREFIX));
  return STORED_DATA.map((item) => ({ ...item, present: keys.some((k) => ownsKey(item, k)) }));
}

/**
 * Remove every `agentbuddy_*` key from the given areas. Keys that do not start with the prefix are never touched.
 * @param {{ local?: { get: Function, remove: Function }, session?: { get: Function, remove: Function } }} areas
 * @returns {Promise<{ removed: { local: number, session: number }, remaining: string[] }>} remaining: keys still there afterwards (empty when it worked)
 */
export async function clearAllStored({ local, session } = {}) {
  const removed = { local: 0, session: 0 };
  const remaining = [];
  for (const [name, area] of [['local', local], ['session', session]]) {
    if (!area) continue;
    const found = Object.keys((await area.get(null)) || {}).filter((k) => k.startsWith(KEY_PREFIX));
    if (found.length) await area.remove(found);
    removed[name] = found.length;
    const left = Object.keys((await area.get(null)) || {}).filter((k) => k.startsWith(KEY_PREFIX));
    remaining.push(...left.map((k) => `${name}:${k}`));
  }
  return { removed, remaining };
}
