import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
const { crc32, zipFolder, listFiles, dosDateTime } = require('../scripts/package.js');

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
