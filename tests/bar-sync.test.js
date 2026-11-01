// What the bar on the ServiceNow page asks, and when (src/content/barSync.js). Security audit 2, AB2-01 and AB2-02: a bar that is
// switched off must not look at the page, and a page whose site was turned off must stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, SITE_OFF_CODE } from '../src/lib/messages.js';
import { createBarSync } from '../src/content/barSync.js';
import { PROBE_MS, REASK_MS } from '../src/content/barLogic.js';

const SYS = 'a'.repeat(32);
const INC = { table: 'incident', sysId: SYS };
const ACTIONS = [{ id: 'record-summary', label: 'Summarise' }];

// A fake worker and page. `worker(message)` decides the answer; every call is recorded.
function setup({ worker, record = INC, start = 1000 } = {}) {
  const calls = { sent: [], looked: 0, off: 0 };
  let clock = start;
  const sync = createBarSync({
    send: async (message) => {
      calls.sent.push(message);
      return worker(message);
    },
    resolveRecord: async () => {
      calls.looked += 1;
      return typeof record === 'function' ? record() : record;
    },
    now: () => clock,
    onSiteOff: () => {
      calls.off += 1;
    },
  });
  return { sync, calls, advance: (ms) => (clock += ms) };
}

const on = (message) => (message.table ? { actions: ACTIONS, bar: true } : { actions: [], bar: true });
const barOff = () => ({ actions: [], bar: false });
const siteOff = () => ({ error: { message: 'This site is not turned on.', code: SITE_OFF_CODE } });

test('with the bar on: the worker is asked first, then the page, then the actions for the record', async () => {
  const { sync, calls } = setup({ worker: on });
  const result = await sync.tick();
  assert.deepEqual(result, { status: 'shown', record: INC, actions: ACTIONS.map((a) => ({ ...a, ai: true })) });
  assert.deepEqual(calls.sent, [{ type: MSG.BAR_ACTIONS }, { type: MSG.BAR_ACTIONS, table: 'incident' }]);
  assert.equal(calls.looked, 1);
});

test('the next looks reuse the answer; the actions are asked again after REASK_MS', async () => {
  const { sync, calls, advance } = setup({ worker: on });
  await sync.tick();
  advance(2000);
  await sync.tick();
  assert.equal(calls.sent.length, 2, 'no new question two seconds later');
  assert.equal(calls.looked, 2, 'the page is looked at on every tick while the bar is on');
  advance(REASK_MS);
  await sync.tick();
  assert.deepEqual(calls.sent.at(-1), { type: MSG.BAR_ACTIONS, table: 'incident' });
});

test('with the bar switched off (person or policy) the page is never looked at: only the worker is asked, every PROBE_MS', async () => {
  const { sync, calls, advance } = setup({ worker: barOff });
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sync.tick();
    assert.equal(result.status, 'hidden');
    advance(2000);
  }
  assert.equal(calls.looked, 0, 'no call to the page bridge, no record number looked up');
  // 40 seconds of looks: the first probe and one more after PROBE_MS
  assert.equal(calls.sent.length, 1 + Math.floor((20 * 2000 - 2000) / PROBE_MS));
  assert.ok(calls.sent.every((m) => m.type === MSG.BAR_ACTIONS && m.table === undefined), 'nothing about a record is sent while off');
});

test('the bar switched off while a record is shown: it disappears at the next answer and the page is no longer looked at', async () => {
  let enabled = true;
  const { sync, calls, advance } = setup({ worker: (m) => (enabled ? on(m) : barOff()) });
  assert.equal((await sync.tick()).status, 'shown');
  enabled = false;
  advance(REASK_MS);
  assert.equal((await sync.tick()).status, 'hidden');
  const looked = calls.looked;
  for (let i = 0; i < 5; i += 1) {
    advance(2000);
    // eslint-disable-next-line no-await-in-loop
    await sync.tick();
  }
  assert.equal(calls.looked, looked);
});

test('switched on again, it comes back at the next probe', async () => {
  let enabled = false;
  const { sync, advance } = setup({ worker: (m) => (enabled ? on(m) : barOff()) });
  assert.equal((await sync.tick()).status, 'hidden');
  enabled = true;
  advance(2000);
  assert.equal((await sync.tick()).status, 'hidden', 'not asked again before PROBE_MS');
  advance(PROBE_MS);
  assert.equal((await sync.tick()).status, 'shown');
});

test('SITE_OFF at the first question: onSiteOff once, the page never looked at, and nothing is asked again', async () => {
  const { sync, calls, advance } = setup({ worker: siteOff });
  assert.equal((await sync.tick()).status, 'off');
  for (let i = 0; i < 5; i += 1) {
    advance(PROBE_MS);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await sync.tick()).status, 'off');
  }
  assert.equal(calls.off, 1);
  assert.equal(calls.looked, 0);
  assert.equal(calls.sent.length, 1);
});

test('SITE_OFF while a record is shown (the site was turned off later) ends it at the next question', async () => {
  let enabled = true;
  const { sync, calls, advance } = setup({ worker: (m) => (enabled ? on(m) : siteOff()) });
  assert.equal((await sync.tick()).status, 'shown');
  enabled = false;
  advance(REASK_MS);
  assert.equal((await sync.tick()).status, 'off');
  assert.equal(calls.off, 1);
});

test('SITE_OFF is noticed also while no record is open (the probe keeps running)', async () => {
  let enabled = true;
  const { sync, calls, advance } = setup({ worker: (m) => (enabled ? on(m) : siteOff()), record: null });
  assert.equal((await sync.tick()).status, 'hidden');
  enabled = false;
  advance(PROBE_MS);
  assert.equal((await sync.tick()).status, 'off');
  assert.equal(calls.off, 1);
});

test('an extension that was reloaded: gone, and nothing more is done', async () => {
  const { sync, calls } = setup({
    worker: () => {
      throw new Error('Extension context invalidated.');
    },
  });
  assert.equal((await sync.tick()).status, 'gone');
  assert.equal((await sync.tick()).status, 'gone');
  assert.equal(calls.sent.length, 1);
});

test('a worker that cannot be reached for a moment: nothing shown, and it is not asked on every look', async () => {
  let fail = true;
  const { sync, calls, advance } = setup({
    worker: (m) => {
      if (fail) throw new Error('The message port closed before a response was received.');
      return on(m);
    },
  });
  assert.equal((await sync.tick()).status, 'hidden');
  advance(2000);
  await sync.tick();
  assert.equal(calls.sent.length, 1);
  fail = false;
  advance(PROBE_MS);
  assert.equal((await sync.tick()).status, 'shown');
});

test('an error answer for a table (not SITE_OFF) shows nothing for that record and keeps going', async () => {
  const { sync, calls } = setup({ worker: (m) => (m.table ? { error: { message: 'That is not a valid record.', code: '' } } : on(m)) });
  const result = await sync.tick();
  assert.equal(result.status, 'hidden');
  assert.deepEqual(result.record, INC);
  assert.equal(calls.off, 0);
});

test('actions from the worker are checked before they reach the page', async () => {
  const { sync } = setup({ worker: (m) => (m.table ? { bar: true, actions: [{ id: 'Bad Id', label: 'x' }, { id: 'ok-id', label: 'y'.repeat(61) }, { id: 'reply-draft', label: 'Draft a reply' }, 1, null] } : on(m)) });
  assert.deepEqual((await sync.tick()).actions, [{ id: 'reply-draft', label: 'Draft a reply', ai: true }]);
});
