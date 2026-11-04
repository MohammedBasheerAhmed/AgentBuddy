import { useRef, useState } from 'react';
import { createGuard, insertText } from './insertFlow.js';
import { t } from '../i18n/index.js';

const sendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

/**
 * Copy and Insert for a card that offers an AI text box by box (insertFlow insertTargets): the Ticket screen's answers (AnswerCard)
 * and the email draft waiting on the email form (PendingDraft). Every insert takes the one insert path (insertFlow insertText: the
 * record the text was written for, one whitelisted box, the safe-to-send review first, never a save), one at a time (createGuard).
 * A review that stops an insert leaves `findings` (shown with InsertFindings: Insert anyway / Edit first); "Edit first" opens the
 * text in the edit box (`editing`, InsertEditor), which inserts through `insert` too and shows the review's findings itself.
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
  const [findings, setFindings] = useState(null); // { items, target, text, mode }: an insert the review stopped
  const [editing, setEditing] = useState(null); // { key, text } while the edit box is open
  const [done, setDone] = useState({}); // target keys that went in
  const [busy, setBusy] = useState(false); // an insert is in flight: every insert button is off
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

  async function insert(target, text, mode, force = false) {
    if (guard.current.busy) return null;
    setNote(null);
    setBusy(true);
    let outcome;
    try {
      outcome = await guard.current.run(null, () => insertText({ page, target, text, mode, source, pinned, review, force, send: sendToTab }));
    } finally {
      setBusy(false);
    }
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

  return { note, setNote, findings, editing, setEditing, done, busy, copy, insert, insertNow, startEdit };
}
