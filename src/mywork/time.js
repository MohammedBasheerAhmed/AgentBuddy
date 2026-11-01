// Short time phrases for My work ("due in 2h 10m", "Read 2 min ago", "waiting 4 d"). Pure: every function takes `now`.

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const ok = (n) => typeof n === 'number' && Number.isFinite(n);

/** A length of time, short: "45m", "2h 10m", "3 d 4 h", "12 d". Under a minute is "1m". */
export function spanText(ms) {
  if (!ok(ms)) return '';
  const total = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours < 24) {
    const minutes = total % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return days < 3 && rest ? `${days} d ${rest} h` : `${days} d`;
}

/** "3 h ago", "2 d ago", "just now". */
export function agoText(at, now) {
  if (!ok(at)) return '';
  if (now - at < MINUTE) return 'just now';
  return `${spanText(now - at)} ago`;
}

/** Whole days from `at` to `now` (0 when less than a day or in the future). */
export const daysSince = (at, now) => (ok(at) ? Math.max(0, Math.floor((now - at) / DAY)) : NaN);

/** "Read just now", "Read 4 min ago", "Read 2 h ago". */
export function readText(readAt, now) {
  if (!ok(readAt)) return '';
  const gone = Math.max(0, now - readAt);
  if (gone < MINUTE) return 'Read just now';
  if (gone < HOUR) return `Read ${Math.floor(gone / MINUTE)} min ago`;
  return `Read ${spanText(gone)} ago`;
}

/**
 * The SLA part of a ticket line: "SLA breached", "SLA due in 2h 10m", "SLA due now", "SLA paused", or the share used when the instance
 * gave no end time. '' for a ticket without an SLA.
 */
export function slaText(sla, now) {
  if (!sla) return '';
  if (sla.breached) return 'SLA breached';
  if (sla.paused) return 'SLA paused';
  if (ok(sla.dueAt)) return sla.dueAt - now <= 0 ? 'SLA due now' : `SLA due in ${spanText(sla.dueAt - now)}`;
  return ok(sla.percentage) ? `SLA ${Math.round(sla.percentage)}% used` : '';
}

/** "updated 3h ago" for the quiet time of a ticket. */
export function idleText(updatedAt, now) {
  if (!ok(updatedAt)) return '';
  const gone = now - updatedAt;
  if (gone < HOUR) return 'updated just now';
  return `updated ${spanText(gone)} ago`;
}

/** Is `at` before the end of the day `now` is in (the panel's own time zone)? */
export function dueToday(at, now) {
  if (!ok(at)) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return at <= end.getTime();
}
