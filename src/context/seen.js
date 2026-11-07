// "Did the read see everything it looked at?" One answer, used by every card that is about to say "none", "no" or "nobody", or to go
// green. Pure; names no table and prints nothing (the panel words what it finds).
//
// The rule (audit of 2026-11-07, root cause 3: the panel stated an absence as a fact when it could not see): an absence is stated only
// when the read for it completed, that is, its access entry says 'ok' or 'empty' and none of the reads behind it says 'denied',
// 'error', 'blocked' or 'empty-or-hidden'. Otherwise the line says that the panel could not check, and the card is not green.
//
// What a completed read proves is still limited: 'empty' means the user can see rows of the table and none of them belongs to the
// record. A row rule, a domain or an account scope can hide this record's rows from a user who sees others (it cannot be told), so
// the lines say "found" and "that you can see", and a count of a read that was cut short says "at least" (R-02).

import { STATUS } from './access.js';

/** The statuses of a read that could not see everything. 'skipped' is not one: it is a read not made on purpose (see isNotMade). */
export const NOT_SEEN = Object.freeze([STATUS.DENIED, STATUS.ERROR, STATUS.BLOCKED, STATUS.EMPTY_OR_HIDDEN]);
const NOT_SEEN_SET = new Set(NOT_SEEN);
const SEEN_SET = new Set([STATUS.OK, STATUS.EMPTY]);

const entriesOf = (list) => (Array.isArray(list) ? list.filter((a) => a && typeof a === 'object') : []);

/** The access entries (of any number of lists) that say the read could not see everything. */
export function unseen(...lists) {
  return lists.flatMap(entriesOf).filter((a) => NOT_SEEN_SET.has(a.status));
}

/**
 * Did the reads see everything they looked at? True when no entry says otherwise. An absent list is no complaint, so use readDone for
 * a read that must have run.
 */
export function readFully(...lists) {
  return unseen(...lists).length === 0;
}

/** Did the read run to the end: at least one entry says ok or empty, and none says it could not see (readFully). */
export function readDone(...lists) {
  const all = lists.flatMap(entriesOf);
  return all.some((a) => SEEN_SET.has(a.status)) && readFully(all);
}

/** Is the entry one of a read that was not made on purpose (a skip) rather than one that failed? */
export const isNotMade = (a) => a?.status === STATUS.SKIPPED;

/**
 * Did the read of this source run to the end? Looks at the entries of `source` only (the other sources of an answer may have failed
 * without touching this one). False when the source has no entry.
 */
export function sourceDone(access, source) {
  return readDone(entriesOf(access).filter((a) => a.source === source));
}
