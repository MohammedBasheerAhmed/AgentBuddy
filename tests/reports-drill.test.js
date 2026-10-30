const test = require('node:test');
const assert = require('node:assert/strict');
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const run = (request, instance) => runReport(request, { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

test('probing the tables costs one read per readable table (the row also shows the columns)', async () => {
  const inst = fakeInstance();
  await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['incident', 'problem', 'sc_task'] }, inst);
  const probes = inst.calls.filter((c) => c.kind === 'query' && c.query === '');
  assert.deepEqual(probes.filter((c) => c.table !== 'task_sla').map((c) => c.table).sort(), ['incident', 'problem', 'sc_task']);
  assert.ok(probes.every((c) => c.options.limit === 1));
  // The SLA count was 0, so ONE more one-row read checks that SLA records are visible at all before "0 breached" is believed.
  assert.equal(probes.filter((c) => c.table === 'task_sla').length, 1);
});

test('a table that shows nothing is probed once more to tell "hidden" from "denied"', async () => {
  const inst = fakeInstance({ hidden: ['problem'] });
  await run({ section: 'overview', scope: { kind: 'mine' }, tables: ['problem'] }, inst);
  const probes = inst.calls.filter((c) => c.kind === 'query' && c.query === '' && c.table === 'problem');
  assert.equal(probes.length, 2, 'the column probe, then the plain "can you see any row" read');
});

test('workload rows carry the query that lists exactly that person\'s open tickets, per table', async () => {
  const q = `assignment_groupIN${GROUP_A}`;
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to,state', then: [group2('assigned_to', 'a1', 'Ann Lee', 'state', '2', 'In Progress', 5), group2('assigned_to', '', '', 'state', '1', 'New', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assignment_group,state', then: [group2('assignment_group', GROUP_A, 'Service Desk', 'state', '2', 'In Progress', 7)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 0, then: count(7) },
    ],
  });
  const d = (await run({ section: 'workload', scope: { kind: 'groups' }, tables: ['incident'] }, inst)).data;
  const ann = d.byAssignee.find((r) => r.id === 'a1');
  assert.equal(ann.queries.incident, `${q}^active=true^assigned_to=a1`);
  const nobody = d.byAssignee.find((r) => r.id === '');
  assert.equal(nobody.queries.incident, `${q}^active=true^assigned_toISEMPTY`);
  assert.equal(d.byGroup[0].queries.incident, `${q}^active=true^assignment_group=${GROUP_A}`);
});

test('ageing buckets carry the date range query the counts used', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 0, then: count(9) },
    ],
  });
  const { queries } = (await run({ section: 'workload', scope: { kind: 'groups' }, tables: ['incident'] }, inst)).data.ageing;
  const q = `assignment_groupIN${GROUP_A}^active=true`;
  assert.equal(queries['d0-1'], `${q}^opened_at>2026-10-25 12:00:00`);
  assert.equal(queries['d2-3'], `${q}^opened_at>2026-10-23 12:00:00^opened_at<=2026-10-25 12:00:00`);
  assert.equal(queries['d8-14'], `${q}^opened_at>2026-10-12 12:00:00^opened_at<=2026-10-19 12:00:00`);
  assert.equal(queries['d15+'], `${q}^opened_at<=2026-10-12 12:00:00`);
});

test('fulfilment states carry a query per state value', async () => {
  const inst = fakeInstance({
    rules: [
      { when: (c) => c.kind === 'aggregate' && c.table === 'sc_req_item' && c.groupBy[0] === 'state', then: [group('state', '2', 'Work in Progress', 6), group('state', '', '(none)', 1)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 0, then: count(7) },
    ],
  });
  const d = (await run({ section: 'fulfilment', scope: { kind: 'mine' }, tables: ['sc_req_item'] }, inst)).data;
  assert.deepEqual(d.byTable[0].stateQuery, { 2: `assigned_to=${USER}^active=true^state=2` });
});
