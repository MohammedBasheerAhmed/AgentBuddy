// A dot-walked column reads every table on its way: 'request.requested_for' on sc_req_item reads sc_request, 'user.user_name' on
// sys_user_grmember reads sys_user. The guard (src/content/policyGuard.js) used to compare each step's own NAME with blockedTables, so
// those two passed with sc_request or sys_user blocked. Now each step is checked by the table it points at (DOT_WALK_TABLES), in the
// columns asked for and in the query's conditions, and a step the map does not know is refused while anything is blocked. The scans
// below fail when a dot-walk in src/ has a step that is not in the map, so a new one cannot pass a blocked table unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DOT_WALK_TABLES, createPolicyGuard, walkTables } from '../src/content/policyGuard.js';
import { KNOWN_TABLES, columnsFor } from '../src/mywork/tables.js';
import { BUILTIN_VARIABLES } from '../src/snippets/render.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { RITM_ID } from './fixtures/sn-requested-item.js';

const root = path.join(__dirname, '..');
const guardFor = (raw) => createPolicyGuard({ getManaged: async () => ({ known: true, raw }) });
const refused = (table) => (e) => e.code === 'BLOCKED_TABLE' && e.message === `Your organisation does not allow Agent Buddy to read ${table} records.`;

async function guarded(raw) {
  const fake = fakeDeps(buildInstance());
  return { fake, deps: await guardFor(raw).deps(fake) };
}

// ---- The guard -------------------------------------------------------------------------------------------------------------

test('request.requested_for is refused with sc_request blocked (the step is the column `request`, the table is sc_request)', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['sc_request'] });
  await assert.rejects(() => deps.queryTable('sc_req_item', 'requested_for=x', ['sys_id', 'request.requested_for'], {}), refused('sc_request'));
  // in a condition too: filtering by it reads sc_request just the same
  await assert.rejects(() => deps.queryTable('sc_req_item', 'request.requested_for=x', ['sys_id', 'number'], {}), refused('sc_request'));
  await assert.rejects(() => deps.countRecords('sc_req_item', 'active=true^ORrequest.requested_for=x'), refused('sc_request'));
  assert.equal(fake.calls.length, 0, 'nothing reached the instance');
  // the requested item itself, without the walk, is fine
  assert.ok(Array.isArray(await deps.queryTable('sc_req_item', 'requested_for=x', ['sys_id', 'requested_for'], {})));
});

test('user.user_name is refused with sys_user blocked, and a customer contact counts as a sys_user row', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['sys_user'] });
  await assert.rejects(() => deps.queryTable('sys_user_grmember', 'group=g', ['user', 'user.user_name'], {}), refused('sys_user'));
  await assert.rejects(() => deps.queryTable('sys_user_grmember', 'group=g^user.active=true', ['user'], {}), refused('sys_user'));
  await assert.rejects(() => deps.queryTable('sn_customerservice_case', 'active=true', ['number', 'contact.user_name'], {}), refused('sys_user'));
  await assert.rejects(() => deps.queryTable('sc_task', 'active=true', ['number', 'request_item.requested_for.user_name'], {}), refused('sys_user'));
  assert.equal(fake.calls.length, 0);
});

test('every table on a longer walk is checked, by what it points at', async () => {
  const blockedRequestItem = await guarded({ blockedTables: ['sc_req_item'] });
  await assert.rejects(() => blockedRequestItem.deps.queryTable('sc_task', 'active=true', ['request_item.requested_for.user_name'], {}), refused('sc_req_item'));
  const blockedTask = await guarded({ blockedTables: ['task'] });
  await assert.rejects(() => blockedTask.deps.queryTable('task_sla', 'active=true^task.assigned_to=x', ['sla'], {}), refused('task'));
  await assert.rejects(() => blockedTask.deps.queryTable('sysapproval_approver', 'state=requested', ['sysapproval.sys_class_name'], {}), refused('task'));
  const blockedGroup = await guarded({ blockedTables: ['sys_user_group'] });
  await assert.rejects(() => blockedGroup.deps.queryTable('sys_user_grmember', 'user=x^group.active=true', ['group'], {}), refused('sys_user_group'));
  // the variable answers: sc_item_option, then item_option_new
  const fields = ['request_item', 'sc_item_option.value', 'sc_item_option.item_option_new.question_text'];
  for (const blocked of ['sc_item_option', 'item_option_new']) {
    const { deps } = await guarded({ blockedTables: [blocked] });
    await assert.rejects(() => deps.queryTable('sc_item_option_mtom', `request_item=${RITM_ID}`, fields, {}), refused(blocked));
  }
});

test('a dot-walk through a column the map does not know is refused while anything is blocked, and passes when nothing is', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['problem'] });
  await assert.rejects(() => deps.queryTable('incident', 'active=true', ['number', 'cmdb_ci.name'], {}), refused('cmdb_ci'));
  await assert.rejects(() => deps.queryTable('incident', 'location.city=Leeds', ['number'], {}), refused('location'));
  await assert.rejects(() => deps.countByColumn('incident', 'active=true', 'location.city'), refused('location'), 'the column a count groups by');
  const withAggregate = await guardFor({ blockedTables: ['problem'] }).deps({ ...fakeDeps({}), aggregate: async () => ({}) });
  await assert.rejects(() => withAggregate.aggregate('incident', { groupBy: ['assignment_group.manager'] }), refused('assignment_group'));
  // the same checks for a read made another way (the reports' own Aggregate API call)
  assert.throws(() => withAggregate.checkRead('task_sla', 'active=true^location.city=Leeds', []), refused('location'));
  assert.throws(() => withAggregate.checkRead('problem', '', []), refused('problem'));
  assert.equal(withAggregate.checkRead('task_sla', 'active=true^task.assigned_to=x', ['task.priority']), undefined);
  assert.equal(fake.calls.length, 0);
  const open = await guarded({ blockedTables: [] });
  assert.ok(Array.isArray(await open.deps.queryTable('incident', 'location.city=Leeds', ['number', 'cmdb_ci.name'], {})), 'nothing blocked: nothing to check');
});

test('values are not conditions: a doubled caret, a dot inside a value, a sort order and a plain column are read correctly', async () => {
  const { deps } = await guarded({ blockedTables: ['sc_request'] });
  // "a^^b.c=d" is one value with a caret in it, not a condition on b.c
  assert.ok(Array.isArray(await deps.queryTable('incident', 'short_descriptionLIKEa^^request.x=1^active=true', ['number'], {})));
  assert.ok(Array.isArray(await deps.queryTable('incident', 'short_descriptionLIKEsee request.number^ORDERBYDESCopened_at', ['number'], {})));
  await assert.rejects(() => deps.queryTable('sc_req_item', 'active=true^ORDERBYrequest.number', ['number'], {}), refused('sc_request'), 'a sort order reads the table too');
});

test('walkTables: the tables a column passes through, [] for a plain column, null for a step the map does not know', () => {
  assert.deepEqual(walkTables('number'), []);
  assert.deepEqual(walkTables('request.requested_for'), ['sc_request']);
  assert.deepEqual(walkTables('Request_Item.Requested_For.user_name'), ['sc_req_item', 'sys_user']);
  assert.deepEqual(walkTables('contact.user_name'), ['customer_contact', 'sys_user']);
  assert.equal(walkTables('cmdb_ci.name'), null);
  assert.equal(walkTables('constructor.name'), null, 'own entries only');
  assert.equal(walkTables('__proto__.name'), null);
  for (const [column, tables] of Object.entries(DOT_WALK_TABLES)) {
    assert.match(column, /^[a-z][a-z0-9_]*$/);
    assert.ok(tables.length && tables.every((t) => /^[a-z][a-z0-9_]*$/.test(t)), column);
  }
});

test('the walks Agent Buddy makes still go through when something else is blocked', async () => {
  const { fake, deps } = await guarded({ blockedTables: ['sn_hr_core_case'] });
  await deps.queryTable('sc_req_item', 'request.requested_for=x', ['sys_id', 'request.requested_for'], {});
  await deps.queryTable('sys_user_grmember', 'group=g^user.active=true', ['user', 'user.user_name'], {});
  await deps.queryTable('sysapproval_approver', 'state=requested^sysapproval.sys_class_name=sc_req_item', ['sys_id', 'sysapproval.sys_class_name'], {});
  await deps.queryTable('task_sla', 'active=true^task.sys_class_nameINincident^task.assignment_groupINg', ['task'], {});
  await deps.queryTable('sc_task', 'active=true', ['number', 'request_item.requested_for.user_name'], {});
  await deps.queryTable('sc_req_item', 'active=true', ['sc_item_option.item_option_new.question_text'], {});
  assert.equal(fake.calls.length, 6);
});

// ---- Every dot-walk in src/ is in the map ----------------------------------------------------------------------------------

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'i18n' ? [] : sourceFiles(full);
    return /\.jsx?$/.test(d.name) ? [full] : [];
  });
}

// A dotted name inside a string: right after a quote, a caret or a query prefix (OR, NQ, ORDERBY...), and followed by the end of the
// string, an operator (=, !=, <, IN, LIKE...), the next condition or a ${...}. `sysapproval.${...}` (a walk whose column is filled in)
// counts too. Whole-line comments are left out.
const DOTTED = /(?<=[`'"^]|\^(?:OR|NQ)|ORDERBY(?:DESC)?)([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\.(?:[a-z][a-z0-9_]*(?=[`'"^=!<>A-Z]|\$\{)|(?=\$\{))/g;
// Dotted strings that are not columns: the snippet variables ({{caller.first_name}}) and file names.
const NOT_COLUMNS = new Set(BUILTIN_VARIABLES.map((v) => v.name).filter((name) => name.includes('.')));
const FILE_NAME = /\.(?:js|jsx|css|html|json)$/;

test('every step of every dot-walk written in src/ is in DOT_WALK_TABLES', () => {
  const missing = [];
  let found = 0;
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const code = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
    for (const m of code.matchAll(DOTTED)) {
      const token = m[0];
      if (NOT_COLUMNS.has(token) || FILE_NAME.test(token)) continue;
      found += 1;
      for (const step of m[1].split('.')) if (!DOT_WALK_TABLES[step]) missing.push(`${path.relative(root, file)}: ${token} (${step})`);
    }
  }
  assert.ok(found >= 15, `the scan really found the dot-walks (${found})`);
  assert.deepEqual(missing, [], 'add the column and the table it points at to DOT_WALK_TABLES (src/content/policyGuard.js)');
});

test('the dot-walks built at run time are in the map too: My work\'s customer login on every table it reads', () => {
  for (const table of Object.keys(KNOWN_TABLES)) {
    for (const column of columnsFor(table, { group: true })) {
      if (column.includes('.')) assert.ok(walkTables(column), `${table}: ${column}`);
    }
  }
  // and nowhere else is a column put together around a dot (a new place must be added to this test). File names and the classic
  // form address (`${table}.do`) are not columns.
  const dynamic = [];
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\}\.([a-z][a-z0-9_]*)\b/g)) {
      if (['csv', 'json', 'txt', 'do'].includes(m[1])) continue;
      dynamic.push(`${path.relative(root, file).replace(/\\/g, '/')}: .${m[1]}`);
    }
  }
  const known = new Set(['src/mywork/tables.js: .user_name']);
  assert.deepEqual(dynamic.filter((d) => !known.has(d)), [], 'a column built around a dot: check its steps against DOT_WALK_TABLES and list it here');
});
