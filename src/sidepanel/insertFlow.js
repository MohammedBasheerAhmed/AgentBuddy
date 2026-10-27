// One insert, from the button press to its outcome, without React: the result card (ResultView) and the Write panels (useFill) both
// run it, and tests/insert-flow.test.js covers it.
//
//   createGuard()    one insert at a time, and a button that inserted stays done. A second click while the first is still in
//                    flight (the page answers in a few hundred milliseconds) is ignored, so "append" can never add the text twice.
//   performInsert()  review the text for the field it goes into, send FILL_FIELD with the record it was written for, and say what
//                    happened. It never saves anything and never retries.

import { buildFillMessage, fillReasonText, insertedNote, wrongRecordText } from '../lib/fillable.js';
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

/**
 * @param {{
 *   page: object,                                  the page state (tabId, record, newRecord, href)
 *   spec: { field: string, label?: string, fieldLabel?: string, mode?: string },
 *   value: string,                                 the text to insert, plain
 *   force?: boolean,                               skip the review (the person chose "Insert anyway")
 *   expect?: object|null,                          the record the text was written for; undefined = the page as it is now, null = any form
 *   number?: string,                               that record's number, for the message when it is not the one open
 *   review?: { people?: object[], scan?: Function, internalTexts?: string[] },
 *   send: (tabId: number, message: object) => Promise<object>,
 * }} args
 * @returns {Promise<
 *   { status: 'empty' } |
 *   { status: 'findings', items: object[], hints: object[] } |
 *   { status: 'inserted', answer: object, note: string } |
 *   { status: 'failed', answer: object, why: string }>}
 */
export async function performInsert({ page, spec, value, force = false, expect, number = '', review = {}, send }) {
  const text = String(value ?? '');
  if (!text.trim()) return { status: 'empty' };
  if (!force) {
    const found = reviewForInsert(spec.field, text, review);
    if (found.serious.length) return { status: 'findings', items: found.serious, hints: found.hints };
  }
  const message = buildFillMessage({ field: spec.field, value: text, label: spec.fieldLabel || spec.label || '', mode: spec.mode, expect, page });
  let answer;
  try {
    answer = await send(page.tabId, message);
  } catch {
    answer = null;
  }
  if (!answer || typeof answer !== 'object' || answer.error) answer = { ok: false, reason: 'no-form' };
  if (answer.ok) return { status: 'inserted', answer, note: insertedNote(answer) };
  return { status: 'failed', answer, why: answer.reason === 'wrong-record' ? wrongRecordText({ expect: message.expect, number }) : fillReasonText(answer.reason) };
}
