// The decisions inside useRun that are not about React: kept here as plain functions so tests/panel-run-logic.test.js can pin them.

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
  };
}
