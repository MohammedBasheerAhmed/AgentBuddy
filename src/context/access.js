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
//   build their entries from `status` and `note` only, so the note of each reason is a fixed sentence that says the same thing:
//   readReasonOf finds the reason again from it.
//   `note` (audit of 2026-11-07): a FIXED sentence from a closed set (NOTE_TEXT and READ_TEXT here, and the few sentences a reader marks
//   with tm()). It names no table, no column and no API, and it never says "your user". The panel words an entry with
//   readFailureText(entry, { thing }), where `thing` is the plain label of `source` (src/sidepanel/plainAccess.js), so what the engine
//   tried never reaches a person by its technical name.

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

/**
 * The columns that were asked for and are NOT in a row the instance returned (the key is missing). A column that is empty comes back
 * as an empty value; one the user may not read is, we assume, left out (audit of 2026-11-07, R-14; docs/live-questions/audit-1107-honest.md,
 * question 1), and so is one the table does not have or the organisation's policy takes out. Either way "no value" is not what the
 * record says: the panel says "could not read" for these and "empty" only for a column that came back empty.
 */
export const absentColumns = (row, columns) => (columns || []).filter((name) => !row || typeof row !== 'object' || !Object.hasOwn(row, name));

/** The access entry for a read that needed a column of the ticket and did not get it (see absentColumns). A refusal, shown as one. */
export const hiddenFieldEntry = (source) => entry(source, STATUS.DENIED, NOTE_TEXT.fieldHidden, { reason: READ_REASON.HIDDEN_FIELD });

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
  POLICY: 'policy', // 403 (or a 401 with a live session): the organisation restricts this kind of read (a REST API access policy, the Table API closed to the role)
  RATE_LIMITED: 'rate-limited', // 429 after the retries: the instance is limiting requests
  UNAVAILABLE: 'unavailable', // 503 (or 502, 504) after the retries: busy or under maintenance
  NOT_DATA: 'not-data', // a page (HTML) or something else where data was asked for: a sign-in or maintenance page
  SESSION: 'session', // the ServiceNow session ended (401, a login page)
  TIMEOUT: 'timeout', // no answer within the read's time limit
  MISSING: 'missing', // the table (or a column the read needs) is not on this instance: left out quietly
  BLOCKED: 'blocked', // the organisation's policy does not let Agent Buddy read the table (BLOCKED_TABLE)
  NOT_FOUND: 'not-found', // the record is not there for this user (deleted, or hidden by an ACL)
  HIDDEN: 'hidden', // zero rows, and the user sees no rows of the table at all: none, or hidden, cannot be told apart
  HIDDEN_FIELD: 'hidden-field', // a column the read needed is not in the record the instance returned: the user may not read it
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
// (The other engine files import it from here.)
export const tm = (text) => text;

/**
 * The fixed sentences of the reasons that are about the instance or the organisation, not about one thing. The read layer uses them as
 * the error's message and classifyReadError as the entry's note, so they reach the panel whichever way a reader passes a failure on;
 * they name no table and no API. ONE wording for a lost sign-in: "Sign in" (never "log in"), "signed out" (never "session expired").
 */
export const READ_TEXT = Object.freeze({
  policy: tm('Not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.'),
  rateLimited: tm('ServiceNow is limiting requests. Try again in a minute.'),
  unavailable: tm('ServiceNow is busy or under maintenance. Try again in a few minutes.'),
  notData: tm('ServiceNow did not send the information. Sign in again, or try later (it may be down for maintenance).'),
  timeout: tm('ServiceNow did not answer in time. Try again in a moment.'),
  session: tm('You are signed out of ServiceNow. Sign in again, then try again.'),
  invalid: tm('That cannot be read. Choose another option.'),
});

/**
 * The fixed sentences of an access entry's `note` about one thing (the entry's source names it), in sentence case so that they follow
 * "Label: " well. None of them names a table. The panel words the same reasons with a label in readFailureText.
 */
export const NOTE_TEXT = Object.freeze({
  denied: tm('Not available to you with your role.'),
  notFound: tm('Not available to you.'),
  missing: tm('This does not exist on this ServiceNow site.'),
  hidden: tm('You can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.'),
  // A column of the ticket itself (its configuration item, its account) did not come back, so what depends on it was not looked up.
  fieldHidden: tm('Part of this ticket is hidden from you, so this could not be looked up.'),
  error: tm('Could not be read just now. Try again in a moment.'),
  blocked: tm('Your organisation does not let Agent Buddy read this.'),
  // The instance ignored a condition and answered with rows that do not belong to the record (or the whole table): none of them is used.
  ignoredFilter: tm('ServiceNow did not narrow the results as asked, so they were left out.'),
  // A ticket on a sensitive table (HR): other tickets and notes are only read when the organisation allows sensitive data.
  sensitiveOthers: tm('This ticket holds sensitive data, so other tickets are not searched unless sensitive data is allowed.'),
  sensitiveLookup: tm('This ticket holds sensitive data, so this is not looked up unless sensitive data is allowed.'),
});

const REASON_BY_TEXT = new Map([
  [READ_TEXT.policy, READ_REASON.POLICY],
  [READ_TEXT.rateLimited, READ_REASON.RATE_LIMITED],
  [READ_TEXT.unavailable, READ_REASON.UNAVAILABLE],
  [READ_TEXT.notData, READ_REASON.NOT_DATA],
  [READ_TEXT.timeout, READ_REASON.TIMEOUT],
  [READ_TEXT.session, READ_REASON.SESSION],
  [NOTE_TEXT.denied, READ_REASON.ACL],
  [NOTE_TEXT.notFound, READ_REASON.NOT_FOUND],
  [NOTE_TEXT.missing, READ_REASON.MISSING],
  [NOTE_TEXT.hidden, READ_REASON.HIDDEN],
  [NOTE_TEXT.fieldHidden, READ_REASON.HIDDEN_FIELD],
  [NOTE_TEXT.error, READ_REASON.ERROR],
  [NOTE_TEXT.blocked, READ_REASON.BLOCKED],
]);
const reasonOfText = (text) => REASON_BY_TEXT.get(String(text ?? '').trim()) || '';

/**
 * Is this note one of the standard sentences of a reason (or empty)? Then the panel words the entry by its reason with the label of its
 * source (readFailureText); any other note is a sentence of the reader's own ("ServiceNow did not narrow the results as asked...") that
 * says more than the reason does, and is shown after the label.
 */
export const isStandardNote = (note) => !String(note ?? '').trim() || REASON_BY_TEXT.has(String(note).trim());

// The sentences about one thing that could not be read ("Earlier tickets: ..."), for a whole read that failed.
const THING_TEXT = Object.freeze({
  [READ_REASON.ACL]: tm('{thing}: not available to you with your role.'),
  [READ_REASON.POLICY]: tm('{thing}: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.'),
  [READ_REASON.MISSING]: tm('{thing}: does not exist on this ServiceNow site.'),
  [READ_REASON.BLOCKED]: tm('{thing}: your organisation does not let Agent Buddy read this.'),
  [READ_REASON.NOT_FOUND]: tm('{thing}: not available to you.'),
  [READ_REASON.HIDDEN]: tm('{thing}: you can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.'),
  [READ_REASON.HIDDEN_FIELD]: tm('{thing}: part of this ticket is hidden from you, so this could not be looked up.'),
  [READ_REASON.ERROR]: tm('{thing}: could not be read just now. Try again in a moment.'),
});
const INSTANCE_TEXT = Object.freeze({
  [READ_REASON.RATE_LIMITED]: READ_TEXT.rateLimited,
  [READ_REASON.UNAVAILABLE]: READ_TEXT.unavailable,
  [READ_REASON.NOT_DATA]: READ_TEXT.notData,
  [READ_REASON.TIMEOUT]: READ_TEXT.timeout,
  [READ_REASON.SESSION]: READ_TEXT.session,
});

// The same reasons as one sentence that needs no label (an error shown on its own: src/sidepanel/ask.js plainError).
const ALONE_TEXT = Object.freeze({
  ...INSTANCE_TEXT,
  [READ_REASON.POLICY]: READ_TEXT.policy,
  [READ_REASON.ACL]: NOTE_TEXT.denied,
  [READ_REASON.MISSING]: NOTE_TEXT.missing,
  [READ_REASON.BLOCKED]: NOTE_TEXT.blocked,
  [READ_REASON.NOT_FOUND]: NOTE_TEXT.notFound,
  [READ_REASON.HIDDEN]: NOTE_TEXT.hidden,
  [READ_REASON.HIDDEN_FIELD]: NOTE_TEXT.fieldHidden,
  [READ_REASON.ERROR]: NOTE_TEXT.error,
});

/** The English sentence for a reason with no label (see ALONE_TEXT), or '' for a reason with none. */
export const reasonSentence = (reason) => (Object.hasOwn(ALONE_TEXT, reason) ? ALONE_TEXT[reason] : '');

// A 403 is either an access rule on the data (ACL) or the organisation closing this kind of request to the role (a REST API access
// policy, the Table API restricted, a table closed to web services). ServiceNow's JSON error says which only in words, so the words
// decide; wording that names an ACL or read permission wins, and a 403 that says neither is an ACL (build rule 9: "you can't see it").
// "Failed API level ACL Validation" (the Table API's blanket ACL, which needs the role snc_platform_rest_api_access) names an ACL but is
// the API-level restriction: every read fails for the role, not one table's rows. It is tested first, so it is a policy, not an ACL.
// MEASURED on dev364920 on 2026-11-07 (docs/live-checks-2026-11-07.md): a table the role may not read answers 403, message
// "User Not Authorized", detail "User is unauthorized to access table: sys_documentation"; a query that names a column the role may
// not read answers "Insufficient rights to query records" / "Field(s) present in the query do not have permission to be read". Both are
// ordinary role rules (ACL), NOT a REST API policy, so "User Not Authorized" is no policy word: it is the instance's usual way to say
// "no", with or without the table after it. The words of a policy name the API itself (below).
// Still unverified: the wording of a REST API access policy refusal (docs/live-questions/reads.md, question 3).
const API_LEVEL_WORDS = /api[- ]level/i;
const ACL_WORDS = /\bacls?\b|security constraint|insufficient rights|permission to be read|not permitted to read|no read access|unauthori[sz]ed to access table/i;
const POLICY_WORDS = /access polic|api access|rest api|rest_api|web service|snc_platform_rest_api_access/i;

/** 'acl' or 'policy' for the text of a 403 answer (ServiceNow's "message - detail"). */
export function deniedReason(text) {
  const said = String(text ?? '');
  if (API_LEVEL_WORDS.test(said)) return READ_REASON.POLICY;
  if (ACL_WORDS.test(said)) return READ_REASON.ACL;
  return POLICY_WORDS.test(said) ? READ_REASON.POLICY : READ_REASON.ACL;
}

// What the error says in technical words (the read layer keeps it in `detail`; an older error has it in the message).
const technicalText = (err) => [err?.detail, err?.message].filter((part) => typeof part === 'string' && part).join(' ') || (typeof err === 'string' ? err : '');

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
  // An error that crossed to the panel may keep ServiceNow's own words for a table or column this instance does not have ("Invalid table").
  if (failure.status === undefined && said && (isMissingTable(said) || isMissingColumn(said))) return READ_REASON.MISSING;
  if (failure.status === STATUS.BLOCKED) return READ_REASON.BLOCKED;
  if (failure.status === STATUS.DENIED) return READ_REASON.ACL;
  if (failure.status === STATUS.EMPTY_OR_HIDDEN) return READ_REASON.HIDDEN;
  // (a skipped entry: a table or a column this instance does not have is the one skip that has a reason)
  if (failure.status === STATUS.SKIPPED) return isMissingTable(said) ? READ_REASON.MISSING : '';
  if (failure.status === STATUS.ERROR || failure instanceof Error) return READ_REASON.ERROR;
  return '';
}

const fillOnly = (text, params) => String(text).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all, name) => (params && params[name] !== undefined && params[name] !== null ? String(params[name]) : all));

/**
 * What to tell the person about a failed read, in one plain sentence, or '' when this helper has nothing to say (a skip on purpose, an
 * entry that is fine: the caller keeps its own words).
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

/**
 * { status: 'blocked' | 'denied' | 'error' | 'skipped', note, reason } for an error raised while reading. Session expiry is not handled
 * here. The note is one of the fixed sentences above (it names no table, and carries no part of ServiceNow's own text); `reason` says
 * why when the error said so (the read layer, or a code that tells), otherwise it is worked out from the words of an older error.
 */
export function classifyReadError(err) {
  // The policy guard (src/content/policyGuard.js) refused the read: whose rule it is, without the name of the table that was blocked
  // (it can differ from the table the reader asked about: a reference answer, a task whose class is blocked).
  if (isBlockedTable(err)) return { status: STATUS.BLOCKED, note: NOTE_TEXT.blocked, reason: READ_REASON.BLOCKED };
  const text = technicalText(err) || String(err || '');
  // (a generic 'error' reason counts as the layer's own word only with a status number: it read the answer and found nothing special)
  const told = REASONS.has(err?.reason) && (err.reason !== READ_REASON.ERROR || Number(err.status) > 0) ? err.reason : '';
  const reason = told || (Object.hasOwn(REASON_BY_CODE, err?.code) ? REASON_BY_CODE[err.code] : '');
  // The instance is limiting requests, is busy or under maintenance, or answered with a page: in its own fixed words (no table name).
  if (reason === READ_REASON.RATE_LIMITED || reason === READ_REASON.UNAVAILABLE || reason === READ_REASON.NOT_DATA) {
    return { status: STATUS.ERROR, note: INSTANCE_TEXT[reason], reason };
  }
  if (reason === READ_REASON.ACL || reason === READ_REASON.POLICY || err?.code === 'ACCESS_DENIED' || (!told && /\b403\b|not allowed|forbidden|not authorized|security|denied|\bacl\b/i.test(text))) {
    // The organisation closed this kind of read to the role: the person's admin can say why. Same status as an ACL (never a way round).
    if (reason === READ_REASON.POLICY || (err?.code === 'ACCESS_DENIED' && reasonOfText(err?.message) === READ_REASON.POLICY)) {
      return { status: STATUS.DENIED, note: READ_TEXT.policy, reason: READ_REASON.POLICY };
    }
    return { status: STATUS.DENIED, note: NOTE_TEXT.denied, reason: READ_REASON.ACL };
  }
  // A table that is not on this instance (a plugin that is not installed: CSM, HR, chat, knowledge use) is not a problem to show:
  // the part that needed it is left out quietly ('skipped' is never listed as "could not be read"). The read layer also says
  // 'missing' for a 400 about a column the instance does not have.
  if (reason === READ_REASON.MISSING || (!told && isMissingTable(err))) return { status: STATUS.SKIPPED, note: NOTE_TEXT.missing, reason: READ_REASON.MISSING };
  // A read that ran out of time (src/content/tableApi.js READ_TIMEOUT_MS) says so in plain words.
  if (err?.code === 'SN_TIMEOUT') return { status: STATUS.ERROR, note: READ_TEXT.timeout, reason: READ_REASON.TIMEOUT };
  return { status: STATUS.ERROR, note: NOTE_TEXT.error, reason: READ_REASON.ERROR };
}

/**
 * Is this the instance saying the table does not exist? The Table API answers HTTP 400 "Invalid table <name>"; other wordings are
 * kept for older releases and the Aggregate API. A 404 counts only with its number in the text (tableApi.js keeps it in `detail`).
 * An error, or the text alone.
 */
export function isMissingTable(err) {
  const text = typeof err === 'string' ? err : technicalText(err) || String(err || '');
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
    return { rows: [], failure: classifyReadError(err) };
  }
}

/**
 * Is an empty answer from `table` really empty? One unfiltered one-row read: when it also returns nothing, the user
 * sees no rows of the table, so "none for this record" would be a guess (a PDI with no data looks the same as an ACL).
 * `memo` (a Map) keeps it to one extra read per table per pack.
 * What it proves is ONLY that the user sees one row of the table. It cannot prove that the rows that belong to THIS record are visible
 * (a row rule, a domain or an account scope can hide them from a user who sees others): a status of 'empty' is therefore worded "none
 * that you can see", never "none", and the lines built from it say "found" (audit of 2026-11-07, R-02).
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
  return { status: STATUS.EMPTY_OR_HIDDEN, note: NOTE_TEXT.hidden, reason: READ_REASON.HIDDEN };
}
