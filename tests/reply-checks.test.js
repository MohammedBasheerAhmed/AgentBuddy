import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLAMATIONS,
  NEXT_STEP_MIN_WORDS,
  TONE_PHRASES,
  foldForMatch,
  isReplyField,
  looksEnglish,
  nextStepFindings,
  toneFindings,
} from '../src/safeSend/replyChecks.js';
import { checkTypedText, reviewForCustomer, reviewForInsert } from '../src/safeSend/review.js';
import { performInsert } from '../src/sidepanel/insertFlow.js';
import { setLanguage } from '../src/i18n/index.js';

// Round 4 (docs/round4.md), the Reply row: two no-AI checks before a reply is sent, in English and Arabic. "No next step" (a reply
// that says nothing about what happens next or when) and "Tone" (blame, shouting, a pile of exclamation marks). Both are hints: never a
// stop, one line each.

const hasNextStep = (text) => nextStepFindings(text).length === 0;
const flagged = (text) => nextStepFindings(text).length === 1;

// ---- No next step: English ------------------------------------------------------------------------------------------------------

// Each signal is added to a sentence long enough to judge that says nothing about what happens next on its own.
const EN = 'Hello Abel, the network team looked at the VPN gateway';
const AR = 'مرحبا، راجعنا سجلات الخادم كاملة مع فريق الشبكات';

test('English: a promise, a time, a request or a question is a next step', () => {
  assert.ok(flagged(`${EN}.`), 'the sentence alone is flagged');
  for (const signal of [
    ' and I will write to you.',
    " and I'll write to you.",
    ' and I’ll write to you.',
    " and we'll update you by 3pm.",
    ' and is going to replace the switch.',
    ', expect news tomorrow.',
    ', news within 2 hours.',
    ', news in a few hours.',
    ', it should work at 10:30.',
    '. Please confirm it works for you now.',
    '. Let me know if it works for you.',
    '. Did that fix it for you?',
    '. If it comes back, reply to this ticket.',
    ' and the change is final on Monday.',
  ]) {
    assert.ok(hasNextStep(`${EN}${signal}`), signal);
  }
  assert.ok(hasNextStep('HELLO ABEL, THE NETWORK TEAM LOOKED AT THE GATEWAY AND WE WILL CHECK AGAIN.'), 'capitals do not matter');
});

test('English: a reply that only reports, or "please find attached", says nothing about what happens next', () => {
  for (const text of [
    'Hello Abel, your password has been reset by the service desk.',
    'Thanks for the details. The logs were checked and the gateway was restarted.',
    'Hello Abel, please find attached the report from the network team.',
    'Hello Abel, please note that the gateway was restarted last week. Thanks.',
  ]) {
    const found = nextStepFindings(text);
    assert.equal(found.length, 1, text);
    assert.deepEqual(found[0], { kind: 'NO_NEXT_STEP', severity: 'low', start: text.length, end: text.length, excerpt: '', advice: 'Say what happens next, or when you will write again.' });
  }
});

test('words that only look like a next step do not count: "willing" and "pleased"', () => {
  assert.ok(flagged('Hello Abel, the team was willing to help with the gateway.'));
  assert.ok(flagged('Hello Abel, the pleased engineer replaced the switch near the gateway.'));
});

// ---- No next step: Arabic -------------------------------------------------------------------------------------------------------

test('Arabic: future verbs, times and requests are a next step, written with or without hamza, tashkeel and "and" in front', () => {
  assert.ok(flagged(`${AR}.`), 'the sentence alone is flagged');
  for (const signal of [
    ' وسأقوم بإعادة تشغيله.',
    ' وسنقوم بإعادة تشغيله.',
    ' وسوف نعيد تشغيله.',
    ' وسأعود إليك بالنتيجة.',
    ' وسأوافيك بالنتيجة.',
    ' وسأوافيكم بالنتيجة.',
    ' وساوافيك بالنتيجة.', // written without the hamza
    ' وتصلك النتيجة غداً.',
    ' وتصلك النتيجة غدا.',
    ' والنتيجة اليوم.',
    ' والنتيجة خلال ساعتين.',
    ' والنتيجة خلال ٢٤ ساعة.',
    ' والنتيجة بحلول نهاية الأسبوع.',
    '. يرجى التأكيد أن الخدمة تعمل.',
    '. هل تعمل الخدمة الآن؟',
    '. إذا تكررت المشكلة أخبرنا من فضلك.',
  ]) {
    assert.ok(hasNextStep(`${AR}${signal}`), signal);
  }
});

test('Arabic: a reply that only reports, "through" (من خلال) and "please note" are not a next step', () => {
  for (const text of [
    'مرحبا، تم إعادة تعيين كلمة المرور الخاصة بك من قبل فريق الدعم.',
    'مرحبا، تمت مراجعة السجلات من قبل فريق الشبكات من خلال النظام الجديد.',
    'مرحبا، يرجى العلم بأن الخادم أعيد تشغيله من قبل فريق الشبكات.',
    'مرحبا، تمت مراجعة السجلات من قبل فريق الشبكات سابقا وكانت سليمة.',
  ]) {
    assert.ok(flagged(text), text);
  }
});

// ---- What is not judged ---------------------------------------------------------------------------------------------------------

test('a short note, another language in Latin letters, another script and an empty text are not judged', () => {
  assert.equal(NEXT_STEP_MIN_WORDS, 7);
  assert.ok(hasNextStep('Hello Abel, the VPN works again.'), 'six words: a quick note');
  assert.ok(hasNextStep('Thanks, received.'));
  assert.ok(hasNextStep('Bonjour, nous avons vérifié les journaux de votre poste de travail hier.'), 'French is not judged with the English list');
  assert.ok(hasNextStep('Guten Tag, wir haben die Protokolle Ihres Arbeitsplatzes gestern geprüft.'));
  assert.ok(hasNextStep('Здравствуйте, мы проверили журналы вашего рабочего места вчера вечером.'));
  for (const empty of ['', '   ', null, undefined, 42]) assert.deepEqual(nextStepFindings(empty), []);
  assert.equal(looksEnglish('the VPN'), false, 'one common word is not enough');
  assert.equal(looksEnglish('Thanks, the VPN is back'), true);
});

// ---- Tone -----------------------------------------------------------------------------------------------------------------------

const toneOf = (text) => {
  const found = toneFindings(text);
  assert.ok(found.length <= 1, 'one line at most');
  return found[0] || null;
};

test('every listed blame phrase is found, named as written, in any case and with a curly apostrophe', () => {
  for (const phrase of TONE_PHRASES.en) {
    const text = `Hello Abel, ${phrase.toUpperCase() === phrase ? phrase : phrase.replace(/^./, (c) => c.toUpperCase())} the VPN profile must be replaced.`;
    const found = toneOf(text);
    assert.ok(found, phrase);
    assert.equal(found.kind, 'TONE');
    assert.equal(found.severity, 'low');
    assert.equal(found.excerpt.toLowerCase(), phrase.toLowerCase());
    assert.equal(text.slice(found.start, found.end), found.excerpt);
    assert.equal(found.advice, 'This can sound like blame or impatience. Rephrase or leave out:');
  }
  assert.equal(toneOf('Per my LAST email, the profile was replaced.').excerpt, 'Per my LAST email');
  assert.equal(toneOf('You should’ve restarted the laptop first.').excerpt, 'You should’ve');
  assert.equal(toneOf('As I  said,\nthe profile was replaced.').excerpt, 'As I said', 'spaces inside are squeezed in the excerpt');
});

test('Arabic blame phrases are found with or without tashkeel and hamza; an "and" in front is not part of the name', () => {
  for (const phrase of TONE_PHRASES.ar) assert.ok(toneOf(`مرحبا، ${phrase} يجب إعادة تشغيل الجهاز.`), phrase);
  assert.equal(toneOf('وكما ذكرت سابقاً، يجب إعادة تشغيل الجهاز.').excerpt, 'كما ذكرت سابقاً');
  assert.equal(toneOf('كما ذكرت سابقا، يجب إعادة تشغيل الجهاز.').excerpt, 'كما ذكرت سابقا');
  assert.equal(toneOf('فاهدأ قليلا من فضلك.').excerpt, 'اهدأ');
  assert.equal(toneOf('كان عليك إعادة تشغيل الجهاز أولا.').excerpt, 'كان عليك');
  assert.equal(toneOf('من الواضح أن الجهاز لم يُعد تشغيله.').excerpt, 'من الواضح');
});

test('neutral look-alikes are not blame: "as you mentioned", "obviousness", goals (أهداف), "as you said" (كما ذكرت)', () => {
  for (const text of [
    'As you mentioned, the VPN drops every ten minutes.',
    'Hello Abel, the clearly written steps are below.',
    'أهداف الفريق واضحة لهذا الأسبوع.',
    'كما ذكرت، الشبكة بطيئة في المكتب.',
    'شكرا لك على صبرك.',
  ]) {
    assert.equal(toneOf(text), null, text);
  }
});

test('shouting: a long run of capitals; product names, acronyms, lists and quoted errors are not shouting', () => {
  const shout = toneOf('Hello Abel, PLEASE DO NOT RESTART the server again.');
  assert.equal(shout.kind, 'TONE');
  assert.equal(shout.excerpt, 'PLEASE ...');
  assert.equal(shout.advice, 'A long run of capital letters reads as shouting. Write it in normal case:');
  assert.ok(toneOf('YOUR LAPTOP WILL BE READY TOMORROW'));
  for (const text of [
    'Restart SAP GUI and the VPN client, then open CRM.',
    'The VPN SAP CRM ERP accounts are fine.',
    'HTTP SSL TLS VPN DNS all answer.',
    'Check ITSM, CMDB, SLA, SCCM, MSSQL and HTTPS settings.',
    'The error was "FILE NOT FOUND ANYWHERE" on the share.',
    'I AM on it.',
    'Your ticket INC0012345 for SAP was updated.',
  ]) {
    assert.equal(toneOf(text), null, text);
  }
});

test('exclamation marks: three or more in one text, in a row or apart; two are fine', () => {
  assert.equal(EXCLAMATIONS, 3);
  const many = toneOf('Thanks! Great! Done!');
  assert.equal(many.advice, 'Three or more exclamation marks can read as shouting. One is enough.');
  assert.equal(many.excerpt, '');
  assert.ok(toneOf('It works now!!!'));
  assert.ok(toneOf('شكرا!!! تم الحل'));
  assert.equal(toneOf('Thanks! It works now!'), null);
});

test('one tone line at most, the most telling first: a blame phrase, then shouting, then exclamation marks', () => {
  assert.equal(toneOf('PLEASE DO NOT RESTART IT. As I said!!!').advice, 'This can sound like blame or impatience. Rephrase or leave out:');
  assert.equal(toneOf('PLEASE DO NOT RESTART IT!!!').advice, 'A long run of capital letters reads as shouting. Write it in normal case:');
});

test('folding keeps the place of every character, so an excerpt is the original text', () => {
  const { text, at } = foldForMatch('غدًا ٢٤ It’LL');
  assert.equal(text, "غدا 24 it'll");
  assert.equal(at.length, text.length + 1);
  assert.equal(at[at.length - 1], 'غدًا ٢٤ It’LL'.length);
});

// ---- In the review: the shape other code reads stays the same ----------------------------------------------------------------------

const KEYS = ['advice', 'end', 'excerpt', 'kind', 'severity', 'start'];
const NO_STEP_BLAME = 'As I said, your password has been reset by the service desk.';

test('the review: the same { serious, hints } shape, the new findings are hints with the same keys, never serious', () => {
  const review = reviewForInsert('comments', NO_STEP_BLAME, { people: [] });
  assert.deepEqual(Object.keys(review).sort(), ['hints', 'serious']);
  assert.deepEqual(review.serious, []);
  assert.deepEqual(review.hints.map((f) => f.kind), ['TONE', 'NO_NEXT_STEP'], 'in place order: the whole-text hint last');
  for (const f of review.hints) assert.deepEqual(Object.keys(f).sort(), KEYS);
  // a serious finding still blocks, and the hints come with it
  const both = reviewForInsert('comments', `${NO_STEP_BLAME} Your password: Winter2026!x`, { people: [] });
  assert.ok(both.serious.some((f) => f.kind === 'SECRET'));
  assert.ok(both.hints.some((f) => f.kind === 'TONE'));
  assert.ok(!both.serious.some((f) => f.kind === 'TONE' || f.kind === 'NO_NEXT_STEP'));
});

test('which fields: a reply (comment, email body) gets both; resolution notes, a description, an article the tone only; work notes neither', () => {
  assert.equal(isReplyField('comments'), true);
  assert.equal(isReplyField('body'), true);
  for (const field of ['close_notes', 'description', 'text', 'short_description', 'work_notes', 'subject']) assert.equal(isReplyField(field), false, field);
  const kinds = (field) => reviewForInsert(field, NO_STEP_BLAME, { people: [] }).hints.map((f) => f.kind);
  assert.deepEqual(kinds('comments'), ['TONE', 'NO_NEXT_STEP']);
  assert.deepEqual(kinds('body'), ['TONE', 'NO_NEXT_STEP']);
  for (const field of ['close_notes', 'description', 'text']) assert.deepEqual(kinds(field), ['TONE'], field);
  assert.deepEqual(kinds('work_notes'), []);
  // reviewForCustomer itself checks the next step only when told the text is a reply (Notes to ticket and others call it directly)
  assert.deepEqual(reviewForCustomer(NO_STEP_BLAME).hints.map((f) => f.kind), ['TONE']);
  assert.deepEqual(reviewForCustomer(NO_STEP_BLAME, { reply: true }).hints.map((f) => f.kind), ['TONE', 'NO_NEXT_STEP']);
});

test('Write > Check my comment shows them the same way: as hints, with "findings" and no serious one', () => {
  const comment = checkTypedText('comments', NO_STEP_BLAME);
  assert.equal(comment.status, 'findings');
  assert.deepEqual(comment.serious, []);
  assert.deepEqual(comment.hints.map((f) => f.kind), ['TONE', 'NO_NEXT_STEP']);
  assert.deepEqual(checkTypedText('close_notes', NO_STEP_BLAME).hints.map((f) => f.kind), ['TONE']);
  assert.deepEqual(checkTypedText('comments', 'Hello Abel, I will check the VPN logs and write to you tomorrow.'), { status: 'clean', serious: [], hints: [] });
});

test('the insert flow: the new hints never stop an insert, and come back with it', async () => {
  const page = { tabId: 5, href: `https://x.service-now.com/incident.do?sys_id=${'a'.repeat(32)}`, record: { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001' }, newRecord: null };
  const outcome = await performInsert({ page, spec: { field: 'comments' }, value: NO_STEP_BLAME, send: async () => ({ ok: true, method: 'gform' }) });
  assert.equal(outcome.status, 'inserted');
  assert.deepEqual(outcome.hints.map((f) => f.kind), ['TONE', 'NO_NEXT_STEP']);
});

test('the advice is in the language of the panel', () => {
  setLanguage('ar');
  try {
    const [tone, step] = reviewForInsert('comments', 'كما ذكرت سابقا، تم إعادة تعيين كلمة المرور من قبل فريق الدعم.', { people: [] }).hints;
    assert.equal(tone.excerpt, 'كما ذكرت سابقا');
    assert.match(tone.advice, /لوما/);
    assert.equal(step.advice, 'اذكر ما سيحدث بعد ذلك، أو متى ستكتب مرة أخرى.');
  } finally {
    setLanguage('en');
  }
});
