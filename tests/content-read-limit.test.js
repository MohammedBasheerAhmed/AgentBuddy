import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_TIMEOUT_MS, READ_TIMEOUT_CODE, queryTable, withReadLimit } from '../src/content/tableApi.js';
import { classifyReadError, isMissingTable, softRead, STATUS } from '../src/context/access.js';

// F4: every read from ServiceNow has a time limit with a plain reason, a session token is dropped when the session ended, and a table
// that is not on the instance is left out quietly. The clock is run by the test (no waiting).

function fakeClock() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length;
    },
    clearTimer: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    fire: () => timers.filter((t) => !t.cleared).forEach((t) => t.fn()),
  };
}

test('a read that does not answer stops after about 20 seconds with a named reason, and the request itself is aborted', async () => {
  assert.equal(READ_TIMEOUT_MS, 20000);
  const clock = fakeClock();
  let given = null;
  const pending = withReadLimit(
    (signal) => {
      given = signal;
      return new Promise(() => {}); // ServiceNow never answers
    },
    { setTimer: clock.setTimer, clearTimer: clock.clearTimer }
  );
  await Promise.resolve();
  assert.equal(clock.timers[0].ms, 20000);
  assert.equal(given.aborted, false);
  clock.fire();
  await assert.rejects(pending, (err) => err.code === READ_TIMEOUT_CODE && /^ServiceNow did not answer within 20 seconds\. It may be busy: try again in a moment\.$/.test(err.message));
  assert.equal(given.aborted, true, 'a read with no signal of its own is really stopped');
});

test('a read that answers in time returns its answer and stops the clock; the caller\'s own signal reaches the read unchanged', async () => {
  const clock = fakeClock();
  const own = new AbortController();
  let given = null;
  const answer = await withReadLimit(
    async (signal) => {
      given = signal;
      return { result: [1] };
    },
    { signal: own.signal, setTimer: clock.setTimer, clearTimer: clock.clearTimer }
  );
  assert.deepEqual(answer, { result: [1] });
  assert.equal(given, own.signal);
  assert.equal(clock.timers[0].cleared, true);
});

test('the caller\'s own cancel stays a cancel, and any other failure passes through as it was', async () => {
  const clock = fakeClock();
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  await assert.rejects(withReadLimit(async () => { throw abort; }, { setTimer: clock.setTimer, clearTimer: clock.clearTimer }), (err) => err === abort);
  const denied = Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' });
  await assert.rejects(withReadLimit(async () => { throw denied; }, { setTimer: clock.setTimer, clearTimer: clock.clearTimer }), (err) => err === denied);
  assert.ok(clock.timers.every((t) => t.cleared));
});

test('a time-out of a side read is an error in plain words (no table name); a missing table is left out quietly', async () => {
  const timedOut = classifyReadError(Object.assign(new Error('x'), { code: READ_TIMEOUT_CODE }), 'task_sla');
  assert.equal(timedOut.status, STATUS.ERROR);
  assert.equal(timedOut.note, 'ServiceNow did not answer in time. Try again in a moment.');
  for (const text of ['Invalid table sn_customerservice_case', 'Table API query on "x" failed (404)', 'Table x does not exist']) {
    assert.equal(isMissingTable(new Error(text)), true, text);
    assert.equal(classifyReadError(new Error(text), 'x').status, STATUS.SKIPPED, text);
  }
  assert.equal(isMissingTable(new Error('Table API query on "x" failed (500): boom')), false);
  const missing = await softRead({ queryTable: async () => { throw new Error('Invalid table sn_hr_core_case'); } }, 'sn_hr_core_case', '', ['sys_id']);
  assert.deepEqual(missing.rows, []);
  assert.equal(missing.failure.status, 'skipped', 'not listed as "could not be read" (describeAccess shows only denied, error, empty-or-hidden, blocked)');
});

test('after a 401 the kept session token is dropped: the next read takes the new one from the page', async () => {
  let token = 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAA';
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
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result: token } }));
      return true;
    },
  };
  globalThis.window = { frames: {} };
  const sent = [];
  let status = 401;
  globalThis.fetch = async (url, init) => {
    sent.push(init.headers['X-UserToken']);
    return { ok: status === 200, status, headers: { get: () => null }, redirected: false, url: String(url), text: async () => (status === 200 ? JSON.stringify({ result: [] }) : '') };
  };
  await assert.rejects(queryTable('incident', 'active=true', ['number']), (err) => err.code === 'SESSION_EXPIRED' && /Sign in to ServiceNow again/.test(err.message));
  token = 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBB'; // the person signed in again: the page has a new token
  status = 200;
  await queryTable('incident', 'active=true', ['number']);
  assert.deepEqual(sent, ['tokenAAAAAAAAAAAAAAAAAAAAAAAAAA', 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBB']);
  // And a token that worked is kept (one read of the page for many requests).
  token = 'tokenCCCCCCCCCCCCCCCCCCCCCCCCCC';
  await queryTable('incident', 'active=true', ['number']);
  assert.equal(sent.at(-1), 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBB');
});
