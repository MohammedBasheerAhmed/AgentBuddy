// Can the requester read the comments on this catalog task? (wave 6, the catalog fulfiller.) One of three answers, worked out from what the
// ticket's own read already holds (no new read): true, false, or null when it cannot be told.
//
// Why it is not simply "no". The platform does not decide it (docs/live-checks-2026-11-07.md): a person can read a catalog task only by its
// read rule (the condition is `opened_by` = that person, plus scripted rules), and the task's comments have no field rule, so whoever can
// read the task reads its comments. So:
//   the person who opened the task IS the requester   the requester can read the task, and so its comments       -> true
//   someone else opened it                            the requester may not see the task or its comments        -> false
//   either is not known (a column the person cannot read, nobody named, the people not told apart)   -> null: the wording stays careful
//
// The words are in src/lib/fillable.js (describeInsert, catalogCommentCaution); this only decides which of the three applies. Only a catalog
// task: a plain task, a problem or an incident has other rules and keeps the careful wording (or, for an incident, the customer's).
//
// The pack lists each person once (src/context/people.js): when the opener and the requester are one person only one of the two roles is in
// `people`, so a missing role is read from the names the pack's fields hold, never guessed from a missing person.

import { sameId } from '../context/util.js';

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * @param {object|null} pack  a catalog task's pack that lists `opened_by` and `requested_for` among its fields (the Ticket screen's glance read)
 * @returns {true|false|null}
 */
export function requesterCanRead(pack) {
  if (pack?.kind !== 'catalog_task') return null;
  const unreadable = Array.isArray(pack.unreadable) ? pack.unreadable : [];
  if (unreadable.includes('opened_by') || unreadable.includes('requested_for')) return null;
  const fields = pack.fields && typeof pack.fields === 'object' ? pack.fields : {};
  const openerName = clean(fields.opened_by);
  const requesterName = clean(fields.requested_for);
  if (!openerName || !requesterName) return null; // nobody named for one of them: that is not "someone else"

  const people = Array.isArray(pack.people) ? pack.people : [];
  const opener = people.find((p) => p?.role === 'opened_by' && p.sysId);
  const requester = people.find((p) => p?.role === 'requested_for' && p.sysId);
  // Both are listed with their ids: the ids decide.
  if (opener && requester) return sameId(opener.sysId, requester.sysId);

  // One of the two roles is missing from the list: either they are one person (listed once), or the other was folded into an earlier role of
  // the same person. Different names are different people; the same name is one person only when exactly one person of that name is listed.
  if (openerName !== requesterName) return false;
  const ids = new Set(people.filter((p) => clean(p?.name) === openerName && p.sysId).map((p) => String(p.sysId).toLowerCase()));
  return ids.size === 1 ? true : null;
}

/**
 * The record the answers are drawn for, with the boolean on it when it is known (the same record, untouched, when it is not): the insert path
 * reads `record.requesterCanRead` for the words of the comment choices (src/sidepanel/insertFlow.js). Never stored; panel memory only.
 */
export const recordWithReads = (record, reads) => (reads === true || reads === false ? { ...record, requesterCanRead: reads } : record);
