// The weeks the weekly views count (round 5, docs/round5.md): Monday to Sunday in the person's own time zone, and the week they are
// compared with. Pure: the time zone is a parameter (src/reports/engine/time.js), so tests are exact.
//
//   which 'last'  the last whole week (Monday to Sunday), against the week before it. Both are whole, so the two are like for like.
//   which 'this'  this week so far (Monday to now), against the SAME span of last week (Monday to the same weekday and time). A whole
//                 last week against half of this one would show every number as "down" until Friday: that is not a comparison.
import { MINUTE, bucketStarts, offsetAt } from '../engine/time.js';

export const WEEK_CHOICES = Object.freeze(['last', 'this']);

/** 'last' or 'this': anything else is 'last' (the panel's request is checked in the content script). */
export const cleanWhich = (which) => (WEEK_CHOICES.includes(which) ? which : 'last');

/** The local calendar day of an instant in the person's zone: { y, m (1-12), d, wd (0 = Sunday) }. */
export function localParts(ms, tz) {
  const d = new Date(ms - offsetAt(tz, ms) * MINUTE);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}

/**
 * The window the numbers are counted in and the one they are compared with, as instants (ms), half open: start <= t < end.
 * @param {{ now: number, tz?: number | ((ms: number) => number), which?: 'last' | 'this' }} options
 * @returns {{ which, partial: boolean, current: { start, end }, previous: { start, end }, first: object, last: object }}
 *   `first` and `last` are the local days the current window starts and ends on (localParts), for the label "9 to 15 Nov".
 */
export function weekWindows({ now, tz, which = 'last' } = {}) {
  const kind = cleanWhich(which);
  // The three Mondays, oldest first: two weeks back, last week's, and this week's (the week that holds `now`).
  const [weekBefore, lastWeek, thisWeek] = bucketStarts({ now, unit: 'week', count: 3, offsetMin: tz });

  if (kind === 'this') {
    const end = Math.max(thisWeek, now);
    const span = end - thisWeek;
    const current = { start: thisWeek, end };
    const previous = { start: lastWeek, end: Math.min(thisWeek, lastWeek + span) };
    return { which: kind, partial: true, current, previous, first: localParts(current.start, tz), last: localParts(Math.max(current.start, current.end - 1), tz) };
  }
  const current = { start: lastWeek, end: thisWeek };
  const previous = { start: weekBefore, end: lastWeek };
  return { which: kind, partial: false, current, previous, first: localParts(current.start, tz), last: localParts(current.end - 1, tz) };
}
