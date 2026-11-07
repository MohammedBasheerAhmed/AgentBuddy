import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldStates, insertTargets, insertText, performInsert, readFieldStates, recheckDelay, sameStates } from '../src/sidepanel/insertFlow.js';
import { checkInsertTargets, handleFillField } from '../src/content/fill.js';
import { FILL_REASON_TEXT, describeInsert, fillReasonText, insertedNote } from '../src/lib/fillable.js';
import { isSaveLabel, labelWords } from '../src/content/saveLabels.js';
import { readFormValues } from '../src/content/ops/compose.js';
import { makeRecordResolver } from '../src/content/recordResolver.js';
import { DIALOG_SELECTOR, shadowDialogs } from '../src/content/dialogs.js';
import { featureById } from '../src/features/registry.js';

// Audit of 2026-11-07, part 9 (Workspaces), in the panel and the content script: Insert is not offered for a box that is not there
// (S4), a composer set to the other kind of note blocks it and a composer that cannot be read is said to be unread (W-12), Undo is
// withdrawn after any save-like press in any language (S6), the Write panels read a Workspace's boxes (S16), a classic frame on a list
// is no ticket (S8), and the dock sees a dialog inside a shadow root (S13).

const A = 'a'.repeat(32);
const WORKSPACE = `https://x.service-now.com/now/sow/record/incident/${A}`;
const pageOf = (over = {}) => ({ tabId: 5, href: WORKSPACE, surface: 'workspace', record: { table: 'incident', sysId: A, number: 'INC0010001', kind: 'incident' }, newRecord: null, ...over });
const feature = featureById('record-summary');
const baseTargets = (page = pageOf()) => insertTargets(feature, { record: page.record, page });
const workNotes = (targets) => targets.find((x) => x.field === 'work_notes');
const asked = (answer) => ({ known: true, form: 'workspace', fields: answer });

// ---- S4: Copy leads, with one plain line ------------------------------------------------------------------------------------------

test('a Workspace page with no box for the field: Insert is off, Copy leads, and one plain line says why', () => {
  const targets = applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown', gap: 'absent' } }));
  const target = workNotes(targets);
  assert.equal(target.copyFirst, true);
  assert.equal(target.blocked, "This page's box can't be filled automatically. Copy and paste.");
  assert.ok(!target.maybe, 'it is known now, not "maybe"');
});

test('two look-alikes and a page too big to search each get their own plain line', () => {
  const alike = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown', gap: 'ambiguous' } })));
  assert.match(alike.blocked, /^Two boxes on this page look alike/);
  const big = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown', gap: 'too-big' } })));
  assert.match(big.blocked, /^This page is too big for Agent Buddy to search for the box/);
  for (const t of [alike, big]) assert.equal(t.copyFirst, true);
});

test('a page that did not say why (an older page script) keeps the old line: it may not take it', () => {
  const target = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown' } })));
  assert.equal(target.maybe, true);
  assert.equal(target.blocked, '');
  assert.ok(!target.copyFirst);
  assert.match(target.next, /This page may not take it/);
});

test('a classic form never gets the Workspace line, and a found box is left alone', () => {
  const classic = applyFieldStates(baseTargets(pageOf({ surface: 'classic' })), { known: true, form: 'gform', fields: { work_notes: { state: 'unknown', gap: 'absent' } } });
  assert.equal(workNotes(classic).blocked, '');
  const found = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'editable', label: 'Work notes' } })));
  assert.deepEqual([found.blocked, found.box, found.copyFirst], ['', 'Work notes', undefined]);
});

test('the words a person reads here are plain: no table, column, code or "record"', () => {
  const lines = ['absent', 'ambiguous', 'too-big'].map((gap) => workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown', gap } }))).blocked);
  lines.push(workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'editable', mode: 'other' } }))).blocked);
  lines.push(...['unreachable', 'wrong-mode'].map(fillReasonText));
  for (const line of lines) assert.ok(line && !/\b(records?|tables?|columns?|sys_id|HTTP|\d{3})\b|work_notes/i.test(line), line);
});

// ---- W-12 / S14: the composer's mode ------------------------------------------------------------------------------------------------

test('a composer set to the other kind blocks Insert and says which way to switch', () => {
  const work = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'editable', label: 'Work notes', mode: 'other' } })));
  assert.equal(work.copyFirst, true);
  assert.equal(work.blocked, 'The box on this page is set to customer comments. Switch it to Work notes, then insert, or use Copy.');
  const page = pageOf();
  const reply = insertTargets(featureById('reply-draft'), { record: page.record, page }).find((x) => x.field === 'comments');
  assert.ok(reply, 'the reply draft inserts into the comments');
  const blocked = applyFieldStates([reply], asked({ comments: { state: 'editable', mode: 'other' } }))[0];
  assert.equal(blocked.blocked, 'The box on this page is set to Work notes. Switch it to Additional comments, then insert, or use Copy.');
  assert.equal(blocked.copyFirst, true);
});

test('a composer that was read and is set right drops the caution; one that was not read keeps it', () => {
  assert.match(workNotes(baseTargets()).caution, /check it is set to Work notes before you post/);
  const read = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'editable', label: 'Work notes', mode: 'match' } })));
  assert.equal(read.caution, '');
  assert.equal(read.blocked, '');
  const unread = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'editable', label: 'Work notes', mode: 'unread' } })));
  assert.match(unread.caution, /check it is set to Work notes before you post/);
  assert.equal(describeInsert({ field: 'work_notes', surface: 'workspace', composerMode: 'match' }).caution, '');
  assert.equal(describeInsert({ field: 'work_notes', surface: 'workspace', composerMode: 'match' }).next, 'Then press Post.');
});

test('a work note put into a box whose mode was not read carries the plain caution; a customer reply and a read mode do not', () => {
  const target = { field: 'work_notes', surface: 'workspace', fieldLabel: 'Work notes' };
  assert.match(insertedNote({ ok: true, method: 'dom', label: 'Work notes', modeUnread: true }, target), /It went into the box labelled "Work notes"\. Check the box says Work notes before you post\.$/);
  assert.doesNotMatch(insertedNote({ ok: true, method: 'dom', label: 'Work notes' }, target), /Check the box says/);
  assert.doesNotMatch(insertedNote({ ok: true, method: 'dom', label: 'Additional comments', modeUnread: true }, { ...target, field: 'comments' }), /Check the box says/);
  assert.doesNotMatch(insertedNote({ ok: true, method: 'gform' }, { ...target, surface: 'classic' }), /Check the box says/);
});

test('the content script lets the flag through as a flag and nothing else, and the two new reasons are known', async () => {
  const deps = (answer) => ({ callPage: async () => answer, currentRecord: async () => ({ table: 'incident', sysId: A }), currentNewRecord: async () => null, href: () => WORKSPACE });
  const ok = await handleFillField({ field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident', sysId: A } }, deps({ ok: true, method: 'dom', label: 'Work notes', modeUnread: true, extra: 'x' }));
  assert.deepEqual(ok, { ok: true, method: 'dom', label: 'Work notes', modeUnread: true });
  const wrong = await handleFillField({ field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident', sysId: A } }, deps({ ok: false, reason: 'wrong-mode' }));
  assert.deepEqual(wrong, { ok: false, reason: 'wrong-mode' });
  const big = await handleFillField({ field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident', sysId: A } }, deps({ ok: false, reason: 'unreachable' }));
  assert.deepEqual(big, { ok: false, reason: 'unreachable' });
  for (const reason of ['wrong-mode', 'unreachable']) assert.ok(FILL_REASON_TEXT[reason].length > 10);
});

test('the check before the click passes the page\'s reasons through, and only the words the panel knows', async () => {
  const answer = { form: 'workspace', fields: { work_notes: 'unknown', comments: 'editable', close_notes: 'unknown' }, boxes: { comments: 'Additional comments' }, gaps: { work_notes: 'absent', close_notes: 'made-up' }, modes: { comments: 'match', work_notes: 'bogus' } };
  const out = await checkInsertTargets({ fields: [{ name: 'work_notes' }, { name: 'comments' }, { name: 'close_notes' }] }, { callPage: async () => answer });
  assert.deepEqual(out.fields, {
    work_notes: { state: 'unknown', gap: 'absent' },
    comments: { state: 'editable', label: 'Additional comments', mode: 'match' },
    close_notes: { state: 'unknown' },
  });
  // a classic form never carries them
  const gform = await checkInsertTargets({ fields: [{ name: 'work_notes' }] }, { callPage: async () => ({ form: 'gform', fields: { work_notes: 'unknown' }, gaps: { work_notes: 'absent' }, modes: { work_notes: 'match' } }) });
  assert.deepEqual(gform.fields, { work_notes: { state: 'unknown' } });
});

test('readFieldStates carries the reasons to the cards', async () => {
  const read = async () => ({ form: 'workspace', match: true, fields: { work_notes: { state: 'unknown', gap: 'absent' } } });
  const states = await readFieldStates(pageOf(), baseTargets(), read);
  assert.deepEqual(states.fields.work_notes, { state: 'unknown', gap: 'absent' });
});

// ---- Looking again, so a fix on the page is noticed ------------------------------------------------------------------------------------

test('a Workspace page with a box that is missing or a composer set wrong is looked at again; everything else is not', () => {
  assert.equal(recheckDelay(asked({ work_notes: { state: 'unknown', gap: 'absent' } })), 5000);
  assert.equal(recheckDelay(asked({ work_notes: { state: 'unknown', gap: 'ambiguous' } })), 5000);
  assert.equal(recheckDelay(asked({ work_notes: { state: 'editable', mode: 'other' } })), 5000);
  assert.equal(recheckDelay(asked({ work_notes: { state: 'unknown', gap: 'too-big' } })), 20000, 'a page too big to search is not searched every few seconds');
  assert.equal(recheckDelay(asked({ work_notes: { state: 'editable', mode: 'match' } })), 0);
  assert.equal(recheckDelay(asked({ work_notes: { state: 'editable', mode: 'unread' } })), 0);
  assert.equal(recheckDelay({ known: true, form: 'gform', fields: { work_notes: { state: 'unknown', gap: 'absent' } } }), 0, 'a classic form is never asked again');
  assert.equal(recheckDelay({ known: false, form: 'none', fields: {} }), 0);
  assert.equal(recheckDelay(null), 0);
  assert.ok(sameStates(asked({ a: { state: 'x' } }), asked({ a: { state: 'x' } })));
  assert.ok(!sameStates(asked({ a: { state: 'x' } }), asked({ a: { state: 'y' } })));
});

test('Insert on a box the page said is not there does not go to the page at all: no failure after a click', async () => {
  let sent = 0;
  const target = workNotes(applyFieldStates(baseTargets(), asked({ work_notes: { state: 'unknown', gap: 'absent' } })));
  const outcome = await insertText({ page: pageOf(), target, text: 'A note.', send: async () => { sent += 1; return { ok: true }; } });
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.why, target.blocked);
  assert.equal(sent, 0);
});

test('a work note into a box whose mode was not read: the insert goes in and the note carries the caution', async () => {
  const outcome = await performInsert({
    page: pageOf(),
    spec: { field: 'work_notes', fieldLabel: 'Work notes', mode: 'append' },
    value: 'A note.',
    expect: { table: 'incident', sysId: A },
    target: { field: 'work_notes', surface: 'workspace', fieldLabel: 'Work notes' },
    send: async () => ({ ok: true, method: 'dom', label: 'Work notes', modeUnread: true }),
  });
  assert.equal(outcome.status, 'inserted');
  assert.match(outcome.note, /Check the box says Work notes before you post\.$/);
  const refused = await performInsert({
    page: pageOf(),
    spec: { field: 'work_notes', fieldLabel: 'Work notes', mode: 'append' },
    value: 'A note.',
    expect: { table: 'incident', sysId: A },
    send: async () => ({ ok: false, reason: 'wrong-mode' }),
  });
  assert.equal(refused.status, 'failed');
  assert.match(refused.why, /set to the other kind of note/);
});

// ---- S6: what counts as a save --------------------------------------------------------------------------------------------------

test('buttons that save or post count, in English and in Arabic; buttons that only close, cancel or add do not', () => {
  for (const label of ['Save', 'Update', 'Save and close', 'Save & Close', 'Resolve', 'Resolve incident', 'Submit', 'Post', 'Send', 'Publish', 'Close incident', 'Close case', 'Mark complete', 'Apply', 'save']) assert.ok(isSaveLabel(label), label);
  const arabic = ['حفظ', 'تحديث', 'نشر', 'إرسال', 'حفظ وإغلاق', 'إكمال'];
  for (const label of arabic) assert.ok(isSaveLabel(label), label);
  for (const label of ['Cancel', 'Close', 'Add', 'Reply', 'Saved searches', 'Show more', 'Attach', '', '   ', 'إلغاء']) assert.ok(!isSaveLabel(label), label);
  assert.ok(!isSaveLabel('x'.repeat(200)), 'a long text is not a button label');
  assert.equal(labelWords('إرسال'), ' ارسال ', 'alef forms are one');
});

// ---- S16: the Write panels read a Workspace's boxes ------------------------------------------------------------------------------------

test('formValues on a Workspace page reads the box of the ticket the address names, and only then', async () => {
  const calls = [];
  const call = async (action, args) => {
    calls.push([action, args]);
    return action === 'getFormMeta' ? null : { comments: 'Dear customer, we are looking into it.' };
  };
  const current = async () => ({ table: 'incident', sysId: A });
  const out = await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: A } }, call, { currentRecord: current });
  assert.deepEqual(out, { available: true, values: { comments: 'Dear customer, we are looking into it.' } });
  assert.deepEqual(calls[1], ['getBoxValues', [['comments'], ['Additional comments']]]);
  const other = await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: 'b'.repeat(32) } }, call, { currentRecord: current });
  assert.deepEqual(other, { available: false, values: {}, wrongForm: true });
  const none = await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: A } }, call, { currentRecord: async () => null });
  assert.deepEqual(none, { available: false, values: {} });
});

test('a box that was not found is "not available", never an empty text; a portal and a page without a record say so too', async () => {
  const current = async () => ({ table: 'incident', sysId: A });
  const notFound = await readFormValues({ names: ['work_notes'], expect: { table: 'incident', sysId: A } }, async (action) => (action === 'getFormMeta' ? null : {}), { currentRecord: current });
  assert.deepEqual(notFound, { available: false, values: {} });
  const portal = await readFormValues({ names: ['work_notes'], expect: { table: 'incident', sysId: A } }, async () => null, { currentRecord: current });
  assert.deepEqual(portal, { available: false, values: {} });
  const noExpect = await readFormValues({ names: ['work_notes'] }, async () => null, { currentRecord: current });
  assert.deepEqual(noExpect, { available: false, values: {} });
  const junk = await readFormValues({ names: ['work_notes'], expect: { table: 'incident', sysId: A } }, async (action) => (action === 'getFormMeta' ? null : { work_notes: 42 }), { currentRecord: current });
  assert.deepEqual(junk, { available: false, values: {} });
});

// ---- S8: a classic frame that is on a list -------------------------------------------------------------------------------------------

test('the classic shell\'s frame is on a list while the address names a form: no ticket is open', async () => {
  const resolver = makeRecordResolver({ guardedDeps: async () => ({ queryTable: async () => [] }), formMeta: async () => ({ table: null, sysId: null, isNewRecord: null, number: null, loadedAt: null, frameIsList: true }) });
  const href = `https://x.service-now.com/nav_to.do?uri=incident.do%3Fsys_id%3D${A}`;
  assert.equal(await resolver.resolveRecord(href), null);
  assert.equal(await resolver.resolveNewRecord('https://x.service-now.com/nav_to.do?uri=incident.do%3Fsys_id%3D-1'), null);
  const same = makeRecordResolver({ guardedDeps: async () => ({ queryTable: async () => [] }), formMeta: async () => null });
  assert.equal((await same.resolveRecord(`https://x.service-now.com/incident.do?sys_id=${A}`))?.sysId, A, 'without the sign nothing changes');
});

// ---- S13: a dialog inside a shadow root ----------------------------------------------------------------------------------------------------

// A page whose dialog sits inside the open shadow root of a component: { doc, dialog, button, host }.
function makeDocument({ focusInside = false, shown = true } = {}) {
  const make = (attrs = {}) => ({
    nodeType: 1,
    parentNode: null,
    shadowRoot: null,
    matches: (selector) => selector === DIALOG_SELECTOR && attrs['aria-modal'] === 'true',
    getClientRects: () => (shown ? [{ width: 10, height: 10 }] : []),
  });
  const host = make();
  const dialog = make({ 'aria-modal': 'true' });
  const button = make();
  const root = { nodeType: 11, host, activeElement: focusInside ? button : null, querySelectorAll: (sel) => (sel === '*' ? [dialog, button] : sel === DIALOG_SELECTOR ? [dialog] : []) };
  host.shadowRoot = root;
  dialog.parentNode = root;
  button.parentNode = dialog;
  return { host, dialog, button, doc: { body: make(), activeElement: focusInside ? host : null, querySelectorAll: (sel) => (sel === '*' ? [host] : []) } };
}

test('a dialog in a shadow root is seen: by the focus inside it, and by a short look through the open shadow roots', () => {
  assert.equal(shadowDialogs(makeDocument({ focusInside: true }).doc), 1);
  assert.equal(shadowDialogs(makeDocument({ focusInside: false }).doc), 1);
  assert.equal(shadowDialogs(makeDocument({ shown: false }).doc), 0, 'a dialog that is not drawn does not hide the dock');
  assert.equal(shadowDialogs({ body: null, activeElement: null, querySelectorAll: () => [] }), 0);
  assert.equal(shadowDialogs({}), 0, 'a page that cannot be looked at is not a dialog');
});

// ---- Undo goes once a save-like press has been counted --------------------------------------------------------------------------------

test('Undo is offered on the form it was made on until the form stamp moves (a Post, a Send, a Save, an emptied box)', async () => {
  const { undoStepOf, undoStillFor } = await import('../src/lib/fillable.js');
  const expect = { table: 'incident', sysId: A };
  const step = undoStepOf({ ok: true, undo: { previous: 'mine', after: 'mine\n\nnew' } }, { field: 'work_notes', fieldLabel: 'Work notes', expect, stamp: ':0' });
  assert.ok(step);
  assert.equal(undoStillFor(step, pageOf({ formStamp: ':0' })), true);
  assert.equal(undoStillFor(step, pageOf({ formStamp: ':1' })), false, 'one save-like event moves the stamp');
  assert.equal(undoStillFor(step, pageOf({ formStamp: ':0', record: { table: 'incident', sysId: 'b'.repeat(32) } })), false, 'another ticket');
});
