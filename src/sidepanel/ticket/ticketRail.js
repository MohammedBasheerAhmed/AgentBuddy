// The side rail of the Ticket screen (docs/focus-layout.md, A): what it lists for the half on show. With Insights on: the five rows
// (a dot on the ones that need a look; a click opens that row in place); with AI Assist on: the five AI actions (a click starts one, as
// a click in AI Assist does: preview first). Both end with "All tools", where everything else is. The shell decides whether the rail
// is drawn at all (Settings > Side rail). Pure: the screen adds the click handlers and publishes the rail (TicketView,
// useRailPublish), and tests/ticket-rail.test.js checks it without React.

import { QUICK_LABELS } from '../../features/quick.js';
import { featureIcon, painIcon } from '../ui/featureIcons.js';
import { t, t as tr } from '../../i18n/index.js';

/** The id of the item that ends both rails (no pain point id and no feature id is this). */
export const ALL_TOOLS = 'all-tools';

const LOOK = new Set(['danger', 'warn']);

/** The rail's name for an AI action: its short label (the same as on the bar on the ServiceNow page), else its own title. */
export function actionLabel(feature) {
  const id = feature?.id;
  const short = id && Object.prototype.hasOwnProperty.call(QUICK_LABELS, id) ? QUICK_LABELS[id] : '';
  return short || (feature?.title ? tr(feature.title) : '');
}

/** "All tools" at the foot of a rail, a line above it when something comes before it. */
const allTools = (after) => ({ id: ALL_TOOLS, label: t('All tools'), icon: 'grid', attention: '', ai: false, separator: after, current: false, disabled: false });

/**
 * The Insights rail: the five rows in their order (focusView.js insightGroups), then "All tools".
 * @param {{ groups: { id: string, title: string, level?: string }[], current?: string }} input   current: the row whose card is alone
 * @returns {{ id, label, icon, attention, ai, separator, current, disabled }[]}
 */
export function insightsRail({ groups = [], current = '' } = {}) {
  const rows = groups.map((g) => ({ id: g.id, label: g.title, icon: painIcon(g.id), attention: LOOK.has(g.level) ? g.level : '', ai: false, separator: false, current: g.id === current, disabled: false }));
  return [...rows, allTools(rows.length > 0)];
}

/**
 * The AI Assist rail: the five AI actions (focusActions in the plan: one per pain point), then "All tools".
 * @param {{ five: { pain: string, item: { feature: object, reason?: string } }[], current?: string, off?: boolean }} input
 *   current: the action whose answer is on show; off: no action can start now (no key, AI skipped, a record block, an answer on its
 *   way): every action is disabled (AI Assist says why). "All tools" stays usable.
 * @returns {{ id, label, icon, ai, separator, current, disabled }[]}
 */
export function assistRail({ five = [], current = '', off = false } = {}) {
  const rows = five
    .filter((f) => f?.item?.feature?.id)
    .map(({ item }) => {
      const id = item.feature.id;
      return { id, label: actionLabel(item.feature), icon: featureIcon(id), attention: '', ai: true, separator: false, current: id === current, disabled: Boolean(off || item.reason) };
    });
  return [...rows, allTools(rows.length > 0)];
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
