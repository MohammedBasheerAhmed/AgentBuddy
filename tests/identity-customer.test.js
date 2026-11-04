import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOMER_ROLES, authorRole, customersOf, foldText, foldWords, identities, personKey } from '../src/context/identity.js';
import { isLocalTime, readJournal } from '../src/context/journal.js';
import { resolutionCheck } from '../src/checks/resolutionCheck.js';
import { computeSignals } from '../src/itsm/sentiment.js';
import { customerWaiting } from '../src/insights/glance.js';
import { noteInstant } from '../src/insights/time.js';
import { stepsThatWorked } from '../src/insights/steps.js';
import { fillEmailTemplate, recipientOf } from '../src/insights/emailTemplates.js';
import { readSignals, recommendEmails, statusLines } from '../src/compose/emailRecommend.js';
import { readFieldHistory } from '../src/content/ops/insights.js';
import { entriesByTicket, markerFor } from '../src/mywork/markers.js';
import { followUpReason, followUps } from '../src/mywork/followups.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

// One answer to "who is the customer, and did they write this?" (src/context/identity.js), in every script, and the time and wording
// fixes around it (audit phase 3: P3.1 to P3.4, P3.7 to P3.9, P3.11, P3.28).

const NOW = Date.UTC(2026, 10, 4, 12);
const H = 3600000;
const D = 24 * H;
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ID = 'a'.repeat(32);

const ARABIC = 'أحمد علي';
const CYRILLIC = 'Иван Петров';
const CJK = '山田 太郎';

// ---- the keys ----------------------------------------------------------------------------------------------------------------------

test('identity: names in any script fold to words; Latin keys are as before; no letter at all is the empty key', () => {
  assert.deepEqual(foldWords(ARABIC), ['احمد', 'علي'], 'Arabic letters are kept; the hamza on the alif is a mark and goes');
  assert.equal(personKey('أحمد علي'), personKey('احمد علي'));
  assert.equal(personKey('Иван Петров'), personKey('ПЕТРОВ, Иван'));
  assert.equal(personKey(CJK), personKey('太郎 山田'));
  assert.notEqual(personKey(ARABIC), '');
  // Latin: case, accents, order and punctuation do not matter, as before
  assert.equal(personKey('Tuter, Abel'), personKey('abel.tuter'));
  assert.equal(personKey('ABEL TUTER'), 'abel tuter');
  assert.equal(personKey(`Jos${String.fromCharCode(0xe9)} N${String.fromCharCode(0xfa, 0xf1)}ez`), personKey('Nunez Jose'));
  for (const nothing of ['', '  ', '—', '...', null, undefined, {}]) assert.equal(personKey(nothing), '', String(nothing));
  assert.equal(foldText('Reset the password!'), 'reset the password', 'text keeps its word order');
});

test('identity: the customer roles are the ones the context engine produces, HR included; opened_by and requested_by are not', () => {
  assert.deepEqual([...CUSTOMER_ROLES], ['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'subject_person']);
  const pack = { people: [{ role: 'opened_by', name: 'Beth Anglin' }, { role: 'requested_by', name: 'Dave Loftus' }, { role: 'subject_person', name: 'Fatima Noor' }, null] };
  assert.deepEqual(customersOf(pack).map((p) => p.name), ['Fatima Noor']);
});

test('identity: an author in any script, written as a login or an address, is matched; what cannot be told is "unknown"', () => {
  const ids = identities({
    people: [
      { role: 'caller', name: ARABIC, email: 'ahmed.ali@example.com' },
      { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com' },
    ],
  });
  assert.equal(authorRole(ARABIC, ids), 'customer');
  assert.equal(authorRole('احمد علي', ids), 'customer', 'with or without the hamza');
  assert.equal(authorRole('ahmed.ali', ids), 'customer', 'login = front of the email address');
  assert.equal(authorRole('Ahmed.Ali@example.com', ids), 'customer');
  assert.equal(authorRole('beth.anglin', ids), 'support', "the assignee's login");
  assert.equal(authorRole('Dave Loftus', ids), 'support', 'a display name that is not the customer');
  assert.equal(authorRole('x123456', ids), 'unknown', 'a login that matches no one may still be the customer');
  assert.equal(authorRole('', ids), 'unknown');
  assert.equal(authorRole('—', ids), 'unknown', 'an author with no letter is never a match');
  // A customer whose name has no letter to compare is not known: nothing is claimed.
  const blank = identities({ people: [{ role: 'caller', name: '—' }] });
  assert.equal(blank.known, false);
  assert.equal(authorRole('—', blank), 'unknown');
  // CJK and Cyrillic customers
  assert.equal(authorRole('太郎 山田', identities({ people: [{ role: 'caller', name: CJK }] })), 'customer');
  assert.equal(authorRole('Петров, Иван', identities({ people: [{ role: 'contact', name: CYRILLIC }] })), 'customer');
});

// ---- P3.1: Check before you resolve -----------------------------------------------------------------------------------------------

const resolvePack = (customer, lastBy = customer.name, extra = {}) => ({
  version: 1,
  table: 'incident',
  sysId: ID,
  number: 'INC1',
  kind: 'incident',
  fields: { state: 'In Progress', close_code: 'x', close_notes: 'Replaced the expired VPN gateway certificate and restarted the service for everyone.' },
  people: [customer, { role: 'assigned_to', name: 'Beth Anglin' }],
  journal: [
    { when: '2026-10-28 09:00:00', by: 'Beth Anglin', type: 'comment', text: 'Please try again now.' },
    { when: '2026-10-30 09:00:00', by: lastBy, type: 'comment', text: 'It still does not work for me.' },
  ],
  related: { childTasks: [] },
  access: [],
  ...extra,
});
const customerCheck = (pack) => resolutionCheck(pack, {}, { now: NOW }).find((c) => c.id === 'customer');

test('P3.1 resolve check: an Arabic, Cyrillic or CJK customer who wrote last is seen (not "no reply for 5 days")', () => {
  for (const name of [ARABIC, CYRILLIC, CJK, 'Abel Tuter']) {
    const c = customerCheck(resolvePack({ role: 'caller', name }));
    assert.equal(c.title, 'The customer wrote the last message', name);
  }
  // the author written as a login: the front of the customer's email
  const login = customerCheck(resolvePack({ role: 'caller', name: CYRILLIC, email: 'ivan.petrov@example.com' }, 'ivan.petrov'));
  assert.equal(login.title, 'The customer wrote the last message');
  // HR: the employee the case is for, or the person it is about
  for (const role of ['opened_for', 'subject_person']) {
    const hr = customerCheck({ ...resolvePack({ role, name: 'Fatima Noor' }), kind: 'hr_case', table: 'sn_hr_core_case' });
    assert.equal(hr.title, 'The customer wrote the last message', role);
  }
  // a login that matches no one is not taken for an agent
  assert.equal(customerCheck(resolvePack({ role: 'caller', name: ARABIC }, 'x123456')).title, 'Could not tell who wrote the last message');
});

// ---- P3.2: mood signals and "customer waiting" ------------------------------------------------------------------------------------

const moodPack = (customer) => ({
  kind: 'incident',
  fields: { state: 'In Progress' },
  people: [customer, { role: 'assigned_to', name: 'Beth Anglin' }],
  journal: [
    { when: '2026-10-28 09:00:00', by: 'Beth Anglin', type: 'comment', text: 'Please try again now.' },
    { when: '2026-10-30 09:00:00', by: customer.name, type: 'comment', text: 'It still does not work, this is unacceptable!!' },
  ],
  related: {},
  access: [{ source: 'journal', status: 'ok', strategy: 'sys_journal_field' }],
});

test('P3.2 mood signals: an Arabic customer and an HR employee are told apart from support; their waiting is seen', () => {
  for (const customer of [{ role: 'caller', name: ARABIC }, { role: 'opened_for', name: 'Fatima Noor' }, { role: 'subject_person', name: CYRILLIC }]) {
    const pack = moodPack(customer);
    const s = computeSignals(pack, { now: NOW });
    assert.equal(s.customerKnown, true, customer.role);
    assert.equal(s.customerMessages, 1, customer.name);
    assert.equal(s.supportReplies, 1);
    assert.equal(s.awaitingReply, true);
    assert.deepEqual(s.frustrationWords, ['unacceptable']);
    const wait = customerWaiting(pack, NOW);
    assert.equal(wait.waiting, true, customer.name);
    assert.equal(wait.messages, 1);
  }
});

test('P3.2 mood signals: a login that matches no one is not counted as a reply from support', () => {
  const pack = moodPack({ role: 'caller', name: 'Abel Tuter' });
  pack.journal.push({ when: '2026-10-31 09:00:00', by: 'x123456', type: 'comment', text: 'Any update?' });
  const s = computeSignals(pack, { now: NOW });
  assert.equal(s.supportReplies, 1, 'only Beth');
  assert.equal(customerWaiting(pack, NOW).waiting, false, 'an author that cannot be told: nothing is claimed');
});

// ---- P3.3: steps that worked ------------------------------------------------------------------------------------------------------

test('P3.3 steps: distinct fixes written in Arabic or Cyrillic are all kept; the same fix twice is shown once', () => {
  const r = stepsThatWorked({
    lookalikes: [
      { number: 'INC1', close_notes: 'تمت إعادة تشغيل خدمة VPN على الخادم.', score: 90 },
      { number: 'INC2', close_notes: 'تم تحديث برنامج التشغيل للطابعة.', score: 80 },
      { number: 'INC3', close_notes: 'Сброшен пароль пользователя.', score: 70 },
      { number: 'INC4', close_notes: 'تم تحديث برنامج التشغيل للطابعة!', score: 60 },
    ],
  });
  assert.deepEqual(r.items.map((i) => i.number), ['INC1', 'INC2', 'INC3']);
});

// ---- P3.11: template placeholders, and the HR recipient ---------------------------------------------------------------------------

test('P3.11 templates: brackets in the ticket title are not placeholders; a missing title is one', () => {
  const fill = (title) => fillEmailTemplate('closure', { pack: { fields: { number: 'INC9', short_description: title }, people: [] }, agentName: 'Beth' });
  const urgent = fill('[URGENT] VPN down');
  assert.equal(urgent.subject, 'INC9 is closed: [URGENT] VPN down');
  assert.equal(urgent.placeholders, fill('VPN down').placeholders);
  assert.equal(urgent.placeholders, 0);
  assert.equal(fill('').placeholders, 2, 'no title: [short description] in the subject and in the body');
  assert.equal(fillEmailTemplate('ask-info', { pack: { fields: { number: 'INC9', short_description: '[URGENT] y' }, people: [] } }).placeholders, 3, 'two lines to fill and [your name]');
});

test('templates: an HR case is addressed to its employee (opened_for first, then subject_person)', () => {
  assert.equal(recipientOf({ people: [{ role: 'subject_person', name: 'Fatima Noor' }] }).firstName, 'Fatima');
  assert.equal(recipientOf({ people: [{ role: 'subject_person', name: 'Fatima Noor' }, { role: 'opened_for', name: 'Omar Haddad' }] }).name, 'Omar Haddad');
  assert.equal(recipientOf({ people: [{ role: 'opened_by', name: 'Beth Anglin' }] }), null);
});

// ---- P3.9: a stale hold reason ----------------------------------------------------------------------------------------------------

test('P3.9 email suggestions: the state decides "on hold"; a hold reason left on a live ticket is not said', () => {
  const live = { kind: 'incident', fields: { state: 'In Progress', hold_reason: 'Awaiting Caller' }, people: [], journal: [], related: {}, access: [] };
  const s = readSignals(live, NOW);
  assert.equal(s.onHold, false);
  assert.equal(s.waitingOnCustomer, false);
  assert.equal(s.hold, '');
  assert.equal(recommendEmails(live, { now: NOW }).facts[0], 'In Progress');
  assert.ok(!statusLines(live, NOW).some((l) => /hold|waiting for a reply/.test(l)));
  // On hold by its state: the reason says for whom
  const held = readSignals({ ...live, fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' } }, NOW);
  assert.deepEqual([held.onHold, held.waitingOnCustomer, held.hold], [true, true, 'Awaiting Caller']);
  // No state to read: the reason is all there is
  assert.equal(readSignals({ ...live, fields: { hold_reason: 'Awaiting Vendor' } }, NOW).onHold, true);
  assert.equal(readSignals({ ...live, fields: { state: 'On Hold', hold_reason: '-- None --' } }, NOW).hold, '');
});

// ---- P3.7 / P3.8: notes on two clocks -----------------------------------------------------------------------------------------------

// The reader is three hours ahead of UTC. Comments come from the journal table (UTC), work notes only from the record's own text.
const journalTable = () => ({
  sys_journal_field: [
    { sys_id: 'j1', name: 'incident', element_id: ID, element: 'comments', sys_created_on: '2026-10-26 08:00:00', sys_created_by: 'beth.anglin', value: '[code]<p>Please restart the VPN client.</p>[/code]' },
    { sys_id: 'j2', name: 'incident', element_id: ID, element: 'comments', sys_created_on: '2026-10-26 09:00:00', sys_created_by: 'abel.tuter', value: 'Done, it works now.' },
  ],
  incident: [],
});
const COMMENTS = '2026-10-26 12:00:00 - Abel Tuter (Additional comments)\nDone, it works now.\n\n2026-10-26 11:00:00 - Beth Anglin (Additional comments)\nPlease restart the VPN client.\n';
const WORK_NOTES = '2026-10-26 11:30:00 - Beth Anglin (Work notes)\nRestarted the gateway.\n';
const readMixed = (comments) => readJournal({ table: 'incident', sysId: ID, recordText: { comments, work_notes: WORK_NOTES } }, fakeDeps(journalTable()));

test('P3.7 journal: a column read from the record\'s text next to one from the table is put on UTC, then ordered', async () => {
  const { entries, access } = await readMixed(COMMENTS);
  assert.deepEqual(entries.map((e) => [e.type, e.when]), [
    ['comment', '2026-10-26 08:00:00'],
    ['work_note', '2026-10-26 08:30:00'],
    ['comment', '2026-10-26 09:00:00'],
  ]);
  assert.equal(access[0].strategy, 'mixed');
  assert.equal(access[0].localTimes, undefined);
  assert.match(access[0].note, /showed no work notes for this record, so they were read from the record's own work notes field\.$/);
  assert.doesNotMatch(access[0].note, /showed no entries|Times are in your time zone/);
  assert.equal(isLocalTime(entries[1], access), false);
});

test('P3.7 journal: when the clocks cannot be matched, the local column is named, and each consumer reads each note on its own clock', async () => {
  const { entries, access } = await readMixed(''); // the comments' own text is not there to learn the offset from
  assert.deepEqual(access[0].localTimes, ['work_note']);
  assert.match(access[0].note, /Their times are in your time zone/);
  const work = entries.find((e) => e.type === 'work_note');
  const comment = entries.find((e) => e.type === 'comment');
  assert.equal(isLocalTime(work, access), true);
  assert.equal(isLocalTime(comment, access), false);
  // The Insights times: a UTC comment is taken as it is; the local work note is put right with the record's offset.
  const pack = { fields: { sys_updated_on: '2026-10-26 12:05:00' }, related: { times: { sys_updated_on: '2026-10-26 09:05:00' } }, access };
  assert.deepEqual(noteInstant(comment, pack), { ms: Date.UTC(2026, 9, 26, 8, 0, 0), approx: false });
  assert.deepEqual(noteInstant(work, pack), { ms: Date.UTC(2026, 9, 26, 8, 30, 0), approx: false });
});

test('P3.7 email suggestions: comments read from the record\'s text are compared with the record\'s displayed dates', () => {
  // Resolved at 09:00 UTC (12:00 for the reader); the agent's last comment was at 07:30 UTC (10:30 for the reader): before it.
  const pack = {
    kind: 'incident',
    fields: { state: 'Resolved', resolved_at: '2026-10-26 12:00:00' },
    people: [{ role: 'caller', name: 'Abel Tuter' }],
    journal: [{ when: '2026-10-26 10:30:00', by: 'Beth Anglin', type: 'comment', text: 'I will restart the gateway tonight.' }],
    related: { times: { resolved_at: '2026-10-26 09:00:00' } },
    access: [{ source: 'journal', status: 'ok', strategy: 'mixed', localTimes: ['comment'] }],
  };
  const r = recommendEmails(pack, { now: Date.UTC(2026, 9, 26, 13) });
  const resolution = r.picks.find((p) => p.id === 'resolution');
  assert.equal(resolution.score, 90, 'not told yet: the comment was written before the ticket was resolved');
});

test('P3.8 times: a local note is exact only when the dates around it show the same offset (no clock change between)', () => {
  const local = [{ source: 'journal', status: 'ok', strategy: 'record-fields' }];
  // Winter (+1) when opened, summer (+2) at the last update: a note between them may be on either clock.
  const changed = {
    fields: { opened_at: '2026-03-20 11:00:00', sys_updated_on: '2026-04-05 12:00:00' },
    related: { times: { opened_at: '2026-03-20 10:00:00', sys_updated_on: '2026-04-05 10:00:00' } },
    access: local,
  };
  assert.equal(noteInstant({ when: '2026-03-25 12:00:00' }, changed).approx, true);
  // The same offset at both ends: exact.
  const same = { ...changed, fields: { opened_at: '2026-03-30 12:00:00', sys_updated_on: '2026-04-05 12:00:00' }, related: { times: { opened_at: '2026-03-30 10:00:00', sys_updated_on: '2026-04-05 10:00:00' } } };
  assert.deepEqual(noteInstant({ when: '2026-04-01 12:00:00' }, same), { ms: Date.UTC(2026, 3, 1, 10, 0, 0), approx: false });
  // One date only: a note long before it may be on another clock.
  const one = { fields: { sys_updated_on: '2026-04-05 12:00:00' }, related: { times: { sys_updated_on: '2026-04-05 10:00:00' } }, access: local };
  assert.equal(noteInstant({ when: '2026-01-10 09:00:00' }, one).approx, true);
  assert.equal(noteInstant({ when: '2026-04-05 11:40:00' }, one).approx, false, 'within the hour of it');
});

// ---- P3.28: the journey keeps the newest field changes ----------------------------------------------------------------------------

test('P3.28 journey: a long field history keeps its newest 60 changes, oldest first', async () => {
  const start = Date.UTC(2026, 9, 1);
  const rows = Array.from({ length: 70 }, (_, i) => ({
    sys_id: `au${i}`,
    tablename: 'incident',
    documentkey: ID,
    fieldname: 'priority',
    oldvalue: String((i % 4) + 1),
    newvalue: String(((i + 1) % 4) + 1),
    sys_created_on: utc(start + i * H),
  }));
  const deps = fakeDeps({ sys_audit: rows, sys_choice: [], sys_user_group: [] });
  const history = await readFieldHistory({ table: 'incident', sysId: ID }, deps);
  assert.equal(history.changes.length, 60);
  assert.equal(history.changes[0].atUtc, utc(start + 10 * H), 'the ten oldest are the ones left out');
  assert.equal(history.changes[59].atUtc, utc(start + 69 * H), 'the newest change is in');
  assert.match(history.note, /newest 60/);
  assert.match(deps.callsTo('sys_audit')[0].query, /\^ORDERBYDESCsys_created_on$/);
});

// ---- P3.4: follow-ups count a colleague's word to the customer ----------------------------------------------------------------------

const followItem = (marker) => ({ table: 'incident', type: 'incident', sysId: ID, number: 'INC1', title: 'VPN', work: 'open', updatedAt: NOW - D, openedAt: NOW - 10 * D, marker });
const row = (by, at) => ({ element_id: ID, sys_created_on: utc(at), sys_created_by: by });

test('P3.4 follow-ups: a colleague who wrote to the customer is an update; "never" only when nobody on our side wrote', () => {
  // The previous assignee wrote yesterday; I never did.
  const yesterday = markerFor(entriesByTicket([row('dave.loftus', NOW - D)]).get(ID), { me: 'beth.anglin', customer: 'abel.tuter' });
  assert.deepEqual(followUps([followItem(yesterday)], { now: NOW, days: 3 }), []);
  // ... five days ago, and I wrote eight days ago: not updated for 5 days (not "never", not 8).
  const older = markerFor(entriesByTicket([row('dave.loftus', NOW - 5 * D), row('beth.anglin', NOW - 8 * D)]).get(ID), { me: 'beth.anglin', customer: 'abel.tuter' });
  const [due] = followUps([followItem(older)], { now: NOW, days: 3 });
  assert.equal(due.days, 5);
  assert.equal(followUpReason(due), 'Customer not updated for 5 d');
  // The customer's own comment is not an update to them.
  const theirs = markerFor(entriesByTicket([row('abel.tuter', NOW - D)]).get(ID), { me: 'beth.anglin', customer: 'abel.tuter' });
  assert.equal(followUpReason(followUps([followItem(theirs)], { now: NOW, days: 3 })[0]), 'No update to the customer in 10 d');
  // No customer known and somebody else wrote after me: it may be the customer, so only my own comment counts, as before.
  const unsure = markerFor(entriesByTicket([row('dave.loftus', NOW - D), row('beth.anglin', NOW - 6 * D)]).get(ID), { me: 'beth.anglin' });
  assert.equal(followUps([followItem(unsure)], { now: NOW, days: 3 })[0].days, 6);
});
