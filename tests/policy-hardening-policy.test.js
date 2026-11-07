// Security review, policy findings: SEC-18 (feature ids, table and field names are not case-sensitive), SEC-04 (the policy list of
// sensitive table prefixes, and the real class of a record opened through `task`), SEC-12 (an unknown feature is refused) and the
// managed schema that documents the keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SENSITIVE_PREFIXES, isFeatureEnabled, isSensitiveByPolicy, isTableAllowed, normalizePolicy } from '../src/policy/policy.js';
import { featuresFor, isFeatureAvailable, featureById, FEATURES } from '../src/features/registry.js';
import { BUILT_IN_SENSITIVE_PREFIXES, isSensitiveTable } from '../src/context/kinds.js';
import { allowedFields } from '../src/context/allowlists.js';
import { readContextPack } from '../src/context/pack.js';
import { checkPackFeature, handleRead } from '../src/content/reads.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

const ID = 'a'.repeat(32);

// ---- SEC-18: case-insensitive ids -----------------------------------------------------------------------------------

test('SEC-18: "Reply-Draft" in the policy switches off reply-draft, on both sides of the comparison', () => {
  const policy = normalizePolicy({ disabledFeatures: ['Reply-Draft', '  RECORD-SUMMARY  '] });
  assert.deepEqual(policy.disabledFeatures, ['reply-draft', 'record-summary']);
  assert.equal(isFeatureEnabled('reply-draft', policy), false);
  assert.equal(isFeatureEnabled('Reply-Draft', policy), false);
  assert.equal(isFeatureEnabled('handoff-brief', policy), true);
  // A policy object that was NOT normalised (someone passes the raw list) is still compared in lower case.
  assert.equal(isFeatureEnabled('reply-draft', { disabledFeatures: ['Reply-Draft'] }), false);
  assert.equal(isFeatureEnabled('REPLY-DRAFT', { disabledFeatures: ['reply-draft'] }), false);
});

test('SEC-18: the Actions list and isFeatureAvailable use the same case-insensitive match', () => {
  const policy = { disabledFeatures: ['Reply-Draft'] };
  assert.equal(isFeatureAvailable(featureById('reply-draft'), policy), false);
  assert.equal(isFeatureAvailable(featureById('record-summary'), policy), true);
  assert.ok(!featuresFor('incident', policy).some((f) => f.id === 'reply-draft'));
  assert.ok(featuresFor('incident', {}).some((f) => f.id === 'reply-draft'));
});

test('SEC-18: blocked tables and fields are lower case too, and a table is matched whatever its case', () => {
  const policy = normalizePolicy({ blockedTables: ['SC_Item_Option_MTOM', ' Incident '], blockedFields: ['Short_Description'] });
  assert.deepEqual(policy.blockedTables, ['sc_item_option_mtom', 'incident']);
  assert.deepEqual(policy.blockedFields, ['short_description']);
  assert.equal(isTableAllowed('INCIDENT', policy), false);
  assert.equal(isTableAllowed('problem', policy), true);
  assert.equal(isTableAllowed('Incident', { blockedTables: ['INCIDENT'] }), false);
});

test('the feature ids named in docs/deployment.md exist, are lower case and are unique', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(id, id.toLowerCase());
  // The AI features of the Team section: there is no single "reports" switch, each one has its own id.
  for (const id of ['shift-handover', 'dashboard-insights', 'coaching-snapshot']) assert.ok(ids.includes(id), id);
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'deployment.md'), 'utf8');
  for (const id of ids) assert.ok(doc.includes('`' + id + '`'), 'docs/deployment.md lists the feature id ' + id);
});

// ---- SEC-04: sensitiveTablePrefixes ----------------------------------------------------------------------------------------

test('SEC-04: sensitiveTablePrefixes defaults to the built-in families (HR; since round 4 security and risk too), adds to them, and can never remove one', () => {
  assert.deepEqual(DEFAULT_SENSITIVE_PREFIXES, BUILT_IN_SENSITIVE_PREFIXES);
  assert.deepEqual(DEFAULT_SENSITIVE_PREFIXES, ['sn_hr_', 'sn_si_', 'sn_vul_', 'sn_grc_', 'sn_risk_', 'sn_compliance_', 'sn_audit_']);
  assert.deepEqual(normalizePolicy({}).sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES]);
  assert.deepEqual(normalizePolicy({ sensitiveTablePrefixes: [] }).sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES]);
  assert.deepEqual(normalizePolicy({ sensitiveTablePrefixes: ['X_Acme_HR_', 'x_acme_legal_'] }).sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES, 'x_acme_hr_', 'x_acme_legal_']);
  // a list that tries to replace the default still has it
  assert.ok(normalizePolicy({ sensitiveTablePrefixes: ['x_acme_'] }).sensitiveTablePrefixes.includes('sn_hr_'));
});

test('SEC-04: garbage prefixes are dropped, never guessed (one letter, spaces, punctuation, a number, not a list)', () => {
  const p = normalizePolicy({ sensitiveTablePrefixes: ['x', 'has space', 'a;b', '9lives_', '*', '', 42, 'ok_prefix_'] });
  assert.deepEqual(p.sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES, 'ok_prefix_']);
  assert.deepEqual(normalizePolicy({ sensitiveTablePrefixes: 'x_acme_hr_' }).sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES]);
  assert.deepEqual(normalizePolicy({ sensitiveTablePrefixes: { 0: 'x_acme_' } }).sensitiveTablePrefixes, [...BUILT_IN_SENSITIVE_PREFIXES]);
});

test('SEC-04: isSensitiveByPolicy and isSensitiveTable use the policy prefixes and keep the default behaviour', () => {
  const policy = normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'] });
  assert.equal(isSensitiveByPolicy('sn_hr_core_case', policy), true);
  assert.equal(isSensitiveByPolicy('x_acme_hr_case_leave', policy), true);
  assert.equal(isSensitiveByPolicy('X_ACME_HR_CASE', policy), true);
  assert.equal(isSensitiveByPolicy('incident', policy), false);
  assert.equal(isSensitiveByPolicy('', policy), false);
  assert.equal(isSensitiveByPolicy('x_acme_hr_case', normalizePolicy({})), false, 'without the prefix the table is ordinary');
  assert.equal(isSensitiveByPolicy('sn_hr_core_case', null), true, 'no policy: the default prefix still applies');
  // the context engine's own test takes the same list
  assert.equal(isSensitiveTable('sn_hr_core_case'), true);
  assert.equal(isSensitiveTable('x_acme_hr_case'), false);
  assert.equal(isSensitiveTable('x_acme_hr_case', ['x_acme_hr_']), true);
  assert.equal(isSensitiveTable('incident', ['x_acme_hr_']), false);
});

test('SEC-04: a custom HR table is minimised like an HR case (free text and identities are not read)', () => {
  const open = allowedFields('x_acme_hr_case', 'record-summary', { sensitivePrefixes: ['x_acme_hr_'] });
  const ordinary = allowedFields('x_acme_hr_case', 'record-summary');
  assert.ok(ordinary.includes('short_description'));
  assert.ok(!open.includes('short_description') && !open.includes('description') && !open.includes('close_notes'));
  assert.ok(!open.includes('opened_by'), 'identities are withheld too');
  const allowed = allowedFields('x_acme_hr_case', 'record-summary', { sensitivePrefixes: ['x_acme_hr_'], allowSensitive: true });
  assert.ok(allowed.includes('short_description'));
});

test('SEC-04: readContextPack minimises a custom HR table when the deps carry the policy prefixes', async () => {
  const tables = { x_acme_hr_case: [{ sys_id: v(ID), number: v('HRX0001'), short_description: v('Medical leave for Ana'), state: v('1', 'Open'), assigned_to: v('', '') }] };
  const plain = await readContextPack({ table: 'x_acme_hr_case', sysId: ID }, fakeDeps(tables), { feature: 'record-summary' });
  assert.equal(plain.fields.short_description, 'Medical leave for Ana', 'without the policy the table is ordinary');
  const deps = fakeDeps(tables);
  deps.sensitivePrefixes = ['x_acme_hr_'];
  const pack = await readContextPack({ table: 'x_acme_hr_case', sysId: ID }, deps, { feature: 'record-summary' });
  assert.equal(pack.fields.short_description, undefined);
  assert.ok(pack.access.some((a) => a.status === 'skipped' && /sensitive/.test(a.note)));
});

// ---- SEC-04: the real class of a record addressed through `task` ----------------------------------------------------------

const incidentRow = { sys_id: v(ID), number: v('INC0010001'), short_description: v('VPN is down'), state: v('2', 'In Progress'), caller_id: v('b'.repeat(32), 'Abel Tuter'), sys_class_name: v('incident', 'Incident') };
const hrRow = { sys_id: v(ID), number: v('HRC0010001'), short_description: v('Sick leave for Meena Iyer'), state: v('1', 'Open'), sys_class_name: v('sn_hr_core_case', 'HR Case') };

test('SEC-04: a record opened as `task` is read as its real class (kind, columns and the pack\'s table)', async () => {
  const tables = { task: [incidentRow], incident: [incidentRow] };
  const deps = fakeDeps(tables);
  const pack = await readContextPack({ table: 'task', sysId: ID }, deps, { feature: 'record-summary' });
  assert.equal(pack.table, 'incident');
  assert.equal(pack.kind, 'incident');
  assert.equal(pack.fields.short_description, 'VPN is down');
  assert.equal(pack.sensitive, undefined);
  // one tiny read of the class first, with only sys_id and sys_class_name
  const first = deps.calls[0];
  assert.equal(first.table, 'task');
  assert.deepEqual(first.fields, ['sys_id', 'sys_class_name']);
  assert.equal(first.options.limit, 1);
});

test('SEC-04: an HR case opened as `task` is minimised like an HR case, and the pack says which table it really is', async () => {
  const tables = { task: [hrRow], sn_hr_core_case: [hrRow] };
  const pack = await readContextPack({ table: 'task', sysId: ID }, fakeDeps(tables), { feature: 'record-summary' });
  assert.equal(pack.table, 'sn_hr_core_case');
  assert.equal(pack.kind, 'hr_case');
  assert.equal(pack.fields.short_description, undefined, 'free text is not read');
  assert.ok(pack.access.some((a) => a.status === 'skipped'));
});

test('SEC-04: when the class cannot be looked up the record is treated as SENSITIVE and the pack says so', async () => {
  const taskRow = { sys_id: v(ID), number: v('TASK0010001'), short_description: v('Something private'), state: v('1', 'Open'), assigned_to: v('c'.repeat(32), 'Beth Anglin'), opened_by: v('d'.repeat(32), 'Dana Whitfield') };
  for (const setup of [{ denied: ['task'] }, { errors: { task: new Error('boom') } }]) {
    // the class lookup fails (403 or another error), the record itself would read fine through task
    let calls = 0;
    const base = fakeDeps({ task: [taskRow] });
    const deps = {
      ...base,
      queryTable: async (table, query, fields, options) => {
        calls += 1;
        if (calls === 1) throw (setup.denied ? Object.assign(new Error('403'), { code: 'ACCESS_DENIED' }) : setup.errors.task);
        return base.queryTable(table, query, fields, options);
      },
    };
    const pack = await readContextPack({ table: 'task', sysId: ID }, deps, { feature: 'record-summary' });
    assert.equal(pack.sensitive, true);
    assert.equal(pack.table, 'task');
    assert.equal(pack.fields.short_description, undefined, 'minimised: free text not read');
    assert.equal(pack.fields.opened_by, undefined, 'minimised: identities not read');
    const note = pack.access.find((a) => a.status === 'skipped');
    assert.match(note.note, /real type could not be looked up/);
    assert.match(note.note, /sensitive/);
  }
});

test('SEC-04: a class that is itself `task`, and a record that is not a task at all, are left alone', async () => {
  const plain = { sys_id: v(ID), number: v('TASK0010001'), short_description: v('A plain task'), state: v('1', 'Open'), sys_class_name: v('task', 'Task') };
  const pack = await readContextPack({ table: 'task', sysId: ID }, fakeDeps({ task: [plain] }), { feature: 'record-summary' });
  assert.equal(pack.table, 'task');
  assert.equal(pack.sensitive, undefined);
  assert.equal(pack.fields.short_description, 'A plain task');
  const deps = fakeDeps({ incident: [incidentRow] });
  await readContextPack({ table: 'incident', sysId: ID }, deps, { feature: 'record-summary' });
  assert.ok(!deps.calls.some((c) => c.table === 'task' && c.query === `sys_id=${ID}`), 'no class lookup for a record that is not addressed as task');
});

test('SEC-04: a lost session during the class lookup stops the read (it is not "unresolved")', async () => {
  const deps = fakeDeps({ task: [incidentRow] }, { expired: ['task'] });
  await assert.rejects(() => readContextPack({ table: 'task', sysId: ID }, deps, { feature: 'record-summary' }), (e) => e.code === 'SESSION_EXPIRED');
});

test('SEC-04: the class decides what the policy guard says: an incident opened as `task` fails when incident is blocked', async () => {
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['incident'] } }) });
  const deps = await guard.deps(fakeDeps({ task: [incidentRow], incident: [incidentRow] }));
  await assert.rejects(() => readContextPack({ table: 'task', sysId: ID }, deps, { feature: 'record-summary' }), (e) => e.code === 'BLOCKED_TABLE' && e.table === 'incident');
});

// ---- SEC-12: an unknown feature is refused -------------------------------------------------------------------------------

test('SEC-12: reads.js refuses an unknown, mistyped or missing feature for `pack` instead of reading the widest list', async () => {
  for (const bad of ['record-sumary', 'RECORD-SUMMARY', '', undefined, null, 42, {}, ['record-summary'], '__proto__', 'constructor']) {
    assert.throws(() => checkPackFeature(bad), /not a feature/, String(bad));
  }
  assert.equal(checkPackFeature('record-summary'), 'record-summary');
  const guard = createPolicyGuard({ getManaged: async () => ({ known: false, raw: {} }) });
  const deps = fakeDeps({ incident: [incidentRow] });
  const ask = (args) => handleRead('pack', args, { guard, makeDeps: () => deps });
  await assert.rejects(() => ask({ table: 'incident', sysId: ID, feature: 'no-such-feature' }), /not a feature/);
  await assert.rejects(() => ask({ table: 'incident', sysId: ID }), /not a feature/);
  assert.equal(deps.calls.length, 0, 'nothing was read for the refused request');
  const ok = await ask({ table: 'incident', sysId: ID, feature: 'record-summary' });
  assert.equal(ok.table, 'incident');
});

// ---- The managed schema documents the keys -------------------------------------------------------------------------------

test('managed_schema.json has sensitiveTablePrefixes and says what the keys now do', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'managed_schema.json'), 'utf8'));
  assert.equal(schema.properties.sensitiveTablePrefixes.type, 'array');
  assert.deepEqual(schema.properties.sensitiveTablePrefixes.items, { type: 'string' });
  assert.match(schema.properties.sensitiveTablePrefixes.description, /sn_hr_/);
  assert.match(schema.properties.allowHrContent.description, /pinned|aiProvider/, 'HR content needs a pinned endpoint');
  assert.match(schema.properties.disabledFeatures.description, /case/i);
  assert.match(schema.properties.tokenBudgetPerDay.description, /day/i);
  assert.match(schema.properties.blockedFields.description, /carries/);
});
