import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTypedText, phrasesWith, reviewForCustomer, reviewForInsert } from '../src/safeSend/review.js';
import { DEFAULT_INTERNAL_PHRASES } from '../src/safeSend/index.js';
import { ticketLabel } from '../src/compose/ticketLabel.js';
import { CHECK_FIELDS, checkSummary } from '../src/sidepanel/write/SafeSendCheck.jsx';

// N22 "Check my comment" (round 3): the safe-to-send check on what the agent typed, with the organisation's internal phrases on top
// of the built-in ones; and the line that names the ticket the Write tools work on.

const NOTE = 'Internal: the finance share for the Q3 restructuring is the cause here.';
const people = [{ name: 'Abel Tuter', email: 'abel.tuter@example.com' }];

test('the organisation\'s phrases are added to the built-in ones, never replace them; repeats and blanks are dropped', () => {
  const list = phrasesWith(['Project Falcon', ' project  falcon ', '', 7, 'WORK NOTE']);
  assert.deepEqual(list.slice(0, DEFAULT_INTERNAL_PHRASES.length), [...DEFAULT_INTERNAL_PHRASES]);
  assert.deepEqual(list.slice(DEFAULT_INTERNAL_PHRASES.length), ['Project Falcon']);
  assert.deepEqual(phrasesWith(undefined), [...DEFAULT_INTERNAL_PHRASES]);
});

test('the review flags an organisation phrase in a customer message, and still the built-in ones', () => {
  const text = 'Project Falcon is behind this. This is internal only.';
  const without = reviewForCustomer(text, { people });
  assert.deepEqual(without.serious.filter((f) => f.kind === 'INTERNAL_PHRASE').map((f) => f.excerpt), ['internal only']);
  const withOrg = reviewForCustomer(text, { people, internalPhrases: ['Project Falcon'] });
  assert.deepEqual(withOrg.serious.filter((f) => f.kind === 'INTERNAL_PHRASE').map((f) => f.excerpt), ['Project Falcon', 'internal only']);
  assert.deepEqual(reviewForInsert('work_notes', text, { internalPhrases: ['Project Falcon'] }), { serious: [], hints: [] }, 'a work note is internal anyway');
});

test('checkTypedText: empty, internal, clean and findings, the same review as an insert into that field', () => {
  assert.equal(checkTypedText('comments', '   ').status, 'empty');
  assert.equal(checkTypedText('work_notes', 'password: Winter2026!x').status, 'internal', 'a work note is not checked as customer text');
  const clean = checkTypedText('comments', 'Hello Abel, the VPN works again.', { people });
  assert.deepEqual(clean, { status: 'clean', serious: [], hints: [] });
  const bad = checkTypedText('comments', 'Your password: Winter2026!x. Project Falcon will fix it.', { people, internalPhrases: ['Project Falcon'] });
  assert.equal(bad.status, 'findings');
  assert.deepEqual(bad.serious.map((f) => f.kind).sort(), ['INTERNAL_PHRASE', 'SECRET']);
  assert.ok(!JSON.stringify(bad).includes('Winter2026!x'), 'a finding never carries the value');
  const hintOnly = checkTypedText('comments', 'See https://status.example.com for updates.', { people });
  assert.equal(hintOnly.status, 'findings');
  assert.equal(hintOnly.serious.length, 0);
  assert.equal(hintOnly.hints[0].kind, 'LINK');
});

test('words copied from a work note stop a customer comment, but are only a hint in resolution notes', () => {
  const text = 'Hello, the finance share for the Q3 restructuring is the cause here.';
  const comment = checkTypedText('comments', text, { people, internalTexts: [NOTE] });
  assert.ok(comment.serious.some((f) => f.kind === 'INTERNAL_NOTE'));
  const close = checkTypedText('close_notes', text, { people, internalTexts: [NOTE] });
  assert.ok(!close.serious.some((f) => f.kind === 'INTERNAL_NOTE'));
  assert.ok(close.hints.some((f) => f.kind === 'INTERNAL_NOTE'));
  // The insert review itself is unchanged by this: the insert flow decides that for resolution notes (src/sidepanel/insertFlow.js).
  assert.ok(reviewForInsert('close_notes', text, { people, internalTexts: [NOTE] }).serious.some((f) => f.kind === 'INTERNAL_NOTE'));
});

test('the fields "Check my comment" offers are the customer-visible multi-line ones', () => {
  assert.deepEqual(CHECK_FIELDS.map((f) => f.name), ['comments', 'close_notes', 'description']);
});

test('the card summary says how much needs a look', () => {
  assert.deepEqual(checkSummary(null), { text: '', attention: '' });
  assert.deepEqual(checkSummary({ result: { status: 'clean', serious: [], hints: [] } }), { text: 'Nothing found', attention: '' });
  assert.deepEqual(checkSummary({ result: { status: 'findings', serious: [{}, {}], hints: [] } }), { text: '2 to check before sending', attention: 'warn' });
  assert.deepEqual(checkSummary({ result: { status: 'findings', serious: [], hints: [{}] } }), { text: '1 worth a look', attention: '' });
  assert.deepEqual(checkSummary({ result: { status: 'empty', serious: [], hints: [] } }), { text: '', attention: '' });
});

test('the ticket line: number and title, a new form, or no ticket', () => {
  const dash = String.fromCharCode(0x2013);
  const page = { record: { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0012345' } };
  assert.deepEqual(ticketLabel(page, null), { kind: 'record', number: 'INC0012345', text: 'For INC0012345' });
  assert.equal(ticketLabel(page, { short_description: '  VPN   keeps disconnecting ' }).text, `For INC0012345 ${dash} VPN keeps disconnecting`);
  const long = ticketLabel(page, { short_description: 'x'.repeat(200) }).text;
  assert.ok(long.length < 100 && long.endsWith('...'));
  assert.equal(ticketLabel({ record: { table: 'incident', sysId: 'a'.repeat(32) } }, { number: 'INC1' }).text, 'For INC1');
  assert.deepEqual(ticketLabel({ record: null, newRecord: { table: 'sn_customerservice_case' } }), { kind: 'new', number: '', text: 'For a new case form' });
  assert.equal(ticketLabel({}).kind, 'none');
  assert.equal(ticketLabel(null).text, 'No ticket is open.');
});
