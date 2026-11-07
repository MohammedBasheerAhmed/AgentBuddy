// Audit of 2026-11-07, R-18 / R-19 (wave 2 integration, D6): a journal that came back without the internal notes or without the
// comments is not "none": "Made without" says some may be hidden, and the model is told not to say there are none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unavailable, unavailableText, madeWithout } from '../src/features/parts.js';

const pack = (entry) => ({ table: 'incident', access: [{ source: 'journal', status: 'ok', note: '', ...entry }] });

test('hidden internal notes and hidden comments are named, once each, as partial', () => {
  const list = unavailable(pack({ workNotesHidden: true, commentsHidden: true }));
  assert.deepEqual(list.map((u) => [u.what, u.status]), [['Internal notes', 'partial'], ['Comments to the customer', 'partial']]);
});

test('a journal that came back whole says nothing', () => {
  assert.deepEqual(unavailable(pack({})), []);
  assert.equal(unavailableText(unavailable(pack({}))), '');
});

test('the model is told not to describe a partly hidden journal as empty; the person sees plain words', () => {
  const list = unavailable(pack({ workNotesHidden: true }));
  const text = unavailableText(list);
  assert.match(text, /Internal notes: some of it may be hidden from your user \(do not say there is none\)/);
  const [shown] = madeWithout(list);
  assert.equal(shown.what, 'Internal notes');
  assert.equal(shown.why, 'some may be hidden from you');
  assert.doesNotMatch(JSON.stringify(shown), /work_notes|sys_journal_field|_/);
});

test('a refused journal still reads as before (status denied is not partial)', () => {
  const list = unavailable({ table: 'incident', access: [{ source: 'journal', status: 'denied', note: '' }] });
  assert.deepEqual(list.map((u) => u.status), ['denied']);
});
