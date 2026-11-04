import { mount, click, choose, type, during, makeChrome, settle, deferred, document } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeIndexedDb, emptyFakeIndexedDb } from './fixtures/fake-indexeddb.js';
import Options, { ProfilesSection } from '../src/options/Options.jsx';
import { settingsChangeMatters } from '../src/lib/settingsChanges.js';
import { keyStore, SETTINGS_KEY, SNIPPETS_KEY } from '../src/lib/storage.js';
import { KEY_CHANGED_KEY } from '../src/lib/keyStore.js';
import { USAGE_KEY } from '../src/lib/aiUsage.js';
import { AUDIT_KEY } from '../src/audit/auditLog.js';
import { MSG } from '../src/lib/messages.js';
import { PROVIDERS } from '../src/providers/config.js';
import { effectiveSettings, PII_MODES, PREVIEW_MODES } from '../src/policy/policy.js';

// The Settings page as it runs: the whole page mounted on a fake chrome.storage and a fake IndexedDB (the key vault), so a save, a
// key move and a storage event from another page go through the same code as in the browser.

const idb = fakeIndexedDb();
globalThis.indexedDB = idb; // before the first keyVault(): the page keeps the vault it opened first

function setup({ policy = null } = {}) {
  emptyFakeIndexedDb(idb);
  const fake = makeChrome();
  fake.chrome.runtime.getManifest = () => ({ version: '1', optional_host_permissions: ['https://*/*'] });
  if (policy) fake.chrome.storage.managed = { get: async () => structuredClone(policy) };
  globalThis.chrome = fake.chrome;
  return fake;
}

const saveRaw = (fake, settings) => fake.chrome.storage.local.set({ [SETTINGS_KEY]: settings });

// Wait (inside act) until something is true: a key encrypted with 600,000 PBKDF2 rounds takes longer than a few turns of the loop.
async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(1);
  }
}

const effOf = (settings, policy = {}) => {
  const e = effectiveSettings(settings, policy);
  return { values: e.values, locked: e.locked, floors: e.floors, policy: e.policy, apiKey: '', keyLocked: false };
};

// ---- P2.18: the line under the key box follows the key --------------------------------------------------------------------------

test('the line under the key box follows the key when "Where to keep the key" moves it, and when the saved key is encrypted', async () => {
  const fake = setup();
  await saveRaw(fake, { provider: 'openai', keyStorage: 'local' });
  await keyStore().save({ provider: 'openai', key: 'sk-test-abcdefghijklmnop', mode: 'local' });
  const ui = await mount(<Options />);
  const line = () => (ui.container.querySelector('#key-saved')?.textContent || '').replace(/\s+/g, ' ');
  await until(() => /Saved:/.test(line()), 'the saved key line');
  assert.match(line(), /kept in this browser\./);

  // Memory only: the key really moves, and the line says where it is now (it named the old place and warned it was the wrong one).
  await choose(ui.container.querySelector('#keystorage'), 'session');
  await until(() => /kept in memory only\./.test(line()), 'the line to name memory');
  assert.equal(await keyStore().mode('openai'), 'session');
  assert.ok(!/That is not where you chose/.test(line()), line());

  // Encrypted: the choice waits for a passphrase, and until then the line says the key is not kept where it was chosen.
  await choose(ui.container.querySelector('#keystorage'), 'encrypted');
  await until(() => /That is not where you chose to keep it/.test(line()), 'the "not where you chose" remark');
  assert.match(line(), /kept in memory only\./);
  await type(ui.container.querySelector('#pass'), 'correct horse battery');
  await click(ui.button('Encrypt the saved key', { all: true }));
  await until(() => /kept in this browser, encrypted\./.test(line()), 'the line to name the encrypted key');
  assert.equal(await keyStore().mode('openai'), 'encrypted');
  assert.ok(!/That is not where you chose/.test(line()), line());

  // Removed: none is saved any more.
  await click(ui.button('Remove saved key', { all: true }));
  await until(() => /No key is saved for/.test(line()), 'the line to say no key is saved');
  await ui.unmount();
});

// ---- P2.9: Settings reads again only for what it shows, and the newest read wins ----------------------------------------------

test('settingsChangeMatters: the settings, the key store and the policy count; the logs written on every AI call do not', () => {
  assert.equal(settingsChangeMatters({ [SETTINGS_KEY]: {} }, 'local'), true);
  assert.equal(settingsChangeMatters({ [KEY_CHANGED_KEY]: {} }, 'local'), true, 'the vault (IndexedDB) changed');
  assert.equal(settingsChangeMatters({ agentbuddy_key_openai: {} }, 'session'), true, 'a key kept in memory, or unlocked');
  assert.equal(settingsChangeMatters({ anything: {} }, 'managed'), true, "the organisation's policy");
  for (const key of [USAGE_KEY, AUDIT_KEY, SNIPPETS_KEY, 'agentbuddy_dashboards']) assert.equal(settingsChangeMatters({ [key]: {} }, 'local'), false, key);
  assert.equal(settingsChangeMatters({ agentbuddy_checklists: {} }, 'session'), false, 'checklist ticks');
  assert.equal(settingsChangeMatters({ agentbuddy_key_openai: {} }, 'local'), false, 'a key slot in local storage is moved by the key store, which changes the stamp');
  assert.equal(settingsChangeMatters({ [SETTINGS_KEY]: {} }, 'sync'), false);
  assert.equal(settingsChangeMatters(undefined, 'local'), false);
});

test('the Settings page does not read everything again when the usage log or a snippet is written; it does for the settings, the key and the policy', async () => {
  const fake = setup();
  let reads = 0; // every read of the settings reads the policy too
  fake.chrome.storage.managed = {
    get: async () => {
      reads += 1;
      return {};
    },
  };
  await saveRaw(fake, { provider: 'openai' });
  const ui = await mount(<Options />);
  await settle(6);
  const readsFor = async (fn) => {
    const before = reads;
    await during(fn);
    await settle(6);
    return reads - before;
  };
  assert.equal(await readsFor(() => fake.chrome.storage.local.set({ [USAGE_KEY]: [{ t: 1 }] })), 0, 'the usage log, written on every AI call');
  assert.equal(await readsFor(() => fake.chrome.storage.local.set({ [AUDIT_KEY]: [] })), 0, 'the activity log');
  assert.equal(await readsFor(() => fake.chrome.storage.local.set({ [SNIPPETS_KEY]: [] })), 0, 'snippets');
  assert.equal(await readsFor(() => fake.chrome.storage.session.set({ agentbuddy_checklists: {} })), 0, 'checklist ticks');
  assert.ok((await readsFor(() => saveRaw(fake, { provider: 'openai', theme: 'dark' }))) > 0, 'the settings');
  assert.ok((await readsFor(() => fake.chrome.storage.local.set({ [KEY_CHANGED_KEY]: 2 }))) > 0, 'the key vault');
  assert.ok((await readsFor(() => fake.chrome.storage.session.set({ agentbuddy_key_openai: 'sk-mem-0123456789abcdef' }))) > 0, 'a key in memory');
  assert.ok((await readsFor(() => fake.chrome.storage.onChanged.fire({ piiMode: { newValue: 'strict' } }, 'managed'))) > 0, 'the policy');
  await ui.unmount();
});

test('two reads that finish out of order: the page shows what the newer one found', async () => {
  const fake = setup();
  const gates = []; // a read of the policy waits for the next gate, when there is one
  fake.chrome.storage.managed = {
    get: async () => {
      const gate = gates.shift();
      if (gate) await gate.promise;
      return {};
    },
  };
  await saveRaw(fake, { theme: 'system' });
  const ui = await mount(<Options />);
  await settle(6);
  const theme = () => ui.container.querySelector('#theme-choice').value;
  assert.equal(theme(), 'system');
  const slow = deferred();
  gates.push(slow);
  let policyReads = 0;
  const counted = fake.chrome.storage.managed.get;
  fake.chrome.storage.managed.get = (...args) => {
    policyReads += 1;
    return counted(...args);
  };
  await during(() => saveRaw(fake, { theme: 'dark' })); // read 1 finds "dark" and waits for the policy
  await during(() => saveRaw(fake, { theme: 'light' })); // read 2 finds "light" and finishes first
  await until(() => theme() === 'light', 'the newer read');
  const before = policyReads;
  await during(() => slow.resolve());
  // Read 1 goes on: it reads the policy again for the key (keyStore load) and then the vault a few times.
  await until(() => policyReads > before, 'the older read to go on');
  await settle(40);
  assert.equal(theme(), 'light', 'the older read, finishing last, does not put "dark" back');
  await ui.unmount();
});

// ---- P2.19 / P2.20: what you work on ---------------------------------------------------------------------------------------

const tickedIn = (ui) => ui.$$('input[type="checkbox"]').filter((b) => b.checked && /^profile-/.test(b.id)).map((b) => b.id.slice('profile-'.length)).sort();
const savedProfiles = async (fake) => (await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]?.profiles;

test('What you work on: the boxes show what was saved; an add-on alone is saved with a main profile, ticked too, and the last box cannot be unticked', async () => {
  const fake = setup();
  const ui = await mount(<ProfilesSection eff={effOf({ profiles: ['csm', 'lead'], profilesConfirmed: true })} reload={() => {}} />);
  assert.deepEqual(tickedIn(ui), ['csm', 'lead']);

  // Only the add-on left: a main profile is saved with it, and the boxes say so.
  await click(ui.container.querySelector('#profile-csm'));
  assert.deepEqual(await savedProfiles(fake), ['it', 'lead']);
  assert.deepEqual(tickedIn(ui), ['it', 'lead'], 'the boxes show what was saved');
  assert.match(ui.text(), /Saved\. IT service desk and resolver was ticked too, because at least one choice under "I work on" is needed\./);

  // An ordinary change: saved as ticked.
  await click(ui.container.querySelector('#profile-req'));
  await click(ui.container.querySelector('#profile-it'));
  await click(ui.container.querySelector('#profile-lead'));
  assert.deepEqual(await savedProfiles(fake), ['req']);
  assert.deepEqual(tickedIn(ui), ['req']);
  assert.match(ui.text(), /Saved\./);
  assert.ok(!/was ticked too/.test(ui.text()));

  // The last one: refused with a note, the box stays ticked, nothing is saved.
  await click(ui.container.querySelector('#profile-req'));
  assert.deepEqual(tickedIn(ui), ['req'], 'the last box stays ticked');
  assert.deepEqual(await savedProfiles(fake), ['req']);
  assert.match(ui.text(), /Keep at least one ticked\./);
  assert.ok(!/Saved\./.test(ui.text()));
  await ui.unmount();
});

test('a profile tick the browser does not save: one message saying so, no "Saved.", and the box goes back to what is saved', async () => {
  const fake = setup();
  fake.chrome.storage.local.set = async () => {
    throw new Error('QUOTA_BYTES quota exceeded');
  };
  const ui = await mount(<ProfilesSection eff={effOf({ profiles: ['it'], profilesConfirmed: true })} reload={() => {}} />);
  await click(ui.container.querySelector('#profile-csm'));
  const text = ui.text();
  assert.match(text, /The browser did not save that\. Try again\./);
  assert.ok(!/Saved\./.test(text), text);
  assert.ok(!/did not save that change/.test(text), 'said once, by the boxes');
  assert.deepEqual(tickedIn(ui), ['it'], 'the box shows what is saved');
  await ui.unmount();
});

// ---- P2.22: "Clear everything" -------------------------------------------------------------------------------------------------

test('"Clear everything" turns off every site that was turned on, also one the organisation\'s allowedInstances leaves out', async () => {
  const fake = setup({ policy: { allowedInstances: ['https://acme.service-now.com'] } });
  const messages = [];
  fake.chrome.runtime.sendMessage = async (message) => {
    messages.push(message);
    return message?.type === MSG.LIST_INSTANCES ? { instances: [], listed: [] } : {};
  };
  await saveRaw(fake, { instances: ['https://acme.service-now.com', 'https://old.service-now.com'] });
  const ui = await mount(<Options />);
  await settle(6);
  assert.ok(ui.text().includes('https://acme.service-now.com'));
  assert.ok(!ui.text().includes('https://old.service-now.com'), 'a site the policy does not allow is not listed');
  await click(ui.button('Clear everything stored by Agent Buddy'));
  await click(ui.button('Yes, remove everything'));
  await until(() => !ui.hasButton('Yes, remove everything') && !/Removing/.test(ui.text()), 'the clearing to end');
  const off = messages.filter((m) => m?.type === MSG.DISABLE_INSTANCE).map((m) => m.origin).sort();
  assert.deepEqual(off, ['https://acme.service-now.com', 'https://old.service-now.com']);
  // The outcome stays on screen: the section is not rebuilt after the clearing (it read what is left itself), so a partial failure is
  // not silent.
  await until(() => ui.text().includes('Everything stored by Agent Buddy was removed.'), 'the outcome to be shown');
  await ui.unmount();
});

// ---- The menu beside the pages, and the switches ------------------------------------------------------------------------------

test('the menu: a section chosen is marked and its title takes the focus; the folded menu (narrow window) closes; each page has its own', async () => {
  const fake = setup();
  await saveRaw(fake, { provider: 'openai' });
  const ui = await mount(<Options />);
  await settle(6);
  const toggle = ui.button('Go to a section');
  const menu = ui.container.querySelector('#ab-set-menu');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.getAttribute('data-open'), 'false');
  await click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.getAttribute('data-open'), 'true');

  const privacy = ui.container.querySelector('a[href="#h-privacy"]');
  await click(privacy);
  await settle(3);
  assert.equal(privacy.getAttribute('aria-current'), 'location');
  assert.equal(ui.$$('[aria-current="location"]').length, 1);
  assert.equal(document.activeElement?.id, 'h-privacy', 'reading goes on from the section chosen');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'the folded menu closes once a section is chosen');

  await click(ui.tab('AI Assist'));
  assert.deepEqual(ui.$$('.ab-set-menu-link').map((a) => a.getAttribute('href')), ['#h-provider', '#h-key', '#h-formats', '#h-usage']);
  assert.equal(ui.container.querySelector('a[href="#h-provider"]').getAttribute('aria-current'), 'location', 'the first section of the new page');
  await ui.unmount();
});

test('a switch saves its choice like the tick box it is', async () => {
  const fake = setup();
  await saveRaw(fake, { provider: 'openai' });
  const ui = await mount(<Options />);
  await settle(6);
  const saved = async () => (await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  const bar = ui.field('Keep the bar open at the top of the side panel.');
  assert.equal(bar.getAttribute('role'), 'switch');
  assert.equal(bar.checked, true);
  await click(bar);
  await settle(3);
  assert.equal((await saved()).quickBarOpen, false);
  await click(ui.field('Show everything: every card and action, whatever you work on.'));
  await settle(3);
  assert.equal((await saved()).showEverything, true);
  await ui.unmount();
});

// ---- What the simplified Settings code relies on -------------------------------------------------------------------------------

test('a provider has its own fixed address or takes one from the person, never both (the address box shows what was typed)', () => {
  for (const [id, def] of Object.entries(PROVIDERS)) assert.ok(!(def.userBaseUrl && def.baseUrl), id);
});

test('the policy locks the privacy choices only together with a floor (Settings shows the floor; the select stays usable)', () => {
  for (const [setting, modes] of [['piiMode', PII_MODES], ['previewMode', PREVIEW_MODES]]) {
    for (const floor of modes) {
      for (const mine of modes) {
        const e = effectiveSettings({ [setting]: mine }, { [setting]: floor });
        if (e.locked[setting]) assert.equal(e.floors[setting], floor, `${setting} ${mine} under ${floor}`);
      }
    }
    const free = effectiveSettings({}, {});
    assert.equal(free.locked[setting], undefined);
    assert.equal(free.floors[setting], undefined);
  }
});
