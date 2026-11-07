// The linked-incident line of a problem at a glance (audit of 2026-11-07, F14): a problem is worth as much as the incidents it explains, and the
// panel read them for the AI only. One line from the count the `glance` read brings for a problem (src/content/ops/insights.js
// readLinkedIncidentCount), under the chips, next to the change line of a change:
//   "3 linked incidents that you can see"       "At least 50 linked incidents that you can see"       "No linked incidents that you can see"
// "that you can see": the count is of the rows the person's own session returned, and a row an access rule hides is not in it. A full page is
// "at least". A count that could not be read gives no line at all (never "0"). No AI. Pure.

import { t, tn } from '../i18n/index.js';

/**
 * @param {{ count?: number, atLeast?: boolean } | null | undefined} linked  the glance read's `linked`
 * @param {string} [kind] the ticket's kind: only a problem has this line
 * @returns {string} the line, or '' when the ticket is not a problem or the count is not known
 */
export function linkedLine(linked, kind = 'problem') {
  if (kind !== 'problem' || !linked || typeof linked !== 'object') return '';
  const n = Number(linked.count);
  if (!Number.isInteger(n) || n < 0) return '';
  if (linked.atLeast === true && n > 0) return tn(n, 'At least {n} linked incident that you can see', 'At least {n} linked incidents that you can see');
  if (n === 0) return t('No linked incidents that you can see');
  return tn(n, '{n} linked incident that you can see', '{n} linked incidents that you can see');
}
