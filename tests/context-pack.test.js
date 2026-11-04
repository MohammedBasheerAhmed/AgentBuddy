import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, LIMITS, allowedFields } from '../src/context/allowlists.js';
import { readContextPack, resolveRecordRef, stripHtml } from '../src/context/pack.js';
import { CASE_ID } from './fixtures/sn-case.js';
import { HR_CASE_ID } from './fixtures/sn-hr-case.js';
import { INCIDENT_ID, INCIDENT_NUMBER } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { REQUEST_ID, RITM_ID } from './fixtures/sn-requested-item.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { ABEL, BETH, CHARLIE, DAVE, ERIN, HANA, JANE } from './fixtures/sn-users.js';

const incident = { table: 'incident', sysId: INCIDENT_ID };
const ritm = { table: 'sc_req_item', sysId: RITM_ID };
const read = (ref, behaviour, options) => {
  const deps = fakeDeps(buildInstance(), behaviour);
  return readContextPack(ref, deps, options).then((pack) => ({ pack, deps }));
};

// Every string in a value, with the path it was found at.
function leaves(value, path = '$', out = []) {
  if (Array.isArray(value)) value.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, x]) => leaves(x, `${path}.${k}`, out));
  else out.push([path, value]);
  return out;
}

const LEAKS = ['EMP-LEAK-1', 'SSN-LEAK-2', 'LOCATION-LEAK', 'CORR-LEAK-3', 'SHOULD NEVER APPEAR'];

// ---- The pack ------------------------------------------------------------------------------------------

test('an incident pack follows the contract', async () => {
  const { pack } = await read(incident);
  assert.deepEqual(Object.keys(pack).sort(), ['access', 'fields', 'journal', 'kind', 'number', 'people', 'related', 'sysId', 'table', 'version']);
  assert.equal(pack.version, 1);
  assert.equal(pack.table, 'incident');
  assert.equal(pack.sysId, INCIDENT_ID);
  assert.equal(pack.number, INCIDENT_NUMBER);
  assert.equal(pack.kind, 'incident');

  assert.equal(pack.fields.short_description, 'VPN keeps disconnecting for Abel Tuter (abel.tuter@example.com)');
  assert.equal(pack.fields.state, 'In Progress', 'display values, not stored values');
  assert.equal(pack.fields.priority, '2 - High');
  assert.equal(pack.fields.assignment_group, 'Network Support');
  assert.equal(pack.fields.caller_id, 'Abel Tuter');
  assert.equal(pack.fields.cmdb_ci, 'VPN Gateway EU');
  assert.equal(pack.fields.opened_at, '2026-10-26 09:55:12', 'as the user sees it');
  assert.equal(
    pack.fields.description,
    'Hi, my VPN drops every 10 minutes since Monday.\n\nPlease call me on +1 555-0134. My employee id is E12345 & I am on the London VPN profile.'
  );
  assert.ok(!('resolved_at' in pack.fields), 'empty values are left out');
  assert.ok(!('close_notes' in pack.fields));
});

test('the record is read once, with exactly the allowlisted columns plus the two note columns, as display values', async () => {
  const { deps } = await read(incident);
  const call = deps.callsTo('incident')[0];
  assert.deepEqual(call.fields, [...allowedFields('incident', 'record-summary'), 'comments', 'work_notes']);
  assert.equal(call.options.displayValue, true);
  assert.equal(call.query, `sys_id=${INCIDENT_ID}`);
});

test('people carry name, email, sys_id and first/last name; one entry per person', async () => {
  const { pack } = await read(incident);
  assert.deepEqual(
    pack.people.map((p) => [p.role, p.name, p.email, p.sysId, p.firstName, p.lastName]),
    [
      ['assigned_to', BETH.name, BETH.email, BETH.sysId, 'Beth', 'Anglin'],
      ['caller', ABEL.name, ABEL.email, ABEL.sysId, 'Abel', 'Tuter'],
    ]
  );
  assert.ok(pack.access.some((a) => a.source === 'sys_user' && a.status === 'ok'));
});

test('sys_user is read once, for exactly the people on the record, with only the columns it needs', async () => {
  const { deps } = await read(incident);
  const calls = deps.callsTo('sys_user');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].fields, ['sys_id', 'user_name', 'name', 'email', 'first_name', 'last_name']);
  assert.match(calls[0].query, new RegExp(`sys_idIN${BETH.sysId},${ABEL.sysId}\\^ORuser_nameIN`));
});

test('notes: oldest first, display names for the authors, plain text', async () => {
  const { pack } = await read(incident);
  assert.deepEqual(pack.journal.map((e) => [e.when, e.by, e.type]), [
    ['2026-10-26 07:58:03', ABEL.name, 'comment'],
    ['2026-10-26 08:20:41', BETH.name, 'comment'],
    ['2026-10-26 08:25:00', BETH.name, 'work_note'],
  ]);
  assert.ok(pack.journal.every((e) => !/<|&nbsp;|\[code\]/.test(e.text)));
});

test('SLAs and child tasks of this record only', async () => {
  const { pack } = await read(incident);
  assert.deepEqual(pack.related.slas, [
    { name: 'P2 resolution 8 hours', stage: 'In progress', breached: 'false', percentage: '62', plannedEnd: '2026-10-26 19:55:12', plannedEndUtc: '2026-10-26 17:55:12' },
    { name: 'P2 response 2 hours', stage: 'Achieved', breached: 'false', percentage: '40', plannedEnd: '2026-10-26 11:55:12', plannedEndUtc: '2026-10-26 09:55:12' },
  ]);
  assert.deepEqual(pack.related.childTasks, [
    {
      number: 'TASK0010005',
      type: 'Incident Task',
      short_description: 'Check gateway certificate',
      state: 'Open',
      assignedTo: BETH.name,
      assignmentGroup: 'Network Support',
      active: 'true',
    },
  ]);
  assert.ok(!('approvals' in pack.related), 'an incident has no approvals extra');
  assert.ok(!('variables' in pack.related));
});

test('the pack is plain JSON of strings, with no HTML and no raw sys_id outside sysId and people[].sysId', async () => {
  const { pack } = await read(incident);
  assert.deepEqual(JSON.parse(JSON.stringify(pack)), pack);
  for (const [path, value] of leaves(pack)) {
    if (path === '$.version') continue;
    assert.equal(typeof value, 'string', `${path} is not a string`);
    if (path === '$.sysId' || /^\$\.people\[\d+\]\.sysId$/.test(path)) continue;
    assert.ok(!/\b[0-9a-f]{32}\b/i.test(value), `${path} holds a sys_id: ${value}`);
    assert.ok(!/<\/?[a-z][^>]*>/i.test(value), `${path} holds HTML: ${value}`);
    assert.ok(!/&(?:amp|lt|gt|nbsp|quot|#\d+);/.test(value), `${path} holds an entity: ${value}`);
  }
});

test('long text is capped', async () => {
  const tables = buildInstance();
  tables.incident[0].description = v('', `<p>${'x'.repeat(9000)}</p>`);
  const pack = await readContextPack(incident, fakeDeps(tables));
  assert.equal(pack.fields.description.length, LIMITS.description);
});

// ---- Allowlist enforcement ------------------------------------------------------------------------------

test('a column that is not on the allowlist NEVER appears, even when the instance returns every column', async () => {
  for (const feature of FEATURES) {
    const { pack, deps } = await read(incident, { leaky: true }, { feature });
    const text = JSON.stringify(pack);
    for (const leak of LEAKS) assert.ok(!text.includes(leak), `${feature} leaked ${leak}`);
    const allowed = new Set(allowedFields('incident', feature));
    for (const key of Object.keys(pack.fields)) assert.ok(allowed.has(key), `${feature}: ${key} is not allowlisted`);
    // and the request itself never named a column outside the list (plus the note columns)
    const asked = new Set(deps.callsTo('incident').flatMap((c) => c.fields));
    for (const name of asked) assert.ok(allowed.has(name) || ['comments', 'work_notes'].includes(name), `${feature} asked for ${name}`);
  }
});

test('the same holds for every kind in the fixtures', async () => {
  const cases = [
    [ritm, ['CC-LEAK-4411', 'PRICE-LEAK']],
    [{ table: 'sc_request', sysId: REQUEST_ID }, ['PRICE-LEAK']],
    [{ table: 'sn_customerservice_case', sysId: CASE_ID }, ['RISK-LEAK-87', 'ARR-LEAK']],
  ];
  for (const [ref, leaks] of cases) {
    const { pack } = await read(ref, { leaky: true });
    const text = JSON.stringify(pack);
    for (const leak of leaks) assert.ok(!text.includes(leak), `${ref.table} leaked ${leak}`);
    const allowed = new Set(allowedFields(ref.table, 'record-summary'));
    for (const key of Object.keys(pack.fields)) assert.ok(allowed.has(key), `${ref.table}: ${key}`);
  }
});

test('a feature reads less than the summary: similar has no notes, no extras, no description', async () => {
  const { pack, deps } = await read(incident, {}, { feature: 'similar' });
  assert.deepEqual(pack.journal, []);
  assert.deepEqual(pack.related, {});
  assert.deepEqual(Object.keys(pack.fields).sort(), ['category', 'cmdb_ci', 'business_service', 'number', 'short_description', 'state', 'subcategory'].sort());
  assert.equal(deps.callsTo('sys_journal_field').length, 0);
  assert.equal(deps.callsTo('task_sla').length, 0);
  assert.ok(!deps.callsTo('incident')[0].fields.includes('comments'));
});

test('includeJournal overrides the feature default in both directions', async () => {
  const off = await read(incident, {}, { includeJournal: false });
  assert.deepEqual(off.pack.journal, []);
  assert.equal(off.deps.callsTo('sys_journal_field').length, 0);
  assert.ok(!off.deps.callsTo('incident')[0].fields.includes('work_notes'));
  const on = await read(incident, {}, { feature: 'similar', includeJournal: true });
  assert.equal(on.pack.journal.length, 3);
});

test('missing-info on a requested item reads the variables and nothing else extra', async () => {
  const { pack } = await read(ritm, {}, { feature: 'missing-info' });
  assert.deepEqual(Object.keys(pack.related), ['variables']);
});

// ---- Access: denied, hidden, ambiguous --------------------------------------------------------------------

test('a denied extra is reported and the rest of the pack is complete', async () => {
  const { pack } = await read(incident, { denied: ['task_sla'] });
  assert.ok(!('slas' in pack.related));
  assert.deepEqual(pack.access.find((a) => a.source === 'task_sla'), { source: 'task_sla', status: 'denied', note: 'Your user cannot read task_sla.' });
  assert.equal(pack.related.childTasks.length, 1);
  assert.equal(pack.journal.length, 3);
});

test('a table that answers 200 with nothing, even unfiltered, is "empty-or-hidden", never "no results"', async () => {
  const { pack, deps } = await read(incident, { hidden: ['task_sla'] });
  const entry = pack.access.find((a) => a.source === 'task_sla');
  assert.equal(entry.status, 'empty-or-hidden');
  assert.match(entry.note, /sees no rows of task_sla at all/);
  assert.match(entry.note, /proves nothing/);
  assert.ok(!('slas' in pack.related), 'no empty list that would read as "none"');
  // exactly one extra, unfiltered, one-row read
  const unfiltered = deps.callsTo('task_sla').filter((c) => c.query === '');
  assert.equal(unfiltered.length, 1);
  assert.deepEqual(unfiltered[0].fields, ['sys_id']);
  assert.equal(unfiltered[0].options.limit, 1);
});

test('an empty answer from a table the user can see is a fact: "empty", with an empty list', async () => {
  const tables = buildInstance();
  tables.task_sla = tables.task_sla.filter((row) => row.task.value !== INCIDENT_ID); // other tasks keep their SLAs
  const pack = await readContextPack(incident, fakeDeps(tables));
  assert.deepEqual(pack.related.slas, []);
  assert.equal(pack.access.find((a) => a.source === 'task_sla').status, 'empty');
});

test('the record\'s own table and task need no confirming read', async () => {
  const tables = buildInstance();
  tables.task = [];
  const deps = fakeDeps(tables);
  const pack = await readContextPack(incident, deps);
  assert.deepEqual(pack.related.childTasks, []);
  assert.equal(pack.access.find((a) => a.source === 'task').status, 'empty');
  assert.equal(deps.callsTo('task').filter((c) => c.query === '').length, 0);
});

test('one confirming read per table, however many features ask', async () => {
  const { deps } = await read(ritm, { hidden: ['task_sla', 'sysapproval_approver', 'sc_task'] });
  for (const table of ['task_sla', 'sysapproval_approver', 'sc_task']) {
    assert.equal(deps.callsTo(table).filter((c) => c.query === '').length, 1, table);
  }
});

test('rows of other records mean the instance ignored the filter: they are not shown as this record\'s', async () => {
  const tables = buildInstance();
  tables.task_sla = [{ sys_id: v('x1'), sla: v('d', 'Some other SLA'), stage: v('in_progress', 'In progress') }]; // no `task` column at all
  const pack = await readContextPack(incident, fakeDeps(tables));
  assert.ok(!('slas' in pack.related));
  const entry = pack.access.find((a) => a.source === 'task_sla');
  assert.equal(entry.status, 'error');
  assert.match(entry.note, /did not apply the filter/);
  assert.ok(!JSON.stringify(pack).includes('Some other SLA'));
});

test('the journal table is denied: notes come from the record\'s own fields, and the access list says so', async () => {
  const { pack } = await read(incident, { denied: ['sys_journal_field'] });
  assert.deepEqual(pack.journal.map((e) => [e.by, e.type]), [[ABEL.name, 'comment'], [BETH.name, 'comment'], [BETH.name, 'work_note']]);
  const entry = pack.access.find((a) => a.source === 'journal');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.strategy, 'record-fields');
  assert.match(entry.note, /could not be read by your user/);
  assert.equal(pack.people.length, 2, 'authors already known are not repeated');
});

test('the journal table shows nothing but the record has notes: same fallback', async () => {
  const tables = buildInstance();
  tables.sys_journal_field = [];
  const pack = await readContextPack(incident, fakeDeps(tables));
  assert.equal(pack.journal.length, 3);
  assert.equal(pack.access.find((a) => a.source === 'journal').strategy, 'record-fields');
});

test('note authors only known by name become name-only people', async () => {
  const tables = buildInstance();
  tables.sys_journal_field = [];
  tables.incident[0].comments = v('', '2026-10-26 10:20:41 - Zoë Müller-Schmidt (Additional comments)\nHello');
  const pack = await readContextPack(incident, fakeDeps(tables));
  const zoe = pack.people.find((p) => p.name === 'Zoë Müller-Schmidt');
  assert.deepEqual(zoe, { role: 'journal_author', name: 'Zoë Müller-Schmidt', email: '', sysId: '', firstName: 'Zoë', lastName: 'Müller-Schmidt' });
});

test('sys_user denied: names stay, emails are left out, and the access list says so', async () => {
  const { pack } = await read(incident, { denied: ['sys_user'] });
  assert.deepEqual(pack.people.map((p) => [p.name, p.email, p.sysId]), [[BETH.name, '', BETH.sysId], [ABEL.name, '', ABEL.sysId]]);
  assert.deepEqual(pack.access.find((a) => a.source === 'sys_user'), {
    source: 'sys_user',
    status: 'denied',
    note: 'Your user cannot read sys_user, so email addresses are not included.',
  });
  assert.equal(pack.people[0].firstName, 'Beth', 'first name still comes from the display name');
  assert.equal(pack.journal[0].by, 'abel.tuter', 'a login that cannot be turned into a name stays a login');
});

test('sys_user readable but some people have no email: noted, not failed', async () => {
  const tables = buildInstance();
  tables.sys_user = tables.sys_user.map((u) => (u.sys_id === ABEL.sysId ? { ...u, email: '' } : u));
  const pack = await readContextPack(incident, fakeDeps(tables));
  const entry = pack.access.find((a) => a.source === 'sys_user');
  assert.equal(entry.status, 'ok');
  assert.match(entry.note, /1 of 2 people have no email/);
  assert.equal(pack.people.find((p) => p.sysId === ABEL.sysId).email, '');
});

test('sys_user answering nothing for people who exist is reported as unreadable', async () => {
  const { pack } = await read(incident, { hidden: ['sys_user'] });
  assert.equal(pack.access.find((a) => a.source === 'sys_user').status, 'denied');
  assert.deepEqual(pack.people.map((p) => p.email), ['', '']);
});

// ---- Failures of the record itself ---------------------------------------------------------------------------

test('a record that is not there, or not visible, is NOT_FOUND', async () => {
  const missing = { table: 'incident', sysId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  await assert.rejects(read(missing), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(read(incident, { hidden: ['incident'] }), (err) => err.code === 'NOT_FOUND');
});

test('a denied or expired session on the record itself is passed on, not swallowed', async () => {
  await assert.rejects(read(incident, { denied: ['incident'] }), (err) => err.code === 'ACCESS_DENIED');
  await assert.rejects(read(incident, { expired: ['incident'] }), (err) => err.code === 'SESSION_EXPIRED');
  await assert.rejects(read(incident, { expired: ['task_sla'] }), (err) => err.code === 'SESSION_EXPIRED');
});

test('bad input fails before anything is read', async () => {
  const deps = fakeDeps(buildInstance());
  await assert.rejects(readContextPack({ table: 'incident', sysId: 'nope' }, deps), TypeError);
  await assert.rejects(readContextPack({ sysId: INCIDENT_ID }, deps), TypeError);
  await assert.rejects(readContextPack(incident, deps, { feature: 'make-coffee' }), /Unknown feature/);
  assert.equal(deps.calls.length, 0);
});

test('a record can be named by number', async () => {
  const deps = fakeDeps(buildInstance());
  assert.deepEqual(await resolveRecordRef({ table: 'incident', number: 'inc0010001' }, deps), { table: 'incident', sysId: INCIDENT_ID });
  assert.deepEqual(await resolveRecordRef({ number: 'INC0010001' }, deps), { table: 'incident', sysId: INCIDENT_ID });
  const pack = await readContextPack({ number: 'RITM0010050' }, deps);
  assert.equal(pack.table, 'sc_req_item');
  assert.equal(pack.sysId, RITM_ID);
  await assert.rejects(resolveRecordRef({ number: 'INC9999999' }, deps), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(resolveRecordRef({ number: 'hello' }, deps), TypeError);
});

// ---- Other kinds ---------------------------------------------------------------------------------------------

test('a requested item: variables without secrets, references as names, approvals, catalog tasks', async () => {
  const { pack } = await read(ritm);
  assert.equal(pack.kind, 'requested_item');
  assert.equal(pack.fields.cat_item, 'Standard Laptop');
  assert.equal(pack.fields.stage, 'Fulfillment');
  assert.equal(pack.fields.request, 'REQ0010030');

  assert.deepEqual(pack.related.variables, [
    { question: 'Operating system', value: 'Windows 11' },
    { question: 'Business justification', value: 'New starter; replaces a retired laptop. Contact charlie.w@example.com' },
    { question: 'Manager', value: DAVE.name },
    { question: 'Needed by', value: '2026-11-01' },
  ]);
  const text = JSON.stringify(pack);
  assert.ok(!text.includes('hunter2'), 'masked answers never leave');
  assert.ok(!text.includes('4417'), 'answers to secret-looking questions never leave');
  assert.ok(!text.includes('99999999999999999999999999999999'), 'no unresolved reference id');
  const note = pack.access.find((a) => a.source === 'sc_item_option_mtom').note;
  assert.match(note, /2 masked or secret answers were left out/);
  assert.match(note, /1 reference answer could not be shown/);

  assert.deepEqual(pack.related.approvals.map((a) => [a.approver, a.group, a.state]), [
    ['', 'IT Procurement', 'Requested'],
    [DAVE.name, '', 'Approved'],
  ]);
  assert.deepEqual(pack.related.catalogTasks.map((t) => [t.number, t.state, t.assignedTo]), [
    ['SCTASK0010060', 'Closed Complete', BETH.name],
    ['SCTASK0010061', 'Work in Progress', BETH.name],
  ]);
  assert.deepEqual(pack.related.slas, [], 'visible table, nothing for this item');
});

test('variables: the question definitions unreadable means the answers cannot be labelled', async () => {
  const tables = buildInstance();
  tables.sc_item_option_mtom = tables.sc_item_option_mtom.map((row) => ({
    ...row,
    'sc_item_option.item_option_new.question_text': v(''),
    'sc_item_option.item_option_new.name': v(''),
  }));
  const pack = await readContextPack(ritm, fakeDeps(tables));
  assert.ok(!('variables' in pack.related));
  assert.equal(pack.access.find((a) => a.source === 'sc_item_option_mtom').status, 'denied');
});

test('variables: a denied table is a note', async () => {
  const { pack } = await read(ritm, { denied: ['sc_item_option_mtom'] });
  assert.ok(!('variables' in pack.related));
  assert.equal(pack.access.find((a) => a.source === 'sc_item_option_mtom').status, 'denied');
  assert.equal(pack.related.approvals.length, 2, 'the other extras still load');
});

test('a requested item\'s people include the requester, the approver and the task assignee', async () => {
  const { pack } = await read(ritm);
  const byRole = Object.fromEntries(pack.people.map((p) => [p.name, p.role]));
  assert.equal(byRole[CHARLIE.name], 'requested_for');
  assert.equal(byRole[BETH.name], 'assigned_to');
  assert.equal(byRole[DAVE.name], 'opened_by');
  assert.equal(pack.people.length, 3);
});

test('a request lists its items', async () => {
  const { pack } = await read({ table: 'sc_request', sysId: REQUEST_ID });
  assert.equal(pack.kind, 'request');
  assert.equal(pack.related.items.length, 1);
  assert.equal(pack.related.items[0].number, 'RITM0010050');
  assert.equal(pack.related.items[0].item, 'Standard Laptop');
  assert.deepEqual(pack.related.approvals, []);
});

test('a case: account, contact (with email), product, entitlement and a breached SLA', async () => {
  const { pack } = await read({ table: 'sn_customerservice_case', sysId: CASE_ID });
  assert.equal(pack.kind, 'case');
  assert.equal(pack.fields.account, 'Acme Corp');
  assert.equal(pack.fields.contact, ERIN.name);
  assert.equal(pack.fields.product, 'Cloud Gateway');
  assert.equal(pack.fields.entitlement, 'Gold Support');
  assert.ok(!('consumer' in pack.fields));
  const contact = pack.people.find((p) => p.role === 'contact');
  assert.deepEqual([contact.name, contact.email, contact.sysId], [ERIN.name, ERIN.email, ERIN.sysId]);
  assert.deepEqual(pack.related.slas, [{ name: 'Gold response 1 hour', stage: 'In progress', breached: 'true', percentage: '130', plannedEnd: '2026-10-25 12:00:00', plannedEndUtc: '2026-10-25 10:00:00' }]);
  assert.equal(pack.journal.length, 2, 'from the record\'s own fields');
});

// ---- HR minimisation ------------------------------------------------------------------------------------------

test('an HR case without allowSensitive carries no free text, no identities, no notes', async () => {
  const { pack, deps } = await read({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, { leaky: true });
  assert.equal(pack.kind, 'hr_case');
  assert.deepEqual(Object.keys(pack.fields).sort(), ['assigned_to', 'assignment_group', 'number', 'opened_at', 'priority', 'state', 'sys_updated_on'].sort());
  assert.deepEqual(pack.journal, []);
  assert.deepEqual(pack.people.map((p) => [p.role, p.name]), [['assigned_to', HANA.name]]);
  assert.deepEqual(Object.keys(pack.related), ['slas']);

  const text = JSON.stringify(pack);
  for (const secret of ['Jane', 'Maternity', 'maternity', 'Parental', 'pregnancy', 'SALARY-LEAK', 'SHOULD NEVER APPEAR', 'jane.doe']) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
  // the request never even asked for them
  const asked = new Set(deps.callsTo('sn_hr_core_case').flatMap((c) => c.fields));
  for (const name of ['short_description', 'description', 'close_notes', 'hr_service', 'subject_person', 'opened_for', 'opened_by', 'comments', 'work_notes']) {
    assert.ok(!asked.has(name), `asked for ${name}`);
  }
  assert.equal(deps.callsTo('sys_journal_field').length, 0);
  assert.equal(deps.callsTo('task').length, 0, 'no child tasks (their titles are free text)');

  const skipped = pack.access.filter((a) => a.status === 'skipped');
  assert.deepEqual(skipped.map((a) => a.source), ['sn_hr_core_case', 'journal']);
  assert.match(skipped[0].note, /description/);
});

test('an HR case with allowSensitive reads what the feature lists, notes included', async () => {
  const { pack } = await read({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, { leaky: true }, { allowSensitive: true });
  assert.equal(pack.fields.short_description, 'Maternity leave request for Jane Doe');
  assert.equal(pack.fields.hr_service, 'Parental Leave');
  assert.equal(pack.fields.subject_person, JANE.name);
  assert.ok(pack.people.some((p) => p.name === JANE.name && p.email === JANE.email));
  assert.equal(pack.journal.length, 2);
  const text = JSON.stringify(pack);
  assert.ok(!text.includes('SALARY-LEAK') && !text.includes('SHOULD NEVER APPEAR'), 'still only the allowlist');
  assert.ok(!pack.access.some((a) => a.status === 'skipped'));
});

test('HR child tasks follow the same rule', async () => {
  const HR_TASK_ID = 'abcdefabcdefabcdefabcdefabcdef12';
  const tables = buildInstance();
  tables.sn_hr_core_task = [
    { sys_id: v(HR_TASK_ID), number: v('HRT0001'), short_description: v('Secret HR detail'), opened_by: v(JANE.sysId, JANE.name), assigned_to: v(HANA.sysId, HANA.name), state: v('1', 'Open') },
  ];
  const pack = await readContextPack({ table: 'sn_hr_core_task', sysId: HR_TASK_ID }, fakeDeps(tables));
  assert.equal(pack.kind, 'task');
  assert.ok(!('short_description' in pack.fields));
  assert.ok(!JSON.stringify(pack).includes('Secret HR detail'));
  assert.ok(!JSON.stringify(pack).includes(JANE.name));
});

// ---- Misc ---------------------------------------------------------------------------------------------------

test('stripHtml is exported next to the pack', () => {
  assert.equal(stripHtml('<p>a &amp; b</p>'), 'a & b');
});

// Audit P3.27: a column is read as HTML only when it carries markup, so a plain title with angle brackets keeps its words.
test('the record\'s columns: plain text keeps "<String>", HTML in a column is still stripped (scripts with it)', async () => {
  const tables = buildInstance();
  const row = tables.incident.find((r) => r.sys_id.value === INCIDENT_ID);
  row.short_description = v('List<String> is empty when a<b and c>d');
  row.close_notes = v('<p>Restarted the gateway.</p><script>alert(1)</script>');
  const pack = await readContextPack(incident, fakeDeps(tables), { feature: 'record-summary' });
  assert.equal(pack.fields.short_description, 'List<String> is empty when a<b and c>d');
  assert.equal(pack.fields.close_notes, 'Restarted the gateway.');
  assert.match(pack.fields.description, /^Hi, my VPN drops/, 'the HTML description is still read as text');
});
