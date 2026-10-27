// Small text helpers for report screens. Pure.

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
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock(ms)}`;
}

/** 'a, b and c'. */
export function andList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Hours as '5.2 h' / '3.4 d'. */
export function hours(h) {
  if (!Number.isFinite(h)) return '';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
