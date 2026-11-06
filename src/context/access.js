// What a failed or empty read means. The Table API answers HTTP 403 for a table the user may not read, but it answers
// HTTP 200 with zero rows when an ACL filters the rows out. So "no results" proves nothing until a second, unfiltered
// one-row read shows that the user can see the table at all (confirmEmptyIsReallyEmpty). We never try to get around a
// denial: it is reported in the pack's `access` list and the feature works with what it has.
//
// access entry: { source, status, note, reason? }
//   status: 'ok' | 'empty' | 'empty-or-hidden' | 'denied' | 'error' | 'skipped' | 'blocked'
//   'blocked' is NOT 'denied': the person's user may well be able to read the table, but the organisation's policy (blockedTables)
//   does not let Agent Buddy read it. It is never an empty result and never "you cannot see it".
//   reason (round 4): WHY the instance refused or limited the read, when the read layer could tell (READ_REASON below). Most readers
//   build their entries from `status` and `note` only, so the note of each new reason is a fixed sentence that says the same thing:
//   readReasonOf finds the reason again from it.

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

// ---- Why a read failed ------------------------------------------------------------------------------------------------------------
//
// The read layer (src/content/tableApi.js) tells apart the ways an instance refuses or limits a read and puts the reason on the error;
// classifyReadError carries it onto the failure; readFailureText says it to the person. Nothing here retries or reads another way: a
// refusal is shown as one (build rule 9).

/** Why a read did not give its rows. */
export const READ_REASON = Object.freeze({
  ACL: 'acl', // 403: an access rule (ACL) does not let this user read the table or its rows
  POLICY: 'policy', // 403: the organisation restricts this kind of read (a REST API access policy, the Table API closed to the role)
  RATE_LIMITED: 'rate-limited', // 429 after the retries: the instance is limiting requests
  UNAVAILABLE: 'unavailable', // 503 (or 502, 504) after the retries: busy or under maintenance
  NOT_DATA: 'not-data', // a page (HTML) or something else where data was asked for: a sign-in or maintenance page
  SESSION: 'session', // the ServiceNow session ended (401, a login page)
  TIMEOUT: 'timeout', // no answer within the read's time limit
  MISSING: 'missing', // the table (or a column the read needs) is not on this instance: left out quietly
  BLOCKED: 'blocked', // the organisation's policy does not let Agent Buddy read the table (BLOCKED_TABLE)
  NOT_FOUND: 'not-found', // the record is not there for this user (deleted, or hidden by an ACL)
  ERROR: 'error', // anything else
});
const REASONS = new Set(Object.values(READ_REASON));

/** The error codes the read layer gives the new reasons; a code survives the trip from the content script to the panel. */
export const READ_CODE = Object.freeze({ RATE_LIMITED: 'SN_RATE_LIMITED', UNAVAILABLE: 'SN_UNAVAILABLE', NOT_DATA: 'SN_NOT_DATA' });

const REASON_BY_CODE = Object.freeze({
  SESSION_EXPIRED: READ_REASON.SESSION,
  SN_TIMEOUT: READ_REASON.TIMEOUT,
  BLOCKED_TABLE: READ_REASON.BLOCKED,
  NOT_FOUND: READ_REASON.NOT_FOUND,
  [READ_CODE.RATE_LIMITED]: READ_REASON.RATE_LIMITED,
  [READ_CODE.UNAVAILABLE]: READ_REASON.UNAVAILABLE,
  [READ_CODE.NOT_DATA]: READ_REASON.NOT_DATA,
});

// Marks a text for translation: scripts/lib/i18nCheck.js reads tm('...') as a key, and the panel shows it with t(). The engine may not
// import src/i18n (tests/context-purity.test.js), so the marker is this local copy; like the real one it returns the text unchanged.
const tm = (text) => text;

/**
 * The fixed sentences of the new reasons. The read layer uses them as the error's message and classifyReadError as the entry's note,
 * so they reach the panel whichever way a reader passes a failure on; they name no table and no API.
 */
export const READ_TEXT = Object.freeze({
  policy: tm('Your organisation blocks this kind of read for your role. Ask your ServiceNow admin.'),
  rateLimited: tm('ServiceNow is limiting requests. Try again in a minute.'),
  unavailable: tm('ServiceNow is busy or under maintenance. Try again in a few minutes.'),
  notData: tm('ServiceNow answered with a page instead of data: sign in again, or the instance may be under maintenance.'),
  timeout: tm('ServiceNow did not answer in time. Try again in a moment.'),
  session: tm('Your ServiceNow session has expired. Sign in to ServiceNow again (reload the page), then try again.'),
});

const REASON_BY_TEXT = new Map([
  [READ_TEXT.policy, READ_REASON.POLICY],
  [READ_TEXT.rateLimited, READ_REASON.RATE_LIMITED],
  [READ_TEXT.unavailable, READ_REASON.UNAVAILABLE],
  [READ_TEXT.notData, READ_REASON.NOT_DATA],
  [READ_TEXT.timeout, READ_REASON.TIMEOUT],
  [READ_TEXT.session, READ_REASON.SESSION],
]);
const reasonOfText = (text) => REASON_BY_TEXT.get(String(text ?? '').trim()) || '';

// The sentences about one thing that could not be read ("Earlier tickets: ..."), for a whole read that failed.
const THING_TEXT = Object.freeze({
  [READ_REASON.ACL]: tm('{thing}: not available to you with your role.'),
  [READ_REASON.POLICY]: tm('{thing}: your organisation blocks this kind of read for your role. Ask your ServiceNow admin.'),
  [READ_REASON.MISSING]: tm('{thing}: not on this ServiceNow instance.'),
  [READ_REASON.BLOCKED]: tm('{thing}: your organisation does not let Agent Buddy read this.'),
  [READ_REASON.NOT_FOUND]: tm('{thing}: not available to you.'),
});
const INSTANCE_TEXT = Object.freeze({
  [READ_REASON.RATE_LIMITED]: READ_TEXT.rateLimited,
  [READ_REASON.UNAVAILABLE]: READ_TEXT.unavailable,
  [READ_REASON.NOT_DATA]: READ_TEXT.notData,
  [READ_REASON.TIMEOUT]: READ_TEXT.timeout,
  [READ_REASON.SESSION]: READ_TEXT.session,
});

// A 403 is either an access rule on the data (ACL) or the organisation closing this kind of request to the role (a REST API access
// policy, the Table API restricted, a table closed to web services). ServiceNow's JSON error says which only in words, so the words
// decide; wording that names an ACL or read permission wins, and a 403 that says neither is an ACL (build rule 9: "you can't see it").
// Unverified wordings: docs/live-questions/reads.md, question 3.
const ACL_WORDS = /\bacls?\b|security constraint|insufficient rights|permission to be read|not permitted to read|no read access/i;
const POLICY_WORDS = /access polic|api access|rest api|rest_api|web service|snc_platform_rest_api_access|\buser not authori[sz]ed\b/i;

/** 'acl' or 'policy' for the text of a 403 answer (ServiceNow's "message - detail"). */
export function deniedReason(text) {
  const said = String(text ?? '');
  if (ACL_WORDS.test(said)) return READ_REASON.ACL;
  return POLICY_WORDS.test(said) ? READ_REASON.POLICY : READ_REASON.ACL;
}

/**
 * The reason of a failed read, from what the panel or a reader has: an error (its `reason`, its `code`, the fixed sentence of its
 * message), an access entry (its `reason`, its note, its status) or a message alone. '' when it is not a failure (ok, empty, a
 * skip on purpose).
 */
export function readReasonOf(failure) {
  if (failure === null || failure === undefined || failure === '') return '';
  if (typeof failure === 'string') return reasonOfText(failure);
  if (typeof failure !== 'object') return '';
  if (REASONS.has(failure.reason)) return failure.reason;
  const code = typeof failure.code === 'string' ? failure.code : '';
  if (Object.hasOwn(REASON_BY_CODE, code)) return REASON_BY_CODE[code];
  const said = typeof failure.message === 'string' ? failure.message : typeof failure.note === 'string' ? failure.note : '';
  const known = reasonOfText(said);
  if (code === 'ACCESS_DENIED') return known === READ_REASON.POLICY ? READ_REASON.POLICY : READ_REASON.ACL;
  if (known) return known;
  // An error that crossed to the panel keeps ServiceNow's own words for a table or column this instance does not have ("Invalid table").
  if (failure.status === undefined && said && (isMissingTable(said) || isMissingColumn(said))) return READ_REASON.MISSING;
  if (failure.status === STATUS.BLOCKED) return READ_REASON.BLOCKED;
  if (failure.status === STATUS.DENIED) return READ_REASON.ACL;
  // (classifyReadError's own notes for a table or a column this instance does not have, or the instance's words)
  if (failure.status === STATUS.SKIPPED) return MISSING_NOTE.test(said) || isMissingTable(said) ? READ_REASON.MISSING : '';
  if (failure.status === STATUS.ERROR || failure instanceof Error) return READ_REASON.ERROR;
  return '';
}

const fillOnly = (text, params) => String(text).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : all));

/**
 * What to tell the person about a failed read, in one plain sentence, or '' when this helper has nothing better to say than the
 * caller's own words (a failure of another kind: the caller keeps its "could not be read" and the reader's own note).
 *   failure    an error, an access entry or a message (see readReasonOf)
 *   thing      what could not be read, as a phrase that can start a sentence ("Earlier tickets"); the panel's t('This') when absent
 *   translate  the panel's t(); without it the English text is returned with its {thing} filled
 */
export function readFailureText(failure, { thing = '', translate = fillOnly } = {}) {
  const reason = readReasonOf(failure);
  if (Object.hasOwn(INSTANCE_TEXT, reason)) return translate(INSTANCE_TEXT[reason]);
  if (!Object.hasOwn(THING_TEXT, reason)) return '';
  return translate(THING_TEXT[reason], { thing: thing || translate(tm('This')) });
}

const withReason = (out, reason) => (reason ? { ...out, reason } : out);
const MISSING_NOTE = / is not on this instance\.$| on this instance does not have a column this read needs\.$/;

/**
 * { status: 'blocked' | 'denied' | 'error' | 'skipped', note, reason? } for an error raised while reading `table`. Session expiry is not
 * handled here. `reason` is there when the error said why (the read layer, or a code that tells): see READ_REASON.
 */
export function classifyReadError(err, table) {
  const text = (err && err.message) || String(err || '');
  // The policy guard (src/content/policyGuard.js) refused the read: say whose rule it is. Its message names the table that was blocked,
  // which can differ from `table` (a reference answer, a task whose class is blocked).
  if (isBlockedTable(err)) return { status: STATUS.BLOCKED, note: oneLine(text, 200) || `Your organisation does not allow reading ${table}.`, reason: READ_REASON.BLOCKED };
  const told = REASONS.has(err?.reason) ? err.reason : '';
  const reason = told || (Object.hasOwn(REASON_BY_CODE, err?.code) ? REASON_BY_CODE[err.code] : '');
  // The instance is limiting requests, is busy or under maintenance, or answered with a page: in its own fixed words (no table name).
  if (reason === READ_REASON.RATE_LIMITED || reason === READ_REASON.UNAVAILABLE || reason === READ_REASON.NOT_DATA) {
    return { status: STATUS.ERROR, note: INSTANCE_TEXT[reason], reason };
  }
  if (reason === READ_REASON.ACL || reason === READ_REASON.POLICY || err?.code === 'ACCESS_DENIED' || /\b403\b|not allowed|forbidden|not authorized|security|denied|\bacl\b/i.test(text)) {
    // The organisation closed this kind of read to the role: the person's admin can say why. Same status as an ACL (never a way round).
    if (reason === READ_REASON.POLICY || (err?.code === 'ACCESS_DENIED' && reasonOfText(text) === READ_REASON.POLICY)) {
      return { status: STATUS.DENIED, note: READ_TEXT.policy, reason: READ_REASON.POLICY };
    }
    return withReason({ status: STATUS.DENIED, note: `Your user cannot read ${table}.` }, told);
  }
  // A table that is not on this instance (a plugin that is not installed: CSM, HR, chat, knowledge use) is not a problem to show:
  // the part that needed it is left out quietly ('skipped' is never listed as "could not be read"). The note stays for the pack's
  // own record. The read layer also says 'missing' for a 400 about a column the instance does not have.
  if (isMissingTable(err)) return withReason({ status: STATUS.SKIPPED, note: `${table} is not on this instance.` }, told);
  if (reason === READ_REASON.MISSING) return { status: STATUS.SKIPPED, note: `${table} on this instance does not have a column this read needs.`, reason };
  // A read that ran out of time (src/content/tableApi.js READ_TIMEOUT_MS) says so in plain words, without the table's name.
  if (err?.code === 'SN_TIMEOUT') return { status: STATUS.ERROR, note: READ_TEXT.timeout, reason: READ_REASON.TIMEOUT };
  return withReason({ status: STATUS.ERROR, note: `Could not read ${table}: ${oneLine(text, 140)}` }, told);
}

/**
 * Is this the instance saying the table does not exist? The Table API answers HTTP 400 "Invalid table <name>"; other wordings are
 * kept for older releases and the Aggregate API. A 404 counts only with its number in the text (tableApi.js puts it there).
 */
export function isMissingTable(err) {
  const text = (err && err.message) || String(err || '');
  return /invalid table|\b404\b|does not exist|no such table|unknown table/i.test(text);
}

/** Is this the instance saying a column does not exist (a 400 about a field it does not have)? */
export function isMissingColumn(text) {
  return /invalid (?:field|column|group ?by)|unknown (?:field|column)|no such (?:field|column)|(?:field|column) .{1,80} (?:is invalid|does not exist)/i.test(String(text ?? ''));
}

/**
 * queryTable that turns a failure into { rows: [], failure: { status, note, reason? } }. A lost session and a cancelled request
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
