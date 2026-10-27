import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_KEY, MAX_DONE_PER_RECORD, MAX_RECORDS, capRecords, cleanStore, createChecklistStore } from '../src/checks/checklistStore.js';
import { hashRecordId } from '../src/audit/auditLog.js';
import { stepId } from '../src/checks/checklist.js';

// The ticks live in session storage (memory only) under the salted record hash the audit log uses, and the ticked step ids are
// encrypted with a key made from the same salt. These tests keep that true: no raw record id, no plain step hash, nothing readable
// without the salt, and the same behaviour for the panel as before (it still gets plain step ids back).

const SALT = 'salt-for-tests-0123456789abcdef';

// A stand-in for chrome.storage.session: values are copied on the way in and out, like the real one.
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

const make = (opts = {}) => createChecklistStore({ salt: SALT, ...opts });
const id = (n) => n.toString(16).padStart(32, '0');
const hash = (n) => n.toString(16).padStart(8, '0');
const keyOf = (sysId, salt = SALT) => hashRecordId(sysId, salt);
const clock = () => {
  let t = 1000;
  return () => (t += 1);
};

test('ticks are saved under the salted record hash, encrypted, with a time and nothing else', async () => {
  const storage = fakeStorage();
  const store = make({ storage, now: () => 5000 });
  const a = stepId('Image the laptop');
  const b = stepId('Deliver the laptop');
  await store.set(id(1), a, true);
  await store.set(id(1), b, true);
  const key = await keyOf(id(1));
  assert.match(key, /^[0-9a-f]{12}$/, 'the same salted hash the audit log makes');
  assert.deepEqual(Object.keys(storage.data[CHECKLIST_KEY]), [key]);
  assert.deepEqual(Object.keys(storage.data[CHECKLIST_KEY][key]).sort(), ['at', 'ct', 'iv', 'v']);
  assert.equal(storage.data[CHECKLIST_KEY][key].at, 5000);
  assert.deepEqual(await store.load(id(1)), [a, b]);
  assert.deepEqual(await store.load(id(2)), []);
  // Neither the record id, nor a step hash, nor any step text is in what was written.
  const written = JSON.stringify(storage.data);
  assert.ok(!written.includes(id(1)), 'no raw record id');
  assert.ok(!written.includes(a) && !written.includes(b), 'no plain step hash');
  assert.ok(!/laptop/i.test(written), 'no step text');
  assert.deepEqual(Object.keys(JSON.parse(written)), [CHECKLIST_KEY]);
});

test('the record key and the stored list depend on the salt: another salt finds nothing', async () => {
  const storage = fakeStorage();
  await make({ storage }).set(id(1), hash(1), true);
  assert.deepEqual(await make({ storage }).load(id(1)), [hash(1)]);
  const other = createChecklistStore({ storage, salt: 'a-different-salt' });
  assert.deepEqual(await other.load(id(1)), [], 'the other salt hashes the record to another key');
  assert.notEqual(await keyOf(id(1)), await keyOf(id(1), 'a-different-salt'));
  // The same entry under the right key but the wrong salt cannot be read either.
  const key = await keyOf(id(1));
  const stolen = fakeStorage({ [CHECKLIST_KEY]: storage.data[CHECKLIST_KEY] });
  const asOther = createChecklistStore({ storage: stolen, salt: 'a-different-salt' });
  assert.deepEqual(await asOther.load(id(1)), []);
  assert.ok(key in stolen.data[CHECKLIST_KEY]);
});

test('an entry cannot be moved to another record: it is bound to its own key', async () => {
  const storage = fakeStorage();
  const store = make({ storage });
  await store.set(id(1), hash(1), true);
  const k1 = await keyOf(id(1));
  const k2 = await keyOf(id(2));
  storage.data[CHECKLIST_KEY][k2] = storage.data[CHECKLIST_KEY][k1];
  assert.deepEqual(await store.load(id(2)), [], 'the copy under another record decrypts to nothing');
  assert.deepEqual(await store.load(id(1)), [hash(1)]);
});

test('a damaged entry reads as no ticks and is replaced by the next tick', async () => {
  const storage = fakeStorage();
  const store = make({ storage });
  await store.set(id(1), hash(1), true);
  const key = await keyOf(id(1));
  storage.data[CHECKLIST_KEY][key].ct = 'AAAA' + storage.data[CHECKLIST_KEY][key].ct.slice(4);
  assert.deepEqual(await store.load(id(1)), []);
  assert.deepEqual(await store.set(id(1), hash(2), true), [hash(2)]);
  assert.deepEqual(await store.load(id(1)), [hash(2)]);
});

test('unticking removes the hash; unticking the last one removes the record from storage', async () => {
  const storage = fakeStorage();
  const store = make({ storage, now: clock() });
  await store.set(id(1), hash(1), true);
  await store.set(id(1), hash(2), true);
  assert.deepEqual(await store.set(id(1), hash(1), false), [hash(2)]);
  assert.deepEqual(await store.set(id(1), hash(2), false), []);
  assert.deepEqual(storage.data[CHECKLIST_KEY], {});
});

test('ticking the same step twice keeps one tick', async () => {
  const store = make({ storage: fakeStorage() });
  await store.set(id(1), hash(1), true);
  assert.deepEqual(await store.set(id(1), hash(1), true), [hash(1)]);
});

test('Clear ticks forgets one record and leaves the others', async () => {
  const storage = fakeStorage();
  const store = make({ storage, now: clock() });
  await store.set(id(1), hash(1), true);
  await store.set(id(2), hash(2), true);
  await store.clear(id(1));
  assert.deepEqual(await store.load(id(1)), []);
  assert.deepEqual(await store.load(id(2)), [hash(2)]);
  await store.clear(id(9)); // nothing to forget: no error
});

test('at most 200 records are kept; the one touched longest ago goes first', async () => {
  const storage = fakeStorage();
  const store = make({ storage, now: clock() });
  for (let n = 1; n <= MAX_RECORDS + 5; n += 1) await store.set(id(n), hash(n), true);
  const kept = Object.keys(storage.data[CHECKLIST_KEY]);
  assert.equal(kept.length, MAX_RECORDS);
  for (let n = 1; n <= 5; n += 1) assert.ok(!kept.includes(await keyOf(id(n))), `record ${n} was the oldest`);
  assert.ok(kept.includes(await keyOf(id(MAX_RECORDS + 5))));
  // Touching an old record makes it new again.
  await store.set(id(6), hash(99), true);
  await store.set(id(MAX_RECORDS + 6), hash(1), true);
  assert.ok(Object.keys(storage.data[CHECKLIST_KEY]).includes(await keyOf(id(6))));
  assert.ok(!Object.keys(storage.data[CHECKLIST_KEY]).includes(await keyOf(id(7))));
});

test('capRecords keeps the newest and returns the same object when there is room', () => {
  const entry = (n) => ({ v: 1, iv: 'AAAA', ct: 'AAAA', at: n });
  const small = { ['0'.repeat(11) + '1']: entry(1) };
  assert.equal(capRecords(small), small);
  const many = Object.fromEntries([1, 2, 3, 4].map((n) => ['0'.repeat(11) + n, entry(n)]));
  assert.deepEqual(Object.keys(capRecords(many, 2)).sort(), ['0'.repeat(11) + 3, '0'.repeat(11) + 4]);
});

test('a record keeps at most 100 ticks (the newest)', async () => {
  const store = make({ storage: fakeStorage() });
  for (let n = 1; n <= MAX_DONE_PER_RECORD + 10; n += 1) await store.set(id(1), hash(n), true);
  const done = await store.load(id(1));
  assert.equal(done.length, MAX_DONE_PER_RECORD);
  assert.ok(!done.includes(hash(1)));
  assert.ok(done.includes(hash(MAX_DONE_PER_RECORD + 10)));
});

test('whatever is already in storage is cleaned, never trusted: bad keys, bad entries, wrong shapes, the old raw-id format', async () => {
  const good = { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAA', at: 7 };
  const dirty = {
    aaaaaaaaaaaa: good,
    [id(1)]: { done: [hash(1)], at: 7 }, // the old format: a raw sys_id with plain hashes
    'not-a-key': good,
    bbbbbbbbbbbb: 'text',
    cccccccccccc: { v: 2, iv: 'AAAA', ct: 'AAAA', at: 1 },
    dddddddddddd: { v: 1, iv: 'not base64!', ct: 'AAAA', at: 1 },
    eeeeeeeeeeee: { v: 1, iv: 'AAAA' },
    ffffffffffff: null,
  };
  assert.deepEqual(cleanStore(dirty), { aaaaaaaaaaaa: good });
  for (const bad of [null, undefined, 'x', 3, []]) assert.deepEqual(cleanStore(bad), {});
  const storage = fakeStorage({ [CHECKLIST_KEY]: dirty });
  const store = make({ storage });
  assert.deepEqual(await store.load(id(1)), [], 'nothing is read from the old format');
  await store.set(id(6), hash(6), true);
  assert.deepEqual(Object.keys(storage.data[CHECKLIST_KEY]).sort(), ['aaaaaaaaaaaa', await keyOf(id(6))].sort(), 'the junk is dropped on the next write');
});

test('a bad record id or hash is refused before anything is written, and a store without a salt cannot be made', async () => {
  const storage = fakeStorage();
  const store = make({ storage });
  await assert.rejects(() => store.set('abc', hash(1), true), TypeError);
  await assert.rejects(() => store.load(''), TypeError);
  await assert.rejects(() => store.clear(undefined), TypeError);
  assert.deepEqual(await store.set(id(1), 'Image the laptop', true), [], 'step text is not a hash and is never stored');
  assert.deepEqual(storage.data, { [CHECKLIST_KEY]: {} });
  assert.throws(() => createChecklistStore({ storage }), TypeError);
  await assert.rejects(() => createChecklistStore({ storage, salt: async () => '' }).load(id(1)), TypeError);
});

test('the salt may come from an async function, and is asked for once', async () => {
  let asked = 0;
  const store = createChecklistStore({ storage: fakeStorage(), salt: async () => { asked += 1; return SALT; } });
  await store.set(id(1), hash(1), true);
  await store.set(id(1), hash(2), true);
  assert.deepEqual(await store.load(id(1)), [hash(1), hash(2)]);
  assert.equal(asked, 1);
});

test('save replaces the list, an empty list removes the record', async () => {
  const storage = fakeStorage();
  const store = make({ storage, now: () => 9 });
  assert.deepEqual(await store.save(id(1), [hash(1), hash(1), 'x', hash(2)]), [hash(1), hash(2)]);
  assert.deepEqual(await store.load(id(1)), [hash(1), hash(2)]);
  assert.equal(storage.data[CHECKLIST_KEY][await keyOf(id(1))].at, 9);
  await store.save(id(1), []);
  assert.deepEqual(storage.data[CHECKLIST_KEY], {});
});

test('quick clicks never undo each other: every change goes one at a time, through the lock', async () => {
  const storage = fakeStorage();
  // A storage with a slow read widens the window for a lost update.
  const slow = { ...storage, get: async (k) => { await new Promise((r) => setTimeout(r, 2)); return storage.get(k); }, set: storage.set };
  const locked = [];
  const store = make({ storage: slow, lock: async (fn) => { locked.push(1); return fn(); } });
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.set(id(1), hash(n), true)));
  assert.deepEqual((await store.load(id(1))).sort(), [1, 2, 3, 4, 5].map(hash).sort());
  assert.ok(locked.length >= 5);
});

test('a failing write rejects that call but the next one still works', async () => {
  let fail = true;
  const storage = fakeStorage();
  const flaky = { get: storage.get, set: async (o) => { if (fail) throw new Error('quota'); return storage.set(o); } };
  const store = make({ storage: flaky });
  await assert.rejects(() => store.set(id(1), hash(1), true), /quota/);
  fail = false;
  assert.deepEqual(await store.set(id(1), hash(2), true), [hash(2)]);
});
