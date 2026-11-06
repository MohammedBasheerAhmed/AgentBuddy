// "Since you last looked": what the browser keeps (src/lib/lastViewed.js), the one named exception to "store no ticket content"
// (docs/build-rules.md rule 7, docs/round4.md decision 3). Per instance, the sys_id, the table and the time; nothing else; at most 500,
// none older than 30 days; nothing read or written when the organisation's policy `rememberLastViewed` is false; listed and cleared by
// Settings > Stored data. The storage is injected (no chrome.*).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAST_VIEWED_KEY,
  MAX_AGE_DAYS,
  MAX_ENTRIES,
  cleanLastViewed,
  countLastViewed,
  createLastViewedStore,
  instanceOf,
  lastViewedAllowed,
  previousView,
} from '../src/lib/lastViewed.js';
import { STORED_DATA, clearAllStored, describeKey, storedCounts, summarizeStored } from '../src/lib/storedData.js';
import { effectiveSettings, mergePolicies, normalizePolicy, policyProblems } from '../src/policy/policy.js';

const DAY = 24 * 3600000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const ORIGIN = 'https://acme.service-now.com';
const OTHER = 'https://acme-test.service-now.com';
const id = (n) => n.toString(16).padStart(32, '0');
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const iso = (ms) => new Date(ms).toISOString();

/** A storage that keeps one value per key, counts its reads and writes, and can be told to fail. */
function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[LAST_VIEWED_KEY, structuredClone(initial)]]);
  const calls = { get: 0, set: 0 };
  return {
    data,
    calls,
    async get(key) {
      calls.get += 1;
      return data.has(key) ? structuredClone(data.get(key)) : undefined;
    },
    async set(key, value) {
      calls.set += 1;
      data.set(key, structuredClone(value));
    },
  };
}

test('the first time a ticket is shown there is no previous time; the next time there is, and it is the time it was shown', async () => {
  let clock = NOW;
  const storage = memoryStorage();
  const store = createLastViewedStore({ storage, now: () => clock });
  assert.equal(await store.seen({ href: `${ORIGIN}/incident.do?sys_id=${A}`, table: 'incident', sysId: A }), null, 'first visit');
  clock = NOW + 3 * 3600000;
  assert.equal(await store.seen({ instance: ORIGIN, table: 'incident', sysId: A.toUpperCase() }), NOW, 'the time of the first visit');
  clock = NOW + 5 * 3600000;
  assert.equal(await store.seen({ instance: ORIGIN, table: 'incident', sysId: A }), NOW + 3 * 3600000, 'and then the second');
  // Exactly this shape, and nothing else: no number, no title, no text, no names.
  assert.deepEqual(storage.data.get(LAST_VIEWED_KEY), { v: 1, instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW + 5 * 3600000) } } } });
});

test('per instance and per table: the same sys_id on another instance, or of another table, is another ticket', async () => {
  const storage = memoryStorage();
  const store = createLastViewedStore({ storage, now: () => NOW });
  await store.seen({ instance: ORIGIN, table: 'incident', sysId: A });
  assert.equal(await store.seen({ instance: OTHER, table: 'incident', sysId: A }), null, 'another instance');
  assert.equal(previousView(storage.data.get(LAST_VIEWED_KEY), { instance: ORIGIN, table: 'sc_req_item', sysId: A }, NOW), null, 'another table');
  assert.equal(previousView(storage.data.get(LAST_VIEWED_KEY), { instance: ORIGIN, table: 'incident', sysId: A }, NOW), NOW);
  assert.deepEqual(Object.keys(storage.data.get(LAST_VIEWED_KEY).instances).sort(), [ORIGIN, OTHER].sort());
});

test('an address, a table or a sys_id that is not a real one: nothing is read or written', async () => {
  const storage = memoryStorage();
  const store = createLastViewedStore({ storage, now: () => NOW });
  for (const bad of [
    { href: 'http://acme.service-now.com/x', table: 'incident', sysId: A },
    { href: 'https://user:pw@acme.service-now.com/', table: 'incident', sysId: A },
    { href: 'not a url', table: 'incident', sysId: A },
    { instance: ORIGIN, table: 'Incident; drop', sysId: A },
    { instance: ORIGIN, table: 'incident', sysId: 'INC0010001' },
    { instance: ORIGIN, table: 'incident', sysId: '' },
    {},
  ]) {
    assert.equal(await store.seen(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(storage.calls, { get: 0, set: 0 });
  assert.equal(instanceOf('https://ACME.service-now.com/now/nav/ui/classic'), ORIGIN);
});

test('at most 500 tickets: the ones opened longest ago go first', async () => {
  const instances = { [ORIGIN]: {} };
  for (let i = 0; i < MAX_ENTRIES + 20; i += 1) instances[ORIGIN][id(i + 1)] = { table: 'incident', at: iso(NOW - (i + 1) * 60000) };
  const storage = memoryStorage({ v: 1, instances });
  const store = createLastViewedStore({ storage, now: () => NOW });
  assert.equal(MAX_ENTRIES, 500);
  assert.equal(await store.count(), 500, 'what is read is capped too');
  await store.seen({ instance: ORIGIN, table: 'incident', sysId: A });
  const kept = storage.data.get(LAST_VIEWED_KEY).instances[ORIGIN];
  assert.equal(Object.keys(kept).length, 500);
  assert.ok(kept[A], 'the ticket opened now is kept');
  assert.ok(kept[id(1)] && kept[id(499)], 'the newest of the others are kept');
  assert.ok(!kept[id(500)] && !kept[id(MAX_ENTRIES + 20)], 'the oldest went');
});

test('none older than 30 days: an old visit is a first visit again, and old entries are dropped when anything is written', async () => {
  assert.equal(MAX_AGE_DAYS, 30);
  const storage = memoryStorage({
    v: 1,
    instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW - 31 * DAY) }, [B]: { table: 'incident', at: iso(NOW - 29 * DAY) } } },
  });
  const store = createLastViewedStore({ storage, now: () => NOW });
  assert.equal(await store.count(), 1);
  assert.equal(await store.seen({ instance: ORIGIN, table: 'incident', sysId: A }), null, 'too old to say "since you looked"');
  const kept = storage.data.get(LAST_VIEWED_KEY).instances[ORIGIN];
  assert.deepEqual(Object.keys(kept).sort(), [A, B]);
  assert.equal(kept[A].at, iso(NOW));
});

test('a hand-edited or damaged value is dropped entry by entry, never repaired; a newer version is left alone', async () => {
  const value = {
    v: 1,
    instances: {
      [ORIGIN]: {
        [A]: { table: 'incident', at: iso(NOW - DAY), number: 'INC0010001', title: 'VPN drops' }, // extra parts are not kept
        [B.toUpperCase()]: { table: 'incident', at: iso(NOW - DAY) }, // a key that is not written the way the store writes it
        [id(3)]: { table: 'Incident', at: iso(NOW - DAY) },
        [id(4)]: { table: 'incident', at: 'yesterday' },
        [id(5)]: { table: 'incident', at: iso(NOW + 2 * DAY) }, // far in the future
        [id(6)]: 'incident',
        __proto__: { table: 'incident', at: iso(NOW) },
      },
      'acme.service-now.com': { [id(7)]: { table: 'incident', at: iso(NOW - DAY) } }, // not an origin
      'https://Other.example': { [id(8)]: { table: 'incident', at: iso(NOW - DAY) } },
    },
  };
  assert.deepEqual(cleanLastViewed(value, NOW), { v: 1, instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW - DAY) } } } });
  for (const junk of [undefined, null, 'x', 7, [], { v: 1 }, { v: 1, instances: [] }, { instances: { [ORIGIN]: {} } }]) {
    assert.deepEqual(cleanLastViewed(junk, NOW), { v: 1, instances: {} }, JSON.stringify(junk));
    assert.equal(countLastViewed(junk, NOW), 0);
  }
  const newer = { v: 2, instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW - DAY) } } }, more: true };
  const storage = memoryStorage(newer);
  assert.equal(await createLastViewedStore({ storage, now: () => NOW }).seen({ instance: ORIGIN, table: 'incident', sysId: A }), null);
  assert.deepEqual(storage.data.get(LAST_VIEWED_KEY), newer, 'not this version\'s to rewrite');
});

test('the policy turns it off: nothing is read or written, not even when it changes on the way', async () => {
  const storage = memoryStorage({ v: 1, instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW - DAY) } } } });
  let allowed = false;
  const store = createLastViewedStore({ storage, now: () => NOW, enabled: () => allowed });
  assert.equal(await store.seen({ instance: ORIGIN, table: 'incident', sysId: A }), null);
  assert.deepEqual(storage.calls, { get: 0, set: 0 });
  allowed = true;
  assert.equal(await store.seen({ instance: ORIGIN, table: 'incident', sysId: A }), NOW - DAY);
  // The key: true unless a real false; a person cannot loosen it; two policies keep the stricter side.
  assert.equal(normalizePolicy({}).rememberLastViewed, true);
  assert.equal(normalizePolicy({ rememberLastViewed: false }).rememberLastViewed, false);
  for (const v of [true, 'false', 0, null, 'no', {}]) assert.equal(normalizePolicy({ rememberLastViewed: v }).rememberLastViewed, true, JSON.stringify(v));
  assert.equal(lastViewedAllowed(normalizePolicy({ rememberLastViewed: false })), false);
  assert.equal(lastViewedAllowed(normalizePolicy({})), true);
  assert.equal(lastViewedAllowed(undefined), true, 'no policy at all is the normal case');
  assert.equal(effectiveSettings({ rememberLastViewed: true }, { rememberLastViewed: false }).policy.rememberLastViewed, false);
  assert.equal(mergePolicies(normalizePolicy({ rememberLastViewed: false }), {}).rememberLastViewed, false);
  assert.equal(mergePolicies(normalizePolicy({}), { rememberLastViewed: false }).rememberLastViewed, false);
  assert.equal(mergePolicies(normalizePolicy({}), {}).rememberLastViewed, true);
  assert.deepEqual(policyProblems({ rememberLastViewed: false }), []);
  assert.match(policyProblems({ rememberLastViewed: 'no' })[0].message, /must be true or false; "no" is read as true/);
});

test('two panels at once: one write at a time, so neither undoes the other', async () => {
  const storage = memoryStorage();
  const store = createLastViewedStore({ storage, now: () => NOW });
  await Promise.all([store.seen({ instance: ORIGIN, table: 'incident', sysId: A }), store.seen({ instance: ORIGIN, table: 'incident', sysId: B })]);
  assert.deepEqual(Object.keys(storage.data.get(LAST_VIEWED_KEY).instances[ORIGIN]).sort(), [A, B]);
});

test('Settings > Stored data lists it with how many tickets, and "Clear everything" removes it', async () => {
  const item = STORED_DATA.find((i) => i.id === 'lastViewed');
  assert.deepEqual([item.area, item.keys], ['local', [LAST_VIEWED_KEY]]);
  assert.equal(item.title, 'Tickets you opened');
  assert.match(item.detail, /never its number, title, text or names/);
  assert.match(item.detail, /At most 500 tickets, none older than 30 days/);
  assert.equal(describeKey(LAST_VIEWED_KEY), item);
  const value = { v: 1, instances: { [ORIGIN]: { [A]: { table: 'incident', at: iso(NOW - DAY) }, [B]: { table: 'incident', at: iso(NOW - 40 * DAY) } } } };
  const counts = storedCounts({ [LAST_VIEWED_KEY]: value, agentbuddy_settings: {} }, NOW);
  assert.deepEqual(counts, { lastViewed: 1 }, 'only what is still remembered');
  const listed = summarizeStored([LAST_VIEWED_KEY], [], [], { counts }).find((i) => i.id === 'lastViewed');
  assert.deepEqual([listed.present, listed.count], [true, 1]);
  const nothing = summarizeStored([], [], [], { counts: storedCounts({}, NOW) }).find((i) => i.id === 'lastViewed');
  assert.deepEqual([nothing.present, nothing.count], [false, 0]);
  assert.equal(summarizeStored([LAST_VIEWED_KEY], []).find((i) => i.id === 'lastViewed').count, undefined, 'no count asked for: none given');
  // Clear everything: the key goes with every other agentbuddy_ key.
  const data = { [LAST_VIEWED_KEY]: value, agentbuddy_settings: {} };
  const local = {
    async get() {
      return { ...data };
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
  const done = await clearAllStored({ local });
  assert.deepEqual(done, { removed: { local: 2, session: 0 }, remaining: [] });
  assert.ok(!(LAST_VIEWED_KEY in data));
  // And the store's own clear empties it.
  const storage = memoryStorage(value);
  await createLastViewedStore({ storage, now: () => NOW }).clear();
  assert.equal(countLastViewed(storage.data.get(LAST_VIEWED_KEY), NOW), 0);
});
