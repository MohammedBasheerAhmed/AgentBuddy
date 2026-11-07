import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, queryTable, serviceNowErrorText } from '../src/content/tableApi.js';
import {
  NOTE_TEXT,
  READ_REASON,
  READ_TEXT,
  STATUS,
  classifyReadError,
  confirmEmptyIsReallyEmpty,
  deniedReason,
  isStandardNote,
  readFailureText,
  readReasonOf,
  reasonSentence,
  softRead,
} from '../src/context/access.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// Audit of 2026-11-07, workstream "notes and errors": what the read layer and the access entries SAY. Every message is a fixed plain
// sentence (one clause and, where there is one, a next step); the technical words (what was read, the HTTP status, ServiceNow's own text)
// stay in `error.detail` and `error.status`, which the logic reads and no view shows. No network: every answer is a fake Response.

const WHAT = 'Table API query on "u_vendor_ticket"';
function answer(status, body = '', { headers = {}, redirected = false, url = 'https://acme.service-now.com/api/now/table/u_vendor_ticket' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, val]) => [k.toLowerCase(), val]));
  return { ok: status >= 200 && status < 300, status, redirected, url, headers: { get: (name) => lower[String(name).toLowerCase()] ?? null }, text: async () => text };
}
const snError = (message, detail = null) => ({ error: { message, detail }, status: 'failure' });
const failureOf = async (response) => {
  try {
    await readJson(response, WHAT);
  } catch (err) {
    return err;
  }
  throw new Error('readJson did not throw');
};
const NOT_FOR_A_PERSON = /\b[1-5]\d\d\b|Table API|your user|u_vendor_ticket|query on|sysparm|ACL/i;

// ---- E1: no read failure puts an HTTP code, "Table API" or a table name in its message ----------------------------------------------------

test('E1: every failed answer has a plain message; the technical words are kept in detail and status', async () => {
  const cases = [
    [answer(403, snError('Insufficient rights to query records')), NOTE_TEXT.denied, 403, 'ACCESS_DENIED'],
    [answer(403, snError('User Not Authorized', 'Access denied by REST API access policy')), READ_TEXT.policy, 403, 'ACCESS_DENIED'],
    [answer(403, snError('User Not Authorized', 'User is unauthorized to access table: u_vendor_ticket')), NOTE_TEXT.denied, 403, 'ACCESS_DENIED'],
    [answer(429, ''), READ_TEXT.rateLimited, 429, 'SN_RATE_LIMITED'],
    [answer(503, ''), READ_TEXT.unavailable, 503, 'SN_UNAVAILABLE'],
    [answer(400, snError('Invalid table u_vendor_ticket')), NOTE_TEXT.missing, 400, undefined],
    [answer(404, ''), NOTE_TEXT.missing, 404, undefined],
    [answer(500, snError('java.lang.NullPointerException at line 4')), NOTE_TEXT.error, 500, undefined],
    [answer(400, snError('Invalid query')), NOTE_TEXT.error, 400, undefined],
    [answer(200, 'not json at all'), READ_TEXT.notData, 200, 'SN_NOT_DATA'],
    [answer(502, '<html>bad gateway</html>'), READ_TEXT.unavailable, 502, 'SN_UNAVAILABLE'],
  ];
  for (const [response, message, status, code] of cases) {
    const err = await failureOf(response);
    assert.equal(err.message, message, `${status}`);
    assert.doesNotMatch(err.message, NOT_FOR_A_PERSON, `${status}: ${err.message}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    assert.match(err.detail, /Table API query on "u_vendor_ticket"/, 'the technical words are still there for whoever debugs it');
  }
  const forbidden = await failureOf(answer(403, snError('Insufficient rights to query records', 'Field(s) present in the query do not have permission to be read')));
  assert.match(forbidden.detail, /failed \(403\): Insufficient rights to query records - Field\(s\) present/);
});

test('E1: a request for something that is not a table or a column is refused with one plain sentence and a code', async () => {
  for (const make of [() => queryTable('a/../b', '', []), () => queryTable('', '', [])]) {
    await assert.rejects(make, (err) => err.code === 'INVALID_READ' && err.message === READ_TEXT.invalid && /valid table/.test(err.detail));
  }
  assert.doesNotMatch(READ_TEXT.invalid, /table|column|filter|valid/i);
});

test('E1: classifyReadError gives a fixed note and a reason, whatever ServiceNow said and whatever table it was about', async () => {
  const of = async (response) => classifyReadError(await failureOf(response));
  assert.deepEqual(await of(answer(403, snError('Insufficient rights to query records'))), { status: STATUS.DENIED, note: NOTE_TEXT.denied, reason: READ_REASON.ACL });
  assert.deepEqual(await of(answer(403, snError('User Not Authorized', 'Access denied by REST API access policy'))), { status: STATUS.DENIED, note: READ_TEXT.policy, reason: READ_REASON.POLICY });
  assert.deepEqual(await of(answer(403, snError('User Not Authorized'))), { status: STATUS.DENIED, note: NOTE_TEXT.denied, reason: READ_REASON.ACL });
  assert.deepEqual(await of(answer(500, snError('Table API query on "u_vendor_ticket" failed (500): security manager denied access'))), { status: STATUS.ERROR, note: NOTE_TEXT.error, reason: READ_REASON.ERROR }, 'a 500 that mentions "denied" is still an error: the layer read the status');
  // older errors, built by hand, say it in words only
  assert.deepEqual(classifyReadError(new Error('Your user is not allowed to read this (403): Access to u_site_visit is denied by ACL.')), { status: 'denied', note: NOTE_TEXT.denied, reason: 'acl' });
  assert.deepEqual(classifyReadError(new Error('Invalid table u_site_visit')), { status: 'skipped', note: NOTE_TEXT.missing, reason: 'missing' });
  assert.deepEqual(classifyReadError(Object.assign(new Error('Your organisation does not allow Agent Buddy to read u_site_visit records.'), { code: 'BLOCKED_TABLE' })), { status: 'blocked', note: NOTE_TEXT.blocked, reason: 'blocked' });
  for (const out of [await of(answer(403, '')), await of(answer(500, '')), classifyReadError(new Error('Table API query on "u_site_visit" failed (500): boom'))]) {
    assert.doesNotMatch(out.note, NOT_FOR_A_PERSON, out.note);
    assert.ok(isStandardNote(out.note), 'the note is one of the standard sentences');
  }
});

test('E1: the notes the engine adds on its own say "you", never "your user", and name no table (a fixed sentence per reason)', async () => {
  const hidden = await confirmEmptyIsReallyEmpty('u_vendor_ticket', fakeDeps({ u_vendor_ticket: [] }));
  assert.equal(hidden.status, STATUS.EMPTY_OR_HIDDEN);
  assert.equal(hidden.note, NOTE_TEXT.hidden);
  for (const note of Object.values(NOTE_TEXT)) assert.doesNotMatch(note, /your user|_|\btable\b|column|instance|filter/i, note);
  for (const note of Object.values(READ_TEXT)) assert.doesNotMatch(note, /your user|_|\btable\b|column|instance|\b[1-5]\d\d\b/i, note);
  const failed = await softRead({ queryTable: async () => { throw new Error('Table API query on "u_vendor_ticket" failed (500): boom'); } }, 'u_vendor_ticket', '', ['sys_id']);
  assert.deepEqual(failed.failure, { status: 'error', note: NOTE_TEXT.error, reason: 'error' });
});

// ---- the words of each reason, with the label of the thing ---------------------------------------------------------------------------

test('readFailureText: one plain sentence per reason, with the thing named; HIDDEN and ERROR have one too', () => {
  const said = (failure, thing) => readFailureText(failure, { thing });
  assert.equal(said({ status: 'denied' }, 'SLAs'), 'SLAs: not available to you with your role.');
  assert.equal(said({ status: 'empty-or-hidden' }, 'SLAs'), 'SLAs: you can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.');
  assert.equal(said({ status: 'error' }, 'SLAs'), 'SLAs: could not be read just now. Try again in a moment.');
  assert.equal(said({ status: 'blocked' }, 'SLAs'), 'SLAs: your organisation does not let Agent Buddy read this.');
  assert.equal(said({ code: 'ACCESS_DENIED', message: READ_TEXT.policy }, 'SLAs'), 'SLAs: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.');
  assert.equal(said({ status: 'ok' }, 'SLAs'), '');
  assert.equal(said({ status: 'skipped', note: 'Not needed.' }, 'SLAs'), '');
  assert.equal(said({ status: 'empty-or-hidden', note: NOTE_TEXT.hidden }, ''), 'This: you can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.');
  for (const reason of Object.values(READ_REASON)) {
    const sentence = reasonSentence(reason);
    if (sentence) assert.doesNotMatch(sentence, NOT_FOR_A_PERSON, reason);
  }
});

// ---- audit 5: a 401 or an API-level ACL that is a policy, not a lost sign-in ---------------------------------------------------------

test('"Failed API level ACL Validation" is the API-level restriction (a policy), not an access rule on the data', () => {
  assert.equal(deniedReason('User Not Authorized - Failed API level ACL Validation'), READ_REASON.POLICY);
  assert.equal(deniedReason('Failed API-level ACL validation'), READ_REASON.POLICY);
  assert.equal(deniedReason('Insufficient rights to query records'), READ_REASON.ACL, 'a table ACL is still an ACL');
  assert.equal(deniedReason('Operation Failed - ACL Exception Read Failed due to security constraints'), READ_REASON.ACL);
});

test('a 403 "Failed API level ACL Validation" is told as the organisation\'s restriction, with the admin as the next step', async () => {
  const err = await failureOf(answer(403, snError('User Not Authorized', 'Failed API level ACL Validation')));
  assert.equal(err.reason, READ_REASON.POLICY);
  assert.equal(err.message, READ_TEXT.policy);
  assert.equal(err.code, 'ACCESS_DENIED');
  assert.match(err.message, /Ask your ServiceNow admin/);
});

test('a 401 is a lost sign-in unless the answer shows the sign-in is fine: X-Is-Logged-In true, or a policy named in words', async () => {
  // a lost sign-in: no header, header false, a login page, a redirect to the login screen
  for (const response of [
    answer(401, snError('User Not Authenticated', 'Required to provide Auth information')),
    answer(401, snError('User Not Authenticated'), { headers: { 'X-Is-Logged-In': 'false' } }),
    answer(401, ''),
    answer(200, '<html><head><title>Log in | ServiceNow</title></head><form action="login.do"><input name="user_password"></form></html>'),
    answer(200, '<html></html>', { redirected: true, url: 'https://acme.service-now.com/login_redirect.do' }),
  ]) {
    const err = await failureOf(response);
    assert.equal(err.code, 'SESSION_EXPIRED');
    assert.equal(err.reason, READ_REASON.SESSION);
    assert.equal(err.message, READ_TEXT.session);
  }
  // a policy: the person is signed in, and ServiceNow still refuses
  for (const response of [
    answer(401, snError('User Not Authenticated'), { headers: { 'X-Is-Logged-In': 'true' } }),
    answer(401, snError('Access denied by REST API access policy "Agents"')),
    answer(401, snError('User Not Authorized', 'Failed API level ACL Validation')),
  ]) {
    const err = await failureOf(response);
    assert.equal(err.code, 'ACCESS_DENIED', JSON.stringify(response.headers));
    assert.equal(err.reason, READ_REASON.POLICY);
    assert.equal(err.message, READ_TEXT.policy);
    assert.equal(err.status, 401);
    assert.doesNotMatch(err.message, /signed out|sign in/i, 'a policy is not "sign in again"');
  }
});

// ---- J16: one wording for a lost sign-in ----------------------------------------------------------------------------------------------

test('J16: a lost sign-in has one sentence: "Sign in" (never "log in"), "signed out" (never "session expired")', async () => {
  assert.equal(READ_TEXT.session, 'You are signed out of ServiceNow. Sign in again, then try again.');
  assert.doesNotMatch(READ_TEXT.session, /log in|session|expired/i);
  const lost = await failureOf(answer(401, ''));
  assert.equal(lost.message, READ_TEXT.session);
  assert.equal(reasonSentence(READ_REASON.SESSION), READ_TEXT.session);
  assert.equal(readReasonOf({ code: 'SESSION_EXPIRED' }), READ_REASON.SESSION);
  assert.equal(readFailureText({ code: 'SESSION_EXPIRED' }), READ_TEXT.session);
  // the page that answered with something that is not data: the same two words for the next step
  assert.match(READ_TEXT.notData, /Sign in again/);
  assert.doesNotMatch(READ_TEXT.notData, /instance|page instead of data/i);
});

test('serviceNowErrorText still reads ServiceNow\'s own explanation (for the detail, never for a person)', () => {
  assert.equal(serviceNowErrorText(JSON.stringify(snError('Insufficient rights', 'Field x'))), 'Insufficient rights - Field x');
  assert.equal(serviceNowErrorText('<html></html>'), '');
});

test('rows still come back untouched when nothing fails', async () => {
  const rows = { u_vendor_ticket: [{ sys_id: v('a') }] };
  const read = await softRead(fakeDeps(rows), 'u_vendor_ticket', '', ['sys_id'], { limit: 5 });
  assert.equal(read.rows.length, 1);
  assert.equal(read.failure, null);
});
