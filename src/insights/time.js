// Times for the Ticket screen's Insights cards: short spans ("2h 10m", "4 d"), "3 h ago", and turning a note's time into a real
// instant. Pure: the clock comes in as `now`.
//
// Why the time-zone work: notes read from sys_journal_field carry stored UTC times, but when that table is not readable the context
// engine reads the record's own comments and work notes strings, whose times are in the READER's time zone (src/context/journal.js).
// The pack also carries, for the 'insights-ticket' spec, the stored UTC value of sys_updated_on and opened_at (related.times) next to
// their display values (fields): the difference between the two is the reader's offset, so a local note time can be put right.

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
 * The reader's UTC offset in milliseconds (display minus stored), from a date column the pack has both ways; null when it cannot be
 * told (no such column, a display format that is not YYYY-MM-DD, or a difference no real time zone has).
 */
export function tzOffsetMs(pack) {
  const times = pack?.related?.times && typeof pack.related.times === 'object' ? pack.related.times : {};
  for (const name of ['sys_updated_on', 'opened_at', 'resolved_at', 'closed_at']) {
    const stored = parseSnTime(times[name]);
    const shown = parseSnTime(pack?.fields?.[name]);
    if (!Number.isFinite(stored) || !Number.isFinite(shown)) continue;
    const offset = Math.round((shown - stored) / QUARTER) * QUARTER;
    if (Math.abs(offset) <= MAX_OFFSET) return offset;
  }
  return null;
}

/** Were the notes read from the record's own strings (local times) rather than the journal table (UTC)? */
export function notesAreLocal(pack) {
  const entry = (Array.isArray(pack?.access) ? pack.access : []).find((a) => a && a.source === 'journal');
  return Boolean(entry && (entry.strategy === 'record-fields' || entry.strategy === 'mixed'));
}

/**
 * A note's time as an instant: { ms, approx }. `approx` is true when the note was in local time and the offset could not be told
 * (the time may then be off by the reader's offset). ms is NaN when the time cannot be read at all.
 */
export function noteInstant(entry, pack) {
  const at = parseSnTime(entry?.when);
  if (!Number.isFinite(at)) return { ms: NaN, approx: true };
  if (!notesAreLocal(pack)) return { ms: at, approx: false };
  const offset = tzOffsetMs(pack);
  return offset === null ? { ms: at, approx: true } : { ms: at - offset, approx: false };
}

/** A stored (UTC) date column of the pack as an instant, NaN when it is not there. */
export function storedTime(pack, name) {
  const times = pack?.related?.times && typeof pack.related.times === 'object' ? pack.related.times : {};
  return parseSnTime(times[name]);
}

export const TIME = Object.freeze({ MIN, HOUR, DAY });
