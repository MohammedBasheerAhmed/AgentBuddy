import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, detectCandidates, resolveOverlaps, KINDS, REGIONS, validators, HIGH_CONFIDENCE } from '../src/pii/detectors.js';
import { POSITIVES, NEGATIVES } from './fixtures/pii-corpus.js';

const kindsOf = (text, options) => detect(text, options).map((f) => f.kind);
const valuesOf = (text, options) => detect(text, options).map((f) => f.value);

// A finding of `kind` that covers the whole of `value` inside `text`.
function covers(text, found, kind, value) {
  const at = text.indexOf(value);
  assert.ok(at >= 0, `fixture error: "${value}" is not in "${text}"`);
  return found.some((f) => f.kind === kind && f.start <= at && f.end >= at + value.length);
}

// ---- the labelled corpus -------------------------------------------------------------------------------------------

test('the corpus is big, well formed and covers every detector kind', () => {
  assert.ok(POSITIVES.length + NEGATIVES.length >= 120, 'at least 120 labelled cases');
  const ids = new Set();
  for (const c of [...POSITIVES, ...NEGATIVES]) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
  }
  for (const c of POSITIVES) {
    assert.ok(c.text.includes(c.value), `${c.id}: value must be a substring of the text`);
    assert.ok(KINDS.includes(c.kind), `${c.id}: unknown kind ${c.kind}`);
  }
  for (const kind of KINDS) assert.ok(POSITIVES.some((c) => c.kind === kind), `no positive case for ${kind}`);
  assert.ok(POSITIVES.filter((c) => c.explicit).length >= 60, 'a good number of explicit-pattern cases');
});

test('explicit patterns (email, card, IBAN, SSN, secrets) are never missed', () => {
  const misses = [];
  for (const c of POSITIVES.filter((x) => x.explicit)) {
    const found = detect(c.text);
    for (const e of [{ kind: c.kind, value: c.value }, ...(c.also || [])]) {
      if (!covers(c.text, found, e.kind, e.value)) misses.push(`${c.id} (${e.kind}) in "${c.text.slice(0, 60)}"`);
    }
  }
  assert.deepEqual(misses, []);
});

test('every other positive is found too (recall over the whole corpus)', () => {
  let total = 0;
  const misses = [];
  for (const c of POSITIVES) {
    const found = detect(c.text);
    for (const e of [{ kind: c.kind, value: c.value }, ...(c.also || [])]) {
      total++;
      if (!covers(c.text, found, e.kind, e.value)) misses.push(c.id);
    }
  }
  assert.ok(1 - misses.length / total >= 0.97, `recall too low, missed: ${misses.join(', ')}`);
});

test('precision is at least 0.9 over the corpus, and the negatives stay clean', () => {
  let truePositives = 0;
  const falsePositives = [];
  for (const c of POSITIVES) {
    const found = detect(c.text);
    const expected = [{ kind: c.kind, value: c.value }, ...(c.also || [])].map((e) => ({ ...e, at: c.text.indexOf(e.value) }));
    for (const e of expected) if (covers(c.text, found, e.kind, e.value)) truePositives++;
    // a finding that overlaps none of the expected values is a false positive
    for (const f of found) if (!expected.some((e) => f.start < e.at + e.value.length && e.at < f.end)) falsePositives.push(`${c.id}: ${f.kind} "${f.value}"`);
  }
  let clean = 0;
  for (const n of NEGATIVES) {
    const found = detect(n.text);
    if (!found.length) clean++;
    for (const f of found) falsePositives.push(`${n.id}: ${f.kind} "${f.value}"`);
  }
  const precision = truePositives / (truePositives + falsePositives.length);
  assert.ok(precision >= 0.9, `precision ${precision.toFixed(3)}, false positives: ${falsePositives.join('; ')}`);
  assert.ok(clean / NEGATIVES.length >= 0.9, `only ${clean} of ${NEGATIVES.length} negatives are clean: ${falsePositives.join('; ')}`);
});

test('a finding is { kind, start, end, value, confidence } and value is the exact slice', () => {
  for (const c of [...POSITIVES, ...NEGATIVES]) {
    for (const f of detect(c.text)) {
      assert.deepEqual(Object.keys(f).sort(), ['confidence', 'end', 'kind', 'start', 'value']);
      assert.equal(f.value, c.text.slice(f.start, f.end), c.id);
      assert.ok(f.confidence > 0 && f.confidence <= 1);
      assert.ok(KINDS.includes(f.kind));
    }
  }
});

test('findings never overlap and come back in text order', () => {
  for (const c of POSITIVES) {
    const found = detect(c.text);
    for (let i = 1; i < found.length; i++) assert.ok(found[i].start >= found[i - 1].end, `${c.id} overlaps`);
  }
  const all = detect(POSITIVES.map((c) => c.text).join('\n'));
  for (let i = 1; i < all.length; i++) assert.ok(all[i].start >= all[i - 1].end);
});

// ---- validators ---------------------------------------------------------------------------------------------------

test('Luhn, IBAN mod 97, Verhoeff and SSN rules', () => {
  assert.ok(validators.luhnOk('4111111111111111'));
  assert.ok(!validators.luhnOk('4111111111111112'));
  assert.ok(validators.ibanOk('GB82WEST12345698765432'));
  assert.ok(!validators.ibanOk('GB82WEST12345698765433'), 'bad check digits');
  assert.ok(!validators.ibanOk('GB82WEST1234569876543'), 'bad length');
  assert.ok(!validators.ibanOk('XX82WEST12345698765432'), 'unknown country');
  assert.ok(validators.verhoeffOk('234567890124'));
  assert.ok(!validators.verhoeffOk('234567890123'));
  assert.ok(validators.ssnOk('123', '45', '6789'));
  for (const [a, g, s] of [['000', '45', '6789'], ['666', '45', '6789'], ['900', '45', '6789'], ['999', '45', '6789'], ['123', '00', '6789'], ['123', '45', '0000']]) {
    assert.ok(!validators.ssnOk(a, g, s), `${a}-${g}-${s} is not a valid SSN`);
  }
});

test('cards: checksum, issuer and grouping decide, not just 16 digits', () => {
  assert.deepEqual(valuesOf('4111 1111 1111 1111'), ['4111 1111 1111 1111']);
  assert.deepEqual(valuesOf('4111 1111 1111 1112'), [], 'fails Luhn');
  assert.deepEqual(valuesOf('1698312345678901'), [], 'epoch microseconds start with 1');
  assert.deepEqual(valuesOf('card 4111 1111 1111 1111 123 exp 12/27'), ['4111 1111 1111 1111'], 'a CVV after the number is not swallowed');
  assert.deepEqual(valuesOf('ref 123 4111 1111 1111 1111'), ['4111 1111 1111 1111'], 'neither is a prefix');
  assert.deepEqual(valuesOf('4111 111 11111 1111'), [], 'irregular grouping');
  assert.equal(detect('4111 1111 1111 1111')[0].kind, 'CARD');
});

test('IBANs: a following word is not swallowed, bad checksums are ignored', () => {
  assert.deepEqual(valuesOf('DE89 3704 0044 0532 0130 00 is my iban'), ['DE89 3704 0044 0532 0130 00']);
  assert.deepEqual(valuesOf('DE00 3704 0044 0532 0130 00'), [], 'check digits wrong');
  assert.deepEqual(valuesOf('DE89 3704 0044 0532 0130'), [], 'too short for DE');
});

test('SSNs follow the validity rules', () => {
  assert.deepEqual(kindsOf('000-12-3456 666-12-3456 900-12-3456 123-00-3456 123-45-0000'), []);
  assert.deepEqual(valuesOf('123-45-6789'), ['123-45-6789']);
  assert.deepEqual(valuesOf('SSN 123456789'), ['123456789']);
  assert.deepEqual(valuesOf('order 123456789'), [], 'nine bare digits without a label are not an SSN');
});

test('UK NI numbers reject the impossible prefixes', () => {
  assert.deepEqual(valuesOf('AB123456C'), ['AB123456C']);
  for (const bad of ['BG123456C', 'GB123456C', 'NK123456C', 'KN123456C', 'TN123456C', 'NT123456C', 'ZZ123456C', 'QQ123456C', 'DA123456C']) assert.deepEqual(valuesOf(bad), [], bad);
});

test('Aadhaar needs a valid Verhoeff checksum; PAN needs a valid holder letter', () => {
  assert.deepEqual(valuesOf('2345 6789 0124'), ['2345 6789 0124']);
  assert.deepEqual(valuesOf('2345 6789 0123'), []);
  assert.deepEqual(valuesOf('123e4567-e89b-12d3-a456-426614174000'), [], 'the tail of a UUID is not an Aadhaar number');
  assert.deepEqual(valuesOf('ABCPD1234F'), ['ABCPD1234F']);
  assert.deepEqual(valuesOf('ABCDE1234F'), [], '4th letter must be a holder type');
});

// ---- options ------------------------------------------------------------------------------------------------------

test('regions switch national formats on and off; the default is all of them', () => {
  assert.deepEqual([...REGIONS], ['US', 'UK', 'IN']);
  const text = 'SSN 123-45-6789, NI AB123456C, Aadhaar 2345 6789 0124, PAN ABCPD1234F';
  assert.equal(detect(text).filter((f) => f.kind === 'NATIONAL_ID').length, 4);
  assert.deepEqual(valuesOf(text, { regions: ['US'] }), ['123-45-6789']);
  assert.deepEqual(valuesOf(text, { regions: ['UK'] }), ['AB123456C']);
  assert.deepEqual(valuesOf(text, { regions: ['GB'] }), ['AB123456C'], 'GB is an alias of UK');
  assert.deepEqual(valuesOf(text, { regions: ['IN'] }), ['2345 6789 0124', 'ABCPD1234F']);
  assert.deepEqual(valuesOf(text, { regions: [] }), []);
  assert.deepEqual(valuesOf('Call 020 7946 0958', { regions: ['US'] }), [], 'UK numbers are a UK-region format');
  assert.deepEqual(valuesOf('Phone +44 20 7946 0958', { regions: ['US'] }), ['+44 20 7946 0958'], 'international numbers are not regional');
});

test('kinds restricts the detectors that run', () => {
  const text = 'abel@example.com 4111 1111 1111 1111 password: Summer2024!';
  assert.deepEqual(kindsOf(text), ['EMAIL', 'CARD', 'SECRET']);
  assert.deepEqual(kindsOf(text, { kinds: ['EMAIL'] }), ['EMAIL']);
  assert.deepEqual(kindsOf(text, { kinds: ['CARD', 'SECRET'] }), ['CARD', 'SECRET']);
  assert.deepEqual(kindsOf(text, { kinds: [] }), []);
});

test('weak findings (loopback, netmask) are below the default threshold but available on request', () => {
  assert.deepEqual(valuesOf('127.0.0.1 and 255.255.255.0'), []);
  assert.deepEqual(valuesOf('127.0.0.1 and 255.255.255.0', { minConfidence: 0 }), ['127.0.0.1', '255.255.255.0']);
});

test('overlaps: higher confidence wins, then the longer span', () => {
  const resolved = resolveOverlaps([
    { kind: 'A', start: 0, end: 10, value: '', confidence: 0.7 },
    { kind: 'B', start: 5, end: 8, value: '', confidence: 0.9 },
    { kind: 'C', start: 20, end: 25, value: '', confidence: 0.8 },
    { kind: 'D', start: 20, end: 30, value: '', confidence: 0.8 },
  ]);
  assert.deepEqual(resolved.map((f) => f.kind), ['B', 'D']);
  // credentials inside a URL beat the email-shaped tail of the same text
  const url = 'https://user:p4ss@host.example.com/x';
  assert.deepEqual(detect(url).map((f) => [f.kind, f.value]), [['URL_CREDENTIALS', 'user:p4ss']]);
  assert.deepEqual(detectCandidates(url).map((f) => f.kind).sort(), ['EMAIL', 'URL_CREDENTIALS']);
});

test('a number pasted straight after an address does not hide the address', () => {
  assert.deepEqual(valuesOf('mail abel@example.com5551234567 now'), ['abel@example.com']);
});

test('placeholders are never findings', () => {
  assert.deepEqual(detect('[EMAIL_1] [ID_1] [SECRET_1] [PHONE_2] password: [SECRET_1]'), []);
  assert.deepEqual(detect('password: <redacted> pwd=**** token=${TOKEN}'), []);
});

test('a 7-digit local number is a phone only after a calling verb', () => {
  for (const text of ['Call me on 555-0199', 'please call 555-0123 after lunch', 'Dial 555 0142', 'can you ring them back on 555.0188?']) {
    assert.deepEqual(kindsOf(text), ['PHONE'], text);
  }
  assert.equal(valuesOf('Call me on 555-0199')[0], '555-0199');
  // past tense and a first name in between
  for (const text of ['Called Dana on 555-0177', 'rang Priya back on 555-0166', 'He phoned 555-0155 twice', 'texted Beth Anglin on 555 0144']) {
    assert.deepEqual(kindsOf(text), ['PHONE'], text);
  }
  assert.deepEqual(kindsOf('Dana called about order 555-0177'), [], 'a word that is not a name or filler breaks the link to the number');
  // Without the verb it is any seven digits: an extension, a part number, an order id.
  for (const text of ['part 555-0199 is out of stock', 'order 555-0123 shipped', 'the call lasted 12 minutes, ref 2026-1027']) {
    assert.deepEqual(kindsOf(text), [], text);
  }
});

test('a colon after "is" or "was" does not hide a password', () => {
  for (const text of ['Password is: Winter2026!Vpn#9', 'password was: Winter2026!Vpn#9', 'The password is = Winter2026!Vpn#9', 'password is Winter2026!Vpn#9', 'password: Winter2026!Vpn#9']) {
    assert.deepEqual(valuesOf(text), ['Winter2026!Vpn#9'], text);
  }
  assert.deepEqual(kindsOf('the password is: incorrect'), [], 'prose after the colon is still prose');
});

test('"employee id is E12345" is found, not only "employee id: E12345"', () => {
  assert.deepEqual(kindsOf('employee id is E12345'), ['EMPLOYEE_ID']);
  assert.equal(valuesOf('Her employee number was 40817')[0], '40817');
  assert.equal(valuesOf('employee id: E12345')[0], 'E12345');
  assert.deepEqual(kindsOf('every employee is invited'), []);
});

test('non-string or empty input is handled', () => {
  for (const v of [undefined, null, 42, {}, '']) assert.deepEqual(detect(v), []);
});

// ---- limits, written down -----------------------------------------------------------------------------------------

test('documented gaps: what pattern detection does not find', () => {
  // These are NOT bugs to hide. They are the reason the firewall has a dictionary, a preview and strict mode.
  assert.deepEqual(detect('Please ask Priya Sharma from facilities to approve'), [], 'names in prose');
  assert.deepEqual(detect('my number is 5551234567'), [], 'ten bare digits with no label');
  assert.deepEqual(detect('mail jane [at] corp [dot] com'), [], 'obfuscated addresses');
  assert.deepEqual(detect('the code word is swordfish'), [], 'a secret with no label or known shape');
});

// ---- performance and ReDoS ----------------------------------------------------------------------------------------

const N = 200000;
const fit = (s) => s.repeat(Math.ceil(N / s.length)).slice(0, N);

function adversarial() {
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool = ['@', '.', '-', ':', '+', '(', ')', ' ', '1', '2', '5', '9', 'a', 'Z', 'password', '=', 'http://', 'eyJ', 'sk-', 'DOB', '00', '-----BEGIN ', 'Bearer ', 'Street', '\n', '4111 ', 'x@y.com'];
  let random = '';
  while (random.length < N) random += pool[Math.floor(rnd() * pool.length)];
  return {
    letters: 'a'.repeat(N),
    digits: '1'.repeat(N),
    'spaced digits': fit('1 '),
    'dashed digits': fit('1-'),
    'at signs': '@'.repeat(N),
    'a@a@a@': fit('a@'),
    'dotted': fit('a.'),
    'long local and domain': fit(`${'a'.repeat(100)}@${'b'.repeat(250)} `),
    'unterminated key headers': fit('-----BEGIN PRIVATE KEY-----'),
    'unterminated key body': `-----BEGIN PRIVATE KEY-----${'A'.repeat(N)}`,
    'key lines': fit('-----BEGIN PRIVATE KEY-----\nAAAAAAAAAAAAAAAAAAAAAAAA\n'),
    'password labels': fit('password='),
    'password colons': fit('password: '),
    'password for': fit('password for '),
    'url scheme': fit('://'),
    'url userinfo': fit('http://a:'),
    'url userinfo with at': fit('http://a:b@'),
    'jwt prefix run': `eyJ${'a'.repeat(N)}`,
    'jwt dots': fit('eyJaaaaaaaaa.'),
    'phone fragments': fit('(555) 123-'),
    'plus ones': fit('+1 '),
    'plus run': `+${'1'.repeat(N)}`,
    'plus digit lists': fit('+12345678901234567890 '),
    'double zero': fit('00 1 '),
    'sk run': `sk-${'a1'.repeat(N / 2)}`,
    'bearer labels': fit('Bearer '),
    'bearer run': `Bearer ${'a'.repeat(N)}`,
    'street numbers': `${fit('12 ')}Street`,
    'street words': fit('1 Aa Bb Cc Dd Ee '),
    'dob labels': fit('DOB '),
    'employee labels': fit('employee id '),
    'ipv6 colons': fit('0:'),
    'ipv6 hex': fit('a:'),
    'only colons': ':'.repeat(N),
    'ipv4 fragments': fit('1.1.1.'),
    'nino fragments': fit('AB 12 34 56 '),
    'iban fragments': fit('DE89 '),
    'long iban-like': fit(`DE89${'1'.repeat(40)} `),
    'card fragments': fit('4111 '),
    'ssn fragments': fit('123-45-'),
    'aadhaar fragments': fit('2345 6789 '),
    'mac fragments': fit('00:1A:'),
    'whitespace': ' '.repeat(N),
    'realistic mix': fit('Contact abel@example.com or +1 (555) 123-4567; password: Summer2024! 4111 1111 1111 1111 192.168.1.1 '),
    'prose': fit('word '),
    'random tokens': random.slice(0, N),
  };
}

test('200k characters of adversarial input finish quickly (no catastrophic backtracking)', () => {
  const slow = [];
  for (const [name, raw] of Object.entries(adversarial())) {
    const text = raw.slice(0, N);
    assert.equal(text.length, N, name);
    const started = performance.now();
    detect(text);
    const ms = performance.now() - started;
    if (ms >= 500) slow.push(`${name}: ${ms.toFixed(0)} ms`);
  }
  assert.deepEqual(slow, []);
});

test('the whole corpus joined many times is linear, not quadratic', () => {
  const text = POSITIVES.concat(NEGATIVES).map((c) => c.text).join('\n');
  const big = text.repeat(Math.ceil(N / text.length));
  const started = performance.now();
  const found = detect(big);
  assert.ok(found.length > 500);
  assert.ok(performance.now() - started < 2000, 'a few hundred KB of realistic text takes well under two seconds');
});

test('HIGH_CONFIDENCE sits where the firewall expects', () => {
  assert.equal(HIGH_CONFIDENCE, 0.85);
});
