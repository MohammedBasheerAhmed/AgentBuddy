// src/context is pure and dependency-injected: no chrome.*, no fetch, no DOM; only live.js may touch the real client,
// and nothing here may write to the instance.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as context from '../src/context/index.js';

const dir = path.join(__dirname, '..', 'src', 'context');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const code = (file) =>
  fs
    .readFileSync(path.join(dir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the engine is made of the files we expect', () => {
  for (const name of ['kinds', 'allowlists', 'journal', 'pack', 'history', 'similar', 'live']) assert.ok(files.includes(`${name}.js`), name);
});

test('no browser APIs outside live.js', () => {
  const banned = [/\bchrome\./, /\bfetch\s*\(/, /\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\bsessionStorage\b/, /\bXMLHttpRequest\b/, /\bnavigator\./, /\blocation\./, /\bpostMessage\b/];
  for (const file of files.filter((f) => f !== 'live.js')) {
    const text = code(file);
    for (const re of banned) assert.ok(!re.test(text), `${file} uses ${re}`);
  }
});

test('only live.js imports the real client; the rest take deps as arguments', () => {
  for (const file of files) {
    const imports = [...code(file).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (file === 'live.js') {
      assert.deepEqual(imports, ['../content/tableApi.js']);
      continue;
    }
    for (const spec of imports) {
      // (../domain/states.js is the one reader of what a state means; it is pure and has no imports of its own: checked right below)
      assert.ok(spec.startsWith('./') || spec === '../lib/similar.js' || spec === '../lib/recordNumber.js' || spec === '../domain/states.js', `${file} imports ${spec}`);
    }
  }
});

test('the state reader the engine may import is pure: it imports nothing', () => {
  const states = fs.readFileSync(path.join(dir, '..', 'domain', 'states.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(states), 'src/domain/states.js imports something');
  assert.ok(!/\bchrome\.|\bfetch\(|XMLHttpRequest/.test(states), 'src/domain/states.js reaches for the browser or the network');
});

test('nothing writes to the instance', () => {
  for (const file of files) {
    const text = code(file);
    assert.ok(!/['"`](?:POST|PUT|PATCH|DELETE)['"`]/.test(text), `${file} names a write method`);
    assert.ok(!/\.(?:insert|update|deleteRecord|setValue)\s*\(/.test(text), `${file} calls a write helper`);
  }
});

test('the barrel exposes the engine and not the live wiring', () => {
  for (const name of ['readContextPack', 'readCallerHistory', 'findSimilarTickets', 'findOpenDuplicates', 'searchKnowledge', 'parseRecordRef', 'parseJournalString', 'stripHtml', 'FIELDS_BY_KIND', 'FEATURE_FIELDS', 'LIMITS', 'isSensitiveTable', 'kindForTable']) {
    assert.equal(typeof context[name] === 'undefined', false, name);
  }
  assert.equal('liveDeps' in context, false);
  assert.equal('createLiveDeps' in context, false);
});

test('the live deps expose the four client functions and nothing that writes', () => {
  const source = fs.readFileSync(path.join(dir, 'live.js'), 'utf8');
  assert.match(source, /export const liveDeps = Object\.freeze\(\{ queryTable, fetchRecord, countRecords, countByColumn \}\)/);
  assert.match(source, /export function createLiveDeps/);
});
