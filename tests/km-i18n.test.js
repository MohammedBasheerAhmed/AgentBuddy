import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { collect, loadCatalogue, loadCatalogueFiles, walk } from '../scripts/lib/i18nCheck.js';
import { AR_KM, AR_KM_RETIRED, withKm } from '../src/i18n/ar/km.js';

// Wave 6, knowledge manager: the Arabic of the coverage lines lives in ONE file (src/i18n/ar/km.js) which the lead wires into
// src/i18n/ar/index.js (withKm, applied last). These checks are about my own texts only, so they hold before and after it is wired
// and do not depend on what the other builders of the wave still have to add.

const ROOT = path.join(__dirname, '..');
const MINE = ['src/context/knowledge.js', 'src/content/ops/knowledge.js', 'src/knowledge/', 'src/sidepanel/knowledge/', 'src/sidepanel/knowledgeScreen/'].map((p) => path.join(ROOT, p));
const isMine = (file) => MINE.some((p) => file === p || file.startsWith(p));
const names = (text) => [...String(text).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(',');
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

const srcFiles = () => walk(path.join(ROOT, 'src')).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));

test('every text my files show has an Arabic entry (here or already in the catalogue), with its {names}, and plural texts have six forms', () => {
  const table = { ...loadCatalogue('ar'), ...AR_KM };
  for (const key of AR_KM_RETIRED) delete table[key];
  const { keys, dynamic } = collect(srcFiles().filter(isMine));
  assert.deepEqual(dynamic.map((d) => `${d.file}:${d.line}`), [], 'every text is written out where it is passed');
  const bad = [];
  for (const [key, where] of keys) {
    const entry = table[key];
    if (!entry) {
      bad.push(`no Arabic: ${key} (${where[0].file}:${where[0].line})`);
    } else if (where[0].plural) {
      const other = key.split('|')[1];
      if (typeof entry !== 'object') bad.push(`not a plural entry: ${key}`);
      else {
        for (const form of FORMS) if (!entry[form]) bad.push(`missing form ${form}: ${key}`);
        for (const [form, text] of Object.entries(entry)) {
          const extra = names(text).split(',').filter((n) => n && !names(other).split(',').includes(n));
          if (extra.length) bad.push(`${key} [${form}] uses ${extra.join(',')}`);
        }
      }
    } else if (typeof entry !== 'string' || names(entry) !== names(key)) bad.push(`other {names}: ${key}`);
  }
  assert.deepEqual(bad, []);
});

test('km.js: every entry is used by some text, is Arabic, keeps its {names}; the retired texts are used by nobody', () => {
  const all = collect(srcFiles()).keys;
  const unused = Object.keys(AR_KM).filter((key) => !all.has(key));
  assert.deepEqual(unused, [], 'an entry no text uses');
  const stillUsed = AR_KM_RETIRED.filter((key) => all.has(key));
  assert.deepEqual(stillUsed, [], 'a retired text is still shown somewhere: it needs its Arabic');
  for (const [key, text] of Object.entries(AR_KM)) {
    const forms = key.includes('|') ? Object.values(text) : [text];
    for (const form of forms) {
      assert.ok(/[؀-ۿ]/.test(form), `Arabic letters: ${key}`);
      assert.ok(!/[A-Za-z]{3,}/.test(String(form).replace(/\{[A-Za-z0-9_]+\}/g, '')), `no Latin words: ${key}`);
    }
    if (!key.includes('|')) assert.equal(names(text), names(key), key);
    else assert.deepEqual(Object.keys(text).sort(), [...FORMS].sort(), key);
  }
});

test('the first export of km.js is its table (the catalogue check reads each file that way), and one English text has one Arabic text', () => {
  const files = loadCatalogueFiles('ar');
  const mine = files.find((f) => f.file === 'km.js');
  assert.ok(mine, 'km.js is a catalogue file');
  assert.deepEqual(Object.keys(mine.table), Object.keys(AR_KM));
  const other = new Map();
  for (const { file, table } of files) if (file !== 'km.js') for (const [key, value] of Object.entries(table)) other.set(key, value);
  const clash = Object.keys(AR_KM).filter((key) => other.has(key) && JSON.stringify(other.get(key)) !== JSON.stringify(AR_KM[key]));
  assert.deepEqual(clash, [], 'another file translates the same English text differently (the later one would silently win)');
});

test('withKm adds these texts, drops the retired ones and leaves everything else', () => {
  const base = { Keep: 'يبقى', 'Compare {count} more': 'قارن {count} أخرى', 'No near-duplicates found.': 'قديم' };
  const merged = withKm(base);
  assert.equal(merged.Keep, 'يبقى');
  assert.ok(!('Compare {count} more' in merged) && !('No near-duplicates found.' in merged));
  assert.equal(merged['No duplicates found.'], AR_KM['No duplicates found.']);
  assert.ok(Object.isFrozen(merged));
  assert.equal(Object.keys(merged).length, 1 + Object.keys(AR_KM).length);
});
