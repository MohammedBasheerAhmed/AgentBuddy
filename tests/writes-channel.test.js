// W-02 and W-13 of the audit of 2026-11-07: the channel follows the kind. "Insert as customer comment" was offered on a catalog task, on
// other tasks and on a problem, though the panel's own caution said the requester does not see those comments and a problem has no
// customer; the page bar led with a reply for them. Now: a customer comment where the customer reads it (incident, request, requested
// item, case, HR case), the work notes first on a catalog task or another task with the comment as a second, warned choice, and no
// reply at all on a problem. And the panel no longer promises that saving a comment emails the customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById, insertsFor } from '../src/features/registry.js';
import { describeInsert, FILL_REASON_TEXT, fillReasonText, insertedNote } from '../src/lib/fillable.js';
import { insertTargets, insertsForKind, primaryOf } from '../src/sidepanel/insertFlow.js';
import { cautionFor, hasCustomer } from '../src/features/stages.js';
import { offeredFeatures } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { effectiveSettings, DEFAULT_SETTINGS } from '../src/policy/policy.js';
import { pickRequesterQuestions } from '../src/features/picks.js';

const page = (surface = 'classic') => ({ surface });
const REPLIES = ['reply-draft', 'missing-info', 'request-explain'];

test('a customer comment where the customer reads it, exactly as before: incident, request, requested item, case, HR case', () => {
  for (const [id, kinds] of [['reply-draft', ['incident', 'request', 'requested_item', 'case', 'hr_case']], ['missing-info', ['incident', 'request', 'requested_item', 'case', 'hr_case']], ['request-explain', ['request', 'requested_item']]]) {
    for (const kind of kinds) {
      const targets = insertTargets(featureById(id), { record: { kind }, page: page() });
      assert.deepEqual(targets.map((x) => [x.field, x.label]), [['comments', 'Insert as customer comment']], `${id} on ${kind}`);
      assert.equal(targets[0].where.includes('which the customer sees'), true, `${id} on ${kind}`);
    }
  }
});

test('on a catalog task or another task the work notes are the default and the comment is the second choice, said to be one the requester may not see', () => {
  for (const id of REPLIES) {
    for (const kind of ['catalog_task', 'task']) {
      if (id === 'request-explain' && kind === 'task') continue; // (not an action of a task)
      const targets = insertTargets(featureById(id), { record: { kind }, page: page() });
      assert.deepEqual(targets.map((x) => x.field), ['work_notes', 'comments'], `${id} on ${kind}`);
      assert.equal(targets[0].label, 'Add to work notes');
      assert.equal(targets[1].label, 'Insert as a comment (the requester may not see it)');
      assert.equal(primaryOf(featureById(id), kind), 'insert');
      // no customer wording anywhere on what the person reads here
      for (const x of targets) assert.ok(!/customer/i.test(`${x.label} ${x.where} ${x.next}`), `${id} on ${kind}: ${x.label} / ${x.where} / ${x.next}`);
    }
  }
  const comment = insertTargets(featureById('reply-draft'), { record: { kind: 'catalog_task' }, page: page() })[1];
  assert.equal(comment.where, 'Goes below what is in Additional comments, which the requester may not see.');
  assert.equal(comment.next, 'Then press Save.', 'no promise that anyone is told');
  assert.match(comment.caution, /requester may not see comments on a catalog task/);
  assert.match(insertTargets(featureById('reply-draft'), { record: { kind: 'task' }, page: page() })[1].caution, /requester may not see comments on a task/);
});

test('the questions for the requester are the part that goes into either box (the "Missing:" line never does)', () => {
  const answer = 'Missing: error text\n\nCould you tell us:\n1. What does the error say?';
  for (const kind of ['incident', 'catalog_task', 'task']) {
    for (const spec of insertsForKind(featureById('missing-info'), kind)) assert.equal(spec.pick, pickRequesterQuestions, `${kind}: ${spec.field}`);
  }
  assert.ok(!pickRequesterQuestions(answer).includes('Missing:'));
});

test('a problem has no customer: no reply, no missing-details question, nothing to insert as a comment; a task of a problem or a change neither', () => {
  assert.equal(hasCustomer({ kind: 'problem', table: 'problem' }), false);
  assert.equal(hasCustomer({ kind: 'problem' }), false, 'by kind alone');
  assert.equal(hasCustomer({ kind: 'task', table: 'problem_task' }), false);
  assert.equal(hasCustomer({ kind: 'task', table: 'change_task' }), false);
  for (const [kind, table] of [['incident', 'incident'], ['requested_item', 'sc_req_item'], ['catalog_task', 'sc_task'], ['task', 'incident_task'], ['change', 'change_request']]) assert.equal(hasCustomer({ kind, table }), true, table);
  const eff = effectiveSettings({ ...DEFAULT_SETTINGS }, {});
  const offered = (kind, table) => offeredFeatures({ record: { kind, table }, header: null, eff }).map((f) => f.id);
  for (const table of ['problem', 'problem_task', 'change_task']) {
    const ids = offered(table === 'problem' ? 'problem' : 'task', table);
    for (const id of ['reply-draft', 'missing-info']) assert.ok(!ids.includes(id), `${id} on ${table}`);
  }
  assert.ok(offered('problem', 'problem').includes('handoff-brief'), 'the problem\'s other actions stay');
  assert.ok(offered('catalog_task', 'sc_task').includes('reply-draft'), 'a catalog task still has the reply, with its work-notes default');
  assert.ok(offered('incident', 'incident').includes('reply-draft'));
  assert.deepEqual(insertsForKind(featureById('reply-draft'), 'problem'), [], 'and if one is made anyway, it has no comment box to go to');
});

test('every box a reply can go into is one the register of fillable fields knows, for every kind', () => {
  for (const id of REPLIES) for (const spec of insertsFor(featureById(id))) assert.ok(['comments', 'work_notes'].includes(spec.field), `${id}: ${spec.field}`);
});

test('the caution on the Actions list says the same about a catalog task and another task, and nothing on the others', () => {
  assert.match(cautionFor(featureById('reply-draft'), { kind: 'catalog_task' }), /requester may not see comments on a catalog task/);
  assert.equal(cautionFor(featureById('reply-draft'), { kind: 'task' }), 'The requester may not see comments on a task. Check who can see them.');
  assert.equal(cautionFor(featureById('reply-draft'), { kind: 'incident' }), '');
  assert.equal(cautionFor(featureById('record-summary'), { kind: 'task' }), '');
});

test('saving a comment no longer promises that the customer is told (W-13); the work notes and the other boxes are as they were', () => {
  assert.equal(describeInsert({ field: 'comments', kind: 'incident' }).next, 'Then press Save. The customer may be emailed.');
  assert.equal(describeInsert({ field: 'comments', kind: 'case' }).next, 'Then press Save. The customer may be emailed.');
  assert.equal(describeInsert({ field: 'comments', kind: 'problem' }).next, 'Then press Save.');
  assert.equal(describeInsert({ field: 'comments', kind: 'catalog_task', mode: 'replace' }).where, 'Replaces what is in Additional comments, which the requester may not see.');
  assert.equal(describeInsert({ field: 'work_notes', kind: 'catalog_task' }).where, 'Goes below what is in Work notes, which only your colleagues see.');
  assert.equal(describeInsert({ field: 'work_notes' }).next, 'Then press Save.');
  assert.equal(describeInsert({ field: 'comments', kind: 'incident', surface: 'workspace' }).next, 'Then press Post.');
  assert.equal(describeInsert({ field: 'comments', kind: 'incident', surface: 'portal' }).next, "Then press the page's own Send.");
  assert.equal(insertedNote({ ok: true, method: 'gform' }, { field: 'comments', surface: 'classic', kind: 'incident' }), 'Inserted. Review it. Then press Save. The customer may be emailed.');
  assert.equal(insertedNote({ ok: true, method: 'gform' }, { field: 'comments', surface: 'classic', kind: 'catalog_task' }), 'Inserted. Review it. Then press Save.', 'the line after the insert says the same as the line before it');
});

test('a locked box is said to be locked, in plain words, whatever made it so', () => {
  assert.equal(fillReasonText('read-only'), 'This field is locked on this form.');
  assert.ok(!/read-only|permission|ACL|role/i.test(FILL_REASON_TEXT['read-only']));
});
