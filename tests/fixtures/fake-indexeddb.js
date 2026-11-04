// A minimal in-memory IndexedDB: open with an upgrade, one object store, transactions whose requests finish in order and then
// complete. Enough to run indexedDbArea() (src/lib/keyStore.js, the key vault) as the browser would. (The same double as the one in
// tests/keystore.test.js.)
//
//   import { fakeIndexedDb, emptyFakeIndexedDb } from './fixtures/fake-indexeddb.js';
//   globalThis.indexedDB = fakeIndexedDb();   // before the first keyVault(): a page keeps the vault it opened first
export function fakeIndexedDb() {
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

/** Empty every store of a fake made by fakeIndexedDb(), keeping the databases (and the connections already open to them). */
export function emptyFakeIndexedDb(factory) {
  for (const db of factory.databases.values()) for (const store of db.stores.values()) store.clear();
}
