import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirewall, FirewallError, assertNoHighConfidencePii } from '../src/pii/firewall.js';
import { detect, detectCandidates, resolveOverlaps } from '../src/pii/detectors.js';
import { isSealed } from '../src/pii/seal.js';
import { invisibleChars } from '../src/lib/invisible.js';
import { stripUnsafeChars } from '../src/render/safeText.js';

// Hardening of the AI firewall (audit 2026-11-04, P1.1-P1.6): invisible characters that hid a value from the detectors, the final
// check refusing what masking left alone on purpose, quadratic Arabic patterns, "Mask this too" inside words and in the fixed prompt,
// a name inside an address, and offsets around characters outside the first plane.

const cp = (...codes) => String.fromCodePoint(...codes);
const PEOPLE = [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) }];
const part = (text, field = 'description', extra = {}) => ({ label: field, field, text, ...extra });
const input = (parts, extra = {}) => ({ feature: 'record-summary', table: 'incident', system: 'You summarise tickets.', parts, userInstruction: 'Summarise this ticket.', ...extra });
const userOf = (sealed) => sealed.messages.find((m) => m.role === 'user').content;
const systemOf = (sealed) => sealed.messages.find((m) => m.role === 'system').content;
const bodies = (sealed) => [...userOf(sealed).matchAll(/<ticket_data[^>]*>\n([\s\S]*?)\n<\/ticket_data>/g)].map((m) => m[1]);
const refused = (fn, code = 'REDACTION_FAILED') => assert.throws(fn, (e) => e instanceof FirewallError && e.code === code);

// ---- P1.1: invisible characters -----------------------------------------------------------------------------------------------------

// One of each kind: direction marks, the Arabic letter mark, invisible operators, deprecated format characters, the Mongolian vowel
// separator, the combining grapheme joiner, Hangul and Khmer fillers, variation selectors (the emoji pair too), tag characters and the
// variation selector supplement, C1 controls, annotation characters, the shorthand and musical format controls.
const HIDING = [
  0x200e, 0x200f, 0x061c, 0x2061, 0x2062, 0x2063, 0x2064, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0x180e, 0x034f, 0x115f,
  0x1160, 0x3164, 0xffa0, 0x17b4,
  0xfe00, 0xfe0f, 0xe0020, 0xe0041, 0xe0100, 0x0080, 0x009b, 0x009f, 0xfff9, 0x1bca0, 0x1d173,
];

test('an email, a card number and a name with an invisible character inside are still masked', () => {
  for (const c of HIDING) {
    const h = cp(c);
    const label = `U+${c.toString(16)}`;
    const fw = createFirewall({ people: PEOPLE });
    const [body] = bodies(fw.buildRequest(input([part(`mail jane.roe${h}@corp.example.org, card 4111${h}1111${h}1111${h}1111, spoke to Ab${h}el Tu${h}ter`)])));
    assert.equal(body, 'mail [EMAIL_1], card [CARD_1], spoke to [PERSON_1]', label);
    assert.ok(!body.includes(h), `${label} is not sent`);
  }
});

test('ZWJ and ZWNJ stay in what is sent (some scripts need them), and so do tab and the line breaks', () => {
  const fw = createFirewall({ people: [] });
  const persian = `mi${cp(0x200c)}khaham ${cp(0x1f468, 0x200d, 0x1f4bb)}`;
  const [body] = bodies(fw.buildRequest(input([part(`${persian}\tend\r\nnext`)])));
  assert.equal(body, `${persian}\tend\r\nnext`);
});

test('the final check reads through every invisible character, ZWJ and ZWNJ too: a value split by one is refused, not sent', () => {
  for (const c of [...HIDING, 0x200c, 0x200d]) {
    refused(() => assertNoHighConfidencePii(`mail jane.roe${cp(c)}@corp.example.org`));
    refused(() => assertNoHighConfidencePii(`card 4111${cp(c)}1111${cp(c)}1111${cp(c)}1111`));
  }
  // Masking keeps a joiner, so it does not find this card; the final check does, and nothing is sent.
  const zwj = cp(0x200d);
  refused(() => createFirewall({ people: [] }).buildRequest(input([part(`card 4111${zwj}1111${zwj}1111${zwj}1111`)])));
  assert.doesNotThrow(() => assertNoHighConfidencePii(`[PERSON_1] wrote ${cp(0x200f)}[EMAIL_1]${cp(0x2063)}`));
});

test('the firewall and the answer renderer share one list of invisible characters', () => {
  const firewallKeeps = [0x0d, 0x85, 0x200c, 0x200d];
  const all = invisibleChars();
  for (const c of HIDING) assert.equal(cp(c).replace(all, ''), '', `U+${c.toString(16)} is on the list`);
  for (const c of firewallKeeps) assert.equal(cp(c).replace(invisibleChars({ keep: firewallKeeps }), ''), cp(c), `U+${c.toString(16)} kept`);
  for (const c of [0x09, 0x0a, 0x20, 0x41, 0x0627, 0x2028]) assert.equal(cp(c).replace(all, ''), cp(c), `U+${c.toString(16)} is not invisible`);
  // The renderer removes the same characters (it keeps only the emoji variation selectors, and a joiner between two emoji).
  for (const c of HIDING.filter((x) => x !== 0xfe0f)) assert.equal(stripUnsafeChars(`ad${cp(c)}min`), 'admin', `U+${c.toString(16)}`);
});

// ---- P1.2: what masking leaves alone, the final check leaves alone ----------------------------------------------------------------------

test('a password inside a longer word is masked; the request is built, not refused', () => {
  for (const parts of [
    [part('Temporary password: Welcome1 was issued.'), part('User says Welcome12 also failed.', 'comments')],
    [part('Temporary password: Welcome1 was issued. User says Welcome12 also failed.')],
  ]) {
    const req = createFirewall({ people: [] }).buildRequest(input(parts));
    assert.ok(isSealed(req));
    assert.ok(!userOf(req).toLowerCase().includes('welcome1'), userOf(req));
    assert.match(userOf(req), /\[SECRET_1\]2 also failed/);
  }
  // in another case too: the check has always compared without case
  const [body] = bodies(createFirewall({ people: [] }).buildRequest(input([part('password: Welcome1 then typed WELCOME1 and welcome12')])));
  assert.equal(body, 'password: [SECRET_1] then typed [SECRET_2] and [SECRET_3]2');
});

test('a value inside a longer word or number is another value: left as written, and the request is built', () => {
  const ip = createFirewall({ people: [] }).buildRequest(input([part('Server 10.20.30.40 is down.'), part('Upgrade to v10.20.30.40 tonight', 'comments')]));
  assert.deepEqual(bodies(ip), ['Server [IP_1] is down.', 'Upgrade to v10.20.30.40 tonight']);
  // as a word of its own it is still masked, in any case
  const again = createFirewall({ people: [] }).buildRequest(input([part('Employee ID: ab12345'), part('ask AB12345 (or ab12345-old)', 'comments')]));
  assert.deepEqual(bodies(again), ['Employee ID: [ID_1]', 'ask [ID_1] (or [ID_1]-old)']);
});

test('a number that identifies someone is masked even glued to other text: never sent, never a refusal', () => {
  // An ID, a phone number and a card seen once are the same number when written against a word: masked there too (privacy first:
  // a few characters too many masked, never the number itself sent), and the request is still built.
  const id = createFirewall({ people: [] }).buildRequest(input([part('Employee ID: 4471234'), part('Ref A4471234 raised', 'comments')]));
  assert.deepEqual(bodies(id), ['Employee ID: [ID_1]', 'Ref A[ID_1] raised']);
  const phone = createFirewall({ people: [] }).buildRequest(input([part('Call me on +1 555 123 4567'), part('Phone+1 555 123 4567x2 again', 'comments')]));
  const [, glued] = bodies(phone);
  assert.ok(!glued.includes('555 123 4567'), glued);
  assert.match(glued, /\[PHONE_1\]/);
});

test('a short password is masked as a word of its own only, and a placeholder is never taken for the value it hides', () => {
  const [a, b] = bodies(createFirewall({ people: [] }).buildRequest(input([part('pwd: Pa5!x'), part('typed Pa5!x then Pa5!xy', 'comments')])));
  assert.deepEqual([a, b], ['pwd: [SECRET_1]', 'typed [SECRET_1] then Pa5!xy']);
  // "Secret" is the password: "[SECRET_1]" does not still contain it
  const req = createFirewall({ people: [] }).buildRequest(input([part('password: Secret')]));
  assert.deepEqual(bodies(req), ['password: [SECRET_1]']);
});

test('a real leak is still refused: a value that got a placeholder and is still written elsewhere', () => {
  // A token too long to remember is masked where its shape is seen; glued to a word it is not, and the final check refuses.
  const jwt = `eyJ${'a'.repeat(150)}.${'b'.repeat(150)}.${'c'.repeat(20)}`;
  refused(() => createFirewall({ people: [] }).buildRequest(input([part(`token ${jwt}`), part(`glued x${jwt}`, 'comments')])));
  assert.ok(isSealed(createFirewall({ people: [] }).buildRequest(input([part(`token ${jwt}`), part(`again ${jwt}`, 'comments')]))));
});

// ---- P1.3: Arabic patterns stay linear --------------------------------------------------------------------------------------------------

const cpuMs = (fn) => {
  const before = process.cpuUsage();
  fn();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
};

test('Arabic labels followed by long runs of space or line breaks finish quickly (CPU time, not wall-clock)', () => {
  const labels = ['رقم الهوية', 'رقم الهوية الوطنية', 'رقم الجوال', 'واتساب', 'كلمة المرور', 'الرقم السري', 'رقم الموظف', 'تاريخ الميلاد', 'مولود في'];
  let total = 0;
  for (const label of labels) {
    for (const gap of [' ', '\n', ' \t', ': ']) {
      const text = `${label}${gap.repeat(Math.floor(16000 / gap.length))}x`;
      total += cpuMs(() => detectCandidates(text));
    }
  }
  assert.ok(total < 1500, `${total.toFixed(0)} ms of CPU`);
  // the same through the firewall: a journal of 30 notes, each a label then a long run of spaces
  const notes = Array.from({ length: 30 }, (_, i) => `${labels[i % labels.length]}${' '.repeat(1480)}`).join('\n');
  const ms = cpuMs(() => createFirewall({ mode: 'strict', people: [] }).buildRequest(input([part(notes, 'journal')])));
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms of CPU`);
});

test('the Arabic labels still find their values with the usual spacing, a line break included', () => {
  const kinds = (text) => detect(text).map((f) => `${f.kind}:${f.value}`);
  assert.deepEqual(kinds('رقم الجوال : ٠٥٠١٢٣٤٥٦٧'), ['PHONE:٠٥٠١٢٣٤٥٦٧']);
  assert.deepEqual(kinds('رقم الجوال\n0501234567'), ['PHONE:0501234567']);
  assert.deepEqual(kinds('رقم الهوية هو  1089765432'), ['NATIONAL_ID:1089765432']);
  assert.deepEqual(kinds('رقم الموظف:\r\nE123456'), ['EMPLOYEE_ID:E123456']);
  assert.deepEqual(kinds('تاريخ الميلاد :\n١٤/٠٣/١٩٨٥'), ['DOB:١٤/٠٣/١٩٨٥']);
});

// ---- P1.4: "Mask this too" --------------------------------------------------------------------------------------------------------------

test('"Mask this too" masks the text as a word of its own: not inside other words', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(input([part('Ali said the call quality is bad. Also check Alignment, and ali.')], { mask: ['Ali'] }));
  assert.deepEqual(bodies(req), ['[PERSON_1] said the call quality is bad. Also check Alignment, and [PERSON_1].']);
  assert.equal(req.stats.counts.MANUAL, 2);
});

test('"Mask this too" never rewrites the fixed prompt, and the request is still built', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(input([part('They ask us to summarise this ticket, then summarise it again.')], { mask: ['summarise this ticket'] }));
  assert.ok(isSealed(req));
  assert.deepEqual(bodies(req), ['They ask us to [MASKED_1], then summarise it again.']);
  assert.ok(userOf(req).endsWith('Summarise this ticket.'), 'the instruction keeps its wording');
  assert.ok(systemOf(req).startsWith('You summarise tickets.'));
});

// ---- P1.5: a name inside an address ---------------------------------------------------------------------------------------------------

test('a name inside an address: the address is masked whole, and comes back whole', () => {
  const fw = createFirewall({ people: [{ role: 'caller', name: 'Priya Raman', email: 'priya.raman@example.com' }] });
  const req = fw.buildRequest(input([part('Ship it to 42 Raman Street, Leeds'), part('or 42 Priya Raman Road please', 'comments')]));
  const [a, b] = bodies(req);
  assert.equal(a, 'Ship it to [ADDRESS_1], Leeds');
  assert.equal(b, 'or [ADDRESS_2] please');
  assert.equal(fw.rehydrate(a), 'Ship it to 42 Raman Street, Leeds');
});

test('resolveOverlaps: a name or hand-masked text inside a wider, weaker finding yields to it; otherwise the stronger one wins', () => {
  const f = (kind, start, end, confidence) => ({ kind, start, end, value: 'x'.repeat(end - start), confidence });
  const kinds = (list) => resolveOverlaps(list).map((x) => `${x.kind}:${x.start}-${x.end}`);
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('ADDRESS', 0, 15, 0.7)]), ['ADDRESS:0-15']);
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('MANUAL', 9, 12, 0.96), f('ADDRESS', 0, 15, 0.7)]), ['ADDRESS:0-15']);
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('SECRET', 0, 12, 0.9)]), ['SECRET:0-12']);
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('ADDRESS', 5, 15, 0.7)]), ['PERSON:3-8'], 'only part of it: the stronger wins');
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('ADDRESS', 3, 8, 0.7)]), ['PERSON:3-8'], 'the same span: the stronger wins');
  // between the detectors' own findings the confidence order decides, as before
  assert.deepEqual(kinds([f('NATIONAL_ID', 3, 12, 0.9), f('ADDRESS', 0, 18, 0.7)]), ['NATIONAL_ID:3-12']);
  assert.deepEqual(kinds([f('PERSON', 3, 8, 0.97), f('PHONE', 10, 14, 0.9), f('ADDRESS', 0, 15, 0.7)]), ['PERSON:3-8', 'PHONE:10-14']);
});

// ---- P1.6: characters outside the first plane -----------------------------------------------------------------------------------------

test('a prose name around a record name with a letter outside the first plane: the rest of the name is masked too', () => {
  const deseret = cp(0x10400, 0x10428, 0x10428);
  for (const mode of ['standard', 'strict']) {
    const fw = createFirewall({ mode, people: [{ role: 'caller', name: `Abel ${deseret}` }] });
    const [body] = bodies(fw.buildRequest(input([part(`manager is Abel ${deseret} Wu`)])));
    assert.equal(body, 'manager is [PERSON_1]', mode);
  }
});

test('an emoji before a masked value changes nothing', () => {
  const fw = createFirewall({ people: PEOPLE });
  const [body] = bodies(fw.buildRequest(input([part(`${cp(0x1f600)} spoke with Dr. Abel Tuter Wu, ${cp(0x1f44d)} mail abel.tuter@example.com`)])));
  assert.equal(body, `${cp(0x1f600)} spoke with Dr. [PERSON_1], ${cp(0x1f44d)} mail [EMAIL_1]`);
  assert.equal(fw.rehydrate('[PERSON_1]'), 'Abel Tuter Wu');
});
