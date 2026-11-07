import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// No person-facing text may print a table name (audit of 2026-11-07, root cause 2). In the files of the "labels" workstream a text that
// names a table does it through src/lib/tableLabels.js (tableLabel, tableWords, sourceWords). This reads the source, as
// tests/context-purity.test.js does, and fails when a sentence is built from a bare table or source name.

const SRC = path.join(__dirname, '..', 'src');
const rel = (file) => path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The files that say tables to a person, and are in this workstream (the others are the context engine, the ticket screen and the
// record gate, which have their own workstreams and tests).
const SKIP = new Set(['src/compose/emailRecommend.js', 'src/sidepanel/reports/drill.js', 'src/sidepanel/knowledge/DuplicatesPanel.jsx']);
const FOLDERS = ['reports', 'sidepanel/reports', 'sidepanel/team', 'sidepanel/write', 'sidepanel/knowledge', 'itsm', 'compose'];
const FILES = ['features/parts.js', 'lib/fillable.js', 'lib/tableLabels.js', 'sidepanel/insertFlow.js'];
const owned = [...FOLDERS.flatMap((f) => walk(path.join(SRC, f))), ...FILES.map((f) => path.join(SRC, f))].filter((f) => !SKIP.has(rel(f)));

// Comments are not code (a "//" after a colon is an address, so it stays).
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// A name of a table or a source in an expression: table, record.table, tableInfo.table, source, a.source ...
const NAME = String.raw`(?:[A-Za-z_$][\w$]*\.)*(?:table|source)`;

/** Template strings that read like a sentence (they have words next to the value) and print a table or source name. */
function sentencesWithBareNames(text) {
  const found = [];
  for (const m of code(text).matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1];
    const slots = [...body.matchAll(/\$\{([^{}]*)\}/g)];
    if (!slots.some((s) => new RegExp(`^\\s*${NAME}\\s*$`).test(s[1]))) continue;
    // Keys, queries and addresses have no words around the value; a sentence has two words of three letters or more apart from them.
    const spoken = /[A-Za-z]{3,} [A-Za-z]{2,}/.test(body.replace(/\$\{[^{}]*\}/g, 'x'));
    if (spoken && !/[|=^]/.test(body)) found.push(body.slice(0, 80));
  }
  return found;
}

/** t(), say() and tx() calls that fill a {slot} with a bare table or source name instead of its words. */
function slotsWithBareNames(text) {
  const found = [];
  const body = code(text);
  for (const m of body.matchAll(/(?<![\w.$])(?:t|tr|say|tx)\(\s*(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")\s*,\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    for (const part of m[1].split(/,(?![^()]*\))/)) {
      const piece = part.trim();
      const shorthand = /^(table|source)$/.test(piece);
      const value = /^[A-Za-z]+\s*:\s*(.+)$/.exec(piece)?.[1]?.trim() || '';
      if (shorthand || new RegExp(`^${NAME}$`).test(value)) found.push(`${m[0].slice(0, 60)} ... ${piece}`);
    }
  }
  return found;
}

test('the files of this workstream are found (the scan reads what it should)', () => {
  assert.ok(owned.length > 60, `${owned.length} files`);
  for (const must of ['src/features/parts.js', 'src/lib/fillable.js', 'src/compose/ticketLabel.js', 'src/reports/engine/reader.js', 'src/sidepanel/reports/OverviewView.jsx', 'src/sidepanel/insertFlow.js', 'src/itsm/reference.js']) {
    assert.ok(owned.map(rel).includes(must), must);
  }
});

test('the scan itself catches a sentence built from a table name, and leaves keys and queries alone', () => {
  assert.equal(sentencesWithBareNames('const a = `Your user cannot read ${table}.`;').length, 1);
  assert.equal(sentencesWithBareNames('const a = `For ${record.table} records only`;').length, 1);
  assert.equal(sentencesWithBareNames('const a = `Made without ${a.source} here`;').length, 1);
  assert.equal(sentencesWithBareNames('const key = `${record.table}:${record.sysId}`;').length, 0);
  assert.equal(sentencesWithBareNames('const key = `count|${table}|${query}`;').length, 0);
  assert.equal(sentencesWithBareNames('const q = `task.sys_class_nameIN${table}`;').length, 0);
  assert.equal(sentencesWithBareNames('// `Your user cannot read ${table}.` in a comment').length, 0);
  assert.equal(slotsWithBareNames("t('For a new {table} form', { table: want.table })").length, 1);
  assert.equal(slotsWithBareNames("t('For a new {table} form', { table })").length, 1);
  assert.equal(slotsWithBareNames("say(tm('{table} is gone'), { table: row.source })").length, 0, 'tm() alone is only a mark');
  assert.equal(slotsWithBareNames("t('{table} per day', { table: tableName })").length, 0);
  assert.equal(slotsWithBareNames("t('For a new {table} form', { table: tableLabel(want.table) })").length, 0);
  assert.equal(slotsWithBareNames("t('{n} things', { n: items.length, table: tableWords(table) })").length, 0);
});

test('no sentence in this workstream is built from a bare table or source name', () => {
  const bad = owned.flatMap((file) => sentencesWithBareNames(fs.readFileSync(file, 'utf8')).map((s) => `${rel(file)}: ${s}`));
  assert.deepEqual(bad, []);
});

test('no text is filled with a bare table or source name: the slot gets the words (tableLabel, tableWords, sourceWords)', () => {
  const bad = owned.flatMap((file) => slotsWithBareNames(fs.readFileSync(file, 'utf8')).map((s) => `${rel(file)}: ${s}`));
  assert.deepEqual(bad, []);
});

test('no text a person reads carries a name with an underscore (a table, a column, an id): t(), tm(), tx(), say()', () => {
  const calls = /(?<![\w.$])(?:t|tm|tx|say|tr)\(\s*(?:[^,()]+,\s*)?(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g;
  const bad = [];
  for (const file of owned) {
    for (const m of code(fs.readFileSync(file, 'utf8')).matchAll(calls)) {
      const text = m[1] ?? m[2];
      if (/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(text.replace(/\{[A-Za-z_]+\}/g, ''))) bad.push(`${rel(file)}: ${text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
