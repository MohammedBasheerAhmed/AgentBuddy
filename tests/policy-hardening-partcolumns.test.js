// SEC-03(b): `blockedFields` used to check the NAME of a part ("linked_incidents"), not the columns inside it. These tests prove that
// a derived part is refused when the policy blocks a column it carries, and that no derived part can be added to the code without
// an entry in src/features/partColumns.js (the scans below fail on a field that is neither a column nor in the map).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DERIVED_PART_COLUMNS, columnsForPart, isDerivedField } from '../src/features/partColumns.js';
import { FEATURES, featureById, partsFor } from '../src/features/registry.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { createFirewall, FirewallError } from '../src/pii/index.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { hostilePack } from './fixtures/itsm-hostile.js';
import { buildComposePack } from '../src/compose/rewrite.js';

const root = path.join(__dirname, '..');

// ---- The map ---------------------------------------------------------------------------------------------------------

test('columnsForPart: the part\'s own name first, then every column it carries, lower case, no duplicates', () => {
  assert.deepEqual(columnsForPart('short_description'), ['short_description'], 'a column stands for itself');
  assert.deepEqual(columnsForPart('Short_Description'), ['short_description']);
  assert.deepEqual(columnsForPart('no_such_part'), ['no_such_part']);
  assert.deepEqual(columnsForPart(''), []);
  assert.deepEqual(columnsForPart(undefined), []);
  const linked = columnsForPart('LINKED_INCIDENTS');
  assert.equal(linked[0], 'linked_incidents');
  for (const column of ['short_description', 'close_notes', 'number', 'cmdb_ci']) assert.ok(linked.includes(column), column);
  assert.equal(new Set(linked).size, linked.length);
  assert.ok(linked.every((c) => c === c.toLowerCase()));
});

test('every entry of the map is a list of lower-case column names, and the audit\'s list of hidden columns is covered', () => {
  for (const [field, columns] of Object.entries(DERIVED_PART_COLUMNS)) {
    assert.equal(field, field.toLowerCase(), field);
    assert.ok(Array.isArray(columns), field);
    for (const column of columns) assert.match(column, /^[a-z][a-z0-9_.]*$/, `${field}: ${column}`);
  }
  // the parts the review named
  for (const field of ['linked_incidents', 'child_tasks', 'account_cases', 'schedule_conflicts', 'recent_changes', 'variables', 'kb_article', 'sla', 'approvals', 'reference_status']) {
    assert.ok(isDerivedField(field), field);
  }
  assert.ok(columnsForPart('linked_incidents').includes('short_description') && columnsForPart('linked_incidents').includes('close_notes'));
  assert.ok(columnsForPart('child_tasks').includes('assigned_to'));
  assert.ok(columnsForPart('account_cases').includes('short_description'));
  assert.ok(columnsForPart('schedule_conflicts').includes('start_date'));
  assert.ok(columnsForPart('recent_changes').includes('cmdb_ci'));
  assert.ok(columnsForPart('kb_article').includes('text'));
  assert.ok(columnsForPart('sla').includes('planned_end_time'));
  assert.ok(columnsForPart('approvals').includes('approver'));
  assert.ok(columnsForPart('variables').includes('value'));
});

test('reference tickets are named for what they carry: close notes only when they are sent (not for the routing hint)', () => {
  assert.ok(columnsForPart('reference_ticket').includes('close_notes'));
  assert.ok(columnsForPart('reference_ticket').includes('short_description'));
  assert.ok(!columnsForPart('reference_ticket_routing').includes('close_notes'));
  assert.ok(!columnsForPart('reference_ticket_routing').includes('close_code'));
  for (const column of ['assignment_group', 'priority', 'category', 'short_description']) assert.ok(columnsForPart('reference_ticket_routing').includes(column), column);
});

test('the report parts name no columns: their builders leave a blocked column out themselves (src/reports/ai/*)', () => {
  for (const field of ['handover_figures', 'handover_tickets', 'coaching_scope', 'insights_scope', 'insights_overview', 'insights_sla']) {
    assert.deepEqual(columnsForPart(field), [field]);
  }
});

// ---- The firewall -----------------------------------------------------------------------------------------------------

const send = (blockedFields, parts, options = {}) =>
  createFirewall({ mode: 'standard', blockedFields, ...options }).buildRequest({ feature: 'x', table: 'incident', system: 'Summarise.', parts, userInstruction: 'Go.' });

test('the firewall refuses a part that carries a blocked column, whatever its own name', () => {
  for (const [field, columns] of Object.entries(DERIVED_PART_COLUMNS)) {
    const part = { label: 'A part', field, text: 'Some text.' };
    assert.ok(send([], [part]), `${field}: nothing blocked, it goes`);
    assert.throws(() => send([field], [part]), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD', `${field}: its own name`);
    for (const column of columns) {
      assert.throws(() => send([column], [part]), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD', `${field} carries ${column}`);
      assert.throws(() => send([column.toUpperCase()], [part]), (e) => e.code === 'BLOCKED_FIELD', `${field} carries ${column} (policy in capitals)`);
    }
    // a column the part does not carry does not stop it
    assert.ok(send(['u_nothing_like_this'], [part]), field);
  }
});

test('the refusal says which part and which column, with no ticket text', () => {
  const secret = 'Abel Tuter called about the payroll folder';
  try {
    send(['close_notes'], [{ label: 'Incidents linked to this problem', field: 'linked_incidents', text: secret }]);
    assert.fail('should have been refused');
  } catch (e) {
    assert.match(e.message, /linked_incidents/);
    assert.match(e.message, /close_notes/);
    assert.match(e.message, /blocked by policy/);
    assert.ok(!e.message.includes('Abel'));
  }
  // a plain column keeps the old, short message
  try {
    send(['description'], [{ label: 'Description', field: 'description', text: 'x' }]);
    assert.fail('should have been refused');
  } catch (e) {
    assert.match(e.message, /^The field "description" is blocked by policy/);
  }
});

test('a part with no field is still judged by its label', () => {
  assert.throws(() => send(['text to rewrite'], [{ label: 'Text to rewrite', text: 'hello' }]), (e) => e.code === 'BLOCKED_FIELD');
  assert.ok(send(['other'], [{ label: 'Text to rewrite', text: 'hello' }]));
});

// ---- The real features (the review's reproduction) ----------------------------------------------------------------------

const values = () => effectiveSettings({ provider: 'anthropic' }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');

function prepare(id, pack, blockedFields) {
  return prepareRun({ feature: featureById(id), pack, values: values(), policy: normalizePolicy({ blockedFields }), config: config(), createFirewall });
}

const problemPack = () => ({
  version: 1,
  table: 'problem',
  sysId: 'b'.repeat(32),
  number: 'PRB0001001',
  kind: 'problem',
  fields: { number: 'PRB0001001', state: 'Assess', priority: '2 - High' },
  people: [],
  journal: [],
  related: {
    linkedIncidents: [{ number: 'INC0001001', short_description: 'Gateway timeout 1', state: 'Resolved', opened: '2026-10-01 09:00:00', resolved: '2026-10-02 09:00:00', ci: 'gw-eu-1', closeNotes: 'Restarted the pool.' }],
    childTasks: [{ number: 'PTASK0001', type: 'Problem Task', short_description: 'Check the pool', state: 'Open', assignedTo: 'Beth Anglin', assignmentGroup: 'Network', active: 'true' }],
  },
  access: [],
});

test('SEC-03(b), the review\'s reproduction: blocking short_description, close_notes or description stops problem-rca\'s linked incidents', () => {
  assert.ok(prepare('problem-rca', problemPack(), []).request, 'no block: it runs');
  for (const blocked of ['short_description', 'close_notes', 'cmdb_ci']) {
    assert.throws(() => prepare('problem-rca', problemPack(), [blocked]), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD' && /linked_incidents/.test(e.message), blocked);
  }
  assert.ok(prepare('problem-rca', problemPack(), ['reopen_count']).request, 'a column the parts do not carry does not stop it');
});

test('SEC-03(b): the SLA, approvals, child tasks and answers of an incident are covered the same way', () => {
  const pack = hostilePack({ related: { ...hostilePack().related, approvals: [{ approver: 'Dave Loftus', state: 'Requested' }] } });
  assert.ok(prepare('record-summary', pack, []).request);
  assert.throws(() => prepare('record-summary', pack, ['planned_end_time']), (e) => e.code === 'BLOCKED_FIELD' && /sla/.test(e.message));
  assert.throws(() => prepare('record-summary', pack, ['assigned_to']), (e) => e.code === 'BLOCKED_FIELD', 'the assignee column is on the pack anyway');
  assert.throws(() => prepare('record-summary', { ...pack, fields: {}, journal: [] }, ['assigned_to']), (e) => e.code === 'BLOCKED_FIELD' && /child_tasks|approvals/.test(e.message), 'and inside the child tasks and approvals');
});

test('the request\'s status line names who has it and what it waits on: blocking those columns stops it', () => {
  for (const column of ['assigned_to', 'assignment_group', 'number', 'short_description']) assert.ok(columnsForPart('status').includes(column), column);
  // a catalog task seen on its own: "This task is open and with Beth Anglin." (the assignee is not sent as a field)
  const pack = {
    version: 1,
    table: 'sc_task',
    sysId: 'c'.repeat(32),
    number: 'SCTASK0010002',
    kind: 'catalog_task',
    fields: { number: 'SCTASK0010002', state: 'Work in Progress', assigned_to: 'Beth Anglin' },
    people: [{ role: 'assigned_to', name: 'Beth Anglin', email: '', sysId: 'd'.repeat(32) }],
    journal: [],
    related: {},
    access: [],
  };
  const status = partsFor(featureById('request-explain'), pack).find((p) => p.field === 'status');
  assert.match(status.text, /with Beth Anglin/);
  assert.ok(prepare('request-explain', pack, []).request, 'nothing blocked: it runs');
  assert.throws(() => prepare('request-explain', pack, ['assigned_to']), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD' && /status/.test(e.message));
});

// ---- Completeness: no derived part without an entry ----------------------------------------------------------------------

const ceilingColumns = new Set([...Object.values(FIELDS_BY_KIND).flat(), 'comments', 'work_notes']);
const isKnown = (field) => ceilingColumns.has(field) || isDerivedField(field);

const SCANNED = [
  'src/features/packs',
  'src/features/parts.js',
  'src/itsm',
  'src/domain',
  'src/checks',
  'src/knowledge',
  'src/chat',
  'src/compose',
  'src/reports/ai',
];

function sourceFiles(entry) {
  const full = path.join(root, entry);
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(path.join(entry, d.name)) : /\.jsx?$/.test(d.name) ? [path.join(full, d.name)] : []));
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('source scan: every `field: \'...\'` (and parts helper call) under the part-building directories is a column or in the map', () => {
  const found = new Map();
  for (const file of SCANNED.flatMap(sourceFiles)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const patterns = [
      /\bfield:\s*'([a-z][a-z0-9_]*)'/g,
      /\badd\(parts,\s*'[^']*',\s*'([a-z][a-z0-9_]*)'/g,
      /\bpush\('[^']*',\s*'([a-z][a-z0-9_]*)'/g,
      // a table of titles: `linkedIncidents: ['Incidents linked to this problem', 'linked_incidents']` (src/domain/parts.js)
      /\[\s*(?:'[^'\n]* [^'\n]*'|"[^"\n]* [^"\n]*")\s*,\s*'([a-z][a-z0-9_]*)'\s*\]/g,
      /\bfield:\s*[^'\n]*\?\s*'([a-z][a-z0-9_]*)'\s*:\s*'([a-z][a-z0-9_]*)'/g,
    ];
    for (const re of patterns) {
      for (const m of code.matchAll(re)) for (const name of m.slice(1).filter(Boolean)) found.set(name, (found.get(name) || new Set()).add(path.relative(root, file)));
    }
  }
  assert.ok(found.size > 20, 'the scan finds the part fields');
  const unknown = [...found].filter(([name]) => !isKnown(name)).map(([name, files]) => `${name} (${[...files].join(', ')})`);
  assert.deepEqual(unknown, [], 'a part field that is neither a column nor in src/features/partColumns.js');
  for (const name of ['reference_ticket', 'reference_ticket_routing', 'kb_article', 'linked_incidents', 'insights_scope', 'handover_tickets', 'coaching_scope']) {
    assert.ok(found.has(name), `${name} is found by the scan (so the scan really reads the code)`);
  }
});

// A pack with something in every place a part can come from, for every kind.
const TABLE_OF = { incident: 'incident', problem: 'problem', change: 'change_request', request: 'sc_request', requested_item: 'sc_req_item', catalog_task: 'sc_task', case: 'sn_customerservice_case', hr_case: 'sn_hr_core_case', task: 'task', knowledge: 'kb_knowledge', chat: 'interaction', other: 'x_custom' };

function maximalPack(kind) {
  const names = FIELDS_BY_KIND[kind] || FIELDS_BY_KIND.other;
  const fields = Object.fromEntries(names.map((name) => [name, `A value for ${name}`]));
  const task = { number: 'TASK0001', type: 'Task', short_description: 'Do it', state: 'Open', assignedTo: 'Beth Anglin', assignmentGroup: 'Network', active: 'true', item: 'Laptop', stage: 'Fulfilment', approval: 'Requested', due: '2026-11-01' };
  const change = { number: 'CHG0001', short_description: 'Patch', state: 'Scheduled', type: 'Normal', risk: 'Moderate', start: '2026-11-01 00:00:00', end: '2026-11-01 02:00:00', ci: 'gw-eu-1', service: 'Gateway', same: ['cmdb_ci'] };
  const article = { number: 'KB0010001', short_description: 'Fix the VPN', excerpt: 'Switch to TCP.', knowledgeBase: 'IT', score: 80, why: ['title mentions vpn'], strong: true, people: [] };
  return {
    version: 1,
    table: TABLE_OF[kind] || 'x_custom',
    sysId: 'e'.repeat(32),
    number: 'REC0001',
    kind,
    fields,
    people: [{ role: 'caller', name: 'Abel Tuter' }],
    journal: [
      { when: '2026-10-24 09:05:00', by: 'Abel Tuter', type: 'comment', text: 'It drops again.', side: 'customer' },
      { when: '2026-10-24 10:05:00', by: 'Beth Anglin', type: 'work_note', text: 'Checking the certificate.', side: 'agent' },
    ],
    related: {
      slas: [{ name: 'P2', stage: 'In progress', breached: 'false', percentage: '40', plannedEnd: '2026-10-26 17:55:12' }],
      approvals: [{ approver: 'Dave Loftus', group: 'CAB', state: 'Requested', updated: '2026-10-25 08:00:00' }],
      childTasks: [task],
      changeTasks: [task],
      catalogTasks: [task],
      items: [task],
      variables: [{ question: 'Which laptop?', value: 'A model' }],
      linkedIncidents: [{ number: 'INC0001', short_description: 'Timeout', state: 'Resolved', opened: '2026-10-01', resolved: '2026-10-02', ci: 'gw', closeNotes: 'Restarted.' }],
      linkedIncidentsSummary: { total: 30, shown: 20 },
      conflicts: [change],
      conflictsSummary: { total: 12, shown: 10 },
      recentChanges: [change],
      accountCases: [{ number: 'CS0001', short_description: 'Earlier', state: 'Open', priority: '2', opened_at: '2026-10-01', resolved_at: '' }],
      accountCasesSummary: { more: 3 },
      articles: [{ number: 'KB0010001', title: 'One', text: 'Text one', meta: 'vpn' }, { number: 'KB0010002', title: 'Two', text: 'Text two', meta: 'vpn' }],
      gap: { label: 'vpn disconnects', volume: '12 resolved tickets', category: 'Network', ci: 'gw' },
      knowledge: [{ number: 'KB0010001', title: 'Fix the VPN', excerpt: 'Switch to TCP.' }],
    },
    reference: {
      similar: { status: 'ok', hits: [{ number: 'INC0009640', short_description: 'VPN drops', close_notes: 'Replaced it.', close_code: 'Solved', category: 'Network', subcategory: 'VPN', cmdb_ci: 'gw', assignment_group: 'Net', priority: '2', why: 'same CI', people: [] }] },
      knowledge: { status: 'ok', hits: [article] },
    },
    compose: { text: 'Please help', label: 'Text to rewrite', field: 'text' },
    access: [
      { source: 'task_sla', status: 'denied', note: '' },
      { source: 'incident', status: 'blocked', note: 'Your organisation does not allow reading incident.' },
      { source: 'journal', status: 'skipped', note: 'Not read.' },
    ],
  };
}

test('runtime scan: the parts every feature really builds, for every kind, are columns or in the map', () => {
  const seen = new Map();
  let built = 0;
  for (const feature of FEATURES) {
    for (const kind of Object.keys(FIELDS_BY_KIND)) {
      let parts;
      try {
        parts = partsFor(feature, maximalPack(kind));
      } catch {
        continue; // a feature whose parts need another shape of pack (the reports, which are built from report data)
      }
      built += parts.length;
      for (const part of parts) seen.set(part.field, `${feature.id} / ${kind}`);
    }
  }
  // the compose pack of the Write section
  for (const id of ['rewrite-short', 'notes-to-ticket', 'email-status-update']) {
    const pack = id === 'email-status-update' ? maximalPack('incident') : buildComposePack({ text: 'Hello' });
    for (const part of partsFor(featureById(id), pack)) seen.set(part.field, id);
  }
  assert.ok(built > 500, `the scan builds many parts (${built})`);
  for (const field of ['linked_incidents', 'schedule_conflicts', 'recent_changes', 'account_cases', 'child_tasks', 'change_tasks', 'catalog_tasks', 'requested_items', 'variables', 'sla', 'slas', 'approvals', 'kb_article', 'reference_status', 'reference_ticket', 'reference_ticket_routing', 'signals', 'status', 'volume', 'not_recorded', 'data_not_available', 'items', 'tasks', 'comments', 'work_notes', 'text', 'meta']) {
    assert.ok(seen.has(field), `the scan reaches ${field}`);
  }
  const unknown = [...seen].filter(([field]) => !isKnown(field)).map(([field, where]) => `${field} (${where})`);
  assert.deepEqual(unknown, [], 'a part field that is neither a column nor in src/features/partColumns.js');
});

test('the map has no entry nobody uses: every derived field is produced by the code (a stale entry hides a renamed part)', () => {
  const produced = new Set();
  for (const file of SCANNED.flatMap(sourceFiles)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const field of Object.keys(DERIVED_PART_COLUMNS)) if (code.includes(`'${field}'`)) produced.add(field);
  }
  const stale = Object.keys(DERIVED_PART_COLUMNS).filter((field) => !produced.has(field));
  assert.deepEqual(stale, []);
});
