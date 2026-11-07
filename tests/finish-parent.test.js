import test from 'node:test';
import assert from 'node:assert/strict';
import { readContextPack } from '../src/context/pack.js';
import { FEATURE_FIELDS, FEATURE_MASK_ONLY, FEATURES, FIELDS_BY_KIND, featureListsColumn } from '../src/context/allowlists.js';
import { PARENT_PERSON, PARENT_PERSON_FEATURES, PARENT_PERSON_LINK } from '../src/context/specs/fit.js';
import { PERSON_FIELDS } from '../src/context/people.js';
import { kindForTable, isSensitiveTable } from '../src/context/kinds.js';
import { identities } from '../src/context/identity.js';
import { callerOf } from '../src/domain/callerTickets.js';
import { callerUnreadable } from '../src/sidepanel/ticket/cards/data.js';
import { glanceDetails } from '../src/sidepanel/ticket/cards/Glance.jsx';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { userRows, ABEL, BETH, DAVE, ERIN, HANA, JANE } from './fixtures/sn-users.js';

// Audit of 2026-11-07, F15: a task of an incident, a change or a case is for the person of that PARENT, not for whoever opened it. One small
// read of the parent (src/context/related.js readParentPerson); the person is a person of the pack under the role of the column, exactly as the
// requester of a catalog task is (tests/fit-parent.test.js), so the caller card, the greeting, the briefing and the masking all follow.

const TASK_ID = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b001';
const PARENT_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c001';
const AGENT = { sysId: '1'.repeat(32), name: 'Workflow Robot' };

function taskRow(over = {}) {
  return {
    sys_id: v(TASK_ID),
    number: v('INT0000001'),
    short_description: v('Check the router'),
    description: v('Look at the router in the closet.'),
    state: v('1', 'Open'),
    priority: v('3', '3 - Moderate'),
    assignment_group: v('a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d', 'Network Support'),
    assigned_to: v(BETH.sysId, BETH.name),
    opened_by: v(AGENT.sysId, AGENT.name),
    opened_at: v('2026-10-23 09:00:00', '2026-10-23 11:00:00'),
    sys_updated_on: v('2026-10-26 08:00:00', '2026-10-26 10:00:00'),
    closed_at: v('', ''),
    close_notes: v('', ''),
    contact_type: v('', ''),
    reassignment_count: v('0', '0'),
    parent: v(PARENT_ID, 'INC0010001'),
    ...over,
  };
}

const parentRow = (over = {}) => ({ sys_id: v(PARENT_ID), number: v('INC0010001'), ...over });

function instance(taskTable, task, parentTable, parent) {
  return { sys_user: userRows(), task_sla: [], task: [], [taskTable]: [task], ...(parentTable ? { [parentTable]: [parent] } : {}) };
}

const read = (table, tables, { feature = 'insights-ticket', allowSensitive = false, behaviour, deps = {} } = {}) => {
  const fake = Object.assign(fakeDeps(tables, behaviour), deps);
  return readContextPack({ table, sysId: TASK_ID }, fake, { feature, allowSensitive }).then((pack) => ({ pack, fake }));
};

// ---- the four classes ---------------------------------------------------------------------------------------------------------------------

test('F15: the task of an incident is for the incident\'s caller, not for the agent who opened it', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const { pack, fake } = await read('incident_task', tables);
  assert.equal(pack.kind, 'task');
  const who = pack.people.find((p) => p.role === 'caller');
  assert.ok(who, 'a person of the pack, so the firewall masks the name wherever the text mentions it (build rule 4)');
  assert.equal(who.name, 'Abel Tuter');
  assert.equal(who.email, 'abel.tuter@example.com', 'with the email sys_user gives');
  assert.deepEqual(callerOf(pack), { role: 'caller', sysId: ABEL.sysId }, 'the caller card and the briefing look this person up, not the opener');
  assert.equal(pack.fields.caller_id, 'Abel Tuter');
  const ask = fake.callsTo('incident');
  assert.equal(ask.length, 1, 'ONE small read of the parent');
  assert.equal(ask[0].query, `sys_id=${PARENT_ID}`, 'by the id the task\'s own parent column holds');
  assert.deepEqual(ask[0].fields, ['sys_id', 'caller_id'], 'the columns the spec gives, no more');
  assert.equal(pack.unreadable, undefined);
  // the Ticket details name them
  const rows = glanceDetails(pack, Date.now());
  assert.deepEqual(rows.find((r) => r.key === 'caller'), { key: 'caller', label: 'Caller', value: 'Abel Tuter' });
  assert.equal(rows.find((r) => r.key === 'parent').value, 'INC0010001');
});

test('F15: the task of a change is for the person who asked for the change', async () => {
  const tables = instance('change_task', taskRow({ number: v('CTASK0000001') }), 'change_request', parentRow({ requested_by: v(DAVE.sysId, DAVE.name) }));
  const { pack, fake } = await read('change_task', tables);
  assert.equal(pack.people.find((p) => p.role === 'requested_by')?.name, DAVE.name);
  assert.deepEqual(callerOf(pack), { role: 'requested_by', sysId: DAVE.sysId });
  assert.equal(pack.fields.requested_by, DAVE.name);
  assert.deepEqual(fake.callsTo('change_request')[0].fields, ['sys_id', 'requested_by']);
  assert.equal(glanceDetails(pack, Date.now()).find((r) => r.key === 'caller').label, 'Requested by');
});

test('F15: the task of a customer service case is for the case\'s contact, and carries its account', async () => {
  const tables = instance('sn_customerservice_task', taskRow({ number: v('CSTASK0000001') }), 'sn_customerservice_case', parentRow({ contact: v(ERIN.sysId, ERIN.name), consumer: v('', ''), account: v('acc1', 'Acme Corp') }));
  const { pack, fake } = await read('sn_customerservice_task', tables);
  assert.equal(pack.kind, 'task');
  assert.equal(pack.people.find((p) => p.role === 'contact')?.name, ERIN.name);
  assert.deepEqual(callerOf(pack), { role: 'contact', sysId: ERIN.sysId });
  assert.equal(pack.fields.contact, ERIN.name);
  assert.equal(pack.fields.account, 'Acme Corp', 'the priority-account mark of the glance is the account\'s');
  assert.deepEqual(fake.callsTo('sn_customerservice_case')[0].fields, ['sys_id', 'contact', 'consumer', 'account']);
  assert.equal(pack.unreadable, undefined, 'a case that names a contact and no consumer is not an unreadable one');
  assert.equal(glanceDetails(pack, Date.now()).find((r) => r.key === 'caller').label, 'Contact');
});

test('F15: a business-to-consumer case is for its consumer', async () => {
  const tables = instance('sn_customerservice_task', taskRow(), 'sn_customerservice_case', parentRow({ contact: v('', ''), consumer: v(HANA.sysId, HANA.name), account: v('', '') }));
  tables.csm_consumer = [{ sys_id: HANA.sysId, name: HANA.name, email: HANA.email, first_name: 'Hana', last_name: 'Rivera' }];
  const { pack } = await read('sn_customerservice_task', tables);
  assert.equal(pack.people.find((p) => p.role === 'consumer')?.name, HANA.name);
  assert.deepEqual(callerOf(pack), { role: 'consumer', sysId: HANA.sysId });
});

test('F15: the task of an HR case is for the case\'s employee ONLY when sensitive content is allowed; without it the case is not even read', async () => {
  const tables = instance('sn_hr_core_task', taskRow({ number: v('HRT0000001') }), 'sn_hr_core_case', parentRow({ subject_person: v(JANE.sysId, 'Jane Doe') }));
  const without = await read('sn_hr_core_task', tables, { feature: 'insights-ticket', allowSensitive: false });
  assert.equal(without.fake.callsTo('sn_hr_core_case').length, 0, 'nothing of the HR case is read');
  assert.ok(!without.pack.people.some((p) => p.role === 'subject_person'));
  assert.equal(without.pack.fields.subject_person, undefined);
  assert.ok(callerUnreadable(without.pack), 'and the card says the people were not read, not "nobody"');
  const allowed = await read('sn_hr_core_task', tables, { feature: 'insights-ticket', allowSensitive: true });
  assert.equal(allowed.pack.people.find((p) => p.role === 'subject_person')?.name, 'Jane Doe');
  assert.deepEqual(allowed.fake.callsTo('sn_hr_core_case')[0].fields, ['sys_id', 'subject_person']);
  assert.equal(callerOf(allowed.pack)?.sysId, JANE.sysId, 'the employee, found under subject_person as an HR case\'s employee is');
});

test('F15: a problem task and any other task have no person to take: nothing more is read, and the opener is not made the caller of a problem', async () => {
  const problemTask = instance('problem_task', taskRow({ number: v('PTASK0000001') }), 'problem', parentRow({ number: v('PRB0000001') }));
  const a = await read('problem_task', problemTask);
  assert.equal(a.fake.callsTo('problem').length, 0);
  assert.equal(a.pack.unreadable, undefined);
  assert.equal(callerOf(a.pack), null, 'the work of a problem has no customer (F22)');
  const plain = instance('task', taskRow({ number: v('TASK0000001'), sys_class_name: v('task') }), null, null);
  const b = await read('task', plain);
  assert.equal(b.fake.calls.filter((c) => c.table === 'incident' || c.table === 'change_request').length, 0);
  assert.ok(!b.pack.people.some((p) => ['caller', 'requested_by', 'contact', 'consumer', 'subject_person'].includes(p.role)));
  // a custom table that is a kind of task: nothing says whose it is
  assert.equal(Object.hasOwn(PARENT_PERSON, 'problem_task'), false);
  assert.equal(Object.hasOwn(PARENT_PERSON, 'task'), false);
});

// ---- what is not known is not "nobody" ----------------------------------------------------------------------------------------------------

test('F15: the parent names nobody: nobody is named, and nothing is unreadable', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v('', '') }));
  const { pack } = await read('incident_task', tables);
  assert.ok(!pack.people.some((p) => p.role === 'caller'));
  assert.equal(pack.unreadable, undefined);
  assert.equal(pack.fields.caller_id, undefined);
  assert.ok(!callerUnreadable(pack) || pack.access.some((a) => a.source === 'incident_task' && a.status === 'skipped') === false);
});

test('F15: a task with no parent reads no parent', async () => {
  const tables = instance('incident_task', taskRow({ parent: v('', '') }), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const { pack, fake } = await read('incident_task', tables);
  assert.equal(fake.callsTo('incident').length, 0);
  assert.equal(pack.unreadable, undefined);
  assert.equal(pack.related.parent, undefined);
});

test('F15: the organisation blocks the parent\'s table: no read, a "blocked" entry, and the person is "could not read"', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const { pack, fake } = await read('incident_task', tables, { deps: { isBlocked: (table) => table === 'incident' } });
  assert.equal(fake.callsTo('incident').length, 0, 'the read is not even made');
  assert.ok(pack.access.some((a) => a.source === 'incident' && a.status === 'blocked'));
  assert.ok(pack.unreadable.includes('caller_id'));
  assert.ok(!pack.people.some((p) => p.role === 'caller'));
  assert.equal(pack.fields.number, 'INT0000001', 'the task itself is still read');
});

test('F15: the policy guard\'s refusal of the parent read is the same "blocked" (a table the deps refuse)', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const base = fakeDeps(tables);
  const refuse = async (table, ...rest) => {
    if (table === 'incident') {
      const err = new Error('Your organisation does not allow Agent Buddy to read this.');
      err.code = 'BLOCKED_TABLE';
      throw err;
    }
    return base.queryTable(table, ...rest);
  };
  const pack = await readContextPack({ table: 'incident_task', sysId: TASK_ID }, { ...base, queryTable: refuse, fetchRecord: async (t, id, f, o) => (await refuse(t, `sys_id=${id}`, f, { ...o, limit: 1 }))[0] || null }, { feature: 'insights-ticket' });
  assert.ok(pack.access.some((a) => a.source === 'incident' && a.status === 'blocked'));
  assert.ok(pack.unreadable.includes('caller_id'));
});

test('F15: the parent is refused or not visible to this user: "could not read", never "nobody" and never the opener', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const denied = await read('incident_task', tables, { behaviour: { denied: ['incident'] } });
  assert.ok(denied.pack.unreadable.includes('caller_id'));
  assert.ok(denied.pack.access.some((a) => a.source === 'incident' && a.status === 'denied'));
  assert.equal(callerUnreadable(denied.pack), true);
  // a row rule hides it: 200 with no rows
  const hidden = await read('incident_task', tables, { behaviour: { hidden: ['incident'] } });
  assert.ok(hidden.pack.unreadable.includes('caller_id'));
  assert.ok(hidden.pack.access.some((a) => a.source === 'incident' && a.status === 'denied'));
  assert.ok(!hidden.pack.people.some((p) => p.role === 'caller'));
  // the caller column is one this user may not read: the key is missing from the row
  const missing = instance('incident_task', taskRow(), 'incident', parentRow());
  const gone = await read('incident_task', missing);
  assert.ok(gone.pack.unreadable.includes('caller_id'));
  // the caller is named by an id and the name came back empty (hidden)
  const noName = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, '') }));
  const unnamed = await read('incident_task', noName);
  assert.ok(unnamed.pack.unreadable.includes('caller_id'));
});

test('F15: the task\'s own parent column is hidden from this user: the person is unread, with the reason', async () => {
  const row = taskRow();
  delete row.parent;
  const { pack, fake } = await read('incident_task', instance('incident_task', row, 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') })));
  assert.equal(fake.callsTo('incident').length, 0);
  assert.ok(pack.unreadable.includes('caller_id'));
  assert.ok(pack.access.some((a) => a.source === 'incident_task' && a.status === 'denied'));
});

test('F15: a parent the instance returns for another id (a condition it ignored) is not used', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', { sys_id: v('9'.repeat(32)), caller_id: v(ABEL.sysId, 'Abel Tuter') });
  const base = fakeDeps(tables);
  const leaky = { ...base, queryTable: async (table, query, fields, options) => (table === 'incident' ? base.queryTable(table, '', fields, options) : base.queryTable(table, query, fields, options)) };
  const pack = await readContextPack({ table: 'incident_task', sysId: TASK_ID }, leaky, { feature: 'insights-ticket' });
  assert.ok(!pack.people.some((p) => p.role === 'caller'), 'not the caller of some other incident');
  assert.ok(pack.unreadable.includes('caller_id'));
});

// ---- what reads it ------------------------------------------------------------------------------------------------------------------------

test('F15: every feature that names a person reads the parent for the name (masking), and is a field of the pack only for a feature that lists the column', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  for (const feature of ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'missing-info', 'next-best-action', 'caller-briefing', 'insights-ticket']) {
    const { pack, fake } = await read('incident_task', tables, { feature });
    assert.equal(fake.callsTo('incident').length, 1, feature);
    assert.ok(pack.people.some((p) => p.role === 'caller' && p.name === 'Abel Tuter'), feature);
  }
  // the caller briefing lists no person column of its own: the person is on the people list and is not a field
  const brief = await read('incident_task', tables, { feature: 'caller-briefing' });
  assert.equal(brief.pack.fields.caller_id, undefined);
  const summary = await read('incident_task', tables, { feature: 'record-summary' });
  assert.equal(summary.pack.fields.caller_id, 'Abel Tuter');
});

test('F15: the searches read no parent, and a one-kind domain feature asked about a task reads nothing more of it', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  for (const feature of ['caller-history', 'similar', 'kb-recs', 'hr-case-brief', 'problem-rca']) {
    const { fake } = await read('incident_task', tables, { feature });
    assert.equal(fake.callsTo('incident').length, 0, feature);
    assert.ok(!FEATURE_FIELDS[feature].task.includes(PARENT_PERSON_LINK), feature);
  }
  for (const id of PARENT_PERSON_FEATURES) assert.ok(FEATURES.includes(id), id);
  // where the link is read only for the people, it is not a field of the pack
  assert.ok(FEATURE_MASK_ONLY['caller-briefing'].task.includes(PARENT_PERSON_LINK));
  assert.ok(!FEATURE_MASK_ONLY['record-summary'].task.includes(PARENT_PERSON_LINK), 'record-summary lists it (Part of ...)');
});

test('F15: the spec: each class\'s parent and columns are on the parent kind\'s ceiling, every person column has a role, and an HR parent is a sensitive table', () => {
  const kindOf = { incident: 'incident', change_request: 'change', sn_customerservice_case: 'case', sn_hr_core_case: 'hr_case' };
  for (const [table, walk] of Object.entries(PARENT_PERSON)) {
    assert.equal(kindForTable(table), 'task', table);
    assert.equal(FIELDS_BY_KIND.task.includes(PARENT_PERSON_LINK), true, 'every task has the link');
    const kind = kindOf[walk.table];
    assert.ok(kind, walk.table);
    assert.equal(kindForTable(walk.table), kind, walk.table);
    for (const column of walk.columns) {
      assert.ok(FIELDS_BY_KIND[kind].includes(column), `${walk.table}.${column} is on the ${kind} ceiling`);
      if (column !== 'account') assert.ok(PERSON_FIELDS[column], `${column} has a role`);
    }
    assert.equal(walk.sensitive, isSensitiveTable(walk.table), `${table}: sensitive is the table's own`);
    assert.ok(Object.isFrozen(walk) && Object.isFrozen(walk.columns));
  }
  assert.ok(featureListsColumn('insights-ticket', 'account') && featureListsColumn('record-summary', 'contact'));
  assert.equal(featureListsColumn('caller-briefing', 'caller_id'), false);
  assert.equal(featureListsColumn('no-such-feature', 'caller_id'), false);
});

test('F15: the task\'s people do not turn its comments into a conversation with the customer (the person does not write on a task)', async () => {
  const tables = instance('incident_task', taskRow(), 'incident', parentRow({ caller_id: v(ABEL.sysId, 'Abel Tuter') }));
  const { pack } = await read('incident_task', tables);
  const ids = identities(pack);
  assert.ok(ids.customers.size > 0, 'the caller is a customer of the pack');
  assert.equal(ids.known, false, 'but nobody who wrote on the task can be told from support');
  assert.equal(identities({ ...pack, kind: 'incident' }).known, true, 'on an incident it is, as before');
});
