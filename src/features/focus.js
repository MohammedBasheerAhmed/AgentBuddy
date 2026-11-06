// The five pain points (2026-11-05, after the leaders' review: "too many features, it looks cluttered; solve the main pain points,
// three to five at most"). The agent chose them: understand the ticket, find the fix, the same caller, reply, close well. Every tab
// of the Ticket screen shows one item per pain point (docs/focus-layout.md); everything else stays, one step away, in All tools.
//
//   PAIN_POINTS              the five, in order, each with the Insights cards that answer it and the AI actions that may fill its slot
//   painOfCard(id)           the pain point an Insights card belongs to, or '' (the card is under All tools)
//   focusCards(cards)        the record's cards split into the five groups (in order, empty groups left out) and the rest
//   focusActions(items)      the record's AI actions: one per pain point (the first candidate the record offers) and the rest
//
// Pure, no React: the Ticket screen, All tools (src/sidepanel/palette) and the tests use it. Which cards and actions a record has at
// all is decided where it always was (cardsFor in TicketInsights.jsx, offeredFeatures in assist/actions/plan.js); this only sorts.
import { t } from '../i18n/index.js';

const point = (id, title, cards, actions) =>
  Object.freeze({
    id,
    get title() {
      return title();
    },
    cards: Object.freeze(cards),
    actions: Object.freeze(actions),
  });

// Cards: every card of a group that the record shows is in that group (a request shows its status under "Understand the ticket", a
// case its account under "Same caller"). Actions: the FIRST one the record offers fills the slot (a case without a caller briefing
// gets the account briefing); an action fills one slot at most.
export const PAIN_POINTS = Object.freeze([
  point('understand', () => t('Understand the ticket'), ['request', 'chat', 'article', 'journey'], ['record-summary', 'hr-case-brief', 'request-explain']),
  point('fix', () => t('Find the fix'), ['checklist', 'steps', 'knowledge'], ['next-best-action', 'problem-rca', 'fulfilment-checklist']),
  point('caller', () => t('Same caller'), ['caller', 'account'], ['caller-briefing', 'account-briefing']),
  point('reply', () => t('Reply'), ['email'], ['reply-draft', 'chat-reply']),
  // (round 4: "Prepare to close" first; "Write resolution notes" fills the slot only where it is not offered, and is in All tools)
  point('close', () => t('Close well'), ['resolve'], ['prepare-close', 'resolution-notes', 'chat-summary']),
]);

export const PAIN_IDS = Object.freeze(PAIN_POINTS.map((p) => p.id));

/** The pain point an Insights card belongs to, or '' when it is one of the rest (All tools). */
export function painOfCard(cardId) {
  return PAIN_POINTS.find((p) => p.cards.includes(cardId))?.id || '';
}

/**
 * The record's Insights cards (in the order cardsFor gave them) as the five groups and the rest.
 * @param {{ id: string }[]} cards
 * @returns {{ groups: { id: string, title: string, cards: object[] }[], rest: object[] }}
 */
export function focusCards(cards = []) {
  const list = Array.isArray(cards) ? cards.filter((c) => c && c.id) : [];
  const groups = PAIN_POINTS.map((p) => ({ id: p.id, title: p.title, cards: list.filter((c) => p.cards.includes(c.id)) })).filter((g) => g.cards.length > 0);
  const rest = list.filter((c) => !painOfCard(c.id));
  return { groups, rest };
}

/**
 * The record's AI actions (the plan's items, each { feature, reason, caution }) as one per pain point and the rest.
 * @param {{ feature: { id: string } }[]} items
 * @returns {{ five: { pain: string, painTitle: string, item: object }[], rest: object[] }}
 */
export function focusActions(items = []) {
  const list = Array.isArray(items) ? items.filter((it) => it?.feature?.id) : [];
  const byId = new Map(list.map((it) => [it.feature.id, it]));
  const used = new Set();
  const five = [];
  for (const p of PAIN_POINTS) {
    const id = p.actions.find((a) => byId.has(a) && !used.has(a));
    if (!id) continue;
    used.add(id);
    five.push({ pain: p.id, painTitle: p.title, item: byId.get(id) });
  }
  const rest = list.filter((it) => !used.has(it.feature.id));
  return { five, rest };
}
