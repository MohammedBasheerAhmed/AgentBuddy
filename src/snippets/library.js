// Keeping the snippet library in extension storage. The list logic is in store.js (pure); this file only loads and saves it,
// through a storage area that is passed in (chrome.storage.local in the panel, a fake in tests).
//
// Snippets are the one thing the Write section stores. They are the agent's own canned replies (titles, shortcuts and text
// with {{variables}}): settings-like configuration, never ticket content. A snippet is only ever filled with record data
// at the moment it is previewed or inserted, in memory.

import { SNIPPETS_KEY } from '../lib/storage.js';
import { LIMITS, normalizeSnippet } from './store.js';
import { t } from '../i18n/index.js';

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

/** Whatever was stored, as a clean list: only well-formed snippets with an id survive; the rest are dropped. */
export function cleanLibrary(stored) {
  if (!Array.isArray(stored)) return [];
  const used = new Set();
  const out = [];
  for (const item of stored.slice(0, LIMITS.count)) {
    const { snippet } = normalizeSnippet(item);
    if (!snippet || !ID_OK.test(snippet.id) || used.has(snippet.id)) continue;
    used.add(snippet.id);
    out.push(snippet);
  }
  return out;
}

/** The saved library ([] when nothing is saved or storage is not available). */
export async function loadSnippets(area, key = SNIPPETS_KEY) {
  try {
    return cleanLibrary((await area.get(key))[key]);
  } catch {
    return [];
  }
}

export async function saveSnippets(area, list, key = SNIPPETS_KEY) {
  await area.set({ [key]: cleanLibrary(list) });
}

const withLock = (fn) => (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('agentbuddy-snippets', fn) : fn());

/**
 * Change the library from its CURRENT stored state (not from what a panel last showed, which another window may have
 * changed): `apply(list)` returns { list, ...anything } and the new list is saved when it differs. Returns apply's result with
 * `saved` set to whether anything was written.
 */
export function changeSnippets(area, apply, key = SNIPPETS_KEY) {
  return withLock(async () => {
    const current = await loadSnippets(area, key);
    const result = apply(current) || {};
    const next = Array.isArray(result.list) ? result.list : current;
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    if (changed) await saveSnippets(area, next, key);
    return { ...result, list: changed ? cleanLibrary(next) : current, saved: changed };
  });
}

/**
 * Three plain examples for an empty library, so the first visit shows how variables and fallbacks look. They become the person's own
 * snippets, so they are written in the panel's language at the moment they are added (the search words stay a-z, as they must).
 */
export function starterSnippets() {
  return [
    { title: t('Greeting'), shortcut: 'hi', body: t('Hello {{caller.first_name | there}},\n\nThank you for contacting the service desk about {{number}}.') },
    { title: t('Asking for details'), shortcut: 'info', body: t('Hello {{caller.first_name | there}},\n\nTo move {{number}} forward, could you please share:\n1. The exact error message you see\n2. When it started\n\nThank you.') },
    { title: t('Closing note'), shortcut: 'bye', body: t('Hello {{caller.first_name | there}},\n\nI am glad {{number}} is sorted. If the problem comes back, reply to this message and we will pick it up again.') },
  ];
}
