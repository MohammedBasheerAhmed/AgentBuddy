// The Ticket screen's five rows (docs/focus-layout.md, A): how the Insights cards of a record become the five pain point rows, what each
// row says without being opened, and how a request to the screen (a launch id) is read. Pure: TicketView, TicketInsights, the side
// rail and the tests use it; which cards and actions a record has at all is decided where it always was (cardsFor, actionPlan), and
// which pain point a card belongs to by src/features/focus.js.
//
//   insightGroups({ cards, reports, needs })   the five rows of Insights (each with its level, its line, whether it needs a look) and
//                                             the rest (under All tools)
//   orderMembers(cards, reports)              the cards inside a row: the ones that need a look first
//   groupLevel / groupLine                    a row's status and its one line
//   lookCount(groups)                         how many rows need a look (the number on the Insights tab)
//   readLaunch(featureId)                     what a launch id asks for: an AI action, a card alone, or "Ask about this ticket"

import { QUICK_CARDS, isQuickCard } from '../../features/quick.js';
import { PAIN_POINTS, focusCards } from '../../features/focus.js';

// How telling a status is: what needs a look first, then good news, then plain information, and "nothing to report" last.
const RANK = { danger: 0, warn: 1, ok: 2, '': 3, clear: 4 };
const LOOK = new Set(['danger', 'warn']);
const rankOf = (level) => RANK[level] ?? RANK[''];
const levelOfReport = (reports, id) => {
  const level = reports?.[id]?.attention;
  return Object.prototype.hasOwnProperty.call(RANK, level) ? level : '';
};
const lineOfReport = (reports, id) => (typeof reports?.[id]?.summary === 'string' ? reports[id].summary.trim() : '');

/** Does this status need a look (the dot on a row, the number on the tab)? */
export const needsLook = (level) => LOOK.has(level);

/**
 * The cards of one row in the order they are drawn: the ones that need a look first (danger, then warn), the others in the record's
 * order (cardsFor). A card with nothing to report keeps its place: there is no "All clear" row any more.
 */
export function orderMembers(cards = [], reports = {}) {
  const first = (c) => (needsLook(levelOfReport(reports, c.id)) ? rankOf(levelOfReport(reports, c.id)) : 2);
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => first(a.c) - first(b.c) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * A row's status: the most telling of its cards (and, for "Understand the ticket", of the facts that need the agent now): danger, then
 * warn, then good news ('ok'), then plain (''); 'clear' only when every card said it has nothing to report.
 * @param {{ id: string }[]} cards   @param {Record<string, { attention?: string }>} reports   @param {{ level: string }[]} needs
 */
export function groupLevel(cards = [], reports = {}, needs = []) {
  const levels = [...cards.map((c) => levelOfReport(reports, c.id)), ...needs.map((n) => (LOOK.has(n?.level) ? n.level : ''))];
  if (!levels.length) return '';
  return levels.reduce((worst, level) => (rankOf(level) < rankOf(worst) ? level : worst), 'clear');
}

/**
 * A row's one line, shown without opening it. "Understand the ticket": the first fact that needs the agent now when there is one (the
 * facts come most urgent first), else its first card's line; when something changed since the agent last opened the ticket, that
 * comes first, with the most urgent fact in a few words after it ("Since you looked: the caller wrote twice · SLA 1h 20m"). The
 * others: their cards' lines, the ones that need a look first, two at most, joined by " · ".
 */
export function groupLine(group, reports = {}, needs = []) {
  const lines = orderMembers(group?.cards || [], reports)
    .map((c) => lineOfReport(reports, c.id))
    .filter(Boolean);
  if (group?.id === 'understand') {
    const said = (v) => (typeof v === 'string' ? v.trim() : '');
    const facts = Array.isArray(needs) ? needs : [];
    // The plain facts (since you looked, what the caller wrote) have no level: only the facts that need a look are "today's line".
    const fact = facts.find((n) => LOOK.has(n?.level) && said(n.text));
    const since = facts.find((n) => n?.id === 'since' && said(n.line));
    if (since) return [said(since.line), fact ? said(fact.short) || said(fact.text) : ''].filter(Boolean).join(' · ');
    return fact ? said(fact.text) : lines[0] || '';
  }
  return lines.slice(0, 2).join(' · ');
}

/**
 * The record's Insights cards as the five rows (in the order of PAIN_POINTS, rows without a card left out) and the rest. The facts that
 * need the agent now belong to "Understand the ticket": when the record has none of its cards, the row is there for the facts alone.
 * @param {{ cards: { id: string, title: string }[], reports?: Record<string, { summary?: string, attention?: string }>,
 *           needs?: { id: string, level: string, text: string }[] }} input
 * @returns {{ groups: { id, title, cards, needs, level, line, look }[], rest: object[] }}
 */
export function insightGroups({ cards = [], reports = {}, needs = [] } = {}) {
  const { groups, rest } = focusCards(cards);
  const facts = Array.isArray(needs) ? needs.filter((n) => n && n.id) : [];
  const all = facts.length && !groups.some((g) => g.id === 'understand') ? [{ id: 'understand', title: PAIN_POINTS[0].title, cards: [] }, ...groups] : groups;
  return {
    groups: all.map((g) => {
      const own = g.id === 'understand' ? facts : [];
      const level = groupLevel(g.cards, reports, own);
      return { id: g.id, title: g.title, cards: g.cards, needs: own, level, line: groupLine(g, reports, own), look: needsLook(level) };
    }),
    rest,
  };
}

/** How many of the five rows need a look: the number on the Insights tab. */
export const lookCount = (groups = []) => (Array.isArray(groups) ? groups.filter((g) => g?.look).length : 0);

/** The row a card is drawn in, or null for a card of the rest. */
export const groupOfCard = (groups = [], cardId) => (cardId ? groups.find((g) => g.cards.some((c) => c.id === cardId)) || null : null);

const SHOW_RE = /^show:([a-zA-Z][a-zA-Z0-9]{0,39})$/;

/**
 * What a launch id (All tools, the keyboard, the bar on the ServiceNow page; src/lib/launch.js) asks the Ticket screen for:
 *   { kind: 'quick', card }   a QUICK_CARDS item ('card:ready'): that card alone in Insights, as before
 *   { kind: 'show', card }    'show:<card id>': that card alone in Insights; nothing when the record has no such card
 *   { kind: 'ask' }           'ask:ticket': "Ask about this ticket" open at the top of AI Assist
 *   { kind: 'feature', id }   anything else: an AI action, started as a click on it would (preview first)
 */
export function readLaunch(featureId) {
  const id = typeof featureId === 'string' ? featureId : '';
  if (isQuickCard(id)) return { kind: 'quick', card: QUICK_CARDS[id].card };
  if (id === 'ask:ticket') return { kind: 'ask' };
  const show = SHOW_RE.exec(id);
  if (show) return { kind: 'show', card: show[1] };
  return { kind: 'feature', id };
}
