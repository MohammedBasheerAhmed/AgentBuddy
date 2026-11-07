import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckView, codeFieldOf, readyLine, resolutionCheck } from '../src/checks/resolutionCheck.js';
import { fixFor } from '../src/insights/fixes.js';
import { featureById } from '../src/features/registry.js';
import { CLOSE_NOTES_KINDS } from '../src/features/packs/kinds.js';

// Audit of 2026-11-07, F4, F8, W-09, W-10: "Ready to resolve?" in the words of the kind. A delivered item has no cause; a change has an
// outcome and a code; an HR case read without its text is not "no notes yet"; a catalog task has no conversation with the customer to
// check, so the Close row can say "Looks ready".

const GOOD = 'Delivered the laptop to the third floor and the requester signed for it. Nothing else is needed from them.';
const CHARLIE = { role: 'requested_for', name: 'Charlie Whitherspoon', email: 'charlie.w@example.com', sysId: 'c'.repeat(32) };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com', sysId: 'b'.repeat(32) };

const pack = (over = {}) => ({
  version: 1, table: 'sc_task', sysId: 'a'.repeat(32), number: 'SCTASK0010099', kind: 'catalog_task',
  fields: { number: 'SCTASK0010099', state: 'Work in Progress', close_notes: GOOD },
  people: [CHARLIE, BETH], journal: [], related: {}, access: [{ source: 'journal', status: 'empty', note: '' }], ...over,
});
const byId = (checks, id) => checks.find((c) => c.id === id);

test('a catalog task with good notes, no hold and no secrets looks ready: it has no customer conversation and no cause to check', () => {
  const view = buildCheckView(pack());
  assert.equal(byId(view.checks, 'customer'), undefined, 'the requester does not read a catalog task\'s comments');
  assert.equal(view.summary.tone, 'ok');
  assert.equal(readyLine(view), 'Looks ready');
  assert.equal(view.kind, 'catalog_task');
});

test('a catalog task with no notes asks what was delivered, never for a cause', () => {
  const view = buildCheckView(pack({ fields: { number: 'SCTASK0010099', state: 'Work in Progress' } }));
  const notes = byId(view.checks, 'notes');
  assert.equal(notes.status, 'warn');
  assert.equal(notes.title, 'No close notes yet');
  assert.match(notes.hint, /what was delivered or done/);
  assert.doesNotMatch(`${notes.title} ${notes.hint}`, /cause|resolution notes/i);
  assert.equal(readyLine(view), 'Not yet: the close notes need work');
  assert.match(fixFor(notes, 'catalog_task').where, /Close notes are on the form/);
  assert.match(fixFor(notes, 'incident').where, /Resolution notes are on the form/);
});

test('short notes say what is missing for the kind', () => {
  const short = (kind) => byId(resolutionCheck(pack({ kind, fields: { close_notes: 'Done and delivered.' } })), 'notes');
  assert.equal(short('requested_item').title, 'The close notes are very short');
  assert.match(short('requested_item').hint, /delivered/);
  assert.equal(short('change').title, 'The close notes are very short');
  assert.match(short('change').hint, /how it ended/);
  assert.equal(short('incident').title, 'The resolution notes are very short');
  assert.match(short('incident').hint, /cause/);
  assert.equal(byId(resolutionCheck(pack({ kind: 'change' })), 'notes').title, 'Close notes are filled in');
  assert.equal(byId(resolutionCheck(pack({ kind: 'incident' })), 'notes').title, 'Resolution notes are filled in');
});

test('an incident is checked as before: no messages is a note, the customer is "the caller"', () => {
  const incident = pack({ kind: 'incident', table: 'incident', people: [{ ...CHARLIE, role: 'caller' }, BETH] });
  assert.equal(byId(resolutionCheck(incident), 'customer').title, 'No messages to or from the customer on this ticket');
  const waiting = pack({
    kind: 'incident', table: 'incident', people: [{ ...CHARLIE, role: 'caller' }, BETH], fields: { number: 'INC1', state: 'In Progress', close_notes: GOOD, close_code: 'Solved (Permanently)' },
    journal: [{ type: 'comment', by: 'Beth Anglin', when: '2026-10-20 09:00:00', text: 'Please confirm the fix works.' }],
  });
  const view = buildCheckView(waiting, {}, { now: Date.parse('2026-10-21T09:00:00Z') });
  assert.match(readyLine(view), /^Not yet: the caller has not confirmed/);
});

test('a requested item is checked against its requester: silence is not a finding, a waiting last message is', () => {
  const item = (journal) => pack({ kind: 'requested_item', table: 'sc_req_item', journal });
  assert.equal(byId(resolutionCheck(item([])), 'customer'), undefined, 'a request is fulfilled without a word');
  const view = buildCheckView(item([{ type: 'comment', by: 'Beth Anglin', when: '2026-10-20 09:00:00', text: 'Your laptop is ready, can you confirm?' }]), {}, { now: Date.parse('2026-10-20T10:00:00Z') });
  assert.equal(byId(view.checks, 'customer').status, 'warn', 'the requester is known (src/context/identity.js), so the last message from the agent is seen');
  assert.equal(readyLine(view), 'Not yet: the requester has not confirmed');
  const readerWrote = buildCheckView(item([{ type: 'comment', by: 'Charlie Whitherspoon', when: '2026-10-20 09:00:00', text: 'Got it, thanks.' }]));
  assert.equal(byId(readerWrote.checks, 'customer').status, 'ok');
});

test('the kinds with no conversation to check say nothing about the customer, even when the notes could not be read', () => {
  for (const kind of ['catalog_task', 'change', 'problem', 'task']) {
    const checks = resolutionCheck(pack({ kind, access: [{ source: 'journal', status: 'denied', note: 'Not available to you with your role.' }] }));
    assert.equal(byId(checks, 'customer'), undefined, kind);
  }
});

test('a change has a close code and is asked for it in its own words; the code field of each kind', () => {
  const change = pack({ kind: 'change', table: 'change_request', people: [BETH] });
  const code = byId(resolutionCheck(change), 'code');
  assert.equal(code.status, 'warn');
  assert.match(code.hint, /how the change went/);
  assert.equal(codeFieldOf('change'), 'close_code');
  assert.equal(codeFieldOf('incident'), 'close_code');
  assert.equal(codeFieldOf('case'), 'resolution_code');
  assert.equal(codeFieldOf('requested_item'), '');
  assert.equal(readyLine(buildCheckView(change)), 'Not yet: no close code chosen');
  assert.equal(byId(resolutionCheck({ ...change, fields: { ...change.fields, close_code: 'Successful' } }), 'code').status, 'ok');
});

test('an HR case read without its text is "could not read", never "no notes yet"; read in full it is checked like any other', () => {
  const minimised = pack({
    kind: 'hr_case', table: 'sn_hr_core_case', fields: { number: 'HRC0001001', state: 'Work in Progress' }, people: [BETH],
    access: [
      { source: 'sn_hr_core_case', status: 'skipped', note: 'This kind of ticket holds sensitive data, so free text and identities were not read.' },
      { source: 'journal', status: 'skipped', note: 'Notes and comments on sensitive tickets are not read unless sensitive data is allowed.' },
    ],
  });
  const view = buildCheckView(minimised);
  const notes = byId(view.checks, 'notes');
  assert.equal(notes.status, 'info');
  assert.equal(notes.title, 'Could not read the saved close notes');
  assert.match(notes.hint, /sensitive data/);
  assert.notEqual(view.summary.tone, 'ok', 'a check that could not be made is not "looks ready"');
  assert.ok(view.checks.filter((c) => c.status === 'warn').length === 0, 'and it does not warn about what it could not see');

  const open = pack({ kind: 'hr_case', table: 'sn_hr_core_case', fields: { number: 'HRC0001001', state: 'Work in Progress' }, people: [{ ...CHARLIE, role: 'opened_for' }, BETH] });
  assert.equal(byId(resolutionCheck(open), 'notes').title, 'No close notes yet');
  assert.match(byId(resolutionCheck(open), 'notes').hint, /Say what was done and how it ended/);
  assert.equal(readyLine(buildCheckView(open)), 'Not yet: the close notes need work');
  assert.equal(readyLine(buildCheckView({ ...open, fields: { ...open.fields, close_notes: GOOD }, journal: [{ type: 'comment', by: 'Beth Anglin', when: '2026-10-20 09:00:00', text: 'Please confirm.' }] }, {}, { now: Date.parse('2026-10-20T10:00:00Z') })), 'Not yet: the employee has not confirmed');
});

test('a request is checked with the notes its ceiling now reads', () => {
  const request = pack({ kind: 'request', table: 'sc_request', fields: { number: 'REQ0010030', state: 'Open', close_notes: GOOD } });
  assert.equal(byId(resolutionCheck(request), 'notes').status, 'ok');
});

test('the actions that write the notes are offered on every kind that has a notes box, and nowhere else', () => {
  assert.deepEqual([...CLOSE_NOTES_KINDS].sort(), ['case', 'catalog_task', 'change', 'hr_case', 'incident', 'problem', 'requested_item', 'task']);
  for (const id of ['resolution-notes', 'prepare-close']) assert.deepEqual([...featureById(id).kinds].sort(), [...CLOSE_NOTES_KINDS].sort(), id);
  assert.ok(featureById('resolution-improve').kinds.includes('change') && featureById('resolution-improve').kinds.includes('hr_case'));
  assert.ok(featureById('handoff-brief').kinds.includes('change'), 'a change has a hand-off (W-10)');
  assert.ok(!featureById('reply-draft').kinds.includes('change') && !featureById('missing-info').kinds.includes('change'), 'but no reply: nobody is waiting for one');
});
