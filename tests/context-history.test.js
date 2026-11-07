import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_SOURCES, historySignals, normaliseHistoryRow, readCallerHistory } from '../src/context/history.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { ABEL, CHARLIE, JANE } from './fixtures/sn-users.js';

const who = { callerSysId: ABEL.sysId, excludeSysId: INCIDENT_ID };
const history = (behaviour, options = {}, person = who, tables = buildInstance()) => {
  const deps = fakeDeps(tables, behaviour);
  return readCallerHistory(person, deps, { now: NOW, ...options }).then((result) => ({ ...result, deps }));
};

// A hand-made item for the pure functions.
const item = (over) => ({
  table: 'incident', sysId: 'x', number: 'INC1', short_description: '', state: 'Closed', active: 'false', category: '', cmdb_ci: '',
  assignment_group: '', close_code: '', close_notes: '', opened_at: '', resolved_at: '', openedUtc: '', resolvedUtc: '', ...over,
});

// ---- Reading --------------------------------------------------------------------------------------------------

test('the caller\'s earlier incidents, oldest first, never the one on screen and never other people\'s', async () => {
  const { items, deps } = await history();
  assert.deepEqual(items.map((i) => i.number), ['INC0009001', 'INC0009150', 'INC0009377', 'INC0009588', 'INC0009640', 'INC0009702']);
  assert.ok(items.every((i) => i.table === 'incident'));
  const call = deps.callsTo('incident')[0];
  assert.equal(call.query, `caller_id=${ABEL.sysId}^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`);
  assert.equal(call.options.limit, 10);
  assert.equal(call.options.displayValue, true);
});

test('only minimal columns are asked for', async () => {
  const { deps } = await history();
  const asked = deps.fieldsAsked();
  for (const name of ['description', 'work_notes', 'comments', 'caller_id.email', 'assigned_to', 'u_employee_id']) assert.ok(!asked.has(name), name);
  for (const name of ['number', 'short_description', 'state', 'opened_at', 'resolved_at', 'close_code', 'close_notes', 'category', 'cmdb_ci', 'assignment_group']) assert.ok(asked.has(name), name);
});

test('items carry the display values, the stored UTC times and a capped close note', async () => {
  const tables = buildInstance();
  tables.incident.find((r) => r.number.value === 'INC0009001').close_notes = v('n'.repeat(900));
  const { items } = await history({}, {}, who, tables);
  const first = items[0];
  assert.equal(first.number, 'INC0009001');
  assert.equal(first.short_description, 'VPN keeps disconnecting on home wifi');
  assert.equal(first.state, 'Closed');
  assert.equal(first.category, 'Network');
  assert.equal(first.cmdb_ci, 'VPN Gateway EU');
  assert.equal(first.assignment_group, 'Network Support');
  assert.equal(first.opened_at, '2026-06-02 10:00:00', 'as the user sees it (UTC+2)');
  assert.equal(first.openedUtc, '2026-06-02 08:00:00');
  assert.equal(first.resolvedUtc, '2026-06-03 10:00:00');
  assert.equal(first.close_notes.length, 400);
  assert.match(first.sysId, /^[0-9a-f]{32}$/);
});

test('the limit keeps the newest across tables', async () => {
  const { items } = await history({}, { limit: 3 });
  assert.deepEqual(items.map((i) => i.number), ['INC0009588', 'INC0009640', 'INC0009702']);
});

test('a requested item of the same person is included, a case too', async () => {
  const tables = buildInstance();
  tables.sc_req_item[0].requested_for = v(ABEL.sysId, ABEL.name);
  tables.sc_req_item[0].opened_at = v('2026-10-01 08:00:00');
  tables.sc_req_item[0].active = v('false');
  tables.sn_customerservice_case[0].contact = v(ABEL.sysId, ABEL.name);
  const { items, access } = await history({}, {}, who, tables);
  assert.ok(items.some((i) => i.table === 'sc_req_item' && i.number === 'RITM0010050'));
  assert.ok(items.some((i) => i.table === 'sn_customerservice_case' && i.number === 'CS0001001'));
  assert.deepEqual(access.map((a) => [a.source, a.status]), [['incident', 'ok'], ['sc_req_item', 'ok'], ['sn_customerservice_case', 'ok'], ['sn_hr_core_case', 'skipped']]);
  const ritm = items.find((i) => i.table === 'sc_req_item');
  assert.equal(ritm.category, 'Standard Laptop', 'a catalog item stands in for the category');
});

test('HR cases are only read when sensitive data is allowed', async () => {
  const off = await history({ leaky: true });
  assert.ok(off.items.every((i) => i.table !== 'sn_hr_core_case'));
  assert.equal(off.deps.callsTo('sn_hr_core_case').length, 0);
  assert.deepEqual(off.access.find((a) => a.source === 'sn_hr_core_case'), {
    source: 'sn_hr_core_case',
    status: 'skipped',
    note: 'HR cases are only included when sensitive data is allowed.',
  });

  const on = await history({}, { allowSensitive: true }, { callerSysId: JANE.sysId, excludeSysId: 'd3e4f5a6b7c84d9e0f1a2b3c4d5e6f70' });
  assert.deepEqual(on.items.map((i) => i.number), ['HRC0000900']);
  assert.equal(on.items[0].close_notes, 'Updated the address in the HR profile.');
  assert.equal(on.access.find((a) => a.source === 'sn_hr_core_case').status, 'ok');
});

test('the tables option restricts what is read', async () => {
  const { deps, access } = await history({}, { tables: ['incident'] });
  assert.deepEqual(access.map((a) => a.source), ['incident']);
  assert.equal(deps.callsTo('sc_req_item').length, 0);
});

test('zero rows from a table that has rows for others is "empty"; a table that shows nothing at all is "empty-or-hidden"', async () => {
  const visible = await history({}, {}, { callerSysId: CHARLIE.sysId, excludeSysId: '' });
  assert.equal(visible.access.find((a) => a.source === 'sn_customerservice_case').status, 'empty');

  const hidden = await history({ hidden: ['sn_customerservice_case', 'sc_req_item'] });
  for (const source of ['sn_customerservice_case', 'sc_req_item']) {
    const entry = hidden.access.find((a) => a.source === source);
    assert.equal(entry.status, 'empty-or-hidden', source);
    assert.match(entry.note, /cannot tell whether there are none/);
  }
  assert.equal(hidden.items.length, 6, 'the readable table still answers');
});

test('a denied table is a note and the others still answer', async () => {
  const { items, access } = await history({ denied: ['incident'] });
  assert.deepEqual(items, []);
  assert.equal(access.find((a) => a.source === 'incident').status, 'denied');
  assert.ok(access.length >= 3);
});

test('rows that are not the caller\'s are dropped when the instance ignored the condition', async () => {
  const tables = buildInstance();
  // sc_req_item rows without any requester column: the condition is ignored and everyone's rows would come back
  tables.sc_req_item = [
    { sys_id: v('r1'), number: v('RITM0000001'), short_description: v('Someone else\'s laptop'), state: v('2', 'Open'), opened_at: v('2026-10-01 08:00:00') },
    { sys_id: v('r2'), number: v('RITM0000002'), short_description: v('Another one'), state: v('2', 'Open'), opened_at: v('2026-10-02 08:00:00') },
  ];
  const { items, access } = await history({}, {}, who, tables);
  assert.ok(!items.some((i) => i.table === 'sc_req_item'));
  assert.ok(!JSON.stringify(items).includes('Someone else'));
  const entry = access.find((a) => a.source === 'sc_req_item');
  assert.equal(entry.status, 'error');
  assert.match(entry.note, /did not narrow the results as asked/);
});

test('the second requester column is tried when the first one does not exist', async () => {
  const tables = buildInstance();
  // no requested_for on the item itself; the requester lives on the request (dotted column)
  tables.sc_req_item = [
    { sys_id: v('r1'), number: v('RITM0000001'), short_description: v('Mine'), state: v('2', 'Open'), active: v('true'), opened_at: v('2026-10-01 08:00:00'), request: v('q1', 'REQ1'), 'request.requested_for': v(ABEL.sysId, ABEL.name) },
    { sys_id: v('r2'), number: v('RITM0000002'), short_description: v('Not mine'), state: v('2', 'Open'), active: v('true'), opened_at: v('2026-10-02 08:00:00'), request: v('q2', 'REQ2'), 'request.requested_for': v(CHARLIE.sysId, CHARLIE.name) },
  ];
  const { items, deps } = await history({}, { tables: ['sc_req_item'] }, who, tables);
  assert.deepEqual(items.map((i) => i.number), ['RITM0000001']);
  assert.equal(deps.callsTo('sc_req_item').length, 2);
});

test('no caller, no reads', async () => {
  const deps = fakeDeps(buildInstance());
  const result = await readCallerHistory({ callerSysId: '' }, deps, { now: NOW });
  assert.deepEqual(result.items, []);
  assert.equal(result.access[0].status, 'skipped');
  assert.equal(deps.calls.length, 0);
  const bad = await readCallerHistory({ callerSysId: 'abc' }, deps, { now: NOW });
  assert.equal(bad.access[0].status, 'skipped');
});

test('a lost session is thrown, not noted', async () => {
  await assert.rejects(history({ expired: ['incident'] }), (err) => err.code === 'SESSION_EXPIRED');
});

test('the sources are the four tables of the brief', () => {
  assert.deepEqual(HISTORY_SOURCES.map((s) => s.table), ['incident', 'sc_req_item', 'sn_customerservice_case', 'sn_hr_core_case']);
  assert.deepEqual(HISTORY_SOURCES.filter((s) => s.sensitive).map((s) => s.table), ['sn_hr_core_case']);
});

// ---- Signals ----------------------------------------------------------------------------------------------------

test('signals over the fixture history', async () => {
  const { signals } = await history({}, { current: { short_description: 'VPN keeps disconnecting', category: 'Network' } });
  assert.equal(signals.openCount, 1, 'only the laptop ticket is still open; a resolved one is not');
  assert.equal(signals.repeatCount['keyword:vpn'], 4);
  assert.equal(signals.repeatCount['category:network'], 4);
  assert.deepEqual(signals.repeats[0], { kind: 'category', key: 'network', count: 4, numbers: ['INC0009001', 'INC0009150', 'INC0009588', 'INC0009640'] });
  assert.equal(signals.lastResolved.number, 'INC0009640');
  assert.equal(signals.lastResolved.close_notes, 'Replaced the expired gateway certificate on EU-2.');
  assert.equal(signals.lastResolved.close_code, 'Solution provided');
  assert.deepEqual(signals.reopenedHint, { earlier: 'INC0009588', later: 'INC0009640', days: 6, shared: ['vpn'] });
  assert.equal(signals.daysSinceLast, 6);
  // one shared keyword is enough when the category matches
  assert.deepEqual(signals.similarToCurrent, ['INC0009001', 'INC0009150', 'INC0009588', 'INC0009640']);
  // without a category it takes two shared keywords
  const strict = await history({}, { current: { short_description: 'VPN keeps disconnecting' } });
  assert.deepEqual(strict.signals.similarToCurrent, ['INC0009001']);
});

test('signals of an empty history', () => {
  assert.deepEqual(historySignals([], { now: NOW }), {
    openCount: 0,
    repeatCount: {},
    repeats: [],
    lastResolved: null,
    reopenedHint: null,
    daysSinceLast: null,
    similarToCurrent: [],
  });
});

test('openCount: resolved, closed and cancelled are not open; unknown state and active flag decide', () => {
  const items = [
    item({ number: 'A', state: 'In Progress', active: 'true' }),
    item({ number: 'B', state: 'Resolved', active: 'true', resolvedUtc: '2026-10-01 10:00:00' }),
    item({ number: 'C', state: 'Closed', active: 'false' }),
    item({ number: 'D', state: 'Canceled', active: '' }),
    item({ number: 'E', state: 'New', active: '' }),
    item({ number: 'F', state: 'On Hold', active: '' }),
  ];
  assert.equal(historySignals(items, { now: NOW }).openCount, 3);
});

test('repeats need two tickets and come with their numbers', () => {
  const items = [
    item({ number: 'A', short_description: 'Printer jams on floor 2', category: 'Hardware' }),
    item({ number: 'B', short_description: 'Printer offline', category: 'Hardware' }),
    item({ number: 'C', short_description: 'Cannot log in to SAP', category: 'Software' }),
  ];
  const { repeats, repeatCount } = historySignals(items, { now: NOW });
  assert.deepEqual(repeats.map((r) => [r.kind, r.key, r.count]), [['category', 'hardware', 2], ['keyword', 'printer', 2]]);
  assert.deepEqual(repeatCount, { 'category:hardware': 2, 'keyword:printer': 2 });
  assert.deepEqual(repeats[1].numbers, ['A', 'B']);
});

test('lastResolved is the most recent resolved ticket that has close notes', () => {
  const items = [
    item({ number: 'A', resolvedUtc: '2026-05-01 10:00:00', openedUtc: '2026-05-01 08:00:00', close_notes: 'old fix' }),
    item({ number: 'B', resolvedUtc: '2026-09-01 10:00:00', openedUtc: '2026-09-01 08:00:00', close_notes: '' }),
    item({ number: 'C', resolvedUtc: '2026-08-01 10:00:00', openedUtc: '2026-08-01 08:00:00', close_notes: 'newer fix', close_code: 'Workaround' }),
    item({ number: 'D', state: 'In Progress', active: 'true', openedUtc: '2026-10-01 08:00:00', close_notes: 'half written' }),
  ];
  const { lastResolved } = historySignals(items, { now: NOW });
  assert.equal(lastResolved.number, 'C');
  assert.equal(lastResolved.close_code, 'Workaround');
  assert.equal(historySignals(items.slice(1, 2), { now: NOW }).lastResolved, null);
});

test('reopenedHint: the same problem again within two weeks of a resolution, or a state that says reopened', () => {
  const first = item({ number: 'A', short_description: 'Cannot print to HP LaserJet', category: 'Hardware', openedUtc: '2026-10-01 08:00:00', resolvedUtc: '2026-10-02 08:00:00' });
  const again = item({ number: 'B', short_description: 'HP LaserJet prints blank pages', category: 'Hardware', openedUtc: '2026-10-05 08:00:00', state: 'New', active: 'true' });
  assert.deepEqual(historySignals([first, again], { now: NOW }).reopenedHint, { earlier: 'A', later: 'B', days: 3, shared: ['laserjet'] });

  const late = { ...again, openedUtc: '2026-11-20 08:00:00' };
  assert.equal(historySignals([first, late], { now: NOW }).reopenedHint, null, 'too long afterwards');
  const unrelated = { ...again, short_description: 'New monitor request', category: 'Hardware' };
  assert.equal(historySignals([first, unrelated], { now: NOW }).reopenedHint, null);
  const before = { ...again, openedUtc: '2026-09-25 08:00:00' };
  assert.equal(historySignals([first, before], { now: NOW }).reopenedHint, null, 'opened before the earlier one was resolved');

  const marked = item({ number: 'C', state: 'Reopened', openedUtc: '2026-10-05 08:00:00' });
  assert.deepEqual(historySignals([marked], { now: NOW }).reopenedHint, { earlier: '', later: 'C', days: 0, shared: [] });
});

test('normaliseHistoryRow reads display values, falls back from resolved_at to closed_at and resolution_code to close_code', () => {
  const row = {
    sys_id: v('ABCDEFABCDEFABCDEFABCDEFABCDEF12'),
    number: v('RITM1'),
    short_description: v('<p>Laptop &amp; dock</p>'),
    state: v('3', 'Closed Complete'),
    active: v('false'),
    cat_item: v('c', 'Standard Laptop'),
    closed_at: v('2026-10-02 08:00:00', '2026-10-02 10:00:00'),
    opened_at: v('2026-10-01 08:00:00', '2026-10-01 10:00:00'),
    resolution_code: v('', 'Fulfilled'),
  };
  const out = normaliseHistoryRow(row, 'sc_req_item');
  assert.equal(out.sysId, 'abcdefabcdefabcdefabcdefabcdef12');
  assert.equal(out.short_description, 'Laptop & dock');
  assert.equal(out.category, 'Standard Laptop');
  assert.equal(out.resolved_at, '2026-10-02 10:00:00');
  assert.equal(out.resolvedUtc, '2026-10-02 08:00:00');
  assert.equal(out.close_code, 'Fulfilled');
});
