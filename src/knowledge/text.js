// Small text helpers shared by the knowledge tools: words, a light stemmer and a stop list. Pure.
//
// The stemmer is deliberately crude (plurals, -ing, -ed, a trailing e): it only has to make "disconnects", "disconnected" and
// "disconnecting" meet. What a person reads is always an original word ("form"), never a stem.
//
// Arabic (round 4): the stop lists have Arabic words too, and an Arabic word's stem is folded with normalizeArabic and loses a
// leading article and one common ending ("الطابعات" and "طابعة" meet as "طابع"). Scripts written without spaces between words
// (Chinese, Japanese, Thai) are not split into words: a run of them is one word (see src/lib/similar.js).

import { normalizeArabic } from '../lib/scriptDetect.js';
import { withoutArabicArticle } from '../lib/similar.js';

// Words that say nothing about the topic of an article or a ticket.
const COMMON = (
  'a an and are as at be been but by can cannot could did do does for from had has have how i if in into is it its just ' +
  'me my no not of on or our out so some than that the their them then there these they this to too up us was we were ' +
  'what when where which who why will with would you your yours via per also one'
).split(' ');
// The same in Arabic (written normally; folded with normalizeArabic below).
const COMMON_AR = (
  'في من على إلى الى عن مع هذا هذه ذلك تلك هنا هناك الذي التي الذين ما ماذا متى أين كيف لماذا هل أن إن أنا نحن هو هي هم ' +
  'أنت انتم كان كانت يكون تكون او أو ثم قد لقد كل جميع بعد قبل عند عندما لم لن لا يا لدي لدينا عندي لكن ولكن حتى أيضا جدا ' +
  'فقط غير بين حول خلال منذ دون بدون مثل كما إذا لو أي كذلك تم يتم يوجد توجد به بها له لها لي لنا فيه فيها منه منها عليه ' +
  'عليها عبر واحد'
).split(' ');

// Filler that titles of knowledge articles are full of.
const TITLE_FILLER = ['guide', 'article', 'instructions', 'instruction', 'overview', 'steps', 'step', 'tips', 'faq', 'use', 'using', 'about'];
const TITLE_FILLER_AR = ['دليل', 'مقال', 'مقالة', 'تعليمات', 'إرشادات', 'نظرة', 'عامة', 'خطوات', 'خطوة', 'نصائح', 'أسئلة', 'شائعة', 'استخدام', 'طريقة', 'كيفية'];

// Filler that ticket titles are full of.
const TICKET_FILLER = [
  'please', 'need', 'needs', 'unable', 'cant', 'dont', 'doesnt', 'wont', 'isnt', 'arent', 'issue', 'issues', 'problem', 'problems',
  'help', 'urgent', 'asap', 'hello', 'regards', 'thanks', 'thank', 'user', 'users', 'team', 'ticket', 'incident', 'case', 'getting',
  'get', 'got', 'working', 'work', 'works', 'new', 'old', 'again', 'still', 'since', 'after', 'before', 'every', 'any', 'all',
];
const TICKET_FILLER_AR = [
  'يرجى', 'الرجاء', 'رجاء', 'أرجو', 'نرجو', 'فضلك', 'أحتاج', 'نحتاج', 'أريد', 'لا أستطيع', 'أستطيع', 'يمكنني', 'مشكلة', 'مشاكل',
  'مشكلتي', 'خطأ', 'أخطاء', 'مساعدة', 'عاجل', 'مرحبا', 'شكرا', 'تحية', 'مستخدم', 'مستخدمين', 'فريق', 'تذكرة', 'حادثة', 'حالة', 'يعمل',
  'تعمل', 'يشتغل', 'عمل', 'جديد', 'جديدة', 'قديم', 'مرة', 'أخرى', 'مجددا', 'زال', 'يزال', 'مازال', 'لازال', 'دائما',
];

const fold = (list) => list.map(normalizeArabic);
export const STOP_TITLE = new Set([...COMMON, ...TITLE_FILLER, ...fold(COMMON_AR), ...fold(TITLE_FILLER_AR)]);
export const STOP_TICKET = new Set([...COMMON, ...TICKET_FILLER, ...fold(COMMON_AR), ...fold(TICKET_FILLER_AR)]);

const VOWEL_OR_LIQUID = /[aeiouyls]/;
const ARABIC = /\p{Script=Arabic}/u;

// Endings an Arabic stem loses (in the folded spelling, where ta marbuta is "ه"), longest first, one at most: the nisba "يه", the
// feminine plural, the masculine plural, "her/its", ta marbuta or "his", "my". The plurals in "ون"/"ين" only when 4 letters remain
// ("تخزين" is not a plural).
const ARABIC_ENDINGS = [['يه', 3], ['ات', 3], ['ون', 4], ['ين', 4], ['ها', 3], ['ه', 3], ['ي', 3]];

/**
 * The stem of an Arabic word: folded, no article, one common ending off. For comparing only, never shown. The article is taken off
 * the folded word as often as it is there: folding makes "إلكتروني" start like an article ("الكتروني"), so "إلكتروني",
 * "الإلكتروني" and "الالكتروني" only meet when every leading "ال" goes.
 */
export function arabicStem(word) {
  let s = normalizeArabic(word);
  for (let bare = withoutArabicArticle(s); bare !== s; bare = withoutArabicArticle(s)) s = bare;
  const ending = ARABIC_ENDINGS.find(([e, keep]) => s.endsWith(e) && s.length - e.length >= keep);
  return ending ? s.slice(0, -ending[0].length) : s;
}

/** A rough stem: lower-case already. Short words are left alone. */
export function stem(word) {
  if (ARABIC.test(word)) return arabicStem(word);
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

// A word is letters and digits, with an apostrophe (straight or curly) allowed inside it ("can't"). Marks belong to the word they
// are on (an Arabic short vowel or tatweel must not cut a word in two).
const WORD = new RegExp(`[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*(?:['${String.fromCharCode(0x2019)}][\\p{L}\\p{M}]+)?`, 'gu');

/** Words of a text, lower-case, in order. Letters and digits only ("windows 11" gives "windows", "11"). */
export function wordsOf(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().match(WORD) || [];
}

// A filler word, compared as written and, for Arabic, folded and without the article ("الذي", "والتي", "المشكلة").
function isStop(word, stop) {
  if (stop.has(word)) return true;
  if (!ARABIC.test(word)) return false;
  const folded = normalizeArabic(word);
  if (stop.has(folded) || stop.has(withoutArabicArticle(folded))) return true;
  return /^[وف]/.test(folded) && folded.length > 3 && stop.has(folded.slice(1));
}

const keep = (word, stop) => !isStop(word, stop) && (word.length > 1 || /\d/.test(word));

/** The words that carry meaning, in order, with repeats: { stem, form } (form: the word as written, lower case). */
export function stemsWithForms(text, stop = STOP_TITLE) {
  return wordsOf(text)
    .filter((w) => keep(w, stop))
    .map((w) => ({ stem: stem(w), form: w }));
}

/** Stems of the words that carry meaning, in order, with repeats (for shingles). */
export function stemsOf(text, stop = STOP_TITLE) {
  return stemsWithForms(text, stop).map((x) => x.stem);
}

/**
 * The keywords of a text: [{ stem, form, weight }] without repeats, at most `max`, acronyms and long words first (they say the most).
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
    .map(({ stem: s, form, weight }) => ({ stem: s, form, weight }));
}

/** Jaccard similarity of two Sets (1 for two empty sets is avoided: empty means 0). */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / (a.size + b.size - shared);
}
