// Dates for reports. ServiceNow stores date-times as UTC text ('YYYY-MM-DD HH:MM:SS'); "today" and "this week" are the
// person's own (the browser's time zone). Pure: the time zone offset is a parameter so tests are exact.
import { parseSnTime, formatSnTime } from '../../context/util.js';

export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Minutes west of UTC, as Date#getTimezoneOffset reports it. */
export const localOffset = (ms) => new Date(ms).getTimezoneOffset();

/** "Now" for query text: rounded down to the minute, so equal requests in the same minute share one cache entry. */
export const quantize = (ms) => Math.floor(ms / MINUTE) * MINUTE;

/** The instant the local day containing `ms` began. */
export function startOfLocalDay(ms, offsetMin = localOffset(ms)) {
  const local = ms - offsetMin * MINUTE;
  return Math.floor(local / DAY) * DAY + offsetMin * MINUTE;
}

/** The instant the local week (Monday first) containing `ms` began. */
export function startOfLocalWeek(ms, offsetMin = localOffset(ms)) {
  const dayStart = startOfLocalDay(ms, offsetMin);
  const weekday = new Date(dayStart - offsetMin * MINUTE).getUTCDay(); // 0 = Sunday in local terms
  const sinceMonday = (weekday + 6) % 7;
  return dayStart - sinceMonday * DAY;
}

/** 'Oct 27' for the local day that starts at `startMs`. */
export function dayLabel(startMs, offsetMin = localOffset(startMs)) {
  const d = new Date(startMs - offsetMin * MINUTE);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Bucket starts (oldest first) for the last `count` local days or weeks, ending with the one that holds `now`. */
export function bucketStarts({ now, unit = 'day', count = 14, offsetMin = localOffset(now) }) {
  const n = Math.max(1, Math.min(Number(count) || 1, 120));
  const step = unit === 'week' ? 7 * DAY : DAY;
  const last = unit === 'week' ? startOfLocalWeek(now, offsetMin) : startOfLocalDay(now, offsetMin);
  return Array.from({ length: n }, (_, i) => last - (n - 1 - i) * step);
}

/** Label for each bucket: a day is 'Oct 27', a week is 'Oct 20' (the Monday it starts). */
export const bucketLabels = (starts, offsetMin) => starts.map((s) => dayLabel(s, offsetMin));

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
