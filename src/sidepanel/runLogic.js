// The decisions inside useRun that are not about React: kept here as plain functions so tests/panel-run-logic.test.js can pin them.
import { plainSource } from './plainAccess.js';

export const EMPTY_ANSWER = 'The AI sent back nothing. Try again.';

/**
 * Run tokens. Every run (and every reset) takes a new number; an answer that arrives for an older number is dropped. After
 * `drop()` whatever was in flight is abandoned: its answer will never be shown.
 */
export function makeTokens() {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return n;
    },
    drop: () => {
      n += 1;
    },
    current: () => n,
    isCurrent: (token) => token === n,
  };
}

/** The key under which "the person has seen this preview" is remembered: one per feature, or one per group (email-*, rewrite-*). */
export const previewKeyFor = (feature) => feature?.previewGroup || feature?.id || '';

/**
 * Must the person see the exact outgoing text before it is sent?
 *   'always' -> yes; 'never' -> no (that choice is theirs, or the organisation's);
 *   'first'  -> the first time for this feature (or group), and every time when the pack says it carries reference material
 *               about other people's tickets (`pack.requirePreview === true`, set by policy/context): that part changes from
 *               run to run, so having seen the preview once does not cover it.
 * @param {(mode: string, key: string, seen: string[]) => boolean} previewRequired pipeline.previewRequired (injected)
 */
export function needsPreview({ previewMode, feature, pack, seen = [], previewRequired }) {
  if (previewMode === 'first' && pack?.requirePreview === true) return true;
  return previewRequired(previewMode, previewKeyFor(feature), seen);
}

/** The seen-list after the person confirmed a preview in 'first' mode (unchanged in any other mode). */
export function seenAfterConfirm({ previewMode, feature, seen = [] }) {
  if (previewMode !== 'first') return seen;
  const key = previewKeyFor(feature);
  return key && !seen.includes(key) ? [...seen, key] : seen;
}

// What "Mask" in the preview says, by the result of maskMore (src/lib/pipeline.js). Plain and short; never quotes the text.
const MASK_MESSAGES = Object.freeze({
  EMPTY: 'Select or type the text to hide first.',
  SHORT: 'Use at least 2 letters or digits.',
  LONG: 'That is too long. Select a shorter piece.',
  PLACEHOLDER: 'Select plain text only, not a highlighted part.',
  NOT_FOUND: 'That text is not in what will be sent.',
  NOT_DATA: "That is Agent Buddy's own wording, not ticket text. Nothing changed.",
  FAILED: 'That could not be hidden. If it must not be sent, press Cancel.',
  GONE: 'This check has closed.',
});

/** The line the preview shows after "Mask": how many places were masked, or why nothing changed. */
export function maskMessage(out) {
  if (out?.ok) {
    const n = Number(out.masked) || 0;
    return `Masked in ${n} ${n === 1 ? 'place' : 'places'}. Read the text again before you send.`;
  }
  return MASK_MESSAGES[out?.problem] || MASK_MESSAGES.FAILED;
}

/**
 * The record a run was started on, for binding its answer (Insert goes only into that record). It is taken ONCE, when the run
 * enters 'reading'; every later render keeps it, so a view that stays on screen while the person opens another record does not
 * re-bind the answer to whatever page is open when the answer arrives.
 * @param {string|null} previousPhase the phase at the last render (null before the first)
 * @param {string} phase the phase now
 * @param {*} current what was taken before
 * @param {() => *} take reads it from the page that is open now
 */
export function startedOnAfter(previousPhase, phase, current, take) {
  return phase === 'reading' && previousPhase !== 'reading' ? take() : current;
}

/** '' when the model's text is usable; otherwise what to tell the person. */
export function answerProblem(text) {
  return typeof text === 'string' && text.trim() ? '' : EMPTY_ANSWER;
}

/**
 * What a finished run remembers about the pack it was made from (RunPanel and the Write panels read it as `run.lastPack`):
 * which record the text is for (table, sysId, number: Insert is refused on any other form) and the record's work notes, so a
 * draft that copies words from an internal note is flagged before it goes into a field the customer can read. Memory only.
 */
export function lastPackOf(pack, internalTextsOf) {
  return {
    table: pack?.table,
    sysId: pack?.sysId,
    number: typeof pack?.number === 'string' ? pack.number : '',
    internalTexts: typeof internalTextsOf === 'function' ? internalTextsOf(pack) : [],
    // What the pack could not read, as plain phrases (the "Made without: ..." line under an answer). Words only, no record text.
    gaps: madeWithout(pack?.access, plainSource),
  };
}

// ---- Round 3: what the answer area and the preview say (AI0.2, AI0.4) -------------------------------------------------------------

/**
 * Which check the person gets before a send that needs one: 'full' (the exact text, what was masked, "Mask this too") or 'short'
 * (one line naming the other records it uses, with "Show what is sent" one click away).
 *
 * 'short' only in "first time" mode, for a pack that carries other people's tickets (`pack.requirePreview`), once the person has
 * already seen the full check for this feature (or its group), and only when the other-record parts can be named (`others`).
 * Anything else, and "always" mode, keeps the full check.
 */
export function previewStyle({ previewMode, feature, pack, seen = [], others = '' }) {
  if (previewMode !== 'first' || pack?.requirePreview !== true || !others) return 'full';
  const key = previewKeyFor(feature);
  return key && Array.isArray(seen) && seen.includes(key) ? 'short' : 'full';
}

// The parts that carry text from other records, by their `field` (src/features/partColumns.js), and how to count them. A part per
// row counts its parts; a part that holds a whole list counts the rows of that list in the pack (`related[key]`).
const OTHER_RECORD_PARTS = [
  { fields: ['reference_ticket', 'reference_ticket_routing'], one: 'solved ticket', many: 'solved tickets' },
  { fields: ['kb_article'], one: 'article', many: 'articles' },
  { fields: ['linked_incidents'], rows: 'linkedIncidents', one: 'linked incident', many: 'linked incidents' },
  { fields: ['schedule_conflicts'], rows: 'conflicts', one: 'overlapping change', many: 'overlapping changes' },
  { fields: ['recent_changes'], rows: 'recentChanges', one: 'recent change', many: 'recent changes' },
  { fields: ['account_cases'], rows: 'accountCases', one: 'other case of the account', many: 'other cases of the account' },
];

const joinWords = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/**
 * "3 solved tickets and 2 articles": the parts of a prepared run that come from other records, counted. '' when there is none (then
 * the full check is shown: a short check never says something vague).
 * @param {{ input?: { parts?: object[] }, pack?: object }} prepared what prepareRun returned
 */
export function otherRecordsSummary(prepared) {
  const parts = Array.isArray(prepared?.input?.parts) ? prepared.input.parts : [];
  const related = prepared?.pack?.related || {};
  const words = [];
  for (const kind of OTHER_RECORD_PARTS) {
    const mine = parts.filter((p) => kind.fields.includes(String(p?.field || '')));
    if (!mine.length) continue;
    const n = kind.rows ? (Array.isArray(related[kind.rows]) ? related[kind.rows].length : 0) : mine.length;
    if (n > 0) words.push(`${n} ${n === 1 ? kind.one : kind.many}`);
  }
  return words.length ? joinWords(words) : '';
}

/**
 * The preview in two pieces for the dialog: the ticket data (what the person should read) and the fixed rules (folded), plus the
 * exact text. `ok` is true only when the pieces put back together are exactly the text that is sent; otherwise the dialog shows the
 * exact text alone. Never a reworded copy: the pieces are cut from the sealed request's own messages.
 */
export function splitPreview(prepared) {
  const request = prepared?.request;
  const exact = String(request?.preview ?? prepared?.preview ?? '');
  const messages = Array.isArray(request?.messages) ? request.messages : null;
  const none = { ok: false, exact, data: '', rules: '' };
  if (!messages || !messages.length) return none;
  const rebuilt = messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
  if (rebuilt !== exact) return none;
  const rules = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n\n');
  const data = messages.filter((m) => m.role !== 'system').map((m) => String(m.content)).join('\n\n');
  if (!data) return none;
  return { ok: true, exact, data, rules };
}

// Sources that only help find email addresses for masking: nothing the answer is about is missing when they fail.
const QUIET_SOURCES = new Set(['sys_user', 'csm_consumer', 'customer_contact']);
const GAP_STATUSES = new Set(['denied', 'error', 'empty-or-hidden', 'blocked', 'skipped']);

/**
 * What an answer was made without: the sources of the pack that could not be read (no access, the organisation's policy, an error,
 * or left out on purpose), as plain phrases ("notes and comments", "SLAs"), each once, in the order found. [] when nothing is missing.
 * @param {object[]} access the pack's `access` entries
 * @param {(source: string) => string} [toWords] how a source name is said (src/sidepanel/plainAccess.js plainSource)
 */
export function madeWithout(access, toWords = plainSource) {
  const out = [];
  for (const a of Array.isArray(access) ? access : []) {
    if (!a || typeof a !== 'object' || !GAP_STATUSES.has(a.status) || QUIET_SOURCES.has(a.source)) continue;
    const words = String(typeof toWords === 'function' ? toWords(a.source) : a.source || '').trim();
    // (an acronym such as "SLAs" keeps its capitals)
    const phrase = words && !/^[A-Z]{2,}/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words;
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

/** "Made without: notes and comments, SLAs." for the line under an answer ('' when nothing is missing). Five at most, then "and 2 more". */
export function madeWithoutLine(gaps) {
  const list = Array.isArray(gaps) ? gaps.filter(Boolean) : [];
  if (!list.length) return '';
  const shown = list.slice(0, 5);
  const more = list.length - shown.length;
  return `Made without: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`;
}

// Errors that "Try again" cannot fix (the organisation's policy, the privacy filter, the set-up, a record the person cannot read),
// and the ones whose fix is in Settings.
const NO_RETRY = new Set([
  'FEATURE_OFF', 'TABLE_BLOCKED', 'HR_BLOCKED', 'PROVIDER_BLOCKED', 'BLOCKED_FIELD', 'BLOCKED_TABLE', 'NOT_LOCAL', 'MODE_TOO_LOW',
  'BAD_KEY', 'NO_KEY', 'NO_CREDIT', 'BAD_URL', 'NO_MODEL', 'NO_ACCESS', 'BUDGET', 'CONTENT_FILTER', 'ACCESS_DENIED', 'NOT_FOUND', 'TOO_LONG',
]);
const SETTINGS_FIX = new Set(['BAD_KEY', 'NO_KEY', 'NO_CREDIT', 'BAD_URL', 'NO_MODEL', 'NO_ACCESS', 'MODE_TOO_LOW', 'NOT_LOCAL', 'TIMEOUT', 'BUDGET', 'TOO_LONG']);

/** The next steps an error offers: "Try again" (it may work a second time) and "Open Settings" (the fix is there). */
export function errorNextSteps(code) {
  const c = String(code || '').toUpperCase();
  return { retry: !NO_RETRY.has(c), settings: SETTINGS_FIX.has(c) };
}

/** The machine code of an error ('' when it has none): AiError, RunBlocked, FirewallError and page errors carry one. */
export const errorCodeOf = (err) => (err && typeof err === 'object' && typeof err.code === 'string' ? err.code : '');

/**
 * The progress line while the AI is being asked: the seconds so far, and the try when the provider was busy and Agent Buddy tries
 * again (src/providers/http.js: at most 3 tries, on 429/503/529 only). Starts with "Waiting for the AI", as before.
 * @param {{ since: number, now: number, attempt?: number, attempts?: number }} p
 */
export function waitingText({ since, now, attempt = 1, attempts = 3 }) {
  const seconds = since > 0 && now >= since ? Math.floor((now - since) / 1000) : 0;
  const time = seconds >= 1 ? ` · ${seconds} s` : '';
  if (attempt > 1) return `Waiting for the AI${time}. It was busy, so Agent Buddy is trying again (try ${Math.min(attempt, attempts)} of ${attempts}).`;
  if (seconds >= 30) return `Waiting for the AI${time}. Long tickets and busy services take longer.`;
  return `Waiting for the AI${time}…`;
}
