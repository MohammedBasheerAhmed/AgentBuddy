// Short time phrases for My work ("due in 2h 10m", "Read 2 min ago", "waiting 4 d"). Pure: every function takes `now`.
// Every phrase is written in the language of the panel (the units too: "2h 10m" is "2 س 10 د"). This file is also read by the page
// script, which has no language set, so it imports the mechanism without the Arabic catalogue (i18n/core.js).
import { t } from '../i18n/core.js';

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const ok = (n) => typeof n === 'number' && Number.isFinite(n);

/** A length of time, short: "45m", "2h 10m", "3 d 4 h", "12 d". Under a minute is "1m". */
export function spanText(ms) {
  if (!ok(ms)) return '';
  const total = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
  if (total < 60) return t('{n}m', { n: total });
  const hours = Math.floor(total / 60);
  if (hours < 24) {
    const minutes = total % 60;
    return minutes ? t('{h}h {m}m', { h: hours, m: minutes }) : t('{h}h', { h: hours });
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return days < 3 && rest ? t('{d} d {h} h', { d: days, h: rest }) : t('{d} d', { d: days });
}

/** "3 h ago", "2 d ago", "just now". */
export function agoText(at, now) {
  if (!ok(at)) return '';
  if (now - at < MINUTE) return t('just now');
  return t('{span} ago', { span: spanText(now - at) });
}

/** "waiting 4 d", "waiting just now": how long a ticket has been in the group queue. */
export function waitingText(at, now) {
  if (!ok(at)) return '';
  if (now - at < MINUTE) return t('waiting just now');
  return t('waiting {span}', { span: spanText(now - at) });
}

/** "asked 3 h ago", "asked just now". */
export function askedText(at, now) {
  if (!ok(at)) return '';
  if (now - at < MINUTE) return t('asked just now');
  return t('asked {span} ago', { span: spanText(now - at) });
}

/** "due 3 h ago", "due just now" (a time that has passed), and "due in 2h 10m" (one ahead). */
export function dueAgoText(at, now) {
  if (!ok(at)) return '';
  if (now - at < MINUTE) return t('due just now');
  return t('due {span} ago', { span: spanText(now - at) });
}
export const dueInText = (ms) => t('due in {span}', { span: spanText(ms) });

/** Whole days from `at` to `now` (0 when less than a day or in the future). */
export const daysSince = (at, now) => (ok(at) ? Math.max(0, Math.floor((now - at) / DAY)) : NaN);

/** "Read just now", "Read 4 min ago", "Read 2 h ago". */
export function readText(readAt, now) {
  if (!ok(readAt)) return '';
  const gone = Math.max(0, now - readAt);
  if (gone < MINUTE) return t('Read just now');
  if (gone < HOUR) return t('Read {n} min ago', { n: Math.floor(gone / MINUTE) });
  return t('Read {span} ago', { span: spanText(gone) });
}

/** "just now", "4 min ago", "2 h ago": when it was read, for a sentence that already says "read". */
export function readWhen(readAt, now) {
  if (!ok(readAt)) return '';
  const gone = Math.max(0, now - readAt);
  if (gone < MINUTE) return t('just now');
  if (gone < HOUR) return t('{n} min ago', { n: Math.floor(gone / MINUTE) });
  return t('{span} ago', { span: spanText(gone) });
}

/**
 * The SLA part of a ticket line: "SLA breached", "SLA due in 2h 10m", "SLA due now", "SLA paused", or the share used when the instance
 * gave no end time. '' for a ticket without an SLA.
 */
export function slaText(sla, now) {
  if (!sla) return '';
  if (sla.breached) return t('SLA breached');
  if (sla.paused) return t('SLA paused');
  if (ok(sla.dueAt)) return sla.dueAt - now <= 0 ? t('SLA due now') : t('SLA due in {span}', { span: spanText(sla.dueAt - now) });
  return ok(sla.percentage) ? t('SLA {percent}% used', { percent: Math.round(sla.percentage) }) : '';
}

/** "updated 3h ago" for the quiet time of a ticket. */
export function idleText(updatedAt, now) {
  if (!ok(updatedAt)) return '';
  const gone = now - updatedAt;
  if (gone < HOUR) return t('updated just now');
  return t('updated {span} ago', { span: spanText(gone) });
}

/** Is `at` before the end of the day `now` is in (the panel's own time zone)? */
export function dueToday(at, now) {
  if (!ok(at)) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return at <= end.getTime();
}
