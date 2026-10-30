// What an Insert button puts into a form field, for the core features whose answer has a part that belongs to the agent only.
// Pure. Each function gets the plain text the result view builds from the answer (toPlainText of parseSafeText) and returns
// the part to insert, or '' when that part is not there (the view then says "nothing to insert; use Copy").
//
//   missing-info       The answer starts with a "Missing:" line for the AGENT, then the questions for the REQUESTER. Only the
//                      questions go into the customer comment: "Missing: business impact, error text" is the agent's checklist,
//                      not something to send to the customer.
//   resolution-notes   The answer ends with "Suggested close code: ...", advice for the agent who picks the code in its own
//                      choice field. It does not belong in the resolution notes, which other agents search and customers can read.

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
