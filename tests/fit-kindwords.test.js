import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIND_STATEMENT, NOTES_KINDS, isFulfilment, kindNote, kindStatement, takesKindNote } from '../src/features/kindWords.js';
import { KINDS } from '../src/context/kinds.js';
import { FEATURES, featureById } from '../src/features/registry.js';
import { CODE_LINE, CODE_RULE, notesOnlyPrompt } from '../src/features/packs/close.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { pickCauseNotes, pickFixNotes, pickResolutionNotes } from '../src/features/picks.js';

// Audit of 2026-11-07, F4, F8, F12: the model is told what kind of ticket it has, with fixed sentences chosen by the kind, so a laptop
// order is not summarised with an "Impact" and delivered work is not given a "Cause".

const TICKET_KINDS = KINDS.filter((k) => !['knowledge', 'chat'].includes(k));

test('every kind of ticket has one fixed sentence that says what it is; an article and a chat have none', () => {
  for (const kind of TICKET_KINDS) {
    const sentence = kindStatement(kind);
    assert.ok(sentence.length > 40 && sentence.length < 260, kind);
    assert.match(sentence, /^This ticket (?:is|has)/, kind);
    assert.ok(sentence.endsWith('.'), kind);
    assert.doesNotMatch(sentence, /[{}\d]/, `${kind}: a fixed sentence holds no slot and no number`);
  }
  assert.equal(kindStatement('knowledge'), '');
  assert.equal(kindStatement('chat'), '');
  assert.equal(kindStatement('something else'), '');
  assert.deepEqual(Object.keys(KIND_STATEMENT).sort(), [...TICKET_KINDS].sort());
});

test('a request is told nothing has gone wrong; an incident is told what it is and nothing about the shape of its answer', () => {
  for (const kind of ['request', 'requested_item', 'catalog_task']) {
    assert.match(kindStatement(kind), /Nothing has gone wrong/);
    assert.equal(isFulfilment(kind), true);
  }
  assert.equal(isFulfilment('incident'), false);
  for (const id of ['record-summary', 'resolution-notes', 'prepare-close', 'resolution-improve']) assert.equal(kindNote(id, 'incident'), kindStatement('incident'), id);
});

test('the summary of an order reads the five lines for an order (no "who is affected how badly")', () => {
  const note = kindNote('record-summary', 'catalog_task');
  assert.ok(note.startsWith(kindStatement('catalog_task')));
  assert.match(note, /Issue is what has to be delivered/);
  assert.match(note, /Impact is who needs it and by when/);
  for (const kind of ['request', 'requested_item', 'change', 'problem', 'hr_case', 'task']) assert.match(kindNote('record-summary', kind), /Read the five lines for/, kind);
});

test('resolution notes: a delivery has no cause, a change has an outcome, a problem keeps the lines Insert reads, an HR case has no close code', () => {
  for (const id of ['resolution-notes', 'prepare-close', 'resolution-improve']) {
    assert.match(kindNote(id, 'catalog_task'), /write no cause/, id);
    assert.match(kindNote(id, 'catalog_task'), /Delivered:.*Done:.*Requester to do:/, id);
    assert.match(kindNote(id, 'requested_item'), /Confirmed: how the requester confirmed it/, id);
    assert.match(kindNote(id, 'change'), /Outcome:.*Implementation:.*Verification:.*Issues:/, id);
    assert.match(kindNote(id, 'change'), /Suggested close code/, id);
    assert.match(kindNote(id, 'hr_case'), /What was done:.*Outcome:.*employee/, id);
    assert.doesNotMatch(kindNote(id, 'hr_case').replace(/instead of Cause, Fix, Verification and Suggested close code/, ''), /Suggested close code/, id);
    assert.match(kindNote(id, 'case'), /customer/, id);
    assert.match(kindNote(id, 'task'), /Done:.*Result:.*Left to do:/, id);
  }
  // a problem keeps Cause, Fix and Verification (Insert splits them into cause notes and fix notes) and gains a Workaround line
  const problem = kindNote('resolution-notes', 'problem');
  assert.match(problem, /Cause is the root cause/);
  assert.match(problem, /Workaround:/);
  assert.deepEqual(NOTES_KINDS.slice().sort(), ['case', 'catalog_task', 'change', 'hr_case', 'problem', 'request', 'requested_item', 'task']);
});

test('the lines the overrides name are the ones the action\'s own prompt has, so the two stay in step', () => {
  const notes = featureById('resolution-notes').system;
  for (const line of ['Cause:', 'Fix:', 'Verification:', 'Suggested close code:']) assert.ok(notes.includes(line), line);
  const summary = featureById('record-summary').system;
  for (const line of ['Issue:', 'Impact:', 'Done so far:', 'Current state:', 'Next step:']) assert.ok(summary.includes(line), line);
  // Prepare to close writes the notes without the close-code line; the override of a change still says to give the code line, which the
  // action's own prompt drops: the panel fills the code from the look-alikes, so the model is told "then the Suggested close code line" and
  // the Insert drops it (pickResolutionNotes).
  assert.ok(notesOnlyPrompt(notes).includes('Cause:') && !notesOnlyPrompt(notes).includes('Suggested close code:'));
  assert.ok(notes.includes(CODE_LINE) && notes.includes(CODE_RULE));
});

test('the lines of every kind\'s notes go into the right box: Insert drops the code line and nothing else', () => {
  const change = 'Outcome: it worked.\nImplementation: moved the service.\nVerification: checked.\nIssues: None\nSuggested close code: Successful';
  assert.equal(pickResolutionNotes(change), 'Outcome: it worked.\nImplementation: moved the service.\nVerification: checked.\nIssues: None');
  const order = 'Delivered: a laptop for the requester.\nDone: imaged and handed over.\nConfirmed: the requester signed for it.\nRequester to do: Nothing';
  assert.equal(pickResolutionNotes(order), order);
  const problem = 'Cause: a leaking pool.\nWorkaround: restart the pool nightly.\nFix: raised the limit.\nVerification: no leak for a week.\nSuggested close code: Fix applied';
  assert.equal(pickCauseNotes(problem), 'a leaking pool.');
  assert.equal(pickFixNotes(problem), 'Workaround: restart the pool nightly.\nFix: raised the limit.\nVerification: no leak for a week.');
});

test('only the actions that write about a ticket take the note; a chat, an article and the reports do not', () => {
  for (const id of ['record-summary', 'reply-draft', 'resolution-notes', 'prepare-close', 'resolution-improve', 'handoff-brief', 'missing-info', 'thread-summary', 'next-best-action', 'caller-briefing']) {
    assert.equal(takesKindNote(id), true, id);
    assert.ok(featureById(id), `${id} is a real action`);
    assert.ok(kindNote(id, 'catalog_task').startsWith(kindStatement('catalog_task')), id);
  }
  for (const id of ['chat-reply', 'article-optimise', 'shift-handover', 'hr-case-brief', 'change-cab-brief', 'problem-rca', 'unknown']) assert.equal(kindNote(id, 'incident'), '', id);
  assert.equal(kindNote('record-summary', 'knowledge'), '');
  for (const f of FEATURES) if (takesKindNote(f.id)) assert.ok(f.kinds.length > 0);
});

test('the note holds no ticket text: it is the same for every ticket of a kind, and has no slot', () => {
  for (const id of ['record-summary', 'resolution-notes', 'missing-info']) for (const kind of TICKET_KINDS) assert.equal(kindNote(id, kind), kindNote(id, kind));
  for (const id of ['record-summary', 'resolution-notes', 'prepare-close', 'resolution-improve', 'missing-info']) {
    for (const kind of TICKET_KINDS) assert.doesNotMatch(kindNote(id, kind), /[{}]|\bINC\d|\[PERSON/, `${id}/${kind}`);
  }
});

// ---- the pipeline appends the note to the system message (src/lib/pipeline.js prepareRun) ---------------------------------------------------
// The one line that does it belongs to the lead (a shared file): until prepareRun calls kindNote these two are skipped, and they run the day it does.
const WIRED = /kindNote\(/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'pipeline.js'), 'utf8'));
const whenWired = WIRED ? test : (name, fn) => test(name, { skip: 'src/lib/pipeline.js does not call kindNote yet (see the report of the kind-fit builder)' }, fn);

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const taskPack = () => ({
  version: 1, table: 'sc_task', sysId: 'a'.repeat(32), number: 'SCTASK0010099', kind: 'catalog_task',
  fields: { number: 'SCTASK0010099', short_description: 'Deliver the laptop', state: 'Work in Progress' },
  people: [], journal: [], related: {}, access: [],
});

whenWired('a run on a catalog task sends the kind sentence and the order\'s lines in its system message, once, before the language rule', () => {
  const prepared = prepareRun({ feature: featureById('resolution-notes'), pack: taskPack(), values: values(), policy: normalizePolicy({}), config: config(), createFirewall });
  const system = prepared.request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.equal(system.split(kindStatement('catalog_task')).length - 1, 1, 'the sentence is there once');
  assert.match(system, /Delivered: what this task provided or did/);
  assert.ok(system.indexOf(kindStatement('catalog_task')) > system.indexOf('Write exactly these lines'), 'after the action\'s own text');
});

whenWired('a run on an incident adds its sentence and changes nothing else about the prompt', () => {
  const pack = { ...taskPack(), table: 'incident', kind: 'incident' };
  const prepared = prepareRun({ feature: featureById('resolution-notes'), pack, values: values(), policy: normalizePolicy({}), config: config(), createFirewall });
  const system = prepared.request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(system.includes(kindStatement('incident')));
  assert.doesNotMatch(system, /write no cause/);
});
