// The result card (ResultView) asks the open page before it offers Insert, as the answer cards do (audit of 2026-11-07, S4):
// a box the page cannot offer turns Insert off, drops the card's filled button and says why in one plain line.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResultView from '../src/sidepanel/ResultView.jsx';
import { applyFieldStates, insertButtonView, insertTargets } from '../src/sidepanel/insertFlow.js';
import { featureById } from '../src/features/registry.js';

const feature = featureById('reply-draft');
const page = { tabId: 1, href: 'https://x.service-now.com/now/sow/record/incident/' + 'a'.repeat(32), surface: 'workspace', record: { table: 'incident', sysId: 'a'.repeat(32), kind: 'incident' } };
const targets = () => insertTargets(feature, { record: page.record, page });

test('before any answer from the page nothing is blocked and the first Insert leads, as before', () => {
  const probed = applyFieldStates(targets(), null);
  const first = probed[0];
  const view = insertButtonView(probed, first.spec, 0, false);
  assert.equal(view.blocked, '');
  assert.equal(view.lead, true);
});

test('a Workspace page with no usable box: Insert is off, Copy leads, one plain line says why', () => {
  const base = targets();
  const fields = Object.fromEntries(base.map((item) => [item.field, { state: 'unknown', gap: 'absent' }]));
  const probed = applyFieldStates(base, { known: true, form: 'workspace', fields });
  const view = insertButtonView(probed, probed[0].spec, 0, false);
  assert.ok(view.blocked, 'a reason is given');
  assert.equal(view.lead, false);
  assert.doesNotMatch(view.blocked, /_|\bACL\b|\b40\d\b/);
});

test('a feature that leads with Copy never fills its Insert', () => {
  const probed = applyFieldStates(targets(), null);
  assert.equal(insertButtonView(probed, probed[0].spec, 0, true).lead, false);
});

test('a card for an insert nobody has probed (a spec the targets do not know) is never blocked', () => {
  assert.deepEqual(insertButtonView([], { field: 'x' }, 1, false), { blocked: '', lead: false });
});

test('the card still renders: the first Insert is the filled button and no blocked line shows before the page has answered', () => {
  const html = renderToStaticMarkup(React.createElement(ResultView, { feature, text: 'We restarted the gateway.', page, people: [], scan: null, onClose() {}, audit() {} }));
  assert.match(html, /ab-btn ab-btn-primary/);
  assert.doesNotMatch(html, /Copy and paste\./);
});
