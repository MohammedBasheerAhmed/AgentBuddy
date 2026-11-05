import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRailStore, railShape } from '../src/sidepanel/shell/railStore.js';
import { SideRail, railItemName, goToSection } from '../src/sidepanel/shell/SideRail.jsx';
import { arrangeRail, assistDefaultOrder, cleanRailLayout, railPrefsFor, setRailPrefs } from '../src/features/railLayout.js';
import { DEFAULT_SETTINGS } from '../src/policy/policy.js';

// The side rail (2026-11-05 layout): the store between the screens and the shell, the rail itself (first render), and the person's
// arrangement of the Ticket screen's rail (Settings > Side rail). Clicking, the tip and the keyboard are covered in a real browser by
// the e2e scenarios.

const item = (id, more = {}) => ({ id, label: id.toUpperCase(), icon: 'link', ...more });

test('railShape keeps what the rail draws and nothing else: unknown marks are dropped, a handler is not part of the picture', () => {
  const shape = railShape({ title: 'Insights', items: [item('a', { attention: 'warn', onSelect() {} }), item('b', { attention: 'loud' }), { id: '', label: 'x' }, null] });
  assert.deepEqual(shape, {
    title: 'Insights',
    items: [
      { id: 'a', label: 'A', icon: 'link', attention: 'warn', ai: false, current: false, disabled: false, separator: false },
      { id: 'b', label: 'B', icon: 'link', attention: '', ai: false, current: false, disabled: false, separator: false },
    ],
  });
  assert.equal(railShape(null), null);
});

test('the store tells the shell only when the picture changed, and a click always runs the latest handler', () => {
  const store = createRailStore();
  let told = 0;
  store.subscribe(() => told++);
  const runs = [];
  store.publish('ticket', { title: 'Insights', items: [item('a', { onSelect: () => runs.push('first') })] });
  assert.equal(told, 1);
  store.publish('ticket', { title: 'Insights', items: [item('a', { onSelect: () => runs.push('second') })] });
  assert.equal(told, 1, 'a new handler alone is not a new picture');
  assert.equal(store.select('ticket', 'a'), true);
  assert.deepEqual(runs, ['second']);
  store.publish('ticket', { title: 'Insights', items: [item('a', { attention: 'danger' })] });
  assert.equal(told, 2);
  assert.equal(store.getSnapshot().ticket.items[0].attention, 'danger');
});

test('the store: a disabled item or an unknown one does nothing; an empty rail is no rail; clear takes it away', () => {
  const store = createRailStore();
  let ran = false;
  store.publish('team', { title: 'Team', items: [item('x', { disabled: true, onSelect: () => (ran = true) })] });
  assert.equal(store.select('team', 'x'), false);
  assert.equal(store.select('team', 'nope'), false);
  assert.equal(ran, false);
  store.publish('team', { title: 'Team', items: [] });
  assert.equal(store.getSnapshot().team, undefined);
  store.publish('team', { title: 'Team', items: [item('y')] });
  store.clear('team');
  assert.equal(store.getSnapshot().team, undefined);
});

test('the name of an item says what its marks say: AI, or that it needs a look', () => {
  assert.equal(railItemName({ label: 'Draft a reply', ai: true }), 'Draft a reply (AI)');
  assert.equal(railItemName({ label: 'SLA', attention: 'warn' }), 'SLA: needs a look');
  assert.equal(railItemName({ label: 'Outage' }), 'Outage');
});

const rail = { title: 'AI Assist', items: [railShape({ items: [item('suggested', { separator: false, current: true })] }).items[0], { ...railShape({ items: [item('reply-draft', { ai: true, separator: true })] }).items[0] }] };
const draw = (props = {}) => renderToStaticMarkup(React.createElement(SideRail, { rail, ...props }));

test('the rail: a navigation landmark named for the half, one tab stop, the item on show marked, names for every icon', () => {
  const markup = draw();
  assert.match(markup, /<nav class="ab-rail" aria-label="Side rail: AI Assist">/);
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1, 'one tab stop');
  assert.match(markup, /data-rail-id="suggested" tabindex="0" aria-current="true"/, 'the tab stop is the item on show');
  assert.match(markup, /aria-label="REPLY-DRAFT \(AI\)"/);
  assert.match(markup, /class="ab-rail-rule"/, 'the line under the first item');
  assert.match(markup, /aria-expanded="false" aria-label="Show names"/);
  assert.ok(!markup.includes('class="ab-rail-name"'), 'no names until they are asked for');
  assert.ok(!markup.includes('ab-ai-badge'), 'no AI mark on an icon (the page dock lost its corner marks too): the name says it');
});

test('the rail with its names: wide, each name drawn, the AI mark beside an AI action\'s name, and the way back', () => {
  const markup = draw({ names: true });
  assert.match(markup, /<nav class="ab-rail is-wide"/);
  assert.match(markup, /class="ab-rail-name" aria-hidden="true">REPLY-DRAFT</);
  assert.equal((markup.match(/class="ab-ai-badge"/g) || []).length, 1);
  assert.match(markup, /aria-expanded="true" aria-label="Hide names"/);
});

test('a rail with nothing in it is not drawn', () => {
  assert.equal(renderToStaticMarkup(React.createElement(SideRail, { rail: { title: 'x', items: [] } })), '');
});

test('goToSection opens a folded section first, then brings it into view and focuses its heading', () => {
  const calls = [];
  const heading = { hasAttribute: () => false, setAttribute: (k, v) => calls.push(`attr ${k}=${v}`), focus: () => calls.push('focus') };
  const el = { matches: () => false, querySelector: (sel) => (sel === '.ab-cardx-toggle' ? null : heading), scrollIntoView: (o) => calls.push(`scroll ${o.behavior}`) };
  const win = { matchMedia: () => ({ matches: true }), setTimeout: (fn) => fn() };
  goToSection({ el, open: () => calls.push('open') }, win);
  assert.deepEqual(calls, ['open', 'scroll auto', 'attr tabindex=-1', 'focus']);
});

test('railLayout: the person\'s order first (only what the record offers), then the rest in the default order; hidden left out', () => {
  const ids = ['sla', 'related', 'knowledge', 'outage'];
  assert.deepEqual(arrangeRail(ids, {}).shown, ids);
  const got = arrangeRail(ids, { order: ['outage', 'gone', 'related'], hidden: ['knowledge'] });
  assert.deepEqual(got.shown, ['outage', 'related', 'sla']);
  assert.deepEqual(got.hidden, ['knowledge']);
  assert.deepEqual(got.all.map((x) => `${x.id}${x.hidden ? '-' : ''}`), ['outage', 'related', 'sla', 'knowledge-']);
});

test('railLayout: the AI actions follow the ticket\'s state unless that is switched off', () => {
  const ids = ['record-summary', 'reply-draft', 'resolution-notes', 'kb-article-draft', 'handoff-brief'];
  assert.deepEqual(assistDefaultOrder(ids, { kind: 'incident', stage: 'resolve' }).slice(0, 2), ['resolution-notes', 'kb-article-draft']);
  assert.deepEqual(assistDefaultOrder(ids, { kind: 'incident', stage: 'resolve', byState: false }), ids);
  assert.equal(assistDefaultOrder(ids, { kind: 'incident' }).length, ids.length, 'nothing lost, nothing added');
});

test('railLayout: setting, reading back and cleaning a stored layout', () => {
  let layout = setRailPrefs({}, 'incident', 'assist', { order: ['reply-draft'], hidden: ['handoff-brief'] });
  assert.deepEqual(railPrefsFor(layout, 'incident', 'assist'), { order: ['reply-draft'], hidden: ['handoff-brief'], arranged: true });
  assert.deepEqual(railPrefsFor(layout, 'incident', 'insights'), { order: [], hidden: [], arranged: false });
  layout = setRailPrefs(layout, 'incident', 'assist', null);
  assert.deepEqual(layout, {}, 'back to the defaults leaves nothing behind');
  assert.deepEqual(cleanRailLayout({ incident: { insights: { order: ['a', 'a', 3, 'b'] }, other: { order: ['x'] } }, bad: 'x', change: [] }), {
    incident: { insights: { order: ['a', 'b'], hidden: [] } },
  });
  assert.deepEqual(cleanRailLayout('nonsense'), {});
});

test('the settings know the rail: names hidden, nothing arranged, the AI actions following the ticket\'s state', () => {
  assert.equal(DEFAULT_SETTINGS.railNames, false);
  assert.deepEqual(DEFAULT_SETTINGS.railLayout, {});
  assert.equal(DEFAULT_SETTINGS.railByState, true);
});

test('every Insights card has its own icon in the set, and none of them is the AI spark', async () => {
  const { INSIGHT_CARDS } = await import('../src/sidepanel/ticket/cards/index.js');
  const { cardIcon } = await import('../src/sidepanel/ui/featureIcons.js');
  const { PATHS } = await import('../src/sidepanel/ui/iconPaths.js');
  const icons = INSIGHT_CARDS.map((c) => cardIcon(c.id));
  for (const [i, name] of icons.entries()) {
    assert.notEqual(name, 'chevronRight', `${INSIGHT_CARDS[i].id} has an icon of its own`);
    assert.equal(typeof PATHS[name], 'string', `${INSIGHT_CARDS[i].id}: ${name} can be drawn`);
  }
});

test('goToSection on a card puts the focus on its fold button (its own title, a real control), and adds no tabindex', () => {
  const calls = [];
  const toggle = { hasAttribute: () => false, setAttribute: () => calls.push('attr'), focus: () => calls.push('focus toggle') };
  const el = { matches: () => false, querySelector: (sel) => (sel === '.ab-cardx-toggle' ? toggle : null), scrollIntoView: () => calls.push('scroll') };
  goToSection({ el }, { matchMedia: () => ({ matches: false }), setTimeout: (fn) => fn() });
  assert.deepEqual(calls, ['scroll', 'focus toggle']);
});
