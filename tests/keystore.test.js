const test = require('node:test');
const assert = require('node:assert/strict');
import { createKeyStore, encryptSecret, decryptSecret } from '../src/lib/keyStore.js';

// A tiny stand-in for chrome.storage.local / .session.
function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) {
      return typeof key === 'string' ? (key in data ? { [key]: data[key] } : {}) : {};
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
    async remove(keys) {
      [].concat(keys).forEach((k) => delete data[k]);
    },
  };
}
const newStore = () => {
  const areas = { local: fakeArea(), session: fakeArea() };
  return { areas, store: createKeyStore(areas) };
};
// Few PBKDF2 rounds would weaken the real thing, so tests call the helpers with a low count only where speed matters.

test('encrypt/decrypt round trip, and a wrong passphrase fails plainly', async () => {
  const blob = await encryptSecret('sk-secret-123', 'correct horse', 1000);
  assert.ok(!JSON.stringify(blob).includes('sk-secret-123'));
  assert.equal(await decryptSecret(blob, 'correct horse'), 'sk-secret-123');
  await assert.rejects(() => decryptSecret(blob, 'wrong'), /Wrong passphrase/);
  await assert.rejects(() => decryptSecret({ v: 9 }, 'x'), /unknown format/);
});

test('two encryptions of the same key differ (random salt and iv)', async () => {
  const a = await encryptSecret('k', 'p', 1000);
  const b = await encryptSecret('k', 'p', 1000);
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.salt, b.salt);
});

test('local mode stores in local storage only', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'anthropic', key: ' sk-ant-1 ', mode: 'local' });
  assert.equal(areas.local.data.agentbuddy_key_anthropic, 'sk-ant-1');
  assert.equal(await store.load('anthropic'), 'sk-ant-1');
  assert.equal(await store.mode('anthropic'), 'local');
});

test('session mode never touches local storage', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'sk-1', mode: 'session' });
  assert.deepEqual(areas.local.data, {});
  assert.equal(await store.load('openai'), 'sk-1');
  assert.equal(await store.mode('openai'), 'session');
});

test('encrypted mode keeps no plaintext on disk and can be locked and unlocked', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'sk-plain-xyz', mode: 'encrypted', passphrase: 'pass phrase' });
  assert.ok(!JSON.stringify(areas.local.data).includes('sk-plain-xyz'));
  assert.equal(await store.mode('openai'), 'encrypted');
  assert.equal(await store.load('openai'), 'sk-plain-xyz', 'unlocked right after saving');
  // Browser restart: session storage is wiped.
  Object.keys(areas.session.data).forEach((k) => delete areas.session.data[k]);
  assert.equal(await store.isLocked('openai'), true);
  assert.equal(await store.load('openai'), '');
  await assert.rejects(() => store.unlock('openai', 'nope'), /Wrong passphrase/);
  await store.unlock('openai', 'pass phrase');
  assert.equal(await store.isLocked('openai'), false);
  assert.equal(await store.load('openai'), 'sk-plain-xyz');
});

test('saving in a new mode removes the old copies', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'k1', mode: 'local' });
  await store.save({ provider: 'openai', key: 'k1', mode: 'session' });
  assert.deepEqual(areas.local.data, {});
  await store.save({ provider: 'openai', key: '', mode: 'local' });
  assert.equal(await store.load('openai'), '');
  assert.equal(await store.mode('openai'), 'none');
});

test('changeMode moves an existing key; keys of other providers are untouched', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'k-open', mode: 'local' });
  await store.save({ provider: 'anthropic', key: 'k-ant', mode: 'local' });
  await store.changeMode({ provider: 'openai', mode: 'session' });
  assert.equal(await store.mode('openai'), 'session');
  assert.equal(await store.mode('anthropic'), 'local');
  assert.equal(areas.local.data.agentbuddy_key_openai, undefined);
  await store.remove('anthropic');
  assert.equal(await store.load('anthropic'), '');
});
