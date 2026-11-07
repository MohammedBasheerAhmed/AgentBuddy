import { plainError } from './ask.js';
import { t, tm, t as tr } from '../i18n/index.js';
import { tableLabel } from '../lib/tableLabels.js';
import { NOTE_TEXT, isStandardNote, readFailureText } from '../context/access.js';
import { shown } from '../reports/shown.js';

// "What could not be read", in words a fulfiller can act on. The context engine reports the table it tried (kb_use, m2m_kb_task,
// task_sla...) as the `source` of an access entry; nobody at a service desk knows those names, so the panel says what the source IS
// (plainSource: src/lib/tableLabels.js for a table, WORDS below for the few sources that are not one) and the entry's note is a fixed
// sentence without any name (src/context/access.js). Three steps, from the data to the screen:
//   1. describeAccess / accessLine: an entry is worded by its reason (readFailureText) with the label of its source;
//   2. plainNote: a note the engine wrote (a fixed sentence) is shown in the panel's language (src/reports/shown.js finds the Arabic);
//   3. the safety net inside plainNote: whatever is left that still looks like a table name, or says "your user", is rewritten, so a
//      sentence from an older reader, a test fixture or an instance's own words can never put a raw name in front of a person.

// The sources that are not a table. A table is named by tableLabel (a translated noun for the tables ServiceNow ships, the instance's own
// label or a phrase made from the name for any other).
const WORDS = {
  journal: tm('notes and comments'),
  record: tm('this ticket'),
  tickets: tm('tickets'),
  'caller-history': tm('earlier tickets from this person'),
  chat: tm('chat messages'),
  'field history': tm('history'),
  'similar tickets': tm('similar tickets'),
  knowledge: tm('knowledge articles'),
};

const TABLE_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const upperFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** The start of a line about one source: "Article links", "Notes and comments"; never the name of a table. */
export function plainSource(source) {
  const name = String(source ?? '').trim();
  if (!name) return upperFirst(tr('some information'));
  if (Object.hasOwn(WORDS, name)) return upperFirst(tr(WORDS[name]));
  // A table: its label (known, the instance's, or made from the name) in plural, the way a list of things is named.
  if (TABLE_NAME.test(name)) return tableLabel(name, { plural: true, sentenceCase: true });
  // Words an engine reader wrote for a source ("similar tickets"): shown as they are, translated when the catalogue has them.
  return upperFirst(shown(name));
}

// ---- The safety net -------------------------------------------------------------------------------------------------------------

// A name made of words joined by underscores (sc_req_item, u_vendor_ticket, sys_audit).
const UNDERSCORE_NAME = /(?<![\w./-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w-])/g;
// The tables whose name is one ordinary word: replaced only where a table name stands (after a verb or a preposition with no article,
// or in quotes), so "This task has no requested item" and "The incident could not be read" are left alone.
const ONE_WORD_TABLES = ['incident', 'problem', 'task', 'interaction'];
const ONE_WORD_AFTER = new RegExp(`\\b(read|reading|see|find|check|checking|in|of|on|from|for|by|rows of|table)\\s+(${ONE_WORD_TABLES.join('|')})(?=[\\s.,;:)]|$)`, 'gi');
const ONE_WORD_QUOTED = new RegExp(`(["'\`])(${ONE_WORD_TABLES.join('|')})\\1`, 'gi');
// The read layer's old technical sentences: 'Table API query on "x" failed (500): ...'.
const TECHNICAL = /(?:Table API query|Aggregate API|Count|Breakdown|Report) (?:on|of) "[^"]*"(?: by [\w.]+)? failed(?: \(\d{3}\))?(?::[^\n]*?)?(?=\.\s|\.$|$)\.?/g;
const HTTP_CODE = /\s*\((?:answer\s+|HTTP\s+)?[1-5]\d\d\)|\bHTTP(?: error| status)?\s+[1-5]\d\d\b/g;

// (a name in a note is a table: it is said in the plural, the way a list of things is named)
const labelOf = (name) => tableLabel(name, { plural: true });

/** "Your user cannot ..." -> "You cannot ...": the engine wrote about "your user"; a person reads "you". */
function youify(text) {
  return text
    .replace(/\bYour user (cannot|may not|can|will)\b/g, 'You $1')
    .replace(/\bYour user sees\b/g, 'You see')
    .replace(/\bYour user is\b/g, 'You are')
    .replace(/\b(that|which|who|if|because) your user\b/gi, (all, word) => `${word} you`)
    .replace(/\b(for|by|to|from|with|of) your user\b/gi, (all, word) => `${word} you`)
    .replace(/\bYour user(?! ?names?\b)/g, 'You')
    .replace(/\byour user(?! ?names?\b)/g, 'you');
}

function names(text) {
  const start = (label, at) => (at === 0 ? upperFirst(label) : label);
  return text
    .replace(ONE_WORD_QUOTED, (all, quote, name, at) => start(labelOf(name.toLowerCase()), at))
    .replace(ONE_WORD_AFTER, (all, lead, name) => `${lead} ${labelOf(name.toLowerCase())}`)
    .replace(UNDERSCORE_NAME, (all, name, at) => start(labelOf(name), at));
}

/**
 * A sentence from the context engine in the panel's language, with nothing technical left in it: the engine's fixed sentences are
 * translated whole (src/reports/shown.js), and a sentence that still has the name of a table, "your user", an HTTP code or "Table API"
 * in it is rewritten (the safety net). A text with nothing to change comes back as it was.
 */
export function plainNote(text) {
  const source = String(text ?? '');
  if (!source.trim()) return source;
  const said = shown(source);
  const clean = said
    .replace(TECHNICAL, () => tr(NOTE_TEXT.error))
    .replace(HTTP_CODE, '')
    .replace(/\bTable API\b/g, 'ServiceNow')
    .replace(/:\s*$/, '.'); // ("Could not read X: HTTP 500" loses its code and keeps a full stop)
  return names(youify(clean));
}

// ---- Access entries ---------------------------------------------------------------------------------------------------------------

// ('blocked' is the organisation's policy, not the person's access: it is said too.)
const SHOWN = new Set(['denied', 'error', 'empty-or-hidden', 'blocked']);

/**
 * One line about one access entry: its reason with the plain label of its source ("Article links: not available to you with your role."),
 * or, when the entry carries a sentence of its own that says more than the reason does, that sentence after the label.
 */
export function accessLine(entry) {
  const thing = plainSource(entry?.source);
  if (!entry?.note || isStandardNote(entry.note)) {
    const said = readFailureText(entry, { thing, translate: t });
    if (said) return said;
    return t('{source}: not available to you.', { source: thing });
  }
  return `${thing}: ${plainNote(entry.note)}`;
}

/** One line per source that could not be read (denied, error, or empty in a way that proves nothing). [] when all is well. */
export function describeAccess(access) {
  return (access || []).filter((a) => a && SHOWN.has(a.status)).map(accessLine);
}

/**
 * A read that failed, said the way rule 9 asks: a refusal (403, a record the person cannot see) is "not available to you", the
 * organisation's own block is said as such, and anything else is an error in plain words.
 * @param {Error|{ message?: string, code?: string }} err as the panel's read() throws it (the content script's code travels along)
 * @param {string} what the thing that could not be read, as a phrase that can start a sentence ("Earlier tickets from this person")
 * @returns {{ kind: 'denied' | 'blocked' | 'error', text: string }}
 */
export function readFailure(err, what) {
  const code = String(err?.code || '');
  const thing = String(what || t('This'));
  if (code === 'ACCESS_DENIED' || code === 'NOT_FOUND') return { kind: 'denied', text: t('{thing}: not available to you.', { thing }) };
  if (code === 'BLOCKED_TABLE') return { kind: 'blocked', text: t('{thing}: your organisation does not let Agent Buddy read this.', { thing }) };
  return { kind: 'error', text: plainError(err, t('{thing} could not be read.', { thing })) };
}
