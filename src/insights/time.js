// Times for the Ticket screen's Insights cards: short spans ("2h 10m", "4 d"), "3 h ago", and turning a note's time into a real
// instant. Pure: the clock comes in as `now`.
//
// Why the time-zone work: notes read from sys_journal_field carry stored UTC times, but when that table is not readable the context
// engine reads the record's own comments and work notes strings, whose times are in the READER's time zone (src/context/journal.js).
// The pack also carries, for the 'insights-ticket' spec, the stored UTC value of sys_updated_on and opened_at (related.times) next to
// their display values (fields): the difference between the two is the reader's offset AT that date, so a local note time can be put
// right. A clock change (summer time) moves the offset, so a note's time is exact only when the dates around it show the same one.

import { isLocalTime } from '../context/journal.js';
import { parseSnTime } from '../context/util.js';
import { t, tn } from '../i18n/index.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MAX_OFFSET = 14 * HOUR; // the widest real UTC offset
const QUARTER = 15 * MIN;

/** "35 min", "2h 10m", "13h", "4 d". Coarse on purpose: the glance is read at a look. '' when not a number. */
export function shortSpan(ms) {
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.round(ms / MIN));
  if (minutes < 1) return t('under 1 min');
  if (minutes < 60) return tn(minutes, '{n} min', '{n} min');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes - hours * 60;
    return rest && hours < 10 ? t('{hours}h {minutes}m', { hours, minutes: rest }) : tn(hours, '{n}h', '{n}h');
  }
  return tn(Math.floor(hours / 24), '{n} d', '{n} d');
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". '' when not a number. A time in the future is "just now". */
export function agoText(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < MIN) return t('just now');
  if (ms < HOUR) return tn(Math.round(ms / MIN), '{n} min ago', '{n} min ago');
  if (ms < 2 * DAY) return tn(Math.round(ms / HOUR), '{n} h ago', '{n} h ago');
  return tn(Math.floor(ms / DAY), '{n} d ago', '{n} d ago');
}

/** "in 3 h", "in 2 d" for a time ahead; agoText for one behind. */
export function relativeText(at, now) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return '';
  const d = at - now;
  if (d <= MIN) return agoText(-d);
  return t('in {span}', { span: shortSpan(d) });
}

/**
 * The reader's UTC offset at each date column the pack has both ways: [{ at: stored instant, offset: display minus stored }], in
 * the order sys_updated_on, opened_at, resolved_at, closed_at. A display format that is not YYYY-MM-DD, or a difference no real time
 * zone has, gives nothing.
 */
function offsetsOf(pack) {
  const times = pack?.related?.times && typeof pack.related.times === 'object' ? pack.related.times : {};
  const out = [];
  for (const name of ['sys_updated_on', 'opened_at', 'resolved_at', 'closed_at']) {
    const stored = parseSnTime(times[name]);
    const shown = parseSnTime(pack?.fields?.[name]);
    if (!Number.isFinite(stored) || !Number.isFinite(shown)) continue;
    const offset = Math.round((shown - stored) / QUARTER) * QUARTER;
    if (Math.abs(offset) <= MAX_OFFSET) out.push({ at: stored, offset });
  }
  return out;
}

/** The reader's UTC offset in milliseconds (display minus stored) at the first of those dates the pack has; null when it cannot be told. */
export function tzOffsetMs(pack) {
  const [first] = offsetsOf(pack);
  return first ? first.offset : null;
}

/**
 * A note's time as an instant: { ms, approx }. A note read from the record's own text is in local time (src/context/journal.js
 * isLocalTime) and is put right with the offset of the nearest date that has one. `approx` is true when that offset may not be the
 * one in force at the note: none is known, or no date on each side of the note (or within an hour of it) shows the same offset, so a
 * clock change may lie between. ms is NaN when the time cannot be read at all.
 */
export function noteInstant(entry, pack) {
  const at = parseSnTime(entry?.when);
  if (!Number.isFinite(at)) return { ms: NaN, approx: true };
  if (!isLocalTime(entry, pack?.access)) return { ms: at, approx: false };
  const refs = offsetsOf(pack);
  if (!refs.length) return { ms: at, approx: true };
  const nearest = (ms) => refs.reduce((best, r) => (Math.abs(r.at - ms) < Math.abs(best.at - ms) ? r : best));
  const ref = nearest(at - nearest(at).offset);
  const ms = at - ref.offset;
  const before = refs.filter((r) => r.at <= ms + HOUR).sort((a, b) => b.at - a.at)[0];
  const after = refs.filter((r) => r.at >= ms - HOUR).sort((a, b) => a.at - b.at)[0];
  const sure = Boolean(before && after) && before.offset === ref.offset && after.offset === ref.offset;
  return { ms, approx: !sure };
}

/** A stored (UTC) date column of the pack as an instant, NaN when it is not there. */
export function storedTime(pack, name) {
  const times = pack?.related?.times && typeof pack.related.times === 'object' ? pack.related.times : {};
  return parseSnTime(times[name]);
}

export const TIME = Object.freeze({ MIN, HOUR, DAY });
