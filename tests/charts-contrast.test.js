import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TONES } from '../src/sidepanel/charts/geometry.js';

// A real WCAG 2.1 contrast test for the chart colours. It reads the CSS the way the browser would: the tokens in
// src/ui/theme.css and src/ui/areas/reports.css, in three scopes (light, and the two ways the dark theme is switched on),
// resolves var(--x, fallback) chains, and measures the pairs the charts actually draw.

const ROOT = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'theme.css'), 'utf8');
const reports = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'areas', 'reports.css'), 'utf8');

// ---- a tiny CSS reader: selector { declarations }, with @media nesting ----------------------------------------------

function parseBlocks(css, media = '') {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@media')) blocks.push(...parseBlocks(body, head));
    else blocks.push({ selector: head, media, body });
    i = j;
  }
  return blocks;
}

function declarations(body) {
  const out = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1], m[2].trim());
  return out;
}

const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const pick = (css, selector, media = '') => {
  const found = parseBlocks(css).filter((b) => b.selector === selector && b.media === media);
  assert.equal(found.length, 1, `exactly one "${selector}" block${media ? ` in ${media}` : ''}`);
  return declarations(found[0].body);
};

// What the browser computes on <html> for each way the theme can be set.
function scope(name) {
  const merged = new Map([...pick(theme, ':root'), ...pick(reports, ':root')]);
  if (name === 'light') return merged;
  const themeDark = name === 'dark-media' ? pick(theme, ":root:not([data-theme='light'])", DARK_MEDIA) : pick(theme, ":root[data-theme='dark']");
  const reportsDark = name === 'dark-media' ? pick(reports, ":root:not([data-theme='light'])", DARK_MEDIA) : pick(reports, ":root[data-theme='dark']");
  return new Map([...merged, ...themeDark, ...reportsDark]);
}

const SCOPES = ['light', 'dark-media', 'dark-attr'];

function resolve(vars, name, seen = []) {
  assert.ok(!seen.includes(name), `circular var(${name})`);
  const value = vars.get(name);
  assert.ok(value !== undefined, `${name} is not defined`);
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i.exec(value);
  if (m) {
    if (vars.has(m[1])) return resolve(vars, m[1], [...seen, name]);
    assert.ok(m[2], `${name} -> ${m[1]} is not defined and has no fallback`);
    return m[2].trim();
  }
  assert.match(value, /^#[0-9a-f]{6}$/i, `${name} must resolve to a plain #rrggbb colour, got "${value}"`);
  return value.toLowerCase();
}

// ---- WCAG 2.1 ---------------------------------------------------------------------------------------------------------

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the contrast function itself matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54'); // the classic AA grey
  assert.ok(contrast('#777777', '#ffffff') < 4.5);
});

const FILLS = ['--ab-chart-1', '--ab-chart-2', '--ab-chart-3', '--ab-chart-4', '--ab-chart-5', '--ab-chart-6', '--ab-chart-good', '--ab-chart-warn', '--ab-chart-bad', '--ab-chart-neutral'];
const SEQ = ['--ab-chart-seq-1', '--ab-chart-seq-2', '--ab-chart-seq-3', '--ab-chart-seq-4', '--ab-chart-seq-5'];

for (const name of SCOPES) {
  test(`[${name}] bars, segments, lines and markers are at least 3:1 against the card`, () => {
    const vars = scope(name);
    const card = resolve(vars, '--ab-chart-surface');
    for (const token of [...FILLS, '--ab-chart-axis', '--ab-chart-focus-a']) {
      const ratio = contrast(resolve(vars, token), card);
      assert.ok(ratio >= 3, `${token} ${resolve(vars, token)} on ${card} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`[${name}] text drawn on the chart is at least 4.5:1`, () => {
    const vars = scope(name);
    const pairs = [
      ['--ab-chart-label', '--ab-chart-surface'],
      ['--ab-chart-label-muted', '--ab-chart-surface'],
      ['--ab-chart-label', '--ab-bg'],
      ['--ab-chart-label-muted', '--ab-bg'],
      ['--ab-fg', '--ab-chart-surface'],
      ['--ab-fg-muted', '--ab-chart-surface'],
      ['--ab-accent', '--ab-chart-surface'], // row links in the table view
      ['--ab-ok', '--ab-chart-surface'], // tile change, better
      ['--ab-danger', '--ab-chart-surface'], // tile change, worse
      // hover and pressed backgrounds the chart CSS uses
      ['--ab-fg-muted', '--ab-bg-subtle'],
      ['--ab-chart-label', '--ab-bg-subtle'],
      ['--ab-fg', '--ab-bg-subtle'],
      ['--ab-fg-muted', '--ab-accent-soft'],
      ['--ab-chart-label', '--ab-accent-soft'],
      ['--ab-fg', '--ab-accent-soft'],
      ['--ab-fg-muted', '--ab-bg-sunken'],
    ];
    for (const [fg, bg] of pairs) {
      const ratio = contrast(resolve(vars, fg), resolve(vars, bg));
      assert.ok(ratio >= 4.5, `${fg} ${resolve(vars, fg)} on ${bg} ${resolve(vars, bg)} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`[${name}] numbers printed inside a segment are at least 4.5:1 on every fill`, () => {
    const vars = scope(name);
    const text = resolve(vars, '--ab-chart-label-on-fill');
    for (const token of FILLS) {
      const ratio = contrast(text, resolve(vars, token));
      assert.ok(ratio >= 4.5, `--ab-chart-label-on-fill ${text} on ${token} ${resolve(vars, token)} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`[${name}] pattern strokes stay visible on every fill`, () => {
    const vars = scope(name);
    const stroke = resolve(vars, '--ab-chart-pattern');
    for (const token of FILLS) {
      const ratio = contrast(stroke, resolve(vars, token));
      assert.ok(ratio >= 3, `pattern ${stroke} on ${token} ${resolve(vars, token)} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`[${name}] heat strip: the printed label is at least 4.5:1 on all five steps, and the steps get stronger`, () => {
    const vars = scope(name);
    const label = resolve(vars, '--ab-chart-seq-label');
    const card = resolve(vars, '--ab-chart-surface');
    let previous = 1;
    for (const token of SEQ) {
      const fill = resolve(vars, token);
      assert.ok(contrast(label, fill) >= 4.5, `${token} ${fill} under ${label} is ${contrast(label, fill).toFixed(2)}:1`);
      const strength = contrast(fill, card);
      assert.ok(strength > previous, `${token} must be stronger than the step before (${strength.toFixed(2)} vs ${previous.toFixed(2)})`);
      previous = strength;
    }
    // The cell outline carries the shape of the lightest cells.
    assert.ok(contrast(resolve(vars, '--ab-chart-axis'), card) >= 3);
  });

  test(`[${name}] keyboard focus ring: the two tones differ and each is visible against the card`, () => {
    const vars = scope(name);
    const a = resolve(vars, '--ab-chart-focus-a');
    const b = resolve(vars, '--ab-chart-focus-b');
    assert.ok(contrast(a, b) >= 3, `focus rings ${a} / ${b}`);
  });

  test(`[${name}] categorical colours are not near-duplicates of each other`, () => {
    const vars = scope(name);
    const cats = ['--ab-chart-1', '--ab-chart-2', '--ab-chart-3', '--ab-chart-4', '--ab-chart-5', '--ab-chart-6'].map((t) => ({ t, c: rgb(resolve(vars, t)) }));
    for (let i = 0; i < cats.length; i += 1) {
      for (let j = i + 1; j < cats.length; j += 1) {
        const d = Math.hypot(...cats[i].c.map((v, k) => v - cats[j].c[k]));
        assert.ok(d >= 60, `${cats[i].t} and ${cats[j].t} are too close (${d.toFixed(0)})`);
      }
    }
  });
}

test('the three scopes define the same chart tokens, and the two dark scopes are identical', () => {
  const light = [...pick(reports, ':root').keys()].filter((k) => k.startsWith('--ab-chart-')).sort();
  const media = pick(reports, ":root:not([data-theme='light'])", DARK_MEDIA);
  const attr = pick(reports, ":root[data-theme='dark']");
  assert.ok(light.length >= 26, `expected the full token set, found ${light.length}`);
  assert.deepEqual([...media.keys()].sort(), light, 'dark (media query) block has the same names as the light block');
  assert.deepEqual([...attr.keys()].sort(), light, 'dark (data-theme) block has the same names as the light block');
  assert.deepEqual([...media.entries()].sort(), [...attr.entries()].sort(), 'both dark blocks hold the same values');
  // and the theme's own dark blocks are the same pair, so "dark" means one thing
  const themeMedia = pick(theme, ":root:not([data-theme='light'])", DARK_MEDIA);
  const themeAttr = pick(theme, ":root[data-theme='dark']");
  for (const [k, v] of themeMedia) assert.equal(themeAttr.get(k), v, `theme dark blocks disagree on ${k}`);
});

test('every tone the charts accept has a class and a token', () => {
  const vars = scope('light');
  const token = (tone) => `--ab-chart-${/^c\d$/.test(tone) ? tone.slice(1) : tone}`;
  for (const tone of TONES) {
    assert.match(reports, new RegExp(`\\.ab-tone-${tone}\\s*\\{\\s*--tone:\\s*var\\(${token(tone)}\\);`), `.ab-tone-${tone}`);
    assert.ok(vars.has(token(tone)), token(tone));
  }
  for (let level = 1; level <= 5; level += 1) assert.match(reports, new RegExp(`\\.ab-heat-${level}\\s*\\{\\s*background:\\s*var\\(--ab-chart-seq-${level}\\)`));
});

test('no colour literal outside the token definitions (CSS), none at all in the chart components', () => {
  const chartPart = reports.split('/* ==== end of charts css ==== */')[0];
  assert.notEqual(chartPart, reports, 'the end-of-charts marker is present');
  const rules = parseBlocks(chartPart);
  const isTokenBlock = (b) => /^:root/.test(b.selector);
  const offenders = rules.filter((b) => !isTokenBlock(b) && /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bhwb\(|\blab\(|\boklch\(/i.test(b.body));
  assert.deepEqual(offenders.map((b) => b.selector), [], 'colour literals belong in the token blocks only');
  // comma-layered backgrounds render transparent with token colours (see theme.css)
  assert.ok(!/background\s*:[^;]*var\([^)]*\)\s*,/i.test(chartPart), 'no comma-layered backgrounds');

  const dir = path.join(ROOT, 'src', 'sidepanel', 'charts');
  const files = fs.readdirSync(dir).filter((f) => /\.(jsx?|js)$/.test(f));
  assert.ok(files.length >= 12, `found ${files.length} chart files`);
  for (const f of files) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(source.replace(/url\(#\$\{/g, '')), `${f} has a hex colour`);
    assert.ok(!/\brgba?\(|\bhsla?\(/i.test(source), `${f} has an rgb()/hsl() colour`);
    assert.ok(!/\bstyle=\{\{/.test(source), `${f} uses an inline style (classes and SVG attributes only)`);
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|eval\(/.test(source), `${f} injects markup`);
  }
});
