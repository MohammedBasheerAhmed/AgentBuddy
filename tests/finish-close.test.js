import test from 'node:test';
import assert from 'node:assert/strict';
import { closeStep, describeInsert } from '../src/lib/fillable.js';
import { closeFilledNote, insertTargets, describeTarget } from '../src/sidepanel/insertFlow.js';
import { closePlan } from '../src/sidepanel/ticket/assist/answers/prepareClose.js';
import { featureById } from '../src/features/registry.js';
import { PREPARE_CLOSE } from '../src/features/packs/close.js';
import { getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_FINISH } from '../src/i18n/ar/finish.js';

// Audit of 2026-11-07, F13: "Prepare to close" and the close inserts said only "Then press Save". The state is what closes a ticket, and nobody
// named it. Advice, not a claim (whether the form needs the state before it saves is not known): one sentence per kind. Where the kind has no
// step of its own the insert says what it always said.

const STEPS = {
  incident: 'Set State to Resolved, then save.',
  problem: 'Set State to Resolved, then save.',
  requested_item: 'Set State to Closed Complete (or Closed Incomplete or Closed Skipped), then save.',
  catalog_task: 'Set State to Closed Complete (or Closed Incomplete or Closed Skipped), then save.',
  change: 'Move the change to Closed, then save.',
  case: 'Set the state your process uses to close, then save.',
  hr_case: 'Set the state your process uses to close, then save.',
};

test('F13: the state step of each kind, as advice; a kind with none has none', () => {
  for (const [kind, step] of Object.entries(STEPS)) assert.equal(closeStep(kind), step, kind);
  for (const kind of ['request', 'task', 'other', 'knowledge', 'chat', '', undefined, null]) assert.equal(closeStep(kind), '', String(kind));
  // advice, not a claim: nothing says the field is required, or that the ticket will close
  for (const step of Object.values(STEPS)) assert.ok(!/must|required|will close|is closed/i.test(step), step);
});

test('F13: the close inserts name the step; every other insert says what it always said', () => {
  for (const field of ['close_notes', 'fix_notes', 'close_code']) {
    for (const [kind, step] of Object.entries(STEPS)) assert.equal(describeInsert({ field, kind, mode: 'replace' }).next, step, `${field} on ${kind}`);
    assert.equal(describeInsert({ field, kind: 'task', mode: 'replace' }).next, 'Then press Save.', `${field}: a plain task has no step`);
    assert.equal(describeInsert({ field, mode: 'replace' }).next, 'Then press Save.', `${field}: no kind given`);
  }
  // on a Workspace the notes still need the state; a portal form is not a form the person saves
  assert.equal(describeInsert({ field: 'close_notes', kind: 'incident', surface: 'workspace' }).next, 'Set State to Resolved, then save.');
  assert.equal(describeInsert({ field: 'close_notes', kind: 'incident', surface: 'portal' }).next, 'Then press Save.');
  // the article body and the other boxes are not a close
  assert.equal(describeInsert({ field: 'text', kind: 'incident', table: 'kb_knowledge' }).next, 'Then save the article.');
  assert.equal(describeInsert({ field: 'cause_notes', kind: 'problem' }).next, 'Then press Save.');
  assert.equal(describeInsert({ field: 'work_notes', kind: 'incident' }).next, 'Then press Save.');
  assert.equal(describeInsert({ field: 'comments', kind: 'incident' }).next, 'Then press Save. The customer may be emailed.');
  assert.equal(describeInsert({ field: 'comments', kind: 'incident', surface: 'workspace' }).next, 'Then press Post.');
  // where and the caution are not touched
  assert.equal(describeInsert({ field: 'close_notes', kind: 'incident', mode: 'replace' }).where, 'Replaces what is in Resolution notes, which the customer can often read.');
});

test('F13: the answer card\'s boxes carry the step for the record\'s kind, in the other mode too', () => {
  const notes = featureById('resolution-notes');
  assert.equal(insertTargets(notes, { record: { kind: 'incident' }, page: { surface: 'classic' } })[0].next, 'Set State to Resolved, then save.');
  assert.equal(insertTargets(notes, { record: { kind: 'requested_item' }, page: { surface: 'classic' } })[0].next, STEPS.requested_item);
  assert.equal(insertTargets(notes, { record: { kind: 'change' }, page: { surface: 'classic' } })[0].next, STEPS.change);
  const problem = insertTargets(notes, { record: { kind: 'problem' }, page: { surface: 'classic' } });
  assert.deepEqual(problem.map((t) => [t.field, t.next]), [['fix_notes', 'Set State to Resolved, then save.'], ['cause_notes', 'Then press Save.']], 'the fix closes a problem; the cause is only a note');
  const plain = insertTargets(notes, { record: { kind: 'task' }, page: { surface: 'classic' } })[0];
  assert.equal(plain.next, 'Then press Save.');
  // Replace / Add below: the same step
  const inc = insertTargets(notes, { record: { kind: 'incident' }, page: { surface: 'classic' } })[0];
  assert.equal(describeTarget(inc, 'append', { record: { kind: 'incident' }, page: { surface: 'classic' } }).next, 'Set State to Resolved, then save.');
});

test('F13: Prepare to close: the line before the click and the line after it end with the same step, one line and not two', () => {
  const notes = insertTargets(featureById(PREPARE_CLOSE), { record: { kind: 'incident' }, page: { surface: 'classic' } })[0];
  const line = closePlan({ kind: 'incident', notes }).line;
  assert.equal(line, 'Insert fills Resolution notes on the open form. Nothing is saved. Set State to Resolved, then save.');
  const note = closeFilledNote({ filled: [notes], kind: 'incident' });
  assert.equal(note, 'Filled Resolution notes. Set State to Resolved, then save.');
  assert.ok(!/Check the state and the other required fields/.test(note), 'the general sentence is replaced, not added to');
  assert.equal((note.match(/save/gi) || []).length, 1, 'one mention of saving');
  // each kind
  for (const [kind, step] of Object.entries(STEPS)) {
    const target = insertTargets(featureById(PREPARE_CLOSE), { record: { kind }, page: { surface: 'classic' } })[0];
    assert.ok(closePlan({ kind, notes: target }).line.endsWith(` ${step}`), kind);
    assert.ok(closeFilledNote({ filled: [target], kind }).endsWith(` ${step}`), kind);
  }
  // a kind with no step keeps both of its sentences
  assert.equal(closeFilledNote({ filled: [notes], kind: 'task' }), 'Filled Resolution notes. Press Save in ServiceNow to keep it. Check the state and the other required fields, then save.');
  assert.equal(closePlan({ kind: 'task', notes }).line, 'Insert fills Resolution notes on the open form. Nothing is saved until you press Save.');
  // with a close code to pick by hand the step is still last
  const vote = { enough: true, matchesCurrent: false, value: 'workaround', label: 'Solved (Work Around)' };
  assert.equal(closePlan({ kind: 'case', vote, notes }).line, 'Insert fills Resolution notes on the open form. Nothing is saved. Choose the close code Solved (Work Around) yourself. Set the state your process uses to close, then save.');
  assert.equal(closeFilledNote({ filled: [notes], byHand: 'Solved (Work Around)', kind: 'hr_case' }), 'Filled Resolution notes. Choose the close code Solved (Work Around) yourself. Set the state your process uses to close, then save.');
});

test('F13: every new sentence has its Arabic', () => {
  const was = getLanguage();
  registerCatalogue('ar', AR_FINISH);
  try {
    setLanguage('ar');
    const arabic = /[؀-ۿ]/;
    for (const step of new Set(Object.values(STEPS))) {
      const said = closeStep(Object.keys(STEPS).find((k) => STEPS[k] === step));
      assert.ok(arabic.test(said), step);
      assert.notEqual(said, step);
    }
    const notes = insertTargets(featureById(PREPARE_CLOSE), { record: { kind: 'incident' }, page: { surface: 'classic' } })[0];
    assert.ok(arabic.test(closePlan({ kind: 'incident', notes }).line));
    assert.ok(arabic.test(closeFilledNote({ filled: [notes, notes], kind: 'incident' })));
    assert.ok(!/Filled|Insert fills/.test(closeFilledNote({ filled: [notes], kind: 'incident' }) + closePlan({ kind: 'incident', notes }).line));
  } finally {
    setLanguage(was);
  }
});
