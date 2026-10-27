// Where the fulfilment-checklist ticks are kept: chrome.storage.local, key `agentbuddy_checklists`:
//
//   { [recordSysId]: { done: [stepHash, ...], at: <ms> } }
//
// That is ALL that is stored: a record id and short hashes of ticked steps. Never a step's text, a name or any other ticket
// content (build rule 7). At most MAX_RECORDS records are kept; the one touched longest ago is dropped first. Unticking
// every step removes the record's entry.
//
// The storage object is injected (chrome.storage.local in the panel, a fake in tests): get(key) -> Promise<{[key]: value}>
// and set({[key]: value}) -> Promise. Reads and writes go one at a time through `lock` (navigator.locks in the panel) and an
// in-memory queue, so two quick clicks never undo each other.

import { SYS_ID_RE } from '../context/util.js';

export const CHECKLIST_KEY = 'agentbuddy_checklists';
export const MAX_RECORDS = 200;
export const MAX_DONE_PER_RECORD = 100;

const HASH_RE = /^[0-9a-f]{8}$/;

/** Whatever was in storage, reduced to valid entries only (a bad value is dropped, never repaired by guessing). */
export function cleanStore(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, entry] of Object.entries(value)) {
    if (!SYS_ID_RE.test(id) || !entry || typeof entry !== 'object') continue;
    const done = [...new Set((Array.isArray(entry.done) ? entry.done : []).filter((h) => typeof h === 'string' && HASH_RE.test(h)))].slice(0, MAX_DONE_PER_RECORD);
    const at = Number.isFinite(entry.at) ? entry.at : 0;
    if (done.length) out[id.toLowerCase()] = { done, at };
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
 * @param {{ storage: { get: Function, set: Function }, now?: () => number, lock?: (fn: () => Promise<any>) => Promise<any> }} deps
 */
export function createChecklistStore({ storage, now = () => Date.now(), lock = (fn) => fn() }) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(() => lock(fn));
    queue = run.catch(() => {});
    return run;
  };

  async function readAll() {
    const got = await storage.get(CHECKLIST_KEY);
    return cleanStore(got?.[CHECKLIST_KEY]);
  }

  const writeAll = (store) => storage.set({ [CHECKLIST_KEY]: capRecords(store) });

  function check(sysId) {
    if (!SYS_ID_RE.test(sysId || '')) throw new TypeError('A checklist belongs to a record id.');
    return sysId.toLowerCase();
  }

  return {
    /** The ticked step hashes of a record ([] for none). */
    load: async (sysId) => {
      const id = check(sysId);
      return serial(async () => (await readAll())[id]?.done || []);
    },
    /** Replace the ticked hashes of a record; an empty list removes the entry. Returns what was saved. */
    save: async (sysId, done) => {
      const id = check(sysId);
      return serial(async () => {
        const store = await readAll();
        const clean = [...new Set((done || []).filter((h) => typeof h === 'string' && HASH_RE.test(h)))].slice(0, MAX_DONE_PER_RECORD);
        if (clean.length) store[id] = { done: clean, at: now() };
        else delete store[id];
        await writeAll(store);
        return clean;
      });
    },
    /** Tick or untick one step; returns the new ticked list. */
    set: async (sysId, hash, on) => {
      const id = check(sysId);
      return serial(async () => {
        const store = await readAll();
        const current = (store[id]?.done || []).filter((h) => h !== hash);
        const next = on && HASH_RE.test(hash) ? [...current, hash].slice(-MAX_DONE_PER_RECORD) : current;
        if (next.length) store[id] = { done: next, at: now() };
        else delete store[id];
        await writeAll(store);
        return next;
      });
    },
    /** Forget this record's ticks. */
    clear: async (sysId) => {
      const id = check(sysId);
      return serial(async () => {
        const store = await readAll();
        delete store[id];
        await writeAll(store);
      });
    },
  };
}
