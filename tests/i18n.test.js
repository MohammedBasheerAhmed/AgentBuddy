import test from 'node:test';
import assert from 'node:assert/strict';
import { checkI18n, loadCatalogue, loadCatalogueFiles } from '../scripts/lib/i18nCheck.js';
import { LANGUAGES, getLanguage, resolveLanguage, setLanguage, t, tm, tn, isolate, isRtl, direction, formatNumber } from '../src/i18n/index.js';
import { tx } from '../src/i18n/jsx.jsx';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

// The mechanism (src/i18n) and the promise that no text a person reads is missing in Arabic (scripts/lib/i18nCheck.js reads the
// source for every t(), tn(), tm() and tx() and looks each one up in src/i18n/ar).

test.afterEach(() => setLanguage('en'));

// ---- the mechanism -----------------------------------------------------------------------------------------------------------------

test('the language is the person\'s choice, or for "auto" the browser\'s when it is one we have, else English', () => {
  assert.equal(resolveLanguage('ar', 'en-US'), 'ar');
  assert.equal(resolveLanguage('en', 'ar-SA'), 'en');
  assert.equal(resolveLanguage('auto', 'ar-AE'), 'ar');
  assert.equal(resolveLanguage('auto', 'ar'), 'ar');
  assert.equal(resolveLanguage('auto', 'en-GB'), 'en');
  assert.equal(resolveLanguage('auto', 'fr-FR'), 'en');
  assert.equal(resolveLanguage(undefined, ''), 'en');
  assert.equal(resolveLanguage('klingon', 'ar'), 'ar', 'an unknown word means "auto"');
  assert.deepEqual(LANGUAGES.map((l) => l.id), ['auto', 'en', 'ar']);
});

test('English returns the text as written, with {names} filled in and unknown {names} left alone', () => {
  assert.equal(setLanguage('en'), 'en');
  assert.equal(t('Turn on for this site'), 'Turn on for this site');
  assert.equal(t('Showing {shown} of {total}', { shown: 3, total: 10 }), 'Showing 3 of 10');
  assert.equal(t('Hello {name}, {missing}', { name: 'Ann' }), 'Hello Ann, {missing}');
  assert.equal(t('Count {n}', { n: 0 }), 'Count 0', 'zero is a value');
  assert.equal(tm('Open'), 'Open');
  assert.equal(tn(1, '{n} ticket', '{n} tickets'), '1 ticket');
  assert.equal(tn(0, '{n} ticket', '{n} tickets'), '0 tickets');
  assert.equal(tn(2, '{n} ticket', '{n} tickets'), '2 tickets');
});

test('Arabic: a text with an entry is translated, one without is shown in English, the plural forms follow Arabic', () => {
  assert.equal(setLanguage('ar'), 'ar');
  assert.equal(getLanguage(), 'ar');
  assert.ok(isRtl() && direction() === 'rtl');
  assert.equal(t('Language'), 'اللغة');
  assert.equal(t('A text nobody translated {x}', { x: 1 }), 'A text nobody translated 1');
  setLanguage('en');
  assert.ok(!isRtl() && direction() === 'ltr');
});

test('an unknown language means English', () => {
  assert.equal(setLanguage('fr'), 'en');
  assert.equal(t('Language'), 'Language');
});

test('isolate wraps a value only in a right-to-left language, and numbers use ASCII digits', () => {
  assert.equal(isolate('INC0010001'), 'INC0010001');
  setLanguage('ar');
  assert.equal(isolate('INC0010001'), '⁨INC0010001⁩');
  assert.equal(isolate(''), '');
  assert.equal(isolate(null), '');
  assert.match(formatNumber(1234567), /^1,234,567$/);
  assert.match(formatNumber(0.5, { style: 'percent' }), /^50\s?%$/);
});

test('tx puts an element inside a translated sentence, wherever the translation has its slot', () => {
  const html = (node) => renderToStaticMarkup(React.createElement(React.Fragment, null, node));
  assert.equal(html(tx('Hello {who}!', { who: React.createElement('b', null, 'Ann') })), 'Hello <b>Ann</b>!');
  assert.equal(html(tx('No slot given {who}', {})), 'No slot given {who}');
});

// ---- the promise ---------------------------------------------------------------------------------------------------------------------

test('every text a person reads has an Arabic entry; no entry is left over; every entry keeps its {names}; plural entries have all six forms', () => {
  const r = checkI18n({ whole: true });
  const lines = [
    ...r.missing.slice(0, 15).map((m) => `no Arabic: ${m.where.file}:${m.where.line} ${JSON.stringify(m.key).slice(0, 90)}`),
    ...r.params.slice(0, 10).map((p) => `different {names}: ${JSON.stringify(p.key).slice(0, 80)} (${p.english} / ${p.arabic})`),
    ...r.badPlural.slice(0, 10).map((p) => `plural: ${JSON.stringify(p.key).slice(0, 80)} ${p.why}`),
    ...r.dynamic.slice(0, 10).map((d) => `not a plain text: ${d.file}:${d.line} ${d.text}`),
    ...r.extra.slice(0, 15).map((k) => `unused entry: ${JSON.stringify(k).slice(0, 90)}`),
  ];
  assert.equal(lines.length, 0, `${r.missing.length} missing, ${r.params.length + r.badPlural.length} wrong, ${r.dynamic.length} dynamic, ${r.extra.length} unused:\n${lines.join('\n')}`);
  assert.ok(r.used > 500, `the check reads the whole source (${r.used} texts found)`);
});

// Latin words that stay Latin in the Arabic: brands, standards and short codes people know by their letters.
const LATIN_OK = new Set(
  ('Agent Buddy ServiceNow Chrome Edge Google Microsoft DeepSeek OpenAI Anthropic Claude Azure Gemini Mistral Groq OpenRouter Ollama ' +
    'AI API URL URLs ID IDs IBAN CSV JSON PDF HTML HR IT SLA SLAs CI CIs CMDB KB VIP RCA CAB SSN MAC IP DNS VPN SMS UI PII CRX ' +
    'JavaScript GET POST sys_id g_form Workspace Workspaces Service Portal Employee Center Now Assist Buddy ' +
    // models and their tiers, Azure's own words, syntax and keys named as they are written on the keyboard or in a command
    'Sonnet Haiku Opus Fable Flash Pro Llama Chat Reasoner Foundry resource deployment Deployment Deployments version preview name code ' +
    'disabledFeatures orgFormats ollama pull Ctrl Person ' +
    'localhost min h d s ms px MB GB http https com').split(/\s+/)
);

test('the Arabic is Arabic: an entry has no Latin words except names, standards and codes', () => {
  const table = loadCatalogue('ar');
  const bad = [];
  const check = (key, text) => {
    // What is quoted is a name on another screen (Azure's own "Keys and Endpoint"); ?query, #fragment and /path are syntax.
    const cleaned = String(text)
      .replace(/\{[A-Za-z0-9_]+\}/g, ' ')
      .replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ')
      .replace(/[?#/][A-Za-z0-9_-]+/g, ' ');
    const words = cleaned.match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];
    const left = words.filter((w) => !LATIN_OK.has(w) && w.length > 2 && !/^[A-Z0-9_]+$/.test(w) && !/[0-9_.-]/.test(w));
    if (left.length) bad.push(`${JSON.stringify(key).slice(0, 60)} -> ${left.slice(0, 4).join(', ')}`);
  };
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') check(key, value);
    else for (const form of Object.values(value)) check(key, form);
  }
  assert.equal(bad.length, 0, `${bad.length} entries keep English words:\n${bad.slice(0, 25).join('\n')}`);
});

test('one English text has one Arabic text: two catalogue files never translate it differently (the later one would silently win)', () => {
  const first = new Map();
  const conflicts = [];
  for (const { file, table } of loadCatalogueFiles('ar')) {
    for (const [key, value] of Object.entries(table)) {
      const text = JSON.stringify(value);
      if (!first.has(key)) first.set(key, { file, text });
      else if (first.get(key).text !== text) conflicts.push(`${JSON.stringify(key).slice(0, 60)}: ${first.get(key).file} / ${file}`);
    }
  }
  assert.equal(conflicts.length, 0, `${conflicts.length} texts are translated two ways:\n${conflicts.slice(0, 20).join('\n')}`);
});
