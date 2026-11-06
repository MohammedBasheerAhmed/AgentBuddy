import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const { crc32, zipFolder, listFiles, dosDateTime, zipNameFor } = require('../scripts/package.js');
const { browserManifest, GECKO_ID } = require('../scripts/lib/browsers.js');

// R2: the release zip holds exactly the build's files, each one readable back byte for byte, and the same build gives the same bytes.

function readZip(buffer) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(endAt >= 0, 'end of central directory');
  const entries = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  const files = {};
  for (let i = 0; i < entries; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const crc = buffer.readUInt32LE(at + 16);
    const packedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buffer.subarray(dataAt, dataAt + packedSize));
    assert.equal(crc32(data), crc, `crc of ${name}`);
    files[name] = data;
    at += 46 + nameLength;
  }
  return files;
}

test('the zip holds every file of the build, in a fixed order, readable back exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pkg-'));
  try {
    fs.mkdirSync(path.join(dir, 'icons'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.1.0' }));
    fs.writeFileSync(path.join(dir, 'icons', 'icon-16.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]));
    fs.writeFileSync(path.join(dir, 'sidepanel.bundle.js'), 'console.log("ünïcode");\n'.repeat(200));
    assert.deepEqual(listFiles(dir), ['icons/icon-16.png', 'manifest.json', 'sidepanel.bundle.js']);
    const zip = zipFolder(dir);
    const files = readZip(zip);
    assert.deepEqual(Object.keys(files), ['icons/icon-16.png', 'manifest.json', 'sidepanel.bundle.js']);
    for (const name of Object.keys(files)) assert.ok(files[name].equals(fs.readFileSync(path.join(dir, ...name.split('/')))), name);
    assert.ok(zipFolder(dir).equals(zip), 'the same build gives the same bytes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ZIP helpers: CRC-32 of a known text, and dates in the DOS format (never before 1980)', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.deepEqual(dosDateTime(new Date(Date.UTC(1970, 0, 1))), { time: 0, day: (1 << 5) | 1 });
  assert.deepEqual(dosDateTime(new Date(Date.UTC(2026, 9, 30, 12, 30, 10))), { time: (12 << 11) | (30 << 5) | 5, day: (46 << 9) | (10 << 5) | 30 });
});

test('the package script refuses a build of another version and an enterprise build, and writes the SHA-256 next to the zip', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package.js'), 'utf8');
  assert.match(source, /manifest\.version !== pkg\.version/);
  assert.match(source, /if \(manifest\.host_permissions\) fail/);
  assert.match(source, /`\$\{name\}\.sha256`/);
  assert.match(source, /agentbuddy-\$\{manifest\.version\}\.zip/);
});

// ---- the Firefox release zip ------------------------------------------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const repoManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const runPackage = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'package.js'), ...args], { cwd: ROOT, encoding: 'utf8' });

/** A small build folder as build.js writes it, with this manifest (the real Firefox build is tested in tests/manifest-firefox.test.js). */
function fakeBuild(dir, manifest) {
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'icons', 'icon-16.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'background.bundle.js'), '(() => {})();\n');
  fs.writeFileSync(path.join(dir, 'sidepanel.html'), '<!doctype html>\n');
}

test('zip names: Chrome and Edge keep agentbuddy-<version>.zip, Firefox gets agentbuddy-<version>-firefox.zip next to it', () => {
  assert.equal(zipNameFor({ version: '0.1.0' }, 'chromium'), 'agentbuddy-0.1.0.zip');
  assert.equal(zipNameFor({ version: '0.1.0' }, 'firefox'), 'agentbuddy-0.1.0-firefox.zip');
});

test('the Firefox release zip: its own name, manifest.json at the root of the zip (as addons.mozilla.org requires), the SHA-256 next to it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pkg-firefox-'));
  try {
    const build = path.join(tmp, 'dist-firefox');
    const out = path.join(tmp, 'release');
    const manifest = browserManifest(repoManifest, 'firefox');
    fakeBuild(build, manifest);
    const r = runPackage('--dist', build, '--out', out);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const name = `agentbuddy-${repoManifest.version}-firefox.zip`;
    assert.deepEqual(fs.readdirSync(out).sort(), [name, `${name}.sha256`]);
    const zip = fs.readFileSync(path.join(out, name));
    const files = readZip(zip);
    assert.deepEqual(Object.keys(files), listFiles(build));
    assert.ok(files['manifest.json'], 'manifest.json at the root, not inside a folder');
    assert.ok(Object.keys(files).every((n) => !n.startsWith('/') && !n.includes('\\') && !n.startsWith('dist-firefox/')), 'paths relative to the build');
    const zipped = JSON.parse(files['manifest.json'].toString('utf8'));
    assert.deepEqual(zipped, manifest);
    assert.equal(zipped.browser_specific_settings.gecko.id, GECKO_ID);
    const hash = crypto.createHash('sha256').update(zip).digest('hex');
    assert.equal(fs.readFileSync(path.join(out, `${name}.sha256`), 'utf8'), `${hash}  ${name}\n`);
    assert.ok(zipFolder(build).equals(zip), 'reproducible: the same build gives the same bytes');

    // The Chrome and Edge build next to it keeps its name.
    const chrome = path.join(tmp, 'dist');
    fakeBuild(chrome, repoManifest);
    const r2 = runPackage('--dist', chrome, '--out', out);
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    assert.deepEqual(fs.readdirSync(out).sort(), [`agentbuddy-${repoManifest.version}.zip`, `agentbuddy-${repoManifest.version}.zip.sha256`, name, `${name}.sha256`].sort());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the package script refuses a build for another browser than asked, an enterprise Firefox build and an unknown option', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pkg-firefox-'));
  try {
    const out = path.join(tmp, 'release');
    const firefox = path.join(tmp, 'firefox');
    fakeBuild(firefox, browserManifest(repoManifest, 'firefox'));
    const wrong = runPackage('--dist', firefox, '--browser', 'chromium', '--out', out);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /holds the Firefox build, not the Chrome and Edge one/);
    const enterprise = path.join(tmp, 'enterprise');
    fakeBuild(enterprise, { ...browserManifest(repoManifest, 'firefox'), host_permissions: ['https://acme.service-now.com/*'] });
    const ent = runPackage('--dist', enterprise, '--out', out);
    assert.equal(ent.status, 1);
    assert.match(ent.stderr, /enterprise build/);
    assert.match(runPackage('--browser', 'safari').stderr, /--browser must be one of chromium, firefox/);
    assert.match(runPackage('--fast').stderr, /unknown option "--fast"/);
    assert.match(runPackage('--dist').stderr, /--dist needs a value/);
    assert.ok(!fs.existsSync(out), 'nothing written');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
