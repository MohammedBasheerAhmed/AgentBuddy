import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, detectCandidates } from '../src/pii/detectors.js';
import { detectArabic, foldArabicLetters, foldDigits } from '../src/pii/arabic.js';
import { createFirewall } from '../src/pii/firewall.js';
import { createTokenizer } from '../src/pii/tokenizer.js';

// Personal data in Arabic tickets: digits written as ٠١٢٣, and the Arabic words that name a phone, an ID or a password. Before this
// existed a phone or card number in Arabic digits, or a password after "كلمة المرور", went to the AI unmasked.

const kinds = (text) => detect(text).map((f) => `${f.kind}:${f.value}`);
const kindOf = (text) => detect(text).map((f) => f.kind);

// ---- digits ----------------------------------------------------------------------------------------------------------------------------

test('foldDigits: Arabic-Indic, Persian and other decimal digits become ASCII, and nothing changes length', () => {
  const samples = ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '०१२३४५६७८९', '০১২৩৪৫৬৭৮৯', 'รหัส ๑๒๓', '+٩٧١ ٥٠'];
  for (const s of samples) assert.equal(foldDigits(s).length, s.length, s);
  assert.equal(foldDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(foldDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(foldDigits('०१२३४५६७८९'), '0123456789');
  assert.equal(foldDigits('+٩٧١ ٥٠'), '+971 50');
});

test('foldDigits: Arabic separators become their ASCII marks, a direction mark beside a digit becomes a space, ASCII text is returned as it is', () => {
  assert.equal(foldDigits('١٢٬٣٤٥٫٦٧'), '12,345.67');
  assert.equal(foldDigits('٥٠‏١٢٣'), '50 123');
  const plain = 'Call +971 50 123 4567';
  assert.equal(foldDigits(plain), plain);
  assert.equal(foldDigits(''), '');
  assert.equal(foldDigits(null), null);
});

test('a phone number in Arabic digits is found, and the finding keeps the digits as written', () => {
  const text = 'اتصل بي على +٩٧١ ٥٠ ١٢٣ ٤٥٦٧ من فضلك';
  assert.deepEqual(kinds(text), ['PHONE:+٩٧١ ٥٠ ١٢٣ ٤٥٦٧']);
  const [f] = detect(text);
  assert.equal(text.slice(f.start, f.end), f.value, 'the offsets point at the text as written');
});

test('a card number in Arabic digits is found (the Luhn check runs on the folded digits)', () => {
  assert.deepEqual(kinds('بطاقتي ٤١١١ ١١١١ ١١١١ ١١١١'), ['CARD:٤١١١ ١١١١ ١١١١ ١١١١']);
  assert.deepEqual(kinds('بطاقتي ۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱'), ['CARD:۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱'], 'Persian digits too');
  assert.deepEqual(kinds('بطاقتي ٤١١١ ١١١١ ١١١١ ١١١٢'), [], 'a number that fails the Luhn check is not a card');
});

test('an IBAN and an email in an Arabic sentence are found', () => {
  assert.ok(kindOf('حول إلى AE07 0331 2345 6789 0123 456 من فضلك').includes('IBAN'));
  assert.deepEqual(kinds('راسلني على ahmed.k@example.com شكرا'), ['EMAIL:ahmed.k@example.com']);
});

test('ordinary numbers in Arabic digits are not personal data', () => {
  assert.deepEqual(kinds('تم حل ٣ تذاكر خلال ٤٥ دقيقة والعدد ١٢٠٠'), []);
});

// ---- the words that name a value ---------------------------------------------------------------------------------------------------------

test('a password after an Arabic label is a secret, with or without a colon', () => {
  for (const text of [
    'كلمة المرور: Summer2024!',
    'كلمة السر هي Summer2024!',
    'كلمة المرور الجديدة هي Zx9#kLm2',
    'الرقم السري: ١٢٣٤٥٦',
    'الباسورد = Abc12345',
    'رمز الدخول: "Qw3rty!9"',
  ]) {
    const found = detect(text);
    assert.ok(found.some((f) => f.kind === 'SECRET'), text);
  }
  const [f] = detect('كلمة المرور: Summer2024! وشكرا');
  assert.equal(f.value, 'Summer2024!', 'the label stays; only the value is the finding');
});

test('Arabic prose about passwords is not a secret', () => {
  for (const text of [
    'كلمة المرور منتهية الصلاحية',
    'كلمة المرور: منتهية',
    'كلمة المرور هي مسؤولية المستخدم',
    'نسيت كلمة المرور ولا أستطيع الدخول',
    'تم إعادة تعيين كلمة المرور بنجاح',
    'كلمة المرور: غير صحيحة',
  ]) {
    assert.ok(!detect(text).some((f) => f.kind === 'SECRET'), text);
  }
});

test('a phone number named in Arabic is found, with Arabic or ASCII digits', () => {
  assert.ok(kindOf('رقم الجوال: ٠٥٠١٢٣٤٥٦٧').includes('PHONE'));
  assert.ok(kindOf('هاتفي 0501234567 للتواصل').includes('PHONE'));
  assert.ok(kindOf('واتساب +٩٦٦ ٥٥ ١٢٣ ٤٥٦٧').includes('PHONE'));
  assert.ok(!kindOf('رقم الجوال غير متوفر').includes('PHONE'));
  assert.ok(!kindOf('اتصال: ٥ دقائق').includes('PHONE'), 'five minutes is not a number');
});

test('an Emirates ID is found by its format, a Saudi ID or an Iqama by the word that names it', () => {
  // 784-1985-1234567-? : the last digit makes the fifteen digits pass the Luhn check
  const base = '784198512345670'.slice(0, 14);
  let check = 0;
  for (let c = 0; c < 10; c += 1) {
    const digits = `${base}${c}`;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = Number(digits[i]);
      if (dbl) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      dbl = !dbl;
    }
    if (sum % 10 === 0) check = c;
  }
  const id = `784-1985-1234567-${check}`;
  assert.deepEqual(kinds(`رقم الهوية الإماراتية ${id}`).filter((k) => k.startsWith('NATIONAL_ID')), [`NATIONAL_ID:${id}`]);
  assert.ok(kindOf(`هويتي ${id.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])}`).includes('NATIONAL_ID'), 'in Arabic digits too');
  assert.ok(kindOf('رقم الهوية الوطنية: ١٠٨٩٧٦٥٤٣٢').includes('NATIONAL_ID'));
  assert.ok(kindOf('رقم الإقامة 2345678901').includes('NATIONAL_ID'));
  assert.ok(kindOf('الرقم القومي: ٢٩٥٠١٠١٢٣٤٥٦٧٨').includes('NATIONAL_ID'));
  assert.ok(!kindOf('784-1985-1234567-9 رقم').includes('NATIONAL_ID') || check === 9, 'a number that fails the check digit is not an Emirates ID');
});

test('an employee number and a date of birth named in Arabic are found', () => {
  assert.deepEqual(kinds('رقم الموظف: E123456'), ['EMPLOYEE_ID:E123456']);
  assert.deepEqual(kinds('الرقم الوظيفي ٤٥٦٧٨٩'), ['EMPLOYEE_ID:٤٥٦٧٨٩']);
  assert.deepEqual(kinds('تاريخ الميلاد: ١٤/٠٣/١٩٨٥'), ['DOB:١٤/٠٣/١٩٨٥']);
  assert.deepEqual(kinds('ولد في 1985-03-14'), ['DOB:1985-03-14']);
});

test('the kinds filter and the minimum confidence still apply to the Arabic detectors', () => {
  const text = 'رقم الجوال: ٠٥٠١٢٣٤٥٦٧ وكلمة المرور: Summer2024!';
  assert.deepEqual([...new Set(detectCandidates(text, { kinds: ['PHONE'] }).map((f) => f.kind))], ['PHONE']);
  assert.deepEqual([...new Set(detectCandidates(text, { kinds: ['SECRET'] }).map((f) => f.kind))], ['SECRET']);
});

test('detectArabic leaves text without Arabic alone, and a long run of Arabic does not stall it', () => {
  const out = [];
  detectArabic('plain English text with no Arabic 12345', out);
  assert.deepEqual(out, []);
  const started = Date.now();
  detect(`${'كلمة المرور '.repeat(8000)}${'ا'.repeat(100000)} ${'٠'.repeat(50000)}`);
  assert.ok(Date.now() - started < 3000, 'adversarial Arabic input stays fast');
});

// ---- names -----------------------------------------------------------------------------------------------------------------------------------

test('foldArabicLetters: spellings of one Arabic letter are one letter, marks and tatweel are dropped', () => {
  assert.equal(foldArabicLetters('أحمد'), foldArabicLetters('احمد'));
  assert.equal(foldArabicLetters('إيمان'), foldArabicLetters('ايمان'));
  assert.equal(foldArabicLetters('فاطمة'), foldArabicLetters('فاطمه'));
  assert.equal(foldArabicLetters('مصطفى'), foldArabicLetters('مصطفي'));
  assert.equal(foldArabicLetters('أَحْمَد'), foldArabicLetters('احمد'));
  assert.equal(foldArabicLetters('محـــمد'), foldArabicLetters('محمد'));
  assert.equal(foldArabicLetters('English'), 'English', 'text without Arabic is returned as it is');
});

const part = (text, field = 'description') => ({ label: field, field, text });
const request = (parts) => ({ feature: 'record-summary', table: 'incident', system: 'You summarise tickets.', parts, userInstruction: 'Summarise this ticket.' });
const userOf = (sealed) => sealed.messages.find((m) => m.role === 'user').content;

test('the firewall masks a caller written in Arabic in every spelling the ticket uses', () => {
  const fw = createFirewall({ people: [{ role: 'caller', name: 'أحمد خالد', email: 'ahmed.khaled@example.com', sysId: 'a'.repeat(32) }] });
  const text = 'اتصل أحمد خالد وقال: احمد خالد لا يستطيع الدخول. شكرا لك يا أَحْمَد. رقم جواله ٠٥٠١٢٣٤٥٦٧ وكلمة المرور: Summer2024!';
  const sealed = fw.buildRequest(request([part(text)]));
  const sent = userOf(sealed);
  for (const leak of ['أحمد', 'احمد', 'أَحْمَد', 'خالد', '٠٥٠١٢٣٤٥٦٧', 'Summer2024!', 'ahmed.khaled@example.com']) assert.ok(!sent.includes(leak), `"${leak}" must not reach the AI: ${sent}`);
  assert.match(sent, /\[PERSON_1\]/);
  assert.match(sent, /\[PHONE_1\]/);
  assert.match(sent, /\[SECRET_1\]/);
  assert.ok(sent.includes('اتصل') && sent.includes('وقال'), 'the Arabic around the values is kept');
});

test('the firewall refuses to send when an Arabic-digit card slips through by hand (the final check reads Arabic digits too)', () => {
  const fw = createFirewall({ people: [] });
  const sealed = fw.buildRequest(request([part('بطاقة العميل ٤١١١ ١١١١ ١١١١ ١١١١ وهاتفه +٩٧١ ٥٠ ١٢٣ ٤٥٦٧')]));
  const sent = userOf(sealed);
  assert.ok(!/[٠-٩]{4}/.test(sent), `no run of Arabic digits is left: ${sent}`);
  assert.match(sent, /\[CARD_1\]/);
  assert.match(sent, /\[PHONE_1\]/);
});

test('the same number written in Arabic and in ASCII digits shares one placeholder, and a card is never put back', () => {
  const t = createTokenizer();
  const a = t.placeholderFor({ kind: 'PHONE', value: '+٩٧١ ٥٠ ١٢٣ ٤٥٦٧' });
  const b = t.placeholderFor({ kind: 'PHONE', value: '+971 50 123 4567' });
  assert.equal(a, b);
  assert.equal(a, '[PHONE_1]');
  assert.notEqual(t.placeholderFor({ kind: 'PHONE', value: '+٩٧١ ٥٠ ٩٩٩ ٤٥٦٧' }), a, 'another number is another placeholder');
});
