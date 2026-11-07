import { mount, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInsightStore, forgetsValue } from '../src/insights/cache.js';
import { insightStore, recordKey, useClearOnUserChange, userKeyOf } from '../src/sidepanel/ticket/cards/useInsight.js';
import { getSessionToken, getSessionUser, forgetSessionToken, resetSessionUser } from '../src/content/sessionToken.js';
import { shareKey } from '../src/sidepanel/team/teamShare.js';

// What the panel remembers about tickets is remembered for the person who was signed in (audit of 2026-11-07, R-16): keys carry the person,
// a change of person clears what was read, a read that fails because the person may not see it any more does not leave the last good value
// on screen, and the "who is Me" answer is not kept across another sign-in. (The times of "since you last looked" are in
// tests/understand-last-viewed.test.js.)

const KEY = 'tab|user|incident:abc';
const refused = (code, extra = {}) => Object.assign(new Error('refused'), { code, ...extra });

// ---- the store ----------------------------------------------------------------------------------------------------------------------

test('a read that fails because the person may not see it any more does not keep the last good value on screen', async () => {
  for (const [name, error] of [
    ['an access rule', refused('ACCESS_DENIED')],
    ['the organisation\'s restriction', refused('ACCESS_DENIED', { reason: 'policy' })],
    ['a record that is not there for this person', refused('NOT_FOUND')],
    ['a policy block', refused('BLOCKED_TABLE')],
    ['signed out', refused('SESSION_EXPIRED')],
  ]) {
    const store = createInsightStore();
    await store.get(KEY, async () => 'read for the person before', {});
    await assert.rejects(store.get(KEY, async () => Promise.reject(error), { force: true }), undefined, name);
    const now = store.peek(KEY);
    assert.equal(now.value, undefined, `${name}: the value goes`);
    assert.equal(now.error, error);
    assert.equal(forgetsValue(error), true, name);
  }
});

test('a read that fails for a passing reason keeps the last good value, as before', async () => {
  for (const error of [refused('SN_UNAVAILABLE'), refused('SN_RATE_LIMITED'), refused('SN_TIMEOUT'), new Error('The chat could not be read.'), refused('SN_NOT_DATA')]) {
    const store = createInsightStore();
    await store.get(KEY, async () => 'good', {});
    await assert.rejects(store.get(KEY, async () => Promise.reject(error), { force: true }));
    assert.equal(store.peek(KEY).value, 'good', error.code || error.message);
    assert.equal(forgetsValue(error), false);
  }
});

test('a lost sign-in takes every other value with it, and tells the cards that show them', async () => {
  const store = createInsightStore();
  await store.get('a', async () => 'one', {});
  await store.get('b', async () => 'two', {});
  const told = [];
  store.subscribe('a', (entry) => told.push(['a', entry]));
  store.subscribe('b', (entry) => told.push(['b', entry]));
  await assert.rejects(store.get('b', async () => Promise.reject(refused('SESSION_EXPIRED')), { force: true }));
  assert.equal(store.peek('a'), null, 'what was read before the sign-out belongs to someone who may not be the person at the screen');
  assert.equal(store.size(), 1);
  assert.deepEqual(told.filter(([key]) => key === 'a').map(([, entry]) => entry), [null], 'the card on screen lets go of it');
  // An ordinary refusal leaves the other values alone.
  const other = createInsightStore();
  await other.get('a', async () => 'one', {});
  await other.get('b', async () => 'two', {});
  await assert.rejects(other.get('b', async () => Promise.reject(refused('ACCESS_DENIED')), { force: true }));
  assert.equal(other.peek('a').value, 'one');
});

// ---- the key and the change of person -------------------------------------------------------------------------------------------------

test('the key carries the signed-in person: one ticket, two people, two entries', () => {
  const record = { table: 'incident', sysId: 'ABC' };
  const me = { tabId: 4, user: { name: 'Beth', userId: 'B'.repeat(32) } };
  const you = { tabId: 4, user: { name: 'Abel', userId: 'A'.repeat(32) } };
  assert.notEqual(recordKey(me, record), recordKey(you, record));
  assert.equal(recordKey(me, record), `4|${'b'.repeat(32)}|incident:abc`);
  assert.equal(userKeyOf({ user: { name: 'Beth Anglin' } }), 'beth anglin', 'the name when the page gave no id');
  assert.equal(userKeyOf({ user: null }), '');
  assert.equal(userKeyOf(undefined), '');
  // The Team screen's numbers too.
  assert.notEqual(shareKey({ tabId: 4, href: 'https://acme.service-now.com/x', user: me.user }), shareKey({ tabId: 4, href: 'https://acme.service-now.com/x', user: you.user }));
});

test('a different person at the screen: what was read for the one before is cleared; the same person again is not', async () => {
  function Probe({ page, forget }) {
    useClearOnUserChange(page, forget);
    return <p>signed in</p>;
  }
  insightStore.clear();
  await insightStore.get('4|x|incident:abc|ticket', async () => 'read for Beth', {});
  let forgot = 0;
  const forget = () => {
    forgot += 1;
  };
  const beth = { tabId: 4, user: { name: 'Beth', userId: 'b'.repeat(32) } };
  const ui = await mount(<Probe page={beth} forget={forget} />);
  try {
    await settle();
    assert.equal(insightStore.size(), 1, 'the first person seen is not a change');
    await ui.rerender(<Probe page={{ ...beth, href: 'https://acme.service-now.com/other' }} forget={forget} />);
    await settle();
    assert.equal(insightStore.size(), 1, 'the same person on another page: kept');
    await ui.rerender(<Probe page={{ tabId: 4, user: { name: 'Abel', userId: 'a'.repeat(32) } }} forget={forget} />);
    await settle();
    assert.equal(insightStore.size(), 0, 'another person: cleared');
    assert.equal(forgot, 1, 'and the rest of the panel\'s memory about tickets with it');
  } finally {
    await ui.unmount();
  }
});

// ---- "who is Me" ------------------------------------------------------------------------------------------------------------------------

const ONE = 'a'.repeat(32);
const TWO = 'b'.repeat(32);

// The page answers the bridge's two questions: who is signed in, and the session token.
function pageAnswers(sessionInfo, token = 'tok-one-0123456789abcdef') {
  const listeners = [];
  globalThis.document = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    querySelector: () => null,
    scripts: [],
    getElementById: () => null,
    dispatchEvent: (event) => {
      const result = event.detail.action === 'getSessionInfo' ? sessionInfo : event.detail.action === 'getCsrfToken' ? token : undefined;
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result } }));
      return true;
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  };
}

const rows = (id, userName, name, calls) => async () => {
  calls.push(userName);
  return [{ sys_id: id, user_name: userName, name }];
};

test('"who is Me" is not kept for another person: the page names someone else, or the session ended', async () => {
  resetSessionUser();
  pageAnswers(null);
  const calls = [];
  const first = await getSessionUser({ queryTable: rows(ONE, 'beth', 'Beth Anglin', calls) });
  assert.equal(first.userId, ONE);
  await getSessionUser({ queryTable: rows(ONE, 'beth', 'Beth Anglin', calls) });
  assert.equal(calls.length, 1, 'the same person: kept for ten minutes');
  // The page now names a user that is not the one that was looked up (an administrator started to act as someone).
  pageAnswers({ userName: 'abel', firstName: 'Abel', lastName: 'Tuter' });
  const second = await getSessionUser({ queryTable: rows(TWO, 'abel', 'Abel Tuter', calls) });
  assert.equal(second.userId, TWO, 'not the previous person\'s id');
  assert.equal(calls.length, 2);
  // The session ended: whoever signs in next may be someone else.
  pageAnswers(null);
  const again = await getSessionUser({ queryTable: rows(TWO, 'abel', 'Abel Tuter', calls) });
  assert.equal(again.userId, TWO);
  const before = calls.length;
  forgetSessionToken();
  pageAnswers(null);
  const next = await getSessionUser({ queryTable: rows(ONE, 'beth', 'Beth Anglin', calls) });
  assert.equal(next.userId, ONE, 'looked up again after the sign-in ended');
  assert.equal(calls.length, before + 1);
});

test('"who is Me" is not kept across another session token', async () => {
  resetSessionUser();
  forgetSessionToken();
  pageAnswers(null, 'tok-one-0123456789abcdef');
  assert.equal(await getSessionToken(), 'tok-one-0123456789abcdef');
  const calls = [];
  assert.equal((await getSessionUser({ queryTable: rows(ONE, 'beth', 'Beth Anglin', calls) })).userId, ONE);
  assert.equal(calls.length, 1);
  // The token was read again from a new session (the old one was dropped by a refusal): the answer kept for the old session goes.
  forgetSessionToken();
  pageAnswers(null, 'tok-two-0123456789abcdef');
  assert.equal(await getSessionToken(), 'tok-two-0123456789abcdef');
  assert.equal((await getSessionUser({ queryTable: rows(TWO, 'abel', 'Abel Tuter', calls) })).userId, TWO);
  assert.equal(calls.length, 2);
  forgetSessionToken();
});
