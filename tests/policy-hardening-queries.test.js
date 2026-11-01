// SEC-13 (values that go into an encoded query), SEC-14 (the tables the code reads are all written down in docs/security.md) and the
// last guarantees of this pass: the reference-table allow-list, and the claim that nothing here writes or opens a new destination.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { queryValue } from '../src/context/util.js';
import { findOpenDuplicates } from '../src/context/similar.js';
import { REFERENCE_TABLES, isReferenceTableAllowed } from '../src/context/related.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

const root = path.join(__dirname, '..');
const ID = 'a'.repeat(32);

// ---- SEC-13: queryValue ---------------------------------------------------------------------------------------------------

test('SEC-13: ordinary names pass unchanged (trimmed)', () => {
  for (const name of ['VPN Gateway EU', 'gw-eu-1', 'Cloud Gateway Service', 'Server: A', "O'Brien's laptop", 'SAP (prod) #2', 'café-server', 'JavaScript Runtime Host', 'a@b.example', '100% uptime', 'x=y']) {
    assert.equal(queryValue(name), name, name);
  }
  assert.equal(queryValue('  padded  '), 'padded');
  assert.equal(queryValue(42), '42');
});

test('SEC-13: a caret, a backslash and every control character are refused', () => {
  const bad = ['a^b', 'a^ORactive=true', '^', 'a\\b', '\\', 'a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u0001b', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a b', 'a b', 'x\u001b[31m'];
  for (const value of bad) assert.equal(queryValue(value), '', JSON.stringify(value));
});

test('SEC-13: "javascript:" in any case, with invisible characters or spaces inside it, anywhere in the value, is refused', () => {
  const bad = [
    'javascript:alert(1)',
    'JAVASCRIPT:gs.getUserID()',
    'JavaScript:x',
    '  javascript:x',
    'prefix javascript:x',
    'a-javascript:-b',
    'java​script:x', // zero width space
    'java­script:x', // soft hyphen
    'java⁠script:x', // word joiner
    'java﻿script:x', // byte order mark
    'java script:x',
    'j a v a s c r i p t :x',
    'java‮script:x', // right-to-left override
  ];
  for (const value of bad) assert.equal(queryValue(value), '', JSON.stringify(value));
});

test('SEC-13: nothing, null and undefined are refused too', () => {
  for (const value of ['', '   ', null, undefined]) assert.equal(queryValue(value), '');
});

test('SEC-13: findOpenDuplicates puts no name and none of the refused values into a query: only sys_ids', async () => {
  // Stronger than refusing bad names: the duplicate finder compares the CI and the service by their sys_ids, read from the record
  // itself, so no display text (the pack's or the instance's) is ever part of a condition.
  for (const name of ['javascript:gs.getUserID()', 'a\\b', 'a\u0000b', 'a^b', 'gw-eu-1']) {
    const deps = fakeDeps({ incident: [{ sys_id: v(ID), number: v('INC1'), short_description: v('x'), cmdb_ci: v('c'.repeat(32), name), opened_at: v('2026-10-26 08:00:00') }] });
    await findOpenDuplicates({ table: 'incident', sysId: ID, fields: { cmdb_ci: name } }, deps, {});
    for (const call of deps.calls) {
      assert.ok(!call.query.includes(name), `${JSON.stringify(name)} is not in ${call.query}`);
      assert.match(call.query, /^(?:sys_id=[0-9a-f]{32}|cmdb_ci=[0-9a-f]{32}\^active=true\^sys_id!=[0-9a-f]{32}\^ORDERBYDESCopened_at)$/);
    }
  }
  // A STORED value that is not a sys_id (a bad import, a forged answer) is refused the same way: no query is built from it.
  for (const stored of ['javascript:gs.getUserID()', 'a^ORactive=true', 'gw-eu-1']) {
    const deps = fakeDeps({ incident: [{ sys_id: v(ID), number: v('INC1'), cmdb_ci: v(stored, 'x'), opened_at: v('2026-10-26 08:00:00') }] });
    const { hits, access } = await findOpenDuplicates({ table: 'incident', sysId: ID, fields: { cmdb_ci: 'x' } }, deps, {});
    assert.deepEqual(hits, []);
    assert.equal(access[0].status, 'skipped');
    assert.deepEqual(deps.calls.map((c) => c.query), [`sys_id=${ID}`], `only the record itself was read for ${JSON.stringify(stored)}`);
  }
});

// ---- SEC-13: the reference tables ---------------------------------------------------------------------------------------------

test('SEC-13: the reference-table allow-list has the tables request forms ask for, valid names only, and nothing else', () => {
  for (const table of ['sys_user', 'sys_user_group', 'cmdb_ci', 'cmn_location', 'cmn_department', 'sc_cat_item', 'kb_knowledge', 'task', 'incident']) {
    assert.ok(isReferenceTableAllowed(table), table);
  }
  assert.ok(isReferenceTableAllowed('cmdb_ci_server'), 'a subclass of cmdb_ci');
  assert.ok(isReferenceTableAllowed('cmdb_ci_linux_server'));
  for (const table of ['u_cost_center_owner', 'sys_user_has_role', 'sys_properties', 'sys_audit', 'sys_journal_field', 'sn_hr_core_case', 'cmdb_ciX', 'cmdb_cifoo', 'sys_security_acl', 'syslog', 'sys_user ', '', 'SYS_USER']) {
    assert.ok(!isReferenceTableAllowed(table), JSON.stringify(table));
  }
  for (const table of REFERENCE_TABLES) assert.match(table, /^[a-z][a-z0-9_]*$/);
  assert.ok(!REFERENCE_TABLES.some((t) => t.startsWith('sn_hr_')), 'HR tables are never a reference answer');
});

// ---- SEC-14: every table the code reads is written down -------------------------------------------------------------------

const security = fs.readFileSync(path.join(root, 'docs', 'security.md'), 'utf8');

function files(dir) {
  const full = path.join(root, dir);
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.jsx?$/.test(d.name) ? [path.join(full, d.name)] : []));
}

// The tables a ticket's own record can be (and their families) are the open record, not an auxiliary read.
const OPEN_RECORD_TABLES = new Set([
  'incident', 'problem', 'change_request', 'sc_request', 'sc_req_item', 'sc_task', 'sn_customerservice_case', 'sn_hr_core_case', 'task',
  'kb_knowledge', 'interaction', 'sn_hr_core_task', 'incident_task', 'change_task', 'problem_task', 'sn_customerservice_task',
]);

test('SEC-14: every table that src/context and src/content/ops read by name is in docs/security.md (as a ticket table or an auxiliary read)', () => {
  const found = new Set();
  const patterns = [
    /softRead\(\s*deps,\s*'([a-z][a-z0-9_]*)'/g,
    /queryTable\(\s*'([a-z][a-z0-9_]*)'/g,
    /\btable:\s*'([a-z][a-z0-9_]*)'/g,
    /\b(?:const|let)\s+[A-Za-z_]*TABLE\w*\s*=\s*'([a-z][a-z0-9_]*)'/g,
    /\bconst\s+source\s*=\s*'([a-z][a-z0-9_]*)'/g,
  ];
  // Round 3: My work and the Ticket screen's Insights cards read through their own modules.
  const more = ['src/mywork', 'src/insights'].filter((dir) => fs.existsSync(path.join(root, dir)));
  for (const file of [...files('src/context'), ...files('src/content/ops'), ...more.flatMap(files)]) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of patterns) for (const m of code.matchAll(re)) found.add(m[1]);
  }
  assert.ok(found.size > 12, `the scan finds the tables (${[...found].join(', ')})`);
  for (const table of ['task_sla', 'sysapproval_approver', 'sc_item_option_mtom', 'm2m_kb_task', 'kb_use', 'sys_cs_message', 'live_message', 'sys_journal_field']) {
    assert.ok(found.has(table), `the scan reaches ${table}`);
  }
  const missing = [...found].filter((table) => !OPEN_RECORD_TABLES.has(table) && !security.includes(table));
  assert.deepEqual(missing, [], 'add these tables to the auxiliary reads in docs/security.md');
});

test('SEC-14: the auxiliary-reads table is marked, and says which reads return only ids or yes/no', () => {
  assert.match(security, /## 5A\. Auxiliary reads/);
  const section = security.slice(security.indexOf('## 5A. Auxiliary reads'), security.indexOf('## 6. Threat model'));
  for (const table of ['m2m_kb_task', 'kb_use', 'problem_id', 'sc_task.request_item', 'sys_cs_message', 'live_message']) assert.ok(section.includes(table), table);
  assert.match(section, /ids \/ yes-no/);
  assert.match(section, /Unverified/);
});

test('docs/security.md and docs/deployment.md name the new policy key, the HR endpoint rule and case-insensitivity', () => {
  const deployment = fs.readFileSync(path.join(root, 'docs', 'deployment.md'), 'utf8');
  assert.match(deployment, /sensitiveTablePrefixes/);
  assert.match(deployment, /pins the AI endpoint|pin.*endpoint/i);
  assert.match(deployment, /not case-sensitive/i);
  assert.match(deployment, /coaching-snapshot/);
  assert.match(security, /sensitiveTablePrefixes/);
  assert.match(security, /BLOCKED_TABLE/);
  assert.match(security, /person named only inside another ticket's prose/i);
  assert.match(security, /tokenBudgetPerDay/);
});

// ---- Nothing new on the wire ---------------------------------------------------------------------------------------------------

test('this pass added no network destination, no permission and no write: the guard and the key maps have no fetch, no chrome.* but storage.managed', () => {
  for (const file of ['src/content/policyGuard.js', 'src/features/partColumns.js']) {
    const code = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|\.method\s*=|'(POST|PUT|PATCH|DELETE)'/.test(code), file);
    const chromeUses = [...code.matchAll(/chrome\.[a-zA-Z.]+/g)].map((m) => m[0]);
    for (const use of chromeUses) assert.ok(/^chrome\.storage\.managed$|^chrome\.storage$/.test(use) || use === 'chrome.storage?.managed', `${file}: ${use}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(!(manifest.permissions || []).includes('tabs'));
});
