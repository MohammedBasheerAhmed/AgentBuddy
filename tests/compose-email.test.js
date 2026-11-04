import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_TYPES, ago, emailFormUrl, emailTypeById, parseEmailDraft, readSignals, recommendEmails, statusLines } from '../src/compose/emailRecommend.js';
import { formatSnTime } from '../src/context/util.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const HOUR = 3600000;
const when = (hoursAgo) => formatSnTime(NOW - hoursAgo * HOUR);

// A pack like the 'email-compose' read produces. `fields` merge over the defaults; everything else replaces them.
function pack({ fields = {}, ...over } = {}) {
  return {
    version: 1,
    table: 'incident',
    sysId: 'a'.repeat(32),
    number: 'INC0010001',
    kind: 'incident',
    fields: {
      number: 'INC0010001',
      short_description: 'VPN fails after the update',
      description: 'Cannot connect to the VPN from home since the update; error 809 shows every time I try.',
      state: 'In Progress',
      opened_at: when(30),
      ...fields,
    },
    people: [
      { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' },
      { role: 'assigned_to', name: 'Beth Anglin' },
    ],
    journal: [],
    related: {},
    access: [{ source: 'journal', status: 'ok' }],
    ...over,
  };
}

const comment = (by, hoursAgo, text = 'A message.') => ({ when: when(hoursAgo), by, type: 'comment', text });
const note = (by, hoursAgo, text = 'Internal note.') => ({ when: when(hoursAgo), by, type: 'work_note', text });
const ids = (r) => r.picks.map((p) => p.id);
const rec = (p, options) => recommendEmails(p, { now: NOW, ...options });

// ---- The six kinds ---------------------------------------------------------------------------------------------------

test('there are six kinds of email, each with its own feature id', () => {
  assert.deepEqual(EMAIL_TYPES.map((t) => t.id), ['ask-info', 'status-update', 'resolution', 'approval-nudge', 'apology', 'closure']);
  assert.deepEqual(EMAIL_TYPES.map((t) => t.featureId), ['email-ask-info', 'email-status-update', 'email-resolution', 'email-approval-nudge', 'email-apology', 'email-closure']);
  assert.equal(emailTypeById('apology').label, 'Apology for the wait');
  assert.equal(emailTypeById('nope'), null);
  assert.throws(() => {
    'use strict';
    EMAIL_TYPES.push({});
  });
});

// ---- Resolved and closed tickets -------------------------------------------------------------------------------------

test('resolved and the person has not been told: resolution first', () => {
  const r = rec(pack({ fields: { state: 'Resolved', resolved_at: when(5), close_notes: 'Reinstalled the client.' } }));
  assert.equal(r.picks[0].id, 'resolution');
  assert.equal(r.picks[0].featureId, 'email-resolution');
  assert.match(r.picks[0].why, /not been told/);
  assert.ok(r.facts.some((f) => /Resolved 5 hours ago/.test(f)));
});

test('resolved for days with no reply: a closing note is also suggested, and ranks second', () => {
  const r = rec(pack({ fields: { state: 'Resolved', resolved_at: when(24 * 4) } }));
  assert.deepEqual(ids(r), ['resolution', 'closure']);
  assert.match(r.picks[1].why, /4 days ago/);
});

test('resolved and an agent message went out after the resolution: closure outranks a second resolution email', () => {
  const r = rec(pack({ fields: { state: 'Resolved', resolved_at: when(24 * 4) }, journal: [comment('Beth Anglin', 24 * 3, 'It is fixed.')] }));
  assert.deepEqual(ids(r), ['closure', 'resolution']);
  assert.match(r.picks[1].why, /already told/);
});

test('resolved but the agent message is older than the resolution: still not told', () => {
  const r = rec(pack({ fields: { state: 'Resolved', resolved_at: when(10) }, journal: [comment('Beth Anglin', 50, 'Working on it.')] }));
  assert.equal(r.picks[0].id, 'resolution');
  assert.match(r.picks[0].why, /not been told/);
});

test('resolved and the person wrote afterwards: no closing note, and a hint to reply instead', () => {
  const r = rec(pack({ fields: { state: 'Resolved', resolved_at: when(30) }, journal: [comment('Abel Tuter', 2, 'Still broken!')] }));
  assert.ok(!ids(r).includes('closure'));
  assert.match(r.note, /wrote after it was resolved/);
});

test('closed: only a closing note; cancelled says so', () => {
  const closed = rec(pack({ fields: { state: 'Closed Complete' } }));
  assert.deepEqual(ids(closed), ['closure']);
  assert.match(closed.picks[0].why, /closed/);
  const cancelled = rec(pack({ fields: { state: 'Canceled' } }));
  assert.deepEqual(ids(cancelled), ['closure']);
  assert.match(cancelled.picks[0].why, /cancelled/);
});

test('without a state, the dates decide', () => {
  assert.equal(readSignals(pack({ fields: { state: '', closed_at: when(5) } }), NOW).closed, true);
  assert.equal(readSignals(pack({ fields: { state: '', resolved_at: when(5) } }), NOW).resolved, true);
});

// ---- Waiting on the person -------------------------------------------------------------------------------------------

const waiting = (over = {}) => pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' }, ...over });

test('waiting for the person and your last message is days old: ask for information (a reminder), strongest', () => {
  const r = rec(waiting({ journal: [comment('Beth Anglin', 24 * 3, 'Please send the log.')] }));
  assert.equal(r.picks[0].id, 'ask-info');
  assert.equal(r.picks[0].score, 85);
  assert.match(r.picks[0].why, /3 days ago/);
});

test('waiting for the person but you only wrote hours ago: a reminder is early', () => {
  const r = rec(waiting({ journal: [comment('Beth Anglin', 3)] }));
  assert.equal(r.picks[0].id, 'ask-info');
  assert.equal(r.picks[0].score, 55);
  assert.match(r.picks[0].why, /early/);
});

test('waiting for the person and nothing has been sent: ask for information', () => {
  const r = rec(waiting());
  assert.equal(r.picks[0].id, 'ask-info');
  assert.match(r.picks[0].why, /no message has gone/);
});

test('"Awaiting Info" and "Awaiting User Info" count as waiting for the person; a vendor hold does not', () => {
  assert.equal(readSignals(pack({ fields: { state: 'Awaiting Info' } }), NOW).waitingOnCustomer, true);
  assert.equal(readSignals(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting User Info' } }), NOW).waitingOnCustomer, true);
  assert.equal(readSignals(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Vendor' } }), NOW).waitingOnCustomer, false);
  assert.equal(readSignals(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Vendor' } }), NOW).onHold, true);
});

test('on hold for another reason: a status update that says why', () => {
  const r = rec(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Vendor' } }));
  assert.equal(r.picks[0].id, 'status-update');
  assert.match(r.picks[0].why, /Awaiting Vendor/);
});

test('the person replied while the ticket is waiting for them: a status update, not another question', () => {
  const r = rec(waiting({ journal: [comment('Beth Anglin', 30), comment('Abel Tuter', 2, 'Here is the log.')] }));
  assert.ok(!ids(r).includes('ask-info'));
  assert.equal(r.picks[0].id, 'status-update');
});

test('a short description on a fresh incident with no messages: ask for details', () => {
  const r = rec(pack({ fields: { description: 'VPN broken', opened_at: when(2) } }));
  assert.ok(ids(r).includes('ask-info'));
  assert.match(r.picks.find((p) => p.id === 'ask-info').why, /short/);
  // a long description is not "thin"
  assert.ok(!ids(rec(pack({ fields: { opened_at: when(2) } }))).includes('ask-info'));
  // and once someone has written to the person, the rule stays quiet
  assert.ok(!ids(rec(pack({ fields: { description: 'VPN broken' }, journal: [comment('Beth Anglin', 2)] }))).includes('ask-info'));
});

// ---- Approvals --------------------------------------------------------------------------------------------------------

const approvals = (state, hoursAgo) => ({ approvals: [{ approver: 'Cy Approver', group: '', state, updated: hoursAgo === null ? '' : when(hoursAgo) }] });

test('an approval waiting for days: a reminder, strongest', () => {
  const r = rec(pack({ kind: 'requested_item', fields: { state: 'Pending' }, related: approvals('Requested', 24 * 3) }));
  assert.equal(r.picks[0].id, 'approval-nudge');
  assert.equal(r.picks[0].score, 85);
  assert.match(r.picks[0].why, /1 approval is still waiting after 3 days/);
  assert.ok(r.facts.some((f) => /1 approval waiting \(3 days\)/.test(f)));
});

test('a fresh approval is only a weak suggestion; an unknown age is a middling one', () => {
  const fresh = rec(pack({ related: approvals('Requested', 5) }));
  assert.equal(fresh.picks.find((p) => p.id === 'approval-nudge').score, 45);
  assert.match(fresh.picks.find((p) => p.id === 'approval-nudge').why, /early/);
  const unknown = rec(pack({ related: approvals('Requested', null) }));
  assert.equal(unknown.picks.find((p) => p.id === 'approval-nudge').score, 65);
});

test('approved, rejected and not-yet-requested approvals do not trigger a reminder', () => {
  for (const state of ['Approved', 'Rejected', 'Not Yet Requested', 'Cancelled']) {
    assert.ok(!ids(rec(pack({ related: approvals(state, 100) }))).includes('approval-nudge'), state);
  }
});

test('a rejected approval: a status update about what happens next', () => {
  const r = rec(pack({ related: approvals('Rejected', 30) }));
  assert.equal(r.picks[0].id, 'status-update');
  assert.equal(r.picks[0].score, 80);
  assert.ok(r.facts.includes('An approval was rejected'));
});

test('the approval column alone is enough when no approval rows could be read', () => {
  const r = rec(pack({ fields: { approval: 'Requested' }, related: {} }));
  assert.equal(r.picks[0].id, 'approval-nudge');
  assert.equal(r.picks[0].score, 65);
});

// ---- Service levels and long waits ----------------------------------------------------------------------------------

test('a missed service level: an apology, strongest', () => {
  const r = rec(pack({ related: { slas: [{ name: 'Resolution', stage: 'In progress', breached: 'true', percentage: '120', plannedEnd: when(-5) }] } }));
  assert.equal(r.picks[0].id, 'apology');
  assert.equal(r.picks[0].score, 85);
  assert.ok(r.facts.includes('Service level missed'));
});

test('a service level close to its limit: a progress update; far from it: nothing special', () => {
  const close = rec(pack({ related: { slas: [{ name: 'Resolution', stage: 'In progress', breached: 'false', percentage: '82' }] } }));
  assert.equal(close.picks[0].id, 'status-update');
  assert.equal(close.picks[0].score, 65);
  assert.ok(close.facts.includes('Service level 82% used'));
  const far = rec(pack({ journal: [comment('Beth Anglin', 5)], related: { slas: [{ name: 'Resolution', stage: 'In progress', breached: 'false', percentage: '20' }] } }));
  assert.equal(far.picks[0].score, 40);
});

test('cancelled and completed service levels do not count as at risk', () => {
  const r = rec(pack({ journal: [comment('Beth Anglin', 5)], related: { slas: [{ stage: 'Cancelled', breached: 'true', percentage: '150' }, { stage: 'Completed', breached: 'false', percentage: '99' }] } }));
  assert.equal(r.picks[0].score, 40);
  assert.ok(!r.facts.some((f) => /Service level/.test(f)));
});

test('the person wrote two days ago and nobody answered: an apology; a day ago: a status update', () => {
  const long = rec(pack({ journal: [comment('Abel Tuter', 60, 'Any news?')] }));
  assert.equal(long.picks[0].id, 'apology');
  assert.match(long.picks[0].why, /2 days ago/);
  const day = rec(pack({ journal: [comment('Abel Tuter', 30, 'Any news?')] }));
  assert.equal(day.picks[0].id, 'status-update');
  assert.equal(day.picks[0].score, 60);
  const fresh = rec(pack({ journal: [comment('Abel Tuter', 2, 'Any news?')] }));
  assert.equal(fresh.picks[0].score, 40);
});

test('your last message is days old and you are not waiting for the person: a status update', () => {
  const r = rec(pack({ journal: [comment('Beth Anglin', 24 * 5, 'Looking into it.')] }));
  assert.equal(r.picks[0].id, 'status-update');
  assert.equal(r.picks[0].score, 70);
  assert.match(r.picks[0].why, /5 days ago/);
});

test('nothing has ever been sent to the person: a status update, but only when the notes could be read', () => {
  const r = rec(pack({ fields: { opened_at: when(50) } }));
  assert.equal(r.picks[0].id, 'status-update');
  assert.equal(r.picks[0].score, 60);
  assert.ok(r.facts.includes('No message to the person yet'));
  const unreadable = rec(pack({ fields: { opened_at: when(50) }, access: [{ source: 'journal', status: 'denied', note: 'no access' }] }));
  assert.equal(unreadable.picks[0].score, 40, 'an unreadable journal is not "no messages"');
  assert.ok(!unreadable.facts.includes('No message to the person yet'));
  const confirmedEmpty = rec(pack({ fields: { opened_at: when(50) }, access: [{ source: 'journal', status: 'empty' }] }));
  assert.equal(confirmedEmpty.picks[0].score, 60);
});

test('open for weeks: an apology for the wait and an update', () => {
  const r = rec(pack({ fields: { opened_at: when(24 * 20) }, journal: [comment('Beth Anglin', 10)] }));
  assert.deepEqual(ids(r), ['status-update', 'apology']);
  assert.match(r.picks[1].why, /20 days/);
});

test('nothing stands out: a plain status update is still offered, the rest are listed as other emails', () => {
  const r = rec(pack({ journal: [comment('Beth Anglin', 5)] }));
  assert.deepEqual(ids(r), ['status-update']);
  assert.equal(r.picks[0].score, 40);
  assert.deepEqual(r.others.map((t) => t.id), ['ask-info', 'resolution', 'approval-nudge', 'apology', 'closure']);
  assert.equal(r.picks.length + r.others.length, EMAIL_TYPES.length);
});

// ---- Ranking, limits, direction ---------------------------------------------------------------------------------------

test('at most three suggestions, strongest first, ties in the order of the list', () => {
  const r = rec(
    pack({
      fields: { state: 'On Hold', hold_reason: 'Awaiting Caller', opened_at: when(24 * 20) },
      journal: [comment('Beth Anglin', 24 * 3)],
      related: { ...approvals('Requested', 24 * 4), slas: [{ stage: 'In progress', breached: 'true', percentage: '130' }] },
    })
  );
  assert.equal(r.picks.length, 3);
  assert.deepEqual(r.picks.map((p) => p.score), [...r.picks.map((p) => p.score)].sort((a, b) => b - a));
  assert.deepEqual(ids(r), ['ask-info', 'approval-nudge', 'apology']);
  assert.equal(rec(pack(), { max: 1 }).picks.length, 1);
  assert.equal(rec(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' } }), { minScore: 99 }).picks.length, 0);
});

test('who wrote last: name order, accents and email all work; no known customer means unknown', () => {
  const dir = (people, by) => readSignals(pack({ people, journal: [comment(by, 5)] }), NOW).message.direction;
  const abel = [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }];
  assert.equal(dir(abel, 'Abel Tuter'), 'customer');
  assert.equal(dir(abel, 'Tuter, Abel'), 'customer');
  assert.equal(dir(abel, 'ABEL TUTER'), 'customer');
  assert.equal(dir(abel, 'abel.tuter@example.com'), 'customer');
  assert.equal(dir(abel, 'Beth Anglin'), 'agent');
  assert.equal(dir(abel, 'abel.tuter'), 'customer', 'a login that is the start of their email address');
  assert.equal(dir(abel, 'bglin'), 'unknown', 'a login that matches no one is not guessed at');
  // An address that is not the customer's may still be theirs (a comment emailed in from another address): not guessed at either.
  assert.equal(dir(abel, 'beth@example.com'), 'unknown');
  assert.equal(dir([...abel, { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com' }], 'beth@example.com'), 'agent', "the assignee's own address");
  assert.equal(dir([...abel, { role: 'assigned_to', name: 'Beth Anglin' }], 'beth.anglin'), 'agent', "the assignee's login");
  const accented = `Jos${String.fromCharCode(0xe9)} N${String.fromCharCode(0xfa, 0xf1)}ez`;
  assert.equal(dir([{ role: 'caller', name: accented }], 'Jose Nunez'), 'customer');
  assert.equal(dir([{ role: 'requested_for', name: 'Req Uester' }], 'Req Uester'), 'customer');
  assert.equal(dir([{ role: 'contact', name: 'Con Tact' }], 'Con Tact'), 'customer');
  assert.equal(dir([{ role: 'assigned_to', name: 'Beth Anglin' }], 'Beth Anglin'), 'unknown');
  assert.equal(dir([{ role: 'opened_by', name: 'Abel Tuter' }], 'Abel Tuter'), 'unknown', 'opened_by is not necessarily the customer');
  assert.equal(dir(abel, ''), 'unknown');
});

test('work notes are internal: they never count as a message to or from the person', () => {
  const s = readSignals(pack({ journal: [comment('Beth Anglin', 50), note('Abel Tuter', 1)] }), NOW);
  assert.equal(s.message.direction, 'agent');
  assert.equal(s.message.count, 1);
  assert.equal(readSignals(pack({ journal: [note('Beth Anglin', 5)] }), NOW).message.direction, 'none');
});

test('an unreadable date is "age unknown", never a wrong age', () => {
  const r = rec(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' }, journal: [{ when: '27/10/2026 9:14 AM', by: 'Beth Anglin', type: 'comment', text: 'Please send it.' }] }));
  assert.equal(r.picks[0].id, 'ask-info');
  assert.equal(r.picks[0].score, 60);
  assert.ok(r.facts.includes('You wrote last'));
});

test('pure and deterministic: same input, same output, input untouched', () => {
  const p = pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' }, journal: [comment('Beth Anglin', 80)], related: approvals('Requested', 100) });
  const copy = JSON.parse(JSON.stringify(p));
  const a = rec(p);
  const b = rec(p);
  assert.deepEqual(a, b);
  assert.deepEqual(p, copy);
});

test('bad input does not throw', () => {
  for (const bad of [null, undefined, {}, [], 'x', 5, { fields: null, journal: 'x', related: [], people: 'x', access: 5 }]) {
    const r = recommendEmails(bad, { now: NOW });
    assert.ok(Array.isArray(r.picks));
    assert.ok(r.picks.length >= 1, 'a plain update is always on offer');
  }
});

test('ago() is rough on purpose', () => {
  assert.equal(ago(10 * 60000), 'less than an hour ago');
  assert.equal(ago(HOUR), '1 hour ago');
  assert.equal(ago(5 * HOUR), '5 hours ago');
  assert.equal(ago(47 * HOUR), '47 hours ago');
  assert.equal(ago(72 * HOUR), '3 days ago');
  assert.equal(ago(-5), '');
  assert.equal(ago(NaN), '');
});

// ---- Status lines (they go to the draft as one more part) ------------------------------------------------------------

test('status lines say in words what the suggestion was based on, and hold no names', () => {
  const lines = statusLines(
    pack({
      fields: { state: 'On Hold', hold_reason: 'Awaiting Caller' },
      journal: [comment('Beth Anglin', 24 * 3)],
      related: { ...approvals('Requested', 24 * 2), slas: [{ stage: 'In progress', breached: 'true' }] },
    }),
    NOW
  );
  assert.ok(lines.includes('The ticket is waiting for a reply from the person.'));
  assert.ok(lines.includes('The last message was sent by the service desk, 3 days ago.'));
  assert.ok(lines.includes('1 approval is still waiting (for about 2 days).'));
  assert.ok(lines.includes('A service level target for this ticket has been missed.'));
  const text = lines.join('\n');
  assert.ok(!/Beth|Abel|Cy Approver/.test(text));
  assert.deepEqual(statusLines(pack({ fields: { state: 'Closed' } }), NOW), ['The ticket is closed.', 'No message has been sent to the person yet.']);
  assert.deepEqual(statusLines(null, NOW).length >= 0, true);
});

// ---- Parsing the draft -----------------------------------------------------------------------------------------------

test('parseEmailDraft: subject line, then the body', () => {
  const d = parseEmailDraft('Subject: Update on INC0010001\n\nHello [PERSON_1],\n\nWe are working on it.\n\nThank you.');
  assert.equal(d.subject, 'Update on INC0010001');
  assert.equal(d.body, 'Hello [PERSON_1],\n\nWe are working on it.\n\nThank you.');
});

test('parseEmailDraft: markdown dressing, quotes, CRLF and a divider are tolerated', () => {
  assert.equal(parseEmailDraft('**Subject:** Your VPN request\n\nHi,\nDone.').subject, 'Your VPN request');
  assert.equal(parseEmailDraft('## Subject: "Your VPN request"\n\nHi').subject, 'Your VPN request');
  assert.equal(parseEmailDraft('subject : Re: VPN  \r\n\r\nHi,\r\nDone.\r\n').body, 'Hi,\nDone.');
  assert.equal(parseEmailDraft('Subject: X\n---\nHello').body, 'Hello');
  assert.equal(parseEmailDraft('Subject: ' + 'x'.repeat(500)).subject.length, 200);
});

test('parseEmailDraft: no subject line means everything is the body; a late "Subject:" in the body is left alone', () => {
  assert.deepEqual(parseEmailDraft('Hello,\n\nThanks.'), { subject: '', body: 'Hello,\n\nThanks.' });
  const late = parseEmailDraft('Hello,\n1\n2\n3\n4\n5\n6\nSubject: not a header');
  assert.equal(late.subject, '');
  assert.ok(late.body.includes('Subject: not a header'));
  assert.deepEqual(parseEmailDraft(null), { subject: '', body: '' });
  assert.deepEqual(parseEmailDraft(''), { subject: '', body: '' });
});

// ---- The email form address ------------------------------------------------------------------------------------------

test('emailFormUrl: the classic email client for the record, on the page\'s own origin', () => {
  const sysId = 'f'.repeat(32);
  const url = emailFormUrl('https://acme.service-now.com/nav_to.do?uri=incident.do', { table: 'incident', sysId });
  assert.equal(url, `https://acme.service-now.com/email_client.do?sysparm_table=incident&sysparm_sys_id=${sysId}&sysparm_target=incident&sysparm_uniqueValue=${sysId}`);
  assert.equal(emailFormUrl('https://acme.service-now.com/sp?id=ticket', { table: 'sn_customerservice_case', sysId }).startsWith('https://acme.service-now.com/email_client.do?'), true);
});

test('emailFormUrl refuses anything that is not a plain table, a sys_id and an https page', () => {
  const sysId = 'f'.repeat(32);
  assert.equal(emailFormUrl('https://a.service-now.com/', { table: 'incident&x=1', sysId }), '');
  assert.equal(emailFormUrl('https://a.service-now.com/', { table: 'Incident', sysId }), '');
  assert.equal(emailFormUrl('https://a.service-now.com/', { table: 'incident', sysId: 'short' }), '');
  assert.equal(emailFormUrl('https://a.service-now.com/', {}), '');
  assert.equal(emailFormUrl('http://a.service-now.com/', { table: 'incident', sysId }), '');
  assert.equal(emailFormUrl('not a url', { table: 'incident', sysId }), '');
  assert.equal(emailFormUrl('javascript:alert(1)', { table: 'incident', sysId }), '');
});
