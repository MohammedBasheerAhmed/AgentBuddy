import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fold, rankCommands } from '../src/sidepanel/palette/search.js';
import { buildCommands, groupLabel } from '../src/sidepanel/palette/commands.js';
import CommandPalette, { isPaletteKey } from '../src/sidepanel/palette/CommandPalette.jsx';
import { THEMES, nextTheme, themeAttribute } from '../src/ui/useTheme.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { featureIcon } from '../src/sidepanel/ui/featureIcons.js';
import { setLanguage } from '../src/i18n/index.js';
import { FEATURES } from '../src/features/registry.js';
import { QUICK_LABELS } from '../src/features/quick.js';

globalThis.React = React;

const eff = (values = {}, policy = {}) => ({ ready: true, ...effectiveSettings(values, policy) });
const incident = { table: 'incident', sysId: 'a'.repeat(32), kind: 'incident' };
const recordPage = { tabId: 7, record: incident };
const screens = [{ id: 'ticket', label: 'Ticket' }, { id: 'mywork', label: 'My work' }, { id: 'team', label: 'Team' }];

// ---- the search ------------------------------------------------------------------------------------------------------------------------

test('fold: case, Arabic vowel marks, tatweel and the shapes of alef, yeh and heh do not matter', () => {
  assert.equal(fold('  Draft   A Reply '), 'draft a reply');
  assert.equal(fold('الإعدادات'), fold('الاعدادات'));
  assert.equal(fold('مُسَاعِد'), fold('مساعد'));
  assert.equal(fold('الكلمــة'), fold('الكلمه'));
  assert.equal(fold('على'), fold('علي'));
});

const sample = [
  { id: 'go:team', label: 'Go to Team', group: 'go', keywords: 'team open show screen' },
  { id: 'run:reply-draft', label: 'Draft a reply to the customer', hint: 'A short, polite reply', group: 'ticket', keywords: 'reply draft' },
  { id: 'run:record-summary', label: 'Summarise this ticket', hint: 'Issue, impact and the next step', group: 'ticket', keywords: 'record summary' },
  { id: 'theme:dark', label: 'Use dark colours', group: 'panel', keywords: 'theme colours mode appearance light dark' },
];

test('an empty query keeps every command in order; a query keeps only what every word matches', () => {
  assert.deepEqual(rankCommands(sample, '').map((c) => c.id), sample.map((c) => c.id));
  assert.deepEqual(rankCommands(sample, 'reply').map((c) => c.id), ['run:reply-draft']);
  assert.deepEqual(rankCommands(sample, 'draft reply').map((c) => c.id), ['run:reply-draft']);
  assert.deepEqual(rankCommands(sample, 'zzz'), []);
  assert.deepEqual(rankCommands(sample, 'reply zzz'), []);
});

test('the start of a word of the label beats letters inside it, and the label beats the hint and the keywords', () => {
  const list = [
    { id: 'a', label: 'Open the screen of teams', group: 'x' },
    { id: 'b', label: 'Go to Team', group: 'x' },
    { id: 'c', label: 'Something else', hint: 'works with team data', group: 'x' },
  ];
  assert.deepEqual(rankCommands(list, 'team').map((c) => c.id), ['b', 'a', 'c']);
});

test('letters in order find a command ("rpl" finds the reply), and a short word of two letters can too', () => {
  assert.deepEqual(rankCommands(sample, 'rpl').map((c) => c.id), ['run:reply-draft']);
  assert.deepEqual(rankCommands(sample, 'dk').map((c) => c.id).includes('theme:dark'), true);
});

test('the keywords let English find a command whose label is Arabic', () => {
  const ar = [{ id: 'theme:dark', label: 'استخدام الألوان الداكنة', group: 'panel', keywords: 'theme colours mode appearance light dark' }];
  assert.equal(rankCommands(ar, 'dark').length, 1);
  assert.equal(rankCommands(ar, 'الالوان').length, 1, 'alef with hamza is typed as plain alef');
});

test('equal scores keep the order the commands came in, and the list is cut to the limit', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, label: `Command ${i}`, group: 'x' }));
  assert.deepEqual(rankCommands(many, 'command', 5).map((c) => c.id), ['c0', 'c1', 'c2', 'c3', 'c4']);
  assert.equal(rankCommands(many, '', 7).length, 7);
});

// ---- the commands ----------------------------------------------------------------------------------------------------------------------

test('without a record: the screens, Settings, the colours and the languages; no AI action', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'mywork', recordPage: null });
  const ids = list.map((c) => c.id);
  assert.deepEqual(ids.filter((id) => id.startsWith('go:')), ['go:ticket', 'go:mywork', 'go:team']);
  assert.ok(ids.includes('settings'));
  assert.ok(!ids.some((id) => id.startsWith('run:')), 'nothing to run without a record');
  assert.ok(!ids.includes('half:assist'), 'My work has only one half');
});

test('on a record: the AI actions this record offers (with the AI mark) and the Insights cards, each as a launch', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  const runs = list.filter((c) => c.action.type === 'run');
  assert.ok(runs.some((c) => c.id === 'run:record-summary' && c.ai === true), 'the summary is offered on an incident');
  assert.ok(runs.some((c) => c.id === 'run:card:ready' && !c.ai), 'an Insights card carries no AI mark');
  for (const c of runs) assert.match(c.action.featureId, /^(?:card:)?[a-z][a-z0-9-]{0,63}$/, 'a valid launch id');
  assert.ok(list.some((c) => c.id === 'half:assist') && list.some((c) => c.id === 'half:insights'));
});

test('AI switched off by the organisation: no AI action and no AI Assist half to show', () => {
  const list = buildCommands({ eff: eff({}, { aiEnabled: false }), screens, active: 'ticket', recordPage });
  assert.ok(!list.some((c) => c.ai));
  assert.ok(!list.some((c) => c.id === 'half:assist'));
  assert.ok(list.some((c) => c.id === 'run:card:ready'), 'Insights still works');
});

test('the colours and languages offered are the ones not in use', () => {
  const list = buildCommands({ eff: eff({ theme: 'dark', language: 'ar' }), screens, active: 'ticket', recordPage: null }).map((c) => c.id);
  assert.ok(!list.includes('theme:dark') && list.includes('theme:light') && list.includes('theme:system'));
  assert.ok(!list.includes('language:ar') && list.includes('language:en') && list.includes('language:auto'));
});

test('every command is a plain description the panel knows how to carry out, with an icon and a group', () => {
  const kinds = new Set(['screen', 'half', 'run', 'settings', 'theme', 'language']);
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  const seen = new Set();
  for (const c of list) {
    assert.ok(kinds.has(c.action.type), c.id);
    assert.ok(c.icon && c.label && groupLabel(c.group), c.id);
    assert.ok(!seen.has(c.id), `unique id ${c.id}`);
    seen.add(c.id);
  }
});

test('every AI action of the quick bar has its own icon', () => {
  for (const id of Object.keys(QUICK_LABELS)) assert.notEqual(featureIcon(id), 'spark', `${id} has an icon`);
  assert.equal(featureIcon('something-new'), 'spark');
  assert.ok(FEATURES.length > 0);
});

test('the commands follow the language: the same commands in Arabic', () => {
  try {
    setLanguage('ar');
    const list = buildCommands({ eff: eff({ language: 'ar' }), screens, active: 'ticket', recordPage: null });
    assert.match(list.find((c) => c.id === 'settings').label, /[؀-ۿ]/);
    assert.match(list.find((c) => c.id === 'go:team').label, /[؀-ۿ]/);
  } finally {
    setLanguage('en');
  }
});

// ---- the box ---------------------------------------------------------------------------------------------------------------------------

test('closed it draws nothing; open it is a modal dialog with a combobox and a listbox', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  assert.equal(renderToStaticMarkup(React.createElement(CommandPalette, { open: false, onClose() {}, commands: list, onRun() {} })), '');
  const html = renderToStaticMarkup(React.createElement(CommandPalette, { open: true, onClose() {}, commands: list, onRun() {} }));
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-activedescendant="[^"]+"/);
  assert.ok((html.match(/role="option"/g) || []).length >= list.length);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1, 'one command is highlighted');
  assert.match(html, /Go to/, 'the groups are named while nothing is typed');
});

test('the key that opens it is Ctrl+K or Cmd+K on the physical K key, on any layout, and nothing else', () => {
  assert.equal(isPaletteKey({ ctrlKey: true, code: 'KeyK', key: 'k' }), true);
  assert.equal(isPaletteKey({ metaKey: true, code: 'KeyK', key: 'k' }), true);
  assert.equal(isPaletteKey({ ctrlKey: true, code: 'KeyK', key: 'ن' }), true, 'an Arabic layout');
  assert.equal(isPaletteKey({ code: 'KeyK', key: 'k' }), false);
  assert.equal(isPaletteKey({ ctrlKey: true, shiftKey: true, code: 'KeyK' }), false);
  assert.equal(isPaletteKey({ ctrlKey: true, altKey: true, code: 'KeyK' }), false);
  assert.equal(isPaletteKey({ ctrlKey: true, code: 'KeyJ' }), false);
});

// ---- the colours -----------------------------------------------------------------------------------------------------------------------

test('theme: only light, dark or the computer; anything else in storage means the computer', () => {
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
  assert.equal(effectiveSettings({}, {}).values.theme, 'system');
  assert.equal(effectiveSettings({ theme: 'dark' }, {}).values.theme, 'dark');
  assert.equal(effectiveSettings({ theme: 'purple' }, {}).values.theme, 'system');
  assert.equal(themeAttribute('light'), 'light');
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute('system'), '');
  assert.equal(themeAttribute(undefined), '');
});

test('the sun and moon button goes to the colours that are not on screen, whatever the setting says', () => {
  assert.equal(nextTheme('light', true), 'dark');
  assert.equal(nextTheme('dark', false), 'light');
  assert.equal(nextTheme('system', true), 'light', 'the computer is dark, so dark is showing');
  assert.equal(nextTheme('system', false), 'dark');
});
