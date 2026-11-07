// W-01 of the audit of 2026-11-07 (docs/live-questions/audit-1107-roles.md): a closed or locked form answers getEditableFields() with
// an empty list, and the bridge took that for "everything is editable": Insert was on, setValue ran, the panel said "Inserted". The
// bridge now (1) trusts the list only when it names fields, (2) says "locked" when the form's own state clearly says closed, (3) reads
// the value back after every write and answers "not inserted" when the field does not hold the text, and (4) never uses a write to
// find out whether a field can be written. Undo is honest the same way.
const test = require('node:test');
const assert = require('node:assert/strict');
import { loadBridge, fakeForm } from './bridge-fixtures.js';

const ask = (form, action, args) => loadBridge({ g_form: form }).ask(action, args);
const fill = (form, name = 'work_notes', text = 'hello', extra = {}) => ask(form, 'fillField', [name, text, 'Work notes', true, '', '', { undo: true, ...extra }]);

test('an empty list on a form that is closed (Active is false, the form has a State) is locked: no write is made at all', () => {
  const form = fakeForm({ values: { work_notes: '', comments: '', active: 'false', state: '7' }, editable: [] });
  assert.deepEqual(fill(form), { ok: false, reason: 'read-only' });
  assert.deepEqual(form.sets, [], 'nothing was written to find out');
  assert.deepEqual(ask(form, 'getFieldStates', [['work_notes', 'comments'], ['', '']]).fields, { work_notes: 'read-only', comments: 'read-only' });
});

test('an empty list on a form that is not clearly closed is "cannot tell": the insert is tried and read back, and it takes', () => {
  const form = fakeForm({ values: { work_notes: 'typed', active: 'true', state: '2' }, editable: [] });
  assert.deepEqual(ask(form, 'getFieldStates', [['work_notes'], ['']]).fields, { work_notes: 'unknown' });
  const out = fill(form);
  assert.equal(out.ok, true);
  assert.equal(out.method, 'gform');
  assert.equal(form.held.work_notes, 'typed\n\nhello');
  assert.deepEqual(form.sets.map(([name]) => name), ['work_notes'], 'only the field the person asked for');
  assert.deepEqual([out.previous, out.after], ['typed', 'typed\n\nhello']);
});

test('the same empty list, but the field is locked and ignores the write: read back, it did not take, so it is not inserted', () => {
  const form = fakeForm({ values: { work_notes: 'typed' }, editable: [], locked: ['work_notes'] });
  assert.deepEqual(fill(form), { ok: false, reason: 'read-only' });
  assert.equal(form.held.work_notes, 'typed', 'the box is as it was');
  assert.equal(form.sets.length, 1, 'one write, the one the person asked for; nothing else was touched');
});

test('a form with no getEditableFields at all is "cannot tell" too, not "editable", and not "locked" by itself', () => {
  const open = fakeForm({ values: { comments: '' }, editable: 'absent' });
  assert.deepEqual(ask(open, 'getFieldStates', [['comments'], ['']]).fields, { comments: 'unknown' });
  assert.equal(ask(open, 'fillField', ['comments', 'hi', '', false, '', '', { undo: true }]).ok, true);
  const shut = fakeForm({ values: { comments: '' }, editable: 'absent', locked: ['comments'] });
  assert.deepEqual(ask(shut, 'fillField', ['comments', 'hi', '', false]), { ok: false, reason: 'read-only' });
});

test('a getEditableFields that throws is "cannot tell", never a crash and never an answer', () => {
  const form = fakeForm({ values: { work_notes: '' }, editable: 'throws' });
  assert.deepEqual(ask(form, 'getFieldStates', [['work_notes'], ['']]).fields, { work_notes: 'unknown' });
  assert.equal(fill(form).ok, true);
});

test('a list that names fields decides: the field is in it (editable) or not (read-only, no write); isReadOnly does not have to exist', () => {
  for (const isReadOnly of [true, false]) {
    const form = fakeForm({ values: { work_notes: '', comments: '' }, editable: ['comments'], isReadOnly });
    assert.deepEqual(ask(form, 'getFieldStates', [['work_notes', 'comments', 'nope'], ['', '', '']]).fields, { work_notes: 'read-only', comments: 'editable', nope: 'missing' });
    assert.deepEqual(fill(form, 'work_notes'), { ok: false, reason: 'read-only' });
    assert.deepEqual(form.sets, [], 'a field the list does not name is never written');
    assert.equal(fill(form, 'comments').ok, true);
  }
});

test('an inactive knowledge article (Active is false, no State box) is not a closed ticket', () => {
  const form = fakeForm({ values: { text: '', active: 'false' }, editable: [], types: { text: 'html' } });
  assert.deepEqual(ask(form, 'getFieldStates', [['text'], ['']]).fields, { text: 'unknown' });
});

test('a field that is missing from the form is missing, whatever the list says', () => {
  const form = fakeForm({ values: { work_notes: '' }, editable: [] });
  assert.deepEqual(ask(form, 'fillField', ['comments', 'hi', '', false]), { ok: false, reason: 'no-such-field' });
  assert.deepEqual(ask(form, 'getFieldStates', [['comments'], ['']]).fields, { comments: 'missing' });
});

test('a client script that rewrites the value as it is set: the earlier text goes back, and nothing is claimed', () => {
  const form = fakeForm({ values: { work_notes: 'typed' }, editable: [], rewrite: (_n, v) => (v.includes('hello') ? 'something else' : v) });
  assert.deepEqual(fill(form), { ok: false, reason: 'set-failed' });
  assert.equal(form.held.work_notes, 'typed', 'put back what was there');
});

test('white-space the form tidies is not a failure', () => {
  const form = fakeForm({ values: { work_notes: '' }, editable: ['work_notes'], rewrite: (_n, v) => v.replace(/\n/g, '\r\n') });
  assert.equal(ask(form, 'fillField', ['work_notes', 'Line one\nLine two', '', false]).ok, true);
});

test('a rich-text field that tidies its markup keeps its answer; one that ignores the write is locked', () => {
  const tidy = fakeForm({ values: { text: '' }, editable: ['text'], types: { text: 'html' }, rewrite: (_n, v) => `<div>${v}</div>` });
  assert.equal(ask(tidy, 'fillField', ['text', 'Body', '', false, '<p>Body</p>']).ok, true);
  const frozen = fakeForm({ values: { text: '<p>Old</p>' }, editable: [], types: { text: 'html' }, locked: ['text'] });
  assert.deepEqual(ask(frozen, 'fillField', ['text', 'Body', '', false, '<p>Body</p>']), { ok: false, reason: 'read-only' });
});

test('a choice (the close code): a locked box is locked, a value the form does not list is no choice, a good one takes', () => {
  const options = { close_code: ['Solved (Work Around)', 'Solved (Permanently)'] };
  const choose = (form, value) => ask(form, 'fillField', ['close_code', value, 'Close code', false, '', '', { choice: true, undo: true }]);
  assert.equal(choose(fakeForm({ values: { close_code: '' }, editable: [], options }), 'Solved (Permanently)').ok, true);
  assert.deepEqual(choose(fakeForm({ values: { close_code: '' }, editable: [], options }), 'Made up'), { ok: false, reason: 'no-such-choice' });
  const locked = fakeForm({ values: { close_code: '' }, editable: [], options, locked: ['close_code'] });
  assert.deepEqual(choose(locked, 'Solved (Permanently)'), { ok: false, reason: 'read-only' });
  assert.equal(locked.held.close_code, '');
});

test('Undo reads back too: a locked box keeps what the insert left, and Undo says so instead of claiming it was put back', () => {
  const restore = (form, previous, expected) => ask(form, 'restoreField', ['work_notes', previous, expected, 'Work notes', {}]);
  const open = fakeForm({ values: { work_notes: 'typed\n\nhello' }, editable: [] });
  assert.deepEqual(restore(open, 'typed', 'typed\n\nhello'), { ok: true, method: 'gform' });
  assert.equal(open.held.work_notes, 'typed');
  const locked = fakeForm({ values: { work_notes: 'typed\n\nhello' }, editable: [], locked: ['work_notes'] });
  assert.deepEqual(restore(locked, 'typed', 'typed\n\nhello'), { ok: false, reason: 'read-only' });
  const closed = fakeForm({ values: { work_notes: 'typed\n\nhello', active: 'false', state: '7' }, editable: [] });
  assert.deepEqual(restore(closed, 'typed', 'typed\n\nhello'), { ok: false, reason: 'read-only' });
  assert.deepEqual(closed.sets, [], 'a closed ticket is not written to, not even to undo');
  const typedSince = fakeForm({ values: { work_notes: 'typed\n\nhello, and more' }, editable: [] });
  assert.deepEqual(restore(typedSince, 'typed', 'typed\n\nhello'), { ok: false, reason: 'changed' });
  assert.deepEqual(typedSince.sets, []);
  const named = fakeForm({ values: { work_notes: 'typed\n\nhello' }, editable: ['comments'] });
  assert.deepEqual(restore(named, 'typed', 'typed\n\nhello'), { ok: false, reason: 'read-only' });
});

test('the bridge has no way to save, submit or write over REST, and getFieldStates only reads', () => {
  const form = fakeForm({ values: { work_notes: '', comments: '' }, editable: [] });
  ask(form, 'getFieldStates', [['work_notes', 'comments'], ['', '']]);
  assert.deepEqual(form.sets, [], 'asking whether a field can be filled writes nothing');
  assert.ok(!/\.save\(|\.submit\(|XMLHttpRequest|fetch\(|sendBeacon/.test(loadBridgeSource()), 'no save, no network');
});

function loadBridgeSource() {
  return require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
}
