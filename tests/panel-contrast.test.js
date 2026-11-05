import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// WCAG 2.1 contrast for the text the side panel draws, in the light theme and in both ways the dark theme is switched on (the
// system setting, and data-theme="dark"). Every pair below is a text colour on the background it is drawn on in src/ui/ui.css and the
// panel's area styles; colours come only from the --ab-* tokens in src/ui/theme.css, so checking the tokens checks the panel.
// (The charts have their own test: tests/charts-contrast.test.js.)

const ROOT = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(css, media = '') {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@media')) out.push(...blocks(body, head));
    else out.push({ selector: head, media, body });
    i = j;
  }
  return out;
}
const vars = (body) => new Map([...body.matchAll(/(--ab-[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]));
const pick = (selector, media = '') => {
  const found = blocks(theme).filter((b) => b.selector === selector && b.media === media);
  assert.equal(found.length, 1, `one "${selector}" block`);
  return vars(found[0].body);
};
const SCOPES = {
  light: pick(':root'),
  'dark (system setting)': new Map([...pick(':root'), ...pick(":root:not([data-theme='light'])", '@media (prefers-color-scheme: dark)')]),
  'dark (data-theme)': new Map([...pick(':root'), ...pick(":root[data-theme='dark']")]),
};

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text token, background token, where it is used]
const PAIRS = [
  ['--ab-fg', '--ab-bg', 'body text'],
  ['--ab-fg', '--ab-bg-raised', 'cards, buttons, the answer'],
  ['--ab-fg', '--ab-bg-subtle', 'header, plain notes'],
  ['--ab-fg', '--ab-accent-soft', 'quick-actions bar, a picked group'],
  ['--ab-fg', '--ab-warn-soft', 'details inside a warning'],
  ['--ab-fg', '--ab-danger-soft', 'details inside a problem'],
  ['--ab-fg-muted', '--ab-bg', 'hints'],
  ['--ab-fg-muted', '--ab-bg-raised', 'hints and descriptions in cards'],
  ['--ab-fg-muted', '--ab-bg-subtle', 'footer, hints in plain notes'],
  ['--ab-fg-muted', '--ab-accent-soft', 'the hint in the quick-actions bar'],
  ['--ab-fg-soft', '--ab-bg-sunken', 'tags, step numbers'],
  ['--ab-fg-soft', '--ab-bg-raised', 'quiet buttons'],
  ['--ab-accent', '--ab-bg-raised', 'record numbers'],
  ['--ab-accent', '--ab-accent-soft', 'masked-value placeholders, the "Next" step'],
  ['--ab-accent-fg', '--ab-accent', 'primary buttons, the current step number'],
  ['--ab-on-danger', '--ab-danger-solid', 'danger buttons'],
  ['--ab-warn', '--ab-warn-soft', 'warnings'],
  ['--ab-danger', '--ab-danger-soft', 'problems and errors'],
  ['--ab-ok', '--ab-ok-soft', 'success notes, the "Done" step'],
  ['--ab-ai', '--ab-bg-raised', 'the AI badge, AI Assist labels'],
  ['--ab-ai', '--ab-ai-soft', 'the AI Assist rule line and chips'],
  ['--ab-ai-fg', '--ab-ai', 'the main AI Assist button'],
  ['--ab-fg', '--ab-ai-soft', 'text inside the AI Assist area'],
  ['--ab-fg-muted', '--ab-ai-soft', 'hints inside the AI Assist area'],
  // the calm look (2026): soft panels, the "Needs you now" block, the masked-value chip, the neutral chip
  ['--ab-fg', '--ab-surface', 'answers and summary strips (.ab-surface, .ab-card, .ab-output)'],
  ['--ab-fg-muted', '--ab-surface', 'hints inside a soft panel'],
  ['--ab-fg-soft', '--ab-surface', 'quiet buttons inside a soft panel'],
  ['--ab-accent', '--ab-surface', 'links inside a soft panel'],
  ['--ab-fg', '--ab-attn-bg', 'an item of "Needs you now"'],
  ['--ab-attn-fg', '--ab-attn-bg', 'the heading of "Needs you now"'],
  ['--ab-fg-muted', '--ab-attn-bg', 'the line under an item of "Needs you now"'],
  ['--ab-accent', '--ab-attn-bg', 'a link inside "Needs you now"'],
  ['--ab-mask-fg', '--ab-mask-bg', 'a masked value in the check before sending'],
  ['--ab-fg-soft', '--ab-bg-subtle', 'a neutral chip on a subtle background'],
];

// Lines and marks that are not text but must be seen (WCAG 1.4.11, 3:1): the edge of a text box, the icon of an attention item.
const GRAPHICS = [
  ['--ab-input-border', '--ab-bg', 'the edge of a text box or a select'],
  ['--ab-warn', '--ab-attn-icon-bg', 'the icon of a "Needs you now" item'],
  ['--ab-danger', '--ab-danger-soft', 'the icon of a danger item'],
  ['--ab-ai', '--ab-bg', 'the AI spark'],
];
for (const [name, scope] of Object.entries(SCOPES)) {
  test(`lines and marks are visible (3:1): ${name}`, () => {
    const failing = GRAPHICS.filter(([fg, bg]) => ratio(scope.get(fg), scope.get(bg)) < 3).map(([fg, bg, where]) => `${fg} on ${bg} (${where}): ${ratio(scope.get(fg), scope.get(bg)).toFixed(2)}`);
    assert.deepEqual(failing, []);
  });
}

for (const [name, scope] of Object.entries(SCOPES)) {
  test(`panel text is readable (WCAG AA, 4.5:1): ${name}`, () => {
    const failing = [];
    for (const [fg, bg, where] of PAIRS) {
      const a = scope.get(fg);
      const b = scope.get(bg);
      assert.match(a || '', /^#[0-9a-f]{6}$/i, `${fg} is a plain colour`);
      assert.match(b || '', /^#[0-9a-f]{6}$/i, `${bg} is a plain colour`);
      const r = ratio(a, b);
      if (r < 4.5) failing.push(`${fg} on ${bg} (${where}): ${r.toFixed(2)}`);
    }
    assert.deepEqual(failing, []);
  });
}

test('the panel styles use colour tokens only (no literal colours) in the shared and the panel area files', () => {
  for (const file of ['ui.css', 'areas/checks.css', 'areas/compose.css', 'areas/knowledge.css', 'areas/domain.css', 'areas/itsm.css', 'areas/portal.css', 'areas/shell.css', 'areas/insights.css', 'areas/assist-actions.css', 'areas/assist-answers.css', 'areas/mywork.css', 'areas/setup.css', 'areas/palette.css']) {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // rgba() is allowed only inside the theme file's shadows and rings; panel styles take every colour from a token
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), `${file}: no hex colours`);
    assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/i.test(css), `${file}: no rgb()/hsl() colours`);
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/gi)) assert.ok(SCOPES.light.has(m[1]), `${file}: ${m[1]} is a theme token`);
  }
});
