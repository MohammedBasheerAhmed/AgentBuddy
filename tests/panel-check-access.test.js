import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_UNREADABLE, buildCheckView, resolutionCheck } from '../src/checks/resolutionCheck.js';
import { readContextPack } from '../src/context/pack.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';

// Integration review M3: the Check tab must not say "nothing there" about notes it was not allowed to read.

const GOOD_NOTES = 'Replaced the expired VPN gateway certificate on EU-2 and restarted the service. The user reconnected and stayed connected for an hour.';
const incident = (over = {}) => ({
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC1',
  kind: 'incident',
  fields: { number: 'INC1', state: 'In Progress', close_code: 'Solution provided', close_notes: GOOD_NOTES },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: { childTasks: [] },
  access: [],
  ...over,
});
const find = (checks, id) => checks.find((c) => c.id === id);
const journal = (status, note = '') => [{ source: 'journal', status, note }];

test('a denied journal: the customer check is a note that says so, not "No messages"', () => {
  const checks = resolutionCheck(incident({ access: journal('denied', 'Your user cannot read the notes and comments of this record.') }), {}, { now: NOW });
  const customer = find(checks, 'customer');
  assert.equal(customer.status, 'info');
  assert.equal(customer.title, 'Could not read the notes and comments');
  assert.equal(NOTES_UNREADABLE, 'Could not read the notes and comments');
  assert.match(customer.hint, /cannot read the notes and comments of this record/, 'with the access note');
  assert.ok(!/No messages/.test(JSON.stringify(checks)), 'nowhere does the list claim there are no messages');
});

test('a denied journal: the personal-data check does not say "nothing spotted"', () => {
  const checks = resolutionCheck(incident({ access: journal('denied', 'Your user cannot read the notes and comments of this record.') }), {}, { now: NOW });
  const pii = find(checks, 'pii');
  assert.equal(pii.status, 'info');
  assert.equal(pii.title, 'Could not read the notes and comments');
  assert.match(pii.hint, /comments already on the ticket were not checked/);
  assert.match(pii.hint, /No personal data or secrets were spotted in the text you can see/, 'what WAS read is still reported, as what it is');
  assert.ok(!/No personal data or secrets spotted in the text/.test(JSON.stringify(checks)));
});

test('every way the notes can be unreadable gets the same honesty: hidden, error, skipped, and blocked by the organisation', () => {
  for (const status of ['denied', 'empty-or-hidden', 'error', 'skipped', 'blocked']) {
    const checks = resolutionCheck(incident({ access: journal(status) }), {}, { now: NOW });
    assert.equal(find(checks, 'customer').title, NOTES_UNREADABLE, status);
    assert.equal(find(checks, 'pii').title, NOTES_UNREADABLE, status);
    assert.ok(find(checks, 'customer').hint.length > 20, `${status}: a hint is still given`);
  }
});

test('an unreadable journal does not hide a real finding: a card number in the resolution notes is still a warning', () => {
  const pack = incident({ fields: { state: 'x', close_code: 'x', close_notes: `${GOOD_NOTES} Card 4111 1111 1111 1111 was used.` }, access: journal('denied') });
  const pii = find(resolutionCheck(pack), 'pii');
  assert.equal(pii.status, 'warn');
  assert.match(pii.hint, /1 card number/);
  assert.ok(!JSON.stringify(pii).includes('4111'));
});

test('a journal that WAS read is trusted as before: real emptiness, comments found, and the "record fields" fallback all work', () => {
  const read = (status, note) => resolutionCheck(incident({ access: journal(status, note) }), {}, { now: NOW });
  assert.match(find(read('empty', 'This record has no notes or comments.'), 'customer').title, /No messages to or from the customer/);
  assert.equal(find(read('ok', ''), 'customer').status, 'info');
  assert.match(find(read('ok', ''), 'pii').title, /No personal data or secrets spotted/);
  const fallback = read('ok', "The journal table could not be read by your user, so notes were read from the record's own comments and work notes fields.");
  assert.match(find(fallback, 'customer').title, /No messages/, 'notes WERE read, from the record\'s own fields');
  // no access entry at all (a hand-made pack): behaves as before
  assert.match(find(resolutionCheck(incident()), 'customer').title, /No messages/);
  // another source's trouble is not the journal's
  assert.match(find(resolutionCheck(incident({ access: [{ source: 'task', status: 'denied', note: '' }] })), 'customer').title, /No messages/);
});

test('an unreadable form is said where the check is about what the person has typed', () => {
  const empty = incident({ fields: { state: 'In Progress' } });
  const noForm = resolutionCheck(empty, {});
  assert.match(find(noForm, 'notes').hint, /no form Agent Buddy can read/);
  assert.match(find(noForm, 'code').hint, /no form Agent Buddy can read/);
  const withForm = resolutionCheck(empty, { form: { close_notes: '', close_code: '' } });
  assert.ok(!/no form/.test(find(withForm, 'notes').hint));
  assert.ok(!/no form/.test(find(withForm, 'code').hint));
  // a clean text on a page with no readable form: fine, but only for what is saved
  const clean = find(resolutionCheck(incident(), {}), 'pii');
  assert.equal(clean.status, 'ok');
  assert.match(clean.hint, /typed and not saved on this page was not checked/);
  assert.equal(find(resolutionCheck(incident(), { form: { close_notes: GOOD_NOTES } }), 'pii').hint, '');
});

test('the summary of a ticket whose notes could not be read never says it is all clear', () => {
  const view = buildCheckView(incident({ access: journal('denied') }), { form: { close_notes: GOOD_NOTES }, links: { problem: { status: 'yes' }, knowledge: { status: 'yes' } } }, { now: NOW });
  assert.equal(view.summary.tone, 'info');
  assert.equal(view.summary.headline, 'Nothing is wrong, but there are a few notes');
});

test('from a real pack: a denied journal table, and no notes on the record itself, gives the same answer', async () => {
  // The fixture incident also carries its notes in its own comments / work_notes fields, which the engine falls back on; take them
  // away so that nothing can be read at all.
  const tables = buildInstance();
  tables.incident = tables.incident.map((row) => ({ ...row, comments: '', work_notes: '' }));
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(tables, { denied: ['sys_journal_field'] }), { feature: 'resolution-check' });
  const entry = pack.access.find((a) => a.source === 'journal');
  assert.ok(['denied', 'empty-or-hidden'].includes(entry.status), `the context engine reports it: ${entry.status}`);
  assert.deepEqual(pack.journal, []);
  const checks = resolutionCheck(pack, {}, { now: NOW });
  assert.equal(find(checks, 'customer').title, NOTES_UNREADABLE);
  assert.equal(find(checks, 'pii').title, NOTES_UNREADABLE);
  // ...and the same ticket with the journal readable still gets the old answers
  const readable = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: 'resolution-check' });
  assert.notEqual(find(resolutionCheck(readable, {}, { now: NOW }), 'customer').title, NOTES_UNREADABLE);
});
