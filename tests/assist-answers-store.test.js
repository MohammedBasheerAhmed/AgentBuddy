import test from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS_PER_RECORD, RECORDS_KEPT, createAnswerStore, keyOf } from '../src/sidepanel/ticket/assist/answers/store.js';
import { ago, elsewhereLines } from '../src/sidepanel/ticket/assist/answers/logic.js';

// The answers of the Ticket screen, kept per ticket in memory (TRACKER.md AI0.4): which ticket an answer belongs to, the caps, the
// order, what counts as seen, and the line about other tickets.

const page = (table, sysId, host = 'acme.service-now.com') => ({ href: `https://${host}/${table}.do?sys_id=${sysId}`, record: { table, sysId } });
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

test('a key names one ticket on one instance: the same sys_id on another instance is another ticket', () => {
  assert.equal(keyOf(page('incident', A)), `acme.service-now.com|incident:${A}`);
  assert.notEqual(keyOf(page('incident', A)), keyOf(page('incident', A, 'other.service-now.com')), 'demo records share sys_ids across instances');
  assert.notEqual(keyOf(page('incident', A)), keyOf(page('problem', A)));
  assert.equal(keyOf(page('incident', A), { table: 'incident', sysId: B }), `acme.service-now.com|incident:${B}`, 'the record given wins');
  assert.equal(keyOf({ href: 'https://x/', record: null }), '', 'no record, no key');
  assert.equal(keyOf({ href: 'not a url', record: { table: 'incident', sysId: A } }), `|incident:${A}`);
});

test('answers are kept per ticket, newest first, and never show up on another ticket', () => {
  let t = 1000;
  const store = createAnswerStore({ now: () => t });
  const ka = keyOf(page('incident', A));
  const kb = keyOf(page('incident', B));
  const summary = store.add(ka, { text: 'Summary' });
  t += 60000;
  const reply = store.add(ka, { text: 'Reply' });
  assert.deepEqual(store.list(ka).map((a) => a.text), ['Reply', 'Summary'], 'the summary stays while the reply is drafted');
  assert.deepEqual(store.list(kb), []);
  assert.equal(store.get(ka, summary).at, 1000);
  assert.equal(store.get(ka, reply).at, 61000);
  assert.equal(store.get(kb, reply), null, 'an id of one ticket finds nothing on another');
  assert.equal(store.add('', { text: 'x' }), '', 'no key, nothing kept');
});

test('caps: the oldest answer of a ticket goes first; past the ticket cap, the ticket looked at least recently goes', () => {
  const store = createAnswerStore({ perRecord: 3, records: 2 });
  for (let i = 1; i <= 5; i++) store.add('t1', { text: `answer ${i}` });
  assert.deepEqual(store.list('t1').map((a) => a.text), ['answer 5', 'answer 4', 'answer 3']);
  store.add('t2', { text: 'two' });
  store.seen('t1'); // t1 is on screen again: t2 is now the one looked at least recently
  store.add('t3', { text: 'three' });
  assert.deepEqual(store.keys().sort(), ['t1', 't3']);
  assert.deepEqual(store.list('t2'), []);
  // the ticket being added to is never the one that goes
  const small = createAnswerStore({ records: 1 });
  small.add('x', { text: 'x' });
  small.add('y', { text: 'y' });
  assert.deepEqual(small.keys(), ['y']);
  assert.ok(ANSWERS_PER_RECORD >= 3 && RECORDS_KEPT >= 5, 'sensible defaults');
});

test('update, remove, forget; listeners hear every change and one that throws stops nobody', () => {
  const store = createAnswerStore();
  let heard = 0;
  store.subscribe(() => {
    throw new Error('a listener that breaks');
  });
  const off = store.subscribe(() => {
    heard += 1;
  });
  const id = store.add('k', { text: 'one', unseen: true });
  assert.equal(heard, 1);
  assert.equal(store.update('k', id, { text: 'two', id: 'hijack' }), true);
  assert.equal(store.get('k', id).text, 'two', 'the id cannot be changed');
  assert.equal(store.update('k', 'nope', { text: 'x' }), false);
  store.seen('k');
  assert.equal(store.get('k', id).unseen, false, 'on screen = seen');
  const before = heard;
  store.seen('k');
  assert.equal(heard, before, 'nothing new seen, nothing to tell');
  assert.equal(store.remove('k', id), true);
  assert.deepEqual(store.keys(), [], 'a ticket with no answers left is dropped');
  assert.equal(store.remove('k', id), false);
  store.add('a', { text: 'a' });
  store.add('b', { text: 'b' });
  store.forget('a');
  assert.deepEqual(store.keys(), ['b']);
  store.forget();
  assert.deepEqual(store.keys(), []);
  const v = store.version();
  off();
  store.add('c', { text: 'c' });
  assert.ok(store.version() > v);
});

test('"2 min ago": short and plain', () => {
  assert.equal(ago(1000, 1000), 'just now');
  assert.equal(ago(1000, 59000), 'just now');
  assert.equal(ago(0, 61000), '1 min ago');
  assert.equal(ago(0, 12 * 60000 + 5000), '12 min ago');
  assert.equal(ago(0, 2 * 3600000 + 1), '2 h ago');
  assert.equal(ago(5000, 1000), 'just now', 'a clock that went back');
});

test('the line about other tickets: a check waiting, an answer on its way, answers ready; never the ticket on show; three at most', () => {
  const runs = [
    { key: 'a', phase: 'preview', number: 'INC1' },
    { key: 'b', phase: 'sending', number: 'INC2' },
    { key: 'c', phase: 'idle', number: 'INC3' },
    { key: 'd', phase: 'reading', number: '' },
    { key: 'cur', phase: 'sending', number: 'INC9' },
    { key: 'e', phase: 'idle', number: 'INC5' },
  ];
  const answersOf = (k) => ({ c: [{ unseen: true }, { unseen: true }], e: [{ unseen: true }], cur: [{ unseen: true }] }[k] || []);
  const lines = elsewhereLines({ runs, answersOf, current: 'cur' });
  assert.deepEqual(lines.map((l) => l.text), ['INC1: waiting for you to check what is sent.', 'INC2: answer on its way.', 'another ticket: answer on its way.']);
  assert.deepEqual(elsewhereLines({ runs: runs.slice(2, 3), answersOf, current: 'cur' }).map((l) => l.text), ['INC3: 2 answers are ready.']);
  assert.deepEqual(elsewhereLines({ runs: [{ key: 'e', phase: 'idle', number: 'INC5' }], answersOf, current: '' }).map((l) => l.text), ['INC5: an answer is ready.']);
  assert.deepEqual(elsewhereLines({ runs: [{ key: 'x', phase: 'idle', number: 'INC7' }], answersOf, current: '' }), [], 'seen answers say nothing');
  assert.deepEqual(elsewhereLines({}), []);
});
