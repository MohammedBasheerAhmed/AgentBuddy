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

test('open: the three main actions of an incident, the first one highlighted, a toggle that says it is open', () => {
  const markup = html();
  for (const label of ['Summarise', 'Draft a reply', 'Resolution notes']) assert.ok(markup.includes(`>${label}</button>`), label);
  assert.match(markup, /aria-expanded="true"/);
  assert.equal((markup.match(/ab-btn-primary/g) || []).length, 1);
  assert.match(markup, />Choose</);
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
  assert.equal((markup.match(/<button[^>]*class="ab-btn ab-btn-sm[^"]*"[^>]*disabled=""/g) || []).length, 3);
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
