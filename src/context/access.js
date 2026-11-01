// What a failed or empty read means. The Table API answers HTTP 403 for a table the user may not read, but it answers
// HTTP 200 with zero rows when an ACL filters the rows out. So "no results" proves nothing until a second, unfiltered
// one-row read shows that the user can see the table at all (confirmEmptyIsReallyEmpty). We never try to get around a
// denial: it is reported in the pack's `access` list and the feature works with what it has.
//
// access entry: { source, status, note }
//   status: 'ok' | 'empty' | 'empty-or-hidden' | 'denied' | 'error' | 'skipped' | 'blocked'
//   'blocked' is NOT 'denied': the person's user may well be able to read the table, but the organisation's policy (blockedTables)
//   does not let Agent Buddy read it. It is never an empty result and never "you cannot see it".

import { oneLine } from './util.js';

export const STATUS = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty', // read worked, the user can see the table, there is nothing for this record
  EMPTY_OR_HIDDEN: 'empty-or-hidden', // zero rows and the user sees no rows of the table at all: cannot tell which
  DENIED: 'denied',
  ERROR: 'error',
  SKIPPED: 'skipped', // not read on purpose (policy or not needed), or the table is not on this instance (left out quietly)
  BLOCKED: 'blocked', // the organisation's policy does not allow Agent Buddy to read this table (error code BLOCKED_TABLE)
});

export const entry = (source, status, note = '', extra = {}) => ({ source, status, note, ...extra });

export const isSessionExpired = (err) => err?.code === 'SESSION_EXPIRED';
const isAbort = (err) => err?.name === 'AbortError';

export const isBlockedTable = (err) => err?.code === 'BLOCKED_TABLE';

/** { status: 'blocked' | 'denied' | 'error', note } for an error raised while reading `table`. Session expiry is not handled here. */
export function classifyReadError(err, table) {
  const text = (err && err.message) || String(err || '');
  // The policy guard (src/content/policyGuard.js) refused the read: say whose rule it is. Its message names the table that was blocked,
  // which can differ from `table` (a reference answer, a task whose class is blocked).
  if (isBlockedTable(err)) return { status: STATUS.BLOCKED, note: oneLine(text, 200) || `Your organisation does not allow reading ${table}.` };
  if (err?.code === 'ACCESS_DENIED' || /\b403\b|not allowed|forbidden|not authorized|security|denied|\bacl\b/i.test(text)) {
    return { status: STATUS.DENIED, note: `Your user cannot read ${table}.` };
  }
  // A table that is not on this instance (a plugin that is not installed: CSM, HR, chat, knowledge use) is not a problem to show:
  // the part that needed it is left out quietly ('skipped' is never listed as "could not be read"). The note stays for the pack's
  // own record.
  if (isMissingTable(err)) return { status: STATUS.SKIPPED, note: `${table} is not on this instance.` };
  // A read that ran out of time (src/content/tableApi.js READ_TIMEOUT_MS) says so in plain words, without the table's name.
  if (err?.code === 'SN_TIMEOUT') return { status: STATUS.ERROR, note: 'ServiceNow did not answer in time. Try again in a moment.' };
  return { status: STATUS.ERROR, note: `Could not read ${table}: ${oneLine(text, 140)}` };
}

/**
 * Is this the instance saying the table does not exist? The Table API answers HTTP 400 "Invalid table <name>"; other wordings are
 * kept for older releases and the Aggregate API. A 404 counts only with its number in the text (tableApi.js puts it there).
 */
export function isMissingTable(err) {
  const text = (err && err.message) || String(err || '');
  return /invalid table|\b404\b|does not exist|no such table|unknown table/i.test(text);
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
