// Round 5, the weekly views: the weeks, the arithmetic (change, first reply, areas) and the three "Needs a decision" rules. All pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekWindows, localParts, cleanWhich } from '../src/reports/weekly/weeks.js';
import { WEEKLY_LIMITS, areaBars, causeDecision, change, decisionsFrom, durationTolerance, firstReplies, loadDecision, notesDecision, percentOf, replySummary, strictSum, typicalTime } from '../src/reports/weekly/figures.js';
import { zoneOffset } from '../src/reports/engine/time.js';

const DAY = 86400000;
const HOUR = 3600000;
const NOW = Date.UTC(2026, 10, 18, 15, 36); // Wednesday 18 Nov 2026, 15:36 UTC

// ---- The weeks ---------------------------------------------------------------------------------------------------------------------

test('last week is the last whole week, Monday to Sunday, against the week before it', () => {
  const w = weekWindows({ now: NOW, tz: 0, which: 'last' });
  assert.equal(w.partial, false);
  assert.equal(w.current.start, Date.UTC(2026, 10, 9));
  assert.equal(w.current.end, Date.UTC(2026, 10, 16));
  assert.equal(w.previous.start, Date.UTC(2026, 10, 2));
  assert.equal(w.previous.end, Date.UTC(2026, 10, 9));
  assert.deepEqual([w.first.d, w.first.m, w.last.d, w.last.m], [9, 11, 15, 11], '9 to 15 Nov');
  assert.deepEqual([w.first.wd, w.last.wd], [1, 0], 'a Monday and a Sunday');
});

test('this week so far is compared with the SAME days of last week, never with the whole of it', () => {
  const w = weekWindows({ now: NOW, tz: 0, which: 'this' });
  assert.equal(w.partial, true);
  assert.equal(w.current.start, Date.UTC(2026, 10, 16));
  assert.equal(w.current.end, NOW);
  const span = NOW - w.current.start;
  assert.equal(w.previous.start, Date.UTC(2026, 10, 9));
  assert.equal(w.previous.end - w.previous.start, span, 'the same length');
  assert.ok(w.previous.end < w.current.start, 'and it ends before this week starts');
  assert.deepEqual([w.first.d, w.last.d], [16, 18]);
});

test('on a Monday morning "this week" has barely begun and last week is still the one that just ended', () => {
  const monday = Date.UTC(2026, 10, 16, 0, 5);
  const last = weekWindows({ now: monday, tz: 0, which: 'last' });
  assert.equal(last.current.start, Date.UTC(2026, 10, 9));
  assert.equal(last.current.end, Date.UTC(2026, 10, 16));
  const sunday = weekWindows({ now: Date.UTC(2026, 10, 15, 23, 59), tz: 0, which: 'last' });
  assert.equal(sunday.current.start, Date.UTC(2026, 10, 2), 'on Sunday evening the last whole week is the one before');
});

test('the week is the person\'s own: Monday starts at local midnight in their zone, summer time included', () => {
  const kolkata = zoneOffset('Asia/Kolkata'); // UTC+5:30
  const w = weekWindows({ now: NOW, tz: kolkata, which: 'last' });
  assert.equal(w.current.start, Date.UTC(2026, 10, 8, 18, 30), 'Monday 9 Nov 00:00 in India');
  const berlin = zoneOffset('Europe/Berlin');
  // The week of the clock change (25 Oct 2026): the week is 169 hours long, not 168.
  const across = weekWindows({ now: Date.UTC(2026, 9, 28, 12), tz: berlin, which: 'last' });
  assert.equal(across.current.end - across.current.start, 7 * DAY + HOUR);
  assert.deepEqual(localParts(Date.UTC(2026, 10, 15, 23, 30), berlin), { y: 2026, m: 11, d: 16, wd: 1 }, '23:30 UTC is already Monday in Berlin');
});

test('a request for any other week is "last"', () => {
  for (const which of ['', 'next', null, undefined, 'THIS', 7]) assert.equal(cleanWhich(which), 'last');
  assert.equal(cleanWhich('this'), 'this');
});

// ---- Change against the week before ------------------------------------------------------------------------------------------------------

test('a change says up, down or the same, and whether that is good, bad or neither', () => {
  assert.deepEqual(change(11, 8, { goodWhen: 'up' }), { delta: 3, dir: 'up', tone: 'good' });
  assert.deepEqual(change(1, 3, { goodWhen: 'down' }), { delta: -2, dir: 'down', tone: 'good' });
  assert.deepEqual(change(5, 3, { goodWhen: 'down' }), { delta: 2, dir: 'up', tone: 'bad' });
  assert.deepEqual(change(63, 54), { delta: 9, dir: 'up', tone: 'neutral' }, 'more tickets coming in is neither good nor bad');
  assert.deepEqual(change(4, 4, { goodWhen: 'up' }), { delta: 0, dir: 'same', tone: 'neutral' });
  assert.equal(change(3000, 3100, { tolerance: 600 }).dir, 'same', 'a typical time that moved a little did not move');
});

test('no comparison is better than a made-up one: a missing side is null, never zero', () => {
  for (const [a, b] of [[5, null], [null, 5], [5, undefined], [NaN, 3], [3, Infinity], ['x', 3]]) assert.equal(change(a, b, { goodWhen: 'up' }), null, `${a} / ${b}`);
  assert.equal(change(0, 0)?.dir, 'same', 'a real zero is a number');
});

test('the tolerance of a typical time is two minutes or five percent, whichever is more', () => {
  assert.equal(durationTolerance(10 * 60000), 120000);
  assert.equal(durationTolerance(100 * HOUR), 5 * HOUR);
  assert.equal(durationTolerance(NaN), 120000);
});

test('a share is a whole percent, or null when it is a share of nothing', () => {
  assert.equal(percentOf(10, 11), 91);
  assert.equal(percentOf(0, 4), 0);
  assert.equal(percentOf(0, 0), null);
  assert.equal(percentOf(null, 4), null);
});

test('a total of counts is a total only when every count was read', () => {
  assert.equal(strictSum([{ ok: true, value: 3 }, { ok: true, value: 4 }]), 7);
  assert.equal(strictSum([{ ok: true, value: 3 }, { ok: false, status: 'denied', note: '' }]), null);
  assert.equal(strictSum([]), null, 'nothing to add up is not a zero');
  assert.equal(strictSum([{ ok: true, value: 0 }]), 0, 'a count of zero that was read is zero');
});

// ---- First reply ------------------------------------------------------------------------------------------------------------------------

const T0 = Date.UTC(2026, 10, 10, 9, 0);
const ID = (n) => String(n).padStart(32, '0');
const entry = (id, minutes, by) => ({ element_id: ID(id), sys_created_on: { value: new Date(T0 + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ') }, sys_created_by: by });

test('the first reply is the first customer-visible comment by somebody other than the customer, from opening', () => {
  const tickets = [
    { sysId: ID(1), openedAt: T0, customer: 'abel.tuter' },
    { sysId: ID(2), openedAt: T0, customer: 'abel.tuter' },
  ];
  const rows = [
    entry(1, 5, 'abel.tuter'), // the customer's own comment is not a reply
    entry(1, 40, 'itil'),
    entry(1, 90, 'itil'),
    entry(2, 10, 'system'), // a robot is not a reply
    entry(2, 25, 'itil'),
  ];
  const out = firstReplies(tickets, rows);
  assert.deepEqual(out.times, [40 * 60000, 25 * 60000]);
  assert.equal(out.noReply, 0);
  assert.equal(out.left, 0);
});

test('a ticket with no reply is not a zero; one whose comments were cut off is unknown; one with no customer login is left out', () => {
  const tickets = [
    { sysId: ID(1), openedAt: T0, customer: 'abel.tuter' },
    { sysId: ID(2), openedAt: T0, customer: 'abel.tuter' },
    { sysId: ID(3), openedAt: T0, customer: '' },
  ];
  const rows = [entry(1, 30, 'itil')];
  const whole = firstReplies(tickets, rows, { cut: false });
  assert.deepEqual(whole.times, [30 * 60000]);
  assert.equal(whole.noReply, 1, 'the read was complete: nobody answered the second ticket');
  assert.equal(whole.left, 1, 'without the customer\'s login a reply cannot be told from the customer\'s own comment');
  const cut = firstReplies(tickets, rows, { cut: true });
  assert.equal(cut.unknown, 1, 'the read stopped at its limit: the second ticket may have a later reply');
  assert.equal(cut.noReply, 0);
});

test('a comment from before the ticket was opened is not its reply', () => {
  const out = firstReplies([{ sysId: ID(1), openedAt: T0, customer: 'c' }], [entry(1, -10, 'itil'), entry(1, 15, 'itil')]);
  assert.deepEqual(out.times, [15 * 60000]);
});

test('an average needs at least three tickets; a typical time too', () => {
  assert.equal(replySummary({ times: [60000, 120000] }, 5), null);
  assert.deepEqual(replySummary({ times: [60000, 120000, 180000] }, 5), { meanMs: 120000, n: 3, of: 5 });
  assert.equal(replySummary(null, 5), null);
  assert.equal(typicalTime([1, 2]), null);
  assert.equal(typicalTime([1, 2, 10]), 2 * HOUR, 'the median, in ms');
  assert.equal(typicalTime([NaN, 1, 2]), null, 'a ticket with no date is not counted');
});

// ---- Where the week went ------------------------------------------------------------------------------------------------------------------

test('the areas: biggest first, the same area written two ways adds up, the rest is one "Other"', () => {
  const bars = areaBars([
    { name: 'Network', count: 3 },
    { name: 'network', count: 2 },
    { name: 'Email', count: 3 },
    { name: 'Access', count: 1 },
    { name: 'Hardware', count: 1 },
    { name: 'Software', count: 1 },
    { name: 'Printing', count: 1 },
    { name: 'Telephony', count: 1 },
  ]);
  assert.deepEqual(bars.map((b) => [b.name, b.count]), [['Network', 5], ['Email', 3], ['Access', 1], ['Hardware', 1], ['Printing', 1], ['Other', 2]]);
  assert.equal(bars[5].plain, true, '"Other" is our word, shown in the panel\'s language');
  assert.equal(bars[0].plain, false, 'a category is the site\'s own word');
});

test('an area with no name is "No category set", a zero or a broken count is dropped', () => {
  const bars = areaBars([{ name: '', count: 2 }, { name: 'Network', count: 0 }, { name: 'Email', count: NaN }, { name: 'Access', count: 1 }]);
  assert.deepEqual(bars.map((b) => b.name), ['No category set', 'Access']);
  assert.equal(bars[0].plain, true);
  assert.deepEqual(areaBars(null), []);
});

// ---- Needs a decision --------------------------------------------------------------------------------------------------------------------------

test('one likely cause: a configuration item with at least three tickets of the week, clearly ahead of the next', () => {
  assert.deepEqual(causeDecision([{ id: 'a', name: 'VPN Gateway EU', count: 4, table: 'incident' }, { id: 'b', name: 'Mail', count: 2 }]), { id: 'cause', count: 4, name: 'VPN Gateway EU', ciId: 'a', table: 'incident' });
  assert.equal(causeDecision([{ id: 'a', name: 'VPN', count: 2 }]), null, 'two is not a pattern');
  assert.equal(causeDecision([{ id: 'a', name: 'VPN', count: 4 }, { id: 'b', name: 'Mail', count: 4 }]), null, 'a tie is not "one" cause');
  assert.equal(causeDecision([]), null);
  assert.equal(causeDecision([{ id: '', name: 'x', count: 9 }]), null, 'a ticket with no configuration item is not a cause');
});

test('load on a few people: the busiest two hold 40 percent or more of the open tickets that have an owner', () => {
  assert.deepEqual(loadDecision([12, 10, 5, 4, 3, 2]), { id: 'load', people: 2, percent: 61, of: 36 });
  assert.equal(loadDecision([6, 5, 5, 5, 5, 5, 5, 5, 5, 5]), null, 'an even spread');
  assert.equal(loadDecision([5, 3, 2]), null, 'three people: "two hold most" says nothing');
  assert.equal(loadDecision([3, 3, 2, 1]), null, 'nine open tickets are too few to call anything a load');
  assert.equal(loadDecision([]), null);
  assert.equal(WEEKLY_LIMITS.loadTop, 2, 'the sentence says "Two people": change both together');
});

test('closes without a fix note: at least three, and at least a fifth of the closed tickets', () => {
  assert.deepEqual(notesDecision(14, 3), { id: 'notes', without: 3, closed: 14 });
  assert.equal(notesDecision(100, 3), null, '3 of 100 is not a habit');
  assert.equal(notesDecision(14, 2), null);
  assert.equal(notesDecision(4, 4), null, 'four tickets are too few');
  assert.equal(notesDecision(null, 3), null);
  assert.equal(notesDecision(14, undefined), null);
});

test('the decisions come in a fixed order and only the ones the data supports', () => {
  const cause = { id: 'cause' };
  const load = { id: 'load' };
  const notes = { id: 'notes' };
  assert.deepEqual(decisionsFrom({ notes, cause, load }), [cause, load, notes]);
  assert.deepEqual(decisionsFrom({ load }), [load]);
  assert.deepEqual(decisionsFrom({}), []);
  assert.deepEqual(decisionsFrom(), []);
});
