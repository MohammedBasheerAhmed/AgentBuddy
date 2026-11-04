import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WriteAssist, WriteInsights } from '../src/sidepanel/write/index.js';
import { normalizePolicy } from '../src/policy/policy.js';

// First render only (effects do not run in a static render): enough to catch a broken import, a typo in a render path, and to look
// at the structure and the safety of the markup of the Write screen's two halves (round 3). Behaviour is covered by
// tests/panel-live-write.test.js and the pure-module tests; nothing here is a substitute for using the panel in a real browser.
const eff = (over = {}) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, profiles: ['it'], ...(over.values || {}) },
  locked: {},
  policy: normalizePolicy(over.policy || {}),
  apiKey: 'apiKey' in over ? over.apiKey : 'sk-ant-test',
  keyLocked: Boolean(over.keyLocked),
});
const record = { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident' };
const page = (over = {}) => ({ status: 'record', tabId: 7, href: 'https://acme.service-now.com/incident.do?sys_id=' + 'a'.repeat(32), surface: 'classic', record, newRecord: null, user: { name: 'Beth Anglin' }, ...over });
const insights = (p, e) => renderToStaticMarkup(React.createElement(WriteInsights, { page: p, eff: e, active: true }));
const assist = (p, e) => renderToStaticMarkup(React.createElement(WriteAssist, { page: p, eff: e, active: true }));

test('Insights: the safe-to-send check and the snippets, for the ticket that is open; no email tools and no AI mark', () => {
  const markup = insights(page(), eff());
  assert.match(markup, /For INC0010001/, 'the tools say which ticket they work on');
  assert.match(markup, /Safe-to-send check/);
  assert.match(markup, /Snippets/);
  assert.match(markup, />Check my comment<\/button>/);
  assert.equal((markup.match(/ab-btn-primary/g) || []).length, 1, 'one primary button on the screen');
  assert.doesNotMatch(markup, /Which email fits|Suggested emails/, 'the email tools moved to the Ticket screen');
  assert.doesNotMatch(markup, /ab-ai-badge/, 'no Insights element carries the AI mark');
  for (const id of ['ab-check-field', 'ab-snip-search']) assert.ok(markup.includes(`id="${id}"`) && markup.includes(`for="${id}"`), `${id} has a label`);
  for (const label of ['Customer comment', 'Resolution notes', 'Description']) assert.ok(markup.includes(`>${label}</option>`), label);
});

test('Insights with no ticket open says so', () => {
  const markup = insights(page({ status: 'no-record', record: null }), eff());
  assert.match(markup, /No ticket is open\./);
});

test('AI Assist: Rewrite and Notes to ticket, each marked as AI; Notes only for the profiles that open tickets', () => {
  const markup = assist(page(), eff());
  assert.match(markup, /For INC0010001/);
  assert.match(markup, /Rewrite/);
  assert.match(markup, /Notes to ticket/);
  assert.ok((markup.match(/class="ab-ai-badge"/g) || []).length >= 3, 'the cards and the AI buttons carry the AI mark');
  for (const id of ['ab-rewrite-text', 'ab-rewrite-field', 'ab-rewrite-names', 'ab-rewrite-language', 'ab-notes-text', 'ab-notes-names']) {
    assert.ok(markup.includes(`id="${id}"`), `${id} exists`);
    assert.ok(markup.includes(`for="${id}"`), `${id} has a label`);
  }
  const req = assist(page(), eff({ values: { profiles: ['req'] } }));
  assert.doesNotMatch(req, /Rough notes from the call/, 'request fulfilment does not open tickets from calls');
  assert.match(req, /Text to rewrite/);
});

test('the rewrite and notes buttons are disabled until there is text', () => {
  const markup = assist(page(), eff());
  const buttonFor = (label) => new RegExp(`<button[^>]*disabled=""[^>]*>(?:<span class="ab-ai-badge"[\\s\\S]*?</span>\\s*)?${label}</button>`).test(markup);
  for (const label of ['Shorter', 'Friendlier', 'Plain language', 'More formal', 'Fix spelling and grammar', 'Translate', 'Bilingual']) assert.ok(buttonFor(label), label);
  assert.ok(buttonFor(' ?Write the ticket'), 'Write the ticket');
});

test('Notes to ticket on a saved record offers to open a blank incident (a case for customer service)', () => {
  const it = assist(page(), eff());
  assert.match(it, />Open a blank incident<\/button>/);
  assert.doesNotMatch(it, /Open a blank case/);
  const csm = assist(page(), eff({ values: { profiles: ['csm'] } }));
  assert.match(csm, />Open a blank case<\/button>/);
  const blank = assist(page({ status: 'no-record', record: null, newRecord: { table: 'incident', kind: 'incident' } }), eff());
  assert.doesNotMatch(blank, /Open a blank incident/, 'not while a blank form is open');
  assert.match(blank, /For a new incident form/);
});

test('the rewrite panel offers the field choices and a dozen languages', () => {
  const markup = assist(page(), eff());
  for (const label of ['Customer comment', 'Work note', 'Resolution notes', 'Description', 'Short description']) assert.ok(markup.includes(`>${label}</option>`), label);
  assert.equal((markup.match(/<option value="(en|es|fr|de|pt|it|nl|pl|hi|ar|zh|ja)"(?: selected="")?>/g) || []).length, 12);
});

test('without an AI key the AI half says so once, with the way to Settings', () => {
  const markup = assist(page(), eff({ apiKey: '' }));
  assert.equal((markup.match(/Add an AI key in Settings to use Rewrite and Notes to ticket\./g) || []).length, 1);
  const locked = assist(page(), eff({ apiKey: '', keyLocked: true }));
  // A locked key is unlocked right there (AI0.1): the passphrase box, not a trip to Settings.
  assert.match(locked, /Your AI key is locked\. Enter your passphrase to unlock it for this browser session\./);
  assert.match(locked, /<input[^>]*type="password"/);
  assert.match(locked, />Unlock<\/button>/);
  assert.doesNotMatch(insights(page(), eff({ apiKey: '' })), /AI key/, 'Insights needs no key');
});

test('a local model counts as ready without a key', () => {
  const markup = assist(page(), eff({ apiKey: '', values: { provider: 'ollama' } }));
  assert.ok(!markup.includes('Add an AI key'));
});

test('the markup is inert: no links, images, scripts, frames or inline handlers', () => {
  for (const p of [page(), page({ status: 'no-record', record: null }), page({ record: null, newRecord: { table: 'incident', kind: 'incident' } })]) {
    for (const markup of [insights(p, eff()), assist(p, eff())]) {
      assert.ok(!/<(a|img|script|iframe|object|embed|form|link)[\s>]/i.test(markup));
      assert.ok(!/\s(href|src|srcdoc|action|on[a-z]+)=/i.test(markup));
      assert.ok(!/style="[^"]*(color|background)\s*:/i.test(markup), 'no inline colours: tokens from the stylesheet only');
    }
  }
});

test('the stylesheet uses theme tokens only: no colour literals', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'areas', 'compose.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hex colours');
  assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/.test(css), 'no colour functions');
  assert.ok(!/,\s*var\(--ab-[a-z-]+\)\s*;/.test(css.replace(/font-family[^;]*;/g, '')), 'no comma-layered backgrounds');
  assert.ok(css.includes('.ab-write'), 'the Write screen has its styles');
});
