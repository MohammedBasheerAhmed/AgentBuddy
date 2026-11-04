// Round 3, Team screen (N15): the engine changes behind the dashboard. The person's ServiceNow time zone with a browser fallback,
// real team groups (active, ranked by work, "25 of 41"), chosen groups checked against the instance, resolved-but-active tickets
// counted on their own, and HR / change-task tables (HR only with the HR profile and the organisation's approval).
const test = require('node:test');
const assert = require('node:assert/strict');
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { createReader } from '../src/reports/engine/reader.js';
import { createCache, createLimiter } from '../src/reports/engine/cache.js';
import { zoneOffset, chooseZone, startOfLocalDay } from '../src/reports/engine/time.js';
import { readMyTeam, pickTeamGroups, teamNote, resolveScope, checkChosenGroups } from '../src/reports/engine/scope.js';
import { stateClass, resolvedStates, notResolved, normalizeTables } from '../src/reports/engine/common.js';
import { REPORT_TABLES, STANDARD_TABLE_IDS, isSensitiveReportTable } from '../src/reports/engine/constants.js';
import { createReportOps, readUserZone } from '../src/content/ops/reports.js';
import { normalizeCoachingRequest } from '../src/reports/ai/coaching.js';
import { buildHandoverPack } from '../src/reports/ai/handover.js';
import { carriesSensitive } from '../src/reports/ai/common.js';
import { isSensitivePack, assertRunnable } from '../src/lib/pipeline.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { featureById } from '../src/features/registry.js';
import { fakeInstance, cell, group, count, USER, GROUP_A, GROUP_B, NOW } from './reports-fixtures.js';

const id = (n) => String(n).padStart(32, '0');
const reader = (inst) => createReader({ deps: inst.deps, cache: createCache({}), limiter: createLimiter(4) });
const run = (request, inst, env = {}) => runReport(request, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, ...env });
const tileOf = (result, key) => result.data.tiles.find((t) => t.key === key);
const MINE = `assigned_to=${USER}`;

// ---- The person's time zone ------------------------------------------------------------------------------------------------

test('a ServiceNow zone name becomes an offset function, summer time included; nonsense is refused', () => {
  const berlin = zoneOffset('Europe/Berlin');
  assert.equal(berlin(Date.UTC(2026, 6, 1, 12)), -120, 'summer: UTC+2');
  assert.equal(berlin(Date.UTC(2026, 11, 1, 12)), -60, 'winter: UTC+1');
  assert.equal(zoneOffset('Asia/Kolkata')(NOW), -330);
  assert.equal(zoneOffset('America/Los_Angeles')(NOW), 420, 'still summer time on 27 Oct (it ends on 1 Nov in 2026)');
  assert.equal(zoneOffset('UTC')(NOW), 0);
  assert.equal(zoneOffset('US/Pacific')(NOW), 420, 'the older names ServiceNow uses are known too');
  for (const bad of ['', null, 'Not/AZone', 'Europe/Berlin; drop', '../../etc', 'x'.repeat(200)]) assert.equal(zoneOffset(bad), null, String(bad));
});

test('which zone counts "today": the ServiceNow one when it can be read, else the browser\'s with one honest note', () => {
  const sn = chooseZone('Asia/Kolkata', { browser: 'Europe/Berlin' });
  assert.equal(sn.source, 'servicenow');
  assert.equal(sn.id, 'Asia/Kolkata');
  assert.equal(sn.note, '');
  const unread = chooseZone(null, { browser: 'Europe/Berlin' });
  assert.equal(unread.source, 'browser');
  assert.match(unread.note, /your browser's time zone \(Europe\/Berlin\): your ServiceNow time zone could not be read/);
  assert.match(chooseZone('', { browser: 'Europe/Berlin' }).note, /system time zone, which Agent Buddy cannot read/);
  assert.match(chooseZone('Mars/Olympus', { browser: '' }).note, /does not know your ServiceNow time zone \(Mars\/Olympus\)/);
  assert.equal(typeof unread.tz, 'function');
});

test('"opened today" starts at midnight in the person\'s ServiceNow zone, not the browser\'s', async () => {
  const inst = fakeInstance();
  const kolkata = chooseZone('Asia/Kolkata');
  const result = await runReport({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, zone: kolkata });
  // 27 Oct 00:00 in India is 26 Oct 18:30 UTC.
  assert.ok(inst.calls.some((c) => c.query === `${MINE}^opened_at>=2026-10-26 18:30:00`), inst.calls.map((c) => c.query).join('\n'));
  assert.deepEqual(result.zone, { id: 'Asia/Kolkata', source: 'servicenow', note: '' });
  assert.equal(startOfLocalDay(NOW, kolkata.tz), Date.UTC(2026, 9, 26, 18, 30));
});

test('the content script reads the person\'s own time zone softly (GET, one column) and tells the panel which zone it used', async () => {
  const withZone = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user', then: [{ sys_id: USER, time_zone: 'Asia/Kolkata' }] }] });
  assert.equal(await readUserZone(reader(withZone), USER), 'Asia/Kolkata');
  const call = withZone.callsTo('sys_user')[0];
  assert.equal(call.query, `sys_id=${USER}`);
  assert.deepEqual(call.fields, ['sys_id', 'time_zone']);
  const ops = createReportOps({ deps: withZone.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() });
  assert.deepEqual((await ops.reportContext({})).zone, { id: 'Asia/Kolkata', source: 'servicenow', note: '' });

  // The column is not readable (left out of the row), the record cannot be read, or the profile says "system": the browser's zone, said once.
  const hiddenColumn = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user', then: [{ sys_id: USER }] }] });
  assert.equal(await readUserZone(reader(hiddenColumn), USER), null);
  assert.equal(await readUserZone(reader(fakeInstance({ denied: ['sys_user'] })), USER), null);
  const system = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user', then: [{ sys_id: USER, time_zone: '' }] }] });
  assert.equal(await readUserZone(reader(system), USER), '');
  const out = await createReportOps({ deps: system.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() }).reportContext({});
  assert.equal(out.zone.source, 'browser');
  assert.match(out.zone.note, /system time zone/);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON: the offset function stays in the content script');
});

test('reportRun counts days in the person\'s ServiceNow zone (read once, cached)', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user', then: [{ sys_id: USER, time_zone: 'Asia/Kolkata' }] }] });
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() });
  const result = await ops.reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] });
  assert.equal(result.zone.source, 'servicenow');
  assert.ok(inst.calls.some((c) => /\^opened_at>=\d{4}-\d\d-\d\d 18:30:00$/.test(c.query)), 'midnight in India is 18:30 UTC');
  await ops.reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] });
  assert.equal(inst.callsTo('sys_user').length, 1, 'the zone is read once and then comes from the cache');
});

// ---- Real team groups ---------------------------------------------------------------------------------------------------------

const memberships = (n) => Array.from({ length: n }, (_, i) => ({ group: cell(id(i + 1), `Group ${String(i + 1).padStart(2, '0')}`) }));

test('my groups: only active groups are asked for; under the cap they keep their order and nothing is said', async () => {
  const inst = fakeInstance({ rules: [{ when: (c) => c.table === 'sys_user_grmember', then: memberships(3) }] });
  const team = await readMyTeam(reader(inst), USER, { tables: ['incident'] });
  assert.equal(inst.callsTo('sys_user_grmember')[0].query, `user=${USER}^group.active=true`);
  assert.deepEqual(team.groups.map((g) => g.name), ['Group 01', 'Group 02', 'Group 03']);
  assert.equal(team.capped, false);
  assert.equal(team.note, '');
  assert.equal(inst.calls.filter((c) => c.groupBy?.[0] === 'assignment_group').length, 0, 'no ranking read when everything fits');
});

test('41 groups: the 25 with the most open work are used, and the scope says "25 of 41"', async () => {
  const work = () => [group('assignment_group', id(41), 'Group 41', 30), group('assignment_group', id(7), 'Group 07', 12), group('assignment_group', id(30), 'Group 30', 5)];
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: memberships(41) },
      { when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'assignment_group' && c.query.startsWith('active=true^assignment_groupIN'), then: work },
    ],
  });
  const team = await readMyTeam(reader(inst), USER, { tables: ['incident'] });
  assert.equal(team.total, 41);
  assert.equal(team.groups.length, 25);
  assert.deepEqual(team.groups.slice(0, 3).map((g) => g.name), ['Group 41', 'Group 07', 'Group 30'], 'busiest first');
  assert.equal(team.groups[3].name, 'Group 01', 'then the membership order');
  assert.equal(team.note, '25 of 41 groups used: the ones with the most open work. Choose groups to see others.');
  const scope = await resolveScope({ kind: 'groups' }, { reader: reader(inst), userId: USER, tables: ['incident'] });
  assert.equal(scope.label, 'My groups (25 of 41)');
  assert.equal(scope.note, team.note);
  assert.equal(scope.query.split(',').length, 25);
});

test('the team helpers are pure and honest about what they could not rank', () => {
  const groups = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `G${i}` }));
  assert.deepEqual(pickTeamGroups(groups, { work: new Map([['3', 9]]), max: 2 }).map((g) => g.id), ['3', '0']);
  assert.deepEqual(pickTeamGroups(groups, { work: null, max: 2 }).map((g) => g.id), ['0', '1'], 'no counts: the first ones');
  assert.deepEqual(pickTeamGroups(groups, { work: new Map([['3', 9]]), max: 10 }).map((g) => g.id), ['0', '1', '2', '3'], 'under the cap: untouched');
  assert.equal(teamNote({ used: 25, total: 25 }), '');
  assert.match(teamNote({ used: 25, total: 30, ranked: false }), /the first ones in your memberships/);
  assert.match(teamNote({ used: 25, total: 200, ranked: true, more: true }), /^25 of 200 or more groups used/);
});

// ---- Chosen groups on THIS instance ---------------------------------------------------------------------------------------------

const groupRows = (rows) => ({ when: (c) => c.kind === 'query' && c.table === 'sys_user_group' && c.query !== '', then: rows });

test('chosen groups that do not exist on this instance are left out and said so; none at all means no numbers, not zeros', async () => {
  const some = fakeInstance({ rules: [groupRows([{ sys_id: GROUP_A, name: 'Service Desk', active: 'true' }])] });
  const scope = await resolveScope({ kind: 'chosen', groupIds: [GROUP_A, GROUP_B], groupNames: { [GROUP_A]: 'Desk', [GROUP_B]: 'Old' } }, { reader: reader(some), userId: USER });
  assert.deepEqual(scope.groups, [{ id: GROUP_A, name: 'Service Desk' }], 'the name as this instance has it');
  assert.equal(scope.query, `assignment_groupIN${GROUP_A}`);
  assert.match(scope.note, /^1 of the chosen groups does not exist on this instance, so it is left out\./);
  assert.match(some.callsTo('sys_user_group')[0].query, new RegExp(`^sys_idIN${GROUP_A},${GROUP_B}$`));

  // None exists (the table is readable and answers nothing): an empty scope, so no section runs and nothing shows a fake 0.
  const none = fakeInstance({ rules: [groupRows([])] });
  const result = await run({ section: 'overview', scope: { kind: 'chosen', groupIds: [GROUP_B] }, tables: ['incident'] }, none);
  assert.equal(result.data.available, false);
  assert.match(result.data.reason, /None of the chosen groups exists on this instance/);
  assert.equal(none.callsTo('incident', 'active').length, 0);
});

test('chosen groups that cannot be checked (no access to groups) are kept as they are, quietly; inactive ones are named', async () => {
  for (const inst of [fakeInstance({ denied: ['sys_user_group'] }), fakeInstance({ hidden: ['sys_user_group'] })]) {
    const checked = await checkChosenGroups(reader(inst), [{ id: GROUP_A, name: 'Desk' }]);
    assert.equal(checked.checked, false);
    assert.deepEqual(checked.groups, [{ id: GROUP_A, name: 'Desk' }]);
  }
  const old = fakeInstance({ rules: [groupRows([{ sys_id: GROUP_A, name: 'Old Desk', active: 'false' }])] });
  const scope = await resolveScope({ kind: 'chosen', groupIds: [GROUP_A] }, { reader: reader(old), userId: USER });
  assert.equal(scope.empty, false);
  assert.match(scope.note, /No longer active: Old Desk\./);
});

// ---- Resolved but still active ------------------------------------------------------------------------------------------------------

const STATES = [group('state', '1', 'New', 2), group('state', '2', 'In Progress', 3), group('state', '6', 'Resolved', 4)];
const resolvedWorld = () =>
  fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.groupBy[0] === 'state' && c.groupBy.length === 1, then: STATES },
      { when: (c) => c.kind === 'aggregate' && c.query === `${MINE}^active=true`, then: count(9) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('sys_updated_on<'), then: count(1) },
    ],
  });

test('states: "Resolved", "Closed Complete" and "Cancelled" while still active are their own class', () => {
  for (const label of ['Resolved', 'Closed Complete', 'Closed Incomplete', 'Cancelled', 'Canceled', 'Completed']) assert.equal(stateClass(label), 'resolved', label);
  for (const label of ['In Progress', 'Awaiting Resolution', 'On Hold']) assert.notEqual(stateClass(label), 'resolved', label);
  assert.deepEqual(resolvedStates([{ count: 4, keys: [{ value: '6', display: 'Resolved' }] }, { count: 2, keys: [{ value: '2', display: 'In Progress' }] }]), { count: 4, values: ['6'], labels: ['Resolved'] });
  assert.equal(notResolved(['6', '7']), 'state!=6^state!=7');
  assert.equal(notResolved([]), '');
  assert.equal(notResolved(['javascript:alert(1)']), '', 'a value a query must not hold is not written');
  assert.equal(notResolved(['a^b']), 'state!=a^^b', 'a caret is escaped');
});

test('Overview: resolved-but-active tickets are not "Open" and not "stale"; they get their own tile and list', async () => {
  const inst = resolvedWorld();
  const result = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(tileOf(result, 'open').value, 5, '9 active minus 4 resolved');
  const done = tileOf(result, 'resolvedActive');
  assert.equal(done.value, 4);
  assert.equal(result.data.tiles[1].key, 'resolvedActive', 'next to Open');
  assert.match(done.hint, /Not counted as open/);
  assert.equal(done.drills[0].query, `${MINE}^active=true^stateIN6`);
  assert.equal(tileOf(result, 'open').drills[0].query, `${MINE}^active=true^state!=6`);
  assert.ok(inst.calls.some((c) => c.query.includes('sys_updated_on<') && c.query.endsWith('^state!=6')), 'stale leaves them out');
  assert.equal(result.data.perTable[0].resolvedActive, 4);
  // No resolved state in the queue: no extra tile at all.
  const plain = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.query === `${MINE}^active=true`, then: count(3) }] });
  const quiet = await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident'] }, plain);
  assert.equal(tileOf(quiet, 'resolvedActive'), undefined);
  assert.equal(tileOf(quiet, 'open').value, 3);
});

test('Workload: open, stale and ageing leave resolved-but-active out; the bars show them as their own part', async () => {
  const inst = resolvedWorld();
  const result = await run({ section: 'workload', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  assert.equal(result.data.totals.open, 5);
  assert.equal(result.data.totals.resolvedActive, 4);
  assert.ok(result.data.classes.some((c) => c.key === 'resolved'));
  const ageing = inst.calls.filter((c) => c.query.includes('opened_at>'));
  assert.ok(ageing.length >= 4 && ageing.every((c) => c.query.endsWith('^state!=6')));
  assert.match(result.data.ageing.queriesByTable.incident['d0-1'], /\^state!=6$/);
});

test('Hand-over: "oldest open" never lists a ticket that is only waiting to close', async () => {
  const inst = resolvedWorld();
  await run({ section: 'handover', scope: { kind: 'mine' }, tables: ['incident'] }, inst);
  const oldest = inst.calls.find((c) => c.kind === 'query' && c.table === 'incident' && c.query.endsWith('^ORDERBYopened_at') && !c.query.includes('stateIN'));
  assert.ok(oldest, 'the oldest-open read');
  assert.match(oldest.query, /\^active=true\^state!=6\^ORDERBYopened_at$/);
});

// ---- Change tasks and HR cases ----------------------------------------------------------------------------------------------------

test('change tasks are a report table for everyone; HR cases only with the HR profile and the organisation\'s approval', async () => {
  assert.ok(STANDARD_TABLE_IDS.includes('change_task'));
  assert.equal(REPORT_TABLES.sn_hr_core_case.sensitive, true);
  assert.ok(!STANDARD_TABLE_IDS.includes('sn_hr_core_case'));
  assert.ok(isSensitiveReportTable('sn_hr_le_case'));
  assert.ok(isSensitiveReportTable('x_acme_people_case', ['x_acme_people_']), 'a prefix the policy adds counts too');
  assert.ok(!normalizeTables(['incident'], { sensitivePrefixes: ['x_'] }).includes('sn_hr_core_case'));

  const inst = fakeInstance();
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() });
  const plain = await ops.reportContext({});
  assert.ok(plain.tables.some((t) => t.table === 'change_task'));
  assert.ok(!plain.tables.some((t) => t.table === 'sn_hr_core_case'), 'not even listed');
  assert.equal(inst.callsTo('sn_hr_core_case').length, 0, 'and never read');
  // ctx.allowSensitive is what the content script let stand (src/content/reads.js lowers it unless the managed policy allows HR content).
  const hr = await ops.reportContext({}, { allowSensitive: true });
  const row = hr.tables.find((t) => t.table === 'sn_hr_core_case');
  assert.equal(row.label, 'HR cases');
  assert.equal(row.sensitive, true);

  await ops.reportRun({ section: 'overview', scope: { kind: 'mine' }, tables: ['sn_hr_core_case', 'incident'] });
  assert.equal(inst.callsTo('sn_hr_core_case', 'active').length, 0, 'asked for without approval: not read');
  const builder = await ops.reportRun({ kind: 'builder', config: { table: 'sn_hr_core_case', groupBy: 'state' } });
  assert.equal(builder.data.available, false);
  assert.match(builder.data.reason, /HR cases are shown only with the HR profile/);
});

test('coaching never takes HR cases, even by default', () => {
  const request = normalizeCoachingRequest({ groupId: GROUP_A, fromMs: NOW - 86400000 * 3, toMs: NOW }, { now: NOW });
  assert.ok(!request.tables.includes('sn_hr_core_case'));
  assert.ok(request.tables.includes('change_task'));
  assert.throws(() => normalizeCoachingRequest({ groupId: GROUP_A, fromMs: NOW - 86400000, toMs: NOW, tables: ['sn_hr_core_case'] }, { now: NOW }), /never used for coaching/);
});

test('a report pack built from HR cases is HR content: the pipeline applies the HR rules to it', () => {
  const hrResult = { tables: [{ table: 'sn_hr_core_case', status: 'ok' }, { table: 'incident', status: 'ok' }], access: [], notes: [], caps: [], scope: { label: 'Mine' }, data: { available: true, hours: 12, snapshot: {}, sla: { top: [] }, waiting: { approvals: {}, oldest: [] }, events: {}, oldest: [] } };
  assert.equal(carriesSensitive(hrResult), true);
  assert.equal(carriesSensitive({ ...hrResult, tables: [{ table: 'sn_hr_core_case', status: 'denied' }] }), false, 'a table that was not read carries nothing');
  const pack = buildHandoverPack(hrResult);
  assert.equal(pack.sensitive, true);
  assert.equal(isSensitivePack(pack, normalizePolicy({})), true);
  const feature = featureById('shift-handover');
  const values = { piiMode: 'strict' };
  const config = { provider: 'anthropic', model: 'm', apiKey: 'k' };
  assert.throws(() => assertRunnable({ feature, pack, values, policy: normalizePolicy({}), config }), (e) => e.code === 'HR_BLOCKED');
  const plain = buildHandoverPack({ ...hrResult, tables: [{ table: 'incident', status: 'ok' }] });
  assert.equal(plain.sensitive, undefined);
});
