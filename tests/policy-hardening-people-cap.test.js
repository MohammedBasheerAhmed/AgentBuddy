// Build rule 4: anyone named in the data is on pack.people (or is a note author), so the firewall masks the name exactly. The people
// list used to be capped (30 on a record, 40 for other tickets' rows, 30 for an account's cases, 40 for look-alikes and articles) while
// the rows that name those people stayed in the pack: the 31st approver's name went out unmasked. Now every person a row names is on
// the list (the rows themselves are capped where they are read); only note authors keep a cap, and they are masked from the notes anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/context/allowlists.js';
import { resolvePeople } from '../src/context/people.js';
import { readContextPack } from '../src/context/pack.js';
import { addReference, MAX_HIT_PEOPLE, SIMILAR_LIMIT, KNOWLEDGE_LIMIT } from '../src/itsm/reference.js';
import { mergeAccountCases } from '../src/domain/accountCases.js';
import { featureById } from '../src/features/registry.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { v } from './fixtures/sn-fakeDeps.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { IDS, domainTables, sid } from './domain-fixtures.js';

// Distinct, name-shaped people: "Kalona Ruvik", "Lolona Savik"... (no two share a word, so each is masked on its own).
const S = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'da'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const nameOf = (i) => `${cap(S[i % 10] + S[Math.floor(i / 10) % 10])}ona ${cap(S[Math.floor(i / 10) % 10] + S[i % 10])}vik`;
const idOf = (i) => sid('fe00', i + 1);

const run = (id, pack) =>
  prepareRun({
    feature: featureById(id),
    pack,
    values: effectiveSettings({ provider: 'anthropic', piiMode: 'standard' }, {}).values,
    policy: normalizePolicy({}),
    config: resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test'),
    createFirewall,
  });
const outgoing = (prepared) => prepared.request.messages.map((m) => m.content).join('\n');
const namesOn = (pack) => new Set(pack.people.map((p) => p.name));

test('resolvePeople keeps every person a column or a related row names, however many; only note authors are capped', async () => {
  const refs = [];
  for (let i = 0; i < 44; i += 1) refs.push({ role: i < 4 ? 'caller' : 'approver', sysId: idOf(i), name: nameOf(i), table: 'sys_user' });
  const logins = Array.from({ length: LIMITS.people + 5 }, (_, i) => `author.${i}`);
  const users = logins.map((login, i) => ({ sys_id: idOf(100 + i), user_name: login, name: nameOf(50 + i), email: `${login}@corp-example.test` }));
  const { people } = await resolvePeople({ refs, logins }, { queryTable: async () => users });
  const kept = new Set(people.map((p) => p.name));
  for (const ref of refs) assert.ok(kept.has(ref.name), `${ref.name} (${ref.role}) is on the list`);
  assert.equal(people.filter((p) => p.role === 'journal_author').length, LIMITS.people, 'note authors keep their cap');
});

test('a change with 20 approvers and 20 task owners: every name on its rows is on pack.people and none goes out unmasked', async () => {
  const tables = domainTables();
  tables.sysapproval_approver = Array.from({ length: 20 }, (_, i) => ({
    sys_id: v(sid('a902', i + 1)),
    sysapproval: v(IDS.change, 'CHG0030001'),
    approver: v(idOf(i), nameOf(i)),
    group: v(''),
    state: v('requested', 'Requested'),
    sys_updated_on: v('2026-10-26 09:00:00'),
    sys_created_on: v(`2026-10-26 09:${String(i).padStart(2, '0')}:00`),
  }));
  tables.change_task = Array.from({ length: 20 }, (_, i) => ({
    sys_id: v(sid('c7a6', i + 1)),
    change_request: v(IDS.change, 'CHG0030001'),
    number: v(`CTASK00${40100 + i}`),
    short_description: v(`Step ${i + 1}`),
    state: v('1', 'Open'),
    assigned_to: v(idOf(20 + i), nameOf(20 + i)),
    assignment_group: v('grp2', 'Network Support'),
    change_task_type: v('planning', 'Planning'),
    active: v('true'),
    sys_created_on: v(`2026-10-21 10:${String(i).padStart(2, '0')}:00`),
  }));
  const pack = await readContextPack({ table: 'change_request', sysId: IDS.change }, fakeDeps(tables), { feature: 'record-summary' });
  assert.equal(pack.related.approvals.length, 20);
  assert.equal(pack.related.changeTasks.length, 20);
  const listed = namesOn(pack);
  const named = [...pack.related.approvals.map((r) => r.approver), ...pack.related.changeTasks.map((r) => r.assignedTo)];
  assert.equal(new Set(named).size, 40);
  for (const name of named) assert.ok(listed.has(name), `${name} is named on a row but not on pack.people`);
  assert.ok(pack.people.length > 30, `more than the old cap of 30 (${pack.people.length})`);

  const text = outgoing(run('record-summary', pack));
  for (const name of named) assert.ok(!text.includes(name), `${name} reached the AI`);
});

test('a problem with 20 linked incidents naming 60 people: every one is on pack.people (the old cap was 40)', async () => {
  const tables = domainTables({ incidents: { linked: 20 } });
  tables.incident.forEach((row, i) => {
    if (i >= 20) return;
    row.caller_id = v(idOf(3 * i), nameOf(3 * i));
    row.opened_by = v(idOf(3 * i + 1), nameOf(3 * i + 1));
    row.assigned_to = v(idOf(3 * i + 2), nameOf(3 * i + 2));
    row.close_notes = v(`${nameOf(3 * i)} confirmed after ${nameOf(3 * i + 2)} restarted the pool.`);
  });
  const pack = await readContextPack({ table: 'problem', sysId: IDS.problem }, fakeDeps(tables), { feature: 'problem-rca' });
  assert.equal(pack.related.linkedIncidents.length, 20);
  const listed = namesOn(pack);
  for (let i = 0; i < 60; i += 1) assert.ok(listed.has(nameOf(i)), `${nameOf(i)} is on a linked incident but not on pack.people`);
  const text = outgoing(run('problem-rca', pack));
  for (let i = 0; i < 60; i += 1) assert.ok(!text.includes(nameOf(i)), `${nameOf(i)} reached the AI`);
});

test('look-alike tickets and articles: all their people go on the pack (3 + 3 hits of 8 names: 48, the old cap was 40)', async () => {
  let n = 0;
  const hit = (number) => ({ number, short_description: `Gateway timeout seen by ${nameOf(n)}`, close_notes: 'Restarted the pool.', people: Array.from({ length: MAX_HIT_PEOPLE }, () => nameOf(n++)), why: ['shares gateway'] });
  const article = (number) => ({ number, short_description: 'Gateway timeouts', excerpt: 'Restart the pool.', score: 80, why: ['title mentions gateway'], people: Array.from({ length: MAX_HIT_PEOPLE }, () => nameOf(n++)) });
  const similarHits = Array.from({ length: SIMILAR_LIMIT }, (_, i) => hit(`INC00${20000 + i}`));
  const articleHits = Array.from({ length: KNOWLEDGE_LIMIT }, (_, i) => article(`KB00${10000 + i}`));
  const read = async (op) => (op === 'knowledge' ? { hits: articleHits, access: [] } : { hits: similarHits, access: [] });
  const pack = { table: 'incident', sysId: sid('1c00', 1), number: 'INC0001001', kind: 'incident', fields: { short_description: 'Gateway timeout' }, people: [], journal: [], related: {}, access: [] };
  const out = await addReference(pack, { read }, { similar: 'similar', knowledge: true });
  assert.equal(n, (SIMILAR_LIMIT + KNOWLEDGE_LIMIT) * MAX_HIT_PEOPLE);
  const listed = namesOn(out);
  for (let i = 0; i < n; i += 1) assert.ok(listed.has(nameOf(i)), `${nameOf(i)} is on a hit but not on pack.people`);
});

test("an account's 10 other cases with 4 people each: all 40 go on the pack (the old cap was 30)", () => {
  let n = 0;
  const cases = Array.from({ length: 10 }, (_, i) => ({ number: `CS00${30000 + i}`, short_description: `Login fails for ${nameOf(n)}`, state: 'Open', people: Array.from({ length: 4 }, () => nameOf(n++)) }));
  const pack = { table: 'sn_customerservice_case', sysId: IDS.case, kind: 'case', fields: {}, people: [{ role: 'contact', name: 'Marisol Quintero', email: '', sysId: '' }], journal: [], related: {}, access: [] };
  const out = mergeAccountCases(pack, { cases, more: 0, access: [{ source: 'sn_customerservice_case', status: 'ok', note: '' }] });
  assert.equal(out.related.accountCases.length, 10);
  const listed = namesOn(out);
  for (let i = 0; i < 40; i += 1) assert.ok(listed.has(nameOf(i)), `${nameOf(i)} is on a case but not on pack.people`);
  assert.ok(listed.has('Marisol Quintero'), 'the record\'s own people stay');
});
