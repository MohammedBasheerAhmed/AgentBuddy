import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_KEY, MAX_DONE_PER_RECORD, MAX_RECORDS, capRecords, cleanStore, createChecklistStore } from '../src/checks/checklistStore.js';
import { stepId } from '../src/checks/checklist.js';

// A stand-in for chrome.storage.local: values are copied on the way in and out, like the real one.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {};
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
  };
}

const id = (n) => n.toString(16).padStart(32, '0');
const hash = (n) => n.toString(16).padStart(8, '0');
const clock = () => {
  let t = 1000;
  return () => (t += 1);
};

test('ticks are saved under the record id as hashes and a time, and nothing else', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage, now: () => 5000 });
  const a = stepId('Image the laptop');
  const b = stepId('Deliver the laptop');
  await store.set(id(1), a, true);
  await store.set(id(1), b, true);
  assert.deepEqual(storage.data[CHECKLIST_KEY], { [id(1)]: { done: [a, b], at: 5000 } });
  assert.deepEqual(await store.load(id(1)), [a, b]);
  assert.deepEqual(await store.load(id(2)), []);
  // No step text, name or anything else is in what was written.
  const written = JSON.stringify(storage.data);
  assert.ok(!/laptop/i.test(written));
  assert.deepEqual(Object.keys(JSON.parse(written)), [CHECKLIST_KEY]);
  assert.deepEqual(Object.keys(storage.data[CHECKLIST_KEY][id(1)]).sort(), ['at', 'done']);
});

test('unticking removes the hash; unticking the last one removes the record from storage', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage, now: clock() });
  await store.set(id(1), hash(1), true);
  await store.set(id(1), hash(2), true);
  assert.deepEqual(await store.set(id(1), hash(1), false), [hash(2)]);
  assert.deepEqual(await store.set(id(1), hash(2), false), []);
  assert.deepEqual(storage.data[CHECKLIST_KEY], {});
});

test('ticking the same step twice keeps one tick', async () => {
  const store = createChecklistStore({ storage: fakeStorage() });
  await store.set(id(1), hash(1), true);
  assert.deepEqual(await store.set(id(1), hash(1), true), [hash(1)]);
});

test('Clear ticks forgets one record and leaves the others', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage, now: clock() });
  await store.set(id(1), hash(1), true);
  await store.set(id(2), hash(2), true);
  await store.clear(id(1));
  assert.deepEqual(await store.load(id(1)), []);
  assert.deepEqual(await store.load(id(2)), [hash(2)]);
  await store.clear(id(9)); // nothing to forget: no error
});

test('at most 200 records are kept; the one touched longest ago goes first', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage, now: clock() });
  for (let n = 1; n <= MAX_RECORDS + 5; n += 1) await store.set(id(n), hash(n), true);
  const kept = Object.keys(storage.data[CHECKLIST_KEY]);
  assert.equal(kept.length, MAX_RECORDS);
  for (let n = 1; n <= 5; n += 1) assert.ok(!kept.includes(id(n)), `record ${n} was the oldest`);
  assert.ok(kept.includes(id(MAX_RECORDS + 5)));
  // Touching an old record makes it new again.
  await store.set(id(6), hash(99), true);
  await store.set(id(MAX_RECORDS + 6), hash(1), true);
  assert.ok(Object.keys(storage.data[CHECKLIST_KEY]).includes(id(6)));
  assert.ok(!Object.keys(storage.data[CHECKLIST_KEY]).includes(id(7)));
});

test('capRecords keeps the newest and returns the same object when there is room', () => {
  const small = { [id(1)]: { done: [hash(1)], at: 1 } };
  assert.equal(capRecords(small), small);
  const many = Object.fromEntries([1, 2, 3, 4].map((n) => [id(n), { done: [hash(n)], at: n }]));
  assert.deepEqual(Object.keys(capRecords(many, 2)).sort(), [id(3), id(4)]);
});

test('a record keeps at most 100 ticks (the newest)', async () => {
  const store = createChecklistStore({ storage: fakeStorage() });
  for (let n = 1; n <= MAX_DONE_PER_RECORD + 10; n += 1) await store.set(id(1), hash(n), true);
  const done = await store.load(id(1));
  assert.equal(done.length, MAX_DONE_PER_RECORD);
  assert.ok(!done.includes(hash(1)));
  assert.ok(done.includes(hash(MAX_DONE_PER_RECORD + 10)));
});

test('whatever is already in storage is cleaned, never trusted: bad ids, bad hashes, wrong shapes', async () => {
  const dirty = {
    [id(1)]: { done: [hash(1), 'not-a-hash', 42, null, hash(1)], at: 7 },
    'not-a-sys-id': { done: [hash(2)], at: 8 },
    [id(2)]: 'text',
    [id(3)]: { done: 'nope', at: 9 },
    [id(4)]: { done: [], at: 10 },
    [id(5)]: null,
  };
  assert.deepEqual(cleanStore(dirty), { [id(1)]: { done: [hash(1)], at: 7 } });
  for (const bad of [null, undefined, 'x', 3, []]) assert.deepEqual(cleanStore(bad), {});
  const storage = fakeStorage({ [CHECKLIST_KEY]: dirty });
  const store = createChecklistStore({ storage });
  assert.deepEqual(await store.load(id(1)), [hash(1)]);
  await store.set(id(6), hash(6), true);
  assert.deepEqual(Object.keys(storage.data[CHECKLIST_KEY]).sort(), [id(1), id(6)].sort(), 'the junk is dropped on the next write');
});

test('a bad record id or hash is refused before anything is written', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage });
  await assert.rejects(() => store.set('abc', hash(1), true), TypeError);
  await assert.rejects(() => store.load(''), TypeError);
  await assert.rejects(() => store.clear(undefined), TypeError);
  assert.deepEqual(await store.set(id(1), 'Image the laptop', true), [], 'step text is not a hash and is never stored');
  assert.deepEqual(storage.data, { [CHECKLIST_KEY]: {} });
});

test('save replaces the list, an empty list removes the record', async () => {
  const storage = fakeStorage();
  const store = createChecklistStore({ storage, now: () => 9 });
  assert.deepEqual(await store.save(id(1), [hash(1), hash(1), 'x', hash(2)]), [hash(1), hash(2)]);
  assert.deepEqual(storage.data[CHECKLIST_KEY], { [id(1)]: { done: [hash(1), hash(2)], at: 9 } });
  await store.save(id(1), []);
  assert.deepEqual(storage.data[CHECKLIST_KEY], {});
});

test('quick clicks never undo each other: every change goes one at a time, through the lock', async () => {
  const storage = fakeStorage();
  // A storage with a slow read widens the window for a lost update.
  const slow = { ...storage, get: async (k) => { await new Promise((r) => setTimeout(r, 2)); return storage.get(k); }, set: storage.set };
  const locked = [];
  const store = createChecklistStore({ storage: slow, lock: async (fn) => { locked.push(1); return fn(); } });
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.set(id(1), hash(n), true)));
  assert.deepEqual((await store.load(id(1))).sort(), [1, 2, 3, 4, 5].map(hash).sort());
  assert.ok(locked.length >= 5);
});

test('a failing write rejects that call but the next one still works', async () => {
  let fail = true;
  const storage = fakeStorage();
  const flaky = { get: storage.get, set: async (o) => { if (fail) throw new Error('quota'); return storage.set(o); } };
  const store = createChecklistStore({ storage: flaky });
  await assert.rejects(() => store.set(id(1), hash(1), true), /quota/);
  fail = false;
  assert.deepEqual(await store.set(id(1), hash(2), true), [hash(2)]);
});
