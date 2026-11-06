// Which script a piece of text is written in, and Arabic text folded for matching. Pure, no I/O.
//
//   scriptOf(text)        'arabic' | 'latin' | 'mixed' | 'other' | '' (too few letters to tell). Used to offer "Translate" on a
//                         customer's message written in another script than the panel's language, and to pick the word lists a
//                         no-AI rule should use (src/insights/risk.js, missing.js, the reply checks).
//   normalizeArabic(text) the text with the marks Arabic writers use inconsistently folded away, so that the same word written two
//                         ways matches: short vowels and other diacritics and the tatweel are removed, the alef forms become a
//                         plain alef, alef maqsura becomes ya, ta marbuta becomes ha. For matching only, never for display.
//
// Shared by the round-4 areas (docs/round4.md). Ask the lead before changing what it returns.

const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;

/**
 * The script most of a text's letters are written in.
 * @param {string} text
 * @param {{ minLetters?: number }} [options] fewer letters than this: '' (a ticket number or "ok" says nothing)
 * @returns {'arabic' | 'latin' | 'mixed' | 'other' | ''}
 */
export function scriptOf(text, { minLetters = 3 } = {}) {
  let arabic = 0;
  let latin = 0;
  let letters = 0;
  for (const ch of String(text || '')) {
    if (!LETTER.test(ch)) continue;
    letters += 1;
    if (ARABIC.test(ch)) arabic += 1;
    else if (LATIN.test(ch)) latin += 1;
  }
  if (letters < minLetters) return '';
  if (arabic / letters >= 0.6) return 'arabic';
  if (latin / letters >= 0.6) return 'latin';
  if ((arabic + latin) / letters >= 0.6) return 'mixed';
  return 'other';
}

/** True when most letters are Arabic. */
export const isArabicText = (text) => scriptOf(text) === 'arabic';

// Diacritics (tashkeel, the superscript alef, Quranic marks) and the tatweel (kashida) used to stretch a word.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** Arabic text folded for matching (see the top of this file). Other scripts pass through unchanged. */
export function normalizeArabic(text) {
  return String(text || '')
    .replace(MARKS, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}
