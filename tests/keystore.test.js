const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
import {
  createKeyStore,
  encryptSecret,
  decryptSecret,
  cleanKey,
  keyPreview,
  indexedDbArea,
  blobIsOutdated,
  PBKDF2_ITERATIONS,
  KEY_CHANGED_KEY,
} from '../src/lib/keyStore.js';

// A tiny stand-in for chrome.storage.local / .session, and for the vault (same get/set/remove shape).
function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) {
      if (key === null) return { ...data };
      const keys = [].concat(key);
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
    async remove(keys) {
      [].concat(keys).forEach((k) => delete data[k]);
    },
  };
}
const newStore = (requiredMode) => {
  const areas = { local: fakeArea(), session: fakeArea(), vault: fakeArea() };
  return { areas, store: createKeyStore(areas, requiredMode ? { requiredMode: async () => requiredMode } : {}) };
};
// Only the time stamp that tells other pages "the vault changed" may be in chrome.storage.local.
const localWithoutStamp = (areas) => Object.fromEntries(Object.entries(areas.local.data).filter(([k]) => k !== KEY_CHANGED_KEY));
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

test('every encryption draws its own 16-byte salt and 12-byte IV: an IV is never reused, and each blob has its own AES key', async () => {
  const blobs = await Promise.all(Array.from({ length: 40 }, () => encryptSecret('sk-same', 'same passphrase', 1000)));
  assert.equal(new Set(blobs.map((b) => b.iv)).size, blobs.length);
  assert.equal(new Set(blobs.map((b) => b.salt)).size, blobs.length);
  assert.equal(Buffer.from(blobs[0].iv, 'base64').length, 12);
  assert.equal(Buffer.from(blobs[0].salt, 'base64').length, 16);
});

test('PBKDF2 uses the OWASP count (600,000 or more) by default and the blob records it', async () => {
  assert.ok(PBKDF2_ITERATIONS >= 600000, 'OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256, 600,000 iterations');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'keyStore.js'), 'utf8');
  assert.match(source, /hash: 'SHA-256'/);
  assert.match(source, /name: 'AES-GCM', length: 256/);
  assert.equal(blobIsOutdated({ v: 2, aad: true, iter: PBKDF2_ITERATIONS }), false);
  assert.equal(blobIsOutdated({ v: 1, iter: 310000 }), true, 'a blob from the earlier version (310,000, no binding) is upgraded on unlock');
});

test('a blob is bound to its slot: copied to another provider it does not decrypt', async () => {
  const blob = await encryptSecret('sk-bound', 'passphrase!', 1000, 'agentbuddy_keyenc_openai');
  assert.equal(await decryptSecret(blob, 'passphrase!', 'agentbuddy_keyenc_openai'), 'sk-bound');
  await assert.rejects(() => decryptSecret(blob, 'passphrase!', 'agentbuddy_keyenc_anthropic'), /Wrong passphrase, or the stored key is damaged/);
  // A damaged iteration count is refused instead of freezing the page.
  await assert.rejects(() => decryptSecret({ ...blob, iter: 1e12 }, 'passphrase!', 'agentbuddy_keyenc_openai'), /damaged/);
});

test("local mode keeps the key in the vault, never in chrome.storage.local (a content script can read that)", async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'anthropic', key: ' sk-ant-1 ', mode: 'local' });
  assert.equal(areas.vault.data.agentbuddy_key_anthropic, 'sk-ant-1');
  assert.deepEqual(localWithoutStamp(areas), {});
  assert.ok(!JSON.stringify(areas.local.data).includes('sk-ant-1'));
  assert.equal(typeof areas.local.data[KEY_CHANGED_KEY], 'number', 'other pages hear about the change through a time stamp only');
  assert.equal(await store.load('anthropic'), 'sk-ant-1');
  assert.equal(await store.mode('anthropic'), 'local');
});

test('session mode never touches local storage or the vault', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'sk-1', mode: 'session' });
  assert.deepEqual(localWithoutStamp(areas), {});
  assert.deepEqual(areas.vault.data, {});
  assert.equal(await store.load('openai'), 'sk-1');
  assert.equal(await store.mode('openai'), 'session');
});

test('encrypted mode keeps no plaintext on disk and can be locked and unlocked', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'sk-plain-xyz', mode: 'encrypted', passphrase: 'pass phrase' });
  assert.ok(!JSON.stringify(areas.local.data).includes('sk-plain-xyz'));
  assert.ok(!JSON.stringify(areas.vault.data).includes('sk-plain-xyz'));
  assert.equal(areas.vault.data.agentbuddy_keyenc_openai.v, 2);
  assert.equal(areas.vault.data.agentbuddy_keyenc_openai.iter, PBKDF2_ITERATIONS);
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

test('a passphrase shorter than 8 characters is refused before anything is stored', async () => {
  const { areas, store } = newStore();
  await assert.rejects(() => store.save({ provider: 'openai', key: 'sk-x', mode: 'encrypted', passphrase: 'short' }), /at least 8 characters/);
  assert.deepEqual(areas.vault.data, {});
  assert.deepEqual(areas.session.data, {});
});

test('an old encrypted blob (earlier version) still unlocks, and is re-encrypted with today\'s settings', async () => {
  const { areas, store } = newStore();
  areas.vault.data.agentbuddy_keyenc_openai = await encryptSecret('sk-old', 'old passphrase', 1000); // no binding, few rounds
  areas.vault.data.agentbuddy_keyenc_openai.v = 1;
  delete areas.vault.data.agentbuddy_keyenc_openai.aad;
  assert.equal(await store.isLocked('openai'), true);
  await store.unlock('openai', 'old passphrase');
  assert.equal(await store.load('openai'), 'sk-old');
  const now = areas.vault.data.agentbuddy_keyenc_openai;
  assert.equal(now.v, 2);
  assert.equal(now.iter, PBKDF2_ITERATIONS);
  assert.equal(now.aad, true);
  assert.equal(await decryptSecret(now, 'old passphrase', 'agentbuddy_keyenc_openai'), 'sk-old');
});

test('saving in a new mode removes the old copies', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'openai', key: 'k1', mode: 'local' });
  await store.save({ provider: 'openai', key: 'k1', mode: 'session' });
  assert.deepEqual(localWithoutStamp(areas), {});
  assert.deepEqual(areas.vault.data, {});
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
  assert.equal(areas.vault.data.agentbuddy_key_openai, undefined);
  await store.remove('anthropic');
  assert.equal(await store.load('anthropic'), '');
});

test('a key an earlier version left in chrome.storage.local is moved into the vault the first time it is read', async () => {
  const { areas, store } = newStore();
  areas.local.data.agentbuddy_key_deepseek = 'sk-legacy';
  areas.local.data.agentbuddy_keyenc_openai = { v: 1, iter: 1000, salt: 'x', iv: 'y', ct: 'z' };
  areas.local.data.agentbuddy_settings = { provider: 'deepseek' };
  assert.equal(await store.load('deepseek'), 'sk-legacy');
  assert.equal(areas.local.data.agentbuddy_key_deepseek, undefined, 'the copy a content script could read is gone');
  assert.equal(areas.vault.data.agentbuddy_key_deepseek, 'sk-legacy');
  assert.equal(await store.mode('openai'), 'encrypted');
  assert.equal(areas.local.data.agentbuddy_keyenc_openai, undefined);
  assert.deepEqual(areas.local.data.agentbuddy_settings, { provider: 'deepseek' }, 'other settings are left alone');
});

test('a key found in chrome.storage.local is the newest copy: it replaces what the vault and memory held for that provider', async () => {
  const { areas, store } = newStore();
  await store.save({ provider: 'custom', key: 'sk-old-encrypted', mode: 'encrypted', passphrase: 'long passphrase' });
  areas.local.data.agentbuddy_key_custom = 'sk-new-plain';
  assert.equal(await store.load('custom'), 'sk-new-plain');
  assert.equal(await store.mode('custom'), 'local');
  assert.equal(await store.isLocked('custom'), false);
  assert.equal(areas.vault.data.agentbuddy_keyenc_custom, undefined);
});

test('without a vault (no IndexedDB) a key is only kept in memory: it is never written to chrome.storage.local instead', async () => {
  const areas = { local: fakeArea(), session: fakeArea() };
  const store = createKeyStore(areas);
  await assert.rejects(() => store.save({ provider: 'openai', key: 'sk-1', mode: 'local' }), /Memory only/);
  await assert.rejects(() => store.save({ provider: 'openai', key: 'sk-1', mode: 'encrypted', passphrase: 'long enough' }), /Memory only/);
  assert.deepEqual(areas.local.data, {});
  await store.save({ provider: 'openai', key: 'sk-1', mode: 'session' });
  assert.equal(await store.load('openai'), 'sk-1');
});

test('policy keyStorage = session: a key saved on disk earlier is moved into memory and removed from disk', async () => {
  const { areas, store } = newStore('session');
  areas.vault.data.agentbuddy_key_openai = 'sk-was-on-disk';
  assert.equal(await store.load('openai'), 'sk-was-on-disk');
  assert.equal(areas.vault.data.agentbuddy_key_openai, undefined);
  assert.equal(areas.session.data.agentbuddy_key_openai, 'sk-was-on-disk');
  assert.equal(await store.mode('openai'), 'session');

  // An encrypted key: once unlocked (in memory), the copy on disk goes too; while locked it stays locked.
  const other = newStore('session');
  await other.store.save({ provider: 'openai', key: 'sk-enc', mode: 'encrypted', passphrase: 'long passphrase' });
  assert.equal(await other.store.load('openai'), 'sk-enc');
  assert.equal(other.areas.vault.data.agentbuddy_keyenc_openai, undefined);
});

test('policy keyStorage = encrypted: a plain key on disk is not used; it counts as locked until a passphrase encrypts it', async () => {
  const { areas, store } = newStore('encrypted');
  areas.vault.data.agentbuddy_key_openai = 'sk-plain';
  assert.equal(await store.load('openai'), '');
  assert.equal(await store.isLocked('openai'), true);
  assert.equal(await store.needsEncryption('openai'), true);
  await assert.rejects(() => store.unlock('openai', 'short'), /at least 8 characters/);
  await store.unlock('openai', 'a good passphrase');
  assert.equal(await store.load('openai'), 'sk-plain');
  assert.equal(areas.vault.data.agentbuddy_key_openai, undefined, 'no plain copy on disk any more');
  assert.equal(areas.vault.data.agentbuddy_keyenc_openai.v, 2);
  assert.equal(await store.needsEncryption('openai'), false);
});

test('a provider id that is not a plain name is refused (no odd storage slots)', async () => {
  const { store } = newStore();
  await assert.rejects(() => store.load('../x'), /Unknown AI service/);
  await assert.rejects(() => store.save({ provider: '', key: 'k' }), /Unknown AI service/);
});

test('cleanKey: a pasted key loses its quotes, "Bearer " and stray whitespace, and nothing else', () => {
  assert.equal(cleanKey('sk-abc123'), 'sk-abc123');
  assert.equal(cleanKey('  sk-abc123\n'), 'sk-abc123');
  assert.equal(cleanKey('"sk-abc123"'), 'sk-abc123');
  assert.equal(cleanKey("'sk-abc123'"), 'sk-abc123');
  assert.equal(cleanKey('Bearer sk-abc123'), 'sk-abc123');
  assert.equal(cleanKey('bearer   sk-abc123'), 'sk-abc123');
  assert.equal(cleanKey('sk-abc\n123'), 'sk-abc123', 'a line break inside a pasted key is dropped');
  assert.equal(cleanKey(''), '');
  assert.equal(cleanKey(null), '');
  assert.equal(cleanKey('sk-ab_cd-12.34'), 'sk-ab_cd-12.34', 'characters a key may contain stay');
});

test('keyPreview shows the ends and the length of a long key, only the length of a short one', () => {
  assert.deepEqual(keyPreview('sk-0123456789abcdef0123'), { preview: 'sk-0…0123', length: 23 });
  assert.deepEqual(keyPreview('short-key'), { preview: '', length: 9 });
  assert.deepEqual(keyPreview(''), { preview: '', length: 0 });
  assert.ok(!keyPreview('sk-0123456789abcdef0123').preview.includes('456789abcdef'), 'the middle is never part of the preview');
});

test('save() stores the cleaned key', async () => {
  const { store } = newStore();
  await store.save({ provider: 'deepseek', key: '  "Bearer sk-deepseek-1234567890"\n', mode: 'local' });
  assert.equal(await store.load('deepseek'), 'sk-deepseek-1234567890');
});

// ---- The vault on IndexedDB --------------------------------------------------------------------------------------------------

// A minimal in-memory IndexedDB: open with an upgrade, one object store, transactions whose requests finish in order and then
// complete. Enough to run indexedDbArea() as the browser would.
function fakeIndexedDb() {
  const databases = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const request = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });
  function makeDb(state) {
    return {
      objectStoreNames: { contains: (name) => state.stores.has(name) },
      createObjectStore: (name) => state.stores.set(name, new Map()),
      onversionchange: null,
      close() {},
      transaction(name, mode) {
        const map = state.stores.get(name);
        const queue = [];
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        const op = (fn) => {
          const req = request();
          queue.push(() => {
            req.result = fn();
            req.onsuccess?.();
          });
          return req;
        };
        tx.objectStore = () => ({
          get: (key) => op(() => (map.has(key) ? structuredClone(map.get(key)) : undefined)),
          getAll: () => op(() => [...map.keys()].sort().map((k) => structuredClone(map.get(k)))),
          getAllKeys: () => op(() => [...map.keys()].sort()),
          put: (value, key) => {
            if (mode !== 'readwrite') throw new Error('ReadOnlyError');
            return op(() => map.set(key, structuredClone(value)) && key);
          },
          delete: (key) => op(() => map.delete(key) && undefined),
        });
        later(() => {
          queue.forEach((run) => run());
          tx.oncomplete?.();
        });
        return tx;
      },
    };
  }
  return {
    databases,
    open(name, version) {
      const req = request();
      later(() => {
        let state = databases.get(name);
        const fresh = !state;
        if (fresh) {
          state = { version, stores: new Map() };
          databases.set(name, state);
        }
        req.result = makeDb(state);
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test('indexedDbArea: get / set / remove like a chrome.storage area, get(null) lists everything', async () => {
  const factory = fakeIndexedDb();
  const vault = indexedDbArea({ factory });
  await vault.set({ agentbuddy_key_openai: 'sk-1', agentbuddy_keyenc_anthropic: { v: 2, ct: 'x' } });
  assert.deepEqual(await vault.get('agentbuddy_key_openai'), { agentbuddy_key_openai: 'sk-1' });
  assert.deepEqual(await vault.get(['agentbuddy_key_openai', 'missing']), { agentbuddy_key_openai: 'sk-1' });
  assert.deepEqual(await vault.get(null), { agentbuddy_key_openai: 'sk-1', agentbuddy_keyenc_anthropic: { v: 2, ct: 'x' } });
  await vault.remove(['agentbuddy_key_openai']);
  assert.deepEqual(await vault.get(null), { agentbuddy_keyenc_anthropic: { v: 2, ct: 'x' } });
  assert.ok(factory.databases.has('agentbuddy_vault'));
  assert.equal(indexedDbArea({ factory: null }), null, 'no IndexedDB: no vault (and so no key on disk)');
});

test('the key store on a real-shaped vault: save, reload in a new page, remove', async () => {
  const factory = fakeIndexedDb();
  const areas = { local: fakeArea(), session: fakeArea(), vault: indexedDbArea({ factory }) };
  await createKeyStore(areas).save({ provider: 'openai', key: 'sk-in-idb', mode: 'local' });
  // Another page opens the same database.
  const again = createKeyStore({ ...areas, vault: indexedDbArea({ factory }) });
  assert.equal(await again.load('openai'), 'sk-in-idb');
  await again.remove('openai');
  assert.equal(await createKeyStore(areas).load('openai'), '');
});

test('chrome.storage.session is pinned shut to content scripts, and nothing opens it', () => {
  const root = path.join(__dirname, '..', 'src');
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && /TRUSTED_AND_UNTRUSTED_CONTEXTS/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  })(root);
  assert.deepEqual(offenders, [], 'session storage holds the unlocked key: it must stay closed to content scripts');
  const storage = fs.readFileSync(path.join(root, 'lib', 'storage.js'), 'utf8');
  assert.match(storage, /setAccessLevel\?\.\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
});

test('no content script imports the key store or the storage helpers (the key is read by extension pages only)', () => {
  const contentDir = path.join(__dirname, '..', 'src', 'content');
  const hits = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && /keyStore|lib\/storage\.js|agentbuddy_key/.test(fs.readFileSync(full, 'utf8'))) hits.push(full);
    }
  })(contentDir);
  assert.deepEqual(hits, []);
});
