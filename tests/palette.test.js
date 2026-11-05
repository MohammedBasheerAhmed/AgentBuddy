import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fold, groupCommands, rankCommands } from '../src/sidepanel/palette/search.js';
import { GROUPS, buildCommands, cardHint, groupLabel } from '../src/sidepanel/palette/commands.js';
import CommandPalette, { isPaletteKey } from '../src/sidepanel/palette/CommandPalette.jsx';
import { THEMES, nextTheme, themeAttribute } from '../src/ui/useTheme.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { cardIcon, featureIcon } from '../src/sidepanel/ui/featureIcons.js';
import { setLanguage } from '../src/i18n/index.js';
import { FEATURES } from '../src/features/registry.js';
import { QUICK_CARDS, QUICK_LABELS } from '../src/features/quick.js';
import { PAIN_POINTS, focusActions, focusCards, painOfCard } from '../src/features/focus.js';
import { cardsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { offeredFeatures } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { FEATURE_ID_RE, makeLaunch } from '../src/lib/launch.js';
import { shareTicketHeader, sharedOfferedIds, sharedTicketHeader } from '../src/sidepanel/palette/allToolsContext.js';

// All tools (src/sidepanel/palette, docs/focus-layout.md part C): the search, the commands built for what is on screen, and the sheet
// as drawn. The sheet as used (keys, typing, opening at a group) is in tests/palette-panel.test.js.

const eff = (values = {}, policy = {}) => ({ ready: true, ...effectiveSettings(values, policy) });
const incident = { table: 'incident', sysId: 'a'.repeat(32), kind: 'incident' };
const recordPage = { tabId: 7, record: incident };
const screens = [{ id: 'ticket', label: 'Ticket' }, { id: 'mywork', label: 'My work' }, { id: 'team', label: 'Team' }];
const ids = (list) => list.map((c) => c.id);
const inGroup = (list, group) => list.filter((c) => c.group === group);

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

test('groupCommands: the headings stay while typing; a search keeps what matches inside each group, ranked, and drops empty groups', () => {
  const list = [
    { id: 'i1', label: 'Related tickets', group: 'ticket-insights' },
    { id: 'a1', label: 'Write a hand-off brief', group: 'ticket-assist' },
    { id: 'a2', label: 'Draft a closing email', hint: 'Says the resolution and asks to confirm', group: 'ticket-assist' },
    { id: 'a3', label: 'Email: resolution', group: 'ticket-assist' },
    { id: 'g1', label: 'Go to Team', group: 'go' },
    { id: 'p1', label: 'Use dark colours', group: 'panel' },
  ];
  const all = groupCommands(list, '');
  assert.deepEqual(all.map((g) => g.group), ['ticket-insights', 'ticket-assist', 'go', 'panel']);
  assert.deepEqual(all.flatMap((g) => g.items.map((c) => c.id)), ids(list), 'nothing typed: everything in its order');
  const found = groupCommands(list, 'resolution');
  assert.deepEqual(found.map((g) => g.group), ['ticket-assist'], 'only the group with a match keeps its heading');
  assert.deepEqual(found[0].items.map((c) => c.id), ['a3', 'a2'], 'ranked inside the group: the label before the line under it');
  // A better match further down does not pull its group above the groups before it: "team" is the best match, its group stays third.
  const mixed = groupCommands(list, 'te');
  assert.deepEqual(mixed.map((g) => g.group), ['ticket-insights', 'ticket-assist', 'go']);
  assert.equal(rankCommands(list, 'te')[0].id, 'g1');
  assert.deepEqual(groupCommands(list, 'zzz'), []);
  // No limit: a long group never pushes the last group out.
  const many = [...Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, label: `Tool ${i}`, group: 'ticket-assist' })), { id: 'last', label: 'Open Settings', group: 'panel' }];
  assert.equal(groupCommands(many, '').at(-1).items[0].id, 'last');
});

// ---- the commands ----------------------------------------------------------------------------------------------------------------------

test('without a record: Go to and Panel only; nothing to run', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'mywork', recordPage: null });
  assert.deepEqual([...new Set(list.map((c) => c.group))], ['go', 'panel']);
  assert.deepEqual(ids(inGroup(list, 'go')), ['go:ticket', 'go:mywork', 'go:team']);
  assert.ok(ids(list).includes('settings'));
  assert.ok(!list.some((c) => c.action.type === 'run'), 'nothing to run without a record');
  assert.ok(!ids(list).includes('half:assist'), 'My work has only one half');
});

test('All tools offers what the record offers with its header: the major incident updates only once the header says priority 1', () => {
  const titled = (list) => ids(list).includes('run:major-incident-comms');
  const it = eff({ profiles: ['it', 'mpc'], profilesConfirmed: true }); // the major incident profile has the action
  assert.equal(titled(buildCommands({ eff: it, screens, active: 'ticket', recordPage })), false, 'no header yet: not known to be a major incident');
  assert.equal(titled(buildCommands({ eff: it, screens, active: 'ticket', recordPage, header: { priority: '2 - High', state: 'In Progress' } })), false);
  assert.equal(titled(buildCommands({ eff: it, screens, active: 'ticket', recordPage, header: { priority: '1 - Critical', state: 'In Progress' } })), true);
});

test('All tools offers only the actions the Ticket screen offers when it has said (one may need a read first: the checklist)', () => {
  const ai = (list) => ids(inGroup(list, 'ticket-assist')).filter((id) => id !== 'run:ask:ticket');
  const all = ai(buildCommands({ eff: eff(), screens, active: 'ticket', recordPage }));
  assert.ok(all.includes('run:handoff-brief'), 'nothing said: what the record allows');
  const some = ai(buildCommands({ eff: eff(), screens, active: 'ticket', recordPage, offered: ['record-summary', 'handoff-brief'] }));
  assert.deepEqual(some, ['run:handoff-brief'], 'the screen offers summary (one of the five) and the hand-off brief: only that one is beyond the five');
  shareTicketHeader('incident:' + 'a'.repeat(32), null, ['handoff-brief']);
  assert.deepEqual(sharedOfferedIds('incident:' + 'a'.repeat(32)), ['handoff-brief']);
  assert.equal(sharedOfferedIds('incident:' + 'b'.repeat(32)), null);
  shareTicketHeader('', null);
});

test('the Ticket screen hands its header to All tools for that record only', () => {
  shareTicketHeader('incident:' + 'a'.repeat(32), { priority: '1 - Critical' });
  assert.deepEqual(sharedTicketHeader('incident:' + 'a'.repeat(32)), { priority: '1 - Critical' });
  assert.equal(sharedTicketHeader('incident:' + 'b'.repeat(32)), null, 'another record: nothing');
  assert.equal(sharedTicketHeader(''), null);
  shareTicketHeader('incident:' + 'a'.repeat(32), null);
  assert.equal(sharedTicketHeader('incident:' + 'a'.repeat(32)), null, 'still being read');
});

test('on the Ticket screen with a record: four groups in order, "More for this ticket" first', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  assert.deepEqual([...new Set(list.map((c) => c.group))], GROUPS);
  assert.deepEqual(GROUPS, ['ticket-insights', 'ticket-assist', 'go', 'panel']);
  // The groups never interleave: each is one run of the list.
  const runs = list.map((c) => c.group).filter((g, i, all) => g !== all[i - 1]);
  assert.deepEqual(runs, GROUPS);
  assert.ok(list.some((c) => c.id === 'half:assist') && list.some((c) => c.id === 'half:insights'));
});

test('"More for this ticket: Insights": the record\'s cards beyond the five, each with its title, its line, its icon and a show: launch', () => {
  const e = eff();
  const list = inGroup(buildCommands({ eff: e, screens, active: 'ticket', recordPage }), 'ticket-insights');
  const rest = focusCards(cardsFor(INSIGHT_CARDS, incident, null, e)).rest;
  assert.ok(rest.length > 0);
  assert.deepEqual(ids(list), rest.map((c) => `run:show:${c.id}`), 'the rest, in the order the Ticket screen has them');
  for (const c of list) {
    const id = c.id.slice('run:show:'.length);
    assert.equal(c.label, INSIGHT_CARDS.find((x) => x.id === id).title);
    assert.equal(c.hint, cardHint(id));
    assert.ok(c.hint, `${id} says what it shows`);
    assert.equal(c.icon, cardIcon(id));
    assert.notEqual(c.ai, true, 'a card sends nothing: no AI mark');
    assert.deepEqual(c.action, { type: 'run', featureId: `show:${id}` });
    assert.equal(painOfCard(id), '', 'none of the five');
  }
  assert.ok(!list.some((c) => c.id === 'run:show:resolve' || c.id === 'run:show:email'), 'the five stay on the Ticket screen');
});

test('"More for this ticket: AI Assist": Ask about this ticket first, then the offered actions beyond the five, with the AI mark', () => {
  const e = eff();
  const list = inGroup(buildCommands({ eff: e, screens, active: 'ticket', recordPage }), 'ticket-assist');
  assert.equal(list[0].id, 'run:ask:ticket');
  assert.deepEqual(list[0].action, { type: 'run', featureId: 'ask:ticket' });
  assert.equal(list[0].label, 'Ask about this ticket');
  assert.ok(list[0].hint && list[0].ai);
  const { five, rest } = focusActions(offeredFeatures({ record: incident, header: null, eff: e }).map((feature) => ({ feature })));
  assert.deepEqual(ids(list.slice(1)), rest.map((it) => `run:${it.feature.id}`));
  for (const c of list.slice(1)) {
    const f = rest.find((it) => `run:${it.feature.id}` === c.id).feature;
    assert.equal(c.label, f.title);
    assert.equal(c.hint, f.description);
    assert.equal(c.icon, featureIcon(f.id));
    assert.equal(c.ai, true);
    assert.deepEqual(c.action, { type: 'run', featureId: f.id });
  }
  for (const { item } of five) assert.ok(!list.some((c) => c.id === `run:${item.feature.id}`), `${item.feature.id} is one of the five`);
});

test('every launch All tools sends is one the panel accepts (show:, ask: and feature ids), and no QUICK_CARDS entry is left', () => {
  const list = buildCommands({ eff: eff({ showEverything: true }), screens, active: 'ticket', recordPage });
  const runs = list.filter((c) => c.action.type === 'run');
  assert.ok(runs.length > 10);
  for (const c of runs) {
    assert.match(c.action.featureId, FEATURE_ID_RE, c.id);
    assert.ok(makeLaunch({ tabId: 7, table: 'incident', sysId: incident.sysId, featureId: c.action.featureId, now: 1 }), c.id);
    assert.equal(c.id, `run:${c.action.featureId}`, 'the command id is the launch it sends');
  }
  for (const id of Object.keys(QUICK_CARDS)) assert.ok(!ids(list).includes(`run:${id}`), `${id}: its card is in "More for this ticket" or among the five`);
});

test('on another screen, even with a record behind it: Go to and Panel only', () => {
  for (const active of ['mywork', 'team']) {
    const list = buildCommands({ eff: eff(), screens, active, recordPage });
    assert.deepEqual([...new Set(list.map((c) => c.group))], ['go', 'panel'], active);
  }
});

test('AI switched off by the organisation: no AI Assist group and no AI Assist half; the record\'s other Insights are still there', () => {
  const list = buildCommands({ eff: eff({}, { aiEnabled: false }), screens, active: 'ticket', recordPage });
  assert.ok(!list.some((c) => c.ai));
  assert.equal(inGroup(list, 'ticket-assist').length, 0);
  assert.ok(!list.some((c) => c.id === 'half:assist'));
  assert.ok(inGroup(list, 'ticket-insights').length > 0, 'Insights still works');
});

test('"Ask about this ticket" follows the question box: not when the organisation switched it off or the record may not go to an AI', () => {
  const off = buildCommands({ eff: eff({}, { disabledFeatures: ['ask-ticket'] }), screens, active: 'ticket', recordPage });
  assert.ok(!ids(off).includes('run:ask:ticket'));
  assert.ok(inGroup(off, 'ticket-assist').length > 0, 'the other actions stay');
  const blocked = buildCommands({ eff: eff({}, { blockedTables: ['incident'] }), screens, active: 'ticket', recordPage });
  assert.ok(!ids(blocked).includes('run:ask:ticket'));
});

test('every Insights card that is not among the five has its line in All tools, in English and in Arabic', () => {
  const rest = INSIGHT_CARDS.filter((c) => !painOfCard(c.id));
  assert.ok(rest.length >= 7);
  for (const c of rest) assert.ok(cardHint(c.id).length > 10 && cardHint(c.id).length <= 64, `${c.id}: "${cardHint(c.id)}" (short)`);
  // Every card id the five name is a real card (a typo would leave a card nowhere).
  for (const p of PAIN_POINTS) for (const id of p.cards) assert.ok(INSIGHT_CARDS.some((c) => c.id === id) || id === 'caller', `${p.id}: ${id}`);
  assert.equal(cardHint('nothing-like-this'), '');
  try {
    setLanguage('ar');
    for (const c of rest) assert.match(cardHint(c.id), /[؀-ۿ]/, c.id);
  } finally {
    setLanguage('en');
  }
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
    assert.ok(GROUPS.includes(c.group), c.id);
    assert.ok(!seen.has(c.id), `unique id ${c.id}`);
    seen.add(c.id);
  }
});

test('every AI action of the quick bar has its own icon', () => {
  for (const id of Object.keys(QUICK_LABELS)) assert.notEqual(featureIcon(id), 'spark', `${id} has an icon`);
  assert.equal(featureIcon('something-new'), 'spark');
  assert.ok(FEATURES.length > 0);
});

test('the commands and the group headings follow the language', () => {
  try {
    setLanguage('ar');
    const list = buildCommands({ eff: eff({ language: 'ar' }), screens, active: 'ticket', recordPage });
    assert.match(list.find((c) => c.id === 'settings').label, /[؀-ۿ]/);
    assert.match(list.find((c) => c.id === 'go:team').label, /[؀-ۿ]/);
    assert.match(list.find((c) => c.id === 'run:ask:ticket').label, /[؀-ۿ]/);
    for (const g of GROUPS) assert.match(groupLabel(g), /[؀-ۿ]/, g);
  } finally {
    setLanguage('en');
  }
  assert.equal(groupLabel('ticket-insights'), 'More for this ticket: Insights');
  assert.equal(groupLabel('ticket-assist'), 'More for this ticket: AI Assist');
  assert.equal(groupLabel('nothing'), '');
});

// ---- the sheet as drawn ------------------------------------------------------------------------------------------------------------------

const drawSheet = (props) => renderToStaticMarkup(React.createElement(CommandPalette, { open: true, onClose() {}, onRun() {}, ...props }));
const selected = (html) => [...html.matchAll(/aria-selected="true" data-command="([^"]+)"/g)].map((m) => m[1]);

test('closed it draws nothing; open it is a modal dialog named All tools, a combobox over a listbox, the groups named', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  assert.equal(renderToStaticMarkup(React.createElement(CommandPalette, { open: false, onClose() {}, commands: list, onRun() {} })), '');
  const html = drawSheet({ commands: list });
  assert.match(html, /role="dialog" aria-modal="true" aria-label="All tools"/);
  assert.match(html, /role="combobox"[^>]*aria-label="Find a tool" placeholder="Find a tool…"/);
  assert.match(html, /role="listbox" aria-label="All tools"/);
  assert.match(html, /aria-activedescendant="[^"]+"/);
  assert.equal((html.match(/role="option"/g) || []).length, list.length);
  assert.deepEqual(selected(html), [list[0].id], 'one tool is highlighted: the first');
  const groups = [...html.matchAll(/role="group" aria-label="([^"]+)" data-group="([^"]+)"/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(groups, GROUPS.map((g) => [g, groupLabel(g)]));
  for (const g of GROUPS) assert.ok(html.includes(`<div class="ab-palette-group" aria-hidden="true">${groupLabel(g)}</div>`), g);
  assert.match(html, /<button type="button" class="ab-iconbtn ab-palette-close" tabindex="-1" aria-label="Close All tools"/, 'a way out for the pointer');
});

test('opened at a group: that group\'s first tool is the highlighted one; a group the record does not have starts at the top', () => {
  const list = buildCommands({ eff: eff(), screens, active: 'ticket', recordPage });
  assert.deepEqual(selected(drawSheet({ commands: list, section: 'ticket-assist' })), ['run:ask:ticket']);
  assert.deepEqual(selected(drawSheet({ commands: list, section: 'ticket-insights' })), [inGroup(list, 'ticket-insights')[0].id]);
  const elsewhere = buildCommands({ eff: eff(), screens, active: 'team', recordPage });
  assert.deepEqual(selected(drawSheet({ commands: elsewhere, section: 'ticket-insights' })), [elsewhere[0].id]);
  assert.deepEqual(selected(drawSheet({ commands: [], section: 'ticket-insights' })), []);
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

test('the sheet covers the panel under the header, full width, and only its list scrolls (no sideways scroll at 320 px)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'areas', 'palette.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => (css.match(new RegExp(`(?:^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
  assert.match(rule('.ab-palette-backdrop'), /position: fixed;/);
  assert.match(rule('.ab-palette-backdrop'), /inset-block: var\(--ab-head-h\) 0;/, 'under the header, to the bottom');
  assert.match(rule('.ab-palette-backdrop'), /inset-inline: 0;/, 'the full width');
  assert.ok(!/max-width/.test(rule('.ab-palette')), 'not a small box any more');
  assert.match(rule('.ab-palette-list'), /overflow-x: hidden;/);
  assert.match(rule('.ab-palette-list'), /overflow-y: auto;/);
  assert.match(rule('.ab-palette-label'), /text-overflow: ellipsis;/, 'a long name is cut, never wider than the panel');
  assert.ok(!/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right):/.test(css), 'logical properties only (Arabic is right to left)');
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

test('nextTheme goes to the colours that are not on screen, whatever the setting says', () => {
  assert.equal(nextTheme('light', true), 'dark');
  assert.equal(nextTheme('dark', false), 'light');
  assert.equal(nextTheme('system', true), 'light', 'the computer is dark, so dark is showing');
  assert.equal(nextTheme('system', false), 'dark');
});
