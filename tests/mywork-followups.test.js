const test = require('node:test');
const assert = require('node:assert/strict');
import { entriesByTicket, markerFor, windowStart, UNKNOWN_MARKER } from '../src/mywork/markers.js';
import { followUps, followUpText, followUpReason, followUpAction, cleanDays } from '../src/mywork/followups.js';
import { HOUR, DAY } from '../src/mywork/time.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ID = 'a'.repeat(32);
const row = (by, at, id = ID) => ({ element_id: id, sys_created_on: utc(at), sys_created_by: by });

// ---- markers -------------------------------------------------------------------------------------------------------------------

test('markers: the customer wrote after my last comment -> "customer replied"', () => {
  const entries = entriesByTicket([row('abel.tuter', NOW - HOUR), row('beth.anglin', NOW - DAY), row('abel.tuter', NOW - 2 * DAY)]).get(ID);
  const m = markerFor(entries, { me: 'Beth.Anglin', customer: 'abel.tuter' });
  assert.equal(m.replied, 'customer');
  assert.equal(m.lastCustomerAt, NOW - HOUR);
  assert.equal(m.lastMineAt, NOW - DAY);
  assert.equal(m.lastAt, NOW - HOUR);
});

test('markers: I wrote last -> no reply; a colleague after me is not "the customer replied"', () => {
  const mine = markerFor(entriesByTicket([row('beth.anglin', NOW - HOUR), row('abel.tuter', NOW - DAY)]).get(ID), { me: 'beth.anglin', customer: 'abel.tuter' });
  assert.equal(mine.replied, '');
  const colleague = markerFor(entriesByTicket([row('dave.loftus', NOW - HOUR), row('beth.anglin', NOW - DAY)]).get(ID), { me: 'beth.anglin', customer: 'abel.tuter' });
  assert.equal(colleague.replied, '');
  assert.equal(colleague.lastOtherAt, NOW - HOUR);
});

test('markers: no customer known -> somebody else writing after me is "other"; nothing at all -> no reply', () => {
  const m = markerFor(entriesByTicket([row('dave.loftus', NOW - HOUR), row('beth.anglin', NOW - DAY)]).get(ID), { me: 'beth.anglin' });
  assert.equal(m.replied, 'other');
  const none = markerFor([], { me: 'beth.anglin', customer: 'abel.tuter' });
  assert.deepEqual([none.known, none.replied, none.lastAt], [true, '', null]);
  assert.equal(UNKNOWN_MARKER.known, false);
});

test('markers: rows without a ticket or a readable time are dropped; newest first per ticket', () => {
  const map = entriesByTicket([row('x', NOW - DAY), row('y', NOW), { element_id: '', sys_created_on: utc(NOW), sys_created_by: 'z' }, { element_id: ID, sys_created_on: 'yesterday', sys_created_by: 'q' }]);
  assert.deepEqual(map.get(ID).map((e) => e.by), ['y', 'x']);
});

test('window start: complete reads say 0; a capped read says how far back it reached', () => {
  assert.equal(windowStart([row('x', NOW)], 400), 0);
  assert.equal(windowStart([row('x', NOW), row('y', NOW - 3 * DAY)], 2), NOW - 3 * DAY);
});

// ---- follow-up rules -------------------------------------------------------------------------------------------------------------

const BASE_MARKER = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };
let n = 0;
const item = (over = {}) => {
  n += 1;
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, '0'), number: `INC${n}`, title: 'VPN keeps dropping', work: 'open', updatedAt: NOW - HOUR, openedAt: NOW - 10 * DAY, marker: BASE_MARKER, ...over };
};

test('waiting on the customer past N days -> reminder; under N days -> nothing; the customer answered -> "replied", first', () => {
  const old = item({ work: 'waiting-customer', marker: { ...BASE_MARKER, lastMineAt: NOW - 4 * DAY, lastAt: NOW - 4 * DAY } });
  const fresh = item({ work: 'waiting-customer', marker: { ...BASE_MARKER, lastMineAt: NOW - DAY, lastAt: NOW - DAY } });
  const answered = item({ work: 'waiting-customer', marker: { ...BASE_MARKER, lastMineAt: NOW - 4 * DAY, lastCustomerAt: NOW - 2 * HOUR, lastAt: NOW - 2 * HOUR, replied: 'customer' } });
  const out = followUps([old, fresh, answered], { now: NOW, days: 3 });
  assert.deepEqual(out.map((f) => [f.item, f.kind]), [[answered, 'replied'], [old, 'reminder']]);
  assert.equal(out[1].days, 4);
  assert.equal(followUpReason(out[0]), 'Customer replied today');
  assert.equal(followUpReason(out[1]), 'Waiting on the customer 4 d');
  assert.equal(followUpAction(out[1]), 'Copy reminder');
  assert.equal(followUpAction(out[0]), '');
});

test('a waiting ticket with no comment at all: quiet since its last update', () => {
  const quiet = item({ work: 'waiting-customer', updatedAt: NOW - 5 * DAY });
  assert.equal(followUps([quiet], { now: NOW, days: 3 })[0].kind, 'reminder');
});

test('customer not updated for N days -> status update; never written on an old ticket -> status update; a young one -> nothing', () => {
  const stale = item({ marker: { ...BASE_MARKER, lastMineAt: NOW - 5 * DAY, lastAt: NOW - 5 * DAY } });
  const never = item({ openedAt: NOW - 4 * DAY });
  const young = item({ openedAt: NOW - DAY });
  const recent = item({ marker: { ...BASE_MARKER, lastMineAt: NOW - DAY, lastAt: NOW - DAY } });
  const vendor = item({ work: 'on-hold', marker: { ...BASE_MARKER, lastMineAt: NOW - 6 * DAY, lastAt: NOW - 6 * DAY } });
  const out = followUps([stale, never, young, recent, vendor], { now: NOW, days: 3 });
  assert.deepEqual(out.map((f) => f.item), [vendor, stale, never]);
  assert.ok(out.every((f) => f.kind === 'update'));
  assert.equal(followUpReason(out[1]), 'Customer not updated for 5 d');
  assert.equal(followUpReason(out[2]), 'No update to the customer in 4 d');
  assert.equal(followUpAction(out[1]), 'Copy status update');
});

test('no follow-up is claimed when the comments could not be read, on resolved tickets, or on tickets with no customer', () => {
  const unknown = item({ work: 'waiting-customer', updatedAt: NOW - 9 * DAY, marker: UNKNOWN_MARKER });
  const resolved = item({ work: 'resolved', marker: { ...BASE_MARKER, lastMineAt: NOW - 9 * DAY } });
  const problem = item({ table: 'problem', type: 'problem', marker: { ...BASE_MARKER, lastMineAt: NOW - 9 * DAY } });
  assert.deepEqual(followUps([unknown, resolved, problem], { now: NOW, days: 3 }), []);
});

test('a capped read of comments proves "N days" only as far back as it reached', () => {
  // Nothing of mine in a window that reaches back 5 days: I have not written for at least 5 days.
  const far = item({ marker: { ...BASE_MARKER, since: NOW - 5 * DAY } });
  // ... in a window that reaches back only 1 day: it cannot tell.
  const near = item({ marker: { ...BASE_MARKER, since: NOW - DAY } });
  const out = followUps([far, near], { now: NOW, days: 3 });
  assert.deepEqual(out.map((f) => f.item), [far]);
});

test('the period is one of the offered choices', () => {
  assert.equal(cleanDays(5), 5);
  assert.equal(cleanDays('7'), 7);
  assert.equal(cleanDays(4), 3);
  assert.equal(cleanDays('x'), 3);
  const t = item({ marker: { ...BASE_MARKER, lastMineAt: NOW - 4 * DAY } });
  assert.equal(followUps([t], { now: NOW, days: 5 }).length, 0);
  assert.equal(followUps([t], { now: NOW, days: 2 }).length, 1);
});

test('templates: fixed wording, the ticket number and title only, nothing for a reply', () => {
  const reminder = followUpText({ kind: 'reminder', item: item({ number: 'INC0010001', title: 'VPN keeps\n  dropping' }), days: 4 });
  assert.match(reminder, /^Hello,/);
  assert.match(reminder, /your reply on INC0010001 \(VPN keeps dropping\)/);
  assert.match(reminder, /may be closed/);
  const update = followUpText({ kind: 'update', item: item({ number: 'RITM0010001', title: '' }), days: 5 });
  assert.match(update, /A quick update on RITM0010001: we are still working on it/);
  assert.equal(followUpText({ kind: 'replied', item: item(), days: 0 }), '');
  const long = followUpText({ kind: 'update', item: item({ title: 'x'.repeat(500) }), days: 5 });
  assert.ok(long.length < 400, 'a long title is cut');
});
