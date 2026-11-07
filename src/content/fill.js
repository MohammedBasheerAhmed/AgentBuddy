// FILL_FIELD, the one write Agent Buddy has: put text into ONE field of the form that is open. Nothing is saved; the person
// presses Save. Everything the panel sends is checked here before the page bridge is asked to do anything:
//
//   - the field must be one of FILLABLE_FIELDS (src/lib/fillable.js), not just a well-formed column name
//   - `expect`, when sent, must be the form that is open now: the record the text was written for (or a blank form of that
//     table, or that record's email client). A mismatch answers 'wrong-record' and nothing is written
//   - a one-line field is replaced, never appended to, and its line breaks become spaces
//   - an HTML field gets the text as escaped HTML (toSafeHtml); the bridge uses it on a form with g_form, and types the plain
//     text into the rich-text editor of a Workspace
//   - a choice list (close_code, round 4) gets its stored value, short and on one line; the bridge sets it through g_form only
//
// Round 4, Undo (docs/round4.md): the bridge also says what the box held before and what the insert left in it, and the panel may
// put the earlier text back with mode 'undo' (handleUndo below): the same checks (a fillable field, the record it was made on, which
// an Undo must always name), and the page refuses unless the box still holds exactly what the insert left there. Nothing is saved.
//
// The bridge's answer comes from the page, so it is data: only two shapes go back to the panel (texts checked as strings of a sane
// length; anything else is dropped).
//
// Dependencies are injected so this is tested without a browser (tests/insert-content-fill.test.js).

import { FILL_REASONS, emailClientTarget, fieldMeta, isFillable, matchesExpect, parseExpect, toOneLine, toSafeHtml } from '../lib/fillable.js';
import { tryCallPage } from './pageBridge.js';
import { formShowsRecord } from './formRecord.js';
import { FIELD_RE } from '../context/util.js';

export const MAX_INSERT_CHARS = 20000;
/** A choice's stored value is a short code ("Solved (Work Around)", "resolved_by_caller"): anything longer is not one. */
export const MAX_CHOICE_CHARS = 100;

// What the page says a box held before an insert and holds after it (for Undo): plain strings of a sane length, or nothing.
function undoOf(answer) {
  const ok = (v) => typeof v === 'string' && v.length <= MAX_INSERT_CHARS;
  return ok(answer?.previous) && ok(answer?.after) ? { previous: answer.previous, after: answer.after } : null;
}

// Is the form that is open now the one named by `expect`? 'ok', or the reason to answer with. (A record that cannot be determined
// does not match.)
async function checkRecord(expect, { currentRecord, currentNewRecord, href }) {
  const want = parseExpect(expect);
  if (want === 'invalid') return 'wrong-record';
  // The email body belongs to the email client: on any other page there is no such field (not a different record's form).
  if (want && want.kind === 'email' && !emailClientTarget(href())) return 'no-such-field';
  if (want) {
    const [record, newRecord] = await Promise.all([Promise.resolve(currentRecord()).catch(() => null), Promise.resolve(currentNewRecord()).catch(() => null)]);
    if (!matchesExpect(expect, { record, newRecord, href: href() })) return 'wrong-record';
  }
  return 'ok';
}

// A reason the page gave, if it is one we know (a page cannot claim 'wrong-record': only this script decides that).
const reasonOf = (answer) => (FILL_REASONS.includes(answer?.reason) && answer.reason !== 'wrong-record' ? answer.reason : 'no-form');

// What a control is called, from the page: short, printable, one line (the panel shows it as text).
const hex4 = (n) => `\\u${n.toString(16).padStart(4, '0')}`; // (written as numbers so this file stays plain ASCII)
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => `${hex4(a)}-${hex4(b)}`).join('')}]`, 'g');
const cleanLabel = (value) => (typeof value === 'string' ? value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '');

/**
 * @param {{ field?: string, value?: string, label?: string, mode?: string, expect?: object }} message from the side panel
 * @param {{
 *   callPage: (action: string, args: any[]) => Promise<any>,
 *   currentRecord: () => Promise<{table: string, sysId: string}|null>,
 *   currentNewRecord: () => Promise<{table: string}|null>,
 *   href: () => string,
 * }} deps
 * @returns {Promise<{ ok: true, method: 'gform'|'dom', label?: string, undo?: { previous: string, after: string } } | { ok: false, reason: string }>}
 */
export async function handleFillField(message, { callPage, currentRecord, currentNewRecord, href }) {
  if (message?.mode === 'undo') return handleUndo(message, { callPage, currentRecord, currentNewRecord, href });
  const field = message?.field;
  if (typeof field !== 'string' || !FIELD_RE.test(field) || !isFillable(field)) return { ok: false, reason: 'bad-field' };
  const meta = fieldMeta(field);
  let text = String(message.value ?? '');
  if (meta.singleLine) text = toOneLine(text);
  if (!text.trim()) return { ok: false, reason: 'bad-field' };
  if (text.length > MAX_INSERT_CHARS || (meta.choice && text.length > MAX_CHOICE_CHARS)) return { ok: false, reason: 'too-long' };

  try {
    // The form must be the record the text was written for (checked now, not when the panel last looked).
    const where = await checkRecord(message.expect, { currentRecord, currentNewRecord, href });
    if (where !== 'ok') return { ok: false, reason: where };

    // Only an explicit 'append' adds below what the field holds, and never on a one-line field.
    const append = message.mode === 'append' && !meta.singleLine;
    const label = typeof message.label === 'string' ? message.label.slice(0, 100) : '';
    // For an HTML field the form gets escaped HTML; the plain text is still passed for a page that has no g_form.
    const html = meta.html ? toSafeHtml(text) : '';
    if (meta.html && html.length > MAX_INSERT_CHARS) return { ok: false, reason: 'too-long' };
    // The text this panel put into the same box before (append only, plain fields only): the bridge swaps it for the new one when
    // the box still holds it word for word, so Try again + Insert does not leave two copies. Anything odd is simply not sent.
    const previous = append && !meta.html && typeof message.replacing === 'string' && message.replacing.trim() && message.replacing.length <= MAX_INSERT_CHARS ? message.replacing.trim() : '';
    // The last argument: a choice list is set by g_form only (never typed into a box), and the page says what the box held before
    // and holds after, for Undo.
    const answer = await callPage('fillField', [field, text, label, append, html, previous, { choice: meta.choice === true, undo: true }]);
    if (answer?.ok === true) {
      const matched = cleanLabel(answer.label);
      const undo = undoOf(answer);
      // (modeUnread: a Workspace composer whose Work notes / customer comments switch the page could not read; a flag, nothing else)
      return { ok: true, method: answer.method === 'gform' ? 'gform' : 'dom', ...(matched ? { label: matched } : {}), ...(answer.modeUnread === true ? { modeUnread: true } : {}), ...(undo ? { undo } : {}) };
    }
    return { ok: false, reason: reasonOf(answer) };
  } catch {
    return { ok: false, reason: 'no-form' };
  }
}

/**
 * Undo one insert (FILL_FIELD with mode 'undo'): put back what the box held before, if it still holds exactly what the insert left.
 * The same checks as an insert, and stricter on the record: an Undo must name the record it was made on (no expectation = no Undo).
 * `value` (what the box held before) may be empty; `current` (what the insert left) may not.
 * @param {{ field?: string, value?: string, current?: string, label?: string, expect?: object }} message from the side panel
 * @returns {Promise<{ ok: true, method: 'gform'|'dom' } | { ok: false, reason: string }>}
 */
export async function handleUndo(message, { callPage, currentRecord, currentNewRecord, href }) {
  const field = message?.field;
  if (typeof field !== 'string' || !FIELD_RE.test(field) || !isFillable(field)) return { ok: false, reason: 'bad-field' };
  const meta = fieldMeta(field);
  const { value, current } = message;
  if (typeof value !== 'string' || typeof current !== 'string' || !current.trim()) return { ok: false, reason: 'bad-field' };
  if (value.length > MAX_INSERT_CHARS || current.length > MAX_INSERT_CHARS) return { ok: false, reason: 'too-long' };
  if (message.expect === undefined || message.expect === null) return { ok: false, reason: 'wrong-record' };
  try {
    const where = await checkRecord(message.expect, { currentRecord, currentNewRecord, href });
    if (where !== 'ok') return { ok: false, reason: where };
    const label = typeof message.label === 'string' ? message.label.slice(0, 100) : '';
    const answer = await callPage('restoreField', [field, value, current, label, { choice: meta.choice === true }]);
    if (answer?.ok === true) return { ok: true, method: answer.method === 'gform' ? 'gform' : 'dom' };
    return { ok: false, reason: reasonOf(answer) };
  } catch {
    return { ok: false, reason: 'no-form' };
  }
}

// ---- Before the click: can these fields be filled on the open form? (READ ONLY) ----------------------------------------
//
// insertTargets { fields: [{ name, label? }], expect?: { table, sysId } }
//   -> { form: 'gform' | 'workspace' | 'portal' | 'none', match: boolean, fields: { <name>: { state, label? } } }
//   state: 'editable' | 'read-only' | 'missing' | 'unknown'
//   gap (Workspace, portal; with state 'unknown'): 'absent' | 'ambiguous' | 'too-big', why the box was not found
//   mode (Workspace journal boxes, with state 'editable'): 'match' | 'other' | 'unread', what the composer is set to
//
// The answer only decides whether the panel offers an Insert button (or says why not); it never writes and never replaces the
// checks FILL_FIELD makes at the click. A classic form answers from g_form (getEditableFields): 'missing' and 'read-only' are
// facts there. A Workspace or a portal page is searched for the box the way an insert would find it; a box that is not found is
// 'unknown' (it may sit on a tab that is not open), never 'missing'. `match: false` = the form open now is another record.

const MAX_CHECK_FIELDS = 8;
const STATES = new Set(['editable', 'read-only', 'missing', 'unknown']);
const FORMS = new Set(['gform', 'workspace', 'portal']);
const GAPS = new Set(['absent', 'ambiguous', 'too-big']);
const MODES = new Set(['match', 'other', 'unread']);

/**
 * @param {{ fields?: { name: string, label?: string }[], expect?: object }} args from the side panel
 * @param {{ callPage: (action: string, args: any[]) => Promise<any>, currentRecord?: () => Promise<{table: string, sysId: string}|null> }} deps
 *   currentRecord: the record the content script finds on the page (as FILL_FIELD checks it), which settles a form of `task`
 */
export async function checkInsertTargets(args, { callPage, currentRecord = null }) {
  const asked = Array.isArray(args?.fields) ? args.fields : null;
  if (!asked || !asked.length || asked.length > MAX_CHECK_FIELDS) throw new Error('Say which fields to check.');
  const names = [];
  const labels = [];
  for (const item of asked) {
    const name = item?.name;
    if (typeof name !== 'string' || !FIELD_RE.test(name) || !isFillable(name)) throw new Error('That field cannot be filled.');
    if (names.includes(name)) continue;
    names.push(name);
    labels.push(typeof item.label === 'string' ? item.label.slice(0, 100) : '');
  }
  const want = parseExpect(args.expect);
  if (want === 'invalid') throw new Error('That is not a valid record.');
  const unknown = (form = 'none', match = true) => ({ form, match, fields: Object.fromEntries(names.map((n) => [n, { state: 'unknown' }])) });

  let answer;
  try {
    answer = await callPage('getFieldStates', [names, labels]);
  } catch {
    answer = null;
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return unknown();
  const form = FORMS.has(answer.form) ? answer.form : 'none';
  // A classic form says which record it is: a check for another record is no answer at all. (A form opened through task.do says
  // 'task' for an incident: src/content/formRecord.js.)
  let match = true;
  if (form === 'gform' && want && want.kind === 'record') {
    match = await formShowsRecord({ table: answer.table, sysId: answer.sysId }, want, currentRecord);
  }
  if (!match) return unknown(form, false);
  const fields = {};
  const given = answer.fields && typeof answer.fields === 'object' ? answer.fields : {};
  const boxes = answer.boxes && typeof answer.boxes === 'object' ? answer.boxes : {};
  const gaps = answer.gaps && typeof answer.gaps === 'object' ? answer.gaps : {};
  const modes = answer.modes && typeof answer.modes === 'object' ? answer.modes : {};
  for (const name of names) {
    let state = Object.prototype.hasOwnProperty.call(given, name) && STATES.has(given[name]) ? given[name] : 'unknown';
    // Only g_form can say a field is not on the form; a page searched by its boxes cannot.
    if (state === 'missing' && form !== 'gform') state = 'unknown';
    const label = form === 'gform' ? '' : cleanLabel(Object.prototype.hasOwnProperty.call(boxes, name) ? boxes[name] : '');
    // (what the page said about a box that is not there, and about the composer's switch: one of a few words, or nothing)
    const gap = form !== 'gform' && state === 'unknown' && Object.prototype.hasOwnProperty.call(gaps, name) && GAPS.has(gaps[name]) ? gaps[name] : '';
    const mode = form === 'workspace' && state === 'editable' && Object.prototype.hasOwnProperty.call(modes, name) && MODES.has(modes[name]) ? modes[name] : '';
    fields[name] = { state, ...(label ? { label } : {}), ...(gap ? { gap } : {}), ...(mode ? { mode } : {}) };
  }
  return { form, match, fields };
}

/**
 * The READ operation for src/content/ops/index.js (`...FILL_OPS`). It only asks the page bridge, and on a form of `task` the content
 * script's own reading of the page (its real class is looked up once and remembered).
 */
export const FILL_OPS = Object.freeze({
  insertTargets: (args, ctx) => checkInsertTargets(args || {}, { callPage: tryCallPage, currentRecord: ctx?.currentRecord }),
});

