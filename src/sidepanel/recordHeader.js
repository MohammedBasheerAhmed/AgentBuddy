// The card at the top of a record: number, title and a few tags. Its read can succeed, be refused, or succeed with nothing in it
// (an ACL that returns a row with empty columns); each one is said in words instead of an endless "Loading…".
//
// A failure is said by its cause (audit of 2026-11-07, part 2): only a refusal ("you cannot see it") says the details are not available
// to you. A page whose table is not a ticket's, an organisation that does not let Agent Buddy read the table, and a read that did
// not get through (a lost session, a busy instance) each have their own plain sentence. And no table name is ever shown: the number
// slot holds the record's number, else a plain word for what it is.

import { tm, t as tr } from '../i18n/index.js';
import { isTicketTable } from '../context/kinds.js';
import { tableLabel } from '../lib/tableLabels.js';

// English constants (the tests compare them); describeHeader shows them in the language of the panel.
export const HEADER_LOADING = tm('Loading…');
export const HEADER_DENIED = tm('Details are not available to you.');
export const HEADER_NO_TITLE = tm('(no short description)');
// The title was not sent to this user (a field they may not read, or a sensitive ticket read without its text): not "no short description".
export const HEADER_TITLE_HIDDEN = tm('(short description not shown to you)');
export const HEADER_NOT_TICKET = tm('This page is not a ticket.');
export const HEADER_BLOCKED = tm('Your organisation does not let Agent Buddy read this.');
export const HEADER_UNAVAILABLE = tm('Details could not be loaded. Try again in a moment.');

// The phases a failed header can end in, with the sentence and the titleKind of each ('failed' is the refusal, as it always was).
const FAILURES = Object.freeze({
  failed: { text: HEADER_DENIED, kind: 'denied' },
  'not-ticket': { text: HEADER_NOT_TICKET, kind: 'not-ticket' },
  blocked: { text: HEADER_BLOCKED, kind: 'blocked' },
  unavailable: { text: HEADER_UNAVAILABLE, kind: 'unavailable' },
});

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** 'ready' when the answer has anything readable in it, else 'failed'. */
export function headerPhase(answer) {
  if (!answer || typeof answer !== 'object') return 'failed';
  return ['number', 'short_description', 'state', 'priority'].some((k) => text(answer[k])) ? 'ready' : 'failed';
}

// A page the panel has reason to call a ticket: a table of the kinds it knows (or one of the organisation's families), or a record whose
// form carried a number.
const looksLikeTicket = (record, extraPrefixes) => Boolean(text(record?.number)) || isTicketTable(record?.table, { extraPrefixes });

/**
 * The phase for an answer that arrived. A row with nothing readable in it ('failed' above) is an access rule on a ticket (the details
 * are not available to you), but on a table that is no ticket's it only means the page has no ticket columns: 'not-ticket'.
 * @param {*} answer  @param {{ table?: string, number?: string }} record  @param {string[]} [extraPrefixes] the policy's sensitiveTablePrefixes
 * @returns {'ready'|'failed'|'not-ticket'}
 */
export function headerPhaseFor(answer, record, extraPrefixes) {
  const phase = headerPhase(answer);
  if (phase === 'ready') return phase;
  return looksLikeTicket(record, extraPrefixes) ? 'failed' : 'not-ticket';
}

// Codes of a read that did not get through, whatever the person may see: the session ended, the page was lost, the instance is limiting
// requests, busy or answering with a page, or the read ran out of time.
const NOT_GOT_THROUGH = new Set(['SESSION_EXPIRED', 'LOST_TOUCH', 'SN_RATE_LIMITED', 'SN_UNAVAILABLE', 'SN_NOT_DATA', 'SN_TIMEOUT']);
// The instance saying the table is not there (src/context/access.js isMissingTable: 400 "Invalid table", 404 with its number).
const MISSING_TABLE = /invalid table|\b404\b|does not exist|no such table|unknown table/i;

/**
 * The phase for a header read that failed, from the error the panel got (a code and a message; the content script's wire error).
 *   403 / not visible        -> 'failed'      "Details are not available to you."
 *   the organisation's block -> 'blocked'
 *   no such table            -> 'not-ticket'  "This page is not a ticket."
 *   lost session, busy, ...  -> 'unavailable' (and any other failure: it is not an access decision)
 * @param {*} err  @returns {'failed'|'not-ticket'|'blocked'|'unavailable'}
 */
export function phaseOfError(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  if (code === 'BLOCKED_TABLE') return 'blocked';
  if (code === 'ACCESS_DENIED' || code === 'NOT_FOUND') return 'failed';
  if (NOT_GOT_THROUGH.has(code)) return 'unavailable';
  if (MISSING_TABLE.test(String(err?.message ?? ''))) return 'not-ticket';
  return 'unavailable';
}

/**
 * What the card shows.
 * @param {{ phase: 'loading'|'ready'|'failed'|'not-ticket'|'blocked'|'unavailable', header: object|null }} state
 * @param {{ number?: string, table: string }} record what the page told us about the record
 * @returns {{ number: string, title: string, titleKind: 'loading'|'text'|'missing'|'denied'|'not-ticket'|'blocked'|'unavailable', tags: string[] }}
 *   (titleKind 'hidden': the header read said the title did not come back; 'missing': it came back empty)
 *   number: the record's number, else the header's, else a plain word for the kind of record (never the table's name; empty on a page
 *   that is not a ticket). tags: the state and the priority.
 */
export function describeHeader(state, record) {
  const header = state.header || {};
  const failure = FAILURES[state.phase];
  const number = record.number || text(header.number) || (state.phase === 'not-ticket' ? '' : tableLabel(record.table, { sentenceCase: true }));
  if (state.phase === 'loading') return { number, title: tr(HEADER_LOADING), titleKind: 'loading', tags: [] };
  if (failure) return { number, title: tr(failure.text), titleKind: failure.kind, tags: [] };
  const title = text(header.short_description);
  // The read says when the title did not come back (header.titleHidden): that is not an empty title (audit of 2026-11-07, R-14).
  if (!title && header.titleHidden === true) return { number, title: tr(HEADER_TITLE_HIDDEN), titleKind: 'hidden', tags: [text(header.state), text(header.priority)].filter(Boolean) };
  return {
    number,
    title: title || tr(HEADER_NO_TITLE),
    titleKind: title ? 'text' : 'missing',
    tags: [text(header.state), text(header.priority)].filter(Boolean),
  };
}
