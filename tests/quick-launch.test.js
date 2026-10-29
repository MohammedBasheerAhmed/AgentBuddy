import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_TTL_MS, freshLaunch, launchIsForPage, makeLaunch } from '../src/lib/launch.js';

const SYS = 'a'.repeat(32);
const good = { tabId: 7, table: 'incident', sysId: SYS, featureId: 'record-summary', now: 1000 };

test('makeLaunch builds a request from valid parts', () => {
  assert.deepEqual(makeLaunch(good), { tabId: 7, table: 'incident', sysId: SYS, featureId: 'record-summary', at: 1000 });
});

test('makeLaunch lower-cases the sys_id and refuses every malformed part', () => {
  assert.equal(makeLaunch({ ...good, sysId: 'A'.repeat(32) }).sysId, SYS);
  const bad = [
    { tabId: -1 }, { tabId: 1.5 }, { tabId: '7' }, { tabId: undefined },
    { table: 'Incident' }, { table: 'a b' }, { table: '' }, { table: 'x'.repeat(10) + '-' }, { table: 5 },
    { sysId: 'a'.repeat(31) }, { sysId: 'g'.repeat(32) }, { sysId: '' }, { sysId: undefined },
    { featureId: 'Record-Summary' }, { featureId: '../x' }, { featureId: '' }, { featureId: 'a'.repeat(65) }, { featureId: 3 },
    { now: NaN }, { now: undefined },
  ];
  for (const patch of bad) assert.equal(makeLaunch({ ...good, ...patch }), null, JSON.stringify(patch));
});

test('freshLaunch accepts a request while it is young and refuses it once it is old', () => {
  const stored = makeLaunch(good);
  assert.deepEqual(freshLaunch(stored, 1000), stored);
  assert.deepEqual(freshLaunch(stored, 1000 + LAUNCH_TTL_MS), stored);
  assert.equal(freshLaunch(stored, 1000 + LAUNCH_TTL_MS + 1), null);
});

test('freshLaunch does not believe a time in the future, or a value that is not a request', () => {
  assert.equal(freshLaunch(makeLaunch({ ...good, now: 5000 }), 1000), null);
  for (const raw of [null, undefined, 'x', 4, [], {}, { ...makeLaunch(good), featureId: 'No Good' }, { ...makeLaunch(good), at: 'soon' }]) assert.equal(freshLaunch(raw, 1000), null);
  assert.equal(freshLaunch(makeLaunch(good), NaN), null);
});

test('launchIsForPage needs the same tab and the very same record', () => {
  const launch = makeLaunch(good);
  const page = { tabId: 7, record: { table: 'incident', sysId: SYS } };
  assert.equal(launchIsForPage(launch, page), true);
  assert.equal(launchIsForPage(launch, { ...page, record: { ...page.record, sysId: 'A'.repeat(32) } }), true, 'case does not matter');
  assert.equal(launchIsForPage(launch, { ...page, tabId: 8 }), false, 'another tab');
  assert.equal(launchIsForPage(launch, { ...page, record: { table: 'problem', sysId: SYS } }), false, 'another table');
  assert.equal(launchIsForPage(launch, { ...page, record: { table: 'incident', sysId: 'b'.repeat(32) } }), false, 'the next ticket');
  assert.equal(launchIsForPage(launch, { tabId: 7, record: null }), false);
  assert.equal(launchIsForPage(launch, null), false);
  assert.equal(launchIsForPage(null, page), false);
});
