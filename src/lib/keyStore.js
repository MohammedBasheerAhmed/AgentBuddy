// Where the AI key lives. Three modes, chosen in settings and optionally forced by policy:
//   'local'      Agent Buddy's own database in this browser (IndexedDB of the extension's origin: the "vault"). It stays until
//                removed. Anyone or any malware that can read the browser profile on disk can read it. Fine for a personal key
//                with a spend cap.
//   'session'    chrome.storage.session: memory only, gone when the browser closes. Nothing is written to disk.
//   'encrypted'  the vault holds the key encrypted with a passphrase (PBKDF2-SHA256 -> AES-256-GCM). The decrypted key is held
//                in session storage after the passphrase is entered once, so it is asked once per browser session.
//
// Why not chrome.storage.local: a content script (the part of Agent Buddy that runs inside ServiceNow pages) can read
// chrome.storage.local. A content script is not the page's own scripts, but it runs in the page's process, so a compromised page
// process could reach it. The vault is the extension's own origin, which a content script cannot open, and chrome.storage.session
// is closed to content scripts unless setAccessLevel opens it (Agent Buddy never does; storage.js pins it shut). Keys saved by an
// earlier version in chrome.storage.local are moved into the vault the first time they are read.
//
// The key is only ever read by extension pages (side panel, options), and it is only ever sent to the provider it belongs to (see
// src/providers). The crypto is pure Web Crypto, so Node runs the tests.
//
// `areas` is { local, session, vault } with get/set/remove (the chrome.storage areas and indexedDbArea(), or fakes in tests).

/**
 * A key as pasted -> the key itself. People paste it with quotes around it, with "Bearer " in front, or with a line break at the
 * end; none of that is part of a key, and all of it makes the provider answer "invalid key". Whitespace inside a key is never valid.
 */
export function cleanKey(raw) {
  let text = String(raw ?? '').trim();
  text = text.replace(/^(['"`])(.*)\1$/s, '$2').trim();
  text = text.replace(/^bearer\s+/i, '');
  return text.replace(/\s+/g, '');
}

/** What may be shown about a key without showing it: the first and last four characters and the length (a short key shows only its length). */
export function keyPreview(key) {
  const text = String(key ?? '');
  if (!text) return { preview: '', length: 0 };
  return { preview: text.length >= 16 ? `${text.slice(0, 4)}…${text.slice(-4)}` : '', length: text.length };
}

// OWASP Password Storage Cheat Sheet (2023 and current): PBKDF2-HMAC-SHA256 with at least 600,000 iterations.
export const PBKDF2_ITERATIONS = 600000;
const MAX_ITERATIONS = 10000000; // a stored blob asking for more is damaged (and would freeze the page)
export const MIN_PASSPHRASE = 8;
const BLOB_VERSION = 2;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt `secret` with a passphrase. Returns a JSON-safe blob { v, iter, salt, iv, ct, aad }.
 * Every call draws a new random 16-byte salt, so every blob is encrypted under its own AES key, and a new random 12-byte IV: an IV
 * is never used twice with the same key. `bindTo` (the storage slot) is authenticated with the ciphertext (AES-GCM additional data),
 * so a blob copied into another provider's slot does not decrypt.
 */
export async function encryptSecret(secret, passphrase, iterations = PBKDF2_ITERATIONS, bindTo = '') {
  if (!passphrase) throw new Error('A passphrase is needed to encrypt the key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...(bindTo ? { additionalData: enc.encode(bindTo) } : {}) }, key, enc.encode(secret));
  return { v: BLOB_VERSION, iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct), aad: Boolean(bindTo) };
}

/** Decrypt a blob from encryptSecret (v1 blobs of earlier versions too). Throws a plain error for a wrong passphrase or a damaged blob. */
export async function decryptSecret(blob, passphrase, bindTo = '') {
  if (!blob || (blob.v !== 1 && blob.v !== BLOB_VERSION)) throw new Error('The stored key is in an unknown format.');
  const iterations = Number(blob.iter) || 310000; // v1 blobs were written with 310,000
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new Error('Wrong passphrase, or the stored key is damaged.');
  try {
    const key = await deriveKey(passphrase, unb64(blob.salt), iterations);
    const additional = blob.v === BLOB_VERSION && blob.aad && bindTo ? { additionalData: enc.encode(bindTo) } : {};
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), ...additional }, key, unb64(blob.ct));
    return dec.decode(plain);
  } catch {
    throw new Error('Wrong passphrase, or the stored key is damaged.');
  }
}

/** Is this blob older or weaker than what encryptSecret writes today? (It is re-encrypted the next time it is unlocked.) */
export const blobIsOutdated = (blob) => !blob || blob.v !== BLOB_VERSION || !blob.aad || !(Number(blob.iter) >= PBKDF2_ITERATIONS);

export const KEY_SLOT_PREFIX = 'agentbuddy_key_';
export const ENC_SLOT_PREFIX = 'agentbuddy_keyenc_';
// A time stamp in chrome.storage.local, changed whenever the vault changes: the other open pages (the side panel) listen to
// chrome.storage.onChanged, which IndexedDB does not fire. It holds no key and nothing about one.
export const KEY_CHANGED_KEY = 'agentbuddy_keyvault_stamp';
export const VAULT_DB = 'agentbuddy_vault';
const VAULT_STORE = 'keys';

const PROVIDER_RE = /^[a-z0-9_-]{1,40}$/;
const slot = (provider) => `${KEY_SLOT_PREFIX}${provider}`;
const encSlot = (provider) => `${ENC_SLOT_PREFIX}${provider}`;
const checkProvider = (provider) => {
  if (!PROVIDER_RE.test(String(provider || ''))) throw new Error('Unknown AI provider.');
};

const NO_VAULT = 'This browser does not let Agent Buddy keep the key in its own storage. Choose "Memory only" under "Where to keep the key".';

/**
 * @param {{ local, session, vault? }} areas
 * @param {{ requiredMode?: () => Promise<string|null> }} [options] requiredMode: the mode the organisation's policy forces (null =
 *   none). With 'session', a key found on disk is moved into memory and the disk copy removed; with 'encrypted', a plain key on disk
 *   is not used until the person chooses a passphrase for it (unlock()).
 */
export function createKeyStore(areas, { requiredMode = async () => null } = {}) {
  const get = async (area, key) => (area ? (await area.get(key))?.[key] : undefined);
  const required = async () => {
    try {
      return await requiredMode();
    } catch {
      return null;
    }
  };
  // Other open pages hear about a change to the vault through this stamp. A failure here only delays their refresh.
  const notify = async () => {
    try {
      await areas.local?.set({ [KEY_CHANGED_KEY]: Date.now() });
    } catch {
      /* the next storage change refreshes them */
    }
  };

  // A key an earlier version left in chrome.storage.local (readable by content scripts) moves into the vault, and the old copy goes.
  // It is the newest copy there is (nothing writes there any more), so like save() it replaces whatever else is kept for the provider.
  async function moveLegacy(provider) {
    if (!areas.vault || !areas.local) return;
    const found = await areas.local.get([slot(provider), encSlot(provider)]);
    const plain = found?.[slot(provider)];
    const blob = found?.[encSlot(provider)];
    if (!plain && !blob) return;
    const copy = {};
    if (plain) copy[slot(provider)] = plain;
    if (blob) copy[encSlot(provider)] = blob;
    await areas.vault.remove([slot(provider), encSlot(provider)]);
    await areas.session?.remove([slot(provider)]);
    await areas.vault.set(copy);
    await areas.local.remove([slot(provider), encSlot(provider)]);
    await notify();
  }

  // What is stored for this provider, wherever it is.
  async function read(provider) {
    checkProvider(provider);
    await moveLegacy(provider);
    return {
      memory: (await get(areas.session, slot(provider))) || '',
      disk: (await get(areas.vault, slot(provider))) || '',
      blob: (await get(areas.vault, encSlot(provider))) || null,
    };
  }

  const store = {
    /** Save a key in the given mode. Other modes' copies of the same provider key are removed. */
    async save({ provider, key, mode = 'local', passphrase = '' }) {
      checkProvider(provider);
      const trimmed = cleanKey(key);
      if (trimmed && mode === 'encrypted' && String(passphrase).length < MIN_PASSPHRASE) {
        throw new Error(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters. A longer one is safer.`);
      }
      if (trimmed && mode !== 'session' && !areas.vault) throw new Error(NO_VAULT);
      await store.remove(provider);
      if (!trimmed) return;
      if (mode === 'session') {
        await areas.session.set({ [slot(provider)]: trimmed });
      } else if (mode === 'encrypted') {
        await areas.vault.set({ [encSlot(provider)]: await encryptSecret(trimmed, passphrase, PBKDF2_ITERATIONS, encSlot(provider)) });
        // Unlocked for this browser session, so the passphrase is not asked again until the browser restarts.
        await areas.session.set({ [slot(provider)]: trimmed });
        await notify();
      } else {
        await areas.vault.set({ [slot(provider)]: trimmed });
        await notify();
      }
    },

    /** The key, or '' when none is stored, an encrypted one is still locked, or the policy's mode does not allow the stored copy. */
    async load(provider) {
      const { memory, disk, blob } = await read(provider);
      const want = await required();
      if (want === 'session') {
        // Memory only, by policy: the copy on disk moves into memory and is removed from disk.
        if (disk) {
          if (!memory) await areas.session.set({ [slot(provider)]: disk });
          await areas.vault.remove([slot(provider)]);
          await notify();
          return memory || disk;
        }
        if (blob && memory) {
          await areas.vault.remove([encSlot(provider)]);
          await notify();
        }
        return memory;
      }
      if (want === 'encrypted' && disk && !blob) return memory; // a plain copy on disk is not used: it needs a passphrase first
      return memory || disk || '';
    },

    /** Which mode the stored key uses: 'local' | 'session' | 'encrypted' | 'none'. */
    async mode(provider) {
      const { memory, disk, blob } = await read(provider);
      if (blob) return 'encrypted';
      if (disk) return 'local';
      if (memory) return 'session';
      return 'none';
    },

    /**
     * True when a saved key cannot be used until the passphrase is entered: an encrypted key not yet unlocked in this browser
     * session, or (when the policy requires encryption) a plain key on disk that still needs a passphrase.
     */
    async isLocked(provider) {
      const { memory, disk, blob } = await read(provider);
      if (blob) return !memory;
      return !memory && Boolean(disk) && (await required()) === 'encrypted';
    },

    /** The policy requires an encrypted key and the saved one is plain: unlock() with a new passphrase encrypts it. */
    async needsEncryption(provider) {
      const { disk, blob } = await read(provider);
      return Boolean(disk) && !blob && (await required()) === 'encrypted';
    },

    /**
     * Enter the passphrase once; the key is then kept in session storage. A blob written with older, weaker settings is
     * re-encrypted with today's. When the policy requires encryption and the saved key is plain, the passphrase encrypts it.
     */
    async unlock(provider, passphrase) {
      const { disk, blob } = await read(provider);
      if (!blob) {
        if (disk && (await required()) === 'encrypted') {
          await store.save({ provider, key: disk, mode: 'encrypted', passphrase });
          return true;
        }
        throw new Error('There is no encrypted key to unlock.');
      }
      const key = await decryptSecret(blob, passphrase, encSlot(provider));
      await areas.session.set({ [slot(provider)]: key });
      if (blobIsOutdated(blob)) {
        await areas.vault.set({ [encSlot(provider)]: await encryptSecret(key, passphrase, PBKDF2_ITERATIONS, encSlot(provider)) });
        await notify();
      }
      return true;
    },

    async remove(provider) {
      checkProvider(provider);
      await areas.local?.remove([slot(provider), encSlot(provider)]);
      await areas.vault?.remove([slot(provider), encSlot(provider)]);
      await areas.session.remove([slot(provider)]);
      if (areas.vault) await notify();
    },

    /** Switch an existing key to another mode (re-encrypts or moves it). */
    async changeMode({ provider, mode, passphrase = '' }) {
      const { memory, disk } = await read(provider);
      const key = memory || disk;
      if (!key) throw new Error('Unlock or enter the key first.');
      await store.save({ provider, key, mode, passphrase });
    },
  };
  return store;
}

/**
 * The vault: an object store in the extension's own IndexedDB, with the same get/set/remove shape as a chrome.storage area.
 * `factory` is the global indexedDB (a fake in tests). Returns null when the browser offers no IndexedDB.
 */
export function indexedDbArea({ name = VAULT_DB, factory = globalThis.indexedDB } = {}) {
  if (!factory) return null;
  let opening = null;
  const open = () => {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(VAULT_STORE)) request.result.createObjectStore(VAULT_STORE);
        };
        request.onsuccess = () => {
          const db = request.result;
          // Another page wants to change the database (a later version): let it, and open again next time.
          db.onversionchange = () => {
            db.close();
            opening = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('The key store could not be opened.'));
        request.onblocked = () => reject(new Error('The key store is in use by another window. Close other Agent Buddy settings pages and try again.'));
      }).catch((err) => {
        opening = null;
        throw err;
      });
    }
    return opening;
  };
  // One transaction; `work(store)` queues the requests and returns a function that gives the result once all of them are done.
  const run = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE, mode);
      const result = work(tx.objectStore(VAULT_STORE));
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error || new Error('The key store could not be read or written.'));
      tx.onabort = () => reject(tx.error || new Error('The key store could not be read or written.'));
    });
  };
  return {
    async get(keys) {
      return run('readonly', (store) => {
        const out = {};
        if (keys === null || keys === undefined) {
          const names = store.getAllKeys();
          const values = store.getAll();
          // Requests in one transaction finish in order, so the names are there when the values arrive.
          values.onsuccess = () => names.result.forEach((key, i) => {
            out[key] = values.result[i];
          });
        } else {
          for (const key of [].concat(keys)) {
            const request = store.get(key);
            request.onsuccess = () => {
              if (request.result !== undefined) out[key] = request.result;
            };
          }
        }
        return () => out;
      });
    },
    async set(items) {
      return run('readwrite', (store) => {
        for (const [key, value] of Object.entries(items || {})) store.put(value, key);
        return () => undefined;
      });
    },
    async remove(keys) {
      return run('readwrite', (store) => {
        for (const key of [].concat(keys)) store.delete(key);
        return () => undefined;
      });
    },
  };
}
