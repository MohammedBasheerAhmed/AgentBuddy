// "Since you last looked" (round 4, docs/round4.md decision 3): when the agent last opened a ticket in the panel, so "Understand the
// ticket" can say what is new since then. The ONE named exception to build rule 7 (docs/build-rules.md): what is kept is the record's
// sys_id, its table and a time, per ServiceNow instance. No number, no title, no text, no names.
//
// chrome.storage.local, key `agentbuddy_last_viewed`:
//
//   { v: 1, instances: { 'https://acme.service-now.com': { '<32 hex sys_id>': { table: 'incident', at: '2026-11-06T09:14:03.000Z' } } } }
//
//   instance  the origin of the ServiceNow address in lower case (as instanceKey in src/reports/dashboards.js writes it): a sys_id
//             means nothing on another instance
//   table     the record's table (a plain identifier), so the entry can be told apart from a record of another table
//   at        when the panel last showed the record (ISO 8601, UTC)
//
// At most MAX_ENTRIES entries in all (the newest kept), none older than MAX_AGE_DAYS: both are applied every time the value is read
// or written, and a value that is not exactly this shape is dropped entry by entry, never repaired by guessing. Settings > Stored data
// lists it and "Clear everything" removes it (src/lib/storedData.js). The organisation's policy key `rememberLastViewed` (default
// true) turns it off: then nothing is read or written (the panel does not even ask).
//
// Pure given an injected storage ({ get(key) -> Promise<value>, set(key, value) -> Promise }); tests/understand-last-viewed.test.js.
// chromeLastViewedStore() is the real one, for extension pages only.

import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

export const LAST_VIEWED_KEY = 'agentbuddy_last_viewed';
export const LAST_VIEWED_VERSION = 1;
export const MAX_ENTRIES = 500;
export const MAX_AGE_DAYS = 30;
const DAY = 24 * 3600000;
const MAX_AGE_MS = MAX_AGE_DAYS * DAY;
// A clock a little ahead on another computer (or this one corrected since) is not a reason to drop an entry; a time far ahead is.
const SKEW_MS = 5 * 60000;
const MAX_INSTANCES = 20;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The organisation allows it: policy `rememberLastViewed` is not a real false. Unset (the normal case) is on. */
export const lastViewedAllowed = (policy) => policy?.rememberLastViewed !== false;

/**
 * The key an address is kept under: its origin in lower case ('https://acme.service-now.com'), or '' when it has none. The same rule
 * as instanceKey in src/reports/dashboards.js (not imported: this file is also read by Settings, which does not carry the reports).
 */
export function instanceOf(href) {
  try {
    const url = new URL(String(href || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin.toLowerCase() : '';
  } catch {
    return '';
  }
}

const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** One entry as stored, or null when any part of it is not right (or it is too old, or far in the future). */
function cleanEntry(sysId, entry, now) {
  if (!SYS_ID_RE.test(sysId) || sysId !== sysId.toLowerCase() || !isPlain(entry)) return null;
  const { table, at } = entry;
  if (typeof table !== 'string' || !TABLE_RE.test(table) || typeof at !== 'string' || !ISO_RE.test(at)) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms) || ms > now + SKEW_MS || now - ms > MAX_AGE_MS) return null;
  return { table, at: new Date(ms).toISOString(), ms };
}

/**
 * What is stored, cleaned: only valid entries, none older than MAX_AGE_DAYS, at most MAX_ENTRIES in all (the newest). Always the
 * current shape ({ v: 1, instances }); a value of a newer version is not understood and reads as empty (and is left alone: see
 * createLastViewedStore). Pure.
 * @param {unknown} value  @param {number} now
 * @returns {{ v: 1, instances: Record<string, Record<string, { table: string, at: string }>> }}
 */
export function cleanLastViewed(value, now) {
  const all = [];
  if (isPlain(value) && value.v === LAST_VIEWED_VERSION && isPlain(value.instances)) {
    for (const [instance, records] of Object.entries(value.instances)) {
      if (instanceOf(instance) !== instance || !isPlain(records)) continue;
      for (const [sysId, entry] of Object.entries(records)) {
        const clean = cleanEntry(sysId, entry, now);
        if (clean) all.push({ instance, sysId, ...clean });
      }
    }
  }
  // The newest first; the instance seen most recently keeps its place first too, and the oldest go when there are too many.
  all.sort((a, b) => b.ms - a.ms);
  const instances = {};
  for (const e of all.slice(0, MAX_ENTRIES)) {
    if (!own(instances, e.instance)) {
      if (Object.keys(instances).length >= MAX_INSTANCES) continue;
      instances[e.instance] = {};
    }
    instances[e.instance][e.sysId] = { table: e.table, at: e.at };
  }
  return { v: LAST_VIEWED_VERSION, instances };
}

/** How many tickets are remembered (what Settings shows). Pure. */
export function countLastViewed(value, now) {
  return Object.values(cleanLastViewed(value, now).instances).reduce((n, records) => n + Object.keys(records).length, 0);
}

/**
 * The previous time of one record, from what is stored: its time in ms, or null (never seen here, another table, or too old). Pure.
 * @param {unknown} value  @param {{ instance: string, table: string, sysId: string }} record  @param {number} now
 */
export function previousView(value, { instance, table, sysId }, now) {
  const entry = cleanLastViewed(value, now).instances[instance]?.[String(sysId || '').toLowerCase()];
  if (!entry || entry.table !== table) return null;
  return Date.parse(entry.at);
}

/** The record as the store takes it, or null when it is not one (a bad address, table or sys_id: nothing is read or written). */
function recordOf({ instance, href, table, sysId } = {}) {
  const origin = instance ? instanceOf(instance) : instanceOf(href);
  const id = String(sysId || '').toLowerCase();
  if (!origin || typeof table !== 'string' || !TABLE_RE.test(table) || !SYS_ID_RE.test(id)) return null;
  return { instance: origin, table, sysId: id };
}

/**
 * @param {{ storage: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *           now?: () => number, lock?: (fn: () => Promise<any>) => Promise<any>, enabled?: () => boolean }} deps
 *   enabled: asked before every read and write (the organisation's policy, as it is now); false: nothing is read or written
 */
export function createLastViewedStore({ storage, now = () => Date.now(), lock = (fn) => fn(), enabled = () => true }) {
  let queue = Promise.resolve();
  // One at a time (and through the browser's lock, when there is one): two panels on two tickets must not undo each other's write.
  const serial = (fn) => {
    const run = queue.then(() => lock(fn));
    queue = run.catch(() => {});
    return run;
  };
  const newer = (value) => isPlain(value) && Number(value.v) > LAST_VIEWED_VERSION;

  return {
    /**
     * The panel shows a record: the time it was shown before (ms), or null the first time (or when it is not remembered any more);
     * and from now on, now. Nothing is read or written when the policy turns it off or the record is not a valid one.
     * @param {{ instance?: string, href?: string, table: string, sysId: string }} input
     * @returns {Promise<number|null>}
     */
    async seen(input) {
      const record = recordOf(input);
      if (!record || !enabled()) return null;
      return serial(async () => {
        if (!enabled()) return null;
        const at = now();
        const stored = await storage.get(LAST_VIEWED_KEY);
        const previous = previousView(stored, record, at);
        // A value written by a newer version is left as it is (it is not this version's to rewrite).
        if (newer(stored)) return previous;
        const { instances } = cleanLastViewed(stored, at);
        const records = { ...(instances[record.instance] || {}), [record.sysId]: { table: record.table, at: new Date(at).toISOString() } };
        // (cleaned again: the cap and the age limit apply to what is written, the newest entries kept)
        await storage.set(LAST_VIEWED_KEY, cleanLastViewed({ v: LAST_VIEWED_VERSION, instances: { ...instances, [record.instance]: records } }, at));
        return previous;
      });
    },
    /** How many tickets are remembered now. */
    async count() {
      return countLastViewed(await storage.get(LAST_VIEWED_KEY), now());
    },
    /** Forget every ticket (Settings' "Clear everything" removes the key itself; this is the same for one area). */
    async clear() {
      return serial(async () => storage.set(LAST_VIEWED_KEY, { v: LAST_VIEWED_VERSION, instances: {} }));
    },
  };
}

/** The store on chrome.storage.local, with the browser's lock; null where there is no extension storage (a test without `chrome`). */
export function chromeLastViewedStore({ enabled = () => true } = {}) {
  const local = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
  if (!local) return null;
  const lock = typeof navigator !== 'undefined' && navigator.locks ? (fn) => navigator.locks.request('agentbuddy-last-viewed', fn) : undefined;
  return createLastViewedStore({
    storage: {
      get: async (key) => (await local.get(key))?.[key],
      set: (key, value) => local.set({ [key]: value }),
    },
    lock,
    enabled,
  });
}
