const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
import { buildUndoMessage, undoStepOf, undoStillFor, MAX_UNDO_CHARS } from '../src/lib/fillable.js';
import { forgetInserts, insertText, insertTargets, performInsert, undoInserts } from '../src/sidepanel/insertFlow.js';
import { handleFillField, handleUndo } from '../src/content/fill.js';
import { featureById } from '../src/features/registry.js';
import { MSG } from '../src/lib/messages.js';

// Undo after EVERY Insert (round 4, docs/round4.md): the page says what a box held before an insert and what the insert left there;
// the panel keeps both in memory only and can put the earlier text back through FILL_FIELD's 'undo' mode, the last box first, on the
// same record, without saving. A box the agent changed since is never overwritten: Undo says it cannot undo that one safely.

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const RECORD = { table: 'incident', sysId: A };
const pageOf = (over = {}) => ({ tabId: 4, href: `https://x.service-now.com/incident.do?sys_id=${A}`, surface: 'classic', record: { ...RECORD, number: 'INC0010100', kind: 'incident' }, newRecord: null, formStamp: '100:0', ...over });

// ---- The step and the message ---------------------------------------------------------------------------------------------

test('an Undo step comes only from a good answer of an insert bound to a record; the texts are strings of a sane length', () => {
  const answer = { ok: true, method: 'gform', undo: { previous: 'mine', after: 'mine\n\nnew' } };
  assert.deepEqual(undoStepOf(answer, { field: 'comments', fieldLabel: 'Additional comments', expect: RECORD, stamp: '100:0' }), { field: 'comments', fieldLabel: 'Additional comments', previous: 'mine', after: 'mine\n\nnew', expect: RECORD, stamp: '100:0' });
  assert.ok(undoStepOf({ ...answer }, { field: 'close_code', expect: { table: 'incident', newRecord: true } }), 'a blank form is a record to bind to');
  assert.ok(undoStepOf(answer, { field: 'body', expect: { email: true, table: 'incident', sysId: A } }), 'the email form of a record too');
  const none = [
    [null, { field: 'comments', expect: RECORD }],
    [{ ok: false, undo: answer.undo }, { field: 'comments', expect: RECORD }],
    [{ ok: true }, { field: 'comments', expect: RECORD }],
    [answer, { field: 'comments', expect: null }],
    [answer, { field: 'comments', expect: { table: 'incident' } }],
    [answer, { field: 'state', expect: RECORD }],
    [{ ok: true, undo: { previous: 3, after: 'x' } }, { field: 'comments', expect: RECORD }],
    [{ ok: true, undo: { previous: 'x', after: '' } }, { field: 'comments', expect: RECORD }],
    [{ ok: true, undo: { previous: 'same', after: 'same' } }, { field: 'comments', expect: RECORD }],
    [{ ok: true, undo: { previous: 'x'.repeat(MAX_UNDO_CHARS + 1), after: 'y' } }, { field: 'comments', expect: RECORD }],
  ];
  for (const [a, target] of none) assert.equal(undoStepOf(a, target), null, JSON.stringify([a, target]).slice(0, 120));
  const step = undoStepOf(answer, { field: 'comments', fieldLabel: 'Additional comments', expect: RECORD });
  assert.deepEqual(buildUndoMessage(step), { type: MSG.FILL_FIELD, field: 'comments', value: 'mine', current: 'mine\n\nnew', label: 'Additional comments', mode: 'undo', expect: RECORD });
});

test('Undo is offered while the same record is open and was not saved since (the form stamp), and never for another record', () => {
  const step = undoStepOf({ ok: true, undo: { previous: '', after: 'x' } }, { field: 'close_notes', expect: RECORD, stamp: '100:0' });
  assert.equal(undoStillFor(step, pageOf()), true);
  assert.equal(undoStillFor(step, pageOf({ formStamp: '200:0' })), false, 'saved: the form reloaded');
  assert.equal(undoStillFor(step, pageOf({ formStamp: '100:1' })), false, 'saved on a Workspace');
  assert.equal(undoStillFor(step, pageOf({ formStamp: '' })), true, 'a page that does not say keeps it');
  assert.equal(undoStillFor(step, pageOf({ record: { table: 'incident', sysId: B } })), false);
  assert.equal(undoStillFor(null, pageOf()), false);
});

test('every insert (any feature) carries its Undo step; the box\'s memory goes with it', async () => {
  forgetInserts();
  const send = async () => ({ ok: true, method: 'gform', undo: { previous: 'typed', after: 'typed\n\nHello' } });
  const direct = await performInsert({ page: pageOf(), spec: { field: 'comments', fieldLabel: 'Additional comments' }, value: 'Hello', expect: RECORD, send });
  assert.equal(direct.status, 'inserted');
  assert.deepEqual(direct.undo, { field: 'comments', fieldLabel: 'Additional comments', previous: 'typed', after: 'typed\n\nHello', expect: RECORD, stamp: '100:0' });
  assert.equal('undo' in direct.answer, false, 'what the box held is not in the answer the views see');
  const [target] = insertTargets(featureById('reply-draft'), { record: { kind: 'incident' }, page: pageOf() });
  const viaTarget = await insertText({ page: pageOf(), target, text: 'Hello', source: { expect: RECORD, number: 'INC0010100' }, send });
  assert.equal(viaTarget.undo.target, target.key);
  assert.match(viaTarget.undo.box, /\|comments\|reply-draft$/);
  // an older content script (no undo in the answer): no Undo, the insert itself is unchanged
  const old = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'Hello', expect: RECORD, send: async () => ({ ok: true, method: 'gform' }) });
  assert.equal(old.status, 'inserted');
  assert.equal(old.undo, null);
});

// ---- Undo in the panel ------------------------------------------------------------------------------------------------------

function formFor(values) {
  const sent = [];
  const send = async (_tab, message) => {
    sent.push(message);
    if (message.mode !== 'undo') return { ok: false, reason: 'bad-field' };
    if (values[message.field] !== message.current) return { ok: false, reason: 'changed' };
    values[message.field] = message.value;
    return { ok: true, method: 'gform' };
  };
  return { sent, send, values };
}
const stepOf = (field, fieldLabel, previous, after) => undoStepOf({ ok: true, undo: { previous, after } }, { field, fieldLabel, expect: RECORD, stamp: '100:0' });

test('Undo puts both boxes back, the last one first, through FILL_FIELD\'s undo mode; nothing else is sent', async () => {
  const form = formFor({ close_code: 'workaround', close_notes: 'AI notes' });
  const steps = [stepOf('close_code', 'Close code', '', 'workaround'), stepOf('close_notes', 'Resolution notes', 'my draft', 'AI notes')];
  const out = await undoInserts({ page: pageOf(), steps, send: form.send });
  assert.equal(out.status, 'undone');
  assert.deepEqual(form.sent.map((m) => [m.type, m.mode, m.field, m.value, m.current]), [
    [MSG.FILL_FIELD, 'undo', 'close_notes', 'my draft', 'AI notes'],
    [MSG.FILL_FIELD, 'undo', 'close_code', '', 'workaround'],
  ]);
  assert.deepEqual(form.values, { close_code: '', close_notes: 'my draft' });
  assert.equal(out.note, 'Undone: Close code and Resolution notes are back to what they were before. Nothing is saved.');
  const one = await undoInserts({ page: pageOf(), steps: [stepOf('comments', 'Additional comments', '', 'Hi')], send: formFor({ comments: 'Hi' }).send });
  assert.equal(one.note, 'Undone: Additional comments is back to what it was before. Nothing is saved.');
});

test('a box the agent changed since the insert is left alone and said so; the other one still goes back', async () => {
  const form = formFor({ close_code: 'workaround', close_notes: 'AI notes, and my own line' });
  const steps = [stepOf('close_code', 'Close code', '', 'workaround'), stepOf('close_notes', 'Resolution notes', '', 'AI notes')];
  const out = await undoInserts({ page: pageOf(), steps, send: form.send });
  assert.equal(out.status, 'partial');
  assert.equal(form.values.close_notes, 'AI notes, and my own line', 'what the agent typed is kept');
  assert.equal(form.values.close_code, '');
  assert.match(out.note, /Resolution notes was changed after the insert, so Agent Buddy cannot undo it safely\. Change it by hand if you need to\./);
  assert.match(out.note, /^Undone: Close code is back/);
  // nothing could go back
  const both = await undoInserts({ page: pageOf(), steps, send: formFor({ close_code: 'other', close_notes: 'other' }).send });
  assert.equal(both.status, 'failed');
  assert.deepEqual(both.undone, []);
});

test('Undo on another record, or after a Save, sends nothing; a page that does not answer is said plainly', async () => {
  const steps = [stepOf('close_notes', 'Resolution notes', '', 'AI notes')];
  for (const page of [pageOf({ record: { table: 'incident', sysId: B } }), pageOf({ formStamp: '300:0' })]) {
    const form = formFor({ close_notes: 'AI notes' });
    const out = await undoInserts({ page, steps, send: form.send });
    assert.deepEqual(form.sent, []);
    assert.equal(out.status, 'failed');
    assert.match(out.note, /no longer open, so it was not put back/);
  }
  const silent = await undoInserts({ page: pageOf(), steps, send: async () => { throw new Error('gone'); } });
  assert.match(silent.note, /^Resolution notes could not be put back\. Agent Buddy could not reach a form field on this page\.$/);
  assert.deepEqual((await undoInserts({ page: pageOf(), steps: [null, { field: 'state' }], send: async () => ({ ok: true }) })).undone, []);
});

// ---- The content script: every argument checked before the page is asked -------------------------------------------------

function content({ answer = { ok: true, method: 'gform' }, record = RECORD } = {}) {
  const calls = [];
  const deps = {
    callPage: async (action, args) => {
      calls.push({ action, args });
      return typeof answer === 'function' ? answer(action, args) : answer;
    },
    currentRecord: async () => record,
    currentNewRecord: async () => null,
    href: () => 'https://x.service-now.com/incident.do',
  };
  return { calls, run: (message) => handleFillField(message, deps), undo: (message) => handleUndo(message, deps) };
}
const UNDO = { type: MSG.FILL_FIELD, mode: 'undo', field: 'close_notes', value: '', current: 'AI notes', label: 'Resolution notes', expect: RECORD };

test('content script: an Undo goes to the bridge as restoreField with the field, the earlier text, what must still be there', async () => {
  const c = content();
  assert.deepEqual(await c.run(UNDO), { ok: true, method: 'gform' });
  assert.deepEqual(c.calls, [{ action: 'restoreField', args: ['close_notes', '', 'AI notes', 'Resolution notes', { choice: false }] }]);
  const code = content();
  await code.run({ ...UNDO, field: 'close_code', value: 'permanent', current: 'workaround' });
  assert.deepEqual(code.calls[0].args[4], { choice: true });
  // the page's refusals come back as they are (a page cannot claim wrong-record), anything else is no-form
  assert.deepEqual(await content({ answer: { ok: false, reason: 'changed' } }).run(UNDO), { ok: false, reason: 'changed' });
  assert.deepEqual(await content({ answer: { ok: false, reason: 'wrong-record' } }).run(UNDO), { ok: false, reason: 'no-form' });
  assert.deepEqual(await content({ answer: { ok: 'yes' } }).run(UNDO), { ok: false, reason: 'no-form' });
  assert.deepEqual(await content({ answer: () => { throw new Error('x'); } }).run(UNDO), { ok: false, reason: 'no-form' });
});

test('content script: an Undo with a bad field, odd texts, no record or another record never reaches the page', async () => {
  const bad = [
    [{ ...UNDO, field: 'state' }, 'bad-field'],
    [{ ...UNDO, field: '__proto__' }, 'bad-field'],
    [{ ...UNDO, field: 42 }, 'bad-field'],
    [{ ...UNDO, value: 7 }, 'bad-field'],
    [{ ...UNDO, value: undefined }, 'bad-field'],
    [{ ...UNDO, current: '' }, 'bad-field'],
    [{ ...UNDO, current: '   ' }, 'bad-field'],
    [{ ...UNDO, current: { toString: () => 'AI notes' } }, 'bad-field'],
    [{ ...UNDO, value: 'x'.repeat(20001) }, 'too-long'],
    [{ ...UNDO, current: 'x'.repeat(20001) }, 'too-long'],
    [{ ...UNDO, expect: undefined }, 'wrong-record'],
    [{ ...UNDO, expect: null }, 'wrong-record'],
    [{ ...UNDO, expect: { table: 'incident' } }, 'wrong-record'],
    [{ ...UNDO, expect: { table: 'incident', sysId: B } }, 'wrong-record'],
  ];
  for (const [message, reason] of bad) {
    const c = content();
    assert.deepEqual(await c.run(message), { ok: false, reason }, JSON.stringify(message).slice(0, 140));
    assert.deepEqual(c.calls, []);
  }
  // the earlier text may be empty (the box was empty before the insert), and the label is cut
  const c = content();
  await c.run({ ...UNDO, label: 'L'.repeat(300) });
  assert.equal(c.calls[0].args[3].length, 100);
});

test('content script: an insert passes on what the page says the box held, as strings only; a forged answer gives no Undo', async () => {
  const good = content({ answer: { ok: true, method: 'gform', previous: 'mine', after: 'mine\n\nnew' } });
  assert.deepEqual(await good.run({ field: 'comments', value: 'new', mode: 'append', expect: RECORD }), { ok: true, method: 'gform', undo: { previous: 'mine', after: 'mine\n\nnew' } });
  for (const answer of [{ ok: true, method: 'gform', previous: 1, after: 'x' }, { ok: true, method: 'gform', previous: 'x' }, { ok: true, method: 'dom', previous: 'x'.repeat(20001), after: 'y' }]) {
    const out = await content({ answer }).run({ field: 'comments', value: 'new', mode: 'append', expect: RECORD });
    assert.equal(out.ok, true);
    assert.equal('undo' in out, false, JSON.stringify(answer).slice(0, 80));
  }
});

// ---- The page bridge: restoreField ---------------------------------------------------------------------------------------

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');

class Box {
  constructor(doc, attrs, value = '') {
    Object.assign(this, { ownerDocument: doc, tagName: 'TEXTAREA', attrs, _value: value, events: [], labels: [], hidden: false, disabled: false, readOnly: false, maxLength: -1, shadowRoot: null });
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._value = String(v);
  }

  getClientRects() {
    return [{ width: 300, height: 60, right: 400 }];
  }

  getRootNode() {
    return this.ownerDocument;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

function bridgePage({ url = 'https://x.service-now.com/incident.do', window: extra = {}, boxes = [] } = {}) {
  const u = new URL(url);
  let listener = null;
  const responses = [];
  const doc = { addEventListener: (type, fn) => type === 'ab-page-request' && (listener = fn), dispatchEvent: (e) => responses.push(e), querySelectorAll: () => doc.boxes, querySelector: () => null, getElementById: () => null };
  const sandbox = {
    document: doc,
    location: { pathname: u.pathname, search: u.search, hash: u.hash },
    frames: [],
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    HTMLTextAreaElement: Box,
    HTMLInputElement: Box,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    ...extra,
  };
  sandbox.window = sandbox;
  doc.defaultView = sandbox;
  doc.boxes = boxes.map(([attrs, value]) => new Box(doc, attrs, value));
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE, sandbox);
  return {
    boxes: doc.boxes,
    call(action, args) {
      responses.length = 0;
      listener({ detail: { id: 'r', action, args } });
      const detail = responses[responses.length - 1].detail;
      assert.equal(detail.ok, true, detail.error);
      return JSON.parse(JSON.stringify(detail.result ?? null));
    },
  };
}

function gForm(values, editable = null) {
  const sets = [];
  const g_form = { hasField: (n) => n in values, getValue: (n) => values[n], setValue: (n, v) => { sets.push([n, v]); values[n] = v; }, getEditableFields: () => editable || Object.keys(values), isReadOnly: () => true };
  return { g_form, sets, values };
}

test('bridge, classic form: restoreField puts the earlier value back only while the field still holds what the insert left', () => {
  const form = gForm({ close_code: 'workaround', close_notes: 'AI notes' });
  const page = bridgePage({ window: { g_form: form.g_form } });
  assert.deepEqual(page.call('restoreField', ['close_notes', 'my draft', 'AI notes', 'Resolution notes', { choice: false }]), { ok: true, method: 'gform' });
  assert.deepEqual(page.call('restoreField', ['close_code', '', 'workaround', 'Close code', { choice: true }]), { ok: true, method: 'gform' });
  assert.deepEqual(form.sets, [['close_notes', 'my draft'], ['close_code', '']]);
  // the agent typed since: refused, nothing set
  form.values.close_notes = 'AI notes, edited';
  assert.deepEqual(page.call('restoreField', ['close_notes', '', 'AI notes', '', {}]), { ok: false, reason: 'changed' });
  assert.equal(form.sets.length, 2);
  // a locked or missing field, as fillField
  const locked = gForm({ close_notes: 'AI notes' }, ['work_notes']);
  assert.deepEqual(bridgePage({ window: { g_form: locked.g_form } }).call('restoreField', ['close_notes', '', 'AI notes', '', {}]), { ok: false, reason: 'read-only' });
  assert.deepEqual(bridgePage({ window: { g_form: gForm({}).g_form } }).call('restoreField', ['close_notes', '', 'AI notes', '', {}]), { ok: false, reason: 'no-such-field' });
});

test('bridge, Workspace: the box an insert would use is put back when it still holds the insert; a choice never; odd arguments refused', () => {
  const WS = `https://x.service-now.com/now/sow/record/incident/${A}`;
  const page = bridgePage({ url: WS, boxes: [[{ 'aria-label': 'Resolution notes' }, 'AI notes']] });
  assert.deepEqual(page.call('restoreField', ['close_notes', 'before', 'AI notes', 'Resolution notes', {}]), { ok: true, method: 'dom' });
  assert.equal(page.boxes[0].value, 'before');
  assert.deepEqual(page.boxes[0].events, ['input', 'change'], 'the way typing would, so the page keeps up');
  // typed since (more than spaces): left alone
  page.boxes[0]._value = 'before, and more';
  assert.deepEqual(page.call('restoreField', ['close_notes', '', 'before', 'Resolution notes', {}]), { ok: false, reason: 'changed' });
  assert.equal(page.boxes[0].value, 'before, and more');
  assert.deepEqual(page.call('restoreField', ['close_code', '', 'workaround', 'Close code', { choice: true }]), { ok: false, reason: 'choice-by-hand' });
  const odd = [
    [['password', '', 'x', '', {}], 'bad-field'],
    [['Close_Notes', '', 'x', '', {}], 'bad-field'],
    [['close_notes', 3, 'x', '', {}], 'bad-field'],
    [['close_notes', '', '', '', {}], 'bad-field'],
    [['close_notes', '', null, '', {}], 'bad-field'],
    [['close_notes', 'x'.repeat(20001), 'AI notes', '', {}], 'too-long'],
  ];
  for (const [args, reason] of odd) assert.deepEqual(page.call('restoreField', args), { ok: false, reason }, JSON.stringify(args).slice(0, 80));
  // the insert reports what the box held and holds, for the Undo
  const fresh = bridgePage({ url: WS, boxes: [[{ 'aria-label': 'Work notes' }, 'mine']] });
  assert.deepEqual(fresh.call('fillField', ['work_notes', 'new', 'Work notes', true, '', '', { undo: true }]), { ok: true, method: 'dom', label: 'Work notes', modeUnread: true, previous: 'mine', after: 'mine\n\nnew' }); // (modeUnread: a Workspace box with no composer switch to read, audit 2026-11-07 W-12)
});
