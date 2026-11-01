// N25 and N26: changes on the same configuration item or service, and problems / known errors for it. Pure shaping of what the
// `ciChanges` and `knownErrors` reads return (src/content/ops/insights.js).

import { parseSnTime } from '../context/util.js';
import { TIME, agoText, shortSpan } from './time.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Where a change's window is, seen from now: { when: 'past'|'now'|'next'|'unknown', line: 'ended 2 d ago' | 'in progress now' |
 * 'starts in 3 d', at: ms } (at: the end for a past window, the start otherwise).
 */
export function changeTiming(change, now) {
  const start = parseSnTime(change?.startUtc);
  const end = parseSnTime(change?.endUtc);
  if (Number.isFinite(end) && end <= now) return { when: 'past', line: `ended ${agoText(now - end)}`, at: end };
  if (Number.isFinite(start) && start <= now) return { when: 'now', line: 'in its window now', at: start };
  if (Number.isFinite(start)) return { when: 'next', line: `starts in ${shortSpan(start - now)}`, at: start };
  return { when: 'unknown', line: '', at: NaN };
}

/**
 * The changes, most relevant first: in their window now, then the ones that ended most recently, then the upcoming ones.
 * @returns {{ items: object[], recent: number, summary: string }} recent: ended in the last 3 days or running now
 */
export function arrangeChanges(changes, now) {
  const order = { now: 0, past: 1, next: 2, unknown: 3 };
  const items = (Array.isArray(changes) ? changes : [])
    .filter((c) => c && text(c.number))
    .map((c) => ({ ...c, timing: changeTiming(c, now) }))
    .sort((a, b) => order[a.timing.when] - order[b.timing.when] || (a.timing.when === 'next' ? a.timing.at - b.timing.at : b.timing.at - a.timing.at));
  const recent = items.filter((c) => c.timing.when === 'now' || (c.timing.when === 'past' && now - c.timing.at <= 3 * TIME.DAY)).length;
  const summary = !items.length ? '' : recent ? `${recent} in the last 3 days` : `${items.length} nearby`;
  return { items, recent, summary };
}

/** Problems with a workaround first, then known errors, then the rest (newest first within each). */
export function arrangeProblems(problems) {
  const rank = (p) => (text(p.workaround) ? 0 : p.knownError ? 1 : 2);
  return (Array.isArray(problems) ? problems : [])
    .filter((p) => p && text(p.number))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map((x) => x.p);
}
