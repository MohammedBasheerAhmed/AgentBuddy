const test = require('node:test');
const assert = require('node:assert/strict');
import { BRIDGE_SOURCE, addComposer, makeWorkspace } from './workspace-dom.js';

// Audit of 2026-11-07, part 9 (Workspaces), in the page bridge: S4/S5 (finding the box, with a clock and not a count; saying so when it
// is not there), W-12/S14 (the composer's Work notes / customer comments switch is read, never assumed), S6 (the box of the last insert
// emptied or taken off the page), S8, S15 and S19. The real src/page/bridge.js runs against the fake page of tests/workspace-dom.js.

const WORK = ['work_notes', 'Work notes'];
const COMMENTS = ['comments', 'Additional comments'];
const states = (page, ...fields) => page.call('getFieldStates', [fields.map((f) => f[0]), fields.map((f) => f[1])]);
const fill = (page, [name, label], text = 'hello', append = true) => page.call('fillField', [name, text, label, append, '', '', { undo: true }]);

// ---- S5: a search with a clock --------------------------------------------------------------------------------------------------

test('a box nested deeper than the first search went (seven shadow roots) is found', () => {
  const page = makeWorkspace();
  let parent = null;
  let root = null;
  for (let i = 0; i < 12; i += 1) {
    const made = page.host('now-level', root);
    parent = made.host;
    root = made.root;
  }
  const box = page.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }, root);
  assert.ok(parent);
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
});

test('a very big page: the clock ends the search, and "could not look everywhere" is not "there is no box"', () => {
  const page = makeWorkspace({ clock: true });
  for (let i = 0; i < 5000; i += 1) page.add('div');
  const box = page.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }); // after 5000 elements: out of reach in the time allowed
  const out = states(page, WORK);
  assert.deepEqual(out.fields, { work_notes: 'unknown' });
  assert.deepEqual(out.gaps, { work_notes: 'too-big' }, 'the panel is told the page was too big, not that the box is absent');
  assert.deepEqual(fill(page, WORK), { ok: false, reason: 'unreachable' });
  assert.equal(box.value, '', 'nothing was written');
  // the same page without the filler: looked at everywhere, no box
  const empty = makeWorkspace();
  assert.deepEqual(states(empty, WORK).gaps, { work_notes: 'absent' });
  assert.deepEqual(fill(empty, WORK), { ok: false, reason: 'no-form' });
});

test('on a big page the editor the person is typing in is found first, wherever it sits', () => {
  const page = makeWorkspace({ clock: true });
  for (let i = 0; i < 5000; i += 1) page.add('div');
  const box = page.add('textarea', { 'aria-label': 'Work notes' }, { value: 'typed' });
  page.doc.activeElement = box;
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'typed\n\nhello');
});

test('on a big page the parts on screen are looked at before the parts that are hidden', () => {
  const page = makeWorkspace({ clock: true });
  // a hidden tab with thousands of elements comes first in the document, the visible composer after it
  const hidden = page.host('now-hidden-tab');
  hidden.host.hidden = true;
  for (let i = 0; i < 5000; i += 1) page.add('div', {}, {}, hidden.root);
  const shown = page.host('now-visible-tab');
  const box = page.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }, shown.root);
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
});

test('a box inside a same-origin frame is found; a frame that cannot be read is skipped', () => {
  const page = makeWorkspace();
  const closed = page.add('iframe');
  Object.defineProperty(closed, 'contentDocument', { get() { throw new Error('another origin'); } });
  const framed = page.frame({ title: 'Notes editor' });
  const box = framed.add('textarea', { 'aria-label': 'Work notes' }, { value: '' });
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
});

// ---- S4: the panel is told BEFORE the click ----------------------------------------------------------------------------------------

test('a box that is not on the page, two that look alike, and a locked one are told apart before the click', () => {
  const page = makeWorkspace();
  addComposer(page, { tabs: [], boxLabel: 'Additional comments' });
  assert.deepEqual(states(page, WORK, COMMENTS).gaps, { work_notes: 'absent' });
  const twin = makeWorkspace();
  twin.add('textarea', { 'aria-label': 'Work notes' }, { value: 'one' });
  twin.add('textarea', { 'aria-label': 'Work notes' }, { value: 'two' });
  const out = states(twin, WORK);
  assert.deepEqual(out.fields, { work_notes: 'unknown' });
  assert.deepEqual(out.gaps, { work_notes: 'ambiguous' });
  assert.deepEqual(fill(twin, WORK), { ok: false, reason: 'no-form' });
  const locked = makeWorkspace();
  locked.add('textarea', { 'aria-label': 'Work notes' }, { value: '', disabled: true });
  const lockedOut = states(locked, WORK);
  assert.deepEqual(lockedOut.fields, { work_notes: 'read-only' });
  assert.deepEqual(lockedOut.gaps, {});
});

test('a hidden box (another ticket tab, a collapsed panel) counts as not there', () => {
  const page = makeWorkspace();
  page.add('textarea', { 'aria-label': 'Work notes' }, { value: '', hidden: true });
  assert.deepEqual(states(page, WORK).gaps, { work_notes: 'absent' });
});

test('asking only reads: nothing is typed, focused or fired', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { value: 'typed' });
  states(page, WORK, COMMENTS);
  page.call('getBoxValues', [['work_notes'], ['Work notes']]);
  assert.deepEqual(box.events, []);
  assert.equal(box.value, 'typed');
  assert.equal(page.doc.activeElement, null);
});

// ---- W-12 / S14: the composer's switch ------------------------------------------------------------------------------------------

test('a composer set to Work notes takes a work note, and says so before the click', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { selected: 0, boxLabel: 'Work notes' });
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'match' });
  const out = fill(page, WORK);
  assert.deepEqual([out.ok, out.method, out.label, out.modeUnread], [true, 'dom', 'Work notes', undefined], 'a mode that was read is not "unread"');
  assert.equal(box.value, 'hello');
});

test('a composer set to customer comments refuses a work note, writes nothing, and the same box takes a customer reply', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { selected: 1, boxLabel: 'Work notes' }); // the box keeps its label whatever the switch says
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'other' });
  assert.deepEqual(fill(page, WORK), { ok: false, reason: 'wrong-mode' });
  assert.equal(box.value, '');
  assert.deepEqual(box.events, []);
  const replies = makeWorkspace();
  const composer = addComposer(replies, { selected: 1, boxLabel: 'Additional comments' });
  assert.deepEqual(states(replies, COMMENTS).modes, { comments: 'match' });
  assert.equal(fill(replies, COMMENTS).ok, true);
  assert.equal(composer.box.value, 'hello');
});

test('a composer set to Work notes refuses a customer reply (it would never reach the customer)', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { selected: 0, boxLabel: 'Additional comments' });
  assert.deepEqual(states(page, COMMENTS).modes, { comments: 'other' });
  assert.deepEqual(fill(page, COMMENTS), { ok: false, reason: 'wrong-mode' });
  assert.equal(box.value, '');
});

test('the switch is read in Arabic too', () => {
  const internal = 'ملاحظات العمل';
  const customer = 'تعليقات العميل';
  const page = makeWorkspace();
  addComposer(page, { tabs: [internal, customer], selected: 1, boxLabel: 'Work notes' });
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'other' });
  const right = makeWorkspace();
  addComposer(right, { tabs: [internal, customer], selected: 0, boxLabel: 'Work notes' });
  assert.deepEqual(states(right, WORK).modes, { work_notes: 'match' });
});

test('other ways to mark the chosen one: aria-checked, aria-pressed, a chosen radio, a chosen option', () => {
  for (const mark of ['aria-checked', 'aria-pressed']) {
    const page = makeWorkspace();
    const { tabs } = addComposer(page, { selected: -1, boxLabel: 'Work notes' });
    tabs[1].setAttribute(mark, 'true');
    tabs[1].setAttribute('role', mark === 'aria-checked' ? 'radio' : 'button');
    assert.deepEqual(states(page, WORK).modes, { work_notes: 'other' }, mark);
  }
  const radios = makeWorkspace();
  const { host, root } = radios.host();
  const group = radios.add('div', { role: 'radiogroup' }, {}, root);
  radios.add('input', { type: 'radio' }, { labels: ['Work notes'], checked: false, type: 'radio' }, group);
  radios.add('input', { type: 'radio' }, { labels: ['Customer comments'], checked: true, type: 'radio' }, group);
  radios.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }, root);
  assert.ok(host);
  assert.deepEqual(states(radios, WORK).modes, { work_notes: 'other' });
  const select = makeWorkspace();
  const made = select.host();
  const list = select.add('select', {}, {}, made.root);
  select.add('option', {}, { text: 'Work notes', selected: false }, list);
  select.add('option', {}, { text: 'Customer comments', selected: true }, list);
  select.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }, made.root);
  assert.deepEqual(states(select, WORK).modes, { work_notes: 'other' });
});

test('no switch at all, a switch with no words, or two that disagree: "cannot tell", the text still goes in and the answer says so', () => {
  const none = makeWorkspace();
  const bare = none.add('textarea', { 'aria-label': 'Work notes' }, { value: '' });
  assert.deepEqual(states(none, WORK).modes, { work_notes: 'unread' });
  assert.equal(fill(none, WORK).modeUnread, true);
  assert.equal(bare.value, 'hello');
  const wordless = makeWorkspace();
  addComposer(wordless, { tabs: ['Tab 1', 'Tab 2'], selected: 1, boxLabel: 'Work notes' });
  assert.deepEqual(states(wordless, WORK).modes, { work_notes: 'unread' });
  const both = makeWorkspace();
  const { tabs } = addComposer(both, { selected: 0, boxLabel: 'Work notes' });
  tabs[1].setAttribute('aria-selected', 'true');
  assert.deepEqual(states(both, WORK).modes, { work_notes: 'unread' });
  assert.equal(fill(both, WORK).modeUnread, true);
});

test('a filter of the activity stream (All, Comments, Work notes) is not the composer\'s switch', () => {
  const page = makeWorkspace();
  const wrap = page.add('div');
  const filter = page.add('div', { role: 'tablist' }, {}, wrap);
  page.add('button', { role: 'tab', 'aria-selected': 'false' }, { text: 'All' }, filter);
  page.add('button', { role: 'tab', 'aria-selected': 'false' }, { text: 'Comments' }, filter);
  page.add('button', { role: 'tab', 'aria-selected': 'true' }, { text: 'Work notes' }, filter);
  const composer = page.host('now-activity-composer', wrap);
  page.add('textarea', { 'aria-label': 'Work notes' }, { value: '' }, composer.root);
  // the filter says Work notes, but it filters the stream: the composer's own mode is not known
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'unread' });
});

test('the nearest switch decides: the composer\'s own beats a switch further up', () => {
  const page = makeWorkspace();
  const outer = page.add('div');
  const outerTabs = page.add('div', { role: 'tablist' }, {}, outer);
  page.add('button', { role: 'tab', 'aria-selected': 'true' }, { text: 'Work notes' }, outerTabs);
  page.add('button', { role: 'tab', 'aria-selected': 'false' }, { text: 'Customer comments' }, outerTabs);
  const inner = page.add('div', {}, {}, outer);
  addComposer(page, { selected: 1, boxLabel: 'Work notes', parent: inner });
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'other' });
});

test('only the journal boxes are asked about their mode; a resolution notes box has none', () => {
  const page = makeWorkspace();
  page.add('textarea', { 'aria-label': 'Resolution notes' }, { value: '' });
  const out = states(page, ['close_notes', 'Resolution notes']);
  assert.deepEqual(out.modes, {});
  assert.deepEqual(fill(page, ['close_notes', 'Resolution notes']).modeUnread, undefined);
});

// ---- S6: the box of the last insert -----------------------------------------------------------------------------------------------

test('watchInsert: nothing before an insert; held after it; gone once the box is emptied or taken off the page; none after Undo', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { selected: 0, boxLabel: 'Work notes' });
  assert.equal(page.call('watchInsert'), null);
  fill(page, WORK);
  assert.deepEqual(page.call('watchInsert'), { n: 1, gone: false });
  box.value = ''; // a Post empties the composer
  assert.deepEqual(page.call('watchInsert'), { n: 1, gone: true });
  box.value = 'hello';
  fill(page, WORK, 'again');
  assert.deepEqual(page.call('watchInsert'), { n: 2, gone: false });
  box.remove(); // a Save that draws the form again
  assert.deepEqual(page.call('watchInsert'), { n: 2, gone: true });

  const undone = makeWorkspace();
  const second = addComposer(undone, { selected: 0, boxLabel: 'Work notes' });
  const done = fill(undone, WORK);
  assert.equal(undone.call('restoreField', ['work_notes', done.previous, done.after, 'Work notes', {}]).ok, true);
  assert.equal(second.box.value, '');
  assert.equal(undone.call('watchInsert'), null, 'put back: nothing of the insert is left to watch');
});

// ---- S15, S8, S19 ---------------------------------------------------------------------------------------------------------------

test('impact, urgency and contact type are lists: on a page without g_form they are picked by hand, never typed', () => {
  const page = makeWorkspace();
  const box = page.add('input', { type: 'text', 'aria-label': 'Impact' }, { value: '' });
  for (const name of ['impact', 'urgency', 'contact_type']) assert.deepEqual(page.call('fillField', [name, '2 - Medium', 'Impact', false]), { ok: false, reason: 'choice-by-hand' }, name);
  assert.equal(box.value, '');
});

test('the classic shell\'s frame has moved on to a list: getFormMeta says so; a frame on a form, or no frame, says nothing new', () => {
  const frames = (pathname, extra = {}) => ({ gsft_main: { location: { pathname }, ...extra } });
  const onList = makeWorkspace({ window: { frames: frames('/incident_list.do') } });
  assert.deepEqual(onList.call('getFormMeta'), { table: null, sysId: null, isNewRecord: null, number: null, loadedAt: null, frameIsList: true });
  assert.equal(makeWorkspace({ window: { frames: frames('/incident.do') } }).call('getFormMeta'), null);
  assert.equal(makeWorkspace().call('getFormMeta'), null);
  const gform = { hasField: () => true, getValue: () => 'x', getTableName: () => 'incident', getUniqueValue: () => 'b'.repeat(32), isNewRecord: () => false };
  const aForm = makeWorkspace({ window: { frames: frames('/incident_list.do', { g_form: gform }) } });
  assert.equal(aForm.call('getFormMeta').table, 'incident', 'a frame that has a form is the form');
  assert.equal(aForm.call('getFormMeta').frameIsList, undefined);
});

test('addresses a portal never lives at are not portal pages (the same first segments as the panel)', () => {
  for (const first of ['images', 'scripts', 'styles', 'assets']) {
    const page = makeWorkspace({ url: `https://x.service-now.com/${first}?id=ticket` });
    page.add('textarea', { 'aria-label': 'Work notes' }, { value: '' });
    assert.equal(states(page, WORK).form, 'workspace', first);
  }
  assert.equal(states(makeWorkspace({ url: 'https://x.service-now.com/esc?id=ticket' }), WORK).form, 'portal');
});

test('getBoxValues reads the boxes found the same way and fires nothing', () => {
  const page = makeWorkspace();
  const { box } = addComposer(page, { selected: 0, boxLabel: 'Work notes', value: 'typed, not saved' });
  assert.deepEqual(page.call('getBoxValues', [['work_notes', 'comments'], ['Work notes', 'Additional comments']]), { work_notes: 'typed, not saved' });
  assert.deepEqual(box.events, []);
});

test('the bridge still has no way to click, submit or save', () => {
  assert.ok(!/\.click\(|\.submit\(|requestSubmit|dispatchEvent\(new (Mouse|Pointer|Keyboard)|XMLHttpRequest|fetch\(|sendBeacon/.test(BRIDGE_SOURCE));
});

// ---- S4: labels in Arabic and in ServiceNow's other English wording ----------------------------------------------------------------

test('a box is found by its Arabic label, and by the other English wording ServiceNow uses', () => {
  const arabic = 'ملاحظات العمل';
  const page = makeWorkspace();
  const box = page.add('textarea', { 'aria-label': arabic }, { value: '' });
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.deepEqual(states(page, WORK).boxes, { work_notes: arabic }, 'the panel is told the box by its own label');
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
  const other = makeWorkspace();
  other.add('textarea', { 'aria-label': 'Close notes' }, { value: '' });
  other.add('textarea', { 'aria-label': 'Customer comments' }, { value: '' });
  assert.deepEqual(states(other, ['close_notes', 'Resolution notes'], COMMENTS).fields, { close_notes: 'editable', comments: 'editable' });
});

test('the label sets stay whole labels: a bare "Comments" (an approval dialog has one) and "Description" for a short description are not matches', () => {
  const page = makeWorkspace();
  page.add('textarea', { 'aria-label': 'Comments' }, { value: '' });
  page.add('textarea', { 'aria-label': 'Description' }, { value: '' });
  const out = states(page, COMMENTS, ['short_description', 'Short description']);
  assert.deepEqual(out.fields, { comments: 'unknown', short_description: 'unknown' });
  assert.deepEqual(out.gaps, { comments: 'absent', short_description: 'absent' });
});

test('the switch of an Arabic Workspace is read together with its Arabic box label', () => {
  const internal = 'ملاحظات العمل';
  const customer = 'تعليقات العميل';
  const page = makeWorkspace();
  const { box } = addComposer(page, { tabs: [internal, customer], selected: 0, boxLabel: internal });
  assert.deepEqual(states(page, WORK).modes, { work_notes: 'match' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
});

test('a component that carries the field\'s label itself and holds a bare box: the box is found, below an own label, and two under one label are still two', () => {
  const page = makeWorkspace();
  const { host, root } = page.host('now-textarea');
  host.setAttribute('label', 'Work notes');
  const box = page.add('textarea', {}, { value: '' }, root);
  assert.deepEqual(states(page, WORK).fields, { work_notes: 'editable' });
  assert.equal(fill(page, WORK).ok, true);
  assert.equal(box.value, 'hello');
  const twice = makeWorkspace();
  const pair = twice.host('now-textarea');
  pair.host.setAttribute('label', 'Work notes');
  twice.add('textarea', {}, { value: '' }, pair.root);
  twice.add('textarea', {}, { value: '' }, pair.root);
  assert.deepEqual(states(twice, WORK).gaps, { work_notes: 'ambiguous' });
  // an own label beats a label on the host
  const both = makeWorkspace();
  const mixed = both.host('now-textarea');
  mixed.host.setAttribute('label', 'Work notes');
  both.add('textarea', {}, { value: 'host label' }, mixed.root);
  const own = both.add('textarea', { 'aria-label': 'Work notes' }, { value: 'own label' }, mixed.root);
  assert.equal(fill(both, WORK).ok, true);
  assert.equal(own.value, 'own label\n\nhello');
});
