import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseText, approxAge, computeSignals, identities, roleOfEntry, signalsText } from '../src/itsm/sentiment.js';
import { journalParts, sentimentParts } from '../src/itsm/parts.js';

// Today in these tests is 2026-10-26 12:00 UTC.
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', firstName: 'Abel', lastName: 'Tuter' };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com' };

const note = (when, by, text, type = 'comment') => ({ when, by, type, text });

function pack(over = {}) {
  return {
    version: 1,
    table: 'incident',
    sysId: 'a'.repeat(32),
    number: 'INC0010001',
    kind: 'incident',
    fields: { number: 'INC0010001', short_description: 'VPN keeps dropping', priority: '2 - High', state: 'In Progress', reopen_count: '1', reassignment_count: '3' },
    people: [ABEL, BETH],
    journal: [],
    related: {},
    access: [],
    ...over,
  };
}

// ---- analyseText ----------------------------------------------------------------------------------

test('frustration, escalation and urgency words are found by whole word and reported as labels', () => {
  const r = analyseText('This is ridiculous and unacceptable. I am furious. I will complain to your manager. We need this urgently, it is critical.');
  assert.deepEqual(r.frustration, ['ridiculous', 'unacceptable', 'angry']);
  assert.deepEqual(r.escalation, ['manager or executive', 'complaint']);
  assert.deepEqual(r.urgency, ['urgent', 'critical']);
});

test('word lists do not fire inside other words', () => {
  const r = analyseText('Message received. The messenger app is a mess? Pleasantly surprised. Messaging works.');
  assert.deepEqual(r.frustration, []);
  assert.deepEqual(r.escalation, []);
  assert.deepEqual(r.urgency, []);
  assert.equal(r.shouting, false);
  assert.deepEqual(analyseText('Our legalese is fine and the unlegal word stays').escalation, []);
  assert.deepEqual(analyseText('I will sue you').escalation, ['legal']);
});

test('repeat phrases: again, still, third time and friends', () => {
  assert.deepEqual(analyseText('It dropped again.').repeat, ['again']);
  assert.deepEqual(analyseText('Still not fixed').repeat, ['still']);
  assert.deepEqual(analyseText('This is the THIRD time I write').repeat, ['nth time']);
  assert.deepEqual(analyseText('the 5th time this month').repeat, ['nth time']);
  assert.deepEqual(analyseText('every single time I log in').repeat, ['every time']);
  assert.deepEqual(analyseText('I already told you the error').repeat, ['already told']);
  assert.deepEqual(analyseText('same problem as last week').repeat, ['same problem']);
  assert.deepEqual(analyseText('I have asked three times').repeat, ['many times']);
  assert.deepEqual(analyseText('Everything is fine today').repeat, []);
});

test('curly apostrophes do not hide a word ("can’t work")', () => {
  const curly = String.fromCharCode(0x2019);
  assert.deepEqual(analyseText(`I can${curly}t work like this`).urgency, ['cannot work']);
});

test('shouting: two capitalised words, or one long one; acronyms and ticket numbers are not shouting', () => {
  assert.equal(analyseText('FIX THIS NOW').shouting, true);
  assert.equal(analyseText('FIX THIS NOW').shoutedWords, 3);
  assert.equal(analyseText('This is URGENT').shouting, true, 'one long capitalised word');
  assert.equal(analyseText('Please send the log ASAP').shouting, false, 'ASAP is ordinary');
  assert.equal(analyseText('VPN and MFA fail on RDP, see INC0010001 and KB0010004').shouting, false);
  assert.equal(analyseText('WORKS now').shouting, false, 'one short word');
  assert.equal(analyseText('NOT WORKING').shouting, true);
  assert.equal(analyseText('').shouting, false);
});

test('exclamation and question-mark runs', () => {
  assert.equal(analyseText('Why!!').exclamationRuns, 1);
  assert.equal(analyseText('What?! Again!!! Really???').exclamationRuns, 3);
  assert.equal(analyseText('Is it fixed?').exclamationRuns, 0);
  assert.equal(analyseText('Thanks!').exclamationRuns, 0);
  assert.equal(analyseText('Huh??').exclamationRuns, 0, 'two question marks are a question');
});

test('chasing wording, and thanks', () => {
  for (const text of ['Any update?', 'Just following up on this', 'Chasing this again', 'Still waiting for a reply', 'I have not heard anything', 'Hello???', 'any news on this', 'No one has replied']) {
    assert.equal(analyseText(text).chase, true, text);
  }
  assert.equal(analyseText('The update installed fine').chase, false);
  assert.equal(analyseText('Thanks, thank you, much appreciated').thanks, 3);
});

test('analyseText survives odd input and long text without hanging', () => {
  assert.doesNotThrow(() => analyseText(undefined));
  assert.doesNotThrow(() => analyseText(null));
  assert.doesNotThrow(() => analyseText(12345));
  assert.doesNotThrow(() => analyseText({}));
  const long = `${'a'.repeat(200000)} cancel ${'b'.repeat(200000)}`;
  const started = Date.now();
  analyseText(long);
  analyseText('!'.repeat(100000));
  analyseText(' '.repeat(100000));
  assert.ok(Date.now() - started < 2000, 'linear time');
});

// ---- who is the customer ---------------------------------------------------------------------------

test('the customer is the caller, requester, contact or consumer; the assignee is support', () => {
  const ids = identities(pack({ people: [ABEL, BETH, { role: 'opened_by', name: 'Charlie Whitherspoon' }] }));
  assert.equal(ids.known, true);
  assert.ok(ids.customers.has('abel tuter'));
  assert.ok(ids.customers.has('abel tuter example com'));
  assert.ok(ids.support.has('beth anglin'));
  assert.ok(!ids.customers.has('charlie whitherspoon'), 'opened_by is not assumed to be the customer');
  assert.equal(identities(pack({ people: [BETH] })).known, false);
  assert.equal(identities({}).known, false);
  assert.equal(identities(pack({ people: [null, 'x', { role: 'caller' }] })).known, false);
});

test('a note author written as a login, in other case, or with accents still matches the person', () => {
  const ids = identities(pack({ people: [{ role: 'requested_for', name: "María-José O'Neil", email: 'maria.oneil@example.com' }] }));
  const by = (name) => roleOfEntry({ type: 'comment', by: name }, ids);
  assert.equal(by("María-José O'Neil"), 'customer');
  assert.equal(by("MARIA JOSE O'NEIL"), 'customer');
  assert.equal(by('maria.oneil'), 'customer', 'login = front of the email address');
  assert.equal(by('Beth Anglin'), 'support');
  assert.equal(by(''), 'unknown', 'an entry with no author cannot be placed');
  assert.equal(roleOfEntry({ type: 'work_note', by: 'Maria' }, ids), 'note');
  assert.equal(roleOfEntry({ type: 'comment', by: 'x' }, { known: false }), 'unknown');
});

// ---- computeSignals --------------------------------------------------------------------------------

const THREAD = [
  note('2026-10-24 09:00:00', 'Abel Tuter', 'The VPN drops every 10 minutes. Please help.'),
  note('2026-10-24 10:00:00', 'Beth Anglin', 'Hi Abel, can you send the client version?'),
  note('2026-10-24 10:05:00', 'Beth Anglin', 'Internal: checking the gateway', 'work_note'),
  note('2026-10-25 08:00:00', 'Abel Tuter', 'It dropped AGAIN. Any update?'),
  note('2026-10-25 15:00:00', 'Abel Tuter', 'THIS IS THE THIRD TIME!!! This is ridiculous, I will escalate to my manager.'),
  note('2026-10-26 07:00:00', 'abel.tuter', 'Still waiting. Urgent, I cannot work.'),
];

test('computeSignals counts the customer\'s messages, chasers and replies', () => {
  const s = computeSignals(pack({ journal: THREAD }), { now: NOW });
  assert.equal(s.customerKnown, true);
  assert.equal(s.commentsRead, 5, 'work notes are not customer-visible comments');
  assert.equal(s.customerMessages, 4);
  assert.equal(s.supportReplies, 1);
  // message 1: no chase, first message. message 2: "any update" (chase) after a support reply. 3: follows 2 unanswered (chase). 4: follows 3 (chase).
  assert.equal(s.chasers, 3);
  assert.equal(s.unansweredCustomerMessages, 3);
  assert.equal(s.awaitingReply, true);
  assert.deepEqual(s.frustrationWords, ['ridiculous']);
  assert.deepEqual(s.escalationWords, ['escalate', 'manager or executive']);
  assert.deepEqual(s.urgencyWords, ['urgent', 'cannot work']);
  assert.ok(s.repeatPhrases.includes('again') && s.repeatPhrases.includes('nth time') && s.repeatPhrases.includes('still'));
  assert.equal(s.repeatMessages, 3);
  assert.equal(s.shoutingMessages, 1, 'one capitalised word (AGAIN) is not shouting; THIS IS THE THIRD TIME is');
  assert.equal(s.shoutedWords, 5);
  assert.equal(s.exclamationRuns, 1);
  assert.equal(s.reopenCount, 1);
  assert.equal(s.reassignmentCount, 3);
  assert.equal(s.priority, '2 - High');
});

test('time since the customer\'s last message and the last reply', () => {
  const s = computeSignals(pack({ journal: THREAD }), { now: NOW });
  assert.equal(Math.round(s.hoursSinceCustomerMessage), 5);
  assert.equal(Math.round(s.hoursSinceSupportReply), 50);
  // A clock behind the notes (time zone) is never negative.
  const early = computeSignals(pack({ journal: THREAD }), { now: Date.UTC(2026, 9, 24) });
  assert.equal(early.hoursSinceCustomerMessage, 0);
  // Times in a format we cannot read give no number rather than a guess.
  const odd = computeSignals(pack({ journal: [note('26/10/2026 07:00', 'Abel Tuter', 'hello')] }), { now: NOW });
  assert.equal(odd.hoursSinceCustomerMessage, null);
  assert.equal(odd.customerMessages, 1);
});

test('an entry with no author is neither a reply nor a chaser', () => {
  const journal = [note('2026-10-25 08:00:00', 'Abel Tuter', 'first'), note('2026-10-25 09:00:00', '', 'who wrote this'), note('2026-10-25 10:00:00', 'Abel Tuter', 'second')];
  const s = computeSignals(pack({ journal }), { now: NOW });
  assert.equal(s.customerMessages, 2);
  assert.equal(s.supportReplies, 0);
  assert.equal(s.chasers, 1, 'the second customer message still follows an unanswered first');
  assert.equal(s.awaitingReply, true);
  const last = computeSignals(pack({ journal: [note('2026-10-25 08:00:00', 'Abel Tuter', 'first'), note('2026-10-25 09:00:00', '', 'unknown author last')] }), { now: NOW });
  assert.equal(last.awaitingReply, false, 'an unknown last author does not count as the customer waiting');
});

test('a reply from support ends the run of unanswered messages', () => {
  const journal = [
    note('2026-10-25 08:00:00', 'Abel Tuter', 'first'),
    note('2026-10-25 09:00:00', 'Abel Tuter', 'second'),
    note('2026-10-25 10:00:00', 'Beth Anglin', 'we are on it'),
  ];
  const s = computeSignals(pack({ journal }), { now: NOW });
  assert.equal(s.chasers, 1, 'the second message follows an unanswered first');
  assert.equal(s.unansweredCustomerMessages, 0);
  assert.equal(s.awaitingReply, false);
});

test('when the customer is not known, all comments are counted together and only wording counts as chasing', () => {
  const journal = [note('2026-10-25 08:00:00', 'Someone', 'problem'), note('2026-10-25 09:00:00', 'Other', 'second'), note('2026-10-25 10:00:00', 'Someone', 'Any update?')];
  const s = computeSignals(pack({ people: [BETH], journal }), { now: NOW });
  assert.equal(s.customerKnown, false);
  assert.equal(s.customerMessages, 3);
  assert.equal(s.supportReplies, 0);
  assert.equal(s.chasers, 1);
  assert.equal(s.unansweredCustomerMessages, null);
  assert.equal(s.awaitingReply, false);
  const text = signalsText(s);
  assert.match(text, /could not be identified/);
  assert.match(text, /newest customer-visible comment/);
});

test('an empty or missing journal gives zeros, not errors', () => {
  for (const p of [pack(), pack({ journal: undefined }), pack({ journal: null }), {}, null, undefined]) {
    const s = computeSignals(p, { now: NOW });
    assert.equal(s.commentsRead, 0);
    assert.equal(s.customerMessages, 0);
    assert.equal(s.chasers, 0);
    assert.equal(s.hoursSinceCustomerMessage, null);
    assert.doesNotThrow(() => signalsText(s));
  }
  assert.match(signalsText(computeSignals(pack(), { now: NOW })), /Customer-visible comments read: 0/);
});

test('entries with missing parts and only the newest `depth` notes are used', () => {
  const journal = [
    note('2026-10-20 08:00:00', 'Abel Tuter', 'old message with ridiculous'),
    { type: 'comment', text: 'no author, no time' },
    { type: 'comment', by: 'Abel Tuter', when: '2026-10-26 08:00:00', text: '   ' },
    null,
    note('2026-10-26 09:00:00', 'Abel Tuter', 'recent calm message'),
  ];
  const s = computeSignals(pack({ journal }), { now: NOW, depth: 2 });
  assert.equal(s.commentsRead, 2);
  assert.deepEqual(s.frustrationWords, [], 'the old message is outside the depth');
  const all = computeSignals(pack({ journal }), { now: NOW, depth: 20 });
  assert.deepEqual(all.frustrationWords, ['ridiculous']);
});

test('work notes never count as the customer\'s words', () => {
  const journal = [note('2026-10-25 08:00:00', 'Abel Tuter', 'calm request'), note('2026-10-25 09:00:00', 'Beth Anglin', 'customer is FURIOUS and RIDICULOUS!!!', 'work_note')];
  const s = computeSignals(pack({ journal }), { now: NOW });
  assert.deepEqual(s.frustrationWords, []);
  assert.equal(s.shoutingMessages, 0);
  assert.equal(s.customerMessages, 1);
});

test('the opening text is analysed separately', () => {
  const s = computeSignals(pack({ fields: { short_description: 'VPN DOWN AGAIN!!', description: 'This is unacceptable' } }), { now: NOW });
  assert.deepEqual(s.opening.frustrationWords, ['unacceptable']);
  assert.deepEqual(s.opening.repeatPhrases, ['again']);
  assert.equal(s.opening.exclamationRuns, 1);
  assert.equal(s.customerMessages, 0, 'the opening text is not a customer message');
});

test('reopen and reassignment counts, priority and SLAs are read when present, "not stated" otherwise', () => {
  const none = computeSignals(pack({ fields: { number: 'INC1' } }), { now: NOW });
  assert.equal(none.reopenCount, null);
  assert.equal(none.reassignmentCount, null);
  assert.equal(none.slas, null);
  assert.match(signalsText(none), /Reopened: not stated/);
  assert.match(signalsText(none), /Priority: not stated/);
  const bad = computeSignals(pack({ fields: { reopen_count: 'x', reassignment_count: '-2' } }), { now: NOW });
  assert.equal(bad.reopenCount, null);
  assert.equal(bad.reassignmentCount, null);
  const withSlas = computeSignals(pack({ related: { slas: [{ breached: 'true' }, { breached: 'false' }, { breached: '' }] } }), { now: NOW });
  assert.deepEqual(withSlas.slas, { total: 3, breached: 1 });
  assert.match(signalsText(withSlas), /SLAs: 1 breached of 3/);
});

// ---- signalsText ----------------------------------------------------------------------------------

test('signalsText states the counts in plain words and carries no ticket text', () => {
  const s = computeSignals(pack({ journal: THREAD }), { now: NOW });
  const text = signalsText(s);
  assert.match(text, /^Counted by simple word and count rules/);
  assert.match(text, /Customer-visible comments read: 5 \(customer 4, support 1\)/);
  assert.match(text, /Customer chasers .*: 3\./);
  assert.match(text, /Customer messages in a row with no reply from support: 3\./);
  assert.match(text, /waiting for an answer\): yes/);
  assert.match(text, /Time since the customer's last message: about 5 hours \(approximate/);
  assert.match(text, /Time since the last reply from support: about 2 days/);
  assert.match(text, /Frustration words in the customer's messages: ridiculous\./);
  assert.match(text, /Shouting .*: 1 message, 5 capitalised words/);
  assert.match(text, /Reopened: 1 time\./);
  assert.match(text, /Reassigned between groups or people: 3 times\./);
  assert.match(text, /Priority: 2 - High\./);
  for (const secret of ['Abel', 'Tuter', 'Beth', 'VPN drops', 'client version', 'example.com']) assert.ok(!text.includes(secret), `signals must not carry "${secret}"`);
});

test('approxAge never claims more precision than the time zone allows', () => {
  assert.equal(approxAge(0), 'less than an hour');
  assert.equal(approxAge(0.9), 'less than an hour');
  assert.equal(approxAge(1), 'about 1 hour');
  assert.equal(approxAge(5.4), 'about 5 hours');
  assert.equal(approxAge(47), 'about 47 hours');
  assert.equal(approxAge(48), 'about 2 days');
  assert.equal(approxAge(100), 'about 4 days');
  assert.equal(approxAge(-3), 'less than an hour');
  assert.equal(approxAge(NaN), '');
  assert.equal(approxAge(null), '');
});

// ---- the parts the model sees ------------------------------------------------------------------------

test('sentimentParts: the record, then the signals, then the notes with the customer marked', () => {
  const parts = sentimentParts(pack({ journal: THREAD }), { depth: 20, now: NOW });
  const fields = parts.filter((p) => !['signals', 'comments', 'work_notes'].includes(p.field)).map((p) => p.field);
  assert.ok(fields.includes('short_description') && fields.includes('priority'));
  const signalsIndex = parts.findIndex((p) => p.field === 'signals');
  assert.equal(parts[signalsIndex].label, 'Signals counted by Agent Buddy');
  assert.ok(signalsIndex > parts.findIndex((p) => p.field === 'short_description'));
  const notes = parts.slice(signalsIndex + 1);
  assert.equal(notes.length, 6);
  assert.ok(notes.every((p) => ['comments', 'work_notes'].includes(p.field)), 'notes keep the field names policy knows');
  assert.match(notes[0].text, /^\[2026-10-24 09:00:00\] Customer - Abel Tuter: The VPN drops/);
  assert.match(notes[1].text, /\] Support - Beth Anglin: Hi Abel/);
  assert.match(notes[2].text, /\] Beth Anglin: Internal/, 'work notes are not given a role');
  assert.match(notes[5].text, /\] Customer - abel\.tuter: Still waiting/, 'a login still counts as the customer');
  assert.equal(notes[2].label, 'Internal work note');
  assert.equal(notes[0].label, 'Customer-visible comment');
  assert.ok(parts.every((p) => !/Abel|Beth/.test(p.label)), 'labels never carry names');
});

test('journalParts: depth, empty notes, types, and options for text that is published', () => {
  const p = pack({ journal: THREAD });
  assert.equal(journalParts(p, { depth: 2 }).length, 2);
  assert.equal(journalParts(p, { depth: 20, types: ['work_note'] }).length, 1);
  assert.equal(journalParts(pack({ journal: [note('x', 'a', '  ')] }), { depth: 5 }).length, 0);
  const anon = journalParts(p, { depth: 20, authors: false, when: false });
  assert.ok(anon.every((x) => !/^\[2026|^Abel Tuter:|^Beth Anglin:/.test(x.text)), 'no time and no author prefix when they are switched off');
  assert.equal(anon[0].text, 'The VPN drops every 10 minutes. Please help.');
  assert.equal(anon[2].text, 'Internal: checking the gateway');
  assert.deepEqual(journalParts(pack(), { depth: 3 }), []);
  assert.deepEqual(journalParts(null, { depth: 3 }), []);
});
