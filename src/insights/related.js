// N2, related tickets, in two cards since the focus layout (docs/focus-layout.md): "Related tickets" (solved look-alikes and other
// open tickets on the same item: "7 solved · 2 open on the same item") and "Caller's other tickets" (the caller's earlier tickets, the
// repeat flag and the last fix that worked: "Looks like a repeat · 3 earlier tickets · 1 still open"). Each has one summary line;
// nothing is said in both. Pure.

import { isolate, t, tn } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * "Related tickets": what else looks like this ticket.
 * @param {{ lookalikes?: object[]|null, open?: object[]|null }} parts
 *   null for a part that is not read yet or could not be read (it is then left out of the line, never counted as 0)
 * @returns {{ line: string, solved: number|null, open: number|null }}
 */
export function relatedSummary({ lookalikes = null, open = null } = {}) {
  const solved = lookalikes ? list(lookalikes).length : null;
  const openCount = open ? list(open).length : null;
  const bits = [];
  if (solved !== null) bits.push(t('{n} solved', { n: solved }));
  if (openCount) bits.push(t('{n} open on the same item', { n: openCount }));
  return { line: bits.join(' · '), solved, open: openCount };
}

/** The sentence that says a ticket looks like one the caller had before (the history read's reopenedHint), or ''. */
export function repeatLine(hint) {
  if (!hint?.later) return '';
  if (hint.earlier) {
    return tn(Number(hint.days), 'Looks like a repeat: {later} came {n} day after {earlier} was resolved.', 'Looks like a repeat: {later} came {n} days after {earlier} was resolved.', {
      later: isolate(text(hint.later)),
      earlier: isolate(text(hint.earlier)),
    });
  }
  return t('Looks like a repeat: {later} was reopened.', { later: isolate(text(hint.later)) });
}

/**
 * "Caller's other tickets": the caller's earlier tickets (the history read: { items, signals, noCaller }).
 * @param {{ history?: { items?: object[], signals?: object, noCaller?: boolean }|null }} parts
 *   null while the history is not read yet or could not be read: no line then (a history that could not be read is not "none")
 * @returns {{ line: string, earlier: number|null, stillOpen: number|null, repeat: string, noCaller: boolean }}
 */
export function callerSummary({ history = null } = {}) {
  if (!history) return { line: '', earlier: null, stillOpen: null, repeat: '', noCaller: false };
  if (history.noCaller) return { line: t('Nobody is named as the caller'), earlier: 0, stillOpen: null, repeat: '', noCaller: true };
  const earlier = list(history.items).length;
  const stillOpen = Number.isFinite(history.signals?.openCount) ? history.signals.openCount : null;
  const repeat = repeatLine(history.signals?.reopenedHint);
  if (!earlier && !repeat) return { line: t('No earlier tickets from this caller'), earlier, stillOpen, repeat, noCaller: false };
  // What needs a look first: the repeat, then the counts.
  const bits = [];
  if (repeat) bits.push(t('Looks like a repeat'));
  if (earlier) bits.push(tn(earlier, '{n} earlier ticket', '{n} earlier tickets'));
  if (stillOpen) bits.push(t('{n} still open', { n: stillOpen }));
  return { line: bits.join(' · '), earlier, stillOpen, repeat, noCaller: false };
}

/** A history item's second line: "In Progress · opened 2026-10-12". */
export const historyLine = (item) => [text(item?.state), text(item?.opened_at) && t('opened {date}', { date: text(item.opened_at).slice(0, 10) })].filter(Boolean).join(' · ');
