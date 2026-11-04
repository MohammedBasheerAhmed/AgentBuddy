import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenizer, labelFor } from '../src/pii/tokenizer.js';

const f = (kind, value, extra = {}) => ({ kind, value, ...extra });

test('placeholders are numbered per label, starting at 1', () => {
  const t = createTokenizer();
  assert.equal(t.placeholderFor(f('EMAIL', 'a@x.com')), '[EMAIL_1]');
  assert.equal(t.placeholderFor(f('EMAIL', 'b@x.com')), '[EMAIL_2]');
  assert.equal(t.placeholderFor(f('PHONE', '+1 555 123 4567')), '[PHONE_1]');
  assert.equal(t.placeholderFor(f('CARD', '4111 1111 1111 1111')), '[CARD_1]');
  assert.equal(t.placeholderFor(f('SECRET', 'hunter22')), '[SECRET_1]');
  assert.equal(t.placeholderFor(f('IBAN', 'GB82WEST12345698765432')), '[IBAN_1]');
  assert.equal(t.placeholderFor(f('ADDRESS', '221B Baker Street')), '[ADDRESS_1]');
  assert.equal(t.placeholderFor(f('IP', '10.0.0.1')), '[IP_1]');
  assert.equal(t.placeholderFor(f('DOB', '14/03/1985')), '[DOB_1]');
  assert.equal(t.size, 9);
});

test('national ids and employee ids share the ID label; URL credentials share SECRET', () => {
  const t = createTokenizer();
  assert.equal(labelFor('NATIONAL_ID'), 'ID');
  assert.equal(labelFor('EMPLOYEE_ID'), 'ID');
  assert.equal(labelFor('URL_CREDENTIALS'), 'SECRET');
  assert.equal(labelFor('SOMETHING_NEW'), 'DATA');
  assert.equal(t.placeholderFor(f('NATIONAL_ID', '123-45-6789')), '[ID_1]');
  assert.equal(t.placeholderFor(f('EMPLOYEE_ID', 'E123456')), '[ID_2]');
  assert.equal(t.placeholderFor(f('SECRET', 'abc12345')), '[SECRET_1]');
  assert.equal(t.placeholderFor(f('URL_CREDENTIALS', 'user:pass')), '[SECRET_2]');
});

test('the same value always gets the same placeholder (normalised comparison)', () => {
  const t = createTokenizer();
  assert.equal(t.placeholderFor(f('EMAIL', 'Abel.Tuter@Example.com')), '[EMAIL_1]');
  assert.equal(t.placeholderFor(f('EMAIL', 'abel.tuter@example.com')), '[EMAIL_1]');
  assert.equal(t.placeholderFor(f('EMAIL', ' ABEL.TUTER@EXAMPLE.COM ')), '[EMAIL_1]');
  assert.equal(t.placeholderFor(f('PHONE', '(555) 123-4567')), '[PHONE_1]');
  assert.equal(t.placeholderFor(f('PHONE', '555.123.4567')), '[PHONE_1]');
  assert.equal(t.placeholderFor(f('PHONE', '+1 555 123 4567')), '[PHONE_2]', 'a different number (with a country code)');
  assert.equal(t.placeholderFor(f('CARD', '4111-1111-1111-1111')), '[CARD_1]');
  assert.equal(t.placeholderFor(f('CARD', '4111111111111111')), '[CARD_1]');
  assert.equal(t.placeholderFor(f('NATIONAL_ID', '123-45-6789')), '[ID_1]');
  assert.equal(t.placeholderFor(f('NATIONAL_ID', '123456789')), '[ID_1]');
  assert.equal(t.placeholderFor(f('IBAN', 'GB82 WEST 1234 5698 7654 32')), '[IBAN_1]');
  assert.equal(t.placeholderFor(f('IBAN', 'gb82west12345698765432')), '[IBAN_1]');
  assert.equal(t.placeholderFor(f('ADDRESS', '221B  Baker Street')), '[ADDRESS_1]');
  assert.equal(t.placeholderFor(f('ADDRESS', '221b baker street')), '[ADDRESS_1]');
});

test('secrets are compared exactly: a different case is a different secret', () => {
  const t = createTokenizer();
  assert.equal(t.placeholderFor(f('SECRET', 'Summer2024!')), '[SECRET_1]');
  assert.equal(t.placeholderFor(f('SECRET', 'summer2024!')), '[SECRET_2]');
  assert.equal(t.placeholderFor(f('SECRET', 'Summer2024!')), '[SECRET_1]');
});

test('people are keyed by entity: every mention of one person is one placeholder, others differ', () => {
  const t = createTokenizer();
  const abel = t.placeholderFor(f('PERSON', 'Abel Tuter', { entity: 'p1', canonical: 'Abel Tuter' }));
  const beth = t.placeholderFor(f('PERSON', 'Beth Anglin', { entity: 'p2', canonical: 'Beth Anglin' }));
  assert.equal(abel, '[PERSON_1]');
  assert.equal(beth, '[PERSON_2]');
  assert.equal(t.placeholderFor(f('PERSON', 'Abel', { entity: 'p1', canonical: 'Abel Tuter' })), abel);
  assert.equal(t.placeholderFor(f('PERSON', "tuter", { entity: 'p1', canonical: 'Abel Tuter' })), abel);
  assert.equal(t.placeholderFor(f('PERSON', 'abel.tuter', { entity: 'p1', canonical: 'Abel Tuter' })), abel);
  assert.equal(t.rehydrate(`${abel} and ${beth}`), 'Abel Tuter and Beth Anglin', 'partial mentions come back as the full name from the record');
});

test('rehydrate puts the first-seen spelling back', () => {
  const t = createTokenizer();
  const ph = t.placeholderFor(f('EMAIL', 'Abel.Tuter@Example.com'));
  t.placeholderFor(f('EMAIL', 'abel.tuter@example.com'));
  assert.equal(t.rehydrate(`mail ${ph}.`), 'mail Abel.Tuter@Example.com.');
});

test('rehydrate only touches exact placeholders it issued', () => {
  const t = createTokenizer();
  t.placeholderFor(f('EMAIL', 'a@x.com'));
  t.placeholderFor(f('PERSON', 'Abel Tuter', { entity: 'p1', canonical: 'Abel Tuter' }));
  const out = t.rehydrate('[EMAIL_1] [EMAIL_2] [PERSON_1] [PERSON_9] [person_1] [PERSON_1 [ PERSON_1 ] PERSON_1 [PERSON-1] [PERSON_01] [FOO_1]');
  assert.equal(out, 'a@x.com [EMAIL_2] Abel Tuter [PERSON_9] [person_1] [PERSON_1 [ PERSON_1 ] PERSON_1 [PERSON-1] [PERSON_01] [FOO_1]');
});

test('rehydrate never substitutes twice and never reads values as patterns', () => {
  const t = createTokenizer();
  // The real value of PERSON_1 is itself a placeholder look-alike; it must not be expanded again.
  const p1 = t.placeholderFor(f('PERSON', '[EMAIL_2]', { entity: 'x', canonical: '[EMAIL_2]' }));
  const e1 = t.placeholderFor(f('EMAIL', 'real@x.com'));
  const e2 = t.placeholderFor(f('EMAIL', 'other@x.com'));
  assert.equal(p1, '[PERSON_1]');
  assert.equal(e1, '[EMAIL_1]');
  assert.equal(e2, '[EMAIL_2]');
  assert.equal(t.rehydrate('[PERSON_1]'), '[EMAIL_2]', 'one pass only');
  // "$&", "$1" and friends in a value are literal text
  const t2 = createTokenizer();
  const s = t2.placeholderFor(f('SECRET', "pa$&ss$1$'word"));
  assert.equal(t2.rehydrate(`x ${s} y`), "x pa$&ss$1$'word y");
});

test('text that already looks like a placeholder is defused before redaction', () => {
  const t = createTokenizer();
  assert.equal(t.protect('see [PERSON_1] and [EMAIL_12] but not [Person_1] or [X]'), 'see (PERSON_1) and (EMAIL_12) but not [Person_1] or [X]');
  assert.equal(t.protect('plain text'), 'plain text');
  t.placeholderFor(f('EMAIL', 'a@x.com'));
  assert.equal(t.rehydrate(t.protect('[EMAIL_1]')), '(EMAIL_1)', 'a ticket cannot pose as a placeholder');
});

test('the map exists only inside the tokenizer: nothing serialises or enumerates it', () => {
  const t = createTokenizer();
  t.placeholderFor(f('EMAIL', 'secret.person@example.com'));
  t.placeholderFor(f('SECRET', 'hunter2hunter2'));
  const dump = JSON.stringify(t);
  assert.ok(!dump.includes('secret.person') && !dump.includes('hunter2'));
  assert.equal(dump, '{"placeholders":2}');
  for (const key of Object.keys(t)) {
    const v = t[key];
    if (typeof v !== 'function') assert.ok(typeof v === 'number', `${key} is not a data property`);
  }
  assert.ok(!JSON.stringify(Object.getOwnPropertyNames(t)).includes('example.com'));
  assert.ok(!String(t).includes('example.com'));
});

test('rehydrate is safe with odd input', () => {
  const t = createTokenizer();
  assert.equal(t.rehydrate(undefined), '');
  assert.equal(t.rehydrate(null), '');
  assert.equal(t.rehydrate(''), '');
  t.placeholderFor(f('EMAIL', 'a@x.com'));
  assert.equal(t.rehydrate(42), '');
});
