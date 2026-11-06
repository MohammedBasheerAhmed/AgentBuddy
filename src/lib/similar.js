// "Records like this one": keyword matching on a record's short description, no AI tokens. The search is a plain
// LIKE query on the same table; the ranking is how many of the keywords each hit shares with the record on screen.
//
// Words of any script that puts spaces between words: English and other Latin languages (with accents), Arabic, Cyrillic, Greek,
// Hebrew... Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Myanmar) are NOT supported: a whole
// sentence would be one "word" no other ticket contains, so their letters are left out (docs/live-questions/i18n.md).
//
// A keyword has two forms, never mixed up:
//  - the QUERY form, what similarKeywords returns and what goes to ServiceNow: the word as written, in lower case, without Arabic's
//    optional marks (short vowels, tatweel), and for Arabic without a leading article (ال، وال، بال، كال، فال، لل) when 3 letters or
//    more remain and without a common ending (ات، ها، ة، ه، ي) when 4 or more remain. ServiceNow's LIKE is a substring match on the
//    stored text, which is not folded: "بريد" finds "البريد" and "بريدي", but a folded "اعاده" would not find "إعادة". So the query
//    form is always a piece of the word exactly as it was written, never a folded spelling.
//  - the MATCH form (matchKey, textHas): folded for comparing in the panel only: lower case, normalizeArabic (alef forms, alef
//    maqsura, ta marbuta), accents taken off ("café" meets "cafe"). Never sent, never shown.

import { SYS_ID_RE } from '../context/util.js';
import { normalizeArabic } from './scriptDetect.js';

// English filler, then Arabic filler (function words, and what every ticket says: problem, error, please, help, not working,
// again, still...). The Arabic words are folded with normalizeArabic when the set is built, so they can be written normally here.
const STOP_EN =
  'a an and are as at be been but by can cannot could did do does for from had has have how i if in into is it its just ' +
  'me my no not of on or our out over so some than that the their them then there these they this to too up us was we ' +
  'were what when where which who why will with would you your please need needs unable issue problem error help ' +
  'cant dont doesnt wont isnt arent every not working work works since after before again still new getting get got';
const STOP_AR =
  'في من على إلى الى عن مع هذا هذه ذلك تلك هنا هناك الذي التي الذين ما ماذا متى أين كيف لماذا هل أن إن أنا نحن هو هي هم أنت ' +
  'انتم كان كانت يكون تكون او أو ثم قد لقد كل جميع بعد قبل عند عندما لم لن لا يا لدي لدينا عندي عندنا لكن ولكن حتى أيضا ' +
  'جدا فقط غير بين حول خلال منذ دون بدون مثل كما إذا لو أي كذلك تم يتم يوجد توجد به بها له لها لي لنا فيه فيها منه منها ' +
  'عليه عليها عدم الآن حاليا دائما أحيانا يرجى الرجاء رجاء برجاء أرجو نرجو فضلك أحتاج نحتاج يحتاج أريد نريد مشكلة مشاكل ' +
  'خطأ أخطاء مساعدة مساعدتي مساعدتكم ساعدني ساعدوني ساعدونا مشكلتي مشكلتنا أستطيع نستطيع تستطيع يمكن يمكنني يمكنك يمكنكم ' +
  'أتمكن يعمل تعمل يشتغل تشتغل عمل جديد جديدة مرة أخرى مجددا زال يزال تزال مازال لازال عاجل شكرا مرحبا السلام عليكم لديكم عندكم';
const STOP = new Set([...STOP_EN.split(' '), ...STOP_AR.split(' ').map(normalizeArabic)]);

// ---- The two forms of a word ------------------------------------------------------------------------------------------

// Arabic short vowels and other marks, the superscript alef, Quranic marks and the tatweel (the same set normalizeArabic drops):
// optional in writing, and a word written with them would not be found in a text written without.
const ARABIC_MARKS = new RegExp('[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]', 'g');
const ARABIC_LETTER = /\p{Script=Arabic}/u;
// Letters of the scripts written without spaces between words (see the top of this file).
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]+/gu;
// A word: starts with a letter, then letters, marks, digits, "_" or "-" (vpn-client, error_code); 3 characters or more.
const WORD = /\p{L}[\p{L}\p{M}\p{N}_-]{2,}/gu;
// What a query term may hold. Nothing else: no caret, equals sign, at sign, colon, quote, space or line break (an encoded query's
// operators and separators are all among the characters taken out).
const NOT_QUERY_SAFE = /[^\p{L}\p{M}\p{N}_-]/gu;

// The Arabic article, alone or after a one-letter conjunction or preposition, longest first.
const ARABIC_ARTICLES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال'];
// Endings a query term may lose: the feminine plural, "her/its", the ta marbuta, "his/its", "my" ("طابعات", "حسابي"). What is left is
// still a piece of the word as written, so the substring search finds every form: "حساب" finds "حسابي", "الحساب" and "حسابات".
const ARABIC_ENDINGS = ['ات', 'ها', 'ة', 'ه', 'ي'];

/**
 * An Arabic word without its leading article ("البريد" -> "بريد", "بالبريد" -> "بريد", "للمستخدم" -> "مستخدم") when at least 3
 * letters remain; any other word as it is. Works on a word as written and on a folded one.
 */
export function withoutArabicArticle(word) {
  const w = String(word ?? '');
  if (!ARABIC_LETTER.test(w)) return w;
  const article = ARABIC_ARTICLES.find((a) => w.startsWith(a) && w.length - a.length >= 3);
  return article ? w.slice(article.length) : w;
}

// The query form of an Arabic word: no article, and no ending when 4 letters or more remain (a 3-letter piece is found inside too
// many other words). Any other word as it is.
function arabicQueryForm(word) {
  const w = withoutArabicArticle(word);
  if (!ARABIC_LETTER.test(w)) return w;
  const ending = ARABIC_ENDINGS.find((e) => w.endsWith(e) && w.length - e.length >= 4);
  return ending ? w.slice(0, -ending.length) : w;
}

/** A word as it may go into an encoded query: letters, marks, digits, "_" and "-" only, Arabic marks removed ('' when nothing is left). */
export function queryTerm(word) {
  return String(word ?? '').normalize('NFC').replace(ARABIC_MARKS, '').replace(NOT_QUERY_SAFE, '');
}

/** Text folded for comparing in the panel (see the top of this file). Never sent to ServiceNow, never shown. */
export function matchKey(text) {
  return normalizeArabic(String(text ?? '').toLowerCase())
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Does `text` contain `word`, compared in the match form? */
export const textHas = (text, word) => {
  const key = matchKey(word);
  return Boolean(key) && matchKey(text).includes(key);
};

/** A filler word (English or Arabic, with or without the article or a leading "و" / "ف")? */
function isStop(word) {
  const folded = normalizeArabic(word);
  if (STOP.has(folded) || STOP.has(withoutArabicArticle(folded))) return true;
  return /^[وف]/.test(folded) && folded.length > 3 && STOP.has(folded.slice(1));
}

// ---- Look-alikes ------------------------------------------------------------------------------------------------------

/**
 * The words worth searching for: not filler, acronyms (VPN, SAP, LDAP) first, then the longest (rarer) words, at most
 * `max`. Words need 3+ letters. Each is in the query form (see the top of this file).
 */
export function similarKeywords(text, max = 4) {
  const original = String(text || '').normalize('NFC');
  const acronyms = new Set((original.match(/\b[A-Z]{2,6}\b/g) || []).map((w) => w.toLowerCase()));
  const seen = new Set();
  const words = [];
  for (const found of original.toLowerCase().replace(NO_SPACE_SCRIPT, ' ').match(WORD) || []) {
    const plain = found.replace(ARABIC_MARKS, '');
    if (plain.length < 3 || isStop(plain)) continue;
    const word = arabicQueryForm(plain);
    const key = matchKey(word);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  const weight = (w) => (acronyms.has(w) ? 100 : 0) + w.length;
  return words.sort((a, b) => weight(b) - weight(a) || a.localeCompare(b)).slice(0, max);
}

/** Encoded query for the candidates: any keyword in the short description, never the record itself. */
export function similarQuery(keywords, { excludeSysId = '', field = 'short_description' } = {}) {
  const safe = (keywords || []).map(queryTerm).filter(Boolean);
  if (!safe.length) return '';
  const any = safe.map((w, i) => `${i ? 'OR' : ''}${field}LIKE${w}`).join('^');
  const exclude = SYS_ID_RE.test(excludeSysId) ? `^sys_id!=${excludeSysId}` : '';
  return `${any}${exclude}^ORDERBYDESCsys_updated_on`;
}

/** Hits sorted by shared keywords (compared in the match form), then newest first. Each gets { shared, total }. */
export function rankSimilar(rows, keywords, field = 'short_description') {
  const flat = (v) => (v && typeof v === 'object' ? v.display_value ?? v.value ?? '' : v ?? '');
  const keys = keywords.map(matchKey).filter(Boolean);
  return (rows || [])
    .map((row) => {
      const text = matchKey(flat(row[field]));
      return { row, shared: keys.filter((w) => text.includes(w)).length, total: keywords.length };
    })
    .filter((hit) => hit.shared > 0)
    .sort((a, b) => b.shared - a.shared || String(flat(b.row.sys_updated_on)).localeCompare(String(flat(a.row.sys_updated_on))));
}

// ---- Word rules in Arabic (shared by the no-AI rules: src/itsm/sentiment.js, src/insights/missing.js) ------------------------

// Before an Arabic word: not a letter, mark or digit (so the word is not the end of another one), then optionally what Arabic writes
// onto the front of a word: the conjunction و or ف, then a preposition ب، ل، ك, then the article, each one optional ("والخطأ",
// "بالرسالة", "وبالخطأ", "وللمدير").
const AR_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])(?:[وف]?(?:[بلك]?ال|لل|[بلك])|[وف])?';
const AR_AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

/**
 * One regular expression for a list of Arabic words or phrases, matched as whole words in text folded with normalizeArabic (the
 * caller folds the text). Each entry is regular-expression source written in plain Arabic: it is folded the same way here, so
 * "خطأ" and "رسالة" may be written as they are spelled. A space in an entry stands for any run of spaces. Developer-written lists
 * only: never build an entry from ticket text.
 * @param {string[]} entries
 * @param {string} [flags] 'u' (add 'g' to count matches)
 */
export function arabicRule(entries, flags = 'u') {
  const alternatives = entries.map((e) => normalizeArabic(e).replace(/ /g, '\\s+')).join('|');
  return new RegExp(`${AR_BEFORE}(?:${alternatives})${AR_AFTER}`, flags.includes('u') ? flags : `${flags}u`);
}

/** The text folded for the Arabic word rules, or '' when it has no Arabic letter (nothing to match, nothing to fold). */
export const arabicFolded = (text) => {
  const s = String(text ?? '');
  return ARABIC_LETTER.test(s) ? normalizeArabic(s) : '';
};
