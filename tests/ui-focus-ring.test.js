import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The keyboard focus ring (audit P3.32). --ab-ring in src/ui/theme.css is a list of box shadows ("0 0 0 2px <colour>, 0 0 0 5px
// <colour>"), not a colour: inside `outline` the declaration is invalid and the browser drops it, so the ring a rule meant to draw is
// never drawn. Every stylesheet uses the token only as a box-shadow, the way src/ui/ui.css draws the ring for :focus-visible.

const ROOT = path.join(__dirname, '..');
const sheets = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sheets(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));

test('--ab-ring is a list of shadows, and it is used only as a box-shadow', () => {
  const theme = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'theme.css'), 'utf8');
  assert.match(theme, /--ab-ring:\s*0 0 0 2px [^;]+,\s*0 0 0 5px/, 'the token is two shadows');
  const wrong = [];
  for (const file of sheets(path.join(ROOT, 'src'))) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([a-z-]+)\s*:[^;{}]*var\(--ab-ring\)/g)) if (m[1] !== 'box-shadow') wrong.push(`${path.relative(ROOT, file)}: ${m[0].trim()}`);
  }
  assert.deepEqual(wrong, []);
});

test('My work draws the same ring as the rest of the panel on its links, filters and folds', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'areas', 'mywork.css'), 'utf8');
  for (const name of ['ab-mw-link', 'ab-mw-filter', 'ab-mw-fold-toggle']) {
    assert.match(css, new RegExp(`\\.${name}:focus-visible\\s*\\{[^}]*box-shadow:\\s*var\\(--ab-ring\\)`), name);
  }
});
