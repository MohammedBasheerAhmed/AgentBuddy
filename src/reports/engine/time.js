// Dates for reports. ServiceNow stores date-times as UTC text ('YYYY-MM-DD HH:MM:SS'); "today" and "this week" are the
// person's own (the browser's time zone). Pure: the time zone is a parameter so tests are exact.
//
// A time zone is given as minutes west of UTC (Date#getTimezoneOffset): either one fixed number, or a function of the instant
// (the default, `localOffset`), which is what a zone with summer time needs. With a fixed number a day that starts in winter time
// but is looked at in summer time would begin an hour early or late: on the day the clocks change "opened today" counted one hour
// of yesterday (or missed one hour of today), and every daily bucket before the change was shifted by that hour.
import { parseSnTime, formatSnTime } from '../../context/util.js';

export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Minutes west of UTC at the instant `ms`, as Date#getTimezoneOffset reports it (the browser's zone, summer time included). */
export const localOffset = (ms) => new Date(ms).getTimezoneOffset();

/** The offset (minutes west of UTC) a time zone has at `ms`: `tz` is a fixed number or a function of the instant. */
export function offsetAt(tz, ms) {
  const n = typeof tz === 'function' ? Number(tz(ms)) : Number(tz);
  // Real zones lie within UTC-12 and UTC+14; anything else (NaN, a typo) falls back to the browser's own zone.
  return Number.isFinite(n) && Math.abs(n) <= 16 * 60 ? n : localOffset(ms);
}

/** "Now" for query text: rounded down to the minute, so equal requests in the same minute share one cache entry. */
export const quantize = (ms) => Math.floor(ms / MINUTE) * MINUTE;

// A local calendar date is handled as "that date at 00:00 UTC" (a whole number of days), so date arithmetic needs no zone.
const localDateOf = (ms, tz) => Math.floor((ms - offsetAt(tz, ms) * MINUTE) / DAY) * DAY;

/** The instant local midnight of `localDate` was, with the offset in force at that moment (not the offset of today). */
function instantOfLocalDate(localDate, tz) {
  const guess = localDate + offsetAt(tz, localDate) * MINUTE;
  return localDate + offsetAt(tz, guess) * MINUTE;
}

/** The instant the local day containing `ms` began. */
export function startOfLocalDay(ms, tz = localOffset) {
  return Math.min(ms, instantOfLocalDate(localDateOf(ms, tz), tz));
}

const mondayOf = (localDate) => localDate - ((new Date(localDate).getUTCDay() + 6) % 7) * DAY; // getUTCDay of a local date = local weekday

/** The instant the local week (Monday first) containing `ms` began. */
export function startOfLocalWeek(ms, tz = localOffset) {
  return Math.min(ms, instantOfLocalDate(mondayOf(localDateOf(ms, tz)), tz));
}

/** 'Oct 27' for the local day that starts at `startMs`. */
export function dayLabel(startMs, tz = localOffset) {
  const d = new Date(startMs - offsetAt(tz, startMs) * MINUTE);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Bucket starts (oldest first) for the last `count` local days or weeks, ending with the one that holds `now`. Each start is that
 * day's own local midnight, so a bucket that spans a change to or from summer time is 23 or 25 hours long, as the day was.
 * (`offsetMin` is the time zone: a number or a function, see the top of this file.)
 */
export function bucketStarts({ now, unit = 'day', count = 14, offsetMin = localOffset }) {
  const n = Math.max(1, Math.min(Number(count) || 1, 120));
  const stepDays = unit === 'week' ? 7 : 1;
  const today = localDateOf(now, offsetMin);
  const last = unit === 'week' ? mondayOf(today) : today;
  return Array.from({ length: n }, (_, i) => instantOfLocalDate(last - (n - 1 - i) * stepDays * DAY, offsetMin));
}

/** Label for each bucket: a day is 'Oct 27', a week is 'Oct 20' (the Monday it starts). */
export const bucketLabels = (starts, offsetMin = localOffset) => starts.map((s) => dayLabel(s, offsetMin));

/**
 * Count timestamps (ms) into buckets. `starts` is ascending; a bucket runs until the next start (the last one for `step` ms).
 * Timestamps before the first start or from now on are ignored. Non-finite values are ignored.
 */
export function bucketCounts(timestamps, starts, step = DAY) {
  const counts = new Array(starts.length).fill(0);
  if (!starts.length) return counts;
  const end = starts[starts.length - 1] + step;
  for (const t of timestamps) {
    if (!Number.isFinite(t) || t < starts[0] || t >= end) continue;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    counts[lo] += 1;
  }
  return counts;
}

/** Whole days between two instants (never negative). */
export const daysBetween = (fromMs, toMs) => Math.max(0, Math.floor((toMs - fromMs) / DAY));

/** A ServiceNow date-time text (UTC) for an instant: the literal used inside a query. */
export const snLiteral = (ms) => formatSnTime(ms);

/** ms for a stored date-time cell; NaN when it is empty or not a date. */
export const timeOf = (text) => parseSnTime(text);

/** Hours as 'x.y h' / 'x.y d' for people. */
export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return '';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

export const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mean = (values) => {
  const list = values.filter(Number.isFinite);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN;
};
