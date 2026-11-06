import test from 'node:test';
import assert from 'node:assert/strict';
import { instanceFetch, queryTable, readJson, READ_TIMEOUT_CODE, readTimeoutError } from '../src/content/tableApi.js';
import { READ_CODE, READ_REASON, READ_TEXT, STATUS, classifyReadError, deniedReason, readFailureText, readReasonOf, softRead } from '../src/context/access.js';
import { createInsightStore } from '../src/insights/cache.js';
import { accessDeniedError } from './fixtures/sn-fakeDeps.js';

// Round 4, Phase 0 (docs/round4.md, agent B): when the instance refuses or limits a read, the read layer says WHY (a `reason` on the
// error, a code that survives the trip to the panel) and one helper turns it into a clear sentence. No network: every answer is a fake
// Response handed to readJson, or a fake fetch.

const WHAT = 'Table API query on "task_sla"';

/** A Response as fetch() gives it, enough for readJson and instanceFetch. */
function answer(status, body = '', { headers = {}, redirected = false, url = 'https://acme.service-now.com/api/now/table/task_sla' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
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

// ---- 403: an access rule, or the organisation's restriction of this kind of read ---------------------------------------------------

test('deniedReason: ACL wording is an ACL, access-policy wording is the organisation, a 403 that says neither is an ACL', () => {
  for (const text of [
    'Insufficient rights to query records - Field(s) present in the query do not have permission to be read',
    'Operation Failed - ACL Exception Read Failed due to security constraints',
    'User Not Authorized - Not permitted to read table: sys_audit',
    'No read access to this record',
    '',
    'Forbidden',
  ]) assert.equal(deniedReason(text), READ_REASON.ACL, text);
  for (const text of [
    'User Not Authorized',
    'User Not Authorized - Access to this API is restricted by a REST API access policy',
    'Request denied by API Access Policy "Table API for agents"',
    'Requires role snc_platform_rest_api_access',
    'Web service access is not allowed for table sys_audit',
  ]) assert.equal(deniedReason(text), READ_REASON.POLICY, text);
});

test('a 403 from an access rule: ACCESS_DENIED, reason "acl", ServiceNow\'s words kept in the message (as before)', async () => {
  const err = await failureOf(answer(403, snError('Insufficient rights to query records', 'Field(s) present in the query do not have permission to be read')));
  assert.equal(err.code, 'ACCESS_DENIED');
  assert.equal(err.reason, READ_REASON.ACL);
  assert.equal(err.status, 403);
  assert.match(err.message, /^Your user is not allowed to read this \(403\): Insufficient rights/);
  const bare = await failureOf(answer(403, ''));
  assert.equal(bare.reason, READ_REASON.ACL, 'a 403 with no body is an access rule');
  const html = await failureOf(answer(403, '<html><body>Forbidden</body></html>'));
  assert.equal(html.code, 'ACCESS_DENIED', 'a 403 page is still a refusal, never "not data"');
});

test('a 403 from a REST API access policy or "User Not Authorized": ACCESS_DENIED, reason "policy", the fixed sentence', async () => {
  for (const body of [snError('User Not Authorized'), snError('User Not Authorized', 'Access denied by REST API access policy'), { error: 'API access policy denied the request' }]) {
    const err = await failureOf(answer(403, body));
    assert.equal(err.code, 'ACCESS_DENIED', JSON.stringify(body));
    assert.equal(err.reason, READ_REASON.POLICY, JSON.stringify(body));
    assert.equal(err.message, READ_TEXT.policy);
    assert.ok(!/403|User Not Authorized/.test(err.message), 'no status number and no API wording for the person');
  }
});

// ---- 429, 503, pages, missing tables ------------------------------------------------------------------------------------------

test('429 (after the retries): SN_RATE_LIMITED, "ServiceNow is limiting requests; try again in a minute"', async () => {
  const err = await failureOf(answer(429, snError('Too many requests'), { headers: { 'Retry-After': '30' } }));
  assert.equal(err.code, READ_CODE.RATE_LIMITED);
  assert.equal(err.reason, READ_REASON.RATE_LIMITED);
  assert.equal(err.message, 'ServiceNow is limiting requests. Try again in a minute.');
});

test('503, 502, 504: SN_UNAVAILABLE, busy or under maintenance', async () => {
  for (const status of [503, 502, 504]) {
    const err = await failureOf(answer(status, '<html><title>Down for maintenance</title></html>'));
    assert.equal(err.code, READ_CODE.UNAVAILABLE, String(status));
    assert.equal(err.reason, READ_REASON.UNAVAILABLE, String(status));
    assert.equal(err.message, READ_TEXT.unavailable);
  }
});

test('a page instead of JSON (SSO step, maintenance, a proxy): SN_NOT_DATA, "sign in again, or under maintenance"', async () => {
  for (const response of [
    answer(200, '<!DOCTYPE html><html><head><title>Scheduled maintenance</title></head><body>Back soon</body></html>'),
    answer(200, '<html><body><form action="https://idp.example.com/sso/saml">Continue</form></body></html>'),
    answer(200, 'not json at all'),
    answer(500, '<html><body>Internal error</body></html>'),
  ]) {
    const err = await failureOf(response);
    assert.equal(err.code, READ_CODE.NOT_DATA);
    assert.equal(err.reason, READ_REASON.NOT_DATA);
    assert.equal(err.message, 'ServiceNow answered with a page instead of data: sign in again, or the instance may be under maintenance.');
  }
});

test('a login page, a login redirect or a 401 is still the lost session (SESSION_EXPIRED, reason "session")', async () => {
  for (const response of [
    answer(401, snError('User Not Authenticated', 'Required to provide Auth information')),
    answer(200, '<html><head><title>Log in | ServiceNow</title></head><form action="login.do"><input name="user_password"></form></html>'),
    answer(200, '<html></html>', { redirected: true, url: 'https://acme.service-now.com/login_redirect.do' }),
    answer(200, '{}', { headers: { 'X-Is-Logged-In': 'false' } }),
  ]) {
    const err = await failureOf(response);
    assert.equal(err.code, 'SESSION_EXPIRED');
    assert.equal(err.reason, READ_REASON.SESSION);
    assert.equal(err.message, READ_TEXT.session);
  }
});

test('400 for a table or a column this instance does not have, and 404: reason "missing", ServiceNow\'s words kept', async () => {
  const table = await failureOf(answer(400, snError('Invalid table sn_customerservice_case')));
  assert.equal(table.reason, READ_REASON.MISSING);
  assert.equal(table.code, undefined);
  assert.match(table.message, /failed \(400\): Invalid table sn_customerservice_case/);
  const column = await failureOf(answer(400, snError('Invalid group by field: u_region')));
  assert.equal(column.reason, READ_REASON.MISSING);
  const gone = await failureOf(answer(404, ''));
  assert.equal(gone.reason, READ_REASON.MISSING);
  const query = await failureOf(answer(400, snError('Invalid query')));
  assert.equal(query.reason, READ_REASON.ERROR, 'a bad request of another kind is an error, not "missing"');
  const boom = await failureOf(answer(500, snError('java.lang.NullPointerException')));
  assert.equal(boom.reason, READ_REASON.ERROR);
  assert.match(boom.message, /failed \(500\): java\.lang\.NullPointerException/);
});

test('a time-out carries its reason too', () => {
  const err = readTimeoutError();
  assert.equal(err.code, READ_TIMEOUT_CODE);
  assert.equal(err.reason, READ_REASON.TIMEOUT);
});

// ---- Retries: 429 and 503 only, never a 403 ----------------------------------------------------------------------------------

test('instanceFetch retries a 429 twice and then answers with it; a 403 is never retried; nothing but GET', async () => {
  const sent = [];
  const queue = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), method: init.method });
    return queue.shift();
  };
  queue.push(answer(429, '', { headers: { 'Retry-After': '0' } }), answer(429, '', { headers: { 'Retry-After': '0' } }), answer(429, '', { headers: { 'Retry-After': '0' } }));
  const limited = await instanceFetch('/api/now/table/task_sla');
  assert.equal(limited.status, 429);
  assert.equal(sent.length, 3, 'the first try and two retries');
  assert.equal((await failureOf(limited)).code, READ_CODE.RATE_LIMITED);

  sent.length = 0;
  queue.push(answer(403, snError('User Not Authorized')), answer(200, { result: [] }));
  const denied = await instanceFetch('/api/now/table/task_sla');
  assert.equal(denied.status, 403);
  assert.equal(sent.length, 1, 'a refusal is not asked again');
  assert.ok(sent.every((s) => s.method === 'GET'));
});

// ---- From the error to the entry, and across the message boundary -------------------------------------------------------------

test('classifyReadError: each reason becomes the right status, a fixed note and the reason', async () => {
  const of = async (response) => classifyReadError(await failureOf(response), 'task_sla');
  assert.deepEqual(await of(answer(403, snError('User Not Authorized'))), { status: STATUS.DENIED, note: READ_TEXT.policy, reason: READ_REASON.POLICY });
  assert.deepEqual(await of(answer(403, snError('Insufficient rights to query records'))), { status: STATUS.DENIED, note: 'Your user cannot read task_sla.', reason: READ_REASON.ACL });
  assert.deepEqual(await of(answer(429, '')), { status: STATUS.ERROR, note: READ_TEXT.rateLimited, reason: READ_REASON.RATE_LIMITED });
  assert.deepEqual(await of(answer(503, '')), { status: STATUS.ERROR, note: READ_TEXT.unavailable, reason: READ_REASON.UNAVAILABLE });
  assert.deepEqual(await of(answer(200, '<html></html>')), { status: STATUS.ERROR, note: READ_TEXT.notData, reason: READ_REASON.NOT_DATA });
  assert.deepEqual(await of(answer(400, snError('Invalid table task_sla'))), { status: STATUS.SKIPPED, note: 'task_sla is not on this instance.', reason: READ_REASON.MISSING });
  const column = await of(answer(400, snError('Invalid group by field: u_region')));
  assert.equal(column.status, STATUS.SKIPPED, 'a missing column is left out quietly as well');
  assert.deepEqual(classifyReadError(readTimeoutError(), 'task_sla'), { status: STATUS.ERROR, note: READ_TEXT.timeout, reason: READ_REASON.TIMEOUT });
  // An error that does not say why (a test fake, an older path) is classified as before, with no reason added.
  assert.deepEqual(classifyReadError(accessDeniedError('task_sla'), 'task_sla'), { status: 'denied', note: 'Your user cannot read task_sla.' });
});

test('softRead turns a refusal into a failure with its reason and throws nothing but a lost session or a cancel', async () => {
  const limited = await softRead({ queryTable: async () => { throw await failureOf(answer(429, '')); } }, 'task_sla', '', ['sys_id']);
  assert.deepEqual(limited.rows, []);
  assert.equal(limited.failure.reason, READ_REASON.RATE_LIMITED);
  await assert.rejects(softRead({ queryTable: async () => { throw await failureOf(answer(401, '')); } }, 'task_sla', '', []), (err) => err.code === 'SESSION_EXPIRED');
});

test('readReasonOf finds the reason again from what reaches the panel: { message, code } only, or an entry of status and note', async () => {
  const wire = async (response) => {
    const err = await failureOf(response);
    // src/lib/messages.js toWireError: only the message and the code cross; ask.js makes a new Error of them.
    return Object.assign(new Error(err.message), { code: err.code || '' });
  };
  assert.equal(readReasonOf(await wire(answer(403, snError('User Not Authorized')))), READ_REASON.POLICY);
  assert.equal(readReasonOf(await wire(answer(403, snError('Insufficient rights to query records')))), READ_REASON.ACL);
  assert.equal(readReasonOf(await wire(answer(429, ''))), READ_REASON.RATE_LIMITED);
  assert.equal(readReasonOf(await wire(answer(503, ''))), READ_REASON.UNAVAILABLE);
  assert.equal(readReasonOf(await wire(answer(200, '<html></html>'))), READ_REASON.NOT_DATA);
  assert.equal(readReasonOf(await wire(answer(401, ''))), READ_REASON.SESSION);
  assert.equal(readReasonOf(Object.assign(new Error('x'), { code: 'NOT_FOUND' })), READ_REASON.NOT_FOUND);
  assert.equal(readReasonOf(Object.assign(new Error('x'), { code: 'BLOCKED_TABLE' })), READ_REASON.BLOCKED);
  assert.equal(readReasonOf(new Error('Table API query on "x" failed (500)')), READ_REASON.ERROR);
  // Entries built the usual way, accessEntry(source, failure.status, failure.note): the note says it.
  const entryOf = async (response) => {
    const f = classifyReadError(await failureOf(response), 'task_sla');
    return { source: 'task_sla', status: f.status, note: f.note };
  };
  assert.equal(readReasonOf(await entryOf(answer(403, snError('User Not Authorized')))), READ_REASON.POLICY);
  assert.equal(readReasonOf(await entryOf(answer(429, ''))), READ_REASON.RATE_LIMITED);
  assert.equal(readReasonOf(await entryOf(answer(200, '<html></html>'))), READ_REASON.NOT_DATA);
  assert.equal(readReasonOf({ source: 'task_sla', status: 'denied', note: 'Your user cannot read task_sla.' }), READ_REASON.ACL);
  assert.equal(readReasonOf({ source: 'x', status: 'skipped', note: 'x is not on this instance.' }), READ_REASON.MISSING);
  // A whole read of a table this instance does not have: ServiceNow's words cross with the message.
  assert.equal(readReasonOf(await wire(answer(400, snError('Invalid table sn_customerservice_case')))), READ_REASON.MISSING);
  assert.equal(readReasonOf(await wire(answer(400, snError('Invalid group by field: u_region')))), READ_REASON.MISSING);
  assert.equal(readReasonOf(await wire(answer(400, snError('Invalid query')))), READ_REASON.ERROR);
  for (const quiet of [{ status: 'ok' }, { status: 'empty' }, { status: 'skipped', note: 'Not needed.' }, null, undefined, '']) assert.equal(readReasonOf(quiet), '', JSON.stringify(quiet));
});

test('readFailureText: one plain sentence per reason; \'\' when the caller\'s own words are better', () => {
  const said = (failure, thing) => readFailureText(failure, { thing });
  assert.equal(said({ code: 'ACCESS_DENIED', message: 'Your user is not allowed to read this (403).' }, 'Earlier tickets'), 'Earlier tickets: not available to you with your role.');
  assert.equal(said({ code: 'ACCESS_DENIED', message: READ_TEXT.policy }, 'SLAs'), 'SLAs: your organisation blocks this kind of read for your role. Ask your ServiceNow admin.');
  assert.equal(said({ code: READ_CODE.RATE_LIMITED }), 'ServiceNow is limiting requests. Try again in a minute.');
  assert.equal(said({ code: READ_CODE.UNAVAILABLE }), 'ServiceNow is busy or under maintenance. Try again in a few minutes.');
  assert.equal(said({ code: READ_CODE.NOT_DATA }), 'ServiceNow answered with a page instead of data: sign in again, or the instance may be under maintenance.');
  assert.equal(said({ code: 'SN_TIMEOUT' }), 'ServiceNow did not answer in time. Try again in a moment.');
  assert.equal(said({ code: 'SESSION_EXPIRED' }), READ_TEXT.session);
  assert.equal(said({ reason: 'missing' }, 'Chats'), 'Chats: not on this ServiceNow instance.');
  assert.equal(said({ code: 'NOT_FOUND' }, 'This ticket'), 'This ticket: not available to you.');
  assert.equal(said({ code: 'BLOCKED_TABLE' }, 'SLAs'), 'SLAs: your organisation does not let Agent Buddy read this.');
  assert.equal(said({ code: 'ACCESS_DENIED' }), 'This: not available to you with your role.', 'no thing named: "This"');
  assert.equal(said(new Error('boom')), '');
  assert.equal(said({ status: 'ok' }), '');
  // The panel's own t() is used when it is given (the Arabic is tested with the cards).
  assert.equal(readFailureText({ code: READ_CODE.RATE_LIMITED }, { translate: (text) => `[${text}]` }), `[${READ_TEXT.rateLimited}]`);
});

// ---- The session token, and nothing kept from a failed read --------------------------------------------------------------------

function fakePage() {
  const page = { token: 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const listeners = [];
  globalThis.document = {
    querySelector: () => null,
    scripts: [],
    getElementById: () => null,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    dispatchEvent: (event) => {
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result: page.token } }));
      return true;
    },
  };
  globalThis.window = { frames: {} };
  return page;
}

test('the session token is dropped after a 401 and after a page instead of data, and kept after a 403, a 429 or a 503', async () => {
  const page = fakePage();
  const sent = [];
  let next = () => answer(200, { result: [] });
  globalThis.fetch = async (url, init) => {
    sent.push(init.headers['X-UserToken']);
    return next();
  };
  const read = () => queryTable('incident', 'active=true', ['number']).then(() => 'ok', (err) => err.code || err.reason);
  const step = async (response) => {
    next = () => response;
    const outcome = await read();
    page.token = `token${String(sent.length).padStart(26, 'X')}`; // the page has a new token from now on (as after a new sign-in)
    return outcome;
  };
  assert.equal(await step(answer(200, { result: [] })), 'ok');
  const kept = sent.at(-1);
  // A refusal or a limit says nothing about the session: the kept token is sent again.
  assert.equal(await step(answer(403, snError('User Not Authorized'))), 'ACCESS_DENIED');
  assert.equal(await step(answer(429, '', { headers: { 'Retry-After': '0' } })), READ_CODE.RATE_LIMITED);
  assert.equal(await step(answer(503, '', { headers: { 'Retry-After': '0' } })), READ_CODE.UNAVAILABLE);
  assert.ok(sent.every((token) => token === kept), 'the same token every time');
  // A 401 drops it: the next read takes the page's new one.
  assert.equal(await step(answer(401, '')), 'SESSION_EXPIRED');
  const before401 = page.token;
  assert.equal(await step(answer(200, { result: [] })), 'ok');
  assert.notEqual(sent.at(-1), kept);
  assert.equal(sent.at(-1), before401);
  // A page instead of data drops it too (it may have been a sign-in page the checks did not recognise).
  const beforePage = sent.at(-1);
  assert.equal(await step(answer(200, '<html><body>Maintenance</body></html>')), READ_CODE.NOT_DATA);
  const fresh = page.token;
  assert.equal(await step(answer(200, { result: [] })), 'ok');
  assert.notEqual(sent.at(-1), beforePage);
  assert.equal(sent.at(-1), fresh);
});

test('a failed read never comes back as an empty answer, and the panel\'s store keeps no failure as a fresh answer', async () => {
  // readJson throws for every refusal: there is no null or [] a caller could keep as "nothing there".
  for (const response of [answer(403, ''), answer(429, ''), answer(503, ''), answer(200, '<html></html>'), answer(401, '')]) {
    await assert.rejects(readJson(response, WHAT));
  }
  // The Insights cards' shared reads (src/insights/cache.js): a refused read is not reused; the next look reads again.
  let clock = 0;
  const store = createInsightStore({ now: () => clock });
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error(READ_TEXT.rateLimited), { code: READ_CODE.RATE_LIMITED });
    return { items: ['ok'] };
  };
  await assert.rejects(store.get('k', load, { maxAgeMs: 60000 }), (err) => err.code === READ_CODE.RATE_LIMITED);
  assert.equal(store.peek('k').error.code, READ_CODE.RATE_LIMITED);
  assert.equal(store.peek('k').value, undefined, 'no value was made up from the failure');
  clock = 1;
  assert.deepEqual(await store.get('k', load, { maxAgeMs: 60000 }), { items: ['ok'] });
  assert.equal(calls, 2, 'read again, although the failure was a second old');
});
