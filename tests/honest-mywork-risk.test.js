// Audit of 2026-11-07, R-20 (wave 2 integration): a ticket whose risk columns did not come back (the key is missing from the row)
// carries a count of the facts that could not be read, and My work says "At risk may be incomplete" instead of saying nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemOf } from '../src/mywork/read.js';
import { riskColumnsFor } from '../src/mywork/tables.js';
import { ticketsWithUnreadFacts } from '../src/mywork/risk.js';

const base = { sys_id: 'a'.repeat(32), number: 'INC0010001', short_description: 'x', priority: '2', state: 'In Progress' };

test('every asked risk column that is absent from the row is counted; an empty column is a fact, not a gap', () => {
  const asked = riskColumnsFor('incident');
  assert.ok(asked.length >= 2, 'an incident asks for the reassignment and reopen counts at least');
  const whole = Object.fromEntries(asked.map((c) => [c, '']));
  assert.equal(itemOf({ ...base, ...whole }, 'incident', { asked }).factsUnread, 0);
  const without = { ...whole };
  delete without[asked[0]];
  assert.equal(itemOf({ ...base, ...without }, 'incident', { asked }).factsUnread, 1);
  assert.equal(itemOf({ ...base }, 'incident', { asked }).factsUnread, asked.length);
});

test('a read that asked for no risk columns reports none unread', () => {
  assert.equal(itemOf({ ...base }, 'incident').factsUnread, 0);
  assert.equal(itemOf({ ...base }, 'incident', { asked: [] }).factsUnread, 0);
});

test('tickets with unread facts are counted once each; a resolved ticket is not counted', () => {
  const items = [{ factsUnread: 2, work: 'working' }, { factsUnread: 1, work: 'new' }, { factsUnread: 0, work: 'working' }, { factsUnread: 3, work: 'resolved' }, null, {}];
  assert.equal(ticketsWithUnreadFacts(items), 2);
  assert.equal(ticketsWithUnreadFacts(undefined), 0);
});
