// What an Insert button puts into a form field, for the core features whose answer has a part that belongs to the agent only.
// Pure. Each function gets the plain text the result view builds from the answer (toPlainText of parseSafeText) and returns
// the part to insert, or '' when that part is not there (the view then says "nothing to insert; use Copy").
//
//   missing-info       The answer starts with a "Missing:" line for the AGENT, then the questions for the REQUESTER. Only the
//                      questions go into the customer comment: "Missing: business impact, error text" is the agent's checklist,
//                      not something to send to the customer.
//   resolution-notes   The answer ends with "Suggested close code: ...", advice for the agent who picks the code in its own
//                      choice field. It does not belong in the resolution notes, which other agents search and customers can read.
//                      On a problem the same answer is split: the Cause into cause_notes, Fix and Verification into fix_notes.
//   chat-reply         The three numbered replies, each on its own (numberedChoices), so each can be copied alone.

const LIST_START = /^\s*(?:\d{1,2}[.)]|[-*])\s+/;

// A line that starts with one of `labels` followed by a colon, with the markdown a model sometimes adds ("**Missing:**", "## Missing:").
const labelLine = (labels) => new RegExp(`^[\\s>#*_-]*(?:${labels.join('|')})[\\s*_]*:`, 'i');

const MISSING = labelLine(['missing', 'missing information', 'missing details']);
const CLOSE_CODE = labelLine(['suggested close code', 'close code', 'suggested resolution code', 'resolution code']);
const NOTE_LABELS = labelLine(['cause', 'fix', 'verification']);

const tidy = (lines) => lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Remove every block that starts with a line matching `start`. A block runs to the first blank line, the first line that
 * starts a list, or the first line matching `stop`.
 */
function withoutBlocks(text, start, stop = null) {
  const out = [];
  let skipping = false;
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (start.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && (!line.trim() || LIST_START.test(line) || (stop && stop.test(line)))) skipping = false;
    if (!skipping) out.push(line);
  }
  return tidy(out);
}

/** The requester's part of a "What is missing?" answer: the questions (and their short lead-in), without the "Missing:" line. */
export function pickRequesterQuestions(plain) {
  const rest = withoutBlocks(plain, MISSING);
  // Nothing but the agent's line: there are no questions to send.
  return /[?]|^\s*\d{1,2}[.)]\s+\S/m.test(rest) ? rest : '';
}

/** Resolution notes without the "Suggested close code" advice (the code has its own field on the form). */
export function pickResolutionNotes(plain) {
  return withoutBlocks(plain, CLOSE_CODE, NOTE_LABELS);
}

// A problem has no single resolution-notes box: its form has "Cause notes" and "Fix notes" (close_notes is not on it). The same
// answer is split: the Cause block goes into cause_notes, the Fix and Verification blocks into fix_notes.
const CAUSE = labelLine(['cause']);
const FIX_OR_CHECK = labelLine(['fix', 'verification']);

/** The text after "Cause:" (the line and anything under it, up to the next label), or '' when it is missing or "Not confirmed". */
export function pickCauseNotes(plain) {
  const out = [];
  let inside = false;
  for (const line of String(plain ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (CAUSE.test(line)) {
      inside = true;
      out.push(line.replace(CAUSE, '').replace(/^[\s*_]+/, '').trim()); // ("**Cause:** Disk full": the closing ** goes too)
      continue;
    }
    if (inside && (FIX_OR_CHECK.test(line) || CLOSE_CODE.test(line))) break;
    if (inside) out.push(line);
  }
  const text = tidy(out);
  return /^not (confirmed|stated)\.?$/i.test(text) ? '' : text;
}

/**
 * The numbered items of an answer ("1. ...", "2) ..."), each with the lines that follow it, as separate texts: the three chat
 * replies, so each can be copied on its own. A line before the first number (an introduction) is left out. At most `max`; [] when
 * the answer has no numbered items (the card then shows the answer whole).
 */
export function numberedChoices(plain, max = 3) {
  const items = [];
  let open = false; // a blank line ends an item: a closing remark after the list is not part of reply 3
  for (const line of String(plain ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const start = /^\s*(?:\*\*)?\d{1,2}[.)](?:\*\*)?\s+(.*)$/.exec(line);
    if (start) {
      items.push([start[1]]);
      open = true;
    } else if (!line.trim()) open = false;
    else if (open) items[items.length - 1].push(line.trim());
  }
  return items
    .map((lines) => lines.join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, Math.max(0, max));
}

/** The Fix and Verification lines of resolution notes, for a problem's fix notes: no Cause line, no close-code advice. */
export function pickFixNotes(plain) {
  return withoutBlocks(withoutBlocks(plain, CLOSE_CODE, NOTE_LABELS), CAUSE, FIX_OR_CHECK);
}
