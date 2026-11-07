// N2, related tickets, in two cards since the focus layout (docs/focus-layout.md): "Related tickets" (solved look-alikes and other
// open tickets on the same item: "7 solved · 2 open on the same item") and "Caller's other tickets" (the caller's earlier tickets, the
// repeat flag and the last fix that worked: "Looks like a repeat · 3 earlier tickets · 1 still open"). Each has one summary line;
// nothing is said in both. Pure.

import { isolate, t, tn } from '../i18n/index.js';
import { readFully } from '../context/seen.js';
import { personWords } from './personWords.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * "Related tickets": what else looks like this ticket.
 * @param {{ lookalikes?: object[]|null, open?: object[]|null, lookalikesSeen?: boolean }} parts
 *   null for a part that is not read yet or could not be read (it is then left out of the line, never counted as 0).
 *   lookalikesSeen: false when the search came back but could not see everything (an access entry says denied, error, blocked or
 *   hidden): "0 solved" is then not said, the line says the panel could not check (R-03)
 * @returns {{ line: string, solved: number|null, open: number|null }}
 */
export function relatedSummary({ lookalikes = null, open = null, lookalikesSeen = true } = {}) {
  const found = lookalikes ? list(lookalikes).length : null;
  // A count of none that could not be checked is not a count: only a number above zero stands, whatever the read could see.
  const solved = found === 0 && !lookalikesSeen ? null : found;
  const openCount = open ? list(open).length : null;
  const bits = [];
  if (solved !== null) bits.push(t('{n} solved', { n: solved }));
  else if (found === 0) bits.push(t('Could not check solved tickets'));
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
 * @param {{ history?: { items?: object[], signals?: object, noCaller?: boolean|string, access?: object[], truncated?: boolean }|null }} parts
 *   null while the history is not read yet or could not be read: no line then (a history that could not be read is not "none").
 *   noCaller: true when the ticket names nobody; 'unreadable' when the column that holds the caller did not come back (a field the
 *   user may not read), which is not "nobody" (R-09, R-14)
 *   kind, table: the ticket's (record.kind, record.table): the person is named as the kind names them, the requester of a requested item,
 *   the employee of an HR case, the customer of a case (F11, src/insights/personWords.js); without them the incident's "caller"
 * @returns {{ line: string, earlier: number|null, stillOpen: number|null, repeat: string, noCaller: boolean, unreadableCaller: boolean, complete: boolean }}
 *   complete: every table was checked, so a count of none is a fact ("none found"); false: some could not be checked
 */
export function callerSummary({ history = null, kind = '', table = '' } = {}) {
  const base = { earlier: null, stillOpen: null, repeat: '', noCaller: false, unreadableCaller: false, complete: false };
  if (!history) return { ...base, line: '' };
  const words = personWords({ kind, table });
  if (history.noCaller === 'unreadable') return { ...base, line: words.unreadable(), earlier: 0, noCaller: true, unreadableCaller: true };
  if (history.noCaller) return { ...base, line: words.nobody(), earlier: 0, noCaller: true, complete: true };
  const earlier = list(history.items).length;
  const stillOpen = Number.isFinite(history.signals?.openCount) ? history.signals.openCount : null;
  const repeat = repeatLine(history.signals?.reopenedHint);
  const complete = readFully(history.access);
  if (!earlier && !repeat) return { ...base, line: complete ? words.noEarlier() : t('Could not check all earlier tickets'), earlier, stillOpen, repeat, complete };
  // What needs a look first: the repeat, then the counts.
  const bits = [];
  if (repeat) bits.push(t('Looks like a repeat'));
  // (a list that is cut short is a lower bound: "At least 10 earlier tickets")
  if (earlier) bits.push(history.truncated === true ? tn(earlier, 'At least {n} earlier ticket', 'At least {n} earlier tickets') : tn(earlier, '{n} earlier ticket', '{n} earlier tickets'));
  if (stillOpen) bits.push(t('{n} still open', { n: stillOpen }));
  // What was found stands; the line adds that it may not be all.
  if (!complete) bits.push(t('some could not be checked'));
  return { ...base, line: bits.join(' · '), earlier, stillOpen, repeat, complete };
}

/** A history item's second line: "In Progress · opened 2026-10-12". */
export const historyLine = (item) => [text(item?.state), text(item?.opened_at) && t('opened {date}', { date: text(item.opened_at).slice(0, 10) })].filter(Boolean).join(' · ');
