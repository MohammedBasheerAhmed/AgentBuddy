// W-11 of the audit of 2026-11-07: a ticket of a table Agent Buddy has no name for gets two actions and no cards, with no word about it.
// The line that says so (src/features/focus.js limitedKindNote) is shown under the five rows (the Ticket screen's AssistHalf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { limitedKindNote } from '../src/features/focus.js';
import { featuresFor } from '../src/features/registry.js';
import { KINDS } from '../src/context/kinds.js';
import { normalizePolicy } from '../src/policy/policy.js';

test('only a kind the product knows little about gets the line, in plain words', () => {
  assert.equal(limitedKindNote('other'), 'Agent Buddy does not know this kind of ticket, so only the basics are shown.');
  for (const kind of KINDS.filter((k) => k !== 'other')) assert.equal(limitedKindNote(kind), '', kind);
  assert.equal(limitedKindNote(undefined), '');
  assert.ok(!/table|record|column|sys_id/i.test(limitedKindNote('other')), 'no table or column word');
});

test('the line is true: "other" really is the kind with the fewest actions (the basics: a summary and a catch-up)', () => {
  const ids = featuresFor('other', normalizePolicy({})).map((f) => f.id).sort();
  assert.deepEqual(ids, ['record-summary', 'thread-summary']);
});
