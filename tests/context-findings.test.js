// Wrong results found while walking the deterministic tools, each pinned here: the duplicate finder matched configuration
// items by NAME, the knowledge-use log was read through a column nobody could confirm, and a customer's (consumer's) earlier
// cases were reported as "none".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readContextPack } from '../src/context/pack.js';
import { findOpenDuplicates } from '../src/context/similar.js';
import { readCallerHistory } from '../src/context/history.js';
import { LINK_SOURCES, readArticleLinks } from '../src/context/knowledge.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

const incidentPack = async (tables = buildInstance()) => readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(tables), { feature: 'similar' });
const CI_VPN_EU = '0c1d2e3f4a5b4c6d8e7f9a0b1c2d3e4f';
const SERVICE_REMOTE = '1d2e3f4a5b6c4d7e8f9a0b1c2d3e4f50';

// ---- Open duplicates: by id, not by name -------------------------------------------------------------------------------

test('duplicates: a ticket on ANOTHER configuration item that has the same name is not "on the same CI"', async () => {
  const pack = await incidentPack();
  const tables = buildInstance();
  // INC0010002 sits on a different CI that happens to share the name (CMDBs have many of these).
  const twin = v('9'.repeat(32), 'VPN Gateway EU');
  tables.incident = tables.incident.map((row) => (row.number.value === 'INC0010002' ? { ...row, cmdb_ci: twin } : row));
  const { hits } = await findOpenDuplicates(pack, fakeDeps(tables), { now: NOW });
  const twinHit = hits.find((h) => h.number === 'INC0010002');
  assert.ok(twinHit, 'still found: it is on the same business service');
  assert.deepEqual(twinHit.same, ['business_service'], 'but not as "same CI"');
});

test('duplicates: every condition is a sys_id read from the record itself, never a display name', async () => {
  const pack = await incidentPack();
  const deps = fakeDeps(buildInstance());
  await findOpenDuplicates(pack, deps, { now: NOW });
  const queries = deps.callsTo('incident').map((c) => c.query);
  assert.ok(queries.includes(`cmdb_ci=${CI_VPN_EU}^active=true^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`), queries.join('\n'));
  assert.ok(queries.includes(`business_service=${SERVICE_REMOTE}^active=true^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`));
  for (const q of queries) assert.ok(!/\.name=|VPN Gateway|Remote Access/.test(q), `no name in ${q}`);
  // The ids come from the stored values of the record (not from the panel's pack, whose fields are display names).
  const own = deps.callsTo('incident')[0];
  assert.equal(own.query, `sys_id=${INCIDENT_ID}`);
  assert.deepEqual(own.fields, ['sys_id', 'cmdb_ci', 'business_service']);
  assert.equal(own.options.displayValue, false);
});

test('duplicates: a CI whose display value is not its name is still compared', async () => {
  const pack = await incidentPack();
  const tables = buildInstance();
  // The panel's pack says the CI is called something else (a display column other than name, a renamed CI...).
  const renamed = { ...pack, fields: { ...pack.fields, cmdb_ci: 'gw-eu-01 (Linux Server)' } };
  const { hits } = await findOpenDuplicates(renamed, fakeDeps(tables), { now: NOW });
  assert.ok(hits.some((h) => h.number === 'INC0010002' && h.same.includes('cmdb_ci')));
});

test('duplicates: the window is kept between 1 hour and 7 days, whatever the panel sends', async () => {
  const pack = await incidentPack();
  for (const [asked, kept] of [[-5, 1], [0.01, 1], [100000, 168], [Number.NaN, 24], ['48', 48], [undefined, 24]]) {
    const { windowHours } = await findOpenDuplicates(pack, fakeDeps(buildInstance()), { now: NOW, windowHours: asked });
    assert.equal(windowHours, kept, `asked ${asked}`);
  }
});

test('duplicates: a stored value that is not a sys_id never reaches a query', async () => {
  for (const stored of ['javascript:gs.getUserID()', 'a^b', 'VPN Gateway EU', '']) {
    const deps = fakeDeps({ incident: [{ sys_id: v(INCIDENT_ID), number: v('INC1'), cmdb_ci: v(stored, 'x'), business_service: v('', ''), opened_at: v('2026-10-26 08:00:00') }] });
    const { hits, access } = await findOpenDuplicates({ table: 'incident', sysId: INCIDENT_ID, fields: { cmdb_ci: 'x' } }, deps, { now: NOW });
    assert.deepEqual(hits, []);
    assert.equal(access[0].status, 'skipped', JSON.stringify(stored));
    assert.deepEqual(deps.calls.map((c) => c.query), [`sys_id=${INCIDENT_ID}`], 'only the record itself was read');
  }
});

test('duplicates: a kind whose ceiling has no CI or service is not searched at all', async () => {
  const deps = fakeDeps({ sc_request: [] });
  const { access } = await findOpenDuplicates({ table: 'sc_request', sysId: INCIDENT_ID, fields: {} }, deps, { now: NOW });
  assert.equal(access[0].status, 'skipped');
  assert.equal(deps.calls.length, 0);
});

// ---- kb_use: which column points at the ticket ----------------------------------------------------------------------------
// Nobody could confirm on a real instance whether kb_use points at the ticket through `task_id` or `task`
// (docs/live-questions/knowledge.md, question 21). Reading the wrong one made every link through kb_use invisible.

const TICKET_A = 'a'.repeat(31) + '1';
const TICKET_B = 'a'.repeat(31) + '2';

test('kb_use: a link kept in a `task` column is found (not only `task_id`)', async () => {
  const deps = fakeDeps({
    m2m_kb_task: [{ sys_id: v('1'.repeat(32)), task: v('e'.repeat(32)) }],
    kb_use: [{ sys_id: v('2'.repeat(32)), task: v(TICKET_B), article: v('3'.repeat(32)) }],
  });
  const out = await readArticleLinks([TICKET_A, TICKET_B], deps, {});
  assert.equal(out.known, true);
  assert.deepEqual([...out.linked], [TICKET_B]);
  assert.deepEqual(out.sources.map((s) => [s.table, s.usable]), [['m2m_kb_task', true], ['kb_use', true]]);
  assert.ok(deps.callsTo('kb_use').some((c) => c.query === `taskIN${TICKET_A},${TICKET_B}`));
});

test('kb_use: the column is found with one unfiltered one-row read of both names, never by reading unrelated rows', async () => {
  const deps = fakeDeps({ m2m_kb_task: [], kb_use: [{ sys_id: v('2'.repeat(32)), task_id: v(TICKET_A) }, { sys_id: v('4'.repeat(32)), task_id: v('f'.repeat(32)) }] });
  const out = await readArticleLinks([TICKET_A], deps, {});
  assert.deepEqual([...out.linked], [TICKET_A]);
  const calls = deps.callsTo('kb_use');
  assert.equal(calls.length, 2, 'the probe, then the read by the column that exists');
  assert.deepEqual([calls[0].query, calls[0].fields, calls[0].options.limit], ['', ['sys_id', ...LINK_SOURCES[1].columns], 1]);
  assert.equal(calls[1].query, `task_idIN${TICKET_A}`);
  // The probe answers "can this user see any row?" too: no second unfiltered read when nothing is linked.
  const none = fakeDeps({ m2m_kb_task: [], kb_use: [{ sys_id: v('4'.repeat(32)), task: v('f'.repeat(32)) }] });
  const empty = await readArticleLinks([TICKET_A], none, {});
  assert.equal(empty.sources[1].usable, true, 'visible table, no link for this ticket: a fact');
  assert.equal(none.callsTo('kb_use').filter((c) => c.query === '').length, 1);
});

test('kb_use: a table with neither column is not used, and the reason says so', async () => {
  const deps = fakeDeps({ m2m_kb_task: [], kb_use: [{ sys_id: v('2'.repeat(32)), article: v('3'.repeat(32)) }] });
  const out = await readArticleLinks([TICKET_A], deps, {});
  assert.equal(out.sources[1].usable, false);
  assert.equal(out.sources[1].status, 'error');
  assert.match(out.sources[1].note, /stores article links differently/);
  assert.doesNotMatch(out.sources[1].note, /task_id|kb_use/);
  assert.equal(deps.callsTo('kb_use').length, 1, 'no query was built on a column the table does not have');
});

// ---- Caller history: a private customer (consumer) has cases too -----------------------------------------------------------

test('history: the earlier cases of a consumer are found, not reported as "none" (a case names a consumer, not a contact)', async () => {
  const CONSUMER = 'c0'.repeat(16);
  const tables = buildInstance();
  tables.sn_customerservice_case[0].contact = v('', '');
  tables.sn_customerservice_case[0].consumer = v(CONSUMER, 'Maria Lopez');
  const deps = fakeDeps(tables);
  const { items, access } = await readCallerHistory({ callerSysId: CONSUMER }, deps, { now: NOW });
  assert.ok(items.some((i) => i.table === 'sn_customerservice_case' && i.number === 'CS0001001'), JSON.stringify(access));
  assert.equal(access.find((a) => a.source === 'sn_customerservice_case').status, 'ok');
  // One read of the case table, by either column, and every row checked against the person again.
  const caseReads = deps.callsTo('sn_customerservice_case').filter((c) => c.query);
  assert.equal(caseReads.length, 1);
  assert.equal(caseReads[0].query, `contact=${CONSUMER}^ORconsumer=${CONSUMER}^ORDERBYDESCopened_at`);
});

test('history: a case table that ignores the person condition is not believed, whichever column the person is in', async () => {
  const tables = buildInstance();
  // Nobody on these rows is the person asked about; an instance that ignored the condition would answer with them.
  const deps = fakeDeps(tables);
  const ignoring = { ...deps, queryTable: (table, query, ...rest) => deps.queryTable(table, table === 'sn_customerservice_case' ? query.replace(/^contact=[0-9a-f]{32}\^ORconsumer=[0-9a-f]{32}\^?/, '') : query, ...rest) };
  const { items, access } = await readCallerHistory({ callerSysId: 'd'.repeat(32) }, ignoring, { now: NOW });
  assert.ok(!items.some((i) => i.table === 'sn_customerservice_case'));
  assert.equal(access.find((a) => a.source === 'sn_customerservice_case').status, 'error');
});
