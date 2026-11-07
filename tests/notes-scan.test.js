import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collect, loadCatalogue, walk } from '../scripts/lib/i18nCheck.js';
import { AR_NOTES } from '../src/i18n/ar/notes.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';
import { NOTE_TEXT, READ_TEXT } from '../src/context/access.js';

// Audit of 2026-11-07, workstream "notes and errors": scans of the source that keep the root cause from coming back. The engine writes
// fixed sentences; none of them may carry the name of a table, a column or an HTTP code, and every one has its Arabic.

const ROOT = path.join(__dirname, '..');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const listJs = (dir, { deep = true, skip = [] } = {}) =>
  fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => {
      if (skip.includes(e.name)) return [];
      if (e.isDirectory()) return deep ? listJs(`${dir}/${e.name}`, { deep, skip }) : [];
      return /\.(js|jsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [];
    });

// The files of this workstream (the engine's notes and the panel files that word them).
const ENGINE = [...listJs('src/context', { skip: ['specs'] }), ...listJs('src/content/ops'), 'src/content/tableApi.js'];
const E_FILES = new Set(['KnowledgeCard.jsx', 'StepsCard.jsx', 'EmailCard.jsx', 'bits.jsx', 'AnswerCard.jsx', 'TicketView.jsx', 'useNeeds.js']);
const PANEL = [
  'src/sidepanel/plainAccess.js',
  'src/sidepanel/ask.js',
  'src/sidepanel/ErrorNote.jsx',
  ...listJs('src/insights'),
  ...listJs('src/sidepanel/ticket/cards').filter((f) => !E_FILES.has(path.basename(f))),
  ...listJs('src/sidepanel/ticket/assist').filter((f) => !E_FILES.has(path.basename(f))),
];

// ---- no sentence of the engine interpolates a table or a column --------------------------------------------------------------------

// Template strings that carry the technical words on purpose: they are the `detail` of an error (never drawn) or an internal key.
const TECHNICAL = [
  '${what} was not found in ${table}', // context/pack.js: error.detail
  '${what} was not data', // content/tableApi.js: error.detail
  'Table API query on "${table}"', // content/tableApi.js: the `what` label of a read, kept in error.detail
  'Count on "${table}"',
  'Breakdown of "${table}" by ${column}',
  'Report on "${table}"',
  'Unknown feature "${feature}". Known: ${FEATURES.join(', ')}.', // a developer error: the feature ids are the code's
  'extendFields names an unknown kind: ${kind}',
  'Agent Buddy only reads from ServiceNow. ${method} requests are not allowed.', // the guard against a write method
  'That is not a valid ${what}.', // content/ops/knowledge.js: a refused argument
];

test('no sentence the engine writes interpolates a table, a column, a source or a link (the sentences are fixed)', () => {
  const risky = /table|source|column|field|link|holder|plan\b|spec\./i;
  const found = [];
  for (const file of ENGINE) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/`((?:\\.|[^`\\])*)`/g)) {
        const body = m[1];
        const slots = [...body.matchAll(/\$\{([^}]*)\}/g)].map((s) => s[1]);
        if (!slots.some((s) => risky.test(s))) continue;
        // a sentence: three words with letters around the slots (a query, a key or a path has none)
        if (!/[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}/.test(body.replace(/\$\{[^}]*\}/g, ' '))) continue;
        if (TECHNICAL.some((t) => body.includes(t))) continue;
        found.push(`${file}:${i + 1}: ${body.slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test('no sentence of the engine says "your user", names an HTTP code or says "Table API" outside the technical detail', () => {
  const found = [];
  for (const file of [...ENGINE, ...PANEL]) {
    if (file === 'src/sidepanel/plainAccess.js' || file === 'src/sidepanel/ask.js') continue; // they recognise those words in older sentences
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const body = m[2];
        if (/your user/i.test(body) || (/\(\d{3}\)/.test(body) && /[A-Za-z]{4,} [a-z]{2,}/.test(body) && !/sysparm|\/api\//.test(body))) found.push(`${file}:${i + 1}: ${body.slice(0, 100)}`);
        if (/Table API/.test(body) && !TECHNICAL.some((t) => body.includes(t.split('${')[0]))) found.push(`${file}:${i + 1}: ${body.slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

// ---- J16: one sentence for a lost sign-in ----------------------------------------------------------------------------------------------

// Files that still say it their own way and are not part of this workstream: the lead replaces each with `t(READ_TEXT.session)` (from
// src/context/access.js) and then removes the file from this list; the test keeps every other file honest meanwhile.
const PENDING = [];

test('J16: only one sentence says the person is signed out, and it says "Sign in" and "signed out"', () => {
  assert.equal(READ_TEXT.session, 'You are signed out of ServiceNow. Sign in again, then try again.');
  const old = /session (?:has )?(?:expired|ended)|\blog ?in again\b|\bLog in\b|\bLog in to\b/;
  const found = [];
  for (const file of listJs('src')) {
    if (file.startsWith('src/i18n/') || PENDING.includes(file)) continue;
    stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (old.test(m[2])) found.push(`${file}:${i + 1}: ${m[2].slice(0, 100)}`);
      });
  }
  assert.deepEqual(found, [], 'a sentence that says "session expired" or "log in again" is another way to say READ_TEXT.session');
  // the pending files still exist (a renamed file would hide a producer)
  for (const file of PENDING) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is gone: remove it from PENDING`);
});

test('J16: every producer of a lost sign-in uses READ_TEXT.session: the read layer, the readers and the panel', async () => {
  const { readJson } = await import('../src/content/tableApi.js');
  const { classifyReadError, readFailureText } = await import('../src/context/access.js');
  const lost = { ok: false, status: 401, redirected: false, url: '', headers: { get: () => null }, text: async () => '' };
  const err = await readJson(lost, 'x').catch((e) => e);
  assert.equal(err.message, READ_TEXT.session);
  assert.equal(err.code, 'SESSION_EXPIRED');
  assert.equal(readFailureText({ code: 'SESSION_EXPIRED' }), READ_TEXT.session);
  assert.equal(classifyReadError(Object.assign(new Error('x'), { code: 'SESSION_EXPIRED' })).status, 'error', 'a lost session is thrown by softRead; classified alone it is an error');
});

// ---- Arabic -------------------------------------------------------------------------------------------------------------------------

test('every text of this workstream has its Arabic, with the same {names}, and the Arabic file keeps nothing else', () => {
  const catalogue = { ...loadCatalogue('ar'), ...AR_NOTES, ...AR_LABELS };
  const own = [...ENGINE, ...PANEL].map((f) => path.join(ROOT, f));
  const { keys, dynamic } = collect(own);
  assert.deepEqual(dynamic.map((d) => `${d.file}:${d.line}`), [], 'every text is written out where it is marked');
  const names = (text) => [...String(text).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(',');
  const missing = [];
  for (const key of keys.keys()) {
    if (key.includes('|')) continue; // (plural texts are checked by tests/i18n.test.js)
    const arabic = catalogue[key];
    if (typeof arabic !== 'string' || !arabic) missing.push(`no Arabic: ${key}`);
    else if (names(arabic) !== names(key)) missing.push(`other {names}: ${key}`);
  }
  assert.deepEqual(missing, []);
  // nothing in notes.js is left over: each entry is a text some file marks or shows
  const all = collect(walk(path.join(ROOT, 'src')).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`))).keys;
  const leftover = Object.keys(AR_NOTES).filter((key) => !all.has(key));
  assert.deepEqual(leftover, []);
  for (const [key, text] of Object.entries(AR_NOTES)) {
    assert.ok(/[؀-ۿ]/.test(text), key);
    assert.equal(names(text), names(key), key);
  }
  assert.ok(Object.values(NOTE_TEXT).every((text) => AR_NOTES[text]), 'every standard note has its Arabic');
});
