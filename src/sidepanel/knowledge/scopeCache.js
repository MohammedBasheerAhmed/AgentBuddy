import { read } from '../ask.js';
import { insightStore, userKeyOf } from '../ticket/cards/useInsight.js';
import { placeOf } from '../knowledgeScreen/shared.js';

// The categories of one knowledge base are read ONCE per knowledge base and kept in memory for the person who is signed in (the same
// memory as the Insights cards: src/insights/cache.js). They are names and counts only. The key carries the tab, the instance and the
// person, so what was read for one person is never offered to another; the store is emptied when the person clears their data or a
// site is turned off (src/sidepanel/forgetOnClear.js), and when the sign-in is lost. Nothing is stored in the browser (build rule 7).

const FRESH_MS = 15 * 60 * 1000;

/** The key of one knowledge base's category list for the tab, instance and person `page` is on. */
export const categoriesKey = (page, knowledgeBase) => `kb-categories|${placeOf(page)}|${userKeyOf(page)}|${String(knowledgeBase || '').toLowerCase()}`;

/**
 * The categories of a knowledge base: { items: [{ id, name, count }], hidden, access }. A list read a moment ago is reused; a read on its
 * way is joined, not started twice.
 */
export function readCategories(page, knowledgeBase) {
  return insightStore.get(categoriesKey(page, knowledgeBase), () => read(page.tabId, 'kbScopes', { knowledgeBase }), { maxAgeMs: FRESH_MS });
}
