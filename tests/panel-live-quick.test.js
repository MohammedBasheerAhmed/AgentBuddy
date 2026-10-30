import { mount, click, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import QuickBar from '../src/sidepanel/QuickBar.jsx';
import { featuresFor } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';

// The quick-actions bar saves the person's choices in the settings; the saved settings come back to the panel a moment later. Two
// changes made in that moment (two ticks in "Choose", a fold and a tick) must both count: the second used to start from the old
// settings and silently undo the first.

const eff = (values = {}) => ({ ready: true, values: { quickBarOpen: true, quickPins: {}, ...values }, locked: {}, policy: normalizePolicy({}) });
const saved = (fake) => fake.chrome.storage.local.data[SETTINGS_KEY] || {};

test('two quick ticks in "Choose" are both saved (the second does not undo the first)', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ui = await mount(<QuickBar kind="incident" features={featuresFor('incident', normalizePolicy({}))} eff={eff()} disabled={false} onRun={() => {}} />);
  await click(ui.button('Choose'));
  const box = (label) => ui.$$('label.ab-check').find((l) => l.textContent.trim() === label).querySelector('input');
  // The defaults for an incident are Summarise, Draft a reply, Resolution notes. Add one, then take one away: before the panel's
  // settings come back (the eff prop above never changes in this test, as when storage is slow to answer).
  await click(box('Hand-off brief'));
  await click(box('Draft a reply'));
  assert.deepEqual(saved(fake).quickPins?.incident, ['record-summary', 'resolution-notes', 'handoff-brief']);
  assert.equal(box('Hand-off brief').checked, true, 'what the person ticked shows at once');
  assert.equal(box('Draft a reply').checked, false);
  await click(ui.button('Done'));
  assert.deepEqual(ui.$$('.ab-quick-actions button').map((b) => b.textContent), ['Summarise', 'Resolution notes', 'Hand-off brief']);
  await ui.unmount();
});

test('folding the bar shows at once and is saved; the bar marks each action so the focus can come back to it', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ui = await mount(<QuickBar kind="incident" features={featuresFor('incident', normalizePolicy({}))} eff={eff()} disabled={false} onRun={() => {}} />);
  assert.equal(ui.$('[data-quick="record-summary"]').textContent, 'Summarise');
  await click(ui.button('Quick actions'));
  assert.equal(ui.$('.ab-quick-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(saved(fake).quickBarOpen, false);
  await ui.unmount();
});

test('a choice that cannot be saved says so instead of pretending', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.storage.local.set = async () => {
    throw new Error('QUOTA_BYTES quota exceeded');
  };
  const ui = await mount(<QuickBar kind="incident" features={featuresFor('incident', normalizePolicy({}))} eff={eff()} disabled={false} onRun={() => {}} />);
  await click(ui.button('Choose'));
  const box = ui.$$('label.ab-check').find((l) => l.textContent.trim() === 'Hand-off brief').querySelector('input');
  await click(box);
  assert.match(ui.text(), /could not save that choice/);
  assert.equal(box.checked, false, 'the bar shows what is really saved');
  await ui.unmount();
});
