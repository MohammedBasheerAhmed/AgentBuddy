// Where the fulfilment-checklist ticks are kept: the browser's SESSION storage (chrome.storage.session: memory only, cleared when
// the browser closes, never written to disk), key `agentbuddy_checklists`:
//
//   { [recordKey]: { v: 1, iv, ct, at } }
//
//   recordKey  the salted hash of the record's sys_id: the same hash the audit log uses (src/audit/auditLog.js hashRecordId and
//              the salt in src/lib/storage.js). The sys_id itself is never stored, and the hash is useless without the salt.
//   iv, ct     the list of ticked step ids, encrypted (AES-GCM, key derived from the same salt, bound to the record key). A step id
//              is a 32-bit hash of the step's text; stored plainly it could be guessed for common steps ("create the account").
//              The list is not readable without the salt, and the store hands the panel the same step ids as before.
//   at         when the record was last touched (for dropping the oldest).
//
// That is ALL that is stored: never a step's text, a name or any other ticket content (build rule 7). At most MAX_RECORDS records
// are kept; the one touched longest ago is dropped first. Unticking every step removes the record's entry. Earlier versions kept
// the ticks in long-lived local storage under the raw sys_id: the panel deletes that copy (panelStore.js).
//
// The storage object is injected (chrome.storage.session in the panel, a fake in tests): get(key) -> Promise<{[key]: value}> and
// set({[key]: value}) -> Promise. `salt` is the audit salt (a string, or an async function that returns it). Reads and writes go one
// at a time through `lock` (navigator.locks in the panel) and an in-memory queue, so two quick clicks never undo each other.

import { SYS_ID_RE } from '../context/util.js';
import { hashRecordId } from '../audit/auditLog.js';

export const CHECKLIST_KEY = 'agentbuddy_checklists';
export const MAX_RECORDS = 200;
export const MAX_DONE_PER_RECORD = 100;

const HASH_RE = /^[0-9a-f]{8}$/;
const RECORD_KEY_RE = /^[0-9a-f]{12}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const cleanDone = (list) => [...new Set((Array.isArray(list) ? list : []).filter((h) => typeof h === 'string' && HASH_RE.test(h)))].slice(0, MAX_DONE_PER_RECORD);

/** Whatever was in storage, reduced to valid entries only (a bad value is dropped, never repaired by guessing). */
export function cleanStore(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (!RECORD_KEY_RE.test(key) || !entry || typeof entry !== 'object' || entry.v !== 1) continue;
    if (typeof entry.iv !== 'string' || typeof entry.ct !== 'string' || !B64_RE.test(entry.iv) || !B64_RE.test(entry.ct)) continue;
    out[key] = { v: 1, iv: entry.iv, ct: entry.ct, at: Number.isFinite(entry.at) ? entry.at : 0 };
  }
  return out;
}

/** The newest `max` records. */
export function capRecords(store, max = MAX_RECORDS) {
  const ids = Object.keys(store);
  if (ids.length <= max) return store;
  const keep = ids.sort((a, b) => store[b].at - store[a].at).slice(0, max);
  return Object.fromEntries(keep.map((id) => [id, store[id]]));
}

/**
 * @param {{ storage: { get: Function, set: Function }, salt: string | (() => Promise<string>), now?: () => number, lock?: (fn: () => Promise<any>) => Promise<any> }} deps
 */
export function createChecklistStore({ storage, salt, now = () => Date.now(), lock = (fn) => fn() }) {
  if (!salt) throw new TypeError('The checklist store needs the audit salt.');
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(() => lock(fn));
    queue = run.catch(() => {});
    return run;
  };

  let saltValue = null;
  let cryptoKey = null;
  const theSalt = async () => {
    if (saltValue === null) saltValue = String(typeof salt === 'function' ? await salt() : salt);
    if (!saltValue) throw new TypeError('The checklist store needs the audit salt.');
    return saltValue;
  };
  const theKey = async () => {
    if (!cryptoKey) {
      const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${await theSalt()}:checklist-ticks`));
      cryptoKey = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    return cryptoKey;
  };

  async function recordKey(sysId) {
    if (!SYS_ID_RE.test(sysId || '')) throw new TypeError('A checklist belongs to a record id.');
    return hashRecordId(sysId.toLowerCase(), await theSalt());
  }

  async function seal(key, done) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(key) }, await theKey(), enc.encode(JSON.stringify(done)));
    return { v: 1, iv: toB64(iv), ct: toB64(ct), at: now() };
  }

  // The ticked step ids of an entry; an entry that cannot be read (another salt, damaged) counts as having none.
  async function open(key, entry) {
    if (!entry) return [];
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(entry.iv), additionalData: enc.encode(key) }, await theKey(), fromB64(entry.ct));
      return cleanDone(JSON.parse(dec.decode(plain)));
    } catch {
      return [];
    }
  }

  async function readAll() {
    const got = await storage.get(CHECKLIST_KEY);
    return cleanStore(got?.[CHECKLIST_KEY]);
  }

  const writeAll = (store) => storage.set({ [CHECKLIST_KEY]: capRecords(store) });

  return {
    /** The ticked step ids of a record ([] for none). */
    load: async (sysId) => {
      const key = await recordKey(sysId);
      return serial(async () => open(key, (await readAll())[key]));
    },
    /** Replace the ticked step ids of a record; an empty list removes the entry. Returns what was saved. */
    save: async (sysId, done) => {
      const key = await recordKey(sysId);
      return serial(async () => {
        const store = await readAll();
        const clean = cleanDone(done);
        if (clean.length) store[key] = await seal(key, clean);
        else delete store[key];
        await writeAll(store);
        return clean;
      });
    },
    /** Tick or untick one step; returns the new ticked list. */
    set: async (sysId, hash, on) => {
      const key = await recordKey(sysId);
      return serial(async () => {
        const store = await readAll();
        const current = (await open(key, store[key])).filter((h) => h !== hash);
        const next = on && HASH_RE.test(hash) ? [...current, hash].slice(-MAX_DONE_PER_RECORD) : current;
        if (next.length) store[key] = await seal(key, next);
        else delete store[key];
        await writeAll(store);
        return next;
      });
    },
    /** Forget this record's ticks. */
    clear: async (sysId) => {
      const key = await recordKey(sysId);
      return serial(async () => {
        const store = await readAll();
        delete store[key];
        await writeAll(store);
      });
    },
  };
}
