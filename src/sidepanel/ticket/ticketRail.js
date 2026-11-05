// The side rail of the Ticket screen (docs/rail-layout.md, A): what it lists for the half on show. With Insights on: "All insights",
// then every card this record shows (a dot on the ones that need a look); with AI Assist on: "Suggested", then every AI action this
// record offers. The person's arrangement (Settings > Side rail: their order, what they hid, per kind of record) decides the order
// after the defaults. Pure: the screen adds the click handlers and publishes the rail (TicketView, useRailPublish), and
// tests/ticket-rail.test.js checks it without React.

import { arrangeRail, assistDefaultOrder, railPrefsFor } from '../../features/railLayout.js';
import { QUICK_LABELS } from '../../features/quick.js';
import { cardIcon, featureIcon } from '../ui/featureIcons.js';
import { t, t as tr } from '../../i18n/index.js';

/** The ids of the two items that lead a rail (no card id or feature id is either). */
export const ALL_INSIGHTS = 'all';
export const SUGGESTED = 'suggested';

const LOOK = new Set(['danger', 'warn']);

/** The rail's name for an AI action: its short label (the same as on the bar on the ServiceNow page), else its own title. */
export function actionLabel(feature) {
  const id = feature?.id;
  const short = id && Object.prototype.hasOwnProperty.call(QUICK_LABELS, id) ? QUICK_LABELS[id] : '';
  return short || (feature?.title ? tr(feature.title) : '');
}

/**
 * The Insights rail: "All insights", then the cards in the record's order (cardsFor) as the person arranged them; a card they hid is
 * not in the rail (it stays in the list). `focus`: the card shown alone, or null for the list.
 * @param {{ cards: { id: string, title: string }[], reports?: Record<string, { attention?: string }>, layout?: object, kind?: string,
 *           focus?: string|null }} input
 * @returns {{ id, label, icon, attention, separator, current }[]}
 */
export function insightsRail({ cards = [], reports = {}, layout = {}, kind = 'other', focus = null }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const { shown } = arrangeRail([...byId.keys()], railPrefsFor(layout, kind, 'insights'));
  return [
    { id: ALL_INSIGHTS, label: t('All insights'), icon: 'list', attention: '', separator: false, current: !focus },
    ...shown.map((id, i) => {
      const level = reports?.[id]?.attention;
      return { id, label: byId.get(id).title, icon: cardIcon(id), attention: LOOK.has(level) ? level : '', separator: i === 0, current: focus === id };
    }),
  ];
}

/**
 * The AI Assist rail: "Suggested", then every AI action this record offers (the plan's items: the same list AI Assist offers), what
 * fits the ticket's state first unless the person switched that off (railByState), then as they arranged it.
 * @param {{ items: { feature: object, reason?: string }[], kind?: string, stage?: string|null, byState?: boolean, layout?: object,
 *           current?: string, off?: boolean }} input
 *   items: in the registry's order; current: the action whose answer is on show; off: no action can start now (no key, AI skipped, a
 *   record block, an answer on its way): every action is disabled (AI Assist says why)
 * @returns {{ id, label, icon, ai, separator, current, disabled }[]}
 */
export function assistRail({ items = [], kind = 'other', stage = null, byState = true, layout = {}, current = '', off = false }) {
  const byId = new Map(items.filter((it) => it?.feature?.id).map((it) => [it.feature.id, it]));
  const ids = assistDefaultOrder([...byId.keys()], { kind, stage, byState });
  const { shown } = arrangeRail(ids, railPrefsFor(layout, kind, 'assist'));
  const onShow = shown.includes(current) ? current : '';
  return [
    { id: SUGGESTED, label: t('Suggested'), icon: 'sparkle', ai: false, separator: false, current: !onShow, disabled: false },
    ...shown.map((id, i) => {
      const it = byId.get(id);
      return { id, label: actionLabel(it.feature), icon: featureIcon(id), ai: true, separator: i === 0, current: id === onShow, disabled: Boolean(off || it.reason) };
    }),
  ];
}

/** The action an answer was made by: a rewrite of an answer (Shorter, Translate...) counts as the action it rewrote. */
export function answerAction(answer) {
  return String(answer?.meta?.base?.id || answer?.feature?.id || '');
}

/**
 * Bring an element of the screen back into view when it is not: above the visible part (under the sticky header, --ab-head-h) or
 * below it. Smooth unless the person asked for less motion. `win` is injected for the tests.
 */
export function reveal(el, win = typeof window === 'undefined' ? null : window) {
  if (!el || !win || typeof el.getBoundingClientRect !== 'function') return false;
  const { top } = el.getBoundingClientRect();
  const head = parseFloat(win.getComputedStyle?.(win.document?.documentElement)?.getPropertyValue?.('--ab-head-h')) || 0;
  const bottom = Number(win.innerHeight) || 0;
  if (!Number.isFinite(top) || (top >= head && (!bottom || top < bottom - 40))) return false;
  const still = Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  return true;
}
