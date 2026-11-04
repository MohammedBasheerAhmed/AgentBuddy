// Characters that change how text reads without showing. One definition for the two places that must agree on it: the PII
// firewall (src/pii/firewall.js) removes them before it looks for personal data, so "jane.roe<U+2063>@corp.example.org" is still
// an email address, and the answer renderer (src/render/safeText.js) removes them so a model answer cannot hide or reorder text.
//
// The set: C0/C1 controls (not tab or newline), soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul/Khmer/Mongolian
// fillers and the Mongolian vowel separator, zero-width and direction marks (200B-200F), bidi embeddings and overrides
// (202A-202E), word joiner and invisible operators (2060-2064), bidi isolates (2066-2069), deprecated format characters
// (206A-206F), variation selectors, the byte order mark, annotation characters, the shorthand and musical format controls, and
// the plane 14 tag block with the variation selector supplement (used to smuggle hidden text).
// Written as numbers so this file stays plain ASCII (no hidden characters in the source itself).

const hex4 = (n) => `\\u${n.toString(16).padStart(4, '0')}`;

const BMP = [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], 0xad, 0x34f, 0x61c, 0x115f, 0x1160, 0x17b4, 0x17b5, [0x180b, 0x180f], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x206f], 0x3164, [0xfe00, 0xfe0f], 0xfeff, 0xffa0, [0xfff9, 0xfffc],
];
// Outside the first plane, as UTF-16 pairs (the pattern runs without the u flag): U+1BCA0-1BCA3, U+1D173-1D17A, U+E0000-E03FF.
const ASTRAL = ['\\ud82f[\\udca0-\\udca3]', '\\ud834[\\udd73-\\udd7a]', '\\udb40[\\udc00-\\udfff]'];

/**
 * A new global pattern for the invisible characters, less the first-plane code points in `keep`: each caller keeps what it
 * needs (the renderer keeps the emoji variation selectors FE0E/FE0F; the firewall keeps ZWJ and ZWNJ, which some scripts need
 * to spell a word). A new pattern per call, so no two callers share a lastIndex.
 * @param {{ keep?: number[] }} [options]
 */
export function invisibleChars({ keep = [] } = {}) {
  const kept = [...new Set(keep)].sort((a, b) => a - b);
  const ranges = [];
  for (const item of BMP) {
    let [lo, hi] = Array.isArray(item) ? item : [item, item];
    for (const k of kept) {
      if (k < lo || k > hi) continue;
      if (k > lo) ranges.push([lo, k - 1]);
      lo = k + 1;
    }
    if (lo <= hi) ranges.push([lo, hi]);
  }
  const set = ranges.map(([lo, hi]) => (lo === hi ? hex4(lo) : `${hex4(lo)}-${hex4(hi)}`)).join('');
  return new RegExp([`[${set}]`, ...ASTRAL].join('|'), 'g');
}
