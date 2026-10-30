// The review pack (docs/review-pack): every test a review document names exists, the STRIDE table is complete, the sample policies
// say what recommended-policy.json says and are read without a problem, the SBOM is current, the diagram is a static picture, and the
// dependencies are pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizePolicy, policyProblems } from '../src/policy/policy.js';
import { PROVIDERS } from '../src/providers/config.js';

const { testRefs, expandRef, missingRefs, tableAfter, buildMatrix } = require('../scripts/lib/traceability.js');
const { readPolicyFile, parseRegText, parsePlist } = require('../scripts/lib/policy-files.js');
const { buildSbom, bundledKeys } = require('../scripts/lib/sbom.js');
const { hashFolder, compareHashes, toSha256Sum } = require('../scripts/lib/hashes.js');

const ROOT = path.join(__dirname, '..');
const PACK = path.join(ROOT, 'docs', 'review-pack');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const testFiles = fs.readdirSync(path.join(ROOT, 'tests')).map((f) => `tests/${f}`);
const schema = JSON.parse(read('managed_schema.json'));

test('the review pack has what docs/security.md section 7 asked for', () => {
  for (const f of ['README.md', 'data-flow.svg', 'stride.md', 'dpia-template.md', 'traceability.md', 'sbom.cdx.json']) assert.ok(fs.existsSync(path.join(PACK, f)), f);
  for (const f of ['chrome-windows.reg', 'edge-windows.reg', 'chrome-macos.mobileconfig', 'edge-macos.mobileconfig', 'chrome-linux.json', 'edge-linux.json', 'google-admin-console.json', 'recommended-policy.json']) {
    assert.ok(fs.existsSync(path.join(PACK, 'policies', f)), `policies/${f}`);
  }
});

test('every test file named in docs/security.md, docs/deployment.md and the review pack exists', () => {
  const docs = ['docs/security.md', 'docs/deployment.md', ...fs.readdirSync(PACK).filter((f) => f.endsWith('.md')).map((f) => `docs/review-pack/${f}`)];
  const missing = docs.flatMap((doc) => missingRefs(read(doc), testFiles).map((ref) => `${doc}: ${ref}`));
  assert.deepEqual(missing, []);
  assert.ok(testRefs(read('docs/security.md')).length >= 20, 'security.md names its tests');
});

test('globs in the documents stand for real files, and only those', () => {
  assert.ok(expandRef('tests/pii-*.test.js', testFiles).length >= 2);
  assert.deepEqual(expandRef('tests/nothing-*.test.js', testFiles), []);
  assert.deepEqual(expandRef('tests/policy.test.js', testFiles), ['tests/policy.test.js']);
  assert.deepEqual(expandRef('tests/policy.test', testFiles), []);
});

test('the STRIDE table covers all six categories, and every row has a control, a test or a reason, a residual risk and an owner', () => {
  const stride = read('docs/review-pack/stride.md');
  const rows = tableAfter(stride, /STRIDE/);
  assert.ok(rows.length >= 18);
  for (const letter of ['S', 'T', 'R', 'I', 'D', 'E']) assert.ok(rows.some((r) => r.ID.startsWith(letter)), `category ${letter}`);
  assert.equal(new Set(rows.map((r) => r.ID)).size, rows.length, 'ids are unique');
  const owners = ['Maintainer', 'Endpoint admin', 'ServiceNow admin', 'Security team', 'Agent', 'Team lead'];
  for (const r of rows) {
    for (const col of ['Threat', 'Component', 'Control', 'Test', 'Residual risk']) assert.ok(r[col].length > 3, `${r.ID} ${col}`);
    assert.ok(owners.includes(r.Owner), `${r.ID} owner "${r.Owner}" is one of the declared roles`);
    assert.ok(testRefs(r.Test).length || /^none: /.test(r.Test), `${r.ID} names a test or says why there is none`);
  }
});

test('the traceability matrix has a row for every control of security.md section 4 and every STRIDE threat', () => {
  const rows = buildMatrix({ security: read('docs/security.md'), stride: read('docs/review-pack/stride.md') }, testFiles);
  const controls = tableAfter(read('docs/security.md'), /^##\s*4\.\s*Controls/);
  assert.ok(controls.length >= 10);
  assert.equal(rows.filter((r) => r.source === 'security.md 4').length, controls.length);
  assert.deepEqual(rows.filter((r) => r.missing.length).map((r) => `${r.id}: ${r.missing}`), []);
});

test('the data-flow diagram is a static, self-contained picture readable in light and dark', () => {
  const svg = read('docs/review-pack/data-flow.svg');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<title id="title">/);
  assert.match(svg, /<desc id="desc">/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.ok(!/<script|<foreignObject|<image|\son[a-z]+=|href="(?!#)|url\((?!#)|@import/i.test(svg), 'no script, no external resource');
  assert.ok(svg.includes('ServiceNow instance') && svg.includes('AI endpoint') && svg.includes('PII firewall'));
});

const recommended = JSON.parse(read('docs/review-pack/policies/recommended-policy.json'));

test('the recommended policy is locked down and Agent Buddy reads it exactly as written', () => {
  const providers = Object.keys(PROVIDERS);
  assert.deepEqual(policyProblems(recommended, { providers }), []);
  const p = normalizePolicy(recommended);
  assert.equal(p.piiMode, 'strict');
  assert.equal(p.previewMode, 'always');
  assert.equal(p.keyStorage, 'session');
  assert.equal(p.allowHrContent, false);
  assert.ok(p.aiProvider && p.aiBaseUrl && p.aiBaseUrl.startsWith('https://'));
  assert.ok(p.allowedInstances.length && p.allowedInstances.every((o) => /^https:\/\/[a-z0-9.-]+$/.test(o)));
  assert.equal(recommended.providedApiKey, undefined, 'no key in a sample');
  assert.ok(p.disabledFeatures.includes('coaching-snapshot'));
});

test('every sample policy file holds exactly the recommended policy, for the right browser, installed by the same id', () => {
  const providers = Object.keys(PROVIDERS);
  for (const file of fs.readdirSync(path.join(PACK, 'policies'))) {
    if (file === 'recommended-policy.json') continue;
    const found = readPolicyFile(file, read('docs/review-pack/policies', file), schema);
    assert.equal(found.length, 1, file);
    const [{ browser, extensionId, policy, browserPolicy }] = found;
    assert.deepEqual(policy, recommended, file);
    assert.deepEqual(policyProblems(policy, { providers }), [], file);
    assert.equal(browser, file.startsWith('edge') ? 'edge' : 'chrome', file);
    if (file !== 'google-admin-console.json') {
      assert.equal(extensionId, 'EXTENSION_ID', file);
      assert.deepEqual(browserPolicy.ExtensionInstallForcelist, ['EXTENSION_ID;https://extensions.corp.example/agentbuddy/update.xml'], file);
    }
  }
  const reg = read('docs/review-pack/policies/edge-windows.reg');
  assert.ok(reg.includes('\\Policies\\Microsoft\\Edge\\3rdparty\\extensions\\') && !reg.includes('Google'));
  assert.ok(read('docs/review-pack/policies/chrome-macos.mobileconfig').includes('<string>com.google.Chrome.extensions.EXTENSION_ID</string>'));
});

test('the policy file readers refuse what they do not understand', () => {
  assert.throws(() => parseRegText('[HKEY_LOCAL_MACHINE\\x]\n"a"="b"'), /starts with/);
  assert.throws(() => parseRegText('Windows Registry Editor Version 5.00\n[-HKEY_LOCAL_MACHINE\\x]'), /delete keys/);
  assert.throws(() => parseRegText('Windows Registry Editor Version 5.00\n[HKEY_LOCAL_MACHINE\\x]\n"a"=hex:00'), /understood/);
  assert.throws(() => parsePlist('<plist><dict><key>a</key><date>2020</date></dict></plist>'), /not understood/);
  assert.deepEqual(parsePlist('<plist version="1.0"><dict><key>a&amp;b</key><array><string>x</string><true/><integer>5</integer></array></dict></plist>'), { 'a&b': ['x', true, 5] });
  // A REG_DWORD becomes true/false only where the schema says boolean, and lists come from numbered values in order.
  const [got] = readPolicyFile('x.reg', ['Windows Registry Editor Version 5.00', '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\3rdparty\\extensions\\abc\\policy]', '"allowHrContent"=dword:00000001', '"tokenBudgetPerDay"=dword:00000010', '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\3rdparty\\extensions\\abc\\policy\\blockedTables]', '"2"="b"', '"10"="c"', '"1"="a"'].join('\r\n'), schema);
  assert.deepEqual(got.policy, { allowHrContent: true, tokenBudgetPerDay: 16, blockedTables: ['a', 'b', 'c'] });
  assert.equal(readPolicyFile('x.json', JSON.stringify({ a: { Value: 1 } }))[0].policy.a, 1, 'the Admin console format is unwrapped');
});

test('dependencies are pinned to exact versions, the same as the lockfile', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is an exact version`);
    assert.equal(lock.packages[`node_modules/${name}`].version, version, `${name} matches the lockfile`);
  }
  for (const script of ['build:enterprise', 'sbom', 'repro', 'hashes', 'policy:check', 'traceability']) assert.ok(pkg.scripts[script], script);
  assert.equal(pkg.scripts.build, 'node build.js');
});

test('the SBOM is CycloneDX 1.5, lists every locked package, and nothing that is only a build tool is inside the extension', () => {
  const sbom = JSON.parse(read('docs/review-pack/sbom.cdx.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.5');
  assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const paths = sbom.components.map((c) => c.properties.find((p) => p.name === 'cdx:npm:package:path').value);
  assert.deepEqual(paths.sort(), Object.keys(lock.packages).filter(Boolean).sort());
  for (const c of sbom.components) {
    assert.match(c.purl, /^pkg:npm\/(%40[^/]+\/)?[^@/]+@\d+\.\d+\.\d+/);
    assert.ok(c.hashes?.[0]?.alg === 'SHA-512' && /^[0-9a-f]{128}$/.test(c.hashes[0].content), c.purl);
    const bundled = c.properties.find((p) => p.name === 'agentbuddy:bundled').value === 'true';
    if (bundled) assert.equal(c.scope, 'required', `${c.purl} is shipped, so it must be a runtime dependency`);
  }
  assert.ok(sbom.components.some((c) => c.name === 'react' && c.properties.some((p) => p.name === 'agentbuddy:bundled' && p.value === 'true')));
  assert.ok(sbom.dependencies.every((d) => typeof d.ref === 'string' && Array.isArray(d.dependsOn)));
});

test('the committed SBOM is the one scripts/sbom.js makes from the current lockfile', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sbom.js')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, read('docs/review-pack/sbom.cdx.json'), 'out of date: run npm run sbom -- --out docs/review-pack/sbom.cdx.json');
});

test('SBOM helpers: bundled packages come from the paths esbuild read; the same input gives the same SBOM', () => {
  assert.deepEqual(bundledKeys(['src/x.js', 'node_modules/react/index.js', 'node_modules/@scope/pkg/a.js', 'node_modules/a/node_modules/b/c.js']), ['node_modules/@scope/pkg', 'node_modules/a/node_modules/b', 'node_modules/react']);
  const lock = JSON.parse(read('package-lock.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(buildSbom({ lock, pkg, bundled: ['node_modules/react'] }), buildSbom({ lock, pkg, bundled: ['node_modules/react'] }));
  assert.throws(() => buildSbom({ lock: { lockfileVersion: 1 }, pkg }), /lockfileVersion/);
});

test('hash lists: sorted, sha256sum format, and differences named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-hash-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'icons'));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    fs.writeFileSync(path.join(dir, 'icons', 'a.png'), 'a');
    const rows = hashFolder(dir);
    assert.deepEqual(rows.map((r) => r.path), ['b.txt', 'icons/a.png']);
    assert.equal(toSha256Sum(rows).split('\n')[0], '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.txt');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'changed');
    const diff = compareHashes(rows, hashFolder(dir));
    assert.deepEqual([diff.same, diff.differ], [false, ['b.txt']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
