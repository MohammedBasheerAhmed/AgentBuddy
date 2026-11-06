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
// Round 4 (docs/round4.md):
//
//   every insert's outcome carries `undo`         what the box held before and what the insert left there (from the page, kept in
//                                                 memory only), or null when the page could not say
//   undoInserts({ page, steps, send })            put those boxes back, the last insert first, through FILL_FIELD's 'undo' mode
//   insertCloseAndNotes({ ... })                  Prepare to close: one Insert that fills the close code, then the notes (the
//                                                 user's named exception to "one field", docs/build-rules.md rule 1)
//
// Every guard stays where it was: insert only into the record the text was written for (expect), one whitelisted field (the content
// script refuses anything else), never a save, HTML escaped for an HTML field (the content script), the safe-to-send review first.

import { buildFillMessage, buildUndoMessage, describeInsert, expectForInsert, fillModeFor, fillModesFor, fillReasonText, insertedNote, isFillable, undoStepOf, undoStillFor, wrongRecordText } from '../lib/fillable.js';
import { insertsFor } from '../features/registry.js';
import { reviewForInsert } from '../safeSend/review.js';
import { isolate, t, tm, t as tr } from '../i18n/index.js';

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
export const OVERLAP_HINT = tm('This repeats words from a work note. That is normal for resolution notes; check nothing internal or personal is in it.');

/** reviewForInsert, with the work-note overlap turned into a hint for resolution-note boxes. { serious, hints } */
export function reviewInsert(field, text, review = {}) {
  const found = reviewForInsert(field, text, review);
  if (!NOTES_FROM_WORK.has(field)) return found;
  const overlap = found.serious.filter((f) => f.kind === 'INTERNAL_NOTE').map((f) => ({ ...f, severity: 'low', advice: tr(OVERLAP_HINT) }));
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
 *   { status: 'inserted', answer: object, note: string, hints: object[], undo: object|null } |
 *   { status: 'failed', answer: object, why: string }>}
 *   undo: the step an Undo takes (fillable.js undoStepOf), or null when the page did not say what the box held before
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
  if (answer.ok) {
    // What the box held before stays with the Undo step only (memory, never shown, never stored).
    const undo = undoStepOf(answer, { field: spec.field, fieldLabel: spec.fieldLabel || '', expect: message.expect ?? null, stamp: page?.formStamp });
    const { undo: _undo, ...shown } = answer;
    return { status: 'inserted', answer: shown, note: insertedNote(shown, target), hints, undo };
  }
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
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item.trim()).slice(0, 6) : [];
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

// (the box is named by its label, which is an English text marked in the feature: `tr` shows it in the panel's language)
const boxName = (name) => (name ? tr(name) : t('This box'));
const NOT_ON_FORM = (name) => t('{box} is not on this form, so this cannot be inserted here. Use Copy.', { box: boxName(name) });
const READ_ONLY = (name) => t('{box} cannot be changed on this form right now. Use Copy.', { box: boxName(name) });

/**
 * Ask the open page which of the targets' boxes it has (READ op `insertTargets`, src/content/fill.js). Fail-soft: anything that goes
 * wrong (an old content script without the op, a page that does not answer) is "not known", which blocks nothing.
 * @param {object} page the page state
 * @param {object[]} targets from insertTargets() (targets bound to another form, such as an article's title, are not asked about)
 * @param {(tabId: number, op: string, args: object) => Promise<object>} read src/sidepanel/ask.js read
 * @param {object|null} [expect] the record the answer was written for ({ table, sysId }); another record open = not known
 */
export async function readFieldStates(page, targets, read, expect = null) {
  const own = (Array.isArray(targets) ? targets : []).filter((item) => !item.table && isFillable(item.field));
  const unknown = { known: false, form: 'none', fields: {} };
  if (!own.length || !page || typeof read !== 'function') return unknown;
  try {
    const fields = [];
    for (const item of own) if (!fields.some((f) => f.name === item.field)) fields.push({ name: item.field, label: item.fieldLabel || '' });
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
  return (Array.isArray(targets) ? targets : []).map((item) => {
    const found = Object.prototype.hasOwnProperty.call(fields, item.field) ? fields[item.field] : null;
    const state = found && typeof found.state === 'string' ? found.state : 'unknown';
    const blocked = item.table ? '' : state === 'missing' ? NOT_ON_FORM(item.fieldLabel) : state === 'read-only' ? READ_ONLY(item.fieldLabel) : '';
    const box = found && typeof found.label === 'string' ? found.label.slice(0, 80) : '';
    return { ...item, blocked, box };
  });
}

// ---- The insert itself ------------------------------------------------------------------------------------------------------

// What this panel put into each box, so the next insert into the same box swaps it instead of adding a second copy. In memory only
// (gone when the panel closes or reloads), keyed by the tab, the record and the field; never stored.
const lastInserted = new Map();
const MAX_REMEMBERED = 50;
// One feature's earlier answer in one box: a hand-off brief never swaps out the summary that went into the same work notes.
const boxKey = (page, expect, field, feature) => `${page?.tabId ?? ''}|${expect?.table || ''}|${expect?.sysId || (expect?.newRecord ? 'new' : '')}|${field}|${feature || ''}`;

/** Forget what was inserted (Settings "Clear everything" and a site turned off: src/sidepanel/forgetOnClear.js; tests). */
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
    return { status: 'blocked', why: t('This goes into a {form} form. Open that form first, then insert. Copy works now.', { form: target.table === 'kb_knowledge' ? t('knowledge article') : target.table }) };
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
    // (the box's key goes with the Undo step: once the box is put back it no longer holds this text to swap)
    if (outcome.undo) outcome.undo = { ...outcome.undo, box: key, target: target.key || '' };
  }
  return outcome;
}

// ---- Undo (round 4) --------------------------------------------------------------------------------------------------------

const nameOf = (step) => tr(step?.fieldLabel || step?.field || '') || t('This box');
const namesOf = (steps) => {
  const names = steps.map(nameOf);
  return names.length > 1 ? t('{names} and {last}', { names: names.slice(0, -1).join(t(', ')), last: names[names.length - 1] }) : names[0] || '';
};

/**
 * Put back what the boxes of an Insert held before, the last one first (Prepare to close filled the code, then the notes: the notes
 * go back first). Each box on its own, through FILL_FIELD's 'undo' mode: a box that was changed since the insert is left as it is
 * ('changed', said plainly: Agent Buddy cannot undo it safely); the others still go back. Nothing is saved, nothing is asked.
 * @param {{ page: object, steps: object[], send: (tabId: number, message: object) => Promise<object> }} args
 * @returns {Promise<{ status: 'undone'|'partial'|'failed', undone: object[], kept: { step: object, reason: string }[], note: string }>}
 */
export async function undoInserts({ page, steps, send }) {
  const list = (Array.isArray(steps) ? steps : []).filter((s) => s && typeof s === 'object' && isFillable(s.field));
  const undone = [];
  const kept = [];
  for (const step of [...list].reverse()) {
    if (!undoStillFor(step, page)) {
      kept.push({ step, reason: 'wrong-record' });
      continue;
    }
    let answer;
    try {
      // eslint-disable-next-line no-await-in-loop -- one box at a time, in the reverse order of the insert
      answer = await send(page.tabId, buildUndoMessage(step));
    } catch {
      answer = null;
    }
    if (answer && answer.ok === true) {
      undone.push(step);
      if (step.box) lastInserted.delete(step.box);
    } else kept.push({ step, reason: typeof answer?.reason === 'string' ? answer.reason : 'no-form' });
  }
  const lines = [];
  if (undone.length) {
    lines.push(undone.length > 1 ? t('Undone: {fields} are back to what they were before. Nothing is saved.', { fields: namesOf([...undone].reverse()) }) : t('Undone: {field} is back to what it was before. Nothing is saved.', { field: nameOf(undone[0]) }));
  }
  for (const { step, reason } of kept) {
    lines.push(
      reason === 'changed'
        ? t('{field} was changed after the insert, so Agent Buddy cannot undo it safely. Change it by hand if you need to.', { field: nameOf(step) })
        : reason === 'wrong-record'
          ? t('{field} is on a form that is no longer open, so it was not put back.', { field: nameOf(step) })
          : t('{field} could not be put back. {why}', { field: nameOf(step), why: fillReasonText(reason) })
    );
  }
  const status = undone.length && !kept.length ? 'undone' : undone.length ? 'partial' : 'failed';
  return { status, undone, kept, note: lines.join(' ') };
}

// ---- Prepare to close: the close code and the notes with one Insert (round 4) ---------------------------------------------

/**
 * The line after Prepare to close's Insert:
 *   "Filled Close code and Resolution notes. Press Save in ServiceNow to keep them."
 *   "Filled Resolution notes. Press Save in ServiceNow to keep it. Choose the close code Solved (Work Around) yourself."
 * @param {{ filled: object[] (the steps' targets: { fieldLabel, field }), byHand?: string (the code's label), label?: string }} args
 *   label: the box the notes went into on a page without g_form, named so a wrong box is easy to see
 */
export function closeFilledNote({ filled = [], byHand = '', label = '' } = {}) {
  const names = filled.map((x) => ({ fieldLabel: x.fieldLabel, field: x.field }));
  let base = names.length > 1 ? t('Filled {fields}. Press Save in ServiceNow to keep them.', { fields: namesOf(names) }) : t('Filled {field}. Press Save in ServiceNow to keep it.', { field: nameOf(names[0]) });
  if (label) base = t('{base} It went into the box labelled "{label}".', { base, label: isolate(label) });
  return byHand ? `${base} ${t('Choose the close code {code} yourself.', { code: isolate(byHand) })}` : base;
}

/**
 * Prepare to close's Insert: the close code (a choice, by its stored value) and then the notes, one FILL_FIELD each, after the person
 * saw both in the answer (docs/build-rules.md rule 1, the user's named exception). The notes are reviewed FIRST (the safe-to-send
 * review), so nothing at all is written when the review stops them. The code is a value of the instance's own list, not reviewed,
 * and optional: when the page cannot set it (a Workspace, a portal, a value this form does not list) the notes still go in and the
 * outcome says which code to pick by hand. Nothing is saved; `undo` holds a step per box that went in (code first).
 * @param {{
 *   page: object, source?: object|null, review?: object, force?: boolean, send: Function,
 *   code: { target: object, value: string, label: string } | null,   the code's target (insertTargets shape, field close_code)
 *   byHand?: string,                                                   a code to pick by hand that is not tried at all (a Workspace)
 *   notes: { target: object, text: string, mode?: string },            the notes' target and text
 * }} args
 * @returns {Promise<{ status: 'empty'|'blocked'|'findings'|'inserted'|'failed', code: 'filled'|'by-hand'|'none', undo: object[],
 *   note?: string, why?: string, items?: object[], hints?: object[], codeWhy?: string }>}
 */
export async function insertCloseAndNotes({ page, code = null, byHand = '', notes, source = null, review = {}, force = false, send }) {
  const text = String(notes?.text ?? '');
  if (!notes?.target || !text.trim()) return { status: 'empty', code: 'none', undo: [] };
  if (notes.target.blocked) return { status: 'blocked', why: notes.target.blocked, code: 'none', undo: [] };
  let hints = [];
  if (!force) {
    const found = reviewInsert(notes.target.field, text, review);
    if (found.serious.length) return { status: 'findings', items: found.serious, hints: found.hints, code: 'none', undo: [] };
    hints = found.hints;
  }
  const undo = [];
  const filled = [];
  let codeState = 'none';
  let codeWhy = '';
  if (code && code.target && typeof code.value === 'string' && code.value.trim()) {
    const outcome = code.target.blocked
      ? { status: 'blocked', why: code.target.blocked }
      : await insertText({ page, target: code.target, text: code.value, mode: 'replace', source, review, force: true, send });
    if (outcome?.status === 'inserted') {
      codeState = 'filled';
      filled.push(code.target);
      if (outcome.undo) undo.push(outcome.undo);
    } else {
      codeState = 'by-hand';
      codeWhy = outcome?.why || '';
    }
  }
  const out = await insertText({ page, target: notes.target, text, mode: notes.mode, source, review, force: true, send });
  if (out?.status === 'inserted') {
    filled.push(notes.target);
    if (out.undo) undo.push(out.undo);
    const label = out.answer?.method === 'dom' && typeof out.answer.label === 'string' ? out.answer.label : '';
    const pick = codeState === 'by-hand' ? code.label || code.value : codeState === 'none' && typeof byHand === 'string' ? byHand : '';
    return { status: 'inserted', code: codeState, codeWhy, undo, hints, answer: out.answer, note: closeFilledNote({ filled, byHand: pick, label }) };
  }
  return { status: out?.status === 'blocked' ? 'blocked' : 'failed', why: out?.why || fillReasonText('no-form'), code: codeState, codeWhy, undo, hints };
}
