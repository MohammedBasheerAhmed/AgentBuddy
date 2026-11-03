import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_MS, REASK_MS, cleanActions, clickNotice, clickVerdict, isGone, launchNotice, needsAsk, nextSeen, parsePrefs, serializePrefs } from '../src/content/barLogic.js';

test('the dock starts folded and in the centre when nothing usable is stored', () => {
  for (const raw of [null, undefined, '', 'not json', '5', 'null', '[]', '{"open":"yes"}', '{"x":"left"}']) {
    assert.deepEqual(parsePrefs(raw), { open: false, x: null }, String(raw));
  }
});

test('prefs round-trip, and nothing else survives (the old right-edge tab\'s side and top are dropped)', () => {
  assert.deepEqual(parsePrefs(serializePrefs({ open: true, x: 30 })), { open: true, x: 30 });
  assert.deepEqual(parsePrefs(serializePrefs({ open: false })), { open: false, x: null });
  assert.deepEqual(parsePrefs('{"open":true,"side":"left","top":61,"extra":"<img src=x>"}'), { open: true, x: null });
  assert.equal(serializePrefs({ open: 1, x: 'up' }), '{"open":false}');
  assert.equal(serializePrefs({ open: true }), '{"open":true}', 'no place until it was moved');
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

// ---- the dock\'s place, the page's dialogs, an older copy after an update (F6, F1) --------------------------------------------

import { BAR_Z, DOCK_BOTTOM_PX, DOCK_EDGE_PX, DRAG_PX, KEY_STEP, NOTICE_MS, TAKEOVER_EVENT, X_DEFAULT, X_MAX, X_MIN, clampX, contentTakeover, dockLeft, dragX, pageHasModal, runtimeAlive, xFor } from '../src/content/barLogic.js';

test('the dock can be dragged along the bottom: its place is a percentage kept inside the window, and it is remembered', () => {
  assert.equal(clampX(50), 50);
  assert.equal(clampX(0), X_MIN);
  assert.equal(clampX(250), X_MAX);
  assert.equal(clampX('41.26'), 41.3);
  for (const bad of [null, undefined, '', 'left', NaN, Infinity, {}, []]) assert.equal(clampX(bad), null, String(bad));
  assert.deepEqual(parsePrefs(serializePrefs({ open: true, x: 61 })), { open: true, x: 61 });
  assert.equal(parsePrefs('{"x":"<script>"}').x, null);
});

test('where the dock starts: the centre of the window, on every kind of page; the person\'s place wins', () => {
  assert.equal(X_DEFAULT, 50);
  assert.equal(xFor({ x: null }), 50);
  assert.equal(xFor({}), 50);
  assert.equal(xFor(undefined), 50);
  assert.equal(xFor({ x: 20 }), 20);
  assert.equal(xFor({ x: 500 }), X_MAX);
});

test('the dock\'s left edge puts its middle on the chosen place and keeps it inside the window', () => {
  // 1000 px window, a 200 px dock: the middle at 50% means the left edge at 400
  assert.equal(dockLeft({ x: null, view: 1000, width: 200 }), 400);
  assert.equal(dockLeft({ x: 50, view: 1000, width: 56 }), 472, 'a folded dock stays centred on the same middle');
  assert.equal(dockLeft({ x: 20, view: 1000, width: 200 }), 100);
  // dragged to the far sides: kept inside by the edge gap
  assert.equal(dockLeft({ x: 5, view: 1000, width: 200 }), DOCK_EDGE_PX);
  assert.equal(dockLeft({ x: 95, view: 1000, width: 200 }), 1000 - 200 - DOCK_EDGE_PX);
  // a window narrower than the dock: it starts at the left edge rather than going off to the left
  assert.equal(dockLeft({ x: 50, view: 150, width: 200 }), DOCK_EDGE_PX);
  // nothing known yet (the dock is not shown, or the window has no width)
  assert.equal(dockLeft({ x: 50, view: 1000, width: 0 }), 500);
  assert.equal(dockLeft({ x: 50, view: 0, width: 0 }), DOCK_EDGE_PX);
  assert.ok(DOCK_BOTTOM_PX >= 8 && DOCK_BOTTOM_PX <= 32, 'a little above the bottom edge');
});

test('a press that moves less than a few pixels is a click; more moves the dock by the pointer\'s travel', () => {
  assert.equal(dragX({ startX: 50, startPx: 300, px: 300 + DRAG_PX - 1, view: 1000 }), null);
  assert.equal(dragX({ startX: 50, startPx: 300, px: 400, view: 1000 }), 60);
  assert.equal(dragX({ startX: 50, startPx: 300, px: 200, view: 1000 }), 40);
  assert.equal(dragX({ startX: 50, startPx: 300, px: -5000, view: 1000 }), X_MIN);
  assert.equal(dragX({ startX: 50, startPx: 300, px: 9000, view: 1000 }), X_MAX);
  assert.equal(dragX({ startX: 50, startPx: 300, px: 400, view: 0 }), null);
  assert.equal(dragX({ startX: NaN, startPx: 300, px: 400, view: 1000 }), null);
  assert.equal(KEY_STEP, 5);
});

test('a note above the dock goes away by itself', () => {
  assert.ok(NOTICE_MS >= 5000 && NOTICE_MS <= 30000);
});

test('the dock is a pill at the bottom centre with icons, a tooltip, and none of the old right-edge tab', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const bar = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'bar.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'bar.css'), 'utf8');
  assert.match(bar, /pin\('bottom'/, 'fixed to the bottom edge');
  assert.match(bar, /dockLeft\(/, 'centred on the chosen place by the tested function');
  assert.match(bar, /featureIcon\(action\.id\)/, 'every action has its own icon');
  assert.match(bar, /class: 'tip'/, 'a tooltip of its own (the browser title is slow and never shows for the keyboard)');
  assert.match(bar, /':focus-visible'/, 'the keyboard shows the name too');
  assert.match(bar, /e\.isTrusted && press\(action, button\)/, 'only a real click starts an action');
  assert.ok(!/title:/.test(bar), 'no native title: it would show a second tooltip over ours');
  assert.ok(!/data-side|Move to the (left|right)|writing-mode/.test(bar + css), 'the old tab on the edge is gone');
  assert.ok(!/opacity\s*:/.test(css.replace(/@keyframes[^}]*\}[^}]*\}/g, '')), 'no opacity on the dock: the visibility check counts a see-through button as covered');
});

// Seen on dev364920: hover an icon, its name shows, press it: "something on the page was covering the bar". The browser's visibility check
// (IntersectionObserver v2) counts anything painted over an icon, its shadow too, as covering it, and the dock then refuses the click.
// The name's big drop shadow reached down into the icons. So the name and the note above the dock keep a small shadow (offset + blur inside
// the gap above the dock plus its padding), and the icons' focus ring stays inside the 4 px gap between icons.
test('nothing the dock draws next to an icon reaches over it: small shadow on the name and note, thin focus ring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'bar.css'), 'utf8');
  const body = (selector) => {
    const at = css.indexOf(selector + ' {');
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  const above = body('.tip, .notice');
  const gap = Number((above.match(/bottom: calc\(100% \+ (\d+)px\)/) || [])[1]);
  const padding = Number((body('.dock').match(/padding: (\d+)px/) || [])[1]) + 1; // the dock's padding and its border
  const shadow = above.match(/box-shadow: (-?\d+)(?:px)? (-?\d+)px (\d+)px/);
  assert.ok(gap >= 10 && padding >= 6 && shadow, 'the gap, the padding and the shadow can be read from the stylesheet');
  const reach = Math.abs(Number(shadow[2])) + Number(shadow[3]);
  assert.ok(reach < gap + padding, `the shadow reaches ${reach} px, the icons are ${gap + padding} px away`);
  assert.ok(!/var\(--ab-shadow\)/.test(body('.tip')) && !/var\(--ab-shadow\)/.test(body('.notice')), 'the big shared shadow is not used above the dock');
  const ring = body('.handle:focus-visible, .act:focus-visible, .fold:focus-visible');
  assert.ok(ring && !/var\(--ab-ring\)/.test(ring) && /3\.5px/.test(ring), 'the icons focus ring is thinner than the 4 px gap between them');
  assert.match(body('.actions'), /gap: 4px/, 'the gap between icons that the ring has to fit in');
});
