// The person's arrangement of the Ticket screen's side rail (Settings > Side rail): per kind of record and per half (Insights, AI
// Assist), the order they chose and the items they hid. Pure, and shared: the panel (src/sidepanel/ticket) draws the rail with it and
// Settings edits it with it. Stored as settings.railLayout:
//
//   { incident: { insights: { order: ['related', 'sla'], hidden: ['changes'] }, assist: { order: [...], hidden: [...] } }, ... }
//
// Ids are card ids (src/sidepanel/ticket/cards INSIGHT_CARDS) on the Insights side and feature ids (src/features/registry.js) on the
// AI Assist side. An id this version does not know (an action renamed later, a hand-edited setting) is simply skipped, never shown.
// A kind the person has not arranged follows the defaults: the record's own order, and on the AI Assist side what fits the ticket's
// state first when railByState is on (src/features/quick.js quickDefaults).

import { quickDefaults } from './quick.js';

export const RAIL_HALVES = Object.freeze(['insights', 'assist']);
const MAX_IDS = 80; // far more than any kind offers; a guard against a stored list that grew without end
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const idList = (v) => {
  const out = [];
  for (const id of Array.isArray(v) ? v : []) {
    if (typeof id === 'string' && id && id.length <= 80 && !out.includes(id)) out.push(id);
    if (out.length === MAX_IDS) break;
  }
  return out;
};

/** One kind's arrangement of one half, cleaned: { order, hidden, arranged } (arranged: the person changed something). */
export function railPrefsFor(layout, kind, half) {
  const saved = isPlainObject(layout) && isPlainObject(layout[kind]) && isPlainObject(layout[kind][half]) ? layout[kind][half] : null;
  const order = idList(saved?.order);
  const hidden = idList(saved?.hidden);
  return { order, hidden, arranged: Boolean(saved) && (order.length > 0 || hidden.length > 0) };
}

/**
 * The default order of the AI actions a record offers: when `byState`, what fits the ticket's stage first (the kind's own action,
 * then the stage's list, then the kind's defaults: quickDefaults), then the rest in the order given. Insights cards keep their order.
 * @param {string[]} ids the AI actions this record offers, in the registry's order
 */
export function assistDefaultOrder(ids, { kind = 'other', stage = null, byState = true } = {}) {
  if (!byState) return [...ids];
  const first = quickDefaults(kind, stage).filter((id) => ids.includes(id));
  return [...first, ...ids.filter((id) => !first.includes(id))];
}

/**
 * The items of a rail half as they are drawn: the ids the person ordered first (in their order, only those the record offers), then
 * the others in the default order; the hidden ones left out. `all` keeps every id in that order with its hidden flag (for Settings).
 * @param {string[]} ids what the record offers, in the default order
 * @returns {{ shown: string[], hidden: string[], all: { id: string, hidden: boolean }[] }}
 */
export function arrangeRail(ids, prefs = {}) {
  const offered = idList(ids);
  const order = idList(prefs.order).filter((id) => offered.includes(id));
  const hiddenSet = new Set(idList(prefs.hidden));
  const ordered = [...order, ...offered.filter((id) => !order.includes(id))];
  const all = ordered.map((id) => ({ id, hidden: hiddenSet.has(id) }));
  return { shown: all.filter((x) => !x.hidden).map((x) => x.id), hidden: all.filter((x) => x.hidden).map((x) => x.id), all };
}

/** A new layout with one kind's half set to { order, hidden } (null or empty lists: back to the defaults). Never changes `layout`. */
export function setRailPrefs(layout, kind, half, prefs) {
  const next = cleanRailLayout(layout);
  const order = idList(prefs?.order);
  const hidden = idList(prefs?.hidden);
  const forKind = { ...(next[kind] || {}) };
  if (order.length || hidden.length) forKind[half] = { order, hidden };
  else delete forKind[half];
  if (Object.keys(forKind).length) next[kind] = forKind;
  else delete next[kind];
  return next;
}

/** The stored layout with anything malformed dropped (unknown halves, lists that are not lists of short strings). */
export function cleanRailLayout(layout) {
  const out = {};
  if (!isPlainObject(layout)) return out;
  for (const [kind, halves] of Object.entries(layout)) {
    if (typeof kind !== 'string' || !kind || kind.length > 40 || !isPlainObject(halves)) continue;
    const forKind = {};
    for (const half of RAIL_HALVES) {
      if (!isPlainObject(halves[half])) continue;
      const order = idList(halves[half].order);
      const hidden = idList(halves[half].hidden);
      if (order.length || hidden.length) forKind[half] = { order, hidden };
    }
    if (Object.keys(forKind).length) out[kind] = forKind;
  }
  return out;
}
