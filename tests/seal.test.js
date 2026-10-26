import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { seal, isSealed, assertSealed } from '../src/pii/seal.js';
import * as piiApi from '../src/pii/index.js';
import { createFirewall } from '../src/pii/firewall.js';

const message = { role: 'user', content: 'hello' };
const draft = () => ({ messages: [{ role: 'system', content: 's' }, { ...message }], preview: 'p', stats: { total: 0, counts: {} }, feature: 'f', table: 't', mode: 'standard' });

// ---- the registry -------------------------------------------------------------------------------------------------

test('seal() returns a frozen object that isSealed() and assertSealed() accept', () => {
  const sealed = seal(draft());
  assert.ok(isSealed(sealed));
  assert.equal(assertSealed(sealed), sealed);
  assert.ok(Object.isFrozen(sealed));
  assert.ok(Object.isFrozen(sealed.messages));
  for (const m of sealed.messages) assert.ok(Object.isFrozen(m));
});

test('seal() copies: changing the draft afterwards does not change the sealed request', () => {
  const d = draft();
  const sealed = seal(d);
  d.messages[1].content = 'changed';
  d.messages.push({ role: 'user', content: 'extra' });
  d.preview = 'changed';
  assert.equal(sealed.messages.length, 2);
  assert.equal(sealed.messages[1].content, 'hello');
  assert.equal(sealed.preview, 'p');
  assert.ok(!isSealed(d), 'the draft itself is not sealed');
});

test('a forged object is rejected, however closely it copies a real one', () => {
  const real = seal(draft());
  const forgeries = [
    { ...real },
    Object.assign({}, real),
    JSON.parse(JSON.stringify(real)),
    structuredClone(real),
    Object.create(real),
    new Proxy(real, {}),
    Object.freeze({ ...real, messages: Object.freeze([...real.messages]) }),
    { ...draft(), sealed: true, __sealed: true, isSealed: true },
    draft(),
    { messages: [message] },
    {},
    [],
    'sealed',
    42,
    null,
    undefined,
    () => real,
  ];
  for (const forged of forgeries) {
    assert.equal(isSealed(forged), false);
    assert.throws(() => assertSealed(forged), /did not go through the PII firewall/);
  }
});

test('seal() refuses things that are not requests', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { messages: [] }, { messages: 'no' }, { messages: {} }]) assert.throws(() => seal(bad), TypeError);
});

test('what the firewall returns is sealed; what a caller assembles is not', () => {
  const fw = createFirewall({ people: [] });
  const built = fw.buildRequest({ feature: 'f', table: 'incident', parts: [{ label: 'a', field: 'a', text: 'hi' }] });
  assert.ok(isSealed(built));
  assert.ok(!isSealed({ ...built }));
  assert.ok(!isSealed({ messages: built.messages.map((m) => ({ ...m })) }));
});

test('the public API exports no way to mint a sealed request', () => {
  assert.deepEqual(Object.keys(piiApi).sort(), ['FirewallError', 'KINDS', 'assertSealed', 'createFirewall', 'detect', 'isSealed']);
  assert.equal('seal' in piiApi, false);
  assert.equal(piiApi.assertSealed, assertSealed);
  assert.equal(piiApi.isSealed, isSealed);
});

// ---- only src/pii/** may import seal() ------------------------------------------------------------------------------

const ROOT = [typeof __dirname === 'undefined' ? '' : path.resolve(__dirname, '..'), process.cwd()].find((dir) => dir && fs.existsSync(path.join(dir, 'src')));
const SRC = path.join(ROOT, 'src');
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (SOURCE_FILE.test(entry.name)) files.push(full);
  }
  return files;
}

// Comments cannot import anything; strip them so a sentence like "seal() is imported by firewall.js" is not a hit.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const isSealModule = (specifier) => /(?:^|\/)seal(?:\.[cm]?[jt]sx?)?$/.test(specifier);

/**
 * The ways a source file can reach seal.js. Returns what it takes from it: the imported names, or '*' for a namespace,
 * default, dynamic or require() use (which could reach seal() without naming it).
 */
export function sealImports(rawSource) {
  const source = stripComments(rawSource);
  const found = [];
  for (const m of source.matchAll(/\b(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!isSealModule(m[2])) continue;
    const clause = m[1].trim();
    const named = /^(?:[\w$]+\s*,\s*)?\{([^}]*)\}$/.exec(clause);
    if (!named || /^[\w$]+\s*,/.test(clause)) found.push('*');
    else for (const item of named[1].split(',').map((s) => s.trim()).filter(Boolean)) found.push(item.split(/\s+as\s+/)[0].trim());
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) if (isSealModule(m[1] || m[2])) found.push('*');
  for (const m of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) if (isSealModule(m[1])) found.push('*');
  return found;
}

test('the scanner itself understands the ways of importing seal', () => {
  assert.deepEqual(sealImports("import { seal } from './seal.js';"), ['seal']);
  assert.deepEqual(sealImports("import { seal as s, isSealed } from '../pii/seal.js'"), ['seal', 'isSealed']);
  assert.deepEqual(sealImports("import {\n  assertSealed,\n  seal,\n} from '../pii/seal'"), ['assertSealed', 'seal']);
  assert.deepEqual(sealImports("import * as s from '../pii/seal.js'"), ['*']);
  assert.deepEqual(sealImports("import seal from '../pii/seal.js'"), ['*']);
  assert.deepEqual(sealImports("import seal, { isSealed } from '../pii/seal.js'"), ['*']);
  assert.deepEqual(sealImports("export { seal } from '../pii/seal.js'"), ['seal']);
  assert.deepEqual(sealImports("export * from '../pii/seal.js'"), ['*']);
  assert.deepEqual(sealImports("const m = await import('../pii/seal.js')"), ['*']);
  assert.deepEqual(sealImports("const m = require('../pii/seal.js')"), ['*']);
  assert.deepEqual(sealImports("import '../pii/seal.js'"), ['*']);
  assert.deepEqual(sealImports("import { assertSealed } from '../pii/seal.js'"), ['assertSealed']);
  assert.deepEqual(sealImports("import { seal } from './unseal.js'; import { seal } from './other.js'"), []);
  assert.deepEqual(sealImports("// import { seal } from '../pii/seal.js'\n/* import { seal } from '../pii/seal.js' */ const a = 1;"), []);
  assert.deepEqual(sealImports("const url = 'https://example.com/seal'; // seal(x)"), []);
});

test('seal() is imported only by files under src/pii/', () => {
  const files = walk(SRC);
  assert.ok(files.length > 5, 'the scan found the source tree');
  const importers = [];
  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === 'src/pii/seal.js') continue;
    const taken = sealImports(fs.readFileSync(file, 'utf8'));
    if (!taken.length) continue;
    importers.push(rel);
    if (rel.startsWith('src/pii/')) continue;
    // Outside src/pii/ the only things allowed are the two read-only checks.
    const extra = taken.filter((name) => name !== 'assertSealed' && name !== 'isSealed');
    if (extra.length) violations.push(`${rel} takes ${extra.join(', ')} from seal.js`);
  }
  assert.deepEqual(violations, [], 'only src/pii/** may import seal(); everything else gets assertSealed/isSealed');
  assert.ok(importers.includes('src/pii/firewall.js'), 'the scan does see the real import in the firewall');
});

test('the firewall is the only module that mints sealed requests inside src/pii', () => {
  const pii = walk(path.join(SRC, 'pii')).filter((f) => !f.endsWith('seal.js'));
  const minting = pii.filter((f) => sealImports(fs.readFileSync(f, 'utf8')).includes('seal')).map((f) => path.basename(f));
  assert.deepEqual(minting, ['firewall.js']);
  const index = fs.readFileSync(path.join(SRC, 'pii', 'index.js'), 'utf8');
  assert.deepEqual(sealImports(index).filter((n) => n !== 'assertSealed' && n !== 'isSealed'), [], 'index.js re-exports only the read-only checks');
});
