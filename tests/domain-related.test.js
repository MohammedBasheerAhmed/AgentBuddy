import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedFields } from '../src/context/allowlists.js';
import { readContextPack } from '../src/context/pack.js';
import { RELATED_BY_KIND, readRelated, relatedPlan } from '../src/context/related.js';
import { accessDeniedError, fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { IDS, changeRows, domainTables, incidentRows, sid } from './domain-fixtures.js';

const problem = { table: 'problem', sysId: IDS.problem };
const change = { table: 'change_request', sysId: IDS.change };
const theCase = { table: 'sn_customerservice_case', sysId: IDS.case };

const packFor = (ref, feature, tables = domainTables(), behaviour, wrap) => {
  const fake = fakeDeps(tables, behaviour);
  const deps = wrap ? wrap(fake) : fake;
  return readContextPack(ref, deps, { feature }).then((pack) => ({ pack, deps: fake }));
};
const accessOf = (pack, source) => pack.access.filter((a) => a.source === source);

// A fake whose reads of one table can be changed: `answer(table, query, fields, options, real)` returns rows, or undefined to
// fall through to the fake.
function interfere(fake, answer) {
  return {
    ...fake,
    queryTable: async (table, query, fields, options) => {
      const handled = await answer(table, query, fields, options, fake);
      return handled === undefined ? fake.queryTable(table, query, fields, options) : handled;
    },
  };
}

// ---- Plans ---------------------------------------------------------------------------------------------------------------

test('the plan names the new extras for the domain features only, and leaves every older feature alone', () => {
  assert.deepEqual(relatedPlan({ kind: 'problem', feature: 'problem-rca' }), ['childTasks', 'linkedIncidents']);
  assert.deepEqual(relatedPlan({ kind: 'change', feature: 'change-cab-brief' }), ['approvals', 'changeTasks', 'conflicts']);
  assert.deepEqual(relatedPlan({ kind: 'case', feature: 'account-briefing' }), ['slas', 'recentChanges']);
  assert.deepEqual(relatedPlan({ kind: 'case', feature: 'case-eng-escalation' }), ['slas', 'childTasks']);
  assert.deepEqual(relatedPlan({ kind: 'hr_case', feature: 'hr-case-brief' }), ['slas', 'childTasks']);
  // older features do not suddenly read more
  assert.deepEqual(relatedPlan({ kind: 'problem', feature: 'record-summary' }), ['childTasks']);
  assert.deepEqual(relatedPlan({ kind: 'change', feature: 'record-summary' }), ['approvals', 'changeTasks']);
  assert.deepEqual(relatedPlan({ kind: 'case', feature: 'handoff-brief' }), ['slas', 'childTasks']);
  // a domain feature asked about the wrong kind never gets the new extras
  assert.ok(!relatedPlan({ kind: 'incident', feature: 'problem-rca' }).includes('linkedIncidents'));
  assert.ok(!relatedPlan({ kind: 'problem', feature: 'change-cab-brief' }).includes('conflicts'));
  // HR without sensitive data allowed: SLAs only
  assert.deepEqual(relatedPlan({ kind: 'hr_case', feature: 'hr-case-brief', minimised: true }), ['slas']);
  assert.ok(RELATED_BY_KIND.problem.includes('linkedIncidents') && RELATED_BY_KIND.change.includes('conflicts') && RELATED_BY_KIND.case.includes('recentChanges'));
});

// ---- Linked incidents ----------------------------------------------------------------------------------------------------

test('a problem with many incidents gets the oldest 10 and the newest 10, in date order, and the total', async () => {
  const { pack, deps } = await packFor(problem, 'problem-rca');
  const list = pack.related.linkedIncidents;
  assert.equal(list.length, 20);
  assert.equal(list[0].number, 'INC001001');
  assert.equal(list[9].number, 'INC001010');
  assert.equal(list[10].number, 'INC001016');
  assert.equal(list[19].number, 'INC001025');
  assert.deepEqual(pack.related.linkedIncidentsSummary, { total: 25, shown: 20 });
  assert.ok(!list.some((i) => i.number === 'INC0099999'), 'an incident of another problem never gets in');
  const note = accessOf(pack, 'incident')[0];
  assert.equal(note.status, 'ok');
  assert.match(note.note, /oldest 10 and the newest 10 of 25/);
  // two reads of rows and one count (the Aggregate API moves no rows; the fake answers it with a one-column read)
  const calls = deps.callsTo('incident');
  assert.equal(calls.length, 3);
  assert.ok(calls.some((c) => c.query.endsWith('ORDERBYopened_at') && c.options.limit === 21));
  assert.ok(calls.some((c) => c.query.endsWith('ORDERBYDESCopened_at') && c.options.limit === 10));
  assert.equal(calls.filter((c) => c.fields.length === 1).length, 1);
});

test('each linked incident carries the columns the timeline needs and close notes capped at 400 characters', async () => {
  const tables = domainTables();
  tables.incident[0].close_notes = v(`Fixed. ${'long '.repeat(200)}`);
  const { pack } = await packFor(problem, 'problem-rca', tables);
  const first = pack.related.linkedIncidents[0];
  assert.deepEqual(Object.keys(first), ['number', 'short_description', 'state', 'opened', 'resolved', 'ci', 'closeNotes']);
  assert.equal(first.opened, '2026-10-01 09:00:00');
  assert.equal(first.ci, 'gw-eu-1');
  assert.ok(first.closeNotes.length <= 400);
  assert.ok(first.closeNotes.endsWith('…'));
});

test('20 or fewer incidents are read in one go with nothing missing', async () => {
  const { pack, deps } = await packFor(problem, 'problem-rca', domainTables({ incidents: { linked: 5 } }));
  assert.equal(pack.related.linkedIncidents.length, 5);
  assert.deepEqual(pack.related.linkedIncidentsSummary, { total: 5, shown: 5 });
  assert.equal(deps.callsTo('incident').length, 1);
  assert.equal(accessOf(pack, 'incident')[0].note, '');
});

test('exactly one more than the cap still reads two ends and counts the rest', async () => {
  const { pack } = await packFor(problem, 'problem-rca', domainTables({ incidents: { linked: 21 } }));
  assert.equal(pack.related.linkedIncidents.length, 20);
  assert.deepEqual(pack.related.linkedIncidentsSummary, { total: 21, shown: 20 });
  assert.equal(new Set(pack.related.linkedIncidents.map((i) => i.number)).size, 20, 'no incident twice');
});

test('a problem with no linked incident is a confirmed "none" when the user can see incidents', async () => {
  const { pack } = await packFor(problem, 'problem-rca', domainTables({ incidents: { linked: 0 } }));
  assert.deepEqual(pack.related.linkedIncidents, []);
  assert.equal(accessOf(pack, 'incident')[0].status, 'empty');
  assert.ok(!('linkedIncidentsSummary' in pack.related));
});

test('an ACL-denied incident table becomes an access entry, not an error and not an empty list', async () => {
  const { pack } = await packFor(problem, 'problem-rca', domainTables(), { denied: ['incident'] });
  assert.ok(!('linkedIncidents' in pack.related));
  assert.equal(accessOf(pack, 'incident')[0].status, 'denied');
  assert.equal(pack.related.childTasks.length, 0, 'the other extras still load');
});

test('HTTP 200 with no rows, when the user sees no incidents at all, is "empty or hidden", not "none"', async () => {
  const { pack } = await packFor(problem, 'problem-rca', domainTables(), { hidden: ['incident'] });
  assert.ok(!('linkedIncidents' in pack.related));
  assert.equal(accessOf(pack, 'incident')[0].status, 'empty-or-hidden');
});

test('an instance that ignores the problem_id condition returns other problems\' incidents: none of them is used', async () => {
  const tables = domainTables();
  tables.incident.forEach((row) => delete row.problem_id);
  const { pack } = await packFor(problem, 'problem-rca', tables);
  assert.ok(!('linkedIncidents' in pack.related));
  const entry = accessOf(pack, 'incident')[0];
  assert.equal(entry.status, 'error');
  assert.match(entry.note, /did not apply the filter/);
});

test('if the count cannot be read the list says "more than 20" instead of a made-up number', async () => {
  const wrap = (fake) => ({ ...fake, countRecords: async () => { throw accessDeniedError('stats'); } });
  const { pack } = await packFor(problem, 'problem-rca', domainTables(), undefined, wrap);
  assert.equal(pack.related.linkedIncidents.length, 20);
  assert.deepEqual(pack.related.linkedIncidentsSummary, { total: null, shown: 20 });
  assert.match(accessOf(pack, 'incident')[0].note, /more than 20/);
});

test('if the newest incidents cannot be read the oldest 20 are used and the note says so', async () => {
  const wrap = (fake) => interfere(fake, async (table, query) => {
    if (table === 'incident' && query.includes('ORDERBYDESCopened_at')) throw accessDeniedError('incident');
    return undefined;
  });
  const { pack } = await packFor(problem, 'problem-rca', domainTables(), undefined, wrap);
  assert.equal(pack.related.linkedIncidents.length, 20);
  assert.equal(pack.related.linkedIncidents[19].number, 'INC001020');
  assert.match(accessOf(pack, 'incident')[0].note, /oldest 20 of 25/);
});

test('a lost session is not hidden as an access note: it stops the read', async () => {
  await assert.rejects(() => packFor(problem, 'problem-rca', domainTables(), { expired: ['incident'] }), (e) => e.code === 'SESSION_EXPIRED');
});

test('incidents are asked for with exactly the columns of the timeline and a condition on this problem', async () => {
  const { deps } = await packFor(problem, 'problem-rca');
  for (const call of deps.callsTo('incident').filter((c) => c.fields.length > 1)) {
    assert.ok(call.query.startsWith(`problem_id=${IDS.problem}^`));
    // caller_id, opened_by and assigned_to are read for their display names, so the people another incident names are masked.
    assert.deepEqual(call.fields, ['sys_id', 'number', 'short_description', 'state', 'opened_at', 'resolved_at', 'cmdb_ci', 'close_notes', 'problem_id', 'caller_id', 'opened_by', 'assigned_to']);
    assert.ok(call.options.limit <= 21);
  }
});

test('the problem pack itself stays inside the problem-rca allowlist, whatever the instance returns', async () => {
  const { pack, deps } = await packFor(problem, 'problem-rca', domainTables(), { leaky: true });
  assert.ok(!JSON.stringify(pack).includes('PROBLEM-LEAK'));
  const call = deps.callsTo('problem')[0];
  assert.deepEqual(call.fields, [...allowedFields('problem', 'problem-rca'), 'comments', 'work_notes']);
  assert.deepEqual(Object.keys(pack.related.linkedIncidents[0]), ['number', 'short_description', 'state', 'opened', 'resolved', 'ci', 'closeNotes']);
});

// ---- Schedule conflicts --------------------------------------------------------------------------------------------------

test('conflicts: other active changes on the same CI or service whose window overlaps, once each, with why they match', async () => {
  const { pack } = await packFor(change, 'change-cab-brief');
  const list = pack.related.conflicts;
  assert.deepEqual(list.map((c) => c.number), ['CHG0030012', 'CHG0030013', 'CHG0030010']);
  assert.deepEqual(list.find((c) => c.number === 'CHG0030013').same.sort(), ['business_service', 'cmdb_ci']);
  assert.deepEqual(list.find((c) => c.number === 'CHG0030010').same, ['cmdb_ci']);
  assert.deepEqual(list.find((c) => c.number === 'CHG0030012').same, ['business_service']);
  assert.deepEqual(pack.related.conflictsSummary, { total: 3, shown: 3 });
  const numbers = list.map((c) => c.number);
  for (const never of ['CHG0030001', 'CHG0030011', 'CHG0030014', 'CHG0030015']) assert.ok(!numbers.includes(never), never);
  assert.deepEqual(Object.keys(list[0]), ['number', 'short_description', 'state', 'type', 'risk', 'start', 'end', 'ci', 'service', 'same']);
  assert.equal(accessOf(pack, 'change_request')[0].status, 'ok');
});

test('conflicts: at most 10 are returned and the number found is kept', async () => {
  const tables = domainTables();
  for (let i = 0; i < 14; i += 1) {
    tables.change_request.push({ ...changeRows()[1], sys_id: v(sid('c4a2', i + 1)), number: v(`CHG005${String(i).padStart(4, '0')}`) });
  }
  const { pack } = await packFor(change, 'change-cab-brief', tables);
  assert.equal(pack.related.conflicts.length, 10);
  assert.deepEqual(pack.related.conflictsSummary, { total: 17, shown: 10 });
  assert.match(accessOf(pack, 'change_request')[0].note, /first 10 of 17/);
});

test('conflicts: the window is exact on stored UTC times; touching windows count, a gap does not', async () => {
  const tables = domainTables();
  const base = changeRows()[1];
  // this change runs 2026-11-11 00:00 to 02:00 UTC? No: stored values are start 2026-11-10 23:00:00, end 2026-11-11 01:00:00
  const make = (n, number, start, end) => ({ ...base, sys_id: v(sid('c4a3', n)), number: v(number), start_date: v(start), end_date: v(end) });
  tables.change_request = [
    tables.change_request[0],
    make(1, 'CHG0060001', '2026-11-10 21:00:00', '2026-11-10 23:00:00'), // ends exactly when this one starts: touching
    make(2, 'CHG0060002', '2026-11-11 01:00:00', '2026-11-11 03:00:00'), // starts exactly when this one ends: touching
    make(3, 'CHG0060003', '2026-11-10 21:00:00', '2026-11-10 22:59:59'), // one second before
    make(4, 'CHG0060004', '2026-11-11 01:00:01', '2026-11-11 03:00:00'), // one second after
  ];
  const { pack } = await packFor(change, 'change-cab-brief', tables);
  assert.deepEqual(pack.related.conflicts.map((c) => c.number).sort(), ['CHG0060001', 'CHG0060002']);
});

test('conflicts: the instance is asked with a window padded by a day, by CI and by service, active changes only', async () => {
  const { deps } = await packFor(change, 'change-cab-brief');
  const queries = deps.callsTo('change_request').map((c) => c.query).filter((q) => q.includes('start_date<='));
  assert.equal(queries.length, 2);
  assert.ok(queries.some((q) => q.startsWith(`cmdb_ci=${IDS.ci}^sys_id!=${IDS.change}^active=true^start_date<=2026-11-12 01:00:00^end_date>=2026-11-09 23:00:00`)));
  assert.ok(queries.some((q) => q.startsWith(`business_service=${IDS.service}^`)));
});

test('conflicts: a change without a CI and a service, or without dates, is skipped with a reason, never "none found"', async () => {
  const noKeys = domainTables();
  Object.assign(noKeys.change_request[0], { cmdb_ci: v(''), business_service: v('') });
  const a = await packFor(change, 'change-cab-brief', noKeys);
  assert.ok(!('conflicts' in a.pack.related));
  const skippedA = accessOf(a.pack, 'change_request').find((e) => e.status === 'skipped');
  assert.match(skippedA.note, /no configuration item or business service/);

  const noDates = domainTables();
  Object.assign(noDates.change_request[0], { start_date: v(''), end_date: v('') });
  const b = await packFor(change, 'change-cab-brief', noDates);
  assert.ok(!('conflicts' in b.pack.related));
  assert.match(accessOf(b.pack, 'change_request').find((e) => e.status === 'skipped').note, /no planned start and end/);
});

test('conflicts: a refused read is an access entry, and a half-answered check does not claim "none"', async () => {
  const refuse = (match) => (fake) => interfere(fake, async (table, query) => {
    if (table === 'change_request' && query.includes('start_date<=') && match(query)) throw accessDeniedError('change_request');
    return undefined;
  });
  // both reads refused
  const all = await packFor(change, 'change-cab-brief', domainTables(), undefined, refuse(() => true));
  assert.ok(!('conflicts' in all.pack.related));
  assert.equal(accessOf(all.pack, 'change_request').find((e) => e.status === 'denied').status, 'denied');

  // only the service check refused, and the CI check finds nothing: no claim of "none"
  const tables = domainTables();
  tables.change_request = [tables.change_request[0]];
  const half = await packFor(change, 'change-cab-brief', tables, undefined, refuse((q) => q.startsWith('business_service=')));
  assert.ok(!('conflicts' in half.pack.related));

  // only the service check refused, and the CI check finds changes: they are listed, with a note
  const some = await packFor(change, 'change-cab-brief', domainTables(), undefined, refuse((q) => q.startsWith('business_service=')));
  assert.deepEqual(some.pack.related.conflicts.map((c) => c.number), ['CHG0030013', 'CHG0030010']);
  assert.match(accessOf(some.pack, 'change_request')[0].note, /could not be read/);
});

test('conflicts: an instance that ignores the CI condition cannot pass other CIs\' changes off as conflicts', async () => {
  const wrap = (fake) => interfere(fake, async (table, query, fields, options, real) => {
    if (table === 'change_request' && query.includes('start_date<=')) return real.queryTable(table, '', fields, options);
    return undefined;
  });
  const { pack } = await packFor(change, 'change-cab-brief', domainTables(), undefined, wrap);
  assert.ok(!('conflicts' in pack.related));
  assert.ok(accessOf(pack, 'change_request').some((e) => e.status === 'error' && /did not apply the filter/.test(e.note)));
});

test('conflicts: no rows is "none" (the change\'s own table is visible), with an empty list', async () => {
  const tables = domainTables();
  tables.change_request = [tables.change_request[0]];
  const { pack } = await packFor(change, 'change-cab-brief', tables);
  assert.deepEqual(pack.related.conflicts, []);
  assert.equal(accessOf(pack, 'change_request')[0].status, 'empty');
});

test('conflicts read only the columns the change ceiling allows, and the change pack respects the allowlist', async () => {
  const { pack, deps } = await packFor(change, 'change-cab-brief', domainTables(), { leaky: true });
  assert.ok(!JSON.stringify(pack).includes('CHANGE-LEAK'));
  const own = deps.callsTo('change_request').find((c) => c.query === `sys_id=${IDS.change}` && c.fields.length === 4);
  assert.deepEqual(own.fields, ['cmdb_ci', 'business_service', 'start_date', 'end_date']);
  assert.equal(own.options.displayValue, false);
  const main = deps.callsTo('change_request')[0];
  assert.deepEqual(main.fields, [...allowedFields('change_request', 'change-cab-brief'), 'comments', 'work_notes']);
});

test('the change\'s own columns are read once, however many extras need them', async () => {
  const deps = fakeDeps(domainTables());
  const memo = new Map();
  await readRelated(['conflicts', 'conflicts'], { table: 'change_request', sysId: IDS.change }, deps, memo);
  const own = deps.callsTo('change_request').filter((c) => c.query === `sys_id=${IDS.change}`);
  assert.equal(own.length, 1);
});

test('long change text is kept to the limits the spec sets, not cut at 300', async () => {
  const tables = domainTables();
  tables.change_request[0].implementation_plan = v(`Step. ${'plan '.repeat(1000)}`);
  tables.change_request[0].justification = v(`Why. ${'because '.repeat(500)}`);
  const { pack } = await packFor(change, 'change-cab-brief', tables);
  assert.equal(pack.fields.implementation_plan.length, 2000);
  assert.equal(pack.fields.justification.length, 1500);
  assert.ok(pack.fields.implementation_plan.endsWith('…'));
});

// ---- Recent changes on a case's CI -------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-11-12T00:00:00Z');
const withClock = (fake) => ({ ...fake, now: () => NOW });

test('recent changes: changes on the case\'s CI made in the last 14 days or planned in the next 7, at most 5', async () => {
  const tables = domainTables();
  const { pack } = await packFor(theCase, 'account-briefing', tables, undefined, withClock);
  const numbers = pack.related.recentChanges.map((c) => c.number);
  assert.ok(numbers.length <= 5);
  assert.ok(numbers.includes('CHG0030010') && numbers.includes('CHG0030013') && numbers.includes('CHG0030011'));
  assert.ok(!numbers.includes('CHG0030014'), 'other CI');
  assert.ok(!numbers.includes('CHG0030012'), 'other CI');
});

test('recent changes: a change planned far in the future or long finished is not listed', async () => {
  const tables = domainTables();
  tables.change_request.push({ ...changeRows()[1], sys_id: v(sid('c4a4')), number: v('CHG0070001'), start_date: v('2026-12-30 10:00:00'), end_date: v('2026-12-30 12:00:00') });
  tables.change_request.push({ ...changeRows()[1], sys_id: v(sid('c4a5')), number: v('CHG0070002'), start_date: v('2026-09-01 10:00:00'), end_date: v('2026-09-01 12:00:00') });
  const { pack } = await packFor(theCase, 'account-briefing', tables, undefined, withClock);
  const numbers = pack.related.recentChanges.map((c) => c.number);
  assert.ok(!numbers.includes('CHG0070001') && !numbers.includes('CHG0070002'));
});

test('recent changes: a case without a CI is skipped with a reason, not "no changes"', async () => {
  const tables = domainTables();
  tables.sn_customerservice_case[0].cmdb_ci = v('');
  const { pack } = await packFor(theCase, 'account-briefing', tables, undefined, withClock);
  assert.ok(!('recentChanges' in pack.related));
  assert.match(accessOf(pack, 'change_request').find((e) => e.status === 'skipped').note, /no configuration item/);
});

test('recent changes: a customer service user who cannot read changes gets a denied entry and the briefing carries on', async () => {
  const { pack } = await packFor(theCase, 'account-briefing', domainTables(), { denied: ['change_request'] }, withClock);
  assert.ok(!('recentChanges' in pack.related));
  assert.equal(accessOf(pack, 'change_request').find((e) => e.status !== 'ok').status, 'denied');
  assert.equal(pack.kind, 'case');
});

test('recent changes: 200 with nothing, when no change at all is visible, is "empty or hidden" and not "no recent changes"', async () => {
  const { pack } = await packFor(theCase, 'account-briefing', domainTables(), { hidden: ['change_request'] }, withClock);
  assert.ok(!('recentChanges' in pack.related));
  const entry = accessOf(pack, 'change_request').find((e) => e.status !== 'ok');
  assert.equal(entry.status, 'empty-or-hidden');
});

test('the new extras read nothing for a record kind that does not have them', async () => {
  const deps = fakeDeps(domainTables());
  const plan = relatedPlan({ kind: 'other', feature: 'problem-rca' });
  assert.deepEqual(plan, []);
  const { related, access } = await readRelated(plan, { table: 'u_thing', sysId: sid('1c00') }, deps, new Map());
  assert.deepEqual(related, {});
  assert.deepEqual(access, []);
  assert.equal(deps.calls.length, 0);
});
