// W-01, W-04, W-05 and W-07 of the audit of 2026-11-07, from the person's side: what the panel says when the form is locked, when the
// notes fail after the close code went in, and what Prepare to close claims. The page bridge runs for real (a fake form, a fake page);
// the content script's FILL_FIELD sits between it and the panel's insert flow, as in the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById } from '../src/features/registry.js';
import { PREPARE_CLOSE } from '../src/features/packs/close.js';
import { applyFieldStates, forgetInserts, insertCloseAndNotes, insertTargets, insertText, undoInserts } from '../src/sidepanel/insertFlow.js';
import { codeTargetFor } from '../src/sidepanel/ticket/assist/answers/prepareClose.js';
import { handleFillField } from '../src/content/fill.js';
import { fillReasonText } from '../src/lib/fillable.js';
import { loadBridge, fakeForm } from './bridge-fixtures.js';

const A = 'a'.repeat(32);
const pageOf = (over = {}) => ({ tabId: 3, href: `https://x.service-now.com/incident.do?sys_id=${A}`, surface: 'classic', record: { table: 'incident', sysId: A, number: 'INC0010100', kind: 'incident' }, newRecord: null, ...over });
const source = { expect: { table: 'incident', sysId: A }, number: 'INC0010100' };
const NOTES = 'Cause: the VPN profile cache was corrupt.\nFix: cleared the cache.\nVerification: the user confirmed it.';
const LOCKED = 'This field is locked on this form.';

/** The panel's send(): FILL_FIELD through the content script and the real bridge on a fake form. */
function onForm(spec) {
  const form = fakeForm({ options: { close_code: ['workaround', 'permanent'] }, ...spec });
  const bridge = loadBridge({ g_form: form });
  const deps = {
    callPage: async (action, args) => bridge.ask(action, args),
    currentRecord: async () => ({ table: 'incident', sysId: A }),
    currentNewRecord: async () => null,
    href: () => pageOf().href,
  };
  return { form, send: (_tab, message) => handleFillField(message, deps) };
}
const target = (feature, kind = 'incident') => insertTargets(featureById(feature), { record: { kind }, page: pageOf() })[0];

test('W-01, from the panel: a closed ticket (empty list of editable fields, Active false) says the field is locked, and nothing is written', async () => {
  forgetInserts();
  const { form, send } = onForm({ values: { work_notes: '', active: 'false', state: '7' }, editable: [] });
  const out = await insertText({ page: pageOf(), target: target('handoff-brief'), text: 'Hand-off note.', source, send });
  assert.equal(out.status, 'failed');
  assert.equal(out.why, LOCKED);
  assert.deepEqual(form.sets, []);
});

test('W-01, from the panel: a box that takes setValue and keeps its old text is read back, and is not "Inserted"', async () => {
  forgetInserts();
  const { form, send } = onForm({ values: { work_notes: 'typed' }, editable: [], locked: ['work_notes'] });
  const out = await insertText({ page: pageOf(), target: target('handoff-brief'), text: 'Hand-off note.', source, send });
  assert.equal(out.status, 'failed');
  assert.equal(out.why, LOCKED);
  assert.equal(form.held.work_notes, 'typed');
});

test('W-01, from the panel: an empty list on a form that is open still inserts (cannot tell is not locked), and Undo reads back too', async () => {
  forgetInserts();
  const { form, send } = onForm({ values: { work_notes: 'typed', active: 'true', state: '2' }, editable: [] });
  const out = await insertText({ page: pageOf(), target: target('handoff-brief'), text: 'Hand-off note.', source, send });
  assert.equal(out.status, 'inserted');
  assert.equal(form.held.work_notes, 'typed\n\nHand-off note.');
  assert.ok(out.undo, 'an Undo step');
  // the ticket is closed meanwhile (the form locks): Undo says so, and does not claim the text was put back
  form.held.active = 'false';
  form.held.state = '7';
  const back = await undoInserts({ page: pageOf(), steps: [out.undo], send });
  assert.equal(back.status, 'failed');
  assert.match(back.note, /could not be put back\. This field is locked on this form\./);
  assert.ok(!/^Undone/.test(back.note));
  assert.equal(form.held.work_notes, 'typed\n\nHand-off note.');
});

test('W-04: the code goes in, the notes cannot: the line says both, and the code can be undone', async () => {
  forgetInserts();
  const { form, send } = onForm({ values: { close_code: '', close_notes: '' }, editable: ['close_code'] });
  const notes = insertTargets(featureById(PREPARE_CLOSE), { record: { kind: 'incident' }, page: pageOf() })[0];
  const code = codeTargetFor({ kind: 'incident', surface: 'classic' });
  const out = await insertCloseAndNotes({ page: pageOf(), code: { target: code, value: 'workaround', label: 'Solved (Work Around)' }, notes: { target: notes, text: NOTES }, source, send });
  assert.equal(out.status, 'failed');
  assert.equal(out.code, 'filled');
  assert.equal(out.why, `${LOCKED} The close code Solved (Work Around) is already filled on the form. Undo puts it back.`);
  assert.equal(form.held.close_code, 'workaround');
  assert.deepEqual(out.undo.map((s) => s.field), ['close_code']);
  const back = await undoInserts({ page: pageOf(), steps: out.undo, send });
  assert.equal(back.status, 'undone');
  assert.equal(form.held.close_code, '');
});

test('W-04: when neither can go in, nothing is said about a code that is not there', async () => {
  forgetInserts();
  const { form, send } = onForm({ values: { close_code: '', close_notes: '', active: 'false', state: '7' }, editable: [] });
  const notes = insertTargets(featureById(PREPARE_CLOSE), { record: { kind: 'incident' }, page: pageOf() })[0];
  const code = codeTargetFor({ kind: 'incident', surface: 'classic' });
  const out = await insertCloseAndNotes({ page: pageOf(), code: { target: code, value: 'workaround', label: 'Solved (Work Around)' }, notes: { target: notes, text: NOTES }, source, send });
  assert.equal(out.status, 'failed');
  assert.equal(out.code, 'by-hand');
  assert.equal(out.why, LOCKED);
  assert.deepEqual(form.sets, []);
});

test('W-05: Prepare to close claims only what the read-back proved, and always adds the line about the state', async () => {
  forgetInserts();
  const notes = insertTargets(featureById(PREPARE_CLOSE), { record: { kind: 'incident' }, page: pageOf() })[0];
  const code = codeTargetFor({ kind: 'incident', surface: 'classic' });
  const run = (spec) => {
    const { form, send } = onForm(spec);
    return insertCloseAndNotes({ page: pageOf(), code: { target: code, value: 'workaround', label: 'Solved (Work Around)' }, notes: { target: notes, text: NOTES }, source, send }).then((out) => ({ out, form }));
  };
  const both = await run({ values: { close_code: '', close_notes: '' }, editable: [] });
  // (F13: the state step of the kind ends the line, in place of the general sentence about the state and the other fields)
  assert.equal(both.out.note, 'Filled Close code and Resolution notes. Set State to Resolved, then save.');
  // the code box is locked and ignores the write: it is NOT claimed; the notes are, and the code is left to the person
  forgetInserts();
  const codeLocked = await run({ values: { close_code: '', close_notes: '' }, editable: [], locked: ['close_code'] });
  assert.equal(codeLocked.out.status, 'inserted');
  assert.equal(codeLocked.out.code, 'by-hand');
  assert.equal(codeLocked.out.note, 'Filled Resolution notes. Choose the close code Solved (Work Around) yourself. Set State to Resolved, then save.');
  assert.equal(codeLocked.form.held.close_code, '');
  // the notes box is locked: nothing is claimed about the notes
  forgetInserts();
  const notesLocked = await run({ values: { close_code: '', close_notes: '' }, editable: [], locked: ['close_notes'] });
  assert.equal(notesLocked.out.status, 'failed');
  assert.ok(!/Filled Resolution notes/.test(notesLocked.out.why));
});

test('W-07: where a page has no form of its own and the box was not found, the line under the button says what happens; a form that cannot tell says nothing', () => {
  const targets = insertTargets(featureById('handoff-brief'), { record: { kind: 'incident' }, page: { surface: 'workspace' } });
  const found = (state, form) => applyFieldStates(targets, { known: true, form, fields: { work_notes: { state } } })[0];
  const plain = found('editable', 'workspace');
  assert.equal(plain.maybe, undefined);
  assert.equal(plain.next, targets[0].next);
  const maybe = found('unknown', 'workspace');
  assert.equal(maybe.maybe, true);
  assert.equal(maybe.blocked, '', 'it blocks nothing: the click may still work');
  assert.equal(maybe.next, `${targets[0].next} This page may not take it. If it does not, your text is copied instead.`);
  assert.equal(found('unknown', 'portal').maybe, true);
  // a classic form that cannot tell is not a page that may not take it: the insert is tried and read back
  assert.equal(found('unknown', 'gform').maybe, undefined);
  assert.equal(found('unknown', 'gform').next, targets[0].next);
  // not known at all (the page did not answer): as before
  assert.equal(applyFieldStates(targets, { known: false, form: 'none', fields: {} })[0].maybe, undefined);
  // a locked box is blocked, with the sentence it always had
  assert.match(found('read-only', 'workspace').blocked, /cannot be changed on this form right now\. Use Copy\./);
});

test('the reason text for a locked box is the same plain sentence everywhere it is shown', () => {
  assert.equal(fillReasonText('read-only'), LOCKED);
});
