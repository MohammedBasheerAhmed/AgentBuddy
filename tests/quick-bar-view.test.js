import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuickBar from '../src/sidepanel/QuickBar.jsx';
import { featuresFor } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';

globalThis.React = React;

// First render only (effects do not run in a static render): the structure, the labels and the states. Clicking and saving are
// covered in a real browser by e2e scenario x.
const eff = (values = {}, policy = {}) => ({ ready: true, values: { quickBarOpen: true, quickPins: {}, ...values }, locked: {}, policy: normalizePolicy(policy) });
const html = (props = {}) => {
  const kind = props.kind || 'incident';
  return renderToStaticMarkup(React.createElement(QuickBar, { kind, features: featuresFor(kind, normalizePolicy(props.policy || {})), eff: eff(props.values, props.policy), disabled: false, onRun: () => {}, ...props.over }));
};

// Round 3: the bar holds no filled button (the screen's one primary is the first AI Assist suggestion), and every AI item is marked.
const labels = (markup) => [...markup.matchAll(/<button[^>]*data-quick="[^"]+"[^>]*>.*?<span class="ab-quick-label">([^<]*)/g)].map((m) => m[1]);

test('open: the three main actions of an incident, each with the AI mark, none filled, a toggle that says it is open', () => {
  const markup = html();
  assert.deepEqual(labels(markup), ['Summarise', 'Draft a reply', 'Resolution notes']);
  assert.match(markup, /aria-expanded="true"/);
  assert.equal((markup.match(/ab-btn-primary/g) || []).length, 0);
  assert.equal((markup.match(/class="ab-ai-badge"/g) || []).length, 3);
  assert.match(markup, /aria-label="Summarise \(AI\)"/);
  assert.match(markup, />Choose</);
});

// `cards` are INSIGHT_CARDS ids: "Ready to resolve?" is the card 'resolve' (audit P2.4: these tests used to pass 'ready', a card that
// does not exist, so they passed while the real bar never showed the item).
test('state-aware: a resolved incident offers "Ready to resolve?" (Insights, no AI mark) first, then the resolution notes', () => {
  const markup = html({ over: { stage: 'resolve', cards: ['resolve', 'related'], onShowCard: () => {} } });
  assert.deepEqual(labels(markup), ['Ready to resolve?', 'Resolution notes', 'Knowledge article', 'Draft a reply']);
  assert.match(markup, /data-quick="card:ready" class="ab-btn ab-quick-tile ab-quick-insight"/);
  assert.equal((markup.match(/class="ab-ai-badge"/g) || []).length, 3, 'only the AI items carry the mark');
});

test('a new incident: understand it and route it; a card the screen does not have is not offered', () => {
  const markup = html({ over: { stage: 'new', cards: ['related'], onShowCard: () => {} } });
  assert.deepEqual(labels(markup), ['Summarise', 'What is missing?', 'Where should this go?', 'Related tickets']);
  assert.ok(!markup.includes('Ready to resolve?'));
});

test('AI not usable now: only the Insights items stay, and they stay usable while an answer is on its way', () => {
  const markup = html({ over: { stage: 'resolve', cards: ['resolve', 'related'], onShowCard: () => {}, aiReady: false, disabled: true } });
  assert.deepEqual(labels(markup), ['Ready to resolve?', 'Related tickets']);
  assert.ok(!/ab-ai-badge/.test(markup));
  assert.ok(!/disabled=""/.test(markup));
});

test('Insights items need the shell to open a card: without onShowCard there are none', () => {
  const markup = html({ over: { stage: 'resolve', cards: ['resolve'] } });
  assert.ok(!markup.includes('Ready to resolve?'));
});

test('folded: only the strip, no action buttons', () => {
  const markup = html({ values: { quickBarOpen: false } });
  assert.match(markup, /aria-expanded="false"/);
  assert.ok(!markup.includes('>Summarise<'));
  assert.ok(!markup.includes('>Choose<'));
});

test('the toggle names the region it controls', () => {
  const markup = html();
  const controls = /aria-controls="([^"]+)"/.exec(markup)?.[1];
  assert.ok(controls);
  assert.ok(markup.includes(`id="${controls}"`));
});

test('the person\'s pins decide what shows, in their order', () => {
  const markup = html({ values: { quickPins: { incident: ['handoff-brief', 'record-summary'] } } });
  assert.ok(markup.indexOf('>Hand-off brief<') < markup.indexOf('>Summarise<'));
  assert.ok(!markup.includes('>Draft a reply<'));
});

test('an action the policy switched off is not shown', () => {
  const markup = html({ policy: { disabledFeatures: ['reply-draft'] } });
  assert.ok(!markup.includes('>Draft a reply<'));
  assert.ok(markup.includes('>Summarise<'));
});

test('buttons are off while the AI is not ready or an answer is on screen', () => {
  const markup = html({ over: { disabled: true } });
  assert.equal((markup.match(/<button[^>]*class="ab-btn [^"]*ab-quick-tile[^"]*"[^>]*disabled=""/g) || []).length, 3);
});

test('another kind of record has its own defaults', () => {
  const markup = html({ kind: 'change' });
  assert.ok(markup.includes('>CAB brief<'));
  assert.ok(!markup.includes('>Resolution notes<'));
});

test('it shows only what the Actions list offers (an action that is not there is not a button)', () => {
  const markup = html({ over: { features: featuresFor('incident', normalizePolicy({})).filter((f) => f.id !== 'reply-draft') } });
  assert.ok(!markup.includes('>Draft a reply<'));
});

test('nothing to show: it renders nothing', () => {
  assert.equal(html({ over: { features: [] } }), '');
});
