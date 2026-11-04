// Plain-language reading of the state words ServiceNow shows ("Closed Complete", "Work in Progress", "Requested"...).
// Shared by the request explainer and the resolution check. Pure: no I/O.
//
// Everything here works on DISPLAY values (what the person sees), because the stored numbers differ between releases and
// between tables. A word that is not recognised never counts as closed or as an approval: unknown stays unknown.

import { isolate, t } from '../i18n/index.js';

const text = (v) => String(v ?? '').trim();

// Closed / finished states of requests, items, tasks, incidents, problems and cases.
const FINISHED = /(^|[^a-z])(closed|cancel{1,2}ed|skipped|resolved|complete|completed|fulfilled|delivered|withdrawn|rejected)([^a-z]|$)/i;
// ... and the ones among them that mean "it ended without being done".
const NOT_DONE = /incomplete|cancel|skipped|reject|withdrawn|declin/i;

/** Is this state text a finished one (closed, resolved, cancelled, complete...)? */
export const isFinishedState = (state) => FINISHED.test(text(state));

/**
 * 'done' (finished and fulfilled), 'ended' (closed without being done: cancelled, skipped, incomplete, rejected) or
 * '' (not finished, or not a state we recognise).
 */
export function finishedKind(state) {
  const s = text(state);
  if (!FINISHED.test(s)) return '';
  return NOT_DONE.test(s) ? 'ended' : 'done';
}

/** On hold or pending (waiting for something outside the work itself)? */
export const isHoldState = (state) => /(^|[^a-z])(on[ -]?hold|hold|pending|awaiting|waiting)([^a-z]|$)/i.test(text(state));

/**
 * What an approval row or an approval column says: 'approved' | 'rejected' | 'pending' (asked, no answer yet) |
 * 'queued' (not asked yet) | 'ignored' (cancelled, not required, duplicate) | ''.
 */
export function approvalKind(state) {
  const s = text(state).toLowerCase();
  if (!s) return '';
  if (/not\s+(yet\s+)?requested|not\s+yet\s+asked|waiting\s+for\s+(a\s+)?previous/.test(s)) return 'queued';
  if (/reject|declin|denied/.test(s)) return 'rejected';
  if (/cancel|not\s+required|no\s+longer|duplicate|skipped|bypass/.test(s)) return 'ignored';
  if (/approved/.test(s)) return 'approved';
  if (/request|await|pending|waiting|ask/.test(s)) return 'pending';
  return '';
}

/**
 * Is a child or catalog task (or a requested item) still open? Uses its `active` flag when the instance gave one
 * ('true' / 'false'); otherwise the state text decides, and a state that is not recognised counts as open (fail towards
 * "look at it").
 */
export function isOpenItem(item) {
  if (item?.active === 'true') return true;
  if (item?.active === 'false') return false;
  return !isFinishedState(item?.state);
}

/** "Beth Anglin in Desktop Support", "Desktop Support", "Beth Anglin" or '' for a task row. */
export function ownerOf(item) {
  const person = text(item?.assignedTo);
  const group = text(item?.assignmentGroup);
  if (person && group) return t('{person} in {group}', { person: isolate(person), group: isolate(group) });
  return person || group;
}

/**
 * Days, with the fraction, between `then` (a ServiceNow 'YYYY-MM-DD HH:MM:SS' time, UTC) and `now` (ms); negative for a time ahead;
 * NaN when the time cannot be read. (My work's wholeDaysSince, src/mywork/time.js, takes milliseconds and rounds down.)
 */
export function daysSinceSnTime(then, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text(then));
  if (!m) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return (now - ms) / 86400000;
}
