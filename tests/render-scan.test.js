import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The renderer must never be able to build markup or load anything. This test reads the source of src/render and
// fails if any of the usual escape hatches shows up, even in a comment, so the guarantee is easy to audit.
const dir = path.join(__dirname, '..', 'src', 'render');

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]));
}

const FORBIDDEN = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML', /innerHTML/],
  ['outerHTML', /outerHTML/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\s*\.\s*write/],
  ['an image tag', /<img/i],
  ['a href attribute', /href\s*=/i],
  ['a src attribute', /\bsrc\s*=/i],
  ['an anchor element', /<a[\s>]/i],
  ['eval', /\beval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['a script element', /<script/i],
  ['an iframe', /<iframe/i],
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['chrome api', /\bchrome\./],
];

test('src/render has files to scan', () => {
  const found = files(dir).map((f) => path.basename(f));
  assert.ok(found.includes('safeText.js'));
  assert.ok(found.includes('SafeText.jsx'));
});

test('src/render contains none of the markup, link, image or network escape hatches', () => {
  for (const file of files(dir)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [what, pattern] of FORBIDDEN) {
      assert.ok(!pattern.test(source), `${path.basename(file)} contains ${what}`);
    }
  }
});

test('src/render has no stylesheet and no hidden characters in its source', () => {
  for (const file of files(dir)) {
    assert.ok(!/\.(css|scss|less)$/i.test(file), `${file} is a stylesheet`);
    const source = fs.readFileSync(file, 'utf8');
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(source), `${path.basename(file)} has a non-ASCII or control character`);
  }
});
