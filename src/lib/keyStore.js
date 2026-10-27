// Where the AI key lives. Three modes, chosen in settings and optionally forced by policy:
//   'local'      chrome.storage.local, readable by this extension only (the default; same as NowBuddy). Anyone or any
//                malware that can read the browser profile can read it. Fine for a personal key with a spend cap.
//   'session'    chrome.storage.session: memory only, gone when the browser closes. Nothing is written to disk.
//   'encrypted'  chrome.storage.local, encrypted with a passphrase (PBKDF2 -> AES-GCM). The decrypted key is held in
//                session storage after the passphrase is entered once, so it is asked once per browser session.
//
// The key is only ever read by extension pages (side panel, options), never by content scripts or the web page, and it is
// only ever sent to the provider it belongs to (see src/providers). The crypto is pure Web Crypto, so Node runs the tests.
//
// `areas` is { local, session } with get/set/remove (the chrome.storage areas, or fakes in tests).

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

const PBKDF2_ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt `secret` with a passphrase. Returns a JSON-safe blob { v, iter, salt, iv, ct }. */
export async function encryptSecret(secret, passphrase, iterations = PBKDF2_ITERATIONS) {
  if (!passphrase) throw new Error('A passphrase is needed to encrypt the key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));
  return { v: 1, iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Decrypt a blob from encryptSecret. Throws a plain error for a wrong passphrase or a damaged blob. */
export async function decryptSecret(blob, passphrase) {
  if (!blob || blob.v !== 1) throw new Error('The stored key is in an unknown format.');
  try {
    const key = await deriveKey(passphrase, unb64(blob.salt), blob.iter || PBKDF2_ITERATIONS);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return dec.decode(plain);
  } catch {
    throw new Error('Wrong passphrase, or the stored key is damaged.');
  }
}

const slot = (provider) => `agentbuddy_key_${provider}`;
const encSlot = (provider) => `agentbuddy_keyenc_${provider}`;

export function createKeyStore(areas) {
  const get = async (area, key) => (await area.get(key))?.[key];

  return {
    /** Save a key in the given mode. Other modes' copies of the same provider key are removed. */
    async save({ provider, key, mode = 'local', passphrase = '' }) {
      const trimmed = cleanKey(key);
      await this.remove(provider);
      if (!trimmed) return;
      if (mode === 'session') {
        await areas.session.set({ [slot(provider)]: trimmed });
      } else if (mode === 'encrypted') {
        await areas.local.set({ [encSlot(provider)]: await encryptSecret(trimmed, passphrase) });
        // Unlocked for this browser session, so the passphrase is not asked again until the browser restarts.
        await areas.session.set({ [slot(provider)]: trimmed });
      } else {
        await areas.local.set({ [slot(provider)]: trimmed });
      }
    },

    /** The key, or '' when none is stored / an encrypted one is still locked. */
    async load(provider) {
      return (await get(areas.session, slot(provider))) || (await get(areas.local, slot(provider))) || '';
    },

    /** Which mode the stored key uses: 'local' | 'session' | 'encrypted' | 'none'. */
    async mode(provider) {
      if (await get(areas.local, encSlot(provider))) return 'encrypted';
      if (await get(areas.local, slot(provider))) return 'local';
      if (await get(areas.session, slot(provider))) return 'session';
      return 'none';
    },

    /** True when an encrypted key exists but has not been unlocked in this browser session. */
    async isLocked(provider) {
      return Boolean(await get(areas.local, encSlot(provider))) && !(await get(areas.session, slot(provider)));
    },

    /** Enter the passphrase once; the key is then kept in session storage. */
    async unlock(provider, passphrase) {
      const blob = await get(areas.local, encSlot(provider));
      if (!blob) throw new Error('There is no encrypted key to unlock.');
      const key = await decryptSecret(blob, passphrase);
      await areas.session.set({ [slot(provider)]: key });
      return true;
    },

    async remove(provider) {
      await areas.local.remove([slot(provider), encSlot(provider)]);
      await areas.session.remove([slot(provider)]);
    },

    /** Switch an existing key to another mode (re-encrypts or moves it). */
    async changeMode({ provider, mode, passphrase = '' }) {
      const key = await this.load(provider);
      if (!key) throw new Error('Unlock or enter the key first.');
      await this.save({ provider, key, mode, passphrase });
    },
  };
}
