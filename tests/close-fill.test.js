const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
import { featureById } from '../src/features/registry.js';
import { PREPARE_CLOSE } from '../src/features/packs/close.js';
import { applyFieldStates, forgetInserts, insertCloseAndNotes, insertTargets, closeFilledNote } from '../src/sidepanel/insertFlow.js';
import { CODE_KINDS, closePlan, codeTargetFor } from '../src/sidepanel/ticket/assist/answers/prepareClose.js';
import { closeCodeVote } from '../src/insights/closeCode.js';
import { FILLABLE_FIELDS, isChoiceField, isCustomerVisible, isSingleLineField, fillReasonText } from '../src/lib/fillable.js';
import { MAX_CHOICE_CHARS, handleFillField } from '../src/content/fill.js';
import { MSG } from '../src/lib/messages.js';

// Prepare to close's Insert (round 4, docs/round4.md; the user's named exception to "one field", docs/build-rules.md rule 1): the
// close code first, by its STORED value, then the notes in the right box for the kind, one FILL_FIELD each. A classic form sets the
// choice through g_form; a Workspace or a portal page is told to pick it by hand, and only the notes go in. Nothing is ever saved.

const A = 'a'.repeat(32);
const pageOf = (over = {}) => ({ tabId: 3, href: `https://x.service-now.com/incident.do?sys_id=${A}`, surface: 'classic', record: { table: 'incident', sysId: A, number: 'INC0010100', kind: 'incident' }, newRecord: null, formStamp: '1:0', ...over });
const source = { expect: { table: 'incident', sysId: A }, number: 'INC0010100' };
const vote = closeCodeVote([1, 2, 3, 4, 5].map((n) => ({ number: `INC000000${n}`, close_code: n < 5 ? 'Solved (Work Around)' : 'Solved (Permanently)', close_code_value: n < 5 ? 'workaround' : 'permanent' })));
const notesOf = (kind, page = pageOf()) => insertTargets(featureById(PREPARE_CLOSE), { record: { kind }, page });
const NOTES = 'Cause: the VPN profile cache was corrupt.\nFix: cleared the cache and reinstalled the client.\nVerification: the user confirmed the VPN stays up.';

// A form behind FILL_FIELD: the panel's view of the content script (values per field; previous and after for Undo).
function formSend({ refuse = {}, values = {} } = {}) {
  const sent = [];
  const send = async (_tab, message) => {
    sent.push(message);
    if (refuse[message.field]) return { ok: false, reason: refuse[message.field] };
    const previous = values[message.field] ?? '';
    values[message.field] = message.value;
    return { ok: true, method: 'gform', undo: { previous, after: message.value } };
  };
  return { sent, send, values };
}

test('close_code is fillable: one line, a choice, not customer-visible (no send check on a code of the instance\'s own list)', () => {
  assert.deepEqual(FILLABLE_FIELDS.close_code, { singleLine: true, choice: true });
  assert.equal(isChoiceField('close_code'), true);
  assert.equal(isSingleLineField('close_code'), true);
  assert.equal(isCustomerVisible('close_code'), false);
  for (const name of Object.keys(FILLABLE_FIELDS).filter((n) => n !== 'close_code')) assert.equal(isChoiceField(name), false, name);
  assert.ok(Object.isFrozen(FILLABLE_FIELDS.close_code));
  assert.deepEqual(CODE_KINDS, ['incident'], 'a case and a problem keep their code in resolution_code, which is not filled');
});

test('the plan: the code by its VALUE (never the label) first, on an incident on a classic form; the line says what is filled', () => {
  const [notes] = notesOf('incident');
  assert.equal(notes.field, 'close_notes');
  const code = codeTargetFor({ kind: 'incident', surface: 'classic' });
  assert.equal(code.field, 'close_code');
  assert.equal(code.mode, 'replace');
  const plan = closePlan({ kind: 'incident', surface: 'classic', vote, notes, code, form: 'gform' });
  assert.equal(plan.code.value, 'workaround', 'the stored value a choice field takes');
  assert.equal(plan.code.label, 'Solved (Work Around)');
  assert.equal(plan.byHand, '');
  assert.equal(plan.line, 'Insert fills Close code and Resolution notes on the open form. Nothing is saved until you press Save.');
});

test('the plan: the notes box per kind; the code by hand on a case, a Workspace, a portal or a form without the field; none without a vote', () => {
  const code = codeTargetFor({ kind: 'incident' });
  const cases = [
    ['requested_item', 'close_notes', 'Close notes'],
    ['catalog_task', 'close_notes', 'Close notes'],
    ['task', 'close_notes', 'Close notes'],
    ['case', 'close_notes', 'Resolution notes'],
    ['problem', 'fix_notes', 'Fix notes'],
  ];
  for (const [kind, field, label] of cases) {
    const [notes] = notesOf(kind);
    assert.equal(notes.field, field, kind);
    const plan = closePlan({ kind, vote: null, notes, code: CODE_KINDS.includes(kind) ? code : null });
    assert.equal(plan.code, null, kind);
    assert.equal(plan.line, `Insert fills ${label} on the open form. Nothing is saved until you press Save.`, kind);
  }
  assert.deepEqual(notesOf('problem').map((x) => x.field), ['fix_notes', 'cause_notes'], 'a problem: fix notes, the cause under More');
  // a case with a vote: said, to pick by hand (its code is resolution_code)
  const [caseNotes] = notesOf('case');
  const onCase = closePlan({ kind: 'case', vote, notes: caseNotes, code: null });
  assert.equal(onCase.code, null);
  assert.equal(onCase.byHand, 'Solved (Work Around)');
  assert.match(onCase.line, /Choose the close code Solved \(Work Around\) yourself\.$/);
  // a Workspace or a portal: the code is never tried there
  const [notes] = notesOf('incident');
  for (const where of [{ surface: 'workspace' }, { surface: 'portal' }, { surface: 'classic', form: 'workspace' }, { surface: 'other', form: 'portal' }]) {
    const plan = closePlan({ kind: 'incident', vote, notes, code, ...where });
    assert.equal(plan.code, null, JSON.stringify(where));
    assert.equal(plan.byHand, 'Solved (Work Around)', JSON.stringify(where));
    assert.equal(plan.line, 'Insert fills Resolution notes on the open form. Nothing is saved until you press Save. Choose the close code Solved (Work Around) yourself.');
  }
  // the form says the field is not there, or locked: by hand
  const [missing] = applyFieldStates([code], { known: true, form: 'gform', fields: { close_code: { state: 'missing' } } });
  assert.ok(missing.blocked);
  assert.equal(closePlan({ kind: 'incident', vote, notes, code: missing, form: 'gform' }).byHand, 'Solved (Work Around)');
  // the ticket has that code already: nothing to fill, nothing to say
  const same = closeCodeVote([1, 2].map((n) => ({ number: `INC000000${n}`, close_code: 'Solved (Work Around)', close_code_value: 'workaround' })), { current: 'workaround' });
  const done = closePlan({ kind: 'incident', vote: same, notes, code, form: 'gform' });
  assert.deepEqual([done.code, done.byHand], [null, '']);
});

test('one Insert: the code first, then the notes, one FILL_FIELD each, both bound to the record; the status names both; nothing is saved', async () => {
  forgetInserts();
  const [notes] = notesOf('incident');
  const code = codeTargetFor({ kind: 'incident' });
  const plan = closePlan({ kind: 'incident', vote, notes, code, form: 'gform' });
  const form = formSend();
  const out = await insertCloseAndNotes({ page: pageOf(), code: plan.code, notes: { target: notes, text: NOTES, mode: notes.mode }, source, send: form.send });
  assert.equal(out.status, 'inserted');
  assert.equal(out.code, 'filled');
  assert.deepEqual(form.sent.map((m) => [m.type, m.field, m.mode]), [[MSG.FILL_FIELD, 'close_code', 'replace'], [MSG.FILL_FIELD, 'close_notes', 'replace']]);
  assert.equal(form.sent[0].value, 'workaround', 'the value, not the label');
  assert.equal(form.sent[1].value, NOTES);
  for (const m of form.sent) assert.deepEqual(m.expect, { table: 'incident', sysId: A });
  assert.equal(out.note, 'Filled Close code and Resolution notes. Press Save in ServiceNow to keep them.');
  assert.deepEqual(out.undo.map((s) => s.field), ['close_code', 'close_notes'], 'an Undo step per box, in the order they went in');
  assert.ok(!form.sent.some((m) => /save|submit/i.test(JSON.stringify(m.type))), 'no message but FILL_FIELD');
});

test('the review stops the notes BEFORE anything is written; "Insert anyway" (force) writes both', async () => {
  forgetInserts();
  const [notes] = notesOf('incident');
  const plan = closePlan({ kind: 'incident', vote, notes, code: codeTargetFor({ kind: 'incident' }), form: 'gform' });
  const form = formSend();
  const risky = `${NOTES}\nThe new password is Welcome123!`;
  const stopped = await insertCloseAndNotes({ page: pageOf(), code: plan.code, notes: { target: notes, text: risky }, source, send: form.send });
  assert.equal(stopped.status, 'findings');
  assert.ok(stopped.items.length > 0);
  assert.deepEqual(form.sent, [], 'the close code was not filled either');
  const forced = await insertCloseAndNotes({ page: pageOf(), code: plan.code, notes: { target: notes, text: risky }, source, force: true, send: form.send });
  assert.equal(forced.status, 'inserted');
  assert.deepEqual(form.sent.map((m) => m.field), ['close_code', 'close_notes']);
});

test('the page cannot set the choice (Workspace, portal, not in this form\'s list): only the notes go in, and the status says which code to pick', async () => {
  forgetInserts();
  const [notes] = notesOf('incident');
  const code = codeTargetFor({ kind: 'incident' });
  for (const reason of ['choice-by-hand', 'no-such-choice', 'no-form']) {
    const form = formSend({ refuse: { close_code: reason } });
    const out = await insertCloseAndNotes({ page: pageOf(), code: { target: code, value: 'workaround', label: 'Solved (Work Around)' }, notes: { target: notes, text: NOTES }, source, send: form.send });
    assert.equal(out.status, 'inserted', reason);
    assert.equal(out.code, 'by-hand', reason);
    assert.equal(out.codeWhy, fillReasonText(reason));
    assert.deepEqual(form.sent.map((m) => m.field), ['close_code', 'close_notes'], reason);
    assert.equal(out.note, 'Filled Resolution notes. Press Save in ServiceNow to keep it. Choose the close code Solved (Work Around) yourself.');
    assert.deepEqual(out.undo.map((s) => s.field), ['close_notes'], 'only what went in can be undone');
  }
  // planned by hand from the start (a Workspace): the code is never sent
  const ws = formSend();
  const wsPage = pageOf({ surface: 'workspace', href: `https://x.service-now.com/now/sow/record/incident/${A}` });
  const plan = closePlan({ kind: 'incident', surface: 'workspace', vote, notes, code });
  const out = await insertCloseAndNotes({ page: wsPage, code: plan.code, notes: { target: notes, text: NOTES }, source, send: ws.send });
  assert.deepEqual(ws.sent.map((m) => m.field), ['close_notes']);
  assert.equal(out.code, 'none');
  // the notes box was found by its label on a page without g_form: it is named
  assert.equal(closeFilledNote({ filled: [notes], label: 'Resolution notes' }), 'Filled Resolution notes. Press Save in ServiceNow to keep it. It went into the box labelled "Resolution notes".');
});

test('the notes cannot go in: the outcome says why (the card then copies them), and the code that went in can still be undone', async () => {
  forgetInserts();
  const [notes] = notesOf('incident');
  const form = formSend({ refuse: { close_notes: 'no-form' } });
  const out = await insertCloseAndNotes({ page: pageOf(), code: { target: codeTargetFor({ kind: 'incident' }), value: 'workaround', label: 'Solved (Work Around)' }, notes: { target: notes, text: NOTES }, source, send: form.send });
  assert.equal(out.status, 'failed');
  assert.equal(out.why, fillReasonText('no-form'));
  assert.equal(out.code, 'filled');
  assert.deepEqual(out.undo.map((s) => s.field), ['close_code']);
  // empty notes or a blocked box: nothing is written at all
  const none = formSend();
  assert.equal((await insertCloseAndNotes({ page: pageOf(), code: null, notes: { target: notes, text: '  ' }, source, send: none.send })).status, 'empty');
  assert.equal((await insertCloseAndNotes({ page: pageOf(), code: null, notes: { target: { ...notes, blocked: 'Not here.' }, text: NOTES }, source, send: none.send })).status, 'blocked');
  assert.deepEqual(none.sent, []);
});

// ---- The content script: a choice gets through as a short one-line value, flagged for the bridge ----------------------------

function content({ answer = { ok: true, method: 'gform', previous: '', after: 'x' }, record = { table: 'incident', sysId: A } } = {}) {
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
  return { calls, run: (message) => handleFillField(message, deps) };
}

test('content script: the close code goes to the bridge as a replace, on one line, flagged as a choice; a long "value" is refused', async () => {
  const c = content();
  const out = await c.run({ field: 'close_code', value: '  workaround\n', mode: 'append', expect: { table: 'incident', sysId: A } });
  assert.equal(out.ok, true);
  const [field, text, , append, html, , options] = c.calls[0].args;
  assert.deepEqual([field, text, append, html], ['close_code', 'workaround', false, '']);
  assert.deepEqual(options, { choice: true, undo: true });
  const notes = content();
  await notes.run({ field: 'close_notes', value: 'x', mode: 'replace' });
  assert.deepEqual(notes.calls[0].args[6], { choice: false, undo: true });
  const long = content();
  assert.deepEqual(await long.run({ field: 'close_code', value: 'x'.repeat(MAX_CHOICE_CHARS + 1) }), { ok: false, reason: 'too-long' });
  assert.deepEqual(long.calls, []);
  // the bridge's refusals reach the panel as they are; anything else is 'no-form'
  for (const reason of ['choice-by-hand', 'no-such-choice']) assert.deepEqual(await content({ answer: { ok: false, reason } }).run({ field: 'close_code', value: 'workaround' }), { ok: false, reason });
  assert.deepEqual(await content({ answer: { ok: false, reason: 'clicked-it' } }).run({ field: 'close_code', value: 'workaround' }), { ok: false, reason: 'no-form' });
});

// ---- The page bridge (it runs in the page; here in a vm) ---------------------------------------------------------------------

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');

class Box {
  constructor(doc, attrs, value = '') {
    this.ownerDocument = doc;
    this.tagName = 'TEXTAREA';
    this.attrs = attrs;
    this._value = value;
    this.events = [];
    this.labels = [];
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.maxLength = -1;
    this.shadowRoot = null;
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

/** A page with the bridge: `window` adds globals (g_form), `boxes` are the controls a page without g_form has. */
function bridgePage({ url = 'https://x.service-now.com/incident.do', window: extra = {}, boxes = [] } = {}) {
  const u = new URL(url);
  let listener = null;
  const responses = [];
  const doc = {
    addEventListener: (type, fn) => {
      if (type === 'ab-page-request') listener = fn;
    },
    dispatchEvent: (event) => {
      responses.push(event);
      return true;
    },
    querySelectorAll: () => doc.boxes,
    querySelector: () => null,
    getElementById: () => null,
    boxes: [],
  };
  const sandbox = {
    document: doc,
    location: { pathname: u.pathname, search: u.search, hash: u.hash },
    frames: [],
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
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

/** A classic form's g_form: values per field, the choices of close_code, what was set. */
function gForm({ values = {}, choices = ['workaround', 'permanent'], editable = null, getOption = true, keepsUnknown = false } = {}) {
  const sets = [];
  const g_form = {
    hasField: (n) => Object.prototype.hasOwnProperty.call(values, n),
    getValue: (n) => values[n],
    setValue: (n, v) => {
      sets.push([n, v]);
      // a choice list takes only one of its values (a select element without that option ends up empty)
      values[n] = n === 'close_code' && !keepsUnknown && !choices.includes(v) && v !== '' ? '' : v;
    },
    getEditableFields: () => editable || Object.keys(values),
    isReadOnly: () => true,
    ...(getOption ? { getOption: (n, v) => (n === 'close_code' && choices.includes(v) ? { value: v } : null) } : {}),
  };
  return { g_form, sets, values };
}

test('bridge, classic form: the choice is set through g_form by its value, and the answer says what it held before and after', () => {
  const form = gForm({ values: { close_code: '', close_notes: 'typed' } });
  const page = bridgePage({ window: { g_form: form.g_form } });
  assert.deepEqual(page.call('fillField', ['close_code', 'workaround', 'Close code', false, '', '', { choice: true, undo: true }]), { ok: true, method: 'gform', previous: '', after: 'workaround' });
  assert.deepEqual(form.sets, [['close_code', 'workaround']]);
  // every other field reports the same (for Undo); without the undo flag nothing extra is said, as before
  assert.deepEqual(page.call('fillField', ['close_notes', 'Cleared the cache.', '', false, '', '', { choice: false, undo: true }]), { ok: true, method: 'gform', previous: 'typed', after: 'Cleared the cache.' });
  assert.deepEqual(page.call('fillField', ['close_notes', 'Again.', '', false, '']), { ok: true, method: 'gform' });
});

test('bridge, classic form: a value the list does not have is refused before anything is set (getOption) or put back (read-back)', () => {
  const listed = gForm({ values: { close_code: 'permanent' } });
  const page = bridgePage({ window: { g_form: listed.g_form } });
  assert.deepEqual(page.call('fillField', ['close_code', 'Solved (Work Around)', '', false, '', '', { choice: true, undo: true }]), { ok: false, reason: 'no-such-choice' });
  assert.deepEqual(listed.sets, [], 'a label is not a value: nothing set');
  // no getOption on this form: set, read back, and put back when the form did not take it
  const bare = gForm({ values: { close_code: 'permanent' }, getOption: false });
  const page2 = bridgePage({ window: { g_form: bare.g_form } });
  assert.deepEqual(page2.call('fillField', ['close_code', 'made_up', '', false, '', '', { choice: true, undo: true }]), { ok: false, reason: 'no-such-choice' });
  assert.deepEqual(bare.sets, [['close_code', 'made_up'], ['close_code', 'permanent']]);
  assert.equal(bare.values.close_code, 'permanent', 'what was there is there again');
  // a choice is never appended to, never HTML, never empty; a locked or missing field is refused as any other
  const plain = gForm({ values: { close_code: '' } });
  const page3 = bridgePage({ window: { g_form: plain.g_form } });
  assert.deepEqual(page3.call('fillField', ['close_code', 'workaround', '', true, '', '', { choice: true }]), { ok: false, reason: 'bad-field' });
  assert.deepEqual(page3.call('fillField', ['close_code', 'workaround', '', false, '<p>x</p>', '', { choice: true }]), { ok: false, reason: 'bad-field' });
  assert.deepEqual(page3.call('fillField', ['close_code', '  ', '', false, '', '', { choice: true }]), { ok: false, reason: 'bad-field' });
  assert.deepEqual(plain.sets, []);
  const locked = gForm({ values: { close_code: '', close_notes: '' }, editable: ['close_notes'] });
  assert.deepEqual(bridgePage({ window: { g_form: locked.g_form } }).call('fillField', ['close_code', 'workaround', '', false, '', '', { choice: true }]), { ok: false, reason: 'read-only' });
  const absent = gForm({ values: { close_notes: '' } });
  assert.deepEqual(bridgePage({ window: { g_form: absent.g_form } }).call('fillField', ['close_code', 'workaround', '', false, '', '', { choice: true }]), { ok: false, reason: 'no-such-field' });
});

test('bridge, Workspace and portal: a choice is refused (choice-by-hand) and nothing on the page is touched; the notes still go in', () => {
  const pages = [
    ['workspace', `https://x.service-now.com/now/sow/record/incident/${A}`],
    ['portal', 'https://x.service-now.com/esc?id=ticket&table=incident'],
  ];
  for (const [name, url] of pages) {
    const page = bridgePage({ url, boxes: [[{ name: 'close_code', 'aria-label': 'Close code' }, ''], [{ name: 'close_notes', 'aria-label': 'Resolution notes' }, 'mine']] });
    assert.deepEqual(page.call('fillField', ['close_code', 'workaround', 'Close code', false, '', '', { choice: true, undo: true }]), { ok: false, reason: 'choice-by-hand' }, name);
    assert.deepEqual(page.boxes[0].events, [], `${name}: the box that looks like the code was not touched`);
    assert.equal(page.boxes[0].value, '', name);
    const notes = page.call('fillField', ['close_notes', 'Cleared the cache.', 'Resolution notes', false, '', '', { choice: false, undo: true }]);
    assert.equal(notes.ok, true, name);
    assert.deepEqual([notes.previous, notes.after], ['mine', 'Cleared the cache.'], name);
  }
});

test('bridge: nothing on the page is ever clicked, submitted or saved (still true with the choice and Undo)', () => {
  assert.ok(!/\.click\(|\.submit\(|requestSubmit|dispatchEvent\(new (Mouse|Pointer|Keyboard)|\bsave\(|\.save\b|updateRecord|g_form\.submit/i.test(BRIDGE.replace(/\/\/.*$/gm, '')), 'no click, submit or save');
  assert.ok(!/getReference|GlideAjax|XMLHttpRequest|fetch\(/.test(BRIDGE.replace(/\/\/.*$/gm, '')), 'no request from the bridge');
});
