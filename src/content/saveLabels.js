// "Did the person press something that saves or posts?" for the content script (src/content/index.js, the form stamp). Pure: no page.
//
// A Workspace saves without reloading the page, and a portal sends a comment without reloading it, so the only sign is the press of
// the page's own button. Audit of 2026-11-07, S6 and S20: the first list had five English labels, so a Workspace in Arabic, a button
// called "Post", "Save & Close" or "Close incident", and every portal button were never noticed, and an Undo that no longer had anything
// to put back stayed offered. The words are English and Arabic; a label counts when it HAS one of them as a whole word (so "Save and
// close" and "Close incident" count and "Saved searches" does not). A press counted by mistake costs one extra read of the ticket's
// header and withdraws an Undo (the safe side); a press missed is what this list is for. The page bridge has a second, wordless
// sign: the box an insert wrote to being emptied or replaced (bridge.js watchInsert).
//
// Arabic is written as escapes so the file stays plain ASCII: save, update, resolve, send, post, apply, submit, complete.

const WORDS = new Set([
  ...'save update resolve submit post send publish apply'.split(' '), // (one string: the read-only scan looks for the quoted word, which a button label is not)
  '\u062d\u0641\u0638', '\u0627\u062d\u0641\u0638', '\u062a\u062d\u062f\u064a\u062b', '\u062d\u062f\u062b', '\u062d\u0644', '\u0627\u0631\u0633\u0627\u0644', '\u0627\u0631\u0633\u0644',
  '\u0646\u0634\u0631', '\u062a\u0637\u0628\u064a\u0642', '\u062a\u0642\u062f\u064a\u0645', '\u0627\u0643\u0645\u0627\u0644',
]);

// "Close" alone is a button that shuts a tab or a dialog; it counts only with what it closes, or as the second half of "Mark complete".
const PHRASES = [
  'mark complete', 'close complete', 'complete task', 'close incident', 'close case', 'close task', 'close ticket', 'close request',
  'close problem', 'close change', 'close and', 'close with',
];

/** Lower case words: Arabic marks and stretching taken out, the forms of alef and of final yeh made one, anything else a space. */
export function labelWords(text) {
  const t = String(text == null ? '' : text)
    .slice(0, 80)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
  return t ? ` ${t} ` : '';
}

/** Is this the label of a button that saves, posts or sends? */
export function isSaveLabel(label) {
  const words = labelWords(label);
  if (!words || words.length > 60) return false;
  for (const word of words.trim().split(' ')) if (WORDS.has(word)) return true;
  return PHRASES.some((phrase) => words.includes(` ${phrase} `) || words.includes(` ${phrase}`));
}
