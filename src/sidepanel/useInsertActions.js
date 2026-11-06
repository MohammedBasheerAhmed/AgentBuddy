import { useRef, useState } from 'react';
import { createGuard, insertCloseAndNotes, insertText, undoInserts } from './insertFlow.js';
import { undoStillFor } from '../lib/fillable.js';
import { t } from '../i18n/index.js';

const sendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

/**
 * Copy and Insert for a card that offers an AI text box by box (insertFlow insertTargets): the Ticket screen's answers (AnswerCard)
 * and the email draft waiting on the email form (PendingDraft). Every insert takes the one insert path (insertFlow insertText: the
 * record the text was written for, one whitelisted box, the safe-to-send review first, never a save), one at a time (createGuard).
 * A review that stops an insert leaves `findings` (shown with InsertFindings: Insert anyway / Edit first); "Edit first" opens the
 * text in the edit box (`editing`, InsertEditor), which inserts through `insert` too and shows the review's findings itself.
 *
 * Round 4 (docs/round4.md): after every Insert, `undo` is true while it can be taken back (the same record is open and was not saved
 * since; what the boxes held before is in this hook's memory only) and `undoNow()` puts the boxes back, the last one first, through
 * FILL_FIELD's 'undo' mode: a box changed since the insert is left as it is, and the note says so. `insertClose` is Prepare to
 * close's Insert of two boxes (insertFlow insertCloseAndNotes): the close code, then the notes.
 *
 * (ResultView inserts a feature's inserts, not targets, through performInsert, and keeps its own copy of these steps.)
 *
 * @param {{
 *   page: object,
 *   source: { expect, number } | null,     the record the text was written for
 *   pinned?: object,                       an expectation that replaces `source` (the email form of that ticket)
 *   review: object,                        { people, scan, internalTexts, internalPhrases } for the safe-to-send review
 *   audit: (outcome: 'inserted'|'copied') => void,
 *   copyValue: string,                     what Copy copies when it is not told what
 *   textFor: (target) => string,           the part of the text one box takes ('' when it has none)
 *   emptyText: string,                     what to say when that part is empty
 *   onInserted?: (target) => void,         after a box was filled
 * }} options
 */
export function useInsertActions({ page, source, pinned, review, audit, copyValue, textFor, emptyText, onInserted }) {
  const [note, setNote] = useState(null); // { kind, text } about the last insert or copy
  const [findings, setFindings] = useState(null); // { items, target, text, mode, close? }: an insert the review stopped
  const [editing, setEditing] = useState(null); // { key, text } while the edit box is open
  const [done, setDone] = useState({}); // target keys that went in
  const [busy, setBusy] = useState(false); // an insert is in flight: every insert button is off
  const [undo, setUndo] = useState(null); // { steps }: what the last Insert can take back (memory only, never stored)
  const guard = useRef(null);
  if (!guard.current) guard.current = createGuard();

  async function copy(why = '', value = copyValue) {
    try {
      await navigator.clipboard.writeText(value);
      setNote({ kind: 'ok', text: why ? t('{why} Copied to the clipboard instead.', { why }) : t('Copied to the clipboard.') });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: t('The browser blocked copying. Select the text and copy it by hand.') });
    }
  }

  // One run through the guard, with every insert button off meanwhile.
  async function guarded(task) {
    if (guard.current.busy) return null;
    setBusy(true);
    try {
      return await guard.current.run(null, task);
    } finally {
      setBusy(false);
    }
  }

  async function insert(target, text, mode, force = false) {
    if (guard.current.busy) return null;
    setNote(null);
    const outcome = await guarded(() => insertText({ page, target, text, mode, source, pinned, review, force, send: sendToTab }));
    if (!outcome) return null;
    if (outcome.status === 'findings') {
      // (from the edit box, the box shows them itself)
      if (!editing) setFindings({ items: outcome.items, target, text, mode });
      return outcome;
    }
    setFindings(null);
    if (outcome.status === 'inserted') {
      setNote({ kind: 'ok', text: outcome.note });
      setDone((d) => ({ ...d, [target.key]: true }));
      setUndo(outcome.undo ? { steps: [outcome.undo] } : null);
      setEditing(null);
      audit('inserted');
      if (onInserted) onInserted(target);
    } else if (outcome.status === 'blocked') {
      setNote({ kind: 'warn', text: outcome.why });
    } else if (outcome.status === 'empty') {
      setNote({ kind: 'danger', text: emptyText });
    } else {
      await copy(outcome.why, text);
    }
    return outcome;
  }

  /**
   * Prepare to close's one Insert: `code` ({ target, value, label } or null) first, then `notes` ({ target, text, mode }). The notes
   * are reviewed before anything is written; the code is optional (said to pick by hand when the page cannot take it, or `byHand`
   * when it was not to be tried at all).
   */
  async function insertClose({ code = null, byHand = '', notes, force = false }) {
    if (guard.current.busy) return null;
    setNote(null);
    const outcome = await guarded(() => insertCloseAndNotes({ page, code, byHand, notes, source, review, force, send: sendToTab }));
    if (!outcome) return null;
    if (outcome.status === 'findings') {
      if (!editing) setFindings({ items: outcome.items, target: notes.target, text: notes.text, mode: notes.mode, close: { code, byHand } });
      return outcome;
    }
    setFindings(null);
    // Whatever went in can be taken back, also when the notes then failed (the code may be in).
    setUndo(outcome.undo?.length ? { steps: outcome.undo } : null);
    if (outcome.status === 'inserted') {
      setNote({ kind: 'ok', text: outcome.note });
      setDone((d) => ({ ...d, [notes.target.key]: true, ...(code && outcome.code === 'filled' ? { [code.target.key]: true } : {}) }));
      setEditing(null);
      audit('inserted');
      if (onInserted) onInserted(notes.target);
    } else if (outcome.status === 'blocked') {
      setNote({ kind: 'warn', text: outcome.why });
    } else if (outcome.status === 'empty') {
      setNote({ kind: 'danger', text: emptyText });
    } else {
      await copy(outcome.why, notes.text);
    }
    return outcome;
  }

  /** Put back what the last Insert's boxes held before (memory only; nothing is saved). */
  async function undoNow() {
    if (!undo) return null;
    const outcome = await guarded(() => undoInserts({ page, steps: undo.steps, send: sendToTab }));
    if (!outcome) return null;
    setUndo(null);
    const back = new Set(outcome.undone.map((s) => s.target).filter(Boolean));
    if (back.size) setDone((d) => Object.fromEntries(Object.entries(d).filter(([key]) => !back.has(key))));
    setNote({ kind: outcome.status === 'undone' ? 'ok' : 'warn', text: outcome.note });
    return outcome;
  }

  /** Insert the part of the text this box takes, in the box's own mode. */
  const insertNow = (target) => {
    const text = textFor(target);
    if (!text) {
      setNote({ kind: 'danger', text: emptyText });
      return;
    }
    insert(target, text, target.mode, false);
  };

  /** Open the edit box on this box's part of the text (or on `text`: what the review stopped). */
  const startEdit = (target, text) => {
    setFindings(null);
    setNote(null);
    setEditing({ key: target?.key || '', text: text ?? textFor(target) });
  };

  // Undo is offered while the record the insert was made on is open and has not been saved since.
  const canUndo = Boolean(undo) && undo.steps.some((step) => undoStillFor(step, page));

  return { note, setNote, findings, editing, setEditing, done, busy, copy, insert, insertNow, startEdit, insertClose, undo: canUndo, undoNow };
}
