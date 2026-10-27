import test from 'node:test';
import assert from 'node:assert/strict';
import { auditInsert, auditSalt, insertAuditEvent, readAudit } from '../src/lib/storage.js';
import { AUDIT_KEY, AUDIT_SALT_KEY, makeAuditEntry } from '../src/audit/auditLog.js';

// AB-SEC-19 / L16: every successful insert or copy lands in the audit log, from any panel (a result, a snippet, a draft on a blank
// form), with no provider needed and never any content.

function fakeChrome() {
  const data = {};
  const area = {
    data,
    async get(key) {
      if (key === null) return { ...data };
      return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {};
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
    async remove(key) {
      delete data[key];
    },
  };
  return { chrome: { storage: { local: area } }, data };
}

async function withChrome(fn) {
  const saved = globalThis.chrome;
  const fake = fakeChrome();
  globalThis.chrome = fake.chrome;
  try {
    return await fn(fake);
  } finally {
    globalThis.chrome = saved;
  }
}

const SYS = 'a'.repeat(32);

test('the event keeps only the whitelisted fields, whatever else the caller passes', () => {
  const event = insertAuditEvent({ feature: 'snippets', table: 'incident', sysId: SYS, outcome: 'inserted', text: 'Hello Abel Tuter', value: 'secret', content: 'x', journal: [1], mode: 'standard' });
  assert.deepEqual(Object.keys(event).sort(), ['feature', 'mode', 'model', 'outcome', 'provider', 'sysId', 'table']);
  assert.ok(!JSON.stringify(event).includes('Abel'));
  assert.equal(event.outcome, 'inserted');
  assert.equal(insertAuditEvent({ outcome: 'copied' }).outcome, 'copied');
  for (const odd of ['sent', 'error', 'weird', undefined, null]) assert.equal(insertAuditEvent({ outcome: odd }).outcome, 'inserted', String(odd));
  assert.deepEqual(insertAuditEvent(), { feature: '', table: '', sysId: '', provider: '', model: '', mode: undefined, outcome: 'inserted' });
});

test('a snippet insert is logged without any provider', async () => {
  await withChrome(async ({ data }) => {
    await auditInsert({ feature: 'snippets', table: 'incident', sysId: SYS, outcome: 'inserted' });
    const log = data[AUDIT_KEY];
    assert.equal(log.length, 1);
    const [entry] = log;
    assert.equal(entry.feature, 'snippets');
    assert.equal(entry.table, 'incident');
    assert.equal(entry.outcome, 'inserted');
    assert.equal(entry.provider, '');
    assert.equal(entry.model, '');
    assert.equal(entry.masked, 0);
    assert.match(entry.record, /^[0-9a-f]{12}$/);
    assert.notEqual(entry.record, SYS.slice(0, 12), 'a salted hash, not the id');
    assert.ok(!JSON.stringify(data).includes(SYS), 'the sys_id is nowhere in what was stored');
    assert.ok(AUDIT_SALT_KEY in data, 'the salt was made on first use');
  });
});

test('a copy and an insert of the same record share the record code, so "the same record again" can be seen', async () => {
  await withChrome(async ({ data }) => {
    await auditInsert({ feature: 'reply-draft', table: 'incident', sysId: SYS, outcome: 'inserted', provider: 'anthropic', model: 'claude-x', mode: 'strict' });
    await auditInsert({ feature: 'reply-draft', table: 'incident', sysId: SYS, outcome: 'copied', provider: 'anthropic', model: 'claude-x', mode: 'strict' });
    await auditInsert({ feature: 'reply-draft', table: 'incident', sysId: 'b'.repeat(32), outcome: 'inserted' });
    const log = await readAudit();
    assert.deepEqual(log.map((e) => e.outcome), ['inserted', 'copied', 'inserted']);
    assert.equal(log[0].record, log[1].record);
    assert.notEqual(log[0].record, log[2].record);
    assert.equal(log[0].provider, 'anthropic');
    assert.equal(log[0].model, 'claude-x');
    assert.equal(log[0].piiMode, 'strict');
    assert.ok(data[AUDIT_KEY]);
  });
});

test('a draft carried to a blank form has no record yet: the entry says so and still lands', async () => {
  await withChrome(async () => {
    await auditInsert({ feature: 'kb-article-draft', table: 'kb_knowledge', sysId: '', outcome: 'inserted', mode: 'standard' });
    const [entry] = await readAudit();
    assert.equal(entry.feature, 'kb-article-draft');
    assert.equal(entry.table, 'kb_knowledge');
    assert.equal(entry.record, '');
    assert.equal(entry.piiMode, 'standard');
  });
});

test('the salt is made once and reused', async () => {
  await withChrome(async () => {
    const first = await auditSalt();
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.equal(await auditSalt(), first);
  });
});

test('without browser storage the call does nothing and does not throw', async () => {
  const saved = globalThis.chrome;
  delete globalThis.chrome;
  try {
    await auditInsert({ feature: 'snippets', table: 'incident', sysId: SYS });
  } finally {
    globalThis.chrome = saved;
  }
});

test('the entry made from an insert event holds no text even when handed some', () => {
  const entry = makeAuditEntry({ ...insertAuditEvent({ feature: 'snippets', outcome: 'inserted' }), text: 'Dear Abel', reply: 'x', prompt: 'y' });
  const json = JSON.stringify(entry);
  for (const leak of ['Dear Abel', '"reply"', '"prompt"', '"text"']) assert.ok(!json.includes(leak), leak);
});
