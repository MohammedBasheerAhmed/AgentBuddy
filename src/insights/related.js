// N2, related tickets: the caller's earlier tickets, solved look-alikes and open tickets on the same item, as groups with counts and
// one summary line ("10 earlier · 5 open · 7 solved"). Pure.

import { isolate, t, tn } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * @param {{ history?: { items?: object[], signals?: object }|null, lookalikes?: object[]|null, open?: object[]|null }} parts
 *   null for a part that is not read yet or could not be read (it is then left out of the line, never counted as 0)
 * @returns {{ line: string, earlier: number|null, stillOpen: number|null, solved: number|null, open: number|null, repeat: string }}
 */
export function relatedSummary({ history = null, lookalikes = null, open = null } = {}) {
  const earlier = history ? list(history.items).length : null;
  const stillOpen = history && Number.isFinite(history.signals?.openCount) ? history.signals.openCount : null;
  const solved = lookalikes ? list(lookalikes).length : null;
  const openCount = open ? list(open).length : null;
  const bits = [];
  if (earlier !== null) bits.push(t('{n} earlier', { n: earlier }));
  if (stillOpen) bits.push(t('{n} still open', { n: stillOpen }));
  if (solved !== null) bits.push(t('{n} solved', { n: solved }));
  if (openCount) bits.push(t('{n} open on the same item', { n: openCount }));
  const hint = history?.signals?.reopenedHint;
  const repeat = hint?.later
    ? hint.earlier
      ? tn(Number(hint.days), 'Looks like a repeat: {later} came {n} day after {earlier} was resolved.', 'Looks like a repeat: {later} came {n} days after {earlier} was resolved.', { later: isolate(text(hint.later)), earlier: isolate(text(hint.earlier)) })
      : t('Looks like a repeat: {later} was reopened.', { later: isolate(text(hint.later)) })
    : '';
  return { line: bits.join(' · '), earlier, stillOpen, solved, open: openCount, repeat };
}

/** A history item's second line: "In Progress · opened 2026-10-12". */
export const historyLine = (item) => [text(item?.state), text(item?.opened_at) && t('opened {date}', { date: text(item.opened_at).slice(0, 10) })].filter(Boolean).join(' · ');
