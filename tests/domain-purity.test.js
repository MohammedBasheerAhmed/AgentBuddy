// The domain area is pure and read-only: src/domain has no browser APIs and no network, the read operation goes through the
// context engine's deps, and nothing here can write to the instance.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RELATED_BY_KIND, readRelated, relatedPlan } from '../src/context/related.js';
import { readContextPack } from '../src/context/pack.js';
import { OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { IDS, domainTables } from './domain-fixtures.js';

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// Comments and string contents do not count: only code is checked.
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const domainFiles = fs.readdirSync(path.join(root, 'src', 'domain')).filter((f) => f.endsWith('.js')).map((f) => `src/domain/${f}`);
const ownFiles = [...domainFiles, 'src/content/ops/domain.js', 'src/context/related.js', 'src/context/specs/domain.js', 'src/features/packs/domain.js'];

test('src/domain is made of the modules we expect', () => {
  for (const name of ['sections.js', 'parts.js', 'accountCases.js']) assert.ok(domainFiles.includes(`src/domain/${name}`), name);
});

test('no browser APIs, network calls or HTML injection in any file of this area', () => {
  // Property accesses, so a sentence that ends in the word "window." is not mistaken for a browser API.
  const banned = [/\bchrome\.[a-z]/, /\bfetch\s*\(/, /\bdocument\.[A-Za-z_$]/, /\bwindow\.[A-Za-z_$]/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bXMLHttpRequest\b/, /\bnavigator\.[A-Za-z_$]/, /\blocation\.[A-Za-z_$]/, /\bpostMessage\b/, /\binnerHTML\b/, /\beval\s*\(/, /new Function/, /\bWebSocket\b/, /sendBeacon/];
  for (const file of ownFiles) {
    for (const re of banned) assert.ok(!re.test(code(file)), `${file} uses ${re}`);
  }
});

test('nothing in this area names a write method or a write helper', () => {
  for (const file of ownFiles) {
    const text = code(file);
    assert.ok(!/['"`](?:POST|PUT|PATCH|DELETE)['"`]/.test(text), `${file} names a write method`);
    assert.ok(!/method\s*:/i.test(text), `${file} sets a request method`);
    assert.ok(!/\b(createRecord|updateRecord|deleteRecord|insertRecord|setValue|fillField|saveForm)\b/.test(text), `${file} calls a write helper`);
    assert.ok(!/\/api\/now\//.test(text), `${file} builds its own API address`);
  }
});

test('src/domain imports only from this area, the context helpers and the shared feature parts', () => {
  for (const file of domainFiles) {
    const imports = [...code(file).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(['./', '../context/util.js', '../context/access.js', '../features/parts.js'].some((ok) => spec === ok || spec.startsWith('./')), `${file} imports ${spec}`);
    }
  }
});

test('the read operation never reaches the AI side or the firewall', () => {
  const imports = [...code('src/content/ops/domain.js').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of imports) assert.ok(spec.startsWith('../../context/'), spec);
  assert.ok(!/providers\/|keyStore|pii\//.test(read('src/content/ops/domain.js')));
});

test('the extras and the read operation use only the four read functions of the deps (and an optional clock)', async () => {
  const fake = fakeDeps(domainTables());
  const touched = new Set();
  const deps = new Proxy(fake, {
    get(target, prop) {
      if (typeof prop === 'string' && prop !== 'then') touched.add(prop);
      return target[prop];
    },
  });
  const memo = new Map();
  for (const [kind, table, sysId, feature] of [
    ['problem', 'problem', IDS.problem, 'problem-rca'],
    ['change', 'change_request', IDS.change, 'change-cab-brief'],
    ['case', 'sn_customerservice_case', IDS.case, 'account-briefing'],
  ]) {
    await readRelated(relatedPlan({ kind, feature }), { table, sysId }, deps, memo);
  }
  await OPS.accountCases({ table: 'sn_customerservice_case', sysId: IDS.case }, { deps, checkRecord, checkPack });
  await readContextPack({ table: 'change_request', sysId: IDS.change }, deps, { feature: 'change-cab-brief' });
  const allowed = new Set(['queryTable', 'fetchRecord', 'countRecords', 'countByColumn', 'now']);
  for (const name of touched) assert.ok(allowed.has(name), `the deps were asked for ${name}`);
  assert.ok(touched.has('queryTable') && touched.has('countRecords'));
});

test('every table these extras read is a table the person\'s own session reads, and each is named once in the kinds table', () => {
  assert.deepEqual(RELATED_BY_KIND.problem, ['childTasks', 'linkedIncidents']);
  assert.deepEqual(RELATED_BY_KIND.change, ['approvals', 'changeTasks', 'conflicts']);
  assert.deepEqual(RELATED_BY_KIND.case, ['slas', 'childTasks', 'recentChanges']);
  const text = read('src/context/related.js');
  // the queries are built from validated ids only: the record's sys_id (checked by resolveRecordRef) or a 32-hex reference
  assert.ok(/SYS_ID_RE\.test\(id\)/.test(text) && /SYS_ID_RE\.test\(ci\)/.test(text));
});
