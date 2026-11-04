// Small text helpers for report screens. Pure.
import { isRtl, isolate, t, tn } from '../../i18n/index.js';

// The digits stay 0-9 in Arabic, as in ServiceNow itself.
const dateLocale = () => (isRtl() ? 'ar-u-nu-latn' : undefined);

/** '14:05' in the person's own time zone. */
export function clock(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'Today 14:05' or 'Oct 26 14:05'. */
export function readLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return clock(ms);
  return `${d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })} ${clock(ms)}`;
}

/** 'a, b and c'. */
export function andList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return t('{start} and {last}', { start: list.slice(0, -1).join(t(', ')), last: list[list.length - 1] });
}

/** Hours as '5.2 h' / '3.4 d'. */
export function hours(h) {
  if (!Number.isFinite(h)) return '';
  if (h < 1) return t('{n} min', { n: Math.max(1, Math.round(h * 60)) });
  if (h < 48) return t('{n} h', { n: Math.round(h * 10) / 10 });
  const days = Math.round((h / 24) * 10) / 10;
  return tn(days, '{n} day', '{n} days');
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- Relative times ("due in 1 h 20 min") ------------------------------------------------------------------------------------
// A lead scanning a list wants "how long", not a timestamp in someone's format: an SLA's end is said relative to the moment the
// numbers were read.

const MIN = 60000;

/** A span as '45 min', '1 h 20 min', '3 d 4 h'. Never negative; under a minute is 'less than a minute'. */
export function span(ms) {
  const m = Math.floor(Math.abs(Number(ms)) / MIN);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return t('less than a minute');
  if (m < 60) return t('{n} min', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 && h < 10 ? t('{h} h {m} min', { h, m: m % 60 }) : t('{n} h', { n: h });
  const d = Math.floor(h / 24);
  return h % 24 ? t('{d} d {h} h', { d, h: h % 24 }) : t('{n} d', { n: d });
}

/**
 * When an SLA ends, in words, from `item` = { endMs, breached, paused, plannedEnd } and the moment `now`:
 * 'Paused', 'Breached 2 h ago', 'Overdue by 10 min', 'Due in 1 h 20 min'. Falls back to the instance's own text (plannedEnd) when
 * the stored time is not known.
 */
export function dueText(item, now = Date.now()) {
  if (!item) return '';
  if (item.paused) return t('Paused');
  const end = Number(item.endMs);
  const known = item.endMs !== null && item.endMs !== undefined && Number.isFinite(end);
  if (item.breached) return known && end <= now ? t('Breached {span} ago', { span: span(now - end) }) : t('Breached');
  if (!known) return item.plannedEnd ? t('Due {date}', { date: isolate(item.plannedEnd) }) : '';
  return end <= now ? t('Overdue by {span}', { span: span(now - end) }) : t('Due in {span}', { span: span(end - now) });
}

/**
 * '3 days old', '1 day old', 'opened today' for an age in calendar days in the person's zone, as the engine gives it (ageDays): 0 is
 * only ever a ticket opened today.
 */
export const ageText = (days) => (!Number.isFinite(days) ? '' : days <= 0 ? t('opened today') : tn(days, '{n} day old', '{n} days old'));
