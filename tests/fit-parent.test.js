import test from 'node:test';
import assert from 'node:assert/strict';
import { readContextPack, resolveRealClass } from '../src/context/pack.js';
import { FEATURE_FIELDS, FEATURE_MASK_ONLY, FIELDS_BY_KIND, PERSON_COLUMNS, SEARCH_ONLY_FEATURES, allowedFields, maskOnlyFields } from '../src/context/allowlists.js';
import { PERSON_FIELDS } from '../src/context/people.js';
import { forgetTaskClasses, isTicketTable, kindForTable, rememberTaskClass, taskRowEvidence } from '../src/context/kinds.js';
import { relatedPlan } from '../src/context/related.js';
import { callerOf } from '../src/domain/callerTickets.js';
import { customersOf, identities } from '../src/context/identity.js';
import { featureById } from '../src/features/registry.js';
import { labelFor } from '../src/features/parts.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { RITM_ID, RITM_NUMBER } from './fixtures/sn-requested-item.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { BETH, CHARLIE } from './fixtures/sn-users.js';

// Audit of 2026-11-07, F1/F2/F7/F18: a catalog task is one step of a requested item. Its requester and item live on the item, so they are
// walked from the task's own request_item in the same read; the answers of the request form are read from the item; a custom table that
// is a kind of task is read as one.

const TASK_ID = 'c0ffee00c0ffee00c0ffee00c0ffee01';

function taskRow(over = {}) {
  return {
    sys_id: v(TASK_ID),
    number: v('SCTASK0010099'),
    short_description: v('Deliver the laptop'),
    description: v('Take the laptop to the third floor.'),
    state: v('2', 'Work in Progress'),
    priority: v('3', '3 - Moderate'),
    request_item: v(RITM_ID, RITM_NUMBER),
    'request_item.requested_for': v(CHARLIE.sysId, CHARLIE.name),
    'request_item.cat_item': v('ci1', 'Standard Laptop'),
    assignment_group: v('a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d', 'Desktop Support'),
    assigned_to: v(BETH.sysId, BETH.name),
    opened_by: v('1'.repeat(32), 'Workflow Robot'),
    opened_at: v('2026-10-23 09:00:00', '2026-10-23 11:00:00'),
    sys_updated_on: v('2026-10-26 08:00:00', '2026-10-26 10:00:00'),
    closed_at: v('', ''),
    due_date: v('', ''),
    close_notes: v('', ''),
    hold_reason: v('', ''),
    comments: v('', ''),
    work_notes: v('', ''),
    ...over,
  };
}

function instance(row = taskRow()) {
  const tables = buildInstance();
  tables.sc_task = [row];
  return tables;
}

const read = (tables, feature = 'record-summary', behaviour, deps = {}) => {
  const fake = Object.assign(fakeDeps(tables, behaviour), deps);
  return readContextPack({ table: 'sc_task', sysId: TASK_ID }, fake, { feature }).then((pack) => ({ pack, fake }));
};

test('F1: the requester of the requested item is a person of the catalog task, and the item is its catalog item', async () => {
  const { pack, fake } = await read(instance());
  assert.equal(pack.kind, 'catalog_task');
  assert.equal(pack.fields.requested_for, CHARLIE.name, 'named as the pack names it on the item');
  assert.equal(pack.fields.cat_item, 'Standard Laptop');
  const asked = fake.callsTo('sc_task')[0].fields;
  assert.ok(asked.includes('request_item.requested_for') && asked.includes('request_item.cat_item') && asked.includes('request_item'));
  const who = pack.people.find((p) => p.role === 'requested_for');
  assert.ok(who, 'on the people list, so the firewall masks the name wherever the text mentions it (build rule 4)');
  assert.equal(who.name, CHARLIE.name);
  assert.equal(who.email, CHARLIE.email);
  assert.deepEqual(callerOf(pack), { role: 'requested_for', sysId: CHARLIE.sysId });
  assert.deepEqual(customersOf(pack).map((p) => p.name), [CHARLIE.name], 'the customer check works from the requester');
  // the requester is known, but they do not read a catalog task's comments: nobody who wrote there is 'the customer' or 'support'
  assert.equal(identities(pack).known, false);
  assert.equal(identities({ ...pack, kind: 'requested_item' }).known, true, 'on the item itself they do');
  assert.equal(pack.unreadable, undefined);
});

test('F1: a feature that does not list the requester still reads it, for its name only (it is not a field of the pack)', async () => {
  assert.ok(allowedFields('sc_task', 'account-briefing').includes('request_item.requested_for'));
  assert.ok(maskOnlyFields('sc_task', 'account-briefing').includes('request_item.requested_for'));
  const { pack } = await read(instance(), 'account-briefing');
  assert.equal(pack.fields.requested_for, undefined);
  assert.ok(pack.people.some((p) => p.role === 'requested_for' && p.name === CHARLIE.name));
});

test('F1: the walked columns are on the ceiling and on the person list, like every person column', () => {
  assert.ok(FIELDS_BY_KIND.catalog_task.includes('request_item.requested_for'));
  assert.ok(FIELDS_BY_KIND.catalog_task.includes('request_item.cat_item'));
  assert.ok(PERSON_COLUMNS.includes('request_item.requested_for'));
  assert.equal(PERSON_FIELDS['request_item.requested_for'], 'requested_for');
  // the other kinds do not have them
  for (const kind of Object.keys(FIELDS_BY_KIND)) if (kind !== 'catalog_task') assert.ok(!FIELDS_BY_KIND[kind].some((name) => name.includes('.')), kind);
  // every feature that sends text reads the walked requester (it may name the person in a title or a note)
  for (const id of Object.keys(FEATURE_FIELDS)) {
    // (the search-only features send nothing to an AI; the list is the engine's own, so a new one, such as 'fulfilled-before', needs no edit here)
    if (SEARCH_ONLY_FEATURES.includes(id)) continue;
    assert.ok(FEATURE_FIELDS[id].catalog_task.includes('request_item.requested_for'), id);
  }
  assert.ok(FEATURE_MASK_ONLY['kb-recs'].catalog_task.length === 0 || !FEATURE_MASK_ONLY['kb-recs'].catalog_task.includes('request_item.requested_for'));
});

test('F18: the look-alike and article searches of a catalog task carry the catalog item', () => {
  for (const id of ['similar', 'kb-recs', 'record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'missing-info', 'next-best-action']) assert.ok(FEATURE_FIELDS[id].catalog_task.includes('request_item.cat_item'), id);
  assert.ok(!FEATURE_MASK_ONLY['similar'].catalog_task.includes('request_item.cat_item'), 'it is a field of the pack, not read for its name');
  assert.ok(FEATURE_FIELDS['caller-history'].catalog_task.includes('request_item.requested_for'), 'the caller-history search reads who the task is for');
});

test('F2: the answers of the request form come with the catalog task, read from the item (not from the task)', async () => {
  const { pack, fake } = await read(instance());
  assert.ok(Array.isArray(pack.related.variables) && pack.related.variables.length > 0, 'answers');
  assert.ok(pack.related.variables.some((a) => a.question === 'Operating system' && a.value === 'Windows 11'));
  const call = fake.callsTo('sc_item_option_mtom')[0];
  assert.equal(call.query, `request_item=${RITM_ID}`, 'the item\'s id, never the task\'s');
  assert.ok(!fake.calls.some((c) => c.query.includes(`request_item=${TASK_ID}`)));
  assert.ok(pack.people.some((p) => p.role === 'variable_reference'), 'a person named in an answer is masked too');
  assert.ok(relatedPlan({ kind: 'catalog_task', feature: 'record-summary' }).includes('variables'));
});

test('F2: every feature that lists the answers gets them on a catalog task; one that does not, does not read them', async () => {
  for (const feature of ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'missing-info', 'next-best-action', 'fulfilment-checklist']) {
    const { pack } = await read(instance(), feature);
    assert.ok(Array.isArray(pack.related.variables), feature);
  }
  const { fake } = await read(instance(), 'sentiment-risk');
  assert.equal(fake.callsTo('sc_item_option_mtom').length, 0);
});

test('F2: a task with no requested item reads no answers and says so; nobody is invented', async () => {
  const row = taskRow({ request_item: v('', ''), 'request_item.requested_for': v('', ''), 'request_item.cat_item': v('', '') });
  const { pack, fake } = await read(instance(row));
  assert.equal(fake.callsTo('sc_item_option_mtom').length, 0);
  assert.equal(pack.related.variables, undefined);
  const entry = pack.access.find((a) => a.source === 'sc_item_option_mtom');
  assert.equal(entry.status, 'skipped');
  assert.match(entry.note, /no requested item that you can see/);
  assert.equal(pack.unreadable, undefined, 'a task with no item has no hidden requester');
  assert.equal(pack.people.some((p) => p.role === 'requested_for'), false);
});

test('F1: an item that is there but whose requester came back empty is "could not read", not "nobody" (R-14)', async () => {
  const row = taskRow({ 'request_item.requested_for': v('', ''), 'request_item.cat_item': v('', '') });
  const { pack } = await read(instance(row));
  assert.ok(pack.unreadable.includes('requested_for') && pack.unreadable.includes('cat_item'));
  assert.equal(pack.fields.requested_for, undefined);
  // and a column the instance did not send at all is listed under the name the pack uses
  const gone = taskRow();
  delete gone['request_item.requested_for'];
  const { pack: other } = await read(instance(gone));
  assert.ok(other.unreadable.includes('requested_for'));
  assert.ok(!other.unreadable.includes('request_item.requested_for'));
});

test('F1: when the organisation blocks requested items the walk is not made (the whole read would fail) and the pack says so', async () => {
  const tables = instance();
  const fake = fakeDeps(tables);
  const guarded = { ...fake, isBlocked: (table) => table === 'sc_req_item' };
  const pack = await readContextPack({ table: 'sc_task', sysId: TASK_ID }, guarded, { feature: 'record-summary' });
  const asked = fake.callsTo('sc_task')[0].fields;
  assert.ok(!asked.some((name) => name.startsWith('request_item')), 'no dot-walk, no link');
  assert.equal(fake.callsTo('sc_item_option_mtom').length, 0);
  assert.ok(pack.access.some((a) => a.source === 'sc_req_item' && a.status === 'blocked'));
  assert.ok(pack.unreadable.includes('requested_for'));
  assert.equal(pack.fields.number, 'SCTASK0010099', 'the task itself is still read');
});

test('F1: other kinds are read as before (no walked column, no parent)', async () => {
  const fake = fakeDeps(buildInstance());
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, fake, { feature: 'record-summary' });
  assert.ok(!fake.callsTo('sc_req_item')[0].fields.some((name) => name.includes('.')));
  assert.equal(pack.fields.requested_for, CHARLIE.name);
});

// ---- F7: a custom table that is a kind of task --------------------------------------------------------------------------------------

test('F7: a custom table whose row carries the columns only a task has is read, and described, as a task', async () => {
  forgetTaskClasses();
  try {
    const id = 'd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0';
    const row = {
      sys_id: v(id), number: v('FAC0001001'), short_description: v('Move the desk'), state: v('1', 'New'), priority: v('4', '4 - Low'),
      assignment_group: v('', ''), assigned_to: v('', ''), opened_by: v(BETH.sysId, BETH.name), opened_at: v('2026-10-23 09:00:00'),
      sys_updated_on: v('2026-10-23 09:00:00'), closed_at: v('', ''), close_notes: v('', ''), parent: v('', ''), description: v('', ''),
    };
    assert.equal(kindForTable('u_facilities_request'), 'other');
    const pack = await readContextPack({ table: 'u_facilities_request', sysId: id }, fakeDeps({ u_facilities_request: [row], sys_user: buildInstance().sys_user, task_sla: [] }), { feature: 'record-summary' });
    assert.equal(pack.kind, 'task', 'the pack says what it is');
    assert.equal(kindForTable('u_facilities_request'), 'task', 'and the next look at the table agrees');
    assert.equal(isTicketTable('u_facilities_request'), true);
    assert.equal(pack.related.slas !== undefined || pack.access.some((a) => a.source === 'task_sla'), true, 'a task\'s SLAs are looked up');
  } finally {
    forgetTaskClasses();
  }
});

test('F7: a custom table without those columns stays "other"; nothing is remembered', async () => {
  forgetTaskClasses();
  const id = 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0';
  const row = { sys_id: v(id), number: v('X1'), short_description: v('A thing'), state: v('1', 'New'), priority: v('1') };
  const pack = await readContextPack({ table: 'u_things', sysId: id }, fakeDeps({ u_things: [row] }), { feature: 'record-summary' });
  assert.equal(pack.kind, 'other');
  assert.equal(kindForTable('u_things'), 'other');
  assert.equal(taskRowEvidence({ opened_at: '', opened_by: '' }), false, 'all three columns are needed');
  assert.equal(taskRowEvidence({ opened_at: '', opened_by: '', assignment_group: '' }), true);
  assert.equal(taskRowEvidence(null), false);
});

test('F7: the real class a record reports through `task` is remembered when the product does not know it by name', async () => {
  forgetTaskClasses();
  try {
    const id = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
    const deps = { queryTable: async () => [{ sys_id: id, sys_class_name: 'u_site_visit' }] };
    assert.deepEqual(await resolveRealClass({ table: 'task', sysId: id }, deps), { table: 'u_site_visit', unresolved: false });
    assert.equal(kindForTable('u_site_visit'), 'task');
    // a class the product knows is never "remembered": it already has its kind
    assert.equal(rememberTaskClass('incident'), false);
    assert.equal(rememberTaskClass('sn_hr_core_case_payroll'), false);
    assert.equal(rememberTaskClass('not a table'), false);
    assert.equal(rememberTaskClass('task'), false);
    assert.equal(kindForTable('sn_hr_core_case_payroll'), 'hr_case');
  } finally {
    forgetTaskClasses();
  }
});

test('F7: the memory is bounded and holds table names only', () => {
  forgetTaskClasses();
  try {
    for (let i = 0; i < 260; i += 1) rememberTaskClass(`u_custom_${i}`);
    assert.equal(kindForTable('u_custom_259'), 'task');
    assert.equal(kindForTable('u_custom_0'), 'other', 'the oldest were dropped');
  } finally {
    forgetTaskClasses();
  }
});

// ---- F2 end to end: what the AI is given for a catalog task, and the name of the requester is masked --------------------------------------

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const outgoing = (prepared) => prepared.request.messages.map((m) => m.content).join('\n');

test('F2: the summary of a catalog task is given the requester, the item and the answers of the form; the requester\'s name is masked wherever it appears', async () => {
  const row = taskRow({ short_description: v('Deliver the laptop to Charlie Whitherspoon') });
  const { pack } = await read(instance(row), 'record-summary');
  const feature = featureById('record-summary');
  const labels = feature.parts(pack).map((p) => p.label);
  for (const label of ['Requested for', 'Catalog item', 'Answers to the request form']) assert.ok(labels.includes(label), label);
  assert.ok(labels.includes('Requested item'), 'the item\'s number: the field has a name of its own, not "Request item"');
  const prepared = prepareRun({ feature, pack, values: values(), policy: normalizePolicy({}), config: config(), createFirewall });
  const text = outgoing(prepared);
  assert.ok(!/Charlie|Whitherspoon/.test(text), 'the requester is on the people list, so the name is masked in the title and in the field');
  assert.match(text, /Windows 11/, 'an answer of the form is there');
  assert.ok(!text.includes('hunter2-Secret!'), 'a masked answer never is');
});

test('F10: the labels of the fields the code prints', () => {
  assert.equal(labelFor('request_item'), 'Requested item');
  assert.equal(labelFor('hr_service'), 'HR service');
  assert.equal(labelFor('cat_item'), 'Catalog item');
  assert.equal(labelFor('u_hr_leave'), 'U HR leave');
});

test('F22: the opener of a problem or of the task of a problem or a change is not its caller; a catalog task with no item still falls back to its opener', () => {
  const opener = { role: 'opened_by', name: 'Dave Loftus', sysId: 'd'.repeat(32) };
  assert.equal(callerOf({ kind: 'problem', table: 'problem', people: [opener] }), null);
  assert.equal(callerOf({ kind: 'task', table: 'change_task', people: [opener] }), null);
  assert.equal(callerOf({ kind: 'task', table: 'problem_task', people: [opener] }), null);
  assert.deepEqual(callerOf({ kind: 'task', table: 'incident_task', people: [opener] }), { role: 'opened_by', sysId: 'd'.repeat(32) });
  assert.deepEqual(callerOf({ kind: 'catalog_task', table: 'sc_task', people: [opener] }), { role: 'opened_by', sysId: 'd'.repeat(32) });
  assert.deepEqual(callerOf({ kind: 'catalog_task', table: 'sc_task', people: [opener, { role: 'requested_for', name: 'Charlie', sysId: 'c'.repeat(32) }] }), { role: 'requested_for', sysId: 'c'.repeat(32) });
});

test('F19: a request reads its close notes, so "Ready to resolve?" has something to check', () => {
  assert.ok(FIELDS_BY_KIND.request.includes('close_notes'));
  assert.ok(FEATURE_FIELDS['resolution-check'].request.includes('close_notes'));
});
