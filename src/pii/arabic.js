// Personal data written in Arabic: the digits, and the words that say what a number or a value is.
//
// The English detectors (detectors.js) read ASCII digits and English labels ("phone:", "password:"). A ticket in Arabic writes the
// same numbers with Arabic-Indic digits (٠١٢٣) and names them in Arabic ("رقم الجوال", "كلمة المرور"), so without this module a phone
// number, a card number or a password in an Arabic ticket would pass the firewall unmasked.
//
//  - foldDigits(text): the text as the detectors should read it. Every decimal digit of another script becomes its ASCII digit
//    and a few Arabic punctuation marks become their ASCII look-alikes, one character for one character, so every offset is the
//    same and a finding still points at the text as it was written. (The text that is sent keeps the digits as written; only what
//    the detectors read is folded.)
//  - detectArabic(text, out): findings for what the English detectors have no words for. `text` must already be folded.
//
// Pure functions, no I/O. Patterns are anchored on a label word or on a fixed format and use bounded repetition only.

// The first digit (zero) of each script's block of ten decimal digits.
const ZEROS = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810];
const OTHER_DIGIT = new RegExp(
  '[' + ZEROS.map((z) => `${String.fromCharCode(z)}-${String.fromCharCode(z + 9)}`).join('') + ']',
  'g'
);
// Arabic decimal and thousands separators and the Arabic comma, as the marks they stand for.
const ARABIC_MARKS = { '\u066b': '.', '\u066c': ',', '\u060c': ',', '\u061b': ';' };
// Left-to-right and right-to-left marks (and the Arabic letter mark) sit around numbers in right-to-left text; next to a digit they
// would split the number, so for the detectors they are a space.
const DIRECTION_MARK_BY_DIGIT = /(?<=\d)[\u200e\u200f\u061c]|[\u200e\u200f\u061c](?=\d)/g;

/** The text as the detectors read it: same length, ASCII digits. Returns `text` itself when there is nothing to fold. */
export function foldDigits(text) {
  if (typeof text !== 'string' || !text) return text;
  // eslint-disable-next-line no-control-regex -- the test is for characters outside ASCII
  if (!/[^\x00-\x7f]/.test(text)) return text;
  let out = text.replace(OTHER_DIGIT, (ch) => {
    const c = ch.charCodeAt(0);
    const zero = ZEROS.find((z) => c >= z && c <= z + 9);
    return String.fromCharCode(48 + c - zero);
  });
  out = out.replace(/[\u066b\u066c\u060c\u061b]/g, (ch) => ARABIC_MARKS[ch]);
  return out.replace(DIRECTION_MARK_BY_DIGIT, ' ');
}

// A label starts a word, or follows a one-letter prefix that Arabic writes onto the word: و "and", ف "so", ب "with", ل "for", ك "as"
// ("وكلمة المرور" is "and the password").
const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])(?:[وفبلك](?=[\\u0621-\\u064a]))?';
const NUMBER_AFTER = '(?![\\d])';

// ---- Passwords: "كلمة المرور: x", "كلمة السر هي x", "الرقم السري 1234" ---------------------------------------------------------
const PASSWORD_WORD =
  '(?:كلم[ةه]\\s*(?:ال)?(?:مرور|سر)ي?|(?:ال)?رقم\\s*(?:ال)?سري|(?:ال)?رمز\\s*(?:ال)?(?:مرور|دخول|سري)|(?:ال)?باسورد|(?:ال)?بسورد|(?:ال)?باسوورد)';
const PASSWORD_QUALIFIER = '(?:\\s*(?:الجديدة|الجديد|الحالية|الحالي|المؤقتة|المؤقت|الخاصة\\s*بي|لحسابي|للحساب))';
const PASSWORD = new RegExp(
  `${NOT_LETTER_BEFORE}${PASSWORD_WORD}${PASSWORD_QUALIFIER}{0,2}\\s*(?:(:=|[:=\\uff1a])|(هي|هو|وهي|وهو|إلى|الى))\\s*(?:["'«“]?)([^\\s"'«»”<>;]{3,200})`,
  'gud'
);
// A word that follows "كلمة المرور :" in prose and is not a password.
const NOT_A_PASSWORD = new Set([
  'منتهية', 'منتهيه', 'خاطئة', 'خاطئه', 'خطأ', 'غير', 'صحيحة', 'صحيحه', 'مطلوبة', 'مطلوبه', 'مخفية', 'مخفيه', 'مؤقتة', 'مؤقته',
  'جديدة', 'جديده', 'قديمة', 'قديمه', 'ضعيفة', 'ضعيفه', 'قوية', 'قويه', 'لا', 'نعم', 'تم', 'سيتم', 'يجب', 'لم', 'لن', 'ليست',
  'ليس', 'مرفقة', 'مرفقه', 'محفوظة', 'محفوظه', 'موجودة', 'موجوده', 'مفقودة', 'مفقوده', 'صالحة', 'صالحه', 'المنتهية',
]);
const hasLatinOrDigitOrSymbol = (v) => /[A-Za-z\d]/.test(v) || /[^\p{L}\p{M}\p{N}]/u.test(v);

function detectPasswords(text, out) {
  PASSWORD.lastIndex = 0;
  let m;
  while ((m = PASSWORD.exec(text)) !== null) {
    const value = m[3];
    const [start, end] = m.indices[3];
    const bare = value.replace(/[.,،؛!؟?)\]]+$/u, '');
    if (bare.length < 3 || NOT_A_PASSWORD.has(bare)) continue;
    // After an explicit ":" or "=" any value counts; after "هي" ("is") or "إلى" ("to") it has to look like a password, since
    // "كلمة المرور هي مسؤولية المستخدم" is prose.
    const explicit = Boolean(m[1]);
    if (!explicit && !hasLatinOrDigitOrSymbol(bare)) continue;
    // The whole value is masked, a closing "!" or "." included: it may be part of the password, and masking too much costs nothing.
    out.push({ kind: 'SECRET', start, end, value: text.slice(start, end), confidence: hasLatinOrDigitOrSymbol(bare) ? 0.92 : 0.86 });
  }
}

// ---- Phone numbers named in Arabic: "رقم الجوال: 0501234567", "واتساب +971 50 123 4567" -------------------------------------------------
const PHONE_WORD = '(?:(?:رقم\\s*)?(?:ال)?(?:(?:هاتف|تلفون|تليفون|جوال|موبايل|محمول)(?:ي|ه|ها|ك|نا|هم)?|واتساب|واتس\\s*اب|للتواصل|للاتصال|اتصال))';
const PHONE = new RegExp(`${NOT_LETTER_BEFORE}${PHONE_WORD}\\s*(?:هو|هي|على|:|=|-)?\\s*(\\+?\\(?\\d[\\d\\s().-]{5,18}\\d)${NUMBER_AFTER}`, 'gud');

function detectPhones(text, out) {
  PHONE.lastIndex = 0;
  let m;
  while ((m = PHONE.exec(text)) !== null) {
    const [start, end] = m.indices[1];
    const digits = text.slice(start, end).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    out.push({ kind: 'PHONE', start, end, value: text.slice(start, end), confidence: 0.86 });
  }
}

// ---- National and identity numbers ----------------------------------------------------------------------------------------------------
// Emirates ID: 784-YYYY-NNNNNNN-C, fifteen digits ending in a Luhn check digit. The format is distinctive enough to need no label.
const EMIRATES_ID = /(?<![\d-])784[- ]?\d{4}[- ]?\d{7}[- ]?\d(?![\d-])/g;
// Any other identity number is found by the word that names it: Saudi national ID and Iqama (ten digits), Egyptian national number
// (fourteen), the civil number of Kuwait (twelve), passports (a letter and digits).
const ID_WORD =
  '(?:(?:رقم\\s*)?(?:ال)?(?:هوية|هويه)(?:\\s*(?:ال)?(?:وطنية|وطنيه|إماراتية|الإماراتية))?|(?:ال)?رقم\\s*(?:ال)?قومي|(?:رقم\\s*)?(?:ال)?(?:إقامة|اقامة)|(?:ال)?سجل\\s*(?:ال)?مدني|(?:رقم\\s*)?(?:ال)?بطاقة\\s*(?:ال)?(?:شخصية|مدنية)|(?:رقم\\s*)?(?:ال)?جواز(?:\\s*(?:ال)?سفر)?|(?:ال)?رقم\\s*(?:ال)?مدني)';
const ID_NUMBER = new RegExp(`${NOT_LETTER_BEFORE}${ID_WORD}\\s*(?:هو|هي|:|=|-|#)?\\s*([A-Za-z]{0,2}\\d[\\d -]{6,20}\\d)${NUMBER_AFTER}`, 'gud');

function luhnOk(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function detectIds(text, out) {
  EMIRATES_ID.lastIndex = 0;
  let m;
  while ((m = EMIRATES_ID.exec(text)) !== null) {
    if (!luhnOk(m[0].replace(/\D/g, ''))) continue;
    out.push({ kind: 'NATIONAL_ID', start: m.index, end: m.index + m[0].length, value: m[0], confidence: 0.95 });
  }
  ID_NUMBER.lastIndex = 0;
  while ((m = ID_NUMBER.exec(text)) !== null) {
    const [start, end] = m.indices[1];
    const digits = text.slice(start, end).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 16) continue;
    out.push({ kind: 'NATIONAL_ID', start, end, value: text.slice(start, end), confidence: 0.9 });
  }
}

// ---- Employee numbers and dates of birth ---------------------------------------------------------------------------------------------
const EMPLOYEE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:(?:ال)?رقم\\s*(?:ال)?(?:موظف|وظيفي)|(?:ال)?رقم\\s*(?:ال)?شارة|رقم\\s*البطاقة\\s*الوظيفية)\\s*(?:هو|هي|:|=|-|#)?\\s*([A-Za-z]{0,4}-?\\d[A-Za-z0-9-]{2,15})${NUMBER_AFTER}`,
  'gud'
);
const DATE = '\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{1,4}';
const BIRTH = new RegExp(
  `${NOT_LETTER_BEFORE}(?:تاريخ\\s*(?:ال)?ميلاد(?:ي)?|(?:ال)?مواليد|مولود(?:ة)?\\s*(?:في|بتاريخ)|ولد(?:ت)?\\s*(?:في|بتاريخ))\\s*(?:هو|هي|:|=|-)?\\s*(${DATE})(?![\\d])`,
  'gud'
);

function detectEmployeeAndBirth(text, out) {
  for (const [re, kind, confidence] of [[EMPLOYEE, 'EMPLOYEE_ID', 0.86], [BIRTH, 'DOB', 0.9]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [start, end] = m.indices[1];
      out.push({ kind, start, end, value: text.slice(start, end), confidence });
    }
  }
}

/** Add what Arabic labels and formats reveal. `text` is the folded text (see foldDigits). */
export function detectArabic(text, out) {
  if (typeof text !== 'string' || !/[\u0600-\u06ff]|784/.test(text)) return;
  detectPasswords(text, out);
  detectPhones(text, out);
  detectIds(text, out);
  detectEmployeeAndBirth(text, out);
}

/**
 * How the dictionary compares Arabic-script words: letters that are written in more than one way are one letter (alef with or
 * without hamza, alef maqsura and ya, ta marbuta and ha, Persian kaf and ya), and the marks above and below letters and the
 * tatweel stretch are dropped. "أحمد", "احمد" and "أَحْمَد" are one name.
 */
export function foldArabicLetters(s) {
  if (!/[\u0600-\u06ff]/.test(s)) return s;
  return s
    .replace(/[\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u06a9/g, '\u0643');
}
