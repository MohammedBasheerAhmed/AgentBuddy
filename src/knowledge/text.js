// Small text helpers shared by the knowledge tools: words, a light stemmer and a stop list. Pure.
//
// The stemmer is deliberately crude (plurals, -ing, -ed, a trailing e): it only has to make "disconnects", "disconnected" and
// "disconnecting" meet. What a person reads is always an original word ("form"), never a stem.

// Words that say nothing about the topic of an article or a ticket.
const COMMON = (
  'a an and are as at be been but by can cannot could did do does for from had has have how i if in into is it its just ' +
  'me my no not of on or our out so some than that the their them then there these they this to too up us was we were ' +
  'what when where which who why will with would you your yours via per also one'
).split(' ');

// Filler that titles of knowledge articles are full of.
const TITLE_FILLER = ['guide', 'article', 'instructions', 'instruction', 'overview', 'steps', 'step', 'tips', 'faq', 'use', 'using', 'about'];

// Filler that ticket titles are full of.
const TICKET_FILLER = [
  'please', 'need', 'needs', 'unable', 'cant', 'dont', 'doesnt', 'wont', 'isnt', 'arent', 'issue', 'issues', 'problem', 'problems',
  'help', 'urgent', 'asap', 'hello', 'regards', 'thanks', 'thank', 'user', 'users', 'team', 'ticket', 'incident', 'case', 'getting',
  'get', 'got', 'working', 'work', 'works', 'new', 'old', 'again', 'still', 'since', 'after', 'before', 'every', 'any', 'all',
];

export const STOP_TITLE = new Set([...COMMON, ...TITLE_FILLER]);
export const STOP_TICKET = new Set([...COMMON, ...TICKET_FILLER]);

const VOWEL_OR_LIQUID = /[aeiouyls]/;

/** A rough stem: lower-case already. Short words are left alone. */
export function stem(word) {
  let s = word;
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 5 && s.endsWith('ing')) s = undouble(s.slice(0, -3));
  else if (s.length > 4 && s.endsWith('ed')) s = undouble(s.slice(0, -2));
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

// "resett" -> "reset", "logg" -> "log"; "pass" and "install" keep their double letters.
function undouble(s) {
  const last = s[s.length - 1];
  return s.length > 3 && last === s[s.length - 2] && !VOWEL_OR_LIQUID.test(last) ? s.slice(0, -1) : s;
}

// A word is letters and digits, with an apostrophe (straight or curly) allowed inside it ("can't").
const WORD = new RegExp(`[\\p{L}\\p{N}]+(?:['${String.fromCharCode(0x2019)}][\\p{L}]+)?`, 'gu');

/** Words of a text, lower-case, in order. Letters and digits only ("windows 11" gives "windows", "11"). */
export function wordsOf(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().match(WORD) || [];
}

const keep = (word, stop) => !stop.has(word) && (word.length > 1 || /\d/.test(word));

/** Stems of the words that carry meaning, in order, with repeats (for shingles). */
export function stemsOf(text, stop = STOP_TITLE) {
  return wordsOf(text)
    .filter((w) => keep(w, stop))
    .map(stem);
}

/**
 * The keywords of a text: [{ stem, form }] without repeats, at most `max`, acronyms and long words first (they say the most).
 * `form` is the word as written, for showing.
 */
export function keywordsOf(text, { stop = STOP_TICKET, max = 8 } = {}) {
  const original = String(text ?? '');
  const acronyms = new Set((original.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) || []).map((w) => w.toLowerCase()));
  const seen = new Map();
  for (const word of wordsOf(original)) {
    if (!keep(word, stop)) continue;
    const key = stem(word);
    if (!seen.has(key)) seen.set(key, { stem: key, form: word, weight: (acronyms.has(word) ? 100 : 0) + Math.min(word.length, 12) + (/^\d+$/.test(word) ? 3 : 0) });
  }
  return [...seen.values()]
    .sort((a, b) => b.weight - a.weight || a.stem.localeCompare(b.stem))
    .slice(0, max)
    .map(({ stem: s, form }) => ({ stem: s, form }));
}

/** Jaccard similarity of two Sets (1 for two empty sets is avoided: empty means 0). */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}
