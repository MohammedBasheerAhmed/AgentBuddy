const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
import { queryTable, countRecords, instanceFetch, ReadOnlyViolation } from '../src/content/tableApi.js';

const SRC = path.join(__dirname, '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/');
const sourceFiles = walk(SRC).filter((p) => /\.(js|jsx)$/.test(p));

test('the instance client refuses every method except GET', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    await assert.rejects(() => instanceFetch('/api/now/table/incident', { method }), ReadOnlyViolation);
  }
});

test('reads send GET requests only', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return { ok: true, status: 200, headers: { get: () => null }, redirected: false, url: String(url), text: async () => JSON.stringify({ result: { stats: { count: '3' } } }) };
  };
  // A page whose bridge answers at once with a session token.
  const listeners = [];
  globalThis.document = {
    querySelector: () => null,
    scripts: [],
    getElementById: () => null,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result: 'tokentokentokentokentoken' } }));
      return true;
    },
  };
  await countRecords('incident', 'active=true').catch(() => {});
  await queryTable('incident', 'active=true', ['number']).catch(() => {});
  calls.forEach((c) => assert.equal(c.method, 'GET'));
});

test('no code under src/content or src/background can write to the instance', () => {
  const offenders = [];
  sourceFiles
    .filter((p) => /src[\\/](content|background|context)[\\/]/.test(p))
    .forEach((p) => {
      const text = fs.readFileSync(p, 'utf8');
      if (/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(text)) offenders.push(`${rel(p)}: non-GET method`);
      if (/XMLHttpRequest|sendBeacon|navigator\.sendBeacon|WebSocket|EventSource/.test(text)) offenders.push(`${rel(p)}: other network API`);
      if (/\b(createRecord|updateRecord|deleteRecord|runBackgroundScript|impersonat)/i.test(text)) offenders.push(`${rel(p)}: write helper`);
      if (/\/api\/now\/(?!table|stats)/.test(text)) offenders.push(`${rel(p)}: API outside table/stats`);
      if (/sys\.scripts\.do|xmlhttp\.do|\.do\?.*sysparm_processor/.test(text)) offenders.push(`${rel(p)}: script endpoint`);
    });
  assert.deepEqual(offenders, []);
});

test('the page bridge has no save, no REST and no eval', () => {
  const text = fs.readFileSync(path.join(SRC, 'page', 'bridge.js'), 'utf8');
  assert.ok(!/\.save\(|submit\(|g_form\.save|gsftSubmit/.test(text), 'no save');
  assert.ok(!/\bfetch\(|XMLHttpRequest|GlideAjax|sendBeacon/.test(text), 'no network');
  assert.ok(!/\beval\(|new Function|setTimeout\(\s*['"`]|\.innerHTML\s*=/.test(text), 'no code execution');
  assert.ok(!/addEventListener\('message'|postMessage/.test(text), 'no window messaging');
});

test('only the provider layer may use fetch with a body, and only extension pages import it', () => {
  const fetchers = sourceFiles.filter((p) => /\bfetch\(/.test(fs.readFileSync(p, 'utf8'))).map(rel).sort();
  const allowed = ['src/content/tableApi.js', 'src/providers/anthropic.js', 'src/providers/openai.js'];
  fetchers.forEach((f) => assert.ok(allowed.includes(f), `${f} calls fetch() but is not on the approved list`));
  // Content scripts must never import the provider layer (that is where the AI key is used).
  sourceFiles
    .filter((p) => /src[\\/]content[\\/]/.test(p))
    .forEach((p) => assert.ok(!/providers\/|keyStore|pii\//.test(fs.readFileSync(p, 'utf8')), `${rel(p)} imports AI-side code`));
});

test('no innerHTML, dangerouslySetInnerHTML, eval or remote script anywhere in src', () => {
  const offenders = [];
  sourceFiles.forEach((p) => {
    const text = fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text)) offenders.push(`${rel(p)}: html injection`);
    if (/\beval\(|new Function\(/.test(text)) offenders.push(`${rel(p)}: eval`);
    if (/createElement\(['"]script['"]\)/.test(text)) offenders.push(`${rel(p)}: script element`);
  });
  assert.deepEqual(offenders, []);
});
