import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildCrx, extensionId, parseCrx, publicKeyDer, updateManifest } from '../scripts/selfhost.js';

// The self-hosted install (scripts/selfhost.js): a signed CRX3 package, the id the browser derives from the key, the update manifest.
// The format was also checked against a package Chrome itself made from the same key and folder (same header length, same id).

const keyPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const zip = Buffer.from('PK\u0003\u0004 not a real zip, the signature does not care what the bytes are');

test('the extension id is 32 letters a to p, the same for the same key, different for another key', () => {
  const id = extensionId(publicKeyDer(keyPem));
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(extensionId(publicKeyDer(keyPem)), id);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.notEqual(extensionId(publicKeyDer(other)), id);
});

test('the id follows the rule the browsers use: first 16 bytes of the SHA-256 of the public key, each hex digit as a letter from a', () => {
  const der = publicKeyDer(keyPem);
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  assert.equal(extensionId(der), [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''));
});

test('a package starts with Cr24 and version 3, carries the zip unchanged, and verifies', () => {
  const crx = buildCrx(zip, keyPem);
  assert.equal(crx.subarray(0, 4).toString('latin1'), 'Cr24');
  assert.equal(crx.readUInt32LE(4), 3);
  const parsed = parseCrx(crx);
  assert.equal(parsed.signatureOk, true);
  assert.equal(parsed.id, extensionId(publicKeyDer(keyPem)));
  assert.ok(parsed.zip.equals(zip), 'the zip is the last part of the file, as it was given');
});

test('a changed byte in the zip, or in the header, or a package that is not a CRX, does not verify', () => {
  const crx = Buffer.from(buildCrx(zip, keyPem));
  const zipTampered = Buffer.from(crx);
  zipTampered[zipTampered.length - 3] ^= 0xff;
  assert.equal(parseCrx(zipTampered).signatureOk, false, 'changed zip');

  const headerLength = crx.readUInt32LE(8);
  const headerTampered = Buffer.from(crx);
  headerTampered[12 + headerLength - 2] ^= 0xff; // inside the signed id
  assert.equal(parseCrx(headerTampered).signatureOk, false, 'changed signed header');

  assert.throws(() => parseCrx(Buffer.from('not a package at all')), /Cr24/);
  const v2 = Buffer.from(crx);
  v2.writeUInt32LE(2, 4);
  assert.throws(() => parseCrx(v2), /version 2/);
});

test('the update manifest names the extension, the version, the package address and its hash, and escapes what it writes', () => {
  const xml = updateManifest({ id: 'a'.repeat(32), version: '1.2.3', crxUrl: 'https://x.example/a&b/agentbuddy-1.2.3.crx', sha256: 'f'.repeat(64) });
  assert.match(xml, /<gupdate xmlns='http:\/\/www\.google\.com\/update2\/response' protocol='2\.0'>/);
  assert.match(xml, new RegExp(`<app appid='${'a'.repeat(32)}'>`));
  assert.match(xml, /codebase='https:\/\/x\.example\/a&amp;b\/agentbuddy-1\.2\.3\.crx'/);
  assert.match(xml, /version='1\.2\.3'/);
  assert.match(xml, new RegExp(`hash_sha256='${'f'.repeat(64)}'`));
});
