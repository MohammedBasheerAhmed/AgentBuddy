// What needs the agent now, as the first rows of the Ticket screen's Insights half (the 2026-11-05 layout: they used to be a block
// called "Needs you now" at the top of the screen). Plain sentences built only from what the screen already has, the most urgent
// first. No read of its own and no AI: the SLA, a customer waiting and a possible outage come from the Glance (the `glance` read every
// card shares, src/insights/glance.js buildGlance). The Insights cards that need a look are not repeated here: their own rows come
// first among the cards (TicketInsights arrangeRows). Pure: tests/ticket-needs-now.test.js.

import { shortSpan } from '../../insights/time.js';
import { t, tn } from '../../i18n/index.js';

const RANK = { danger: 0, warn: 1 };
const LOOK = new Set(['danger', 'warn']);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The SLA as one item, or null: breached (danger) or due within the hour (warn). */
function slaItem(sla) {
  if (!sla || typeof sla !== 'object') return null;
  const sub = text(sla.name);
  if (sla.kind === 'breached') {
    const late = Number.isFinite(sla.leftMs) && sla.leftMs < 0 ? shortSpan(-sla.leftMs) : '';
    return { id: 'sla', level: 'danger', text: late ? t('The SLA was due {span} ago', { span: late }) : t('The SLA is breached'), sub };
  }
  if (sla.kind === 'running' && sla.tone === 'warn' && Number.isFinite(sla.leftMs)) {
    return { id: 'sla', level: 'warn', text: t('The SLA is due in {span}', { span: shortSpan(sla.leftMs) }), sub };
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
  return { id: 'waiting', level: 'warn', text: line, sub };
}

/**
 * The facts of the Glance that need a look: the SLA, a customer waiting, a possible outage; the most urgent first (danger before
 * warn). Empty when nothing needs a look. A possible outage is said here only when the record does not show the Outage spotter card:
 * that card says the same line from the same read, and its row comes first among the cards when it does (said once, never twice).
 * @param {{
 *   glance: { sla?: object, waiting?: object, outage?: { line: string }|null }|null,   buildGlance's answer
 *   cards?: { id: string }[],   the Insights cards this record shows
 * }} input
 * @returns {{ id: 'sla'|'waiting'|'outage', level: 'danger'|'warn', text: string, sub: string }[]}
 */
export function needsNow({ glance = null, cards = [] } = {}) {
  const items = [slaItem(glance?.sla), waitingItem(glance?.waiting)].filter(Boolean);
  const outageCard = cards.some((c) => c?.id === 'outage');
  if (glance?.outage?.line && !outageCard) items.push({ id: 'outage', level: 'danger', text: t('Possible outage: {line}', { line: glance.outage.line }), sub: '' });
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => RANK[a.item.level] - RANK[b.item.level] || a.i - b.i)
    .map((x) => x.item);
}

/**
 * How many rows of the Insights half need a look: these facts and the cards that reported 'danger' or 'warn'. The Insights tab shows
 * the number. Pure.
 * @param {{ needs?: object[], cards?: { id: string }[], reports?: Record<string, { attention?: string }> }} input
 */
export function needsCount({ needs = [], cards = [], reports = {} } = {}) {
  return needs.length + cards.filter((c) => LOOK.has(reports?.[c.id]?.attention)).length;
}
