// Organisation snippets: canned replies the organisation publishes for everyone through its policy (`orgSnippets`, already read
// and capped by src/policy/policy.js). They are shown next to the person's own snippets, marked "From your organisation", and are
// read-only in the panel: they cannot be edited or deleted here, and they are never written to storage (they come from the policy
// every time). Pure.
//
// An organisation snippet carries a stable id ("org-" and its position and title), `org: true`, and the same title / shortcut / body
// shape as a personal one, so search, preview and insert treat both alike. Its `shortcut` is a search word (see store.js).

import { normalizeSnippet } from './store.js';

const ORG_PREFIX = 'org-';

// A short, stable id from the title (the same title gives the same id across panel loads, so a selection survives a policy refresh).
function idFor(title, index) {
  let h = 2166136261;
  for (const ch of String(title)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${ORG_PREFIX}${index}-${h.toString(36)}`.slice(0, 64);
}

/** Is this one of the organisation's snippets (read-only)? */
export const isOrgSnippet = (snippet) => Boolean(snippet?.org) || String(snippet?.id || '').startsWith(ORG_PREFIX);

/**
 * The policy's list as snippets. Entries that are not valid snippets (an empty body, a search word with spaces) are left out
 * rather than shown broken; the list stays in the policy's order.
 * @param {{ title: string, body: string, shortcut?: string }[]|undefined} list `eff.policy.orgSnippets`
 * @returns {{ id: string, title: string, shortcut: string, body: string, org: true }[]}
 */
export function orgSnippetList(list) {
  const out = [];
  const titles = new Set();
  (Array.isArray(list) ? list : []).forEach((item, index) => {
    // A search word the store would refuse ("Reset password!") is dropped, not the whole snippet.
    let { snippet } = normalizeSnippet(item);
    if (!snippet && item && typeof item === 'object') snippet = normalizeSnippet({ ...item, shortcut: '' }).snippet;
    if (!snippet || titles.has(snippet.title.toLowerCase())) return;
    titles.add(snippet.title.toLowerCase());
    out.push({ id: idFor(snippet.title, index), title: snippet.title, shortcut: snippet.shortcut, body: snippet.body, org: true });
  });
  return out;
}

/**
 * The person's own snippets and the organisation's, as one list for search: the organisation's first (they are the agreed wording),
 * then the person's. Nothing is merged or dropped: an own snippet with the same title as an organisation one stays, both are shown.
 */
export function withOrgSnippets(own, org) {
  return [...(Array.isArray(org) ? org : []), ...(Array.isArray(own) ? own.filter((s) => !isOrgSnippet(s)) : [])];
}
