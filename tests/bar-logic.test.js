import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_MS, REASK_MS, cleanActions, clickNotice, clickVerdict, isGone, launchNotice, needsAsk, nextSeen, parsePrefs, serializePrefs } from '../src/content/barLogic.js';

test('the bar starts folded on the right when nothing usable is stored', () => {
  for (const raw of [null, undefined, '', 'not json', '5', 'null', '[]', '{"open":"yes"}', '{"side":"top"}']) {
    assert.deepEqual(parsePrefs(raw), { open: false, side: 'right', top: null }, String(raw));
  }
});

test('prefs round-trip, and only the two known choices survive', () => {
  assert.deepEqual(parsePrefs(serializePrefs({ open: true, side: 'left' })), { open: true, side: 'left', top: null });
  assert.deepEqual(parsePrefs(serializePrefs({ open: false, side: 'right' })), { open: false, side: 'right', top: null });
  assert.deepEqual(parsePrefs('{"open":true,"side":"left","extra":"<img src=x>"}'), { open: true, side: 'left', top: null });
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
  assert.deepEqual(cleanActions([{ id: 'a-b', label: 'Go' }, { id: 'A', label: 'x' }, { id: 'ok', label: '' }, { id: 'ok2', label: 5 }, { id: 'x'.repeat(65), label: 'x' }]), [{ id: 'a-b', label: 'Go', ai: true }]);
  assert.equal(cleanActions(Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, label: 'x', extra: '<b>' }))).length, 4);
  assert.deepEqual(Object.keys(cleanActions([{ id: 'a', label: 'b', html: '<img>', ai: false }])[0]), ['id', 'label', 'ai']);
  // `ai` comes from the id, never from the answer: only a card needs no AI.
  assert.deepEqual(cleanActions([{ id: 'reply-draft', label: 'Draft', ai: false }, { id: 'card:ready', label: 'Ready to resolve?', ai: true }]).map((a) => a.ai), [true, false]);
  assert.deepEqual(cleanActions([{ id: 'card:', label: 'x' }, { id: 'card:Ready', label: 'x' }, { id: 'cards:ready', label: 'x' }]), []);
});

// ---- the tab's place, the page's dialogs, an older copy after an update (F6, F1) ---------------------------------------------

import { BAR_Z, DRAG_PX, TAKEOVER_EVENT, TOP_MAX, TOP_MIN, clampTop, contentTakeover, dragTop, pageHasModal, runtimeAlive, topFor } from '../src/content/barLogic.js';

test('the tab can be dragged up or down: its place is a percentage kept inside the window, and it is remembered', () => {
  assert.equal(clampTop(50), 50);
  assert.equal(clampTop(0), TOP_MIN);
  assert.equal(clampTop(250), TOP_MAX);
  assert.equal(clampTop('41.26'), 41.3);
  for (const bad of [null, undefined, '', 'top', NaN, Infinity, {}, []]) assert.equal(clampTop(bad), null, String(bad));
  assert.deepEqual(parsePrefs(serializePrefs({ open: true, side: 'left', top: 61 })), { open: true, side: 'left', top: 61 });
  assert.equal(serializePrefs({ open: false, side: 'right', top: 'x' }), '{"open":false,"side":"right"}', 'no place until it was moved');
  assert.equal(parsePrefs('{"top":"<script>"}').top, null);
});

test('where the tab starts: above the middle on a form, lower on a Workspace (clear of its own icon strip); the person\'s place wins', () => {
  assert.equal(topFor({ top: null }, 'classic'), 38);
  assert.equal(topFor({ top: null }, 'workspace'), 72);
  assert.equal(topFor({ top: null }, 'portal'), 38);
  assert.equal(topFor({}, 'something else'), 38);
  assert.equal(topFor({}, '__proto__'), 38);
  assert.equal(topFor({ top: 20 }, 'workspace'), 20);
});

test('a press that moves less than a few pixels is a click; more moves the tab by the pointer\'s travel', () => {
  assert.equal(dragTop({ startTop: 40, startY: 300, y: 300 + DRAG_PX - 1, height: 1000 }), null);
  assert.equal(dragTop({ startTop: 40, startY: 300, y: 400, height: 1000 }), 50);
  assert.equal(dragTop({ startTop: 40, startY: 300, y: -5000, height: 1000 }), TOP_MIN);
  assert.equal(dragTop({ startTop: 40, startY: 300, y: 400, height: 0 }), null);
  assert.equal(dragTop({ startTop: NaN, startY: 300, y: 400, height: 1000 }), null);
});

test('the bar sits below the page\'s dialogs and hides while one is open', () => {
  assert.ok(BAR_Z < 1040, 'under the classic UI\'s dialog backdrop (1040) and dialog (1050)');
  assert.equal(pageHasModal({ bodyClasses: ['modal-open'], dialogs: 0 }), true);
  assert.equal(pageHasModal({ bodyClasses: [], dialogs: 1 }), true);
  assert.equal(pageHasModal({ bodyClasses: ['x'], dialogs: 0 }), false);
  assert.equal(pageHasModal({}), false);
  assert.equal(pageHasModal(), false);
});

test('an older copy of the content script (from before an update) is replaced; a working one is left alone', () => {
  assert.equal(contentTakeover(null), 'install');
  assert.equal(contentTakeover(undefined), 'install');
  assert.equal(contentTakeover({ alive: 'yes' }), 'install');
  assert.equal(contentTakeover({ alive: () => true }), 'skip');
  assert.equal(contentTakeover({ alive: () => false }), 'replace');
  assert.equal(contentTakeover({ alive: () => { throw new Error('Extension context invalidated.'); } }), 'replace');
  assert.equal(runtimeAlive({ id: 'abc' }), true);
  assert.equal(runtimeAlive({ id: undefined }), false);
  assert.equal(runtimeAlive(null), false);
  assert.equal(runtimeAlive({ get id() { throw new Error('Extension context invalidated.'); } }), false);
  assert.equal(TAKEOVER_EVENT, 'agentbuddy-content-takeover');
});

test('the content script and the bar wire these in', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'index.js'), 'utf8');
  assert.match(index, /contentTakeover\(window\.__abContent\)/);
  assert.match(index, /if \(!alive\(\)\) retire\(\);/, 'only a copy whose extension is gone steps down on the event');
  const bar = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'bar.js'), 'utf8');
  assert.match(bar, /pin\('z-index', String\(BAR_Z\)\)/);
  assert.ok(!/2147483647/.test(bar), 'no longer the highest layer there is');
  assert.ok(!/, 'AB'\)/.test(bar), 'an icon and a label instead of the letters AB');
  assert.match(bar, /state\.modal = Boolean\(result\.record\) && modalShown\(doc, win\)/);
});
