import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ComposeView from '../src/sidepanel/tabs/ComposeView.jsx';
import { normalizePolicy } from '../src/policy/policy.js';

// Some shared components (RunPanel...) use JSX without importing React; the build uses the automatic runtime, this bundle
// uses the classic one. Providing React globally makes the same code render here.
globalThis.React = React;

// First render only (effects do not run in a static render): enough to catch a broken import, a typo in a render path, and
// to look at the structure and the safety of the markup. The panels' behaviour is covered by the pure-module tests; nothing
// here is a substitute for using the panel in a real browser.
const eff = (over = {}) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {} },
  locked: {},
  policy: normalizePolicy({}),
  apiKey: 'sk-ant-test',
  keyLocked: false,
  ...over,
});
const record = { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident' };
const page = (over = {}) => ({ status: 'record', tabId: 7, href: 'https://acme.service-now.com/incident.do?sys_id=' + 'a'.repeat(32), surface: 'classic', record, newRecord: null, user: { name: 'Beth Anglin' }, ...over });
const html = (p, e) => renderToStaticMarkup(React.createElement(ComposeView, { page: p, eff: e }));

test('the Write section renders four tabs with the standard tab roles; Email is shown first', () => {
  const markup = html(page(), eff());
  assert.match(markup, /role="tablist"/);
  assert.equal((markup.match(/role="tab"/g) || []).length, 4);
  assert.equal((markup.match(/role="tabpanel"/g) || []).length, 4);
  for (const label of ['Email', 'Rewrite', 'Notes to ticket', 'Snippets']) assert.ok(markup.includes(`>${label}</button>`), label);
  assert.equal((markup.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(markup, /id="ab-compose-tab-email"[^>]*aria-selected="true"/);
  // the other three panels exist but are hidden, so their drafts survive a look at another tab
  assert.equal((markup.match(/class="ab-compose-panel" hidden=""/g) || []).length, 3);
  // roving tab index: only the selected tab is in the tab order
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1);
  assert.ok((markup.match(/tabindex="-1"/g) || []).length >= 3);
  // every tab names the panel it controls, every panel names its tab
  for (const id of ['email', 'rewrite', 'notes', 'snippets']) {
    assert.ok(markup.includes(`aria-controls="ab-compose-panel-${id}"`), id);
    assert.ok(markup.includes(`aria-labelledby="ab-compose-tab-${id}"`), id);
  }
});

test('every control in the panels has a label', () => {
  const markup = html(page(), eff());
  for (const id of ['ab-rewrite-text', 'ab-rewrite-field', 'ab-rewrite-names', 'ab-rewrite-language', 'ab-notes-text', 'ab-notes-names', 'ab-snip-search']) {
    assert.ok(markup.includes(`id="${id}"`), `${id} exists`);
    assert.ok(markup.includes(`for="${id}"`), `${id} has a label`);
  }
});

test('with no ticket open, Email says so instead of showing suggestions', () => {
  const markup = html(page({ status: 'no-record', record: null }), eff());
  assert.match(markup, /Open a ticket/);
  assert.ok(!markup.includes('Which email fits?'));
});

test('the rewrite and notes buttons are disabled until there is text', () => {
  const markup = html(page(), eff());
  const buttonFor = (label) => new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(markup);
  for (const label of ['Shorter', 'Friendlier', 'Plain language', 'More formal', 'Fix spelling and grammar', 'Translate', 'Bilingual']) assert.ok(buttonFor(label), label);
  assert.ok(buttonFor('Write the ticket'));
});

test('the rewrite panel offers the field choices and a dozen languages', () => {
  const markup = html(page(), eff());
  for (const label of ['Customer comment', 'Work note', 'Resolution notes', 'Description', 'Short description']) assert.ok(markup.includes(`>${label}</option>`), label);
  assert.equal((markup.match(/<option value="(en|es|fr|de|pt|it|nl|pl|hi|ar|zh|ja)"(?: selected="")?>/g) || []).length, 12);
});

test('without an AI key every panel says so', () => {
  const markup = html(page(), eff({ apiKey: '' }));
  assert.ok((markup.match(/Add an AI key in Settings to use this\./g) || []).length >= 2);
  const locked = html(page(), eff({ apiKey: '', keyLocked: true }));
  assert.match(locked, /Your AI key is locked\. Unlock it in Settings\./);
});

test('a local model counts as ready without a key', () => {
  const markup = html(page(), eff({ apiKey: '', values: { provider: 'ollama', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {} } }));
  assert.ok(!markup.includes('Add an AI key'));
});

test('the markup is inert: no links, images, scripts, frames or inline handlers', () => {
  for (const p of [page(), page({ status: 'no-record', record: null }), page({ record: null, newRecord: { table: 'incident', kind: 'incident' } })]) {
    const markup = html(p, eff());
    assert.ok(!/<(a|img|script|iframe|object|embed|form|link)[\s>]/i.test(markup));
    assert.ok(!/\s(href|src|srcdoc|action|on[a-z]+)=/i.test(markup));
    assert.ok(!/style="[^"]*(color|background)\s*:/i.test(markup), 'no inline colours: tokens from the stylesheet only');
  }
});

test('the stylesheet uses theme tokens only: no colour literals', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'areas', 'compose.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hex colours');
  assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/.test(css), 'no colour functions');
  assert.ok(!/,\s*var\(--ab-[a-z-]+\)\s*;/.test(css.replace(/font-family[^;]*;/g, '')), 'no comma-layered backgrounds');
  assert.ok(css.includes('.ab-compose-panel[hidden]'), 'a hidden panel stays hidden');
});
