// The two organisation keys of N17 and N28: `defaultDashboard` (one Team dashboard for everyone, exactly a saved layout file) and
// `priorityAccounts` (account names marked "Priority account"). Read like every other key (a wrong type is "not set", sizes are
// capped), combined with an enterprise build's floor, explained to an administrator, checked strictly in an enterprise config, and
// in step with managed_schema.json down to every part of a saved layout file (the browser drops what the schema does not declare).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PRIORITY_ACCOUNT_LIMITS, effectiveSettings, mergePolicies, normalizePolicy, policyProblems } from '../src/policy/policy.js';
import { validateEnterpriseConfig } from '../src/policy/enterprise.js';
import { LAYOUT_KIND, LAYOUT_MAX_CHARS } from '../src/reports/layoutFile.js';
import { CAPS, addWidget, defaultState, exportLayout, orgDashboardProblems, setDashboardSetup, updateWidget } from '../src/reports/dashboards.js';
import { GROUP_A } from './reports-fixtures.js';

const ROOT = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'managed_schema.json'), 'utf8'));
const deployment = fs.readFileSync(path.join(ROOT, 'docs', 'deployment.md'), 'utf8');

const WIDGETS = [{ type: 'section', section: 'overview' }, { type: 'section', section: 'sla' }];
const layout = (dashboard = {}) => ({ kind: LAYOUT_KIND, version: 1, dashboard: { name: 'Service desk today', scope: { kind: 'groups' }, widgets: WIDGETS, ...dashboard } });
const checked = (raw) => policyProblems(raw, { checkDashboard: orgDashboardProblems });
const levels = (problems, key) => problems.filter((p) => p.key === key).map((p) => p.level);

// ---- defaultDashboard ---------------------------------------------------------------------------------------------------------

test('defaultDashboard: a saved layout is kept as plain data, its four parts and nothing else', () => {
  const raw = { ...layout({ secret: 'ticket text', tables: ['incident'] }), extra: { rows: [1] } };
  const p = normalizePolicy({ defaultDashboard: raw });
  assert.deepEqual(p.defaultDashboard, { kind: LAYOUT_KIND, version: 1, dashboard: { name: 'Service desk today', scope: { kind: 'groups' }, tables: ['incident'], widgets: WIDGETS } });
  assert.notEqual(p.defaultDashboard.dashboard.widgets, WIDGETS, 'a copy, not the browser\'s object');
  assert.deepEqual(normalizePolicy(p), p, 'reading it twice gives the same policy');
  // The file's text (a Windows registry string) is read as the file; a version written as text is read as the number.
  const text = normalizePolicy({ defaultDashboard: `﻿${JSON.stringify({ ...layout(), version: '1' })}` });
  assert.deepEqual(text.defaultDashboard, { kind: LAYOUT_KIND, version: 1, dashboard: layout().dashboard });
  // The sections inside are left for the reports code to clean, like a file a person loads.
  const odd = normalizePolicy({ defaultDashboard: layout({ widgets: [{ type: 'script', src: 'x.js' }] }) });
  assert.deepEqual(odd.defaultDashboard.dashboard.widgets, [{ type: 'script', src: 'x.js' }]);
});

test('defaultDashboard: anything that is not one layout of this version is "not set"', () => {
  const big = layout({ name: 'x'.repeat(LAYOUT_MAX_CHARS) });
  for (const bad of [undefined, null, true, 7, 'text', '{not json', [], [layout()], { ...layout(), kind: 'something-else' }, { ...layout(), version: 2 }, { ...layout(), version: 0 }, { kind: LAYOUT_KIND, version: 1 }, { kind: LAYOUT_KIND, version: 1, dashboard: [] }, big, JSON.stringify(big)]) {
    assert.equal(normalizePolicy({ defaultDashboard: bad }).defaultDashboard, null, JSON.stringify(bad)?.slice(0, 60));
  }
  const cyclic = layout();
  cyclic.dashboard.scope.self = cyclic;
  assert.equal(normalizePolicy({ defaultDashboard: cyclic }).defaultDashboard, null, 'never throws');
  assert.equal(normalizePolicy({}).defaultDashboard, null);
});

test('policyProblems: a layout that is ignored is an error; a value read differently is a note; the sections are checked when the reports code is passed', () => {
  assert.deepEqual(checked({ defaultDashboard: layout() }), []);
  assert.deepEqual(policyProblems({ defaultDashboard: layout() }), []);
  const one = (value, re, level = 'error', check = true) => {
    const found = (check ? checked : policyProblems)({ defaultDashboard: value }).filter((p) => p.key === 'defaultDashboard');
    assert.ok(found.some((p) => p.level === level && re.test(p.message)), `${JSON.stringify(found)}`);
  };
  one('not a layout', /must be one dashboard layout.*Save layout as a file/);
  one([layout()], /must be one dashboard layout/);
  one({ ...layout(), version: 3 }, /newer version of Agent Buddy/);
  one(JSON.stringify(layout({ name: 'x'.repeat(LAYOUT_MAX_CHARS) })), /longer than 60000 characters/);
  one(JSON.stringify(layout()), /read as the layout file's JSON/, 'note');
  one(layout({ tables: null }), /leave "tables" out/, 'note');
  one(layout({ widgets: [{ type: 'section', section: 'nope' }] }), /no section this version/);
  one(layout({ widgets: [...WIDGETS, { type: 'section', section: 'nope' }, { type: 'chart' }] }), /2 of its widgets are not a section/, 'note');
  one(layout({ name: '   ' }), /no name; it is shown as "My dashboard"/, 'note');
  one(layout({ name: 'N'.repeat(80) }), /shown as "N{60}"/, 'note');
  one(layout({ widgets: Array.from({ length: CAPS.widgets + 2 }, () => ({ type: 'section', section: 'sla' })) }), /only the first 24 widgets/, 'note');
  // Without the reports code only the envelope is judged (the content script reads policies without it).
  assert.deepEqual(policyProblems({ defaultDashboard: layout({ widgets: [{ type: 'section', section: 'nope' }] }) }), []);
  assert.match(policyProblems({ defaultdashboard: layout() })[0].message, /Did you mean "defaultDashboard"/);
});

// ---- priorityAccounts ---------------------------------------------------------------------------------------------------------

test('priorityAccounts: text only, trimmed, each name once whatever its case; too long is dropped, never cut; at most 500', () => {
  const long = 'A'.repeat(PRIORITY_ACCOUNT_LIMITS.length + 1);
  const p = normalizePolicy({ priorityAccounts: [' Boxeo ', 'BOXEO', 'Acme Corporation EMEA', '', '   ', 42, null, { name: 'x' }, ['Boxeo'], long, 'A'.repeat(100)] });
  assert.deepEqual(p.priorityAccounts, ['Boxeo', 'Acme Corporation EMEA', 'A'.repeat(100)]);
  assert.deepEqual(normalizePolicy(p).priorityAccounts, p.priorityAccounts);
  const many = Array.from({ length: 600 }, (_, i) => `Account ${i}`);
  const capped = normalizePolicy({ priorityAccounts: many }).priorityAccounts;
  assert.equal(capped.length, PRIORITY_ACCOUNT_LIMITS.count);
  assert.equal(capped[499], 'Account 499');
  for (const bad of ['Boxeo', { 0: 'Boxeo' }, 3, true, null]) assert.deepEqual(normalizePolicy({ priorityAccounts: bad }).priorityAccounts, [], JSON.stringify(bad));
  assert.deepEqual(normalizePolicy({}).priorityAccounts, []);
});

test('policyProblems names every priority account that is ignored, and the cap', () => {
  const problems = policyProblems({ priorityAccounts: ['Boxeo', 7, '', 'x'.repeat(101), ...Array.from({ length: 500 }, (_, i) => `A${i}`)] });
  const messages = problems.map((p) => `${p.level} ${p.message}`);
  assert.ok(messages.some((m) => /^error priorityAccounts\[1\]: 7 is not a text value/.test(m)), messages.join('\n'));
  assert.ok(messages.some((m) => /^error priorityAccounts\[2\]/.test(m)));
  assert.ok(messages.some((m) => /^error priorityAccounts\[3\] is longer than 100 characters/.test(m)));
  assert.ok(messages.some((m) => /^note priorityAccounts: only the first 500 names/.test(m)));
  assert.deepEqual(levels(policyProblems({ priorityAccounts: 'Boxeo' }), 'priorityAccounts'), ['error']);
  assert.deepEqual(policyProblems({ priorityAccounts: ['Boxeo', 'Acme Corporation EMEA'] }), []);
});

// ---- Combining with an enterprise build's floor, and what the panel gets -------------------------------------------------------

test('enterprise floor: the managed policy\'s dashboard wins over the compiled-in one; priority accounts are joined', () => {
  const floor = { defaultDashboard: layout({ name: 'Build dashboard' }), priorityAccounts: ['Boxeo', 'Initech'] };
  const managed = { defaultDashboard: layout({ name: 'Managed dashboard' }), priorityAccounts: ['initech', 'Globex'] };
  const both = mergePolicies(floor, managed);
  assert.equal(both.defaultDashboard.dashboard.name, 'Managed dashboard');
  assert.deepEqual(both.priorityAccounts, ['Boxeo', 'Initech', 'Globex']);
  assert.equal(mergePolicies(floor, {}).defaultDashboard.dashboard.name, 'Build dashboard', 'the floor\'s when the managed policy sets none');
  assert.equal(mergePolicies({}, managed).defaultDashboard.dashboard.name, 'Managed dashboard');
  assert.equal(mergePolicies(floor, { defaultDashboard: 'not a layout' }).defaultDashboard.dashboard.name, 'Build dashboard', 'an invalid one is not set');
  assert.equal(mergePolicies({}, {}).defaultDashboard, null);
  const many = (prefix) => Array.from({ length: 300 }, (_, i) => `${prefix} ${i}`);
  assert.equal(mergePolicies({ priorityAccounts: many('F') }, { priorityAccounts: many('M') }).priorityAccounts.length, PRIORITY_ACCOUNT_LIMITS.count);
  // Nothing about either key is locked: they reach the panel as policy, the person's settings are untouched.
  const eff = effectiveSettings({}, managed);
  assert.equal(eff.policy.defaultDashboard.dashboard.name, 'Managed dashboard');
  assert.deepEqual(eff.policy.priorityAccounts, ['initech', 'Globex']);
  assert.deepEqual(Object.keys(eff.locked), []);
});

// ---- Enterprise config ----------------------------------------------------------------------------------------------------------

const base = { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'openai' };
const enterpriseErrors = (extra) => validateEnterpriseConfig({ ...base, ...extra }).errors.join('\n');

test('enterprise config: both keys are compiled in exactly as written; anything the panel would read differently stops the build', () => {
  const ok = validateEnterpriseConfig({ ...base, defaultDashboard: layout({ tables: null }), priorityAccounts: ['Boxeo'] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.plan.policy.defaultDashboard, layout({ tables: null }));
  assert.deepEqual(ok.plan.policy.priorityAccounts, ['Boxeo']);
  assert.match(enterpriseErrors({ defaultDashboard: JSON.stringify(layout()) }), /defaultDashboard: must be one dashboard layout/);
  assert.match(enterpriseErrors({ defaultDashboard: { ...layout(), note: 'x' } }), /may only have kind, version and dashboard \(not note\)/);
  assert.match(enterpriseErrors({ defaultDashboard: { ...layout(), version: '1' } }), /version 1/);
  assert.match(enterpriseErrors({ defaultDashboard: layout({ secret: 'x' }) }), /dashboard may only have name, scope, tables and widgets \(not secret\)/);
  assert.match(enterpriseErrors({ defaultDashboard: layout({ widgets: [...WIDGETS, { type: 'section', section: 'nope' }] }) }), /defaultDashboard: 1 of its widgets is not a section/);
  assert.match(enterpriseErrors({ defaultDashboard: layout({ widgets: [] }) }), /no section this version/);
  assert.match(enterpriseErrors({ priorityAccounts: ['Boxeo', 'Boxeo'] }), /listed twice/);
  assert.match(enterpriseErrors({ priorityAccounts: [' Boxeo'] }), /spaces around it/);
  assert.match(enterpriseErrors({ priorityAccounts: ['x'.repeat(101)] }), /longer than 100 characters/);
  assert.match(enterpriseErrors({ priorityAccounts: [7] }), /must be text/);
  assert.match(enterpriseErrors({ priorityAccounts: Array.from({ length: 501 }, (_, i) => `A${i}`) }), /at most 500/);
});

// ---- managed_schema.json declares every part of a saved layout -----------------------------------------------------------------

// The browser checks a policy against the schema and drops what it does not declare, so every part a saved file can hold must be in it.
function assertDeclared(def, value, where) {
  if (value === null) {
    // The one null a saved file holds: "tables" for every table (docs/deployment.md says to leave it out).
    assert.equal(where, 'defaultDashboard.dashboard.tables', `${where} is null`);
    return;
  }
  if (Array.isArray(value)) {
    assert.equal(def.type, 'array', where);
    value.forEach((item, i) => assertDeclared(def.items, item, `${where}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    assert.equal(def.type, 'object', where);
    for (const [key, inner] of Object.entries(value)) {
      const next = def.properties?.[key] || def.additionalProperties;
      assert.ok(next, `${where}.${key} is declared in managed_schema.json`);
      assertDeclared(next, inner, `${where}.${key}`);
    }
    return;
  }
  const type = typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
  assert.equal(def.type, type, where);
}

test('managed_schema.json declares every part a saved layout file can hold, with the type the file writes', () => {
  let n = 0;
  const makeId = (prefix) => `${prefix}-${(n += 1)}`;
  let state = defaultState(makeId);
  const team = state.dashboards.find((d) => d.id === 'preset-team');
  state = setDashboardSetup(state, team.id, { scope: { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } }, tables: ['incident', 'sc_req_item'] });
  state = addWidget(state, team.id, { type: 'builder', builder: { table: 'incident', presets: ['open', 'my_groups'], groupBy: 'priority', metric: 'count', chart: 'bar', title: 'Open by priority' } }, makeId);
  const quality = state.dashboards.find((d) => d.id === team.id).widgets.find((w) => w.section === 'quality');
  state = updateWidget(state, team.id, quality.id, { params: { trend: 'week-8', staleDays: 5 } });
  const files = state.dashboards.map((d) => exportLayout(d));
  const rich = files.find((f) => f.dashboard.name === 'Team overview');
  assert.ok(rich.dashboard.widgets.some((w) => w.type === 'builder') && rich.dashboard.widgets.some((w) => w.params?.staleDays === 5), 'the sample holds a custom report and section settings');
  assert.ok(rich.dashboard.scope.groupNames[GROUP_A]);
  for (const file of files) assertDeclared(schema.properties.defaultDashboard, file, 'defaultDashboard');
  // And each of them, as the policy value, is read and shown without a word.
  for (const file of files) {
    const { tables, ...dashboard } = file.dashboard;
    const value = { ...file, dashboard: tables === null ? dashboard : file.dashboard };
    assert.deepEqual(checked({ defaultDashboard: value }), [], file.dashboard.name);
  }
});

test('the example in docs/deployment.md is a policy that is read exactly as written', () => {
  const section = deployment.split('### Organisation dashboard and priority accounts')[1];
  assert.ok(section, 'docs/deployment.md has the section');
  const example = JSON.parse(/```json\r?\n([\s\S]*?)\r?\n```/.exec(section)[1]);
  assert.deepEqual(Object.keys(example).sort(), ['defaultDashboard', 'priorityAccounts']);
  assert.deepEqual(checked(example), []);
  assertDeclared(schema.properties.defaultDashboard, example.defaultDashboard, 'defaultDashboard');
  assert.equal(validateEnterpriseConfig({ ...base, ...example }).ok, true);
});

// ---- scripts/check-policy.js -----------------------------------------------------------------------------------------------------

test('scripts/check-policy.js checks the dashboard\'s sections with the reports code and names each ignored priority account', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-org-keys-'));
  try {
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify({ defaultDashboard: layout({ widgets: [...WIDGETS, { type: 'section', section: 'nope' }] }), priorityAccounts: ['Boxeo'] }));
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ defaultDashboard: layout({ widgets: [{ type: 'section', section: 'nope' }] }), priorityAccounts: ['Boxeo', 7] }));
    const run = (file) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-policy.js'), file], { cwd: ROOT, encoding: 'utf8' });
    const ok = run(good);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /note +defaultDashboard: 1 of its widgets is not a section/);
    assert.match(ok.stdout, /defaultDashboard: "Service desk today" \(3 widgets\)/);
    assert.match(ok.stdout, /priorityAccounts: \["Boxeo"\]/);
    const no = run(bad);
    assert.equal(no.status, 1);
    assert.match(no.stdout, /ERROR +defaultDashboard: it holds no section this version/);
    assert.match(no.stdout, /ERROR +priorityAccounts\[1\]: 7 is not a text value/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
