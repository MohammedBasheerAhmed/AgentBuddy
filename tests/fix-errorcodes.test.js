import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TERM_RE, errorCodesOf, extractErrorCodes, isCodeTerm, mentionsCode } from '../src/insights/errorCodes.js';

// Find the fix (round 4): the error codes a ticket quotes. Every kind of code is found where it is written, and nothing that only looks
// like a code (an ordinary number, a phone number, a date, a record number, an address) is taken for one.

const codes = (text, max = 10) => extractErrorCodes(text, { max }).map((c) => c.code);
const terms = (text, max = 10) => extractErrorCodes(text, { max }).map((c) => c.search);

test('hex codes: 0x and exactly eight hex digits, written in capitals; the search is the eight digits', () => {
  assert.deepEqual(extractErrorCodes('Outlook on the phone says error 0x800CCC0F when sending'), [{ code: '0x800CCC0F', search: '800CCC0F', kind: 'hex', where: '' }]);
  assert.deepEqual(codes('0X800ccc0f'), ['0x800CCC0F']);
  assert.deepEqual(codes('BSOD: STOP 0x0000007B (INACCESSIBLE_BOOT_DEVICE)'), ['0x0000007B']);
  assert.deepEqual(codes('(0xC000021A)'), ['0xC000021A']);
  assert.deepEqual(codes('0x800CCC0F1 is too long, 0x800CCC too short, 0x7B is short too'), []);
  assert.deepEqual(codes('a0x800CCC0F glued to a word'), []);
});

test('Windows and installer codes need the words that say so: error, error code, exit code, return code', () => {
  assert.deepEqual(codes('The installer failed with error 1603.'), ['1603']);
  assert.deepEqual(extractErrorCodes('Error code: 80070005 in Windows Update'), [{ code: '80070005', search: '80070005', kind: 'windows', where: '' }]);
  assert.deepEqual(codes('exit code 1603, return code: 1618, err #619, Error no. 720'), ['1603', '1618', '619', '720']);
  assert.deepEqual(codes('error code c0000005 when starting'), ['C0000005']);
  assert.deepEqual(codes('VPN error 809'), ['809']);
  // the same code written twice, or as 0x and without, is one code (named by the more telling form)
  assert.deepEqual(codes('error 1603 again; Error 1603'), ['1603']);
  assert.deepEqual(codes('Error code: 80070005, also shown as 0x80070005'), ['0x80070005']);
});

test('HTTP status codes only with HTTP words or the reason servers write; 4xx and 5xx only', () => {
  assert.deepEqual(extractErrorCodes('The gateway answered HTTP 503'), [{ code: 'HTTP 503', search: '503', kind: 'http', where: '' }]);
  assert.deepEqual(codes('HTTP/1.1 502 Bad Gateway'), ['HTTP 502']);
  assert.deepEqual(codes('500 Internal Server Error on the portal; then 404 Not Found'), ['HTTP 500', 'HTTP 404']);
  assert.deepEqual(codes('a 503 service unavailable page'), ['HTTP 503']);
  assert.deepEqual(codes('HTTP status code: 401 and status code 429'), ['HTTP 401', 'HTTP 429']);
  // "HTTP error 500" is one code, HTTP 500 (not also "error 500")
  assert.deepEqual(extractErrorCodes('HTTP error 500').map((c) => c.kind), ['http']);
  assert.deepEqual(codes('HTTP 200 OK, 301 Moved Permanently, HTTP 302'), [], 'not errors');
  assert.deepEqual(codes('500 not found in stock, 403 forbidden words'), [], 'short reasons count only as servers write them');
});

test('Oracle, SQLSTATE, exception names and Windows event ids', () => {
  assert.deepEqual(extractErrorCodes('ORA-12154: TNS:could not resolve the connect identifier'), [{ code: 'ORA-12154', search: 'ORA-12154', kind: 'oracle', where: '' }]);
  assert.deepEqual(codes('ora-01017 and TNS-12541 and PLS-00201'), ['ORA-01017', 'TNS-12541', 'PLS-00201']);
  assert.deepEqual(codes('SQLSTATE 08001; SQLSTATE[HY000]; SQLSTATE: 08S01'), ['SQLSTATE 08001', 'SQLSTATE HY000', 'SQLSTATE 08S01']);
  assert.deepEqual(codes('SQLSTATE ERROR'), [], 'a SQLSTATE has digits');
  assert.deepEqual(codes('java.lang.NullPointerException at com.acme.Foo(Foo.java:42); caused by java.net.SocketTimeoutException'), ['NullPointerException', 'SocketTimeoutException']);
  assert.deepEqual(codes('System.IO.FileNotFoundException, IOException, TypeError: x is undefined, OutOfMemoryError'), ['FileNotFoundException', 'IOException', 'TypeError', 'OutOfMemoryError']);
  assert.deepEqual(codes('An Error occurred. Exception thrown. AError, XException, ERROR, Terror'), [], 'words, not names');
  assert.deepEqual(extractErrorCodes('Event ID 4625 in the security log'), [{ code: 'Event ID 4625', search: '4625', kind: 'event', where: '' }]);
  assert.deepEqual(codes('EventID: 7036 and event id 41'), ['Event ID 7036', 'Event ID 41']);
});

test('false-positive traps: ordinary numbers, phone numbers, dates and times, record numbers, addresses', () => {
  const none = [
    'Hi, my VPN drops every 10 minutes since Monday. Please call me on +1 555-0134. My employee id is E12345.',
    'It dropped again at 09:50. Same as yesterday. Call me on 555-0199 if easier.',
    'Gateway EU-2 shows 14 session resets. 100 users affected in room 1603 on floor 3.',
    'See INC0010023, KB0000032, RITM0010001, SCTASK0010001, CS0001234 and inc0010023',
    'Opened 2026-10-26 08:20:41, due 26/10/2026, moved 10/26/2026, at 9:50 am, on 26 Oct 2026 and Oct 26, 2026',
    'error 2026-10-26 and error at 10:30 and error 09:50:41',
    'https://support.example.com/errors/0x800CCC0F?code=error%201603 and www.example.com/ORA-12154',
    'mail error0x800ccc0f@contoso.com or error.1603@example.com',
    'Gateway 10.0.0.1 error, error 10.0.0.1, error 192.168.1.20:8080, fe80::1ff:fe23:4567:890a',
    'port 443, version 5.2.1, build 10.0.19045.2364, KB5031356, 3 of 1000 users',
    'Error: 100 users affected, error 500 times, error 12, error 45%, Error 1603 2',
    'error 555-0134, error 555 0134, error +44 20 7946 0958',
    'خطأ في البريد منذ يومين، الرقم 1603',
    '',
  ];
  for (const text of none) assert.deepEqual(codes(text), [], text);
  assert.deepEqual(codes(null), []);
  assert.deepEqual(codes(undefined), []);
  // A code next to the traps is still found.
  assert.deepEqual(codes('Call +1 555-0134. Since 2026-10-26 09:50 Outlook shows 0x800CCC0F (see INC0010023).'), ['0x800CCC0F']);
  assert.deepEqual(codes('خطأ 0x800CCC0F على الهاتف'), ['0x800CCC0F'], 'a hex code needs no English words around it');
});

test('at most three codes by default, in the order they are written', () => {
  const text = 'Event ID 4625, then ORA-12154, then 0x800CCC0F, then HTTP 503';
  assert.deepEqual(extractErrorCodes(text).map((c) => c.code), ['Event ID 4625', 'ORA-12154', '0x800CCC0F']);
  assert.deepEqual(extractErrorCodes(text, { max: 1 }).map((c) => c.code), ['Event ID 4625']);
  assert.deepEqual(extractErrorCodes(text, { max: 0 }), []);
});

test('every search term is safe for an encoded query; a code whose term would not be is not offered', () => {
  const text = 'error 0x800CCC0F, error 1603, HTTP 503, ORA-12154, SQLSTATE[HY000], NullPointerException, Event ID 4625';
  for (const term of terms(text)) assert.match(term, CODE_TERM_RE);
  assert.ok(terms(text).length >= 7);
  const long = `${'Very'.repeat(10)}LongException`;
  assert.deepEqual(codes(long), [], 'a class name longer than 40 characters is not a search term');
  for (const bad of ['', 'a', 'x^ORsys_id!=1', '1603;', 'two words', 'ORA-12154\n', 'javascript:alert(1)', '-dash', '.dot', 'x'.repeat(41), 42, null, ['1603']]) {
    assert.equal(isCodeTerm(bad), false, JSON.stringify(bad));
  }
  for (const good of ['1603', '800CCC0F', 'ORA-12154', 'java.net.SocketTimeoutException', 'HY000', '41', 'x'.repeat(40)]) assert.equal(isCodeTerm(good), true, good);
});

test('errorCodesOf: short description, then description, then the newest notes first; each code once, where it is written first', () => {
  const pack = {
    fields: { short_description: 'Outlook on phone: error 0x800CCC0F', description: 'Since the password change, 0x800CCC0F and then HTTP 503 from the gateway.' },
    journal: [
      { type: 'comment', text: 'old note: ORA-12154' },
      { type: 'comment', text: 'note 2' },
      { type: 'comment', text: 'note 3' },
      { type: 'work_note', text: 'note 4' },
      { type: 'comment', text: 'note 5: Event ID 4625' },
      { type: 'work_note', text: 'newest: exit code 1603' },
    ],
  };
  assert.deepEqual(errorCodesOf(pack), [
    { code: '0x800CCC0F', search: '800CCC0F', kind: 'hex', where: 'short_description' },
    { code: 'HTTP 503', search: '503', kind: 'http', where: 'description' },
    { code: '1603', search: '1603', kind: 'windows', where: 'notes' },
  ]);
  // only the newest five notes are looked at: the oldest (ORA-12154) is not
  assert.deepEqual(errorCodesOf(pack, { max: 10 }).map((c) => c.code), ['0x800CCC0F', 'HTTP 503', '1603', 'Event ID 4625']);
  assert.deepEqual(errorCodesOf(pack, { max: 10, notes: 0 }).map((c) => c.code), ['0x800CCC0F', 'HTTP 503']);
  assert.deepEqual(errorCodesOf({ fields: { description: 'Please call me on +1 555-0134.' }, journal: [{ text: 'dropped at 09:50' }] }), []);
  assert.deepEqual(errorCodesOf(null), []);
  assert.deepEqual(errorCodesOf({ fields: { short_description: 42 }, journal: 'nope' }), []);
});

test('mentionsCode: a short number must be quoted as a code; anything else must be a word of its own', () => {
  assert.equal(mentionsCode('The gateway answered HTTP 503 twice', '503'), true);
  assert.equal(mentionsCode('Meeting in room 503 at noon', '503'), false, 'the characters alone are not a mention');
  assert.equal(mentionsCode('Installer error 1603 again', '1603'), true);
  assert.equal(mentionsCode('Call 555-1603', '1603'), false);
  assert.equal(mentionsCode('Seen as Event ID 4625 in the log', '4625'), true);
  assert.equal(mentionsCode('SQLSTATE 08001 from the driver', '08001'), true);
  assert.equal(mentionsCode('Outlook shows 0x800CCC0F', '800CCC0F'), true, 'an 0x in front is allowed');
  assert.equal(mentionsCode('Outlook shows 800ccc0f', '800CCC0F'), true, 'any case');
  assert.equal(mentionsCode('code A800CCC0F9', '800CCC0F'), false, 'inside a longer word');
  assert.equal(mentionsCode('HRESULT 80070005 seen', '80070005'), true, 'eight digits are specific enough on their own');
  assert.equal(mentionsCode('ora-12154 again', 'ORA-12154'), true);
  assert.equal(mentionsCode('XORA-12154', 'ORA-12154'), false);
  assert.equal(mentionsCode('a NullPointerException was thrown', 'NullPointerException'), true);
  assert.equal(mentionsCode('anything', 'x^ORactive=true'), false, 'a term that is not safe matches nothing');
  assert.equal(mentionsCode('', '1603'), false);
  assert.equal(mentionsCode(null, '1603'), false);
});
