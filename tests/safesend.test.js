import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOutgoing, maskExcerpt, DEFAULT_INTERNAL_PHRASES } from '../src/safeSend/index.js';
import { cpuTime } from './fixtures/timing.js';

const PEOPLE = [
  { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) },
  { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: 'b'.repeat(32) },
];
const check = (text, options = {}) => checkOutgoing(text, { people: PEOPLE, ...options });
const kinds = (result) => result.findings.map((f) => f.kind);

// ---- maskExcerpt --------------------------------------------------------------------------------------------------

test('maskExcerpt keeps a hint of the start and, for an email, the domain', () => {
  assert.equal(maskExcerpt('abel.tuter@example.com'), 'ab****@example.com');
  assert.equal(maskExcerpt('jane@x.com'), 'j****@x.com');
  assert.equal(maskExcerpt('bo@x.com'), '****@x.com');
  assert.equal(maskExcerpt('Summer2024!'), 'Su****');
  assert.equal(maskExcerpt('AKIAIOSFODNN7EXAMPLE'), 'AK****');
  assert.equal(maskExcerpt('4111 1111 1111 1111'), '4**** 1**** 1**** ...');
  assert.equal(maskExcerpt('John Smith'), 'J**** S****');
});

test('maskExcerpt never returns the whole value, whatever it is', () => {
  const values = ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'hunter22', 'Summer2024!', '123-45-6789', '+1 (555) 123-4567', 'x@y.zz', 'a'.repeat(200), 'é', '田中太郎', 'two words', '-----BEGIN RSA PRIVATE KEY-----\nMIIE'];
  for (const v of values) {
    const out = maskExcerpt(v);
    assert.notEqual(out, v);
    if (v.length >= 4 && !v.includes('@')) assert.ok(!out.includes(v.slice(0, Math.min(v.length, 3))), `${JSON.stringify(v)} -> ${out}`);
    assert.ok(out.length <= 40, 'excerpts stay short');
  }
  assert.equal(maskExcerpt(''), '');
  assert.equal(maskExcerpt(null), '');
  assert.equal(maskExcerpt(undefined), '');
});

test('maskExcerpt does not reveal the length of a value', () => {
  assert.equal(maskExcerpt('abcdefgh'), maskExcerpt('abcdefghijklmnop'));
});

// ---- PII and secrets ----------------------------------------------------------------------------------------------

test('clean customer text is ok', () => {
  const r = check('Hi Abel, thanks for the details. I have reset your VPN profile; please try again and let me know. Regards, Beth');
  assert.deepEqual(r, { ok: true, findings: [], summary: { high: 0, medium: 0, low: 0 } });
});

test('secrets and credentials are high severity, with advice and a masked excerpt', () => {
  const secrets = ['password: Summer2024!', 'token ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'key AKIAIOSFODNN7EXAMPLE', 'see https://admin:Pa55w0rd@host.example.com/x', 'Authorization: Bearer abc123def456ghi789jkl012'];
  for (const text of secrets) {
    const r = check(`Hello. ${text}`);
    assert.equal(r.ok, false, text);
    const f = r.findings[0];
    assert.equal(f.severity, 'high', text);
    assert.ok(['SECRET', 'URL_CREDENTIALS'].includes(f.kind));
    assert.ok(f.advice.length > 20);
    assert.ok(f.excerpt.includes('****'));
  }
});

test('findings never carry the value: not as a field, not in the excerpt, not anywhere in the result', () => {
  const text = 'Your login is abel.tuter and password: Summer2024! card 4111 1111 1111 1111 ssn 123-45-6789 mail jane.roe@corp.example.org key AKIAIOSFODNN7EXAMPLE';
  const r = check(text);
  const dump = JSON.stringify(r);
  for (const secret of ['Summer2024!', '4111 1111 1111 1111', '123-45-6789', 'jane.roe', 'AKIAIOSFODNN7EXAMPLE', 'Pa55w0rd']) assert.ok(!dump.includes(secret), `${secret} leaked`);
  for (const f of r.findings) {
    assert.deepEqual(Object.keys(f).sort(), ['advice', 'end', 'excerpt', 'kind', 'severity', 'start']);
    assert.ok(Number.isInteger(f.start) && f.end > f.start);
  }
});

test('severity by kind', () => {
  const severities = (text) => Object.fromEntries(check(text).findings.map((f) => [f.kind, f.severity]));
  assert.deepEqual(severities('card 4111 1111 1111 1111'), { CARD: 'high' });
  assert.deepEqual(severities('IBAN GB82 WEST 1234 5698 7654 32'), { IBAN: 'high' });
  assert.deepEqual(severities('SSN 123-45-6789'), { NATIONAL_ID: 'high' });
  assert.deepEqual(severities('born on 5 June 1990'), { DOB: 'medium' });
  assert.deepEqual(severities('DOB: 14/03/1985'), { DOB: 'medium' });
  assert.deepEqual(severities('call +44 20 7946 0958'), { PHONE: 'medium' });
  assert.deepEqual(severities('lives at 221B Baker Street'), { ADDRESS: 'medium' });
  assert.deepEqual(severities('Employee ID: E123456'), { EMPLOYEE_ID: 'medium' });
  assert.deepEqual(severities('server 203.0.113.45'), { IP: 'low' });
  assert.deepEqual(severities('nic 00:1A:2B:3C:4D:5E'), { MAC: 'low' });
});

test('ok is true only when there is nothing at all to look at', () => {
  assert.equal(check('your server 203.0.113.45 was patched').ok, false, 'even a low finding means "have a look"');
  assert.deepEqual(check('your server 203.0.113.45 was patched').summary, { high: 0, medium: 0, low: 1 });
  assert.deepEqual(check('password: Summer2024! and server 203.0.113.45 and call 020 7946 0958').summary, { high: 1, medium: 1, low: 1 });
});

test('regions are passed through to the detectors', () => {
  assert.equal(check('NI AB123456C', { regions: ['US'] }).ok, true);
  assert.equal(check('NI AB123456C', { regions: ['UK'] }).ok, false);
});

// ---- other people's data -------------------------------------------------------------------------------------------

test('the record people\'s own emails are fine; any other address is flagged', () => {
  assert.equal(check('Writing to abel.tuter@example.com and ABEL.TUTER@EXAMPLE.COM, cc beth.anglin@example.com').ok, true);
  const r = check('Please also write to jane.roe@corp.example.org');
  assert.deepEqual(kinds(r), ['EMAIL']);
  assert.equal(r.findings[0].severity, 'medium');
  assert.equal(r.findings[0].excerpt, 'ja****@corp.example.org');
  assert.match(r.findings[0].advice, /not one of the people on this ticket/);
  // with nobody known, every address is "someone else's"
  assert.deepEqual(kinds(checkOutgoing('write to abel.tuter@example.com')), ['EMAIL']);
});

test('a name introduced by a cue word is flagged unless it is a person on the record', () => {
  const r = check('Your colleague John Smith also reported this, as did customer Maria Garcia Lopez.');
  assert.deepEqual(kinds(r), ['OTHER_PERSON', 'OTHER_PERSON']);
  assert.ok(r.findings.every((f) => f.severity === 'low'));
  assert.deepEqual(r.findings.map((f) => f.excerpt), ['J**** S****', 'M**** Ga**** L****']);
  assert.equal(check('Your colleague Abel Tuter and manager Beth Anglin agree.').ok, true, 'known people are fine');
  assert.equal(check('Escalated by Service Desk to the Network Team.').findings.some((f) => f.kind === 'OTHER_PERSON'), false, 'a team is not a person');
  assert.equal(check('Reported by the user yesterday.').ok, true);
});

test('names cannot be found without a cue: a documented limit', () => {
  assert.equal(check('John Smith from finance also has this problem.').ok, true);
});

// ---- internal wording ---------------------------------------------------------------------------------------------

test('the default internal phrases are flagged, case and spacing aside', () => {
  assert.equal(DEFAULT_INTERNAL_PHRASES.length, 7);
  for (const phrase of DEFAULT_INTERNAL_PHRASES) {
    for (const text of [`Note: ${phrase}.`, `NOTE: ${phrase.toUpperCase()}`, `note ${phrase.replace(/ /g, '   ')} end`]) {
      const r = check(text);
      assert.ok(kinds(r).includes('INTERNAL_PHRASE'), `${phrase} in "${text}"`);
    }
  }
  const sev = (phrase) => check(`x ${phrase} y`).findings.find((f) => f.kind === 'INTERNAL_PHRASE').severity;
  assert.equal(sev('internal only'), 'medium');
  assert.equal(sev('do not share'), 'medium');
  assert.equal(sev('work note'), 'medium');
  assert.equal(sev('workaround for admins'), 'medium');
  assert.equal(sev('escalated to'), 'low');
  assert.equal(sev('root password'), 'high');
  assert.equal(sev('vpn token'), 'high');
});

test('phrases need word boundaries and report where they are', () => {
  assert.equal(check('The networkings note is fine, and this is networknote only').ok, true);
  const text = 'Hello. This is INTERNAL ONLY info.';
  const f = check(text).findings[0];
  assert.equal(text.slice(f.start, f.end), 'INTERNAL ONLY');
  assert.equal(f.excerpt, 'INTERNAL ONLY');
});

test('the phrase list is configurable', () => {
  assert.equal(check('internal only', { internalPhrases: [] }).ok, true, 'an empty list turns phrases off');
  const r = check('Please do not forward this; the codeword is plum', { internalPhrases: ['do not forward', { phrase: 'codeword', severity: 'high' }, '', null, 42] });
  assert.deepEqual(r.findings.map((f) => [f.excerpt, f.severity]), [['do not forward', 'medium'], ['codeword', 'high']]);
  assert.equal(check('internal only', { internalPhrases: ['something else'] }).ok, true, 'the defaults are replaced, not added to');
  const regexy = check('a (b) c', { internalPhrases: ['(b)', '.*'] });
  assert.equal(regexy.findings.length, 1, 'phrases are literal text, never patterns');
});

test('findings come back in text order and phrases can sit next to secrets', () => {
  const r = check('The root password: Winter2025! is internal only');
  assert.deepEqual(r.findings.map((f) => f.kind), ['INTERNAL_PHRASE', 'SECRET', 'INTERNAL_PHRASE']);
  for (let i = 1; i < r.findings.length; i++) assert.ok(r.findings[i].start >= r.findings[i - 1].start);
  assert.deepEqual(r.summary, { high: 2, medium: 1, low: 0 });
});

// ---- odd input and speed --------------------------------------------------------------------------------------------

test('odd input is handled', () => {
  for (const v of [undefined, null, 42, {}, '']) assert.deepEqual(checkOutgoing(v), { ok: true, findings: [], summary: { high: 0, medium: 0, low: 0 } });
  assert.equal(checkOutgoing('fine', { people: 'nope', internalPhrases: 'nope' }).ok, true);
  assert.equal(checkOutgoing('fine', { people: [null, 1, {}] }).ok, true);
});

test('200k characters are checked quickly', () => {
  const text = 'Hello, your colleague John Smith had the same problem. Contact support@vendor.com. internal only. '.repeat(2100).slice(0, 200000);
  // CPU time, warm, best of three (tests/fixtures/timing.js): the clock also counts the time other test processes had the CPU.
  const { ms, value: r } = cpuTime(() => check(text), 1500);
  assert.ok(r.findings.length > 1000);
  assert.ok(ms < 1500, `${Math.round(ms)} ms of CPU`);
  const { ms: hostileMs } = cpuTime(() => {
    check('a@'.repeat(100000));
    check('colleague '.repeat(20000));
    check('Colleague A'.repeat(20000));
  }, 1500);
  assert.ok(hostileMs < 1500, `hostile input: ${Math.round(hostileMs)} ms of CPU`);
});
