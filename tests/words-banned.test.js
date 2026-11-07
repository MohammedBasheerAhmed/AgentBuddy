import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collect, loadCatalogueFiles } from '../scripts/lib/i18nCheck.js';
import { AR_WORDS_RETIRED } from '../src/i18n/ar/words.js';
import { BANNED, BANNED_OWN, ADMIN_ONLY, ALLOWED, ROOT, hitsOf, stripSlots, allowedIn, isOwned, relative, sentencesIn, walkSource, inScan } from './words-list.js';

// docs/plain-words.md as a test (audit 8 of 2026-11-07): the panel never says instance, API key, endpoint, provider, token, your user,
// an access rule, a database word, an HTTP code, "record" for a ticket, "session", "log in" or "IT team". Two scans:
//   1. every English text of the catalogue (src/i18n/ar: the English text is the key, so this is every text a person can read), and
//   2. every sentence-like string in the files of the words workstream, so a text that is not passed through t() is covered too.
// Settings > AI is the one place with an explicit allow-list (tests/words-list.js ALLOWED), each entry with its reason.

const retired = new Set(AR_WORDS_RETIRED);

test('no text of the catalogue says a word the panel never says (Settings > AI aside)', () => {
  const files = walkSource();
  const { keys } = collect(files.filter((f) => inScan(f)));
  const used = new Map([...keys].map(([key, where]) => [key, [...new Set(where.map((w) => w.file))]]));
  const all = new Set();
  for (const { table } of loadCatalogueFiles('ar')) for (const key of Object.keys(table)) if (!retired.has(key)) all.add(key);
  const bad = [];
  for (const key of all) {
    if (!used.has(key)) continue; // an entry no text uses is tests/i18n.test.js's to report
    for (const part of key.split('|')) {
      const ids = hitsOf(part).filter((id) => {
        const where = used.get(key) || [];
        return !(where.length && where.every((file) => allowedIn(file, id)));
      });
      if (ids.length) bad.push(`[${ids.join(', ')}] ${part.slice(0, 150)}  (${(used.get(key) || ['not used']).join(', ')})`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length} texts say a word from docs/plain-words.md:\n${bad.slice(0, 40).join('\n')}`);
});

test('no sentence in the files of the words workstream says one either, passed through t() or not', () => {
  const bad = [];
  for (const full of walkSource()) {
    const file = relative(full);
    if (!isOwned(file) || ADMIN_ONLY.some((re) => re.test(file))) continue;
    const code = fs.readFileSync(full, 'utf8');
    // The policy check (scripts/check-policy.js) prints for an administrator; it lives in policy.js next to the code it checks.
    let skipFrom = Infinity;
    let skipTo = -1;
    if (file === 'src/policy/policy.js') {
      const start = code.indexOf('export function policyProblems(');
      const end = code.indexOf('\n}\n', start);
      skipFrom = code.slice(0, start).split('\n').length;
      skipTo = code.slice(0, end).split('\n').length;
    }
    for (const { line, text } of sentencesIn(code)) {
      if (line >= skipFrom && line <= skipTo) continue;
      const ids = [...hitsOf(text), ...hitsOf(text, BANNED_OWN)].filter((id) => !allowedIn(file, id));
      if (ids.length) bad.push(`${file}:${line} [${ids.join(', ')}] ${text.slice(0, 130)}`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length} sentences say a word from docs/plain-words.md:\n${bad.slice(0, 40).join('\n')}`);
});

test('the allow-list is honest: every exception still has a text that needs it', () => {
  const files = walkSource();
  const { keys } = collect(files.filter((f) => inScan(f)));
  const texts = []; // [file, text] for every sentence and every catalogue text
  for (const full of files) for (const { text } of sentencesIn(fs.readFileSync(full, 'utf8'))) texts.push([relative(full), text]);
  for (const [key, where] of keys) for (const w of where) texts.push([w.file, key]);
  const stale = [];
  for (const entry of ALLOWED) {
    for (const id of entry.ids) {
      const word = BANNED.find((x) => x.id === id);
      if (!texts.some(([file, text]) => entry.files.test(file) && word.re.test(stripSlots(text)))) stale.push(`${entry.files} no longer needs "${id}" (${entry.why})`);
    }
  }
  assert.equal(stale.length, 0, `take these off the allow-list in tests/words-list.js: ${stale.join('; ')}`);
});

test('docs/plain-words.md exists, is short, and names the words the test bans', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'plain-words.md'), 'utf8');
  assert.ok(doc.split('\n').length <= 40, 'a reference page of at most 40 lines, not an essay');
  for (const word of ['ServiceNow site', 'AI key', 'AI service', 'your administrator', 'your ServiceNow admin', 'ticket']) assert.ok(doc.includes(word), word);
  for (const word of ['instance', 'endpoint', 'provider', 'token', 'record', 'HTTP codes']) assert.ok(doc.includes(word), word);
});
