import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_LANGUAGES, EMAIL_TEMPLATES, EMAIL_TEMPLATES_AR, emailAsText, emailLanguage, fillEmailTemplate } from '../src/insights/emailTemplates.js';
import { EMAIL_TYPES } from '../src/compose/emailRecommend.js';
import { setLanguage } from '../src/i18n/index.js';

// Round 4, Phase 0 (docs/round4.md): the no-AI email templates are customer-facing DATA with an Arabic version. The language follows
// the rule of the AI answers (Settings > Language of AI answers): by default the language the customer writes in; with "the language
// of the panel", the panel's. The panel's language by itself never changes what the customer gets.

const AHMED = { role: 'caller', name: 'أحمد العتيبي', firstName: 'أحمد', email: 'ahmed@example.com' };
// Short vowels and the other marks (written as code points so the source shows what they are).
const DIACRITICS = new RegExp(`[${String.fromCharCode(0x64b)}-${String.fromCharCode(0x65f)}${String.fromCharCode(0x670)}]`);
const ABEL = { role: 'caller', name: 'Abel Tuter', firstName: 'Abel', email: 'abel@example.com' };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com' };
const comment = (by, text) => ({ when: '2026-11-05 10:00:00', by, type: 'comment', text });
const pack = ({ title = 'البريد لا يعمل على الهاتف', description = '', people = [AHMED, BETH], journal = [] } = {}) => ({
  table: 'incident',
  number: 'INC0020001',
  fields: { number: 'INC0020001', short_description: title, description, state: 'Resolved' },
  people,
  journal,
});

test('the language of the ticket: the customer\'s newest comment first, then the title and description', () => {
  assert.equal(emailLanguage(pack()), 'ar', 'an Arabic title');
  assert.equal(emailLanguage(pack({ title: 'Email not working on my phone', people: [ABEL, BETH] })), 'en');
  // The customer answered in Arabic on an English ticket: the email follows the customer.
  assert.equal(emailLanguage(pack({ title: 'Email not working', people: [AHMED, BETH], journal: [comment('أحمد العتيبي', 'شكرا، المشكلة ما زالت موجودة')] })), 'ar');
  // ...and in English on an Arabic ticket.
  assert.equal(emailLanguage(pack({ journal: [comment('أحمد العتيبي', 'Still broken, sorry for writing in English')] })), 'en');
  // The agent's own reply is not the customer's language.
  assert.equal(emailLanguage(pack({ title: 'Email not working', journal: [comment('Beth Anglin', 'مرحبا، نعمل على المشكلة')] })), 'en');
  // When the customer cannot be told apart, the comments are not used; the title is.
  assert.equal(emailLanguage(pack({ people: [], journal: [comment('someone', 'Any news?')] })), 'ar');
  // Arabic with product names (mixed) is Arabic; another script, or nothing, is English.
  assert.equal(emailLanguage(pack({ title: 'Wi-Fi شبكة' })), 'ar', 'half Arabic, half Latin');
  assert.equal(emailLanguage(pack({ title: 'Outlook Wi-Fi VPN شبكة' })), 'en', 'mostly Latin letters');
  assert.equal(emailLanguage(pack({ title: 'Не работает принтер', people: [] })), 'en');
  assert.equal(emailLanguage(pack({ title: '', people: [] })), 'en');
  assert.equal(emailLanguage(null), 'en');
});

test('the language of the panel, when the person chose it for AI answers; the panel alone never decides', () => {
  const english = pack({ title: 'Email not working', people: [ABEL, BETH] });
  assert.equal(emailLanguage(english, { answerLanguage: 'panel', panelLanguage: 'ar' }), 'ar');
  assert.equal(emailLanguage(pack(), { answerLanguage: 'panel', panelLanguage: 'en' }), 'en');
  assert.equal(emailLanguage(english, { answerLanguage: 'ticket', panelLanguage: 'ar' }), 'en', 'the default follows the ticket');
  assert.equal(emailLanguage(pack(), { answerLanguage: 'panel', panelLanguage: 'fr' }), 'ar', 'no template in that language: the ticket decides');
  setLanguage('ar');
  try {
    assert.equal(fillEmailTemplate('closure', { pack: english }).language, 'en', 'an Arabic panel does not change an English customer\'s email');
  } finally {
    setLanguage('en');
  }
});

test('an Arabic caller gets the Arabic template, filled from the ticket, with the record number and names as written', () => {
  const filled = fillEmailTemplate('resolution', { pack: pack(), agentName: 'Beth Anglin' });
  assert.equal(filled.language, 'ar');
  assert.equal(filled.subject, 'تم حل INC0020001: البريد لا يعمل على الهاتف');
  assert.match(filled.body, /^مرحبا أحمد،\n/);
  assert.ok(filled.body.includes('تذكرتك INC0020001 («البريد لا يعمل على الهاتف»)'), filled.body);
  assert.match(filled.body, /Beth Anglin$/);
  assert.equal(filled.placeholders, 2);
  assert.match(emailAsText(filled), /^الموضوع: تم حل INC0020001/);
  // No name, no agent: the Arabic placeholders.
  const anon = fillEmailTemplate('status-update', { pack: pack({ people: [] }) });
  assert.match(anon.body, /^مرحبا،\n/);
  assert.match(anon.body, /\[اسمك\]$/);
  const untitled = fillEmailTemplate('closure', { pack: pack({ title: '', people: [] }), language: 'ar' });
  assert.match(untitled.subject, /\[الوصف المختصر\]/);
});

test('an English caller gets the English template as before; the language can be given', () => {
  const english = pack({ title: 'VPN keeps disconnecting', people: [ABEL, BETH] });
  const filled = fillEmailTemplate('resolution', { pack: english, agentName: 'Beth Anglin' });
  assert.equal(filled.language, 'en');
  assert.equal(filled.subject, 'INC0020001 is resolved: VPN keeps disconnecting');
  assert.match(filled.body, /^Hello Abel,/);
  assert.match(emailAsText(filled), /^Subject: /);
  assert.equal(fillEmailTemplate('resolution', { pack: english, language: 'ar' }).language, 'ar');
  assert.equal(fillEmailTemplate('resolution', { pack: pack(), language: 'en' }).language, 'en');
  assert.equal(fillEmailTemplate('resolution', { pack: pack(), language: 'xx' }).language, 'ar', 'an unknown language: the ticket decides');
  assert.equal(fillEmailTemplate('nope', { pack: pack() }), null);
  assert.equal(emailAsText(null), '');
});

test('the Arabic templates mirror the English: same kinds, same {values}, as many [brackets] to fill, in every case', () => {
  assert.deepEqual(EMAIL_LANGUAGES, ['en', 'ar']);
  assert.deepEqual(Object.keys(EMAIL_TEMPLATES_AR).sort(), EMAIL_TYPES.map((t) => t.id).sort());
  const tokens = (tpl) => [...`${tpl.subject}\n${tpl.body.join('\n')}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const brackets = (tpl) => (`${tpl.subject}\n${tpl.body.join('\n')}`.match(/\[[^\]\n]{2,80}\]/g) || []).length;
  for (const id of Object.keys(EMAIL_TEMPLATES)) {
    assert.deepEqual(tokens(EMAIL_TEMPLATES_AR[id]), tokens(EMAIL_TEMPLATES[id]), id);
    assert.equal(brackets(EMAIL_TEMPLATES_AR[id]), brackets(EMAIL_TEMPLATES[id]), id);
    for (const p of [pack(), pack({ people: [], title: '' })]) {
      const en = fillEmailTemplate(id, { pack: p, language: 'en' });
      const ar = fillEmailTemplate(id, { pack: p, language: 'ar' });
      assert.equal(ar.placeholders, en.placeholders, `${id}: the same parts to fill`);
    }
  }
});

test('the Arabic templates are plain Modern Standard Arabic: no diacritics, no Latin words, no exclamation marks', () => {
  for (const [id, tpl] of Object.entries(EMAIL_TEMPLATES_AR)) {
    const all = `${tpl.subject}\n${tpl.body.join('\n')}`.replace(/\{\w+\}/g, '');
    assert.ok(!DIACRITICS.test(all), `${id}: no diacritics`);
    assert.ok(!/[A-Za-z]/.test(all), `${id}: no Latin words`);
    assert.ok(!/!/.test(all), `${id}: no exclamation marks`);
  }
});

test('a title with braces is not filled in again in Arabic either', () => {
  const filled = fillEmailTemplate('closure', { pack: pack({ title: 'عطل {agent} {number}' }), agentName: 'Beth', language: 'ar' });
  assert.match(filled.body, /«عطل \{agent\} \{number\}»/);
});
