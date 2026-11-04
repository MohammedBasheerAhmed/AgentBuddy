// "Needs you now" at the top of the Ticket screen: two or three plain sentences, the most urgent first, built only from what the screen
// already has. No read of its own and no AI: the SLA, a customer waiting and a possible outage come from the Glance (the `glance` read
// every card shares, src/insights/glance.js buildGlance); the rest are the Insights cards that reported they need a look
// (src/sidepanel/ticket/cardReports.js). Pure: tests/ticket-needs-now.test.js.

import { shortSpan } from '../../insights/time.js';
import { t, tn } from '../../i18n/index.js';

export const MAX_NEEDS = 3;

const RANK = { danger: 0, warn: 1 };
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The SLA as one item, or null: breached (danger) or due within the hour (warn). */
function slaItem(sla) {
  if (!sla || typeof sla !== 'object') return null;
  const sub = text(sla.name);
  if (sla.kind === 'breached') {
    const late = Number.isFinite(sla.leftMs) && sla.leftMs < 0 ? shortSpan(-sla.leftMs) : '';
    return { id: 'sla', level: 'danger', icon: 'clock', text: late ? t('The SLA was due {span} ago', { span: late }) : t('The SLA is breached'), sub };
  }
  if (sla.kind === 'running' && sla.tone === 'warn' && Number.isFinite(sla.leftMs)) {
    return { id: 'sla', level: 'warn', icon: 'clock', text: t('The SLA is due in {span}', { span: shortSpan(sla.leftMs) }), sub };
  }
  return null;
}

/** A customer whose last message has no answer yet, as one item, or null. (buildGlance says nothing when it cannot tell.) */
function waitingItem(wait) {
  if (!wait?.waiting) return null;
  const sub = wait.messages > 0 ? tn(wait.messages, '{n} message without a reply', '{n} messages without a reply') : '';
  let line;
  if (!Number.isFinite(wait.sinceMs)) line = t('The customer is waiting for a reply');
  else if (wait.approx) line = t('The customer has waited about {span} for a reply', { span: shortSpan(wait.sinceMs) });
  else line = t('The customer has waited {span} for a reply', { span: shortSpan(wait.sinceMs) });
  return { id: 'waiting', level: 'warn', icon: 'message', text: line, sub };
}

/**
 * The items, at most `max`: the facts of the Glance (the SLA, a customer waiting, a possible outage), then the cards that need a look
 * (danger before warn, in their Insights order); shown the most urgent first (danger before warn). Empty when nothing needs a look:
 * then the block is not drawn.
 * @param {{
 *   glance: { sla?: object, waiting?: object, outage?: { line: string }|null }|null,   buildGlance's answer
 *   cards?: { id: string, title: string }[],   the Insights cards this record shows, in their order
 *   reports?: Record<string, { summary?: string, attention?: string }>,   what each card reported for this record
 *   max?: number,
 * }} input
 * @returns {{ id: string, level: 'danger'|'warn', icon: string, text: string, sub: string, card: string, cardTitle: string }[]}
 *   card: the Insights card the item opens ('' for none); cardTitle: its name, for the link
 */
export function needsNow({ glance = null, cards = [], reports = {}, max = MAX_NEEDS } = {}) {
  const shown = new Map(cards.map((c) => [c.id, c]));
  const withCard = (item, id) => ({ card: shown.has(id) ? id : '', cardTitle: shown.has(id) ? shown.get(id).title : '', ...item });
  const items = [];
  const sla = slaItem(glance?.sla);
  if (sla) items.push(withCard(sla, ''));
  const waiting = waitingItem(glance?.waiting);
  if (waiting) items.push(withCard(waiting, ''));
  // The outage spotter says the same as the Glance's outage line (one read): said once, from the Glance, with a way to its card.
  if (glance?.outage?.line) items.push(withCard({ id: 'outage', level: 'danger', icon: 'alert', text: t('Possible outage: {line}', { line: glance.outage.line }), sub: '' }, 'outage'));
  // Then the cards that need a look, the most urgent first. The facts above come first when there is no room for all: they are plain
  // sentences, and the cards' own rows below are marked anyway.
  const flagged = cards
    .filter((c) => c.id !== 'outage' && (reports?.[c.id]?.attention || '') in RANK)
    .map((c, i) => ({ c, i, level: reports[c.id].attention }))
    .sort((a, b) => RANK[a.level] - RANK[b.level] || a.i - b.i)
    .map(({ c, level }) => withCard({ id: `card:${c.id}`, level, icon: 'alert', text: text(reports[c.id].summary) || c.title, sub: '' }, c.id));
  return [...items, ...flagged]
    .slice(0, Math.max(0, max))
    .map((item, i) => ({ item, i }))
    .sort((a, b) => RANK[a.item.level] - RANK[b.item.level] || a.i - b.i)
    .map((x) => x.item);
}
