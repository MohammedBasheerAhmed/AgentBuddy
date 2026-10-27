// The ONE review of text that is about to be put into a form field. ResultView (the Insert buttons on a result) and the Write
// section (src/compose/sendCheck.js) both call it; there is no second copy to drift apart.
//
//   reviewForCustomer(text, { people, scan, internalTexts }) -> { serious: Finding[], hints: Finding[] }
//   reviewForInsert(field, text, opts)                       -> the same, for the field it goes into
//   isCustomerVisible(field)                                 -> from FILLABLE_FIELDS (src/lib/fillable.js)
//
// `serious` findings stop the insert until the person chooses "Insert anyway". `hints` are low severity (another person's name,
// an IP or MAC address, "escalated to"): shown as a non-blocking "Worth a look" list, never hidden.
//
// What it looks at, in one place:
//   - personal data and secrets (checkOutgoing, the same detectors the firewall uses), and what the firewall hid on the way out
//     and the model brought back (its own memory: `scan`)
//   - markup: a tag, [code], or a script link. A journal field shows [code] as HTML, and an article body is HTML
//   - a placeholder that was never replaced, such as [PERSON_1]
//   - words copied from an internal work note of the same record (6 or more in a row)
//
// Findings never carry the value itself: only a masked excerpt and advice. This is a reviewer's aid, not a guarantee.

import { checkOutgoing, maskExcerpt } from './index.js';
import { isCustomerVisible } from '../lib/fillable.js';

export { isCustomerVisible };

// Kinds the firewall masks on the way out and that must never come back into a message the customer reads.
const NEVER_BACK = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const NEVER_BACK_ADVICE = 'This is a password, key, card number or ID that was hidden from the AI, and it is back in the draft. Remove it before it reaches the customer.';

const MARKUP_ADVICE = 'This has markup in it (a tag, [code] or a script link). A form field can show it as live HTML. Remove it, or say it in words.';
const PLACEHOLDER_ADVICE = 'A hidden-name marker such as [PERSON_1] is still in the text, where a real value belongs. Replace it before you use the text.';
const OVERLAP_ADVICE = 'These words are also in an internal work note on this ticket. Check you may share them with the customer.';

// ---- Markup ---------------------------------------------------------------------------------------------------------

const MARKUP_PATTERNS = [
  /<\/?[A-Za-z!?]/g, // <img, </p>, <!--, <?xml
  /\[\/?code\]/gi, // [code] and [/code]: journal fields render these as HTML
  /\b(?:java|vb)script\s*:/gi,
];

/** Tags, [code] markers and script links. At most three are reported; each is one high finding. */
export function markupFindings(text) {
  const plain = String(text ?? '');
  const out = [];
  for (const pattern of MARKUP_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(plain)) !== null && out.length < 3) {
      const end = Math.min(plain.length, m.index + 40);
      out.push({ kind: 'MARKUP', severity: 'high', start: m.index, end: m.index + m[0].length, excerpt: plain.slice(m.index, end).replace(/\s+/g, ' ').slice(0, 24), advice: MARKUP_ADVICE });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- Placeholders ---------------------------------------------------------------------------------------------------

const PLACEHOLDER = /\[[A-Z][A-Z_]*_\d+\]/g;

/** `[PERSON_1]`-style markers the firewall wrote and nobody turned back into a value. At most three. */
export function placeholderFindings(text, severity = 'medium') {
  const plain = String(text ?? '');
  const out = [];
  PLACEHOLDER.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER.exec(plain)) !== null && out.length < 3) {
    out.push({ kind: 'PLACEHOLDER', severity, start: m.index, end: m.index + m[0].length, excerpt: m[0], advice: PLACEHOLDER_ADVICE });
  }
  return out;
}

// ---- Words copied from an internal note -----------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
const MAX_INTERNAL_TEXTS = 30;
const MAX_INTERNAL_CHARS = 20000;

function wordsWithOffsets(text) {
  const words = [];
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(text)) !== null) words.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return words;
}

/**
 * A run of `minWords` or more words in a row that also stands in one of `internalTexts` (the work notes of the same record).
 * Case and punctuation do not matter. Short runs of small words (under `minChars` characters) are ignored. At most three.
 */
export function overlapFindings(text, internalTexts, { minWords = 6, minChars = 24 } = {}) {
  const notes = (Array.isArray(internalTexts) ? internalTexts : []).filter((t) => typeof t === 'string' && t.trim()).slice(0, MAX_INTERNAL_TEXTS);
  if (!notes.length) return [];
  const seen = new Set();
  for (const note of notes) {
    const words = wordsWithOffsets(note.slice(0, MAX_INTERNAL_CHARS));
    for (let i = 0; i + minWords <= words.length; i += 1) seen.add(words.slice(i, i + minWords).map((x) => x.w).join(' '));
  }
  if (!seen.size) return [];
  const plain = String(text ?? '');
  const words = wordsWithOffsets(plain);
  const out = [];
  let i = 0;
  while (i + minWords <= words.length && out.length < 3) {
    const key = words.slice(i, i + minWords).map((x) => x.w).join(' ');
    if (!seen.has(key) || key.length < minChars) {
      i += 1;
      continue;
    }
    // Take the whole run: every following window that also matches extends it by one word.
    let last = i + minWords - 1;
    while (last + 1 < words.length && seen.has(words.slice(last + 2 - minWords, last + 2).map((x) => x.w).join(' '))) last += 1;
    const start = words[i].start;
    const end = words[last].end;
    out.push({ kind: 'INTERNAL_NOTE', severity: 'medium', start, end, excerpt: maskExcerpt(plain.slice(start, end)), advice: OVERLAP_ADVICE });
    i = last + 1;
  }
  return out;
}

// ---- The review -----------------------------------------------------------------------------------------------------

// What the firewall hid on the way out and the model brought back, as findings (only the kinds that must never come back).
function rememberedFindings(plain, scan, alreadyFound) {
  let remembered = [];
  try {
    remembered = (typeof scan === 'function' ? scan(plain) : []).filter((f) => NEVER_BACK.has(f.kind));
  } catch {
    /* the text check still applies */
  }
  return remembered
    .filter((f) => !alreadyFound.some((g) => g.start < f.end && f.start < g.end))
    .map((f) => ({ kind: f.kind, severity: 'high', start: f.start, end: f.end, excerpt: maskExcerpt(f.value), advice: NEVER_BACK_ADVICE }));
}

const byPosition = (a, b) => a.start - b.start || b.end - a.end;
const split = (all) => ({ serious: all.filter((f) => f.severity !== 'low'), hints: all.filter((f) => f.severity === 'low') });

/**
 * Review text that the customer (or the reader of an article) will be able to read.
 * @param {string} text the text about to be inserted
 * @param {{ people?: object[], scan?: (text: string) => object[], internalTexts?: string[] }} [options]
 *   people: the record's people (their own email addresses are not flagged); scan: the firewall's scan() from the run that
 *   produced the text; internalTexts: the record's work notes
 * @returns {{ serious: object[], hints: object[] }} findings: { kind, severity, start, end, excerpt, advice }
 */
export function reviewForCustomer(text, { people = [], scan = null, internalTexts = [] } = {}) {
  const plain = String(text ?? '');
  const base = checkOutgoing(plain, { people }).findings;
  const seriousBase = base.filter((f) => f.severity !== 'low');
  const all = [
    ...base,
    ...rememberedFindings(plain, scan, seriousBase),
    ...markupFindings(plain),
    ...placeholderFindings(plain, 'medium'),
    ...overlapFindings(plain, internalTexts),
  ].sort(byPosition);
  return split(all);
}

/**
 * Review text for the field it is going into. A field the customer can read gets the whole review; an internal one (work notes)
 * still gets the markup check (journal fields render [code] as HTML) and a note about a leftover placeholder.
 */
export function reviewForInsert(field, text, options = {}) {
  if (isCustomerVisible(field)) return reviewForCustomer(text, options);
  const plain = String(text ?? '');
  return split([...markupFindings(plain), ...placeholderFindings(plain, 'low')].sort(byPosition));
}

/**
 * The work notes of a pack (internal, never meant for the customer), as a list of texts for reviewForCustomer's `internalTexts`.
 * Kept in memory with the result of a run and nowhere else.
 */
export function internalTextsOf(pack) {
  const journal = Array.isArray(pack?.journal) ? pack.journal : [];
  return journal
    .filter((entry) => entry && entry.type === 'work_note' && typeof entry.text === 'string' && entry.text.trim())
    .map((entry) => entry.text)
    .slice(-MAX_INTERNAL_TEXTS);
}
