// Two gentle checks for a reply the customer will read (round 4, docs/round4.md): does it say what happens next, and does it sound
// like blame or shouting. No AI: the small word lists below, in English and Arabic. Both give hints ('low' severity): they are shown
// under "Worth a look", never stop an insert, and give at most one line each.
//
//   nextStepFindings(text)  [] or one NO_NEXT_STEP finding: a reply of some length that names no next step, no time and asks nothing
//   toneFindings(text)      [] or one TONE finding: a phrase that sounds like blame (named in the excerpt), else a long run of capital
//                           letters, else three or more exclamation marks
//   isReplyField(field)     the fields a reply goes into (the customer comment, the email body): only there is a next step expected.
//                           A description, resolution notes or an article do not promise one.
//
// The review (review.js) adds the tone check to every text the customer can read and the next-step check to a reply. Arabic is matched
// on folded text (normalizeArabic from src/lib/scriptDetect.js), so a word written with or without hamza, tashkeel or tatweel matches;
// scriptOf decides whether the next-step check can judge a text at all: a script the lists do not cover, or Latin letters that are not
// English (French, Spanish...), is not judged rather than wrongly flagged. A missing hint proves nothing; a hint is a nudge, not a rule.

import { normalizeArabic, scriptOf } from '../lib/scriptDetect.js';
import { tm, t as tr } from '../i18n/index.js';

/** The fields a reply to the customer goes into. */
const REPLY_FIELDS = new Set(['comments', 'body']);
export const isReplyField = (field) => REPLY_FIELDS.has(field);

/** A reply shorter than this many words is a quick note ("Thanks, received."): it is not judged for a next step. */
export const NEXT_STEP_MIN_WORDS = 7;
/** A run of capitals is shouting from this many words, this many letters, and one word at least this long ("VPN SAP" is not). */
export const SHOUT_MIN_WORDS = 3;
export const SHOUT_MIN_LETTERS = 12;
export const SHOUT_LONGEST_WORD = 5;
/** This many exclamation marks in one text, in a row or apart. */
export const EXCLAMATIONS = 3;

// ---- The word lists (documented data) -------------------------------------------------------------------------------------------
//
// Lower case, written as people write them; Arabic is folded the same way as the text before matching. A phrase matches as whole
// words. An Arabic word may carry "and" or "so" in front (و، ف: "وسأقوم"); a next-step verb may also carry a pronoun at the end
// (سأوافيك، سنبقيكم، سأرسله).

/** Words that say what happens next or when: a promise, a time, or something the customer is asked to do. */
export const NEXT_STEP_WORDS = Object.freeze({
  en: Object.freeze([
    // a promise or a plan ("I'll" and friends are a pattern below)
    'will', 'shall', 'going to', 'about to', 'plan to', 'next step', 'next steps',
    'get back to you', 'keep you posted', 'keep you updated', 'keep you informed', 'let you know',
    // when
    'today', 'tonight', 'tomorrow', 'later today', 'this morning', 'this afternoon', 'this evening', 'this week', 'next week',
    'shortly', 'soon', 'end of day', 'end of the day', 'eod', 'close of business',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    // what the customer does next, or what to do if it comes back
    'let me know', 'let us know', 'get back to me', 'get back to us', 'reply to this', 'persists', 'comes back', 'happens again',
  ]),
  ar: Object.freeze([
    // سوف and the future verbs: "I will", "we will", "it will be done"
    'سوف', 'سيتم', 'ستتم', 'سأقوم', 'سنقوم', 'سيقوم', 'ستقوم', 'سأعود', 'سنعود', 'سيعود', 'سأوافي', 'سنوافي',
    'سأتواصل', 'سنتواصل', 'سيتواصل', 'سأتابع', 'سنتابع', 'سيتابع', 'سأرسل', 'سنرسل', 'سيرسل', 'سأخبر', 'سنخبر',
    'سأبقي', 'سنبقي', 'سأحدث', 'سنحدث', 'سأتصل', 'سنتصل', 'سيتصل', 'سيصل', 'ستصل', 'ستتلقى', 'سأتحقق', 'سنتحقق', 'سأراجع', 'سنراجع',
    'الخطوة التالية', 'الخطوات التالية',
    // when
    'غدًا', 'اليوم', 'الليلة', 'هذا المساء', 'صباح الغد', 'بعد الظهر', 'الأسبوع القادم', 'الأسبوع المقبل', 'قريبًا', 'بعد قليل',
    'نهاية اليوم', 'نهاية يوم العمل', 'بحلول', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
    // what the customer does next, or what to do if it comes back
    'أخبرني', 'أخبرنا', 'أعلمني', 'أبلغني', 'أبلغنا', 'أفدني', 'أفيدوني', 'تواصل معي', 'تواصل معنا', 'هل يمكنك',
    'إذا استمرت', 'إذا تكررت', 'في حال استمرار', 'في حال تكرار',
  ]),
});

// The Arabic future verbs above that may carry a pronoun at the end (the rest are matched as whole words).
const AR_VERB = /^س[انيت]/;

// "Please find attached" and "please note" ask the customer for nothing.
const NOT_A_REQUEST = { en: ['find', 'note', 'see', 'be', 'accept', 'excuse', 'ignore', 'disregard', 'refer'], ar: ['العلم', 'الاطلاع', 'ملاحظة', 'قبول', 'المعذرة'] };

/** Phrases that can sound like blame, impatience or talking down. Neutral look-alikes ("as you mentioned") are left out on purpose. */
export const TONE_PHRASES = Object.freeze({
  en: Object.freeze([
    'as I said', 'as I already said', 'as I told you', 'I already told you', 'as already mentioned', 'as previously mentioned',
    'as previously stated', 'per my last email', 'per my previous email', 'you should have', "you should've", 'obviously',
    'calm down', 'for the last time', 'not my problem', 'not our problem', 'your fault',
  ]),
  ar: Object.freeze([
    'كما ذكرت سابقًا', 'كما ذكرت لك', 'كما قلت لك', 'كما سبق وذكرت', 'كما أخبرتك', 'لقد أخبرتك', 'كان عليك', 'كان يجب عليك',
    'من الواضح', 'اهدأ', 'اهدئ', 'ليست مشكلتي', 'ليست مشكلتنا', 'هذا خطؤك', 'هذا خطأك', 'للمرة الأخيرة', 'حسب رسالتي السابقة',
  ]),
});

// ---- Advice (English texts marked with tm(); shown through tr(), in the language of the panel) ----------------------------------

const NEXT_STEP_ADVICE = tm('Say what happens next, or when you will write again.');
const BLAME_ADVICE = tm('This can sound like blame or impatience. Rephrase or leave out:');
const SHOUT_ADVICE = tm('A long run of capital letters reads as shouting. Write it in normal case:');
const EXCLAIM_ADVICE = tm('Three or more exclamation marks can read as shouting. One is enough.');

// ---- Folding: one text to match on, with the place of every character in the original ---------------------------------------------

const APOSTROPHE = /[‘’ʼ`´]/;

/**
 * The text in lower case, with apostrophes made plain, Arabic-Indic digits made 0-9 and Arabic folded (normalizeArabic), and for every
 * character of it the index of the character of `text` it came from (plus one entry for the end), so a match maps back to the original.
 * @returns {{ text: string, at: number[] }}
 */
export function foldForMatch(text) {
  const source = String(text ?? '');
  let out = '';
  const at = [];
  let i = 0;
  for (const ch of source) {
    const cp = ch.codePointAt(0);
    let f;
    if (cp >= 0x660 && cp <= 0x669) f = String(cp - 0x660);
    else if (cp >= 0x6f0 && cp <= 0x6f9) f = String(cp - 0x6f0);
    else if (APOSTROPHE.test(ch)) f = "'";
    else if (cp >= 0x600 && cp <= 0x6ff) f = normalizeArabic(ch);
    else f = ch.toLowerCase();
    out += f;
    for (let k = 0; k < f.length; k += 1) at.push(i);
    i += ch.length;
  }
  at.push(source.length);
  return { text: out, at };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const folded = (s) => foldForMatch(s).text.trim();
const ARABIC = /\p{Script=Arabic}/u;
const START = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';
// An Arabic phrase starts at the start of a word, or right after an "and" or "so" (و، ف) written onto it. That letter is not part of
// the match, so the hint names the phrase as the list has it.
const AR_START = '(?:(?<![\\p{L}\\p{N}])|(?<=(?<![\\p{L}\\p{N}])(?:و|ف)))';
const AR_PRONOUN = `(?:${['كما', 'كم', 'ك', 'هما', 'هم', 'ها', 'ه', 'نا', 'ي'].map(folded).join('|')})?`;

/** A list entry as a regular expression source over folded text: whole words, any space between them. */
function phraseSource(entry) {
  const words = folded(entry).split(/\s+/).map(escapeRegex).join('\\s+');
  if (!ARABIC.test(entry)) return `${START}${words}${END}`;
  return `${AR_START}${words}${AR_VERB.test(folded(entry)) ? AR_PRONOUN : ''}${END}`;
}

const alternatives = (list) => list.map(folded).map(escapeRegex).join('|');

// What the word lists cannot say: "I'll", a number of hours, a time of day, "please" with a request, a question.
const NEXT_STEP_PATTERNS = [
  "\\p{L}'ll(?!\\p{L})",
  `${START}(?:within|in|after)\\s+(?:the\\s+(?:next|coming)\\s+)?(?:\\d+|an?|one|two|three|four|five|a\\s+few|few|several)\\s*(?:-\\s*)?(?:business\\s+|working\\s+)?(?:minutes?|mins?|hours?|hrs?|h|days?|weeks?)${END}`,
  `${START}\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)(?!\\p{L})`,
  `${START}\\d{1,2}:\\d{2}${END}`,
  `${START}(?:by|before|until)\\s+\\d`,
  `${START}(?:please|kindly)\\s+(?!(?:${NOT_A_REQUEST.en.join('|')})${END})\\p{L}`,
  // Arabic: within / after a number of hours or days, at a time ("الساعة 3"), and "please" with a request
  `${AR_START}${folded('خلال')}\\s+(?:${folded('ال')})?(?:\\d|${alternatives(['ساع', 'يوم', 'أيام', 'دقيق', 'دقائق', 'أسبوع', 'شهر'])})`,
  `${AR_START}${folded('بعد')}\\s+(?:\\d|${alternatives(['ساع', 'يوم', 'دقيق', 'دقائق'])})`,
  `${AR_START}${folded('الساعة')}\\s+\\d`,
  `${AR_START}(?:${alternatives(['يرجى', 'الرجاء', 'أرجو', 'نرجو', 'رجاء'])})\\s+(?!(?:${alternatives(NOT_A_REQUEST.ar)})${END})\\p{L}`,
  '[?؟]',
];

const NEXT_STEP_RE = new RegExp([...NEXT_STEP_WORDS.en, ...NEXT_STEP_WORDS.ar].map(phraseSource).concat(NEXT_STEP_PATTERNS).join('|'), 'u');
const TONE_RE = new RegExp([...TONE_PHRASES.en, ...TONE_PHRASES.ar].map(phraseSource).join('|'), 'gu');

// ---- Is it English? ---------------------------------------------------------------------------------------------------------------

// Small words almost every English sentence has and French, Spanish or German ones rarely do. Two different ones make a text English
// enough to judge with the English list.
// ("a", "in", "on", "an", "so", "me" are left out: French, Spanish, German or Italian use them too.)
const ENGLISH_WORDS = new Set([
  'the', 'you', 'your', 'and', 'is', 'are', 'was', 'were', 'to', 'for', 'of', 'with', 'at', 'from', 'we', 'i', 'it', 'my', 'our',
  'this', 'that', 'have', 'has', 'been', 'did', 'be', 'can', 'will', 'not', 'please', 'thank', 'thanks', 'hello', 'hi', 'dear', 'regards',
]);

/** True when a text in Latin letters has at least two different common English words. */
export function looksEnglish(text) {
  const seen = new Set();
  for (const word of String(text ?? '').toLowerCase().match(/\p{L}+/gu) || []) {
    if (ENGLISH_WORDS.has(word)) seen.add(word);
    if (seen.size >= 2) return true;
  }
  return false;
}

/** Can the next-step lists judge this text? Arabic, English, or a mix of the two. */
function judgeable(text) {
  const script = scriptOf(text);
  if (script === 'arabic') return true;
  if (script === 'latin') return looksEnglish(text);
  if (script === 'mixed') return ARABIC.test(text) || looksEnglish(text);
  return false;
}

const wordCount = (text) => (String(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

// ---- The checks -------------------------------------------------------------------------------------------------------------------

/**
 * One NO_NEXT_STEP hint when a reply names no next step: nothing promised ("I will", "سأقوم"), no time ("tomorrow", "within 2 hours",
 * "غدا"), nothing asked of the customer ("please confirm", a question). A short note and a text the lists cannot judge get none.
 * The finding is about the whole text, so it sits at its end (listed after the others) and has no excerpt.
 */
export function nextStepFindings(text) {
  const plain = String(text ?? '');
  if (wordCount(plain) < NEXT_STEP_MIN_WORDS || !judgeable(plain)) return [];
  if (NEXT_STEP_RE.test(foldForMatch(plain).text)) return [];
  return [{ kind: 'NO_NEXT_STEP', severity: 'low', start: plain.length, end: plain.length, excerpt: '', advice: tr(NEXT_STEP_ADVICE) }];
}

// A word in capitals only. Runs of them are joined by spaces; punctuation ends a run ("VPN, SAP, CRM" is a list, not shouting).
const CAPS_WORD = /(?<![\p{L}\p{N}])\p{Lu}+(?:['’-]\p{Lu}+)*(?![\p{L}\p{N}])/gu;
const QUOTE_BEFORE = /["'“‘«]\s*$/;

/** The first run of capitals long enough to read as shouting, outside quotes ("FILE NOT FOUND" quoted from an error is fine). */
function shoutingRun(plain) {
  const words = [];
  CAPS_WORD.lastIndex = 0;
  let m;
  while ((m = CAPS_WORD.exec(plain)) !== null) words.push({ start: m.index, end: m.index + m[0].length, letters: (m[0].match(/\p{Lu}/gu) || []).length, first: m[0] });
  let i = 0;
  while (i < words.length) {
    let j = i;
    while (j + 1 < words.length && /^[ \t]+$/.test(plain.slice(words[j].end, words[j + 1].start))) j += 1;
    const run = words.slice(i, j + 1);
    const letters = run.reduce((n, w) => n + w.letters, 0);
    const longest = Math.max(...run.map((w) => w.letters));
    const quoted = QUOTE_BEFORE.test(plain.slice(Math.max(0, run[0].start - 3), run[0].start));
    if (run.length >= SHOUT_MIN_WORDS && letters >= SHOUT_MIN_LETTERS && longest >= SHOUT_LONGEST_WORD && !quoted) {
      return { start: run[0].start, end: run[run.length - 1].end, first: run[0].first.slice(0, 16) };
    }
    i = j + 1;
  }
  return null;
}

/**
 * One TONE hint: the first phrase that sounds like blame (its excerpt is the phrase as written), else a long run of capitals (its
 * excerpt is the run's first word), else three or more exclamation marks. One line, so the most telling one only.
 */
export function toneFindings(text) {
  const plain = String(text ?? '');
  if (!plain.trim()) return [];
  const fold = foldForMatch(plain);
  TONE_RE.lastIndex = 0;
  const phrase = TONE_RE.exec(fold.text);
  if (phrase) {
    const start = fold.at[phrase.index];
    const end = fold.at[phrase.index + phrase[0].length];
    return [{ kind: 'TONE', severity: 'low', start, end, excerpt: plain.slice(start, end).replace(/\s+/g, ' '), advice: tr(BLAME_ADVICE) }];
  }
  const run = shoutingRun(plain);
  if (run) return [{ kind: 'TONE', severity: 'low', start: run.start, end: run.end, excerpt: `${run.first} ...`, advice: tr(SHOUT_ADVICE) }];
  const marks = [...plain.matchAll(/[!！]/g)];
  if (marks.length >= EXCLAMATIONS) {
    return [{ kind: 'TONE', severity: 'low', start: marks[0].index, end: marks[marks.length - 1].index + 1, excerpt: '', advice: tr(EXCLAIM_ADVICE) }];
  }
  return [];
}

