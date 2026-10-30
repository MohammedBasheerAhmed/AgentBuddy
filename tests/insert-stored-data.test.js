import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AREAS, KEY_PREFIX, STORED_DATA, clearAllStored, describeKey, summarizeStored } from '../src/lib/storedData.js';
import { SETTINGS_KEY, SNIPPETS_KEY } from '../src/lib/storage.js';
import { AUDIT_KEY, AUDIT_SALT_KEY } from '../src/audit/auditLog.js';
import { CHECKLIST_KEY } from '../src/checks/checklistStore.js';
import { CAPS_KEY, PRICES_KEY, USAGE_KEY } from '../src/lib/aiUsage.js';
import { DASHBOARDS_KEY } from '../src/reports/dashboards.js';

// AB-SEC-10: "Clear everything stored by Agent Buddy" removes every agentbuddy_* key in local and session storage and nothing else,
// and the Settings list of what is stored names every key the code uses.

function fakeArea(initial = {}, { stubborn = [] } = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return JSON.parse(JSON.stringify(data));
      return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) if (!stubborn.includes(k)) delete data[k];
    },
  };
}

test('every agentbuddy_ key is removed from local and session storage', async () => {
  const local = fakeArea({
    [SETTINGS_KEY]: { provider: 'openai' },
    [SNIPPETS_KEY]: [{ id: 1 }],
    [AUDIT_KEY]: [{}],
    [AUDIT_SALT_KEY]: 'salt',
    [USAGE_KEY]: [],
    [PRICES_KEY]: {},
    [CAPS_KEY]: {},
    [DASHBOARDS_KEY]: {},
    agentbuddy_key_anthropic: 'sk-ant-123',
    agentbuddy_keyenc_openai: { ct: 'x' },
    agentbuddy_something_new_next_year: 1,
  });
  const session = fakeArea({ [CHECKLIST_KEY]: { aaaaaaaaaaaa: {} }, agentbuddy_key_openai: 'sk-1' });
  const result = await clearAllStored({ local, session });
  assert.deepEqual(local.data, {});
  assert.deepEqual(session.data, {});
  assert.deepEqual(result, { removed: { local: 11, session: 2 }, remaining: [] });
});

test('keys that are not Agent Buddy\'s are left alone', async () => {
  const local = fakeArea({ [SETTINGS_KEY]: 1, someone_else: 'keep', 'agentbuddy': 'no underscore, not ours', other_agentbuddy_x: 'keep' });
  const session = fakeArea({ unrelated: 1 });
  const result = await clearAllStored({ local, session });
  assert.deepEqual(Object.keys(local.data).sort(), ['agentbuddy', 'other_agentbuddy_x', 'someone_else']);
  assert.deepEqual(Object.keys(session.data), ['unrelated']);
  assert.deepEqual(result.removed, { local: 1, session: 0 });
});

test('an area that is missing (no session storage in this browser) is skipped; nothing stored is fine', async () => {
  const local = fakeArea({ [SETTINGS_KEY]: 1 });
  assert.deepEqual(await clearAllStored({ local }), { removed: { local: 1, session: 0 }, remaining: [] });
  assert.deepEqual(await clearAllStored({}), { removed: { local: 0, session: 0 }, remaining: [] });
  assert.deepEqual(await clearAllStored(), { removed: { local: 0, session: 0 }, remaining: [] });
  assert.deepEqual(await clearAllStored({ local: fakeArea(), session: fakeArea() }), { removed: { local: 0, session: 0 }, remaining: [] });
});

test('a key the browser would not remove is reported, not hidden', async () => {
  const local = fakeArea({ [SETTINGS_KEY]: 1, [SNIPPETS_KEY]: 2 }, { stubborn: [SNIPPETS_KEY] });
  const result = await clearAllStored({ local });
  assert.deepEqual(result.remaining, [`local:${SNIPPETS_KEY}`]);
  assert.ok(!(SETTINGS_KEY in local.data));
});

test('the list of what is stored covers every key the code uses', () => {
  const root = path.join(__dirname, '..', 'src');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
    }
  })(root);
  const found = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // a quoted or template string that starts with the prefix: 'agentbuddy_settings', `agentbuddy_key_${provider}`
    for (const m of text.matchAll(/['"`](agentbuddy_[a-z_]*)/g)) found.add(m[1]);
  }
  assert.ok(found.size >= 9, `found ${[...found].join(', ')}`);
  // (the bare prefix itself, in storedData.js, is not a key)
  const undescribed = [...found].filter((key) => key !== KEY_PREFIX && !describeKey(key));
  assert.deepEqual(undescribed, [], 'add the key to STORED_DATA in src/lib/storedData.js, with a plain description');
});

test('every item is described in plain words and the area is named', () => {
  assert.ok(STORED_DATA.length >= 7);
  const ids = new Set();
  for (const item of STORED_DATA) {
    assert.ok(!ids.has(item.id), item.id);
    ids.add(item.id);
    assert.ok(item.title.length > 3 && item.detail.length > 20, item.id);
    assert.ok(AREAS.includes(item.area), item.id);
    for (const key of item.keys || []) assert.ok(key.startsWith(KEY_PREFIX), key);
    for (const prefix of item.prefixes || []) assert.ok(prefix.startsWith(KEY_PREFIX), prefix);
    assert.ok((item.keys || []).length + (item.prefixes || []).length > 0, item.id);
    assert.ok(!/ticket text|names? of|content of/i.test(item.detail) || /never|No text|no ticket/i.test(item.detail), `${item.id}: say what is NOT kept`);
  }
  for (const id of ['settings', 'key', 'snippets', 'usage', 'audit', 'checklist']) assert.ok(ids.has(id), id);
  assert.equal(STORED_DATA.find((i) => i.id === 'checklist').area, 'session', 'the checklist ticks are memory only');
});

test('the Settings list says what is saved now', () => {
  const summary = summarizeStored([SETTINGS_KEY, 'agentbuddy_key_openai', 'not_ours'], [CHECKLIST_KEY]);
  const byId = Object.fromEntries(summary.map((i) => [i.id, i.present]));
  assert.equal(byId.settings, true);
  assert.equal(byId.key, true);
  assert.equal(byId.checklist, true);
  assert.equal(byId.snippets, false);
  assert.equal(byId.audit, false);
  assert.deepEqual(summarizeStored().every((i) => i.present === false), true);
  assert.equal(describeKey('agentbuddy_keyenc_anthropic').id, 'key');
  assert.equal(describeKey('agentbuddy_unknown'), null);
});

test('Settings has the section, a confirmation and the button text the person asked for', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'options', 'Options.jsx'), 'utf8');
  assert.match(source, /Stored data/);
  assert.match(source, /Clear everything stored by Agent Buddy/);
  assert.match(source, /Yes, remove everything/);
  // Every place something is kept: browser storage, memory, and the key vault (IndexedDB).
  assert.match(source, /clearAllStored\(\s*\{ local: chrome\.storage\.local, session: chrome\.storage\.session, vault: keyVault\(\) \}/);
});

test('the key vault (IndexedDB) is emptied too; the stamp in local storage goes with the rest', async () => {
  const local = fakeArea({ [SETTINGS_KEY]: 1, agentbuddy_keyvault_stamp: 123 });
  const session = fakeArea({ agentbuddy_key_openai: 'sk-1' });
  const vault = fakeArea({ agentbuddy_key_anthropic: 'sk-ant-1', agentbuddy_keyenc_openai: { ct: 'x' } });
  const result = await clearAllStored({ local, session, vault });
  assert.deepEqual(vault.data, {});
  assert.deepEqual(local.data, {});
  assert.deepEqual(result, { removed: { local: 2, session: 1, vault: 2 }, remaining: [] });
  const leftover = await clearAllStored({ local: fakeArea(), vault: fakeArea({ agentbuddy_key_x: 1 }, { stubborn: ['agentbuddy_key_x'] }) });
  assert.deepEqual(leftover.remaining, ['vault:agentbuddy_key_x'], 'a key that would not go is reported');
});

test('keep: the usage log stays while the organisation counts a daily token budget from it; it is not reported as left over', async () => {
  const local = fakeArea({ [SETTINGS_KEY]: 1, [USAGE_KEY]: [{ time: 't' }], [CAPS_KEY]: {} });
  const result = await clearAllStored({ local }, { keep: [USAGE_KEY] });
  assert.deepEqual(Object.keys(local.data), [USAGE_KEY]);
  assert.deepEqual(result, { removed: { local: 2, session: 0 }, remaining: [], kept: [`local:${USAGE_KEY}`] });
});

test('the Settings list counts a key kept in the vault as saved; the time stamp alone is not a key', () => {
  const summary = summarizeStored([], [], ['agentbuddy_keyenc_openai']);
  assert.equal(summary.find((i) => i.id === 'key').present, true);
  assert.equal(summarizeStored(['agentbuddy_keyvault_stamp']).find((i) => i.id === 'key').present, false);
  assert.equal(describeKey('agentbuddy_vault').id, 'key');
});
