// The change line of the ticket at a glance (audit of 2026-11-07, F6, W-10): a change had the thinnest view of any kind, no risk, no
// window, no approval anywhere but inside the AI-only CAB brief. One line from the columns the glance read brings anyway (src/context/
// specs/insights.js), under the chips:
//   "Normal change · High risk · 2026-11-12 09:00 to 17:00 · Approval: Approved"
// A part the read did not bring is left out, never guessed; a part the user may not read is not "none" (pack.unreadable). No AI. Pure.

import { isolate, t } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// The instance's display values keep their seconds ("2026-11-12 09:00:00"): a window is read in minutes.
const minutes = (value) => text(value).replace(/(\d{1,2}:\d{2}):\d{2}(?!\d)/g, '$1');

/**
 * "2026-11-12 09:00 to 17:00" when both ends are on the same day (the usual window), "start to end" otherwise. '' with neither end; with
 * one end only, that end after "from" or "until".
 */
export function windowText(start, end) {
  const from = minutes(start);
  const to = minutes(end);
  if (from && to) {
    // (the day is everything before the time; two ends of one day share it)
    const day = (s) => s.replace(/[\s,]*\d{1,2}:\d{2}.*$/, '');
    const sameDay = day(from) && day(from) === day(to) && /\d{1,2}:\d{2}/.test(to);
    const time = to.match(/\d{1,2}:\d{2}.*$/)?.[0] || to;
    // (the same labelled text the Changes card uses for a window, already translated: a bare '{from} to {to}' key would match any sentence)
    return t('Window: {start} to {end}', { start: isolate(from), end: isolate(sameDay ? time : to) });
  }
  if (from) return t('from {when}', { when: isolate(from) });
  if (to) return t('until {when}', { when: isolate(to) });
  return '';
}

/**
 * @param {object} pack the `glance` read's pack
 * @returns {string} the line, or '' when the ticket is not a change or the read brought none of it
 */
export function changeLine(pack) {
  if (!pack || typeof pack !== 'object' || pack.kind !== 'change') return '';
  const f = pack.fields || {};
  const kind = text(f.type);
  const risk = text(f.risk);
  const approval = text(f.approval);
  const when = windowText(f.start_date, f.end_date);
  return [
    kind && t('{type} change', { type: isolate(kind) }),
    risk && t('{risk} risk', { risk: isolate(risk) }),
    when,
    approval && t('Approval: {state}', { state: isolate(approval) }),
  ]
    .filter(Boolean)
    .join(' · ');
}
