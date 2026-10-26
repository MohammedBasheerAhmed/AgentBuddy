const test = require('node:test');
const assert = require('node:assert/strict');
import { makeAuditEntry, appendAudit, auditToCsv, hashRecordId } from '../src/audit/auditLog.js';

const NOW = new Date('2026-10-26T10:00:00Z');

test('an entry keeps only whitelisted fields and numbers', () => {
  const entry = makeAuditEntry(
    {
      feature: 'record-summary',
      table: 'incident',
      recordHash: 'abc123',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      mode: 'standard',
      preview: 'shown',
      stats: { total: 3, counts: { EMAIL: 2, PERSON: 1, 'bad key': 9, ZERO: 0 } },
      usage: { input: 120, output: 40 },
      outcome: 'sent',
      ms: 812,
      // Things that must never reach the log:
      prompt: 'My password is hunter2',
      reply: 'Abel Tuter says hi',
      text: 'secret',
    },
    NOW,
  );
  assert.deepEqual(entry.counts, { EMAIL: 2, PERSON: 1 });
  assert.equal(entry.masked, 3);
  assert.equal(entry.outcome, 'sent');
  const json = JSON.stringify(entry);
  for (const leak of ['hunter2', 'Abel', 'secret', 'prompt', 'reply']) assert.ok(!json.includes(leak), leak);
});

test('unknown outcomes become "error" and free-text reasons are dropped', () => {
  const entry = makeAuditEntry({ outcome: 'weird', reason: 'Failed for abel.tuter@example.com' }, NOW);
  assert.equal(entry.outcome, 'error');
  assert.equal(entry.reason, '');
  assert.equal(makeAuditEntry({ outcome: 'blocked', reason: 'BLOCKED_FIELD' }, NOW).reason, 'BLOCKED_FIELD');
});

test('the record id is a salted hash, stable per salt', async () => {
  const sys = '32f5bd7d1b2f4110a6a3fd7ae54bcb0a';
  const a = await hashRecordId(sys, 'salt1');
  assert.equal(a, await hashRecordId(sys, 'salt1'));
  assert.notEqual(a, await hashRecordId(sys, 'salt2'));
  assert.ok(!a.includes(sys.slice(0, 8)));
  assert.equal(a.length, 12);
  assert.equal(await hashRecordId('', 's'), '');
});

test('the log keeps the newest entries', () => {
  let log = [];
  for (let i = 0; i < 7; i += 1) log = appendAudit(log, makeAuditEntry({ feature: `f${i}`, outcome: 'sent' }, NOW), 5);
  assert.equal(log.length, 5);
  assert.equal(log[0].feature, 'f2');
  assert.equal(log.at(-1).feature, 'f6');
});

test('CSV export has a header, escapes cells and blocks spreadsheet formulas', () => {
  const log = [makeAuditEntry({ feature: '=cmd|calc', table: 'incident', outcome: 'sent', stats: { total: 1, counts: { EMAIL: 1 } } }, NOW)];
  const csv = auditToCsv(log);
  const [header, row] = csv.split('\r\n');
  assert.match(header, /^time,feature,table,record/);
  assert.ok(row.includes("'=cmd|calc"));
  assert.ok(row.includes('EMAIL:1'));
});
