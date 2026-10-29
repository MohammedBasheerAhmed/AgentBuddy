import test from 'node:test';
import assert from 'node:assert/strict';
import { REASK_MS, isGone, launchNotice, needsAsk, parsePrefs, serializePrefs } from '../src/content/barLogic.js';

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
