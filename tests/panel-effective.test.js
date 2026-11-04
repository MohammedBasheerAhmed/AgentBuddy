import { mount, settle, during, deferred, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useEffective } from '../src/sidepanel/useEffective.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { AUDIT_KEY } from '../src/audit/auditLog.js';
import { KEY_CHANGED_KEY, KEY_SLOT_PREFIX } from '../src/lib/keyStore.js';
import { LAUNCH_KEY } from '../src/lib/launch.js';

// The panel's settings (useEffective) follow chrome.storage: only a change to what they are made of reloads them (the same filter as
// the Settings page, src/lib/settingsChanges.js, tested in tests/options-page.test.js), and of two reloads that overlap the newer
// one wins (audit P2.9).

function Probe() {
  const eff = useEffective();
  return <p>{eff.ready ? `theme ${eff.values.theme}, key ${eff.apiKey ? 'yes' : 'no'}` : 'loading'}</p>;
}

/** A fake chrome whose settings reads are counted, and the next one can be held back. */
function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const area = fake.chrome.storage.local;
  const plainGet = area.get;
  const counted = { settings: 0, hold: null };
  area.get = (keys) => {
    const answer = plainGet(keys); // what is stored now
    if (keys !== SETTINGS_KEY) return answer;
    counted.settings += 1;
    const hold = counted.hold;
    counted.hold = null;
    return hold ? hold.promise.then(() => answer) : answer;
  };
  return { fake, counted };
}

test('only a change to the settings or the key reloads them: an activity log entry or the bar\'s request does not', async () => {
  const { fake, counted } = setup();
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { theme: 'light' } });
  const ui = await mount(<Probe />);
  try {
    assert.match(ui.text(), /theme light, key no/);
    const reads = counted.settings;
    await during(() => fake.chrome.storage.local.set({ [AUDIT_KEY]: [{ event: 'run' }] }));
    await during(() => fake.chrome.storage.session.set({ [LAUNCH_KEY]: { tabId: 7 } }));
    assert.equal(counted.settings, reads, 'nothing read again');
    await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { theme: 'dark' } }));
    assert.equal(counted.settings, reads + 1);
    assert.match(ui.text(), /theme dark/);
    await during(() => fake.chrome.storage.session.set({ [`${KEY_SLOT_PREFIX}anthropic`]: 'sk-ant-test-0123456789' }));
    assert.match(ui.text(), /key yes/, 'a key put in memory (Settings, or the passphrase entered) shows at once');
    const before = counted.settings;
    await during(() => fake.chrome.storage.local.set({ [KEY_CHANGED_KEY]: Date.now() }));
    assert.equal(counted.settings, before + 1, 'the key vault changed: read again');
  } finally {
    await ui.unmount();
  }
});

test('two reloads that overlap: the older one finishing last does not put the older settings back', async () => {
  const { fake, counted } = setup();
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { theme: 'light' } });
  const ui = await mount(<Probe />);
  try {
    assert.match(ui.text(), /theme light/);
    // A first save (the theme is still light) is read slowly...
    counted.hold = deferred();
    const slow = counted.hold;
    await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { theme: 'light', language: 'en' } }));
    // ...a second one (dark) is read at once and shows
    await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { theme: 'dark', language: 'en' } }));
    assert.match(ui.text(), /theme dark/);
    // the first read answers last, with what was stored when it was made
    await during(async () => slow.resolve());
    await settle();
    assert.match(ui.text(), /theme dark/, 'the newer settings stay');
  } finally {
    await ui.unmount();
  }
});
