// One insert, from the button press to its outcome, without React: the answer cards (src/sidepanel/ticket/assist/answers, ResultView)
// and the Write panels (useFill) run it, and tests/insert-flow.test.js covers it.
//
//   createGuard()      one insert at a time, and a button that inserted stays done. A second click while the first is still in
//                      flight (the page answers in a few hundred milliseconds) is ignored, so "append" can never add the text twice.
//   performInsert()    review the text for the field it goes into, send FILL_FIELD with the record it was written for, and say what
//                      happened. It never saves anything and never retries.
//
// Round 3 (TRACKER.md F5), the API an answer card uses:
//
//   insertTargets(feature, { record, page })      the boxes this answer can go into ON THIS RECORD, each with its mode, the modes the
//                                                 person may choose, where it lands and what to do next. A target the form cannot take
//                                                 carries `blocked` (a sentence) once field states are known (fieldStates below).
//   readFieldStates(page, targets, read)          before the click: are those boxes on the form, and can they be typed into?
//                                                 { known: boolean, form, fields: { name: { state, label? } } }; never throws.
//   applyFieldStates(targets, states)             the targets with `blocked` / `box` filled in from that answer.
//   insertText({ page, target, text, mode, source, review, force, send })
//                                                 the insert itself: performInsert for that target in the chosen mode ('replace' |
//                                                 'append'), remembering what went in so Try again + Insert does not leave two copies.
//   primaryOf(feature)                            'copy' | 'insert': which button is the main one on the answer card.
//   choicesOf(feature, plain)                     separate texts for an answer that is a set of choices (the three chat replies).
//
// Every guard stays where it was: insert only into the record the text was written for (expect), one whitelisted field (the content
// script refuses anything else), never a save, HTML escaped for an HTML field (the content script), the safe-to-send review first.

import { buildFillMessage, describeInsert, expectForInsert, fillModeFor, fillModesFor, fillReasonText, insertedNote, isFillable, wrongRecordText } from '../lib/fillable.js';
import { insertsFor } from '../features/registry.js';
import { reviewForInsert } from '../safeSend/review.js';

export function createGuard() {
  let busy = false;
  const done = new Set();
  return {
    get busy() {
      return busy;
    },
    isDone: (key) => done.has(key),
    /** Forget what was inserted (a new draft, Try again, Close). */
    reset: () => done.clear(),
    /**
     * Run `task` unless another is in flight or this key already succeeded; `task`'s result, or null when skipped. A task that
     * returns { status: 'inserted' } marks the key done.
     */
    async run(key, task) {
      if (busy || (key != null && done.has(key))) return null;
      busy = true;
      try {
        const outcome = await task();
        if (key != null && outcome?.status === 'inserted') done.add(key);
        return outcome;
      } finally {
        busy = false;
      }
    },
  };
}

// ---- The review, with resolution notes in mind --------------------------------------------------------------------------------

// Resolution notes are written FROM the work notes: words they share with a work note are expected there, so for these boxes the
// "copied from an internal note" finding is a hint to look at, not a stop. Everywhere else the review is unchanged.
const NOTES_FROM_WORK = new Set(['close_notes', 'fix_notes', 'cause_notes']);
export const OVERLAP_HINT = 'This repeats words from a work note. That is normal for resolution notes; check nothing internal or personal is in it.';

/** reviewForInsert, with the work-note overlap turned into a hint for resolution-note boxes. { serious, hints } */
export function reviewInsert(field, text, review = {}) {
  const found = reviewForInsert(field, text, review);
  if (!NOTES_FROM_WORK.has(field)) return found;
  const overlap = found.serious.filter((f) => f.kind === 'INTERNAL_NOTE').map((f) => ({ ...f, severity: 'low', advice: OVERLAP_HINT }));
  if (!overlap.length) return found;
  return { serious: found.serious.filter((f) => f.kind !== 'INTERNAL_NOTE'), hints: [...found.hints, ...overlap].sort((a, b) => a.start - b.start) };
}

/**
 * @param {{
 *   page: object,                                  the page state (tabId, record, newRecord, href)
 *   spec: { field: string, label?: string, fieldLabel?: string, mode?: string },
 *   value: string,                                 the text to insert, plain
 *   force?: boolean,                               skip the review (the person chose "Insert anyway")
 *   expect?: object|null,                          the record the text was written for; undefined = the page as it is now, null = any form
 *   number?: string,                               that record's number, for the message when it is not the one open
 *   review?: { people?: object[], scan?: Function, internalTexts?: string[] },
 *   replacing?: string,                            append only: the text this panel put into the same box before (swapped, not doubled)
 *   target?: object,                               { field, surface, ... } for the note after a success (names the next step)
 *   send: (tabId: number, message: object) => Promise<object>,
 * }} args
 * @returns {Promise<
 *   { status: 'empty' } |
 *   { status: 'findings', items: object[], hints: object[] } |
 *   { status: 'inserted', answer: object, note: string, hints: object[] } |
 *   { status: 'failed', answer: object, why: string }>}
 */
export async function performInsert({ page, spec, value, force = false, expect, number = '', review = {}, replacing = '', target = null, send }) {
  const text = String(value ?? '');
  if (!text.trim()) return { status: 'empty' };
  let hints = [];
  if (!force) {
    const found = reviewInsert(spec.field, text, review);
    if (found.serious.length) return { status: 'findings', items: found.serious, hints: found.hints };
    hints = found.hints;
  }
  const message = buildFillMessage({ field: spec.field, value: text, label: spec.fieldLabel || spec.label || '', mode: spec.mode, expect, page, replacing });
  let answer;
  try {
    answer = await send(page.tabId, message);
  } catch {
    answer = null;
  }
  if (!answer || typeof answer !== 'object' || answer.error) answer = { ok: false, reason: 'no-form' };
  if (answer.ok) return { status: 'inserted', answer, note: insertedNote(answer, target), hints };
  return { status: 'failed', answer, why: answer.reason === 'wrong-record' ? wrongRecordText({ expect: message.expect, number }) : fillReasonText(answer.reason) };
}

// ---- Which boxes an answer can go into, on this record -----------------------------------------------------------------------

/** The feature's inserts that apply to this kind of record (an insert may name its `kinds`; one that does not applies everywhere). */
export function insertsForKind(feature, kind) {
  return insertsFor(feature).filter((spec) => !Array.isArray(spec.kinds) || !spec.kinds.length || spec.kinds.includes(kind));
}

/** 'copy' or 'insert': the main button of an answer. A feature says so itself (`primary`); one with nothing to insert is Copy. */
export function primaryOf(feature, kind) {
  const inserts = kind === undefined ? insertsFor(feature) : insertsForKind(feature, kind);
  if (!inserts.length) return 'copy';
  return feature?.primary === 'copy' ? 'copy' : 'insert';
}

/** Separate texts for an answer that is a set of choices (`feature.choices(plain)`), or [] when it is not one or has none. */
export function choicesOf(feature, plain) {
  if (typeof feature?.choices !== 'function') return [];
  try {
    const list = feature.choices(String(plain ?? ''));
    return Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t.trim()).slice(0, 6) : [];
  } catch {
    return [];
  }
}

/**
 * The boxes an answer of `feature` can go into on the record `record` (the record the answer was written for), each ready to draw:
 *   { key, spec, field, label, fieldLabel, mode, modes, where, next, caution, table, blocked: '' , box: '' }
 * `mode` is the feature's default for that box ('replace' for resolution notes, else 'append'); `modes` what the person may choose.
 * `blocked` stays '' until applyFieldStates() learns that the form cannot take it.
 */
export function insertTargets(feature, { record, page } = {}) {
  const kind = record?.kind || page?.record?.kind || 'other';
  const surface = page?.surface || 'classic';
  return insertsForKind(feature, kind).map((spec, i) => {
    const mode = fillModeFor(spec.field, spec.mode);
    const told = describeInsert({ field: spec.field, fieldLabel: spec.fieldLabel, mode, kind, surface, table: spec.table || '' });
    return {
      key: `${spec.field}:${i}`,
      feature: feature?.id || '',
      spec,
      field: spec.field,
      label: spec.label,
      fieldLabel: spec.fieldLabel || '',
      table: spec.table || '',
      mode,
      modes: fillModesFor(spec.field),
      ...told,
      blocked: '',
      box: '',
    };
  });
}

/** Where-and-next sentences for a target in another mode (the person switched Replace / Add below before inserting). */
export function describeTarget(target, mode, { page, record } = {}) {
  return describeInsert({ field: target.field, fieldLabel: target.fieldLabel, mode, kind: record?.kind || page?.record?.kind || '', surface: page?.surface || 'classic', table: target.table });
}

const NOT_ON_FORM = (name) => `${name || 'This box'} is not on this form, so this cannot be inserted here. Use Copy.`;
const READ_ONLY = (name) => `${name || 'This box'} cannot be changed on this form right now. Use Copy.`;

/**
 * Ask the open page which of the targets' boxes it has (READ op `insertTargets`, src/content/fill.js). Fail-soft: anything that goes
 * wrong (an old content script without the op, a page that does not answer) is "not known", which blocks nothing.
 * @param {object} page the page state
 * @param {object[]} targets from insertTargets() (targets bound to another form, such as an article's title, are not asked about)
 * @param {(tabId: number, op: string, args: object) => Promise<object>} read src/sidepanel/ask.js read
 * @param {object|null} [expect] the record the answer was written for ({ table, sysId }); another record open = not known
 */
export async function readFieldStates(page, targets, read, expect = null) {
  const own = (Array.isArray(targets) ? targets : []).filter((t) => !t.table && isFillable(t.field));
  const unknown = { known: false, form: 'none', fields: {} };
  if (!own.length || !page || typeof read !== 'function') return unknown;
  try {
    const fields = [];
    for (const t of own) if (!fields.some((f) => f.name === t.field)) fields.push({ name: t.field, label: t.fieldLabel || '' });
    const answer = await read(page.tabId, 'insertTargets', { fields, ...(expect ? { expect } : {}) });
    if (!answer || typeof answer !== 'object' || answer.match === false) return unknown;
    return { known: true, form: typeof answer.form === 'string' ? answer.form : 'none', fields: answer.fields && typeof answer.fields === 'object' ? answer.fields : {} };
  } catch {
    return unknown;
  }
}

/** The targets with what the page said: `blocked` (why Insert is not offered) and `box` (the label of the box an insert will use). */
export function applyFieldStates(targets, states) {
  const fields = states?.known ? states.fields || {} : {};
  return (Array.isArray(targets) ? targets : []).map((t) => {
    const found = Object.prototype.hasOwnProperty.call(fields, t.field) ? fields[t.field] : null;
    const state = found && typeof found.state === 'string' ? found.state : 'unknown';
    const blocked = t.table ? '' : state === 'missing' ? NOT_ON_FORM(t.fieldLabel) : state === 'read-only' ? READ_ONLY(t.fieldLabel) : '';
    const box = found && typeof found.label === 'string' ? found.label.slice(0, 80) : '';
    return { ...t, blocked, box };
  });
}

// ---- The insert itself ------------------------------------------------------------------------------------------------------

// What this panel put into each box, so the next insert into the same box swaps it instead of adding a second copy. In memory only
// (gone when the panel closes or reloads), keyed by the tab, the record and the field; never stored.
const lastInserted = new Map();
const MAX_REMEMBERED = 50;
// One feature's earlier answer in one box: a hand-off brief never swaps out the summary that went into the same work notes.
const boxKey = (page, expect, field, feature) => `${page?.tabId ?? ''}|${expect?.table || ''}|${expect?.sysId || (expect?.newRecord ? 'new' : '')}|${field}|${feature || ''}`;

/** Forget what was inserted (tests; a panel that wants a clean slate). */
export const forgetInserts = () => lastInserted.clear();

/**
 * Insert `text` into one target's box in the chosen mode. The Answers agent's edit-before-insert calls this with the edited text.
 * @param {{
 *   page: object, target: object (from insertTargets), text: string, mode?: 'replace'|'append',
 *   source?: { expect, number } | null,   the record the answer was written for (RunPanel's `source`)
 *   pinned?: object,                      an expectation that replaces `source` (a draft waiting on a blank form)
 *   review?: object, force?: boolean,
 *   send: (tabId, message) => Promise<object>,
 * }} args
 * @returns the outcome of performInsert (status 'empty' | 'findings' | 'inserted' | 'failed'), or { status: 'blocked', why }
 */
export async function insertText({ page, target, text, mode, source = null, pinned, review = {}, force = false, send }) {
  if (!target || !target.field) return { status: 'failed', answer: { ok: false, reason: 'bad-field' }, why: fillReasonText('bad-field') };
  if (target.blocked) return { status: 'blocked', why: target.blocked };
  // An insert for another kind of form (an article's title and body) only goes into a form of that table.
  const here = page?.record?.table || page?.newRecord?.table || '';
  if (target.table && here !== target.table) {
    return { status: 'blocked', why: `This goes into a ${target.table === 'kb_knowledge' ? 'knowledge article' : target.table} form. Open that form first, then insert. Copy works now.` };
  }
  const chosen = fillModeFor(target.field, mode || target.mode);
  // The swap is for "Try again, then Insert" in the box's usual mode. A person who chose the other mode on purpose ("Add below" on
  // resolution notes) gets exactly that.
  const usual = !mode || fillModeFor(target.field, mode) === fillModeFor(target.field, target.mode);
  const spec = { ...target.spec, field: target.field, fieldLabel: target.fieldLabel, label: target.label, mode: chosen };
  const expect = expectForInsert({ spec, source, target: pinned, page });
  const key = boxKey(page, expect, target.field, target.feature);
  const outcome = await performInsert({
    page,
    spec,
    value: text,
    force,
    expect,
    number: source?.number || '',
    review,
    replacing: chosen === 'append' && usual ? lastInserted.get(key) || '' : '',
    target: { field: target.field, fieldLabel: target.fieldLabel, mode: chosen, surface: page?.surface || 'classic', table: target.table },
    send,
  });
  if (outcome?.status === 'inserted') {
    if (lastInserted.size >= MAX_REMEMBERED) lastInserted.delete(lastInserted.keys().next().value);
    lastInserted.set(key, String(text ?? '').trim());
  }
  return outcome;
}
