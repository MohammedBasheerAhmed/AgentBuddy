import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, serviceNowErrorText } from '../src/content/tableApi.js';
import { NOTE_TEXT, READ_REASON, READ_TEXT, STATUS, classifyReadError, deniedReason, readFailureText, readReasonOf } from '../src/context/access.js';

// Wave 4, live checks of 2026-11-07 (docs/live-checks-2026-11-07.md): what the real instance answers when a role may not read.
// The strings below are the ones measured on dev364920, as an administrator, as ITIL User (role itil only) and as Abel Tuter (no role).

const LIVE_TABLE_REFUSAL = { error: { message: 'User Not Authorized', detail: 'User is unauthorized to access table: sys_documentation' }, status: 'failure' };
const LIVE_COLUMN_REFUSAL = { error: { message: 'Insufficient rights to query records', detail: 'Field(s) present in the query do not have permission to be read' }, status: 'failure' };

const answer = (status, body = '', { headers = {} } = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, redirected: false, url: 'https://dev364920.service-now.com/api/now/table/sys_documentation', headers: { get: (name) => lower[String(name).toLowerCase()] ?? null }, text: async () => text };
};
const failureOf = async (response) => {
  try {
    await readJson(response, 'Table API query on "sys_documentation"');
  } catch (err) {
    return err;
  }
  throw new Error('readJson did not throw');
};

test('the measured refusal of a table the role may not read is an ordinary role rule (ACL), not a REST API policy', async () => {
  const said = serviceNowErrorText(JSON.stringify(LIVE_TABLE_REFUSAL));
  assert.equal(said, 'User Not Authorized - User is unauthorized to access table: sys_documentation');
  assert.equal(deniedReason(said), READ_REASON.ACL);
  const err = await failureOf(answer(403, LIVE_TABLE_REFUSAL));
  assert.equal(err.code, 'ACCESS_DENIED');
  assert.equal(err.status, 403);
  assert.equal(err.reason, READ_REASON.ACL);
  assert.equal(err.message, NOTE_TEXT.denied);
  assert.equal(err.message, 'Not available to you with your role.');
  assert.match(err.detail, /User is unauthorized to access table: sys_documentation/, 'the technical words stay in detail');
  assert.deepEqual(classifyReadError(err), { status: STATUS.DENIED, note: NOTE_TEXT.denied, reason: READ_REASON.ACL });
  // the way the panel says it: about the role, never "your organisation blocks this"
  const line = readFailureText(err, { thing: 'Field labels' });
  assert.equal(line, 'Field labels: not available to you with your role.');
  assert.doesNotMatch(line, /organisation|restricted/i);
});

test('the measured refusal of a column the role may not read is an ACL too', async () => {
  const said = serviceNowErrorText(JSON.stringify(LIVE_COLUMN_REFUSAL));
  assert.equal(said, 'Insufficient rights to query records - Field(s) present in the query do not have permission to be read');
  assert.equal(deniedReason(said), READ_REASON.ACL);
  const err = await failureOf(answer(403, LIVE_COLUMN_REFUSAL));
  assert.equal(err.reason, READ_REASON.ACL);
  assert.equal(err.message, NOTE_TEXT.denied);
  assert.equal(readReasonOf(err), READ_REASON.ACL);
});

test('a bare "User Not Authorized", with no table after it, is still an ACL: a 403 that says neither is a role rule (build rule 9)', async () => {
  for (const body of [{ error: { message: 'User Not Authorized' } }, { error: { message: 'User Not Authorized', detail: null } }, { error: 'User Not Authorized' }, 'User Not Authorized', '']) {
    const err = await failureOf(answer(403, body));
    assert.equal(err.reason, READ_REASON.ACL, JSON.stringify(body));
    assert.equal(err.message, NOTE_TEXT.denied);
  }
  assert.equal(deniedReason('User Not Authorized'), READ_REASON.ACL);
  assert.equal(deniedReason('user not authorised'), READ_REASON.ACL);
  assert.equal(deniedReason('USER IS UNAUTHORISED TO ACCESS TABLE: sys_audit'), READ_REASON.ACL);
});

test('only words that really name the API make a refusal the organisation\'s: the API-level ACL, an access policy, the REST API, web services, the REST role', async () => {
  for (const text of [
    'User Not Authorized - Failed API level ACL Validation',
    'Failed API-level ACL validation',
    'Request denied by API Access Policy "Table API for agents"',
    'User Not Authorized - Access to this API is restricted by a REST API access policy',
    'Requires the role snc_platform_rest_api_access',
    'Web service access is not allowed for table sys_audit',
    'REST API is closed to your role',
  ]) assert.equal(deniedReason(text), READ_REASON.POLICY, text);
  const err = await failureOf(answer(403, { error: { message: 'User Not Authorized', detail: 'Failed API level ACL Validation' } }));
  assert.equal(err.reason, READ_REASON.POLICY);
  assert.equal(err.message, READ_TEXT.policy);
  assert.match(readFailureText(err, { thing: 'Field labels' }), /Your organisation has restricted it/);
});

test('wording that names a table or a read right wins over a word that only looks like an API in a table name', () => {
  assert.equal(deniedReason('User Not Authorized - User is unauthorized to access table: rest_api_explorer'), READ_REASON.ACL);
  assert.equal(deniedReason('User Not Authorized - User is unauthorized to access table: sys_web_service'), READ_REASON.ACL);
  assert.equal(deniedReason('Insufficient rights to query records - web service field'), READ_REASON.ACL);
});

test('the 401 rules of wave 1 stay: a bare 401 or a login page is "signed out"; only a live sign-in or policy words make it the organisation\'s', async () => {
  const bare = await failureOf(answer(401, ''));
  assert.equal(bare.code, 'SESSION_EXPIRED');
  assert.equal(bare.reason, READ_REASON.SESSION);
  const notAuthenticated = await failureOf(answer(401, { error: { message: 'User is not authenticated', detail: 'Required to provide Auth information' }, status: 'failure' }));
  assert.equal(notAuthenticated.code, 'SESSION_EXPIRED', 'the live answer to a read without the token: signed out, not a policy');
  const loginPage = await failureOf(answer(200, '<html><form action="login.do"><input name="user_password"></form></html>'));
  assert.equal(loginPage.code, 'SESSION_EXPIRED');
  const loggedIn = await failureOf(answer(401, { error: { message: 'User Not Authorized' } }, { headers: { 'X-Is-Logged-In': 'true' } }));
  assert.equal(loggedIn.code, 'ACCESS_DENIED');
  assert.equal(loggedIn.reason, READ_REASON.POLICY);
  const named = await failureOf(answer(401, { error: { message: 'User Not Authenticated', detail: 'Blocked by REST API access policy' } }));
  assert.equal(named.reason, READ_REASON.POLICY);
});

test('an administrator\'s ordinary refusal reaches the panel as an ACL even after the trip as a message and a code', async () => {
  const err = await failureOf(answer(403, LIVE_TABLE_REFUSAL));
  // src/lib/messages.js toWireError: only the message and the code cross
  const crossed = Object.assign(new Error(err.message), { code: err.code });
  assert.equal(readReasonOf(crossed), READ_REASON.ACL);
  assert.equal(readFailureText(crossed, { thing: 'Earlier tickets' }), 'Earlier tickets: not available to you with your role.');
  const entry = classifyReadError(err);
  assert.equal(readReasonOf({ source: 'sys_documentation', status: entry.status, note: entry.note }), READ_REASON.ACL);
});
