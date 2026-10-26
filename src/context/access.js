// What a failed or empty read means. The Table API answers HTTP 403 for a table the user may not read, but it answers
// HTTP 200 with zero rows when an ACL filters the rows out. So "no results" proves nothing until a second, unfiltered
// one-row read shows that the user can see the table at all (confirmEmptyIsReallyEmpty). We never try to get around a
// denial: it is reported in the pack's `access` list and the feature works with what it has.
//
// access entry: { source, status, note }
//   status: 'ok' | 'empty' | 'empty-or-hidden' | 'denied' | 'error' | 'skipped'

import { oneLine } from './util.js';

export const STATUS = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty', // read worked, the user can see the table, there is nothing for this record
  EMPTY_OR_HIDDEN: 'empty-or-hidden', // zero rows and the user sees no rows of the table at all: cannot tell which
  DENIED: 'denied',
  ERROR: 'error',
  SKIPPED: 'skipped', // not read on purpose (policy or not needed)
});

export const entry = (source, status, note = '', extra = {}) => ({ source, status, note, ...extra });

export const isSessionExpired = (err) => err?.code === 'SESSION_EXPIRED';
const isAbort = (err) => err?.name === 'AbortError';

/** { status: 'denied' | 'error', note } for an error raised while reading `table`. Session expiry is not handled here. */
export function classifyReadError(err, table) {
  const text = (err && err.message) || String(err || '');
  if (err?.code === 'ACCESS_DENIED' || /\b403\b|not allowed|forbidden|not authorized|security|denied|\bacl\b/i.test(text)) {
    return { status: STATUS.DENIED, note: `Your user cannot read ${table}.` };
  }
  if (/invalid table|\b404\b|does not exist|no such table|unknown table/i.test(text)) {
    return { status: STATUS.ERROR, note: `${table} is not on this instance.` };
  }
  return { status: STATUS.ERROR, note: `Could not read ${table}: ${oneLine(text, 140)}` };
}

/**
 * queryTable that turns a failure into { rows: [], failure: { status, note } }. A lost session and a cancelled request
 * are not read problems: they are thrown so the caller can stop.
 */
export async function softRead(deps, table, query, fields, options = {}) {
  try {
    const rows = await deps.queryTable(table, query, fields, options);
    return { rows: Array.isArray(rows) ? rows : [], failure: null };
  } catch (err) {
    if (isSessionExpired(err) || isAbort(err)) throw err;
    return { rows: [], failure: classifyReadError(err, table) };
  }
}

/**
 * Is an empty answer from `table` really empty? One unfiltered one-row read: when it also returns nothing, the user
 * sees no rows of the table, so "none for this record" would be a guess (a PDI with no data looks the same as an ACL).
 * `memo` (a Map) keeps it to one extra read per table per pack.
 * Returns { status: 'empty' | 'empty-or-hidden' | 'denied' | 'error', note }.
 */
export function confirmEmptyIsReallyEmpty(table, deps, memo) {
  if (memo?.has(table)) return memo.get(table);
  const promise = confirm(table, deps);
  memo?.set(table, promise);
  return promise;
}

async function confirm(table, deps) {
  const { rows, failure } = await softRead(deps, table, '', ['sys_id'], { limit: 1 });
  if (failure) return failure;
  if (rows.length) return { status: STATUS.EMPTY, note: '' };
  return {
    status: STATUS.EMPTY_OR_HIDDEN,
    note: `Your user sees no rows of ${table} at all, so "none for this record" proves nothing: the instance may have none, or an access rule hides them.`,
  };
}
