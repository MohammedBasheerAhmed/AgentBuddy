import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t } from '../src/i18n/index.js';
import { noteText } from '../src/sidepanel/mywork/accessNotes.js';
import { followUpReason, followUpText } from '../src/mywork/followups.js';
import { spanText, readText, slaText } from '../src/mywork/time.js';
import { recommendEmails, statusLines } from '../src/compose/emailRecommend.js';
import { checkArticle } from '../src/knowledge/articleChecks.js';
import { addSnippet } from '../src/snippets/store.js';
import { describeMissing } from '../src/snippets/preview.js';
import { EMAIL_TYPES } from '../src/compose/emailRecommend.js';
import { LANGUAGES, languageName } from '../src/compose/rewrite.js';

// The Write, Knowledge and My work parts in Arabic: the sentences the pure modules build are found in the catalogue, a count follows
// the plural rules of Arabic, and what is sent to the AI does not change with the language of the panel.

test.afterEach(() => setLanguage('en'));

const HOUR = 3600000;
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

test('the My work access notes: English as written, Arabic found by pattern (also the long ones with a fixed tail)', () => {
  const notes = [
    '1 HR case is not listed: turn on the HR profile in Settings to see them.',
    '3 incidents are not listed: your organisation keeps this content out of Agent Buddy.',
    'Problems are not listed: turn on the HR profile in Settings to see them.',
  ];
  for (const note of notes) assert.equal(noteText(note), note, 'English stays as it is');
  setLanguage('ar');
  const ar = notes.map(noteText);
  assert.match(ar[0], /^لم يتم إدراج حالة موارد بشرية \(1\)/);
  assert.match(ar[1], /Agent Buddy/);
  assert.match(ar[1], /^لم يتم إدراج 3 من الحوادث/);
  for (const line of ar) assert.doesNotMatch(line, /not listed|turn on|your organisation/);
});

test('days and hours follow the plural rules of Arabic; the short units are Arabic too', () => {
  const entry = (days) => ({ kind: 'replied', days });
  assert.equal(followUpReason(entry(3)), 'Customer replied 3 d ago');
  setLanguage('ar');
  assert.equal(followUpReason(entry(2)), 'رد العميل منذ 2 يومين');
  assert.equal(followUpReason(entry(3)), 'رد العميل منذ 3 أيام');
  assert.equal(followUpReason(entry(11)), 'رد العميل منذ 11 يوما');
  assert.equal(spanText(130 * 60000), '2 س 10 د');
  assert.equal(readText(1000, 1000 + 5 * 60000), 'تمت القراءة منذ 5 د');
  assert.equal(slaText({ dueAt: 3 * HOUR }, 0), 'SLA مستحقة بعد 3 س');
  setLanguage('en');
  assert.equal(spanText(130 * 60000), '2h 10m');
  assert.equal(slaText({ dueAt: 3 * HOUR }, 0), 'SLA due in 3h');
});

test('the text a follow-up copies for the customer is written in the panel language', () => {
  const entry = { kind: 'reminder', item: { number: 'INC0010001', title: 'VPN down' }, days: 3 };
  assert.match(followUpText(entry), /^Hello,/);
  setLanguage('ar');
  assert.match(followUpText(entry), /^مرحبا،/);
  assert.match(followUpText(entry), /INC0010001 \(VPN down\)/);
});

test('which email fits: the reasons are in the panel language, the status lines for the AI are always English', () => {
  const now = Date.now();
  const pack = {
    kind: 'incident',
    fields: { state: 'Resolved', resolved_at: stamp(now - 5 * 24 * HOUR) },
    people: [{ role: 'caller', name: 'Abel Tuter' }],
    journal: [],
    related: {},
    access: [{ source: 'journal', status: 'ok' }],
  };
  const english = statusLines(pack, now);
  const picks = recommendEmails(pack, { now }).picks.map((p) => p.why);
  setLanguage('ar');
  assert.deepEqual(statusLines(pack, now), english, 'what is sent to the AI does not follow the language of the panel');
  const arabic = recommendEmails(pack, { now }).picks.map((p) => p.why);
  assert.equal(arabic.length, picks.length);
  for (const line of arabic) assert.doesNotMatch(line, /[A-Za-z]{4,}/);
  // the label of each kind of email stays an English key; the panel shows t(label)
  assert.ok(EMAIL_TYPES.every((type) => /^[A-Z]/.test(type.label)));
});

test('article checks and snippet problems are written in the panel language', () => {
  const now = Date.now();
  const article = { title: '', text: '', meta: '', updatedMs: now };
  assert.equal(checkArticle(article, { now }).findings[0].title, 'No title');
  assert.equal(addSnippet([], { title: '', body: 'x' }).error, 'A title is needed.');
  setLanguage('ar');
  assert.equal(checkArticle(article, { now }).findings[0].title, 'بلا عنوان');
  assert.equal(addSnippet([], { title: '', body: 'x' }).error, 'العنوان مطلوب.');
  assert.match(describeMissing(['caller.first_name'])[0].hint, /^لا يوجد متصل/);
});

test('the languages of the Rewrite picker: the English name goes into the instruction, the picker shows the Arabic name', () => {
  setLanguage('ar');
  assert.equal(languageName('es'), 'Spanish', 'the instruction names the language in English');
  assert.ok(LANGUAGES.every((l) => /^[A-Z]/.test(l.name)));
  assert.equal(t(LANGUAGES.find((l) => l.code === 'es').name), 'الإسبانية');
});
