import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/content/ops/index.js';
import insightOps, { readFieldHistory, readKnownErrors, readSlaTimes, readVip } from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { readChangesOnTarget } from '../src/context/related.js';
import { FEATURES, FEATURE_FIELDS, FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';
import { CASE_ID } from './fixtures/sn-case.js';
import { HR_CASE_ID } from './fixtures/sn-hr-case.js';
import { ABEL } from './fixtures/sn-users.js';
import { INCIDENT_META, withMeta } from './live-fixtures.js';

// The Insights reads (src/content/ops/insights.js) against the fake instance: GET only, arguments checked, a refusal or an empty answer
// from a table the user may not see reported honestly, the CI and service read from the record itself.

const CI = '0c1d2e3f4a5b4c6d8e7f9a0b1c2d3e4f';
const SERVICE = '1d2e3f4a5b6c4d7e8f9a0b1c2d3e4f50';
const NETWORK = 'd625dccec0a8016700a222a0f7900d06';
const DESK = 'aa25dccec0a8016700a222a0f7900d06';
const id = (prefix, n) => `${prefix}${String(n).padStart(32 - prefix.length, '0')}`;
const utc = (h) => new Date(NOW - h * 3600000).toISOString().slice(0, 19).replace('T', ' ');

function tables() {
  const t = buildInstance();
  t.sys_user = t.sys_user.map((u) => (u.sys_id === ABEL.sysId ? { ...u, vip: 'true' } : { ...u, vip: 'false' }));
  t.sys_user_group = [
    { sys_id: NETWORK, name: 'Network Support' },
    { sys_id: DESK, name: 'Service Desk' },
  ];
  t.sys_audit = [
    { sys_id: 'au1', tablename: 'incident', documentkey: INCIDENT_ID, fieldname: 'assignment_group', oldvalue: '', newvalue: DESK, sys_created_on: utc(4) },
    { sys_id: 'au2', tablename: 'incident', documentkey: INCIDENT_ID, fieldname: 'assignment_group', oldvalue: DESK, newvalue: NETWORK, sys_created_on: utc(3) },
    { sys_id: 'au3', tablename: 'incident', documentkey: INCIDENT_ID, fieldname: 'state', oldvalue: '1', newvalue: '2', sys_created_on: utc(3) },
    { sys_id: 'au4', tablename: 'incident', documentkey: 'ffffffffffffffffffffffffffffffff', fieldname: 'state', oldvalue: '1', newvalue: '7', sys_created_on: utc(2) },
  ];
  const change = (n, { start, end, ci = CI, service = '', number = `CHG00300${n}` }) => ({
    sys_id: v(id('c0', n)),
    number: v(number),
    short_description: v(`Change ${n}`),
    state: v('3', 'Implement'),
    type: v('normal', 'Normal'),
    risk: v('3', 'Moderate'),
    start_date: v(start, start),
    end_date: v(end, end),
    cmdb_ci: ci ? v(ci, 'VPN Gateway EU') : v(''),
    business_service: service ? v(service, 'Remote Access') : v(''),
    requested_by: v('', ''),
    assigned_to: v('', ''),
  });
  t.change_request = [
    change(1, { start: utc(30), end: utc(28) }), // ended about a day ago, on the CI
    change(2, { start: utc(1), end: utc(-1), ci: '', service: SERVICE }), // running now, on the service
    change(3, { start: utc(24 * 20), end: utc(24 * 19) }), // too old
    change(4, { start: utc(2), end: utc(1), ci: 'b'.repeat(32) }), // another CI
  ];
  const problem = (n, { known = false, active = true, workaround = '', ci = CI, number = `PRB00400${n}` }) => ({
    sys_id: v(id('b0', n)),
    number: v(number),
    short_description: v(`Problem ${n}`),
    state: v(active ? '2' : '7', active ? 'Assess' : 'Closed'),
    active: v(String(active), String(active)),
    priority: v('3', '3 - Moderate'),
    known_error: v(String(known), String(known)),
    workaround: v(workaround),
    sys_updated_on: v(utc(n), utc(n)),
    cmdb_ci: ci ? v(ci, 'VPN Gateway EU') : v(''),
    business_service: v(''),
  });
  t.problem = [
    problem(1, { known: true, active: false, workaround: 'Switch the client to TCP mode.' }), // closed but a known error: kept
    problem(2, {}), // open, no workaround
    problem(3, { active: false }), // closed and not a known error: not wanted
    problem(4, { ci: 'c'.repeat(32) }), // another CI
  ];
  return t;
}

const ctx = (deps, extra = {}) => ({ deps, checkRecord, checkPack, ...extra });
const withClock = (fake) => Object.assign(fake, { now: () => NOW });
const incident = { table: 'incident', sysId: INCIDENT_ID };

test('the Insights reads are registered with the content script and refuse anything that is not a plain table and sys_id', async () => {
  for (const op of ['glance', 'lookalikes', 'journey', 'ciChanges', 'knownErrors']) {
    assert.equal(OPS[op], insightOps[op], op);
  }
  const deps = withClock(fakeDeps(tables()));
  for (const op of ['glance', 'journey', 'ciChanges', 'knownErrors']) {
    for (const bad of [{}, { table: 'incident' }, { table: 'Incident', sysId: INCIDENT_ID }, { table: 'incident', sysId: `${INCIDENT_ID}^ORactive=true` }, { table: 'incident^x', sysId: INCIDENT_ID }]) {
      await assert.rejects(() => insightOps[op](bad, ctx(deps)), /not a valid record/, `${op} ${JSON.stringify(bad)}`);
    }
  }
  await assert.rejects(() => insightOps.lookalikes({ pack: null }, ctx(deps)), /ticket is needed/);
  assert.equal(deps.calls.length, 0, 'nothing was read for a refused request');
});

test('the insights-ticket spec stays inside every ceiling and reads the counters it gives a reason for', () => {
  assert.ok(FEATURES.includes('insights-ticket'));
  for (const kind of Object.keys(FIELDS_BY_KIND)) for (const name of FEATURE_FIELDS['insights-ticket'][kind]) assert.ok(FIELDS_BY_KIND[kind].includes(name), `${kind}: ${name}`);
  assert.ok(FEATURE_FIELDS['insights-ticket'].incident.includes('reassignment_count'));
  assert.ok(FEATURE_FIELDS['insights-ticket'].case.includes('reassignment_count'));
  assert.ok(FEATURE_FIELDS['insights-ticket'].case.includes('entitlement'));
  assert.ok(!FEATURE_FIELDS['insights-ticket'].incident.includes('close_notes'), 'no column without a reason');
});

test('glance: the ticket pack, the SLAs with their stored end time, the caller VIP flag and the open tickets on the same item, all GET', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await insightOps.glance(incident, ctx(deps));
  assert.equal(answer.pack.number, 'INC0010001');
  assert.equal(answer.pack.fields.assigned_to, 'Beth Anglin');
  assert.ok(answer.pack.journal.length >= 2, 'the notes are read (customer waiting, risk words)');
  assert.ok(answer.pack.related.times.sys_updated_on, 'stored update time');
  assert.equal(answer.slas.items.length, 2);
  const running = answer.slas.items.find((s) => s.stageValue === 'in_progress');
  assert.equal(running.plannedEndUtc, '2026-10-26 17:55:12', 'the STORED end, not the display value');
  assert.equal(running.breached, false);
  assert.equal(answer.vip.status, 'yes');
  assert.deepEqual(answer.outage.hits.map((h) => h.number).sort(), ['INC0010002', 'INC0010004']);
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'), 'reads only');
});

test('glance: a VIP flag that cannot be read is unknown (never "not a VIP"), and SLAs the user cannot see are said, not empty', async () => {
  const deps = withClock(fakeDeps(tables(), { denied: ['sys_user'], hidden: ['task_sla'] }));
  const answer = await insightOps.glance(incident, ctx(deps));
  assert.equal(answer.vip.status, 'unknown');
  assert.equal(answer.slas.items.length, 0);
  assert.equal(answer.slas.access[0].status, 'empty-or-hidden');
  // a user row whose vip column is hidden by a field rule
  const t = tables();
  t.sys_user = t.sys_user.map(({ vip, ...rest }) => rest);
  assert.equal((await readVip(answer.pack, fakeDeps(t))).status, 'unknown');
});

test('readSlaTimes: rows of another task (the filter ignored) are never used', async () => {
  const t = tables();
  t.task_sla.push({ ...t.task_sla[0], task: v('f'.repeat(32), 'INC9') });
  const deps = fakeDeps(t, { ignoreUnknownColumns: true });
  const wrong = await readSlaTimes({ sysId: INCIDENT_ID }, { queryTable: async () => t.task_sla.map((r) => ({ ...r })) });
  assert.equal(wrong.items.length, 0);
  assert.equal(wrong.access[0].status, 'error');
  const right = await readSlaTimes({ sysId: INCIDENT_ID }, deps);
  assert.equal(right.items.length, 2);
});

test('glance on an HR case without sensitive data allowed: minimised, no VIP lookup, no outage search', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await insightOps.glance({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, ctx(deps));
  assert.equal(answer.vip.status, 'unknown');
  assert.equal(answer.outage.hits.length, 0);
  assert.equal(answer.outage.access[0].status, 'skipped');
  assert.equal(answer.pack.journal.length, 0);
  assert.equal(deps.callsTo('sys_user').filter((c) => c.fields.includes('vip')).length, 0);
});

test('lookalikes: solved look-alikes with their group, subcategory and priority in ONE read', async () => {
  const deps = fakeDeps(tables());
  const pack = { table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting', category: 'Network', cmdb_ci: 'VPN Gateway EU' }, people: [{ name: 'Abel Tuter' }] };
  const answer = await insightOps.lookalikes({ pack }, ctx(deps));
  assert.ok(answer.hits.length >= 2);
  assert.ok(answer.hits.every((h) => h.close_notes), 'solved ones only');
  assert.ok(answer.hits.every((h) => 'assignment_group' in h && 'priority' in h));
  assert.equal(answer.hits.find((h) => h.number === 'INC0009640').assignment_group, 'Network Support');
  assert.equal(deps.callsTo('incident').length, 1, 'one read');
  assert.ok(deps.callsTo('incident')[0].fields.includes('assignment_group'));
});

test('journey: group, state and priority changes from the field history, with names instead of ids; other records ignored', async () => {
  // (the words of the states come from the UI meta service: a plain agent cannot read the choice table, docs/live-checks-2026-11-07.md)
  const deps = withMeta(fakeDeps(tables()), { incident: INCIDENT_META });
  const answer = await insightOps.journey(incident, ctx(deps));
  assert.equal(answer.available, true);
  assert.deepEqual(
    answer.changes.map((c) => [c.field, c.from, c.to]),
    [
      ['assignment_group', '', 'Service Desk'],
      ['assignment_group', 'Service Desk', 'Network Support'],
      ['state', 'New', 'In Progress'],
    ]
  );
  const audit = deps.callsTo('sys_audit')[0];
  assert.match(audit.query, new RegExp(`^tablename=incident\\^documentkey=${INCIDENT_ID}\\^fieldnameINassignment_group,state,priority`));
  assert.ok(!JSON.stringify(answer).match(/[0-9a-f]{32}/), 'no sys_id reaches the panel');
});

test('journey: field history the user may not read is said plainly; HR records are not looked at; a group they cannot see is named so', async () => {
  const denied = await insightOps.journey(incident, ctx(fakeDeps(tables(), { denied: ['sys_audit'] })));
  assert.equal(denied.available, false);
  assert.match(denied.note, /history of this ticket is not available to you/);
  assert.doesNotMatch(denied.note, /your user|field history/i);
  const hidden = await insightOps.journey(incident, ctx(fakeDeps(tables(), { hidden: ['sys_audit'] })));
  assert.equal(hidden.available, false, 'zero rows from a table the user sees nothing of proves nothing');
  const hr = fakeDeps(tables());
  const skipped = await insightOps.journey({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, ctx(hr));
  assert.equal(skipped.available, false);
  assert.equal(hr.calls.length, 0);
  const noGroups = await readFieldHistory(incident, withMeta(fakeDeps(tables(), { denied: ['sys_user_group'] }), { incident: INCIDENT_META }, { denied: ['incident'] }));
  // (the name of a group the user cannot see is the panel's to say, in its own language: the read marks it, audit of 2026-11-07, I7)
  assert.deepEqual(noGroups.changes.map((c) => c.to), ['', '', 'In Progress']);
  assert.deepEqual(noGroups.changes.map((c) => Boolean(c.toUnlabelled)), [true, true, false]);
  // the instance ignoring the record condition: nothing of it is used
  const leaky = await readFieldHistory(incident, { queryTable: async () => tables().sys_audit.map((r) => ({ ...r })) });
  assert.equal(leaky.available, false);
});

test('ciChanges: changes on the CI or the service in the last 7 days or the next 3, by id, each checked again', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await insightOps.ciChanges(incident, ctx(deps));
  assert.deepEqual(answer.items.map((c) => c.number).sort(), ['CHG003001', 'CHG003002']);
  assert.deepEqual(answer.keys, ['cmdb_ci', 'business_service']);
  assert.equal(answer.items.find((c) => c.number === 'CHG003002').same[0], 'business_service');
  assert.ok(answer.items.every((c) => c.startUtc && c.endUtc));
  const queries = deps.callsTo('change_request').map((c) => c.query);
  assert.ok(queries[0].startsWith(`cmdb_ci=${CI}^`) && queries[1].startsWith(`business_service=${SERVICE}^`), queries.join(' | '));
  // nothing found, and the user sees no changes at all: not "none"
  const t = tables();
  t.change_request = [];
  const empty = await readChangesOnTarget(incident, withClock(fakeDeps(t)));
  assert.equal(empty.access[0].status, 'empty-or-hidden');
  const denied = await readChangesOnTarget(incident, withClock(fakeDeps(tables(), { denied: ['change_request'] })));
  assert.equal(denied.access[0].status, 'denied');
  // a request has neither column
  const req = await insightOps.ciChanges({ table: 'sc_req_item', sysId: 'e3f4a5b6c7d84e9fa0b1c2d3e4f5a6b7' }, ctx(withClock(fakeDeps(tables()))));
  assert.equal(req.access[0].status, 'skipped');
});

test('knownErrors: open problems and known errors on the same item (a closed known error too), never another CI', async () => {
  const deps = fakeDeps(tables());
  const answer = await insightOps.knownErrors(incident, ctx(deps));
  assert.deepEqual(answer.items.map((p) => p.number).sort(), ['PRB004001', 'PRB004002']);
  const known = answer.items.find((p) => p.number === 'PRB004001');
  assert.equal(known.knownError, true);
  assert.equal(known.workaround, 'Switch the client to TCP mode.');
  const denied = await readKnownErrors(incident, fakeDeps(tables(), { denied: ['problem'] }));
  assert.equal(denied.access[0].status, 'denied');
  const t = tables();
  t.problem = [];
  const none = await readKnownErrors(incident, fakeDeps(t));
  assert.equal(none.access[0].status, 'empty-or-hidden', 'zero rows of a table with no visible rows is not "none"');
  const caseAnswer = await insightOps.knownErrors({ table: 'sn_customerservice_case', sysId: CASE_ID }, ctx(fakeDeps(tables())));
  assert.ok(['ok', 'empty', 'empty-or-hidden', 'skipped'].includes(caseAnswer.access[0].status));
});

test('policy: a table the organisation blocks is not read and is reported as blocked, not as empty', async () => {
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['sys_audit', 'problem', 'change_request'] } }) });
  const fake = withClock(fakeDeps(tables()));
  const deps = await guard.deps(fake);
  const journey = await insightOps.journey(incident, ctx(deps));
  assert.equal(journey.available, false);
  assert.equal(journey.access[0].status, 'blocked');
  const problems = await insightOps.knownErrors(incident, ctx(deps));
  assert.equal(problems.access[0].status, 'blocked');
  const changes = await insightOps.ciChanges(incident, ctx(deps));
  assert.equal(changes.access[0].status, 'blocked');
  assert.equal(fake.callsTo('sys_audit').length + fake.callsTo('problem').length + fake.callsTo('change_request').length, 0);
});
