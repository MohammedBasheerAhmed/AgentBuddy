// "Since you last looked" (round 4, docs/round4.md decision 3): when the agent last opened a ticket in the panel, so "Understand the
// ticket" can say what is new since then. The ONE named exception to build rule 7 (docs/build-rules.md): what is kept is the record's
// sys_id, its table and a time, per ServiceNow instance AND per signed-in person. No number, no title, no text, no names.
//
// chrome.storage.local, key `agentbuddy_last_viewed`:
//
//   { v: 2, instances: { 'https://acme.service-now.com|3f9c0a1b7d5e2c48': { '<32 hex sys_id>': { table: 'incident', at: '2026-11-06T09:14:03.000Z' } } } }
//
//   scope     the origin of the ServiceNow address in lower case (as instanceKey in src/reports/dashboards.js writes it), a vertical
//             bar, and the person: a short one-way hash of their user id (userHash below: the first 8 bytes of SHA-256 over the instance and
//             the id, as 16 hex characters). A sys_id means nothing on another instance, and what one person looked at is not what
//             another did on the same browser (audit of 2026-11-07, R-17): "changed since you last looked" is measured against the
//             visit of the person at the screen. The user id itself is never stored, and the hash cannot be turned back into it.
//             When the page does not say who is signed in, nothing is read or written.
//   table     the record's table (a plain identifier), so the entry can be told apart from a record of another table
//   at        when the panel last showed the record (ISO 8601, UTC)
//
// (Version 1 kept the times per instance only. They are not read: whose they were is not known. They age out, or "Clear everything"
// removes them, like the rest.)
//
// At most MAX_ENTRIES entries in all (the newest kept), none older than MAX_AGE_DAYS: both are applied every time the value is read
// or written, and a value that is not exactly this shape is dropped entry by entry, never repaired by guessing. Settings > Stored data
// lists it and "Clear everything" removes it (src/lib/storedData.js). The organisation's policy key `rememberLastViewed` (default
// true) turns it off: then nothing is read or written (the panel does not even ask).
//
// Pure given an injected storage ({ get(key) -> Promise<value>, set(key, value) -> Promise }); tests/understand-last-viewed.test.js.
// chromeLastViewedStore() is the real one, for extension pages only.

import { isTicketTable } from '../context/kinds.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

export const LAST_VIEWED_KEY = 'agentbuddy_last_viewed';
export const LAST_VIEWED_VERSION = 2;
export const MAX_ENTRIES = 500;
export const MAX_AGE_DAYS = 30;
const DAY = 24 * 3600000;
const MAX_AGE_MS = MAX_AGE_DAYS * DAY;
// A clock a little ahead on another computer (or this one corrected since) is not a reason to drop an entry; a time far ahead is.
const SKEW_MS = 5 * 60000;
const MAX_INSTANCES = 20;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const USER_HASH_RE = /^[0-9a-f]{16}$/;

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
 * The key one person's times on one instance are kept under: 'https://acme.service-now.com|3f9c0a1b7d5e2c48', or '' when the address
 * or the person's hash is not valid. `user` is a userHash result (never a user id).
 */
export function scopeOf(instance, user) {
  return instanceOf(instance) === instance && instance && USER_HASH_RE.test(String(user || '')) ? `${instance}|${user}` : '';
}

// A scope from storage back into its parts, or null when it is not exactly one.
function partsOf(scope) {
  const bar = String(scope).lastIndexOf('|');
  if (bar < 1) return null;
  const instance = scope.slice(0, bar);
  return scopeOf(instance, scope.slice(bar + 1)) === scope ? { instance, user: scope.slice(bar + 1) } : null;
}

/**
 * A short one-way hash of the signed-in person's user id on one instance: the first 8 bytes of SHA-256 over "instance|user id", as 16
 * hexadecimal characters ('' when either is missing). It is what tells two people on one browser profile apart in storage; the id
 * itself is never stored (build rule 7), and the hash cannot be turned back into it. Asynchronous (Web Crypto).
 */
export async function userHash(userId, instance) {
  const id = String(userId || '').trim().toLowerCase();
  const origin = instanceOf(instance);
  if (!id || !origin || typeof crypto === 'undefined' || !crypto.subtle) return '';
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${origin}|${id}`)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What is stored, cleaned: only valid entries, none older than MAX_AGE_DAYS, at most MAX_ENTRIES in all (the newest). Always the
 * current shape ({ v: 2, instances }, kept per instance and person: see the top); a value of another version is not understood and
 * reads as empty (and a newer one is left alone: see createLastViewedStore). Pure.
 * @param {unknown} value  @param {number} now
 * @returns {{ v: 2, instances: Record<string, Record<string, { table: string, at: string }>> }}
 */
export function cleanLastViewed(value, now) {
  const all = [];
  if (isPlain(value) && value.v === LAST_VIEWED_VERSION && isPlain(value.instances)) {
    for (const [instance, records] of Object.entries(value.instances)) {
      if (!partsOf(instance) || !isPlain(records)) continue;
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
 * The previous time of one record, from what is stored: its time in ms, or null (never seen here by this person, another table, or too
 * old). Pure.
 * @param {unknown} value  @param {{ instance: string, user: string, table: string, sysId: string }} record  user: a userHash result
 * @param {number} now
 */
export function previousView(value, { instance, user, table, sysId }, now) {
  const scope = scopeOf(instance, user);
  const entry = scope ? cleanLastViewed(value, now).instances[scope]?.[String(sysId || '').toLowerCase()] : null;
  if (!entry || entry.table !== table) return null;
  return Date.parse(entry.at);
}

/**
 * Is this record one to remember? A ticket's table (or a family of the organisation's: `extraPrefixes`), or a record the caller says
 * is a ticket because its form has a number (`proven`, a customer's own task table). The page of a UI page or the home page is not:
 * nothing about it is kept (audit of 2026-11-07, part 2).
 */
export function worthRemembering(table, { proven = false, extraPrefixes } = {}) {
  return typeof table === 'string' && TABLE_RE.test(table) && (proven === true || isTicketTable(table, { extraPrefixes }));
}

/** The record as the store takes it, or null when it is not one (a bad address, table or sys_id, or a page that is not a ticket: nothing is read or written). */
function recordOf({ instance, href, table, sysId, proven, extraPrefixes } = {}) {
  const origin = instance ? instanceOf(instance) : instanceOf(href);
  const id = String(sysId || '').toLowerCase();
  if (!origin || !worthRemembering(table, { proven, extraPrefixes }) || !SYS_ID_RE.test(id)) return null;
  return { instance: origin, table, sysId: id };
}

/**
 * @param {{ storage: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> },
 *           now?: () => number, lock?: (fn: () => Promise<any>) => Promise<any>, enabled?: () => boolean,
 *           hash?: (userId: string, instance: string) => Promise<string>|string }} deps
 *   enabled: asked before every read and write (the organisation's policy, as it is now); false: nothing is read or written
 *   hash: how a user id becomes the short hash kept in storage (userHash; a test may pass its own)
 */
export function createLastViewedStore({ storage, now = () => Date.now(), lock = (fn) => fn(), enabled = () => true, hash = userHash }) {
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
     * @param {{ instance?: string, href?: string, userId?: string, table: string, sysId: string, proven?: boolean, extraPrefixes?: string[] }} input
     *   proven / extraPrefixes: why a table the product does not know is still a ticket (see worthRemembering)
     *   userId: who is signed in, as the page said. Kept as a hash only; when it is missing nothing is read or written (whose time
     *   it would be is not known: R-17)
     * @returns {Promise<number|null>}
     */
    async seen(input) {
      const found = recordOf(input);
      if (!found || !enabled()) return null;
      const user = await hash(input?.userId, found.instance);
      const scope = scopeOf(found.instance, user);
      if (!scope) return null;
      const record = { ...found, user, scope };
      return serial(async () => {
        if (!enabled()) return null;
        const at = now();
        const stored = await storage.get(LAST_VIEWED_KEY);
        const previous = previousView(stored, record, at);
        // A value written by a newer version is left as it is (it is not this version's to rewrite).
        if (newer(stored)) return previous;
        const { instances } = cleanLastViewed(stored, at);
        const records = { ...(instances[record.scope] || {}), [record.sysId]: { table: record.table, at: new Date(at).toISOString() } };
        // (cleaned again: the cap and the age limit apply to what is written, the newest entries kept)
        await storage.set(LAST_VIEWED_KEY, cleanLastViewed({ v: LAST_VIEWED_VERSION, instances: { ...instances, [record.scope]: records } }, at));
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
