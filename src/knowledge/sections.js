// Pull one named section out of an answer that is written as "Heading: text" blocks (the AI features of this area ask for
// exactly such headings). Works on plain text (toPlainText of the safe-text blocks). Pure.

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Summary:", "**Summary:**", "## Summary", "1. Summary:" all start a section called Summary; "Summary of the call" does not
// (the name must be followed by a colon or end the line).
const startOf = (name) => new RegExp(`^\\s*(?:#{1,6}\\s*|[-*]\\s+|\\d+[.)]\\s+)?[*_]*${escapeRe(name)}[*_]*\\s*(?::[*_]*|$)`, 'i');

/**
 * The text under `heading`, up to the next of `headings` (or the end). '' when the heading is not there.
 * @param {string} text
 * @param {string} heading e.g. 'Suggested ticket notes'
 * @param {string[]} [headings] every heading the answer may contain, so the section knows where it ends
 */
export function sectionOf(text, heading, headings = []) {
  const lines = String(text ?? '').split('\n');
  const own = startOf(heading);
  const others = headings.filter((h) => h.toLowerCase() !== String(heading).toLowerCase()).map(startOf);
  const at = lines.findIndex((line) => own.test(line));
  if (at < 0) return '';
  const out = [];
  const first = lines[at].replace(own, '').trim();
  if (first) out.push(first);
  for (let i = at + 1; i < lines.length; i += 1) {
    if (others.some((re) => re.test(lines[i]))) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/** `sectionOf`, or the whole text when the heading is missing, so an answer that ignored the format is still usable. */
export function sectionOrAll(text, heading, headings = []) {
  return sectionOf(text, heading, headings) || String(text ?? '').trim();
}
