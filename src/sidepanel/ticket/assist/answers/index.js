// The Ticket screen's AI Assist answers: the run hook, the answer area and "Ask about this ticket" (owner: Answers agent,
// docs/round3.md; TRACKER.md AI0.4, AI0.5, AI0.2 preview, AI23 on an answer).
//
// useAnswers({ page, eff, record }) -> { run(feature, options), busy, reset, ... }   every AI call still goes through useRun's flow
// AnswerArea props: { assist, page, eff, record, active }      AskBox props: { assist, page, eff, record, focusAt }
//
// The runs and answers are kept per ticket in memory (session.js), not per view: TicketView stays mounted across records and this
// hook switches to the ticket on show by itself. Nobody needs to call reset() when the record changes.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { IDLE_RUN, isBusyPhase } from '../../../useRun.js';
import { featureById } from '../../../../features/registry.js';
import { allRuns, getVersion, keyOf, leaveScreen, peekRun, runFor, setLatest, startRun, store, subscribe } from './session.js';
import { elsewhereLines, refineFeature, refineMeta, refinePack } from './logic.js';

export { default as AnswerArea } from './AnswerArea.jsx';
export { default as AskBox } from './AskBox.jsx';
export { forgetAnswers } from './session.js';

const NO_ANSWERS = [];

/**
 * The answers of the ticket on show and the way to start a run on it.
 *
 * Returned: the state of this ticket's run (phase, active, prepared, error, errorCode, since, attempt, ...: as useRun), `busy`,
 * `answers` (newest first), `elsewhere` (lines about other tickets), and
 *   run(feature, options)        start a run on this ticket (options.getPack, options.meta as in useRun); the control that has the
 *                                focus is remembered so the focus can go back to it
 *   reset()                      stop this ticket's run (Stop waiting) and put its error away; answers stay
 *   again()                      run the last run of this ticket again
 *   confirmPreview / cancelPreview / maskMore   the check of what will be sent
 *   refine(answer, preset, choice)  rewrite an answer (Shorter, Translate...): a new answer for the same ticket
 *   retryAnswer(answer)          ask what made this answer again
 *   closeAnswer(answer), seen()
 */
export function useAnswers({ page, eff, record }) {
  const key = keyOf(page, record);
  // The newest settings and page reach every ticket's run from here (read at each step of a run).
  setLatest(page, eff);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const cur = useRef(null);
  cur.current = { key, page, record };
  useEffect(() => leaveScreen, []);

  const entry = key ? peekRun(key) : null;
  const state = entry?.state || IDLE_RUN;
  const answers = key ? store.list(key) : NO_ANSWERS;

  const run = useCallback((feature, options = {}) => {
    const { key: k, page: p, record: r } = cur.current;
    if (!k || !feature) return undefined;
    const e = runFor(k, p, r);
    // The control that started it (a list button, the side rail, the Ask button): the focus goes back there if the run ends empty.
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    e.opener = { element: el && el !== document.body ? el : null, id: options.focusId || feature.id };
    return startRun(k, p, r, feature, options);
  }, []);

  const withRun = (fn) => (...args) => {
    const k = cur.current.key;
    const e = k ? peekRun(k) : null;
    return e ? fn(e, ...args) : undefined;
  };

  const refine = useCallback((answer, preset, choice = {}) => {
    const { page: p } = cur.current;
    const feature = refineFeature(preset, choice, featureById);
    if (!feature || !answer) return undefined;
    // Only the answer's text is sent (with the people of its ticket, so names are masked again), labelled with the real table.
    // The record's work notes and the record the answer is for travel along in memory, for the Insert check of the new answer.
    return run(feature, { getPack: async () => refinePack(answer, p), meta: { ...refineMeta(answer, preset, choice), carry: { lastPack: answer.lastPack, source: answer.source, people: answer.people } }, focusId: '' });
  }, [run]);

  const retryAnswer = useCallback((answer) => (answer?.feature ? run(answer.feature, answer.options || {}) : undefined), [run]);

  return {
    ...state,
    key,
    busy: isBusyPhase(state.phase),
    answers,
    elsewhere: elsewhereLines({ runs: allRuns(), answersOf: (k) => store.list(k), current: key }),
    opener: entry?.opener || null,
    run,
    reset: withRun((e) => e.ctl.reset()),
    again: withRun((e) => e.ctl.again()),
    confirmPreview: withRun((e, opts) => e.ctl.confirmPreview(opts)),
    cancelPreview: withRun((e) => e.ctl.cancelPreview()),
    maskMore: (text) => {
      const k = cur.current.key;
      const e = k ? peekRun(k) : null;
      return e ? e.ctl.maskMore(text) : { ok: false, problem: 'GONE' };
    },
    refine,
    retryAnswer,
    closeAnswer: (answer) => (key && answer ? store.remove(key, answer.id) : false),
    seen: () => key && store.seen(key),
  };
}
