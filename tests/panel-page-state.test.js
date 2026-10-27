import test from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_MS, initialPageState, isEnabledPage, reducePage } from '../src/sidepanel/pageState.js';

// Integration review H1: a tab that is loading, or is not a ServiceNow page, cannot answer the content script. One missing answer is
// a hiccup, not "the site is not turned on": the panel keeps the last page, and keeps it for the sections to work on.

const T = 1000; // a ServiceNow tab
const WIKI = 2000; // some other tab
const record = (tabId, sys = 'a') => ({ status: 'record', tabId, href: `https://acme.service-now.com/incident.do?sys_id=${sys.repeat(32)}`, surface: 'classic', record: { table: 'incident', sysId: sys.repeat(32), number: 'INC1' }, user: null });
const noRecord = (tabId) => ({ status: 'no-record', tabId, href: 'https://acme.service-now.com/home', surface: 'classic', user: null });
const answer = (page, at = 0) => ({ type: 'answer', page, at });
const silent = (tabId, at, origin = '') => ({ type: 'silent', tabId, origin, at });
const run = (events, from = initialPageState()) => events.reduce((s, e) => reducePage(s, e), from);

test('the first look at an unknown tab that does not answer is believed at once: the setup help can show', () => {
  const s = run([silent(WIKI, 0)]);
  assert.deepEqual(s.page, { status: 'not-enabled', tabId: WIKI, origin: '' });
  assert.equal(s.stale, false);
  assert.equal(s.lastGood, null);
});

test('an answer is the page, and the last good page', () => {
  const s = run([answer(record(T))]);
  assert.equal(s.page.status, 'record');
  assert.equal(s.lastGood, s.page);
  assert.equal(s.stale, false);
  assert.ok(isEnabledPage(s.page));
});

test('one missing answer from the page we were on keeps that page and marks it stale', () => {
  const good = run([answer(record(T))]);
  const s = reducePage(good, silent(T, 100));
  assert.equal(s.page, good.page, 'the same object: nothing downstream re-renders');
  assert.equal(s.stale, true);
  assert.equal(s.lastGood, good.lastGood);
  assert.equal(s.page.status, 'record');
});

test('two missing answers in a row are believed, but not before the grace time has passed', () => {
  const good = run([answer(record(T), 0)]);
  const first = reducePage(good, silent(T, 100));
  const tooSoon = reducePage(first, silent(T, 100 + GRACE_MS - 1)); // (a burst of tab events while the page loads)
  assert.equal(tooSoon.stale, true);
  assert.equal(tooSoon.page.status, 'record');
  const later = reducePage(tooSoon, silent(T, 100 + GRACE_MS, 'https://acme.service-now.com'));
  assert.deepEqual(later.page, { status: 'not-enabled', tabId: T, origin: 'https://acme.service-now.com' });
  assert.equal(later.stale, false);
  assert.equal(later.lastGood.status, 'record', 'the last good page is still there for the sections to work on');
  assert.equal(later.lastSeen, later.lastGood);
});

test('without timestamps two missing answers are enough', () => {
  const s = run([answer(record(T)), { type: 'silent', tabId: T }, { type: 'silent', tabId: T }]);
  assert.equal(s.page.status, 'not-enabled');
});

test('an answer after a hiccup clears it, and a page that has not changed stays the same object', () => {
  const good = run([answer(record(T))]);
  const hiccup = reducePage(good, silent(T, 100));
  const back = reducePage(hiccup, answer(record(T), 2600));
  assert.equal(back.stale, false);
  assert.equal(back.failures, 0);
  assert.equal(back.page, good.page);
  assert.equal(back.lastGood, good.lastGood);
  // ...and the next hiccup starts counting from one again
  assert.equal(reducePage(back, silent(T, 5000)).stale, true);
});

test('a move to a tab that never answered is believed at once; the last good page stays for the sections', () => {
  const good = run([answer(record(T))]);
  const s = reducePage(good, silent(WIKI, 100));
  assert.equal(s.page.status, 'not-enabled');
  assert.equal(s.page.tabId, WIKI);
  assert.equal(s.stale, false);
  assert.equal(s.lastGood, good.lastGood);
});

test('a move to a tab that has answered before is given the same short grace', () => {
  const both = run([answer(record(T), 0), answer(noRecord(WIKI), 10), answer(record(T), 20)]);
  const s = reducePage(both, silent(WIKI, 100));
  assert.equal(s.stale, true);
  assert.equal(s.page.tabId, T, 'still the page it had');
  const flipped = reducePage(s, silent(WIKI, 100 + GRACE_MS));
  assert.deepEqual(flipped.page, { status: 'not-enabled', tabId: WIKI, origin: '' });
});

test('a page that is already not enabled stays so and follows the tab and its address', () => {
  const s = run([answer(record(T)), silent(WIKI, 0), silent(WIKI, 50, 'https://wiki.example')]);
  assert.deepEqual(s.page, { status: 'not-enabled', tabId: WIKI, origin: 'https://wiki.example' });
  const same = reducePage(s, silent(WIKI, 60, 'https://wiki.example'));
  assert.equal(same.page, s.page);
});

test('coming back to the ServiceNow tab restores it as the current page', () => {
  const s = run([answer(record(T)), silent(WIKI, 0), answer(record(T), 5000)]);
  assert.equal(s.page.status, 'record');
  assert.equal(s.page.tabId, T);
  assert.equal(s.stale, false);
});

test('lastGood is dropped when its tab closes; lastSeen is not (a visited section keeps its text for the next ServiceNow tab)', () => {
  const s = run([answer(record(T)), silent(WIKI, 0), { type: 'closed', tabId: T }]);
  assert.equal(s.lastGood, null);
  assert.equal(s.lastSeen.tabId, T);
  assert.equal(s.answered[T], undefined);
  // closing some other tab changes nothing
  const other = run([answer(record(T)), { type: 'closed', tabId: WIKI }]);
  assert.equal(other.lastGood.tabId, T);
});

test('a page that is enabled but not a record is still an enabled page', () => {
  const s = run([answer(record(T)), answer(noRecord(T))]);
  assert.equal(s.page.status, 'no-record');
  assert.equal(s.lastGood.status, 'no-record');
});
