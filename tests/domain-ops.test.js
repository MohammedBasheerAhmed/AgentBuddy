import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/content/ops/index.js';
import domainOps, { ACCOUNT_CASES_MAX, readAccountCases } from '../src/content/ops/domain.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { readContextPack } from '../src/context/pack.js';
import { accountCasesFailed, cleanCases, mergeAccountCases } from '../src/domain/accountCases.js';
import { domainParts } from '../src/domain/parts.js';
import { featureById } from '../src/features/registry.js';
import { accessDeniedError, fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { IDS, domainTables, sid } from './domain-fixtures.js';

const CASE = 'sn_customerservice_case';
const ctx = (deps) => ({ deps, checkRecord, checkPack });
const run = (args, tables = domainTables(), behaviour, wrap) => {
  const fake = fakeDeps(tables, behaviour);
  const deps = wrap ? wrap(fake) : fake;
  return domainOps.accountCases(args, ctx(deps)).then((answer) => ({ answer, fake }));
};
const args = { table: CASE, sysId: IDS.case };

// ---- Registration and argument checks ---------------------------------------------------------------------------------------

test('accountCases is registered with the read operations the content script can run', () => {
  assert.equal(typeof OPS.accountCases, 'function');
  assert.equal(OPS.accountCases, domainOps.accountCases);
  assert.equal(ACCOUNT_CASES_MAX, 10);
});

test('arguments are checked: a table name and a 32-character sys_id, a case table, nothing else', async () => {
  const deps = fakeDeps(domainTables());
  for (const bad of [undefined, {}, { table: CASE }, { sysId: IDS.case }, { table: 'Bad Table', sysId: IDS.case }, { table: CASE, sysId: 'xyz' }, { table: CASE, sysId: `${IDS.case}^ORactive=true` }, { table: `${CASE}^x`, sysId: IDS.case }]) {
    await assert.rejects(() => domainOps.accountCases(bad || {}, ctx(deps)), /not a valid record/, JSON.stringify(bad));
  }
  await assert.rejects(() => domainOps.accountCases({ table: 'incident', sysId: IDS.case }, ctx(deps)), /customer service cases/);
  await assert.rejects(() => domainOps.accountCases({ table: 'sn_hr_core_case', sysId: IDS.case }, ctx(deps)), /customer service cases/);
  assert.equal(deps.calls.length, 0, 'nothing was read for a refused request');
});

test('a sys_id in capitals is accepted and read in lower case', async () => {
  const { answer, fake } = await run({ table: CASE, sysId: IDS.case.toUpperCase() });
  assert.equal(answer.cases.length, 10);
  assert.ok(fake.calls.every((c) => !c.query.includes(IDS.case.toUpperCase())));
  assert.ok(fake.calls.some((c) => c.query.includes(IDS.case)));
});

// ---- What comes back -----------------------------------------------------------------------------------------------------------

test('at most 10 other cases of the same account: open ones first, then the newest; never this case or another account\'s', async () => {
  const { answer } = await run(args);
  assert.equal(answer.cases.length, 10);
  assert.equal(answer.more, 2);
  const numbers = answer.cases.map((c) => c.number);
  assert.ok(!numbers.includes('CS0002001'), 'not the case itself');
  assert.ok(!numbers.includes('CS0009999'), 'not another account\'s case');
  // open (active) first, then closed, newest first inside each group
  assert.deepEqual(numbers.slice(0, 8), ['CS0001911', 'CS0001910', 'CS0001908', 'CS0001907', 'CS0001905', 'CS0001904', 'CS0001902', 'CS0001901']);
  assert.deepEqual(numbers.slice(8), ['CS0001912', 'CS0001909']);
  assert.equal(answer.access.length, 1);
  assert.equal(answer.access[0].status, 'ok');
  assert.match(answer.access[0].note, /2 more cases exist/);
});

test('each case has exactly number, short_description, state, priority, opened_at, resolved_at and the names of its people (for masking)', async () => {
  const { answer } = await run(args);
  for (const c of answer.cases) assert.deepEqual(Object.keys(c), ['number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'people']);
  const open = answer.cases[0];
  assert.equal(open.state, 'Open');
  assert.equal(open.resolved_at, '');
  const closed = answer.cases[8];
  assert.equal(closed.state, 'Closed Complete');
  assert.equal(closed.resolved_at, '2026-10-14 09:00:00');
});

test('the reads are GET-only through the deps: the case, then its account\'s cases (limit 11), then a count', async () => {
  const { fake } = await run(args);
  assert.ok(fake.calls.every((c) => c.table === CASE && c.fn === 'queryTable'));
  assert.equal(fake.calls.length, 3);
  const [own, others, count] = fake.calls;
  assert.equal(own.query, `sys_id=${IDS.case}`);
  assert.deepEqual(own.fields, ['account']);
  assert.equal(others.query, `account=${IDS.account}^sys_id!=${IDS.case}^ORDERBYDESCactive^ORDERBYDESCopened_at`);
  assert.equal(others.options.limit, 11);
  assert.equal(others.options.displayValue, true);
  // contact, consumer and assigned_to are read for their display names only: the people on another case are masked by name.
  assert.deepEqual(others.fields, ['sys_id', 'number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'account', 'contact', 'consumer', 'assigned_to']);
  assert.deepEqual(count.fields, ['sys_id'], 'the count asks for no data');
});

test('10 or fewer: no count is made and `more` is 0', async () => {
  const { answer, fake } = await run(args, domainTables({ cases: { others: 4 } }));
  assert.equal(answer.cases.length, 4);
  assert.equal(answer.more, 0);
  assert.equal(fake.calls.length, 2);
  assert.equal(answer.access[0].note, '');
});

test('exactly 10 others: all shown, nothing more', async () => {
  const { answer } = await run(args, domainTables({ cases: { others: 10 } }));
  assert.equal(answer.cases.length, 10);
  assert.equal(answer.more, 0);
});

test('if the count cannot be read, `more` is null: "more exist" without a made-up number', async () => {
  const wrap = (fake) => ({ ...fake, countRecords: async () => { throw accessDeniedError('stats'); } });
  const { answer } = await run(args, domainTables(), undefined, wrap);
  assert.equal(answer.more, null);
  assert.match(answer.access[0].note, /More cases exist/);
});

test('columns the instance returns beyond the ones asked for never get through', async () => {
  const { answer } = await run(args, domainTables(), { leaky: true });
  assert.ok(!JSON.stringify(answer).includes('LEAK'));
  for (const c of answer.cases) assert.deepEqual(Object.keys(c), ['number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'people']);
});

// ---- Access ---------------------------------------------------------------------------------------------------------------------

test('a case without an account is skipped with a reason', async () => {
  const tables = domainTables();
  tables.sn_customerservice_case[0].account = v('', '');
  const { answer, fake } = await run(args, tables);
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'skipped');
  assert.match(answer.access[0].note, /no account/);
  assert.equal(fake.calls.length, 1);
});

test('an account value that is not a sys_id is never put into a query', async () => {
  const tables = domainTables();
  tables.sn_customerservice_case[0].account = v('x^ORactive=true', 'Evil');
  const { answer, fake } = await run(args, tables);
  assert.equal(answer.access[0].status, 'skipped');
  assert.ok(fake.calls.every((c) => !c.query.includes('ORactive')));
});

test('a refused read (403) is reported as denied, never as "no other cases"', async () => {
  const { answer } = await run(args, domainTables(), { denied: [CASE] });
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'denied');
});

test('the others query refused while the case itself reads: denied, not empty', async () => {
  const wrap = (fake) => ({
    ...fake,
    queryTable: async (table, query, fields, options) => {
      if (query.startsWith('account=')) throw accessDeniedError(table);
      return fake.queryTable(table, query, fields, options);
    },
  });
  const { answer } = await run(args, domainTables(), undefined, wrap);
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'denied');
});

test('HTTP 200 with no rows is "none that your user can see" (they can see the case itself), with an empty list', async () => {
  const tables = domainTables({ cases: { others: 0 } });
  tables.sn_customerservice_case = tables.sn_customerservice_case.filter((r) => r.sys_id.value === IDS.case);
  const { answer } = await run(args, tables);
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'empty');
  assert.match(answer.access[0].note, /that you can see/);
  assert.doesNotMatch(answer.access[0].note, /your user/i);
});

test('an instance that ignores the account condition returns everybody\'s cases: none is used', async () => {
  const tables = domainTables();
  // the others query asks for `account`; make every other row come back with a different account
  tables.sn_customerservice_case.forEach((r, i) => { if (i > 0) r.account = v(IDS.otherAccount, 'Initech'); });
  const wrap = (fake) => ({
    ...fake,
    queryTable: async (table, query, fields, options) => (query.startsWith('account=') ? fake.queryTable(table, '', fields, options) : fake.queryTable(table, query, fields, options)),
  });
  const { answer } = await run(args, tables, undefined, wrap);
  assert.deepEqual(answer.cases, []);
  assert.equal(answer.access[0].status, 'error');
  assert.match(answer.access[0].note, /did not narrow the results as asked/);
});

test('a lost session stops the read instead of looking like an empty account', async () => {
  await assert.rejects(() => run(args, domainTables(), { expired: [CASE] }), (e) => e.code === 'SESSION_EXPIRED');
});

test('readAccountCases can be called directly with deps and a validated record', async () => {
  const deps = fakeDeps(domainTables());
  const answer = await readAccountCases({ table: CASE, sysId: IDS.case }, deps);
  assert.equal(answer.cases.length, 10);
});

// ---- Putting the answer on the pack (untrusted data) -------------------------------------------------------------------------

const BASE_PACK = Object.freeze({ table: CASE, sysId: IDS.case, related: Object.freeze({ slas: [] }), access: Object.freeze([{ source: 'journal', status: 'ok', note: '' }]) });

test('mergeAccountCases adds the list, the "more" count and the access entries to a new pack', async () => {
  const { answer } = await run(args);
  const merged = mergeAccountCases(BASE_PACK, answer);
  assert.notEqual(merged, BASE_PACK);
  assert.equal(merged.related.accountCases.length, 10);
  assert.deepEqual(merged.related.accountCasesSummary, { more: 2 });
  assert.deepEqual(merged.related.slas, []);
  assert.equal(merged.access.length, 2);
  assert.equal(BASE_PACK.access.length, 1, 'the original pack is untouched');
});

test('an empty confirmed answer is an empty list; an unconfirmed one is no list at all', () => {
  const none = mergeAccountCases(BASE_PACK, { cases: [], more: 0, access: [{ source: CASE, status: 'empty', note: 'x' }] });
  assert.deepEqual(none.related.accountCases, []);
  assert.ok(!('accountCasesSummary' in none.related));
  const denied = mergeAccountCases(BASE_PACK, { cases: [], more: 0, access: [{ source: CASE, status: 'denied', note: 'x' }] });
  assert.ok(!('accountCases' in denied.related));
  const skipped = mergeAccountCases(BASE_PACK, { cases: [], more: 0, access: [{ source: CASE, status: 'skipped', note: 'x' }] });
  assert.ok(!('accountCases' in skipped.related));
});

test('the answer is untrusted: shapes, lengths, counts and statuses are forced into the expected form', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    number: `CS${i}`,
    short_description: `<img src=x onerror=alert(1)>${'x'.repeat(1000)}`,
    state: { toString: () => 'obj' },
    priority: 7,
    opened_at: ['a'],
    resolved_at: null,
    u_secret: 'LEAK',
  }));
  const merged = mergeAccountCases(BASE_PACK, {
    cases: [null, 'text', 5, [], ...rows],
    more: 'lots',
    access: [{ source: CASE, status: 'totally-ok', note: `<b>${'n'.repeat(1000)}</b>` }, 'junk', { source: CASE, status: 'ok', note: '' }, null, {}, {}, {}],
  });
  assert.equal(merged.related.accountCases.length, 10);
  const first = merged.related.accountCases[0];
  assert.deepEqual(Object.keys(first), ['number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at']);
  assert.ok(first.short_description.length <= 300);
  assert.ok(!first.short_description.includes('<'));
  assert.equal(first.state, '');
  assert.equal(first.priority, '7');
  assert.equal(first.opened_at, '');
  assert.ok(!JSON.stringify(merged).includes('LEAK'));
  assert.ok(!('accountCasesSummary' in merged.related), 'a count that is not a number is dropped');
  assert.ok(merged.access.length <= BASE_PACK.access.length + 4);
  assert.ok(merged.access.every((a) => ['ok', 'empty', 'empty-or-hidden', 'denied', 'error', 'skipped'].includes(a.status)));
  assert.ok(merged.access.every((a) => a.note.length <= 240 && !a.note.includes('<')));
});

test('garbage instead of an answer changes nothing but the access list', () => {
  for (const answer of [undefined, null, 'text', 5, [], {}, { cases: 'x' }]) {
    const merged = mergeAccountCases(BASE_PACK, answer);
    assert.ok(!('accountCases' in merged.related));
    assert.deepEqual(merged.access, BASE_PACK.access);
  }
  assert.deepEqual(cleanCases('nope'), []);
});

test('accountCasesFailed records a fixed message, not the error text', () => {
  const failed = accountCasesFailed(BASE_PACK);
  assert.equal(failed.access.at(-1).status, 'error');
  assert.ok(!('accountCases' in failed.related));
});

// ---- The feature\'s enrich hook, end to end --------------------------------------------------------------------------------

async function enriched(readImpl, tables = domainTables()) {
  const deps = fakeDeps(tables);
  const pack = await readContextPack({ table: CASE, sysId: IDS.case }, deps, { feature: 'account-briefing' });
  const feature = featureById('account-briefing');
  const out = await feature.enrich(pack, { read: readImpl(deps), allowSensitive: false });
  return { pack, out, deps };
}

test('enrich asks the read operation for this case and puts the answer on the pack', async () => {
  const asked = [];
  const { pack, out } = await enriched((deps) => async (op, a) => {
    asked.push([op, a]);
    return OPS[op](a, ctx(deps));
  });
  assert.deepEqual(asked, [['accountCases', { table: CASE, sysId: IDS.case }]]);
  assert.equal(out.related.accountCases.length, 10);
  assert.equal(pack.related.accountCases, undefined, 'enrich does not change the pack it was given');
  const text = domainParts(out, { related: ['accountCases'] }).find((p) => p.field === 'account_cases').text;
  assert.match(text, /^- CS0001911: Earlier gateway ticket 11 \(Open, priority 3 - Moderate, opened 2026-10-12 09:00:00, not resolved\)/);
  assert.match(text, /2 more cases exist for this account and are not shown\.$/);
});

test('if the read fails the briefing still works and says the account\'s cases were not available', async () => {
  const { out } = await enriched(() => async () => { throw new Error('The page did not answer: user@example.com'); });
  assert.ok(!('accountCases' in out.related));
  assert.ok(!JSON.stringify(out.access).includes('user@example.com'), 'the error text is not copied');
  const parts = domainParts(out, { related: ['accountCases'] });
  assert.match(parts.find((p) => p.field === 'data_not_available').text, /Customer service cases: could not be read/);
});

test('a lost session is not swallowed by enrich', async () => {
  await assert.rejects(
    () => enriched(() => async () => { throw Object.assign(new Error('Your ServiceNow session has expired.'), { code: 'SESSION_EXPIRED' }); }),
    (e) => e.code === 'SESSION_EXPIRED'
  );
});

test('an account with no other case the user can see says so, as a fact', async () => {
  const tables = domainTables({ cases: { others: 0 } });
  tables.sn_customerservice_case = tables.sn_customerservice_case.filter((r) => r.sys_id.value === IDS.case);
  const { out } = await enriched((deps) => async (op, a) => OPS[op](a, ctx(deps)), tables);
  const text = domainParts(out, { related: ['accountCases'] }).find((p) => p.field === 'account_cases').text;
  assert.equal(text, 'No other cases that your user can see for this account.');
});

test('sid helper makes 32-character ids', () => {
  assert.equal(sid('ca5e').length, 32);
});
