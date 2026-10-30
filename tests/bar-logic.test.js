import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_MS, REASK_MS, cleanActions, clickNotice, clickVerdict, isGone, launchNotice, needsAsk, nextSeen, parsePrefs, serializePrefs } from '../src/content/barLogic.js';

test('the bar starts folded on the right when nothing usable is stored', () => {
  for (const raw of [null, undefined, '', 'not json', '5', 'null', '[]', '{"open":"yes"}', '{"side":"top"}']) {
    assert.deepEqual(parsePrefs(raw), { open: false, side: 'right' }, String(raw));
  }
});

test('prefs round-trip, and only the two known choices survive', () => {
  assert.deepEqual(parsePrefs(serializePrefs({ open: true, side: 'left' })), { open: true, side: 'left' });
  assert.deepEqual(parsePrefs(serializePrefs({ open: false, side: 'right' })), { open: false, side: 'right' });
  assert.deepEqual(parsePrefs('{"open":true,"side":"left","extra":"<img src=x>"}'), { open: true, side: 'left' });
  assert.equal(serializePrefs({ open: 1, side: 'up' }), '{"open":false,"side":"right"}');
});

test('the actions are asked for again when the table changed or the answer is old, not on every look', () => {
  const base = { table: 'incident', lastTable: 'incident', lastAt: 1000, now: 1500 };
  assert.equal(needsAsk(base), false);
  assert.equal(needsAsk({ ...base, table: 'problem' }), true);
  assert.equal(needsAsk({ ...base, now: 1000 + REASK_MS }), true);
  assert.equal(needsAsk({ ...base, lastAt: NaN }), true, 'never asked');
});

test('an extension that was reloaded under an open page is recognised', () => {
  assert.equal(isGone(new Error('Extension context invalidated.')), true);
  assert.equal(isGone(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(isGone(new Error('boom')), false);
  assert.equal(isGone(null), false);
});

test('after a click the person is told only what they need', () => {
  assert.equal(launchNotice({ opened: true }), '', 'the panel opened and has taken over');
  assert.match(launchNotice({ opened: false }), /toolbar/);
  assert.equal(launchNotice({ error: { message: 'That action is not available here.' } }), 'That action is not available here.');
  assert.match(launchNotice({ error: {} }), /could not/);
  assert.equal(launchNotice(undefined), '', 'no answer is not an error to show');
});

// ---- a click is taken only when the bar is in plain view (security audit 2, AB2-04) -----------------------------------

test('a click on an action that has been on screen, uncovered, for a moment is taken', () => {
  assert.equal(clickVerdict({ now: 10000, armedAt: 10000 - ARM_MS, seen: null, intact: true }), 'ok', 'no visibility report: time on screen and the bar\'s own style decide');
  assert.equal(clickVerdict({ now: 10000, armedAt: 1000, seen: { visible: true, since: 10000 - ARM_MS }, intact: true }), 'ok');
});

test('a click right after the actions appeared starts nothing (a double click on the tab, a bar shown just before a click)', () => {
  assert.equal(clickVerdict({ now: 10000, armedAt: 10000 - ARM_MS + 1, seen: null, intact: true }), 'too-soon');
  assert.equal(clickVerdict({ now: 10000, armedAt: NaN, seen: null, intact: true }), 'too-soon');
  assert.equal(clickVerdict({ now: NaN, armedAt: 0, seen: null, intact: true }), 'too-soon');
});

test('a click through something that covers the bar, or on a bar made transparent, starts nothing', () => {
  // the browser said: not visible (covered, even by an element that lets clicks through; transparent; filtered)
  assert.equal(clickVerdict({ now: 10000, armedAt: 0, seen: { visible: false, since: 0 }, intact: true }), 'covered');
  // the cover was taken away just before the click
  assert.equal(clickVerdict({ now: 10000, armedAt: 0, seen: { visible: true, since: 10000 - 50 }, intact: true }), 'covered');
  assert.equal(clickVerdict({ now: 10000, armedAt: 0, seen: { visible: true, since: undefined }, intact: true }), 'covered');
});

test('a bar whose element the page restyled or moved starts nothing, whatever else is true', () => {
  assert.equal(clickVerdict({ now: 10000, armedAt: 0, seen: { visible: true, since: 0 }, intact: false }), 'moved');
});

test('every refused click says that nothing was started; a taken click says nothing', () => {
  assert.equal(clickNotice('ok'), '');
  for (const v of ['too-soon', 'covered', 'moved', 'anything else']) assert.match(clickNotice(v), /Nothing was started/, v);
});

test('the visibility reports are folded into "visible since"', () => {
  let seen = nextSeen(undefined, { visible: true, at: 100 });
  assert.deepEqual(seen, { visible: true, since: 100 });
  seen = nextSeen(seen, { visible: true, at: 300 });
  assert.deepEqual(seen, { visible: true, since: 100 }, 'still visible: the start is kept');
  seen = nextSeen(seen, { visible: false, at: 400 });
  assert.deepEqual(seen, { visible: false, since: 400 });
  seen = nextSeen(seen, { visible: true, at: 900 });
  assert.deepEqual(seen, { visible: true, since: 900 }, 'visible again: the clock starts again');
});

test('the actions from the service worker are cleaned before they become buttons', () => {
  assert.deepEqual(cleanActions(null), []);
  assert.deepEqual(cleanActions([{ id: 'a-b', label: 'Go' }, { id: 'A', label: 'x' }, { id: 'ok', label: '' }, { id: 'ok2', label: 5 }, { id: 'x'.repeat(65), label: 'x' }]), [{ id: 'a-b', label: 'Go' }]);
  assert.equal(cleanActions(Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, label: 'x', extra: '<b>' }))).length, 4);
  assert.deepEqual(Object.keys(cleanActions([{ id: 'a', label: 'b', html: '<img>' }])[0]), ['id', 'label']);
});
