// Dates for reports. ServiceNow stores date-times as UTC text ('YYYY-MM-DD HH:MM:SS'); "today" and "this week" are the
// person's own (the browser's time zone). Pure: the time zone is a parameter so tests are exact.
//
// A time zone is given as minutes west of UTC (Date#getTimezoneOffset): either one fixed number, or a function of the instant
// (the default, `localOffset`), which is what a zone with summer time needs. With a fixed number a day that starts in winter time
// but is looked at in summer time would begin an hour early or late: on the day the clocks change "opened today" counted one hour
// of yesterday (or missed one hour of today), and every daily bucket before the change was shifted by that hour.
import { parseSnTime, formatSnTime } from '../../context/util.js';
import { say, tm } from './say.js';

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

// ---- The person's ServiceNow time zone ---------------------------------------------------------------------------------------
// "Today" and "this week" are the person's days. ServiceNow keeps a time zone per user (sys_user.time_zone, a name such as
// "Europe/Berlin" or "US/Pacific"); when it can be read and the browser knows it, the reports count days in it. Otherwise they use
// the browser's zone and say so once.

const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]{0,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;

/**
 * A time zone function (minutes west of UTC at an instant, as Date#getTimezoneOffset) for a zone name, or null when the name is
 * empty, malformed or unknown to this browser. Pure apart from the browser's time zone data (Intl).
 */
export function zoneOffset(name) {
  const zone = String(name || '').trim();
  if (!ZONE_RE.test(zone)) return null;
  let format;
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch {
    return null; // RangeError: a zone this browser does not know
  }
  return (ms) => {
    const at = Math.floor(Number(ms) / 1000) * 1000;
    if (!Number.isFinite(at)) return 0;
    const p = Object.fromEntries(format.formatToParts(new Date(at)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return Math.round((at - wall) / MINUTE);
  };
}

/** The browser's own zone name ('Europe/Berlin'), or '' when the browser does not say. */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Which zone the reports count days in. `snZone` is the person's ServiceNow time zone as read ('' when empty, null when it could
 * not be read). Returns { id, source: 'servicenow' | 'browser', tz (offset function), note }: `note` is '' when nothing needs
 * saying (the ServiceNow zone was used, or it is the browser's anyway). Pure apart from Intl.
 */
export function chooseZone(snZone, { browser = browserZone(), local = localOffset } = {}) {
  const wanted = typeof snZone === 'string' ? snZone.trim() : '';
  const tz = wanted ? zoneOffset(wanted) : null;
  if (tz) return { id: wanted, source: 'servicenow', tz, note: '' };
  const where = browser ? say(tm("your browser's time zone ({zone})"), { zone: browser }) : tm("your browser's time zone");
  let note;
  if (snZone === null || snZone === undefined) note = say(tm('"Today" is counted in {where}: your ServiceNow time zone could not be read.'), { where });
  else if (!wanted) note = say(tm('"Today" is counted in {where}: your ServiceNow profile uses the system time zone, which Agent Buddy cannot read.'), { where });
  else note = say(tm('"Today" is counted in {where}: this browser does not know your ServiceNow time zone ({zone}).'), { where, zone: wanted.slice(0, 40) });
  return { id: browser, source: 'browser', tz: local, note };
}

/** "Now" for query text: rounded down to the minute, so equal requests in the same minute share one cache entry. */
export const quantize = (ms) => Math.floor(ms / MINUTE) * MINUTE;

// A local calendar date is handled as "that date at 00:00 UTC" (a whole number of days), so date arithmetic needs no zone.
const localDateOf = (ms, tz) => Math.floor((ms - offsetAt(tz, ms) * MINUTE) / DAY) * DAY;

/**
 * The first instant whose local date is `localDate`: its midnight, with the offset in force at that moment (not the offset of today).
 * Two offsets can apply on a day the clocks change: the one before and the one after. Where the clocks jump forward AT midnight
 * (America/Santiago, 00:00 -> 01:00) local midnight never happens and only one of the two lands inside the day; the other is the
 * evening before, which would put an hour of yesterday into "today" and label the bucket with yesterday's date. So both are tried, and
 * the earliest that falls on the day wins.
 */
function instantOfLocalDate(localDate, tz) {
  const before = localDate + offsetAt(tz, localDate) * MINUTE;
  const after = localDate + offsetAt(tz, before) * MINUTE;
  const onTheDay = [before, after].filter((ms) => localDateOf(ms, tz) === localDate);
  return onTheDay.length ? Math.min(...onTheDay) : after;
}

/** The instant the local day containing `ms` began. */
export function startOfLocalDay(ms, tz = localOffset) {
  return Math.min(ms, instantOfLocalDate(localDateOf(ms, tz), tz));
}

const mondayOf = (localDate) => localDate - ((new Date(localDate).getUTCDay() + 6) % 7) * DAY; // getUTCDay of a local date = local weekday

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

/**
 * Calendar days in the person's zone from the day of `fromMs` to the day of `toMs`: 0 on the same day, 1 for a ticket opened yesterday
 * evening and looked at this morning (13 hours, but not "opened today"). Never negative.
 */
export const localDaysBetween = (fromMs, toMs, tz = localOffset) => Math.max(0, Math.round((localDateOf(toMs, tz) - localDateOf(fromMs, tz)) / DAY));

/** How many local weeks (Monday first) from the one holding `fromMs` to the one holding `toMs`, both counted. At least 1. */
export const localWeeksCovering = (fromMs, toMs, tz = localOffset) => Math.max(1, Math.round((mondayOf(localDateOf(toMs, tz)) - mondayOf(localDateOf(fromMs, tz))) / (7 * DAY)) + 1);

/** A ServiceNow date-time text (UTC) for an instant: the literal used inside a query. */
export const snLiteral = (ms) => formatSnTime(ms);

/** ms for a stored date-time cell; NaN when it is empty or not a date. */
export const timeOf = (text) => parseSnTime(text);

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
