// Wrong results found while walking the Write tools, each pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendEmails } from '../src/compose/emailRecommend.js';
import { readContextPack } from '../src/context/pack.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' };

// A resolved incident. Field values are DISPLAY values in the reader's time zone; the notes came from sys_journal_field, whose
// times are stored UTC; related.times holds the stored UTC values of the record's dates (src/context/pack.js).
function resolved({ displayResolved, utcResolved, told, strategy = 'sys_journal_field' }) {
  return {
    kind: 'incident',
    fields: { state: 'Resolved', resolved_at: displayResolved, opened_at: '2026-10-20 08:00:00' },
    people: [ABEL],
    journal: [
      { when: '2026-10-25 09:00:00', by: 'Abel Tuter', type: 'comment', text: 'Still broken.' },
      { when: told, by: 'Beth Anglin', type: 'comment', text: 'We renewed the certificate, it should work now.' },
    ],
    related: { times: { resolved_at: utcResolved, opened_at: '2026-10-20 06:00:00' } },
    access: [{ source: 'journal', status: 'ok', note: '', strategy }],
  };
}
const resolutionPick = (pack) => recommendEmails(pack, { now: NOW }).picks.find((p) => p.id === 'resolution');

test('email suggestion: an agent reply 30 minutes AFTER the resolution counts as "told", whatever the reader\'s time zone', () => {
  // Reader at UTC+2: resolved 09:30 UTC shows as 11:30; the agent wrote at 10:00 UTC.
  const pick = resolutionPick(resolved({ displayResolved: '2026-10-26 11:30:00', utcResolved: '2026-10-26 09:30:00', told: '2026-10-26 10:00:00' }));
  assert.equal(pick.score, 35, pick.why);
  assert.match(pick.why, /already told/);
});

test('email suggestion: an agent reply hours BEFORE the resolution does not count as "told" (reader at UTC-8)', () => {
  // Resolved 09:30 UTC shows as 01:30; the agent wrote at 07:00 UTC, before it was resolved.
  const pick = resolutionPick(resolved({ displayResolved: '2026-10-26 01:30:00', utcResolved: '2026-10-26 09:30:00', told: '2026-10-26 07:00:00' }));
  assert.equal(pick.score, 90, pick.why);
});

test('email suggestion: notes read from the record\'s own fields are in the reader\'s time zone, so they compare with the display values', () => {
  const pick = resolutionPick(resolved({ displayResolved: '2026-10-26 11:30:00', utcResolved: '2026-10-26 09:30:00', told: '2026-10-26 12:00:00', strategy: 'record-fields' }));
  assert.equal(pick.score, 35, pick.why);
});

test('the email pack carries the stored UTC times of the dates the suggestion compares (and no other pack gains them)', async () => {
  const email = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: 'email-compose' });
  assert.ok(email.related.times, 'times are on the email pack');
  for (const [name, value] of Object.entries(email.related.times)) {
    assert.ok(['opened_at', 'resolved_at', 'closed_at'].includes(name), name);
    assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  }
  // The fixture's instance shows times two hours ahead: the stored value is the UTC one, not the display value.
  assert.notEqual(email.related.times.opened_at, email.fields.opened_at);
  const summary = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: 'record-summary' });
  assert.ok(!('times' in summary.related));
});
