import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPageState, reducePage, vetRecord } from '../src/sidepanel/pageState.js';
import { LAST_VIEWED_KEY, createLastViewedStore, scopeOf, userHash, worthRemembering } from '../src/lib/lastViewed.js';
const USER = 'd'.repeat(32);
import { lastViewedKey } from '../src/sidepanel/ticket/useNeeds.js';

// What the panel does with the record the page reports, and what it keeps about it (audit of 2026-11-07, part 2): a page that is not a
// ticket's never becomes the Ticket screen, and nothing about it is stored under "since you last looked".

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ORIGIN = 'https://dev364920.service-now.com';
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

// ---- vetRecord: the second look at what the content script said ------------------------------------------------------------------

test('vetRecord: a ticket\'s table, one of the organisation\'s families, or a record that carries a number is a record', () => {
  for (const record of [
    { table: 'incident', sysId: ID, number: '', kind: 'incident' },
    { table: 'kb_knowledge', sysId: ID, number: '', kind: 'knowledge' },
    { table: 'sn_hr_core_case', sysId: ID },
    { table: 'sn_si_incident', sysId: ID },
    { table: 'u_facilities_request', sysId: ID, number: 'FAC0001234', kind: 'other' },
  ]) {
    assert.equal(vetRecord(record), record, JSON.stringify(record));
  }
  const family = { table: 'x_acme_hr_case', sysId: ID };
  assert.equal(vetRecord(family), null);
  assert.equal(vetRecord(family, ['x_acme_hr_']), family);
});

test('vetRecord: a page of a UI page, a script, a user, the home page is no record, and neither is anything odd', () => {
  for (const record of [
    { table: 'ui_page', sysId: ID, number: '', kind: 'other' },
    { table: 'sys_ui_page', sysId: ID, number: '   ', kind: 'other' },
    { table: 'home', sysId: ID },
    { table: 'sys_user', sysId: ID, number: 42 },
    { table: 'u_facilities_request', sysId: ID },
    // not a record at all
    null, undefined, 'incident', 7, [], {}, { table: 'incident' }, { table: 'incident', sysId: '' }, { table: 5, sysId: ID }, { table: 'Not A Table', sysId: ID, number: '' },
  ]) {
    assert.equal(vetRecord(record), null, JSON.stringify(record));
  }
});

test('a copy of the content script from before an update still answers "ui_page": the panel shows the plain help, not the Ticket screen', () => {
  // what usePage builds from the answer: status record only when vetRecord keeps the record
  const answer = { href: `${ORIGIN}/ui_page.do?sys_id=${ID}`, surface: 'classic', record: { table: 'ui_page', sysId: ID, number: '', kind: 'other' }, newRecord: null };
  const record = vetRecord(answer.record);
  const state = reducePage(initialPageState(), { type: 'answer', page: { ...answer, record, status: record ? 'record' : 'no-record', tabId: 7 } });
  assert.equal(state.page.status, 'no-record');
  assert.equal(state.page.record, null);
});

// ---- "since you last looked" -----------------------------------------------------------------------------------------------------

test('worthRemembering: a ticket\'s table, a family, or a record the form proved; nothing else', () => {
  assert.equal(worthRemembering('incident'), true);
  assert.equal(worthRemembering('kb_knowledge'), true);
  assert.equal(worthRemembering('sn_si_task'), true);
  assert.equal(worthRemembering('ui_page'), false);
  assert.equal(worthRemembering('home'), false);
  assert.equal(worthRemembering('u_facilities_request'), false);
  assert.equal(worthRemembering('u_facilities_request', { proven: true }), true);
  assert.equal(worthRemembering('ui_page', { proven: 'yes' }), false, 'only a real true proves');
  assert.equal(worthRemembering('x_acme_hr_case', { extraPrefixes: ['x_acme_hr_'] }), true);
  for (const odd of [null, undefined, 5, '', 'Not A Table']) assert.equal(worthRemembering(odd, { proven: true }), false, String(odd));
});

function memory() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : undefined;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}

test('the store writes nothing for a page that is not a ticket\'s, and remembers a custom table only when the form proved it', async () => {
  const storage = memory();
  const store = createLastViewedStore({ storage, now: () => NOW });
  for (const table of ['ui_page', 'sys_ui_page', 'home', 'sys_user', 'u_facilities_request']) {
    assert.equal(await store.seen({ instance: ORIGIN, userId: USER, table, sysId: ID }), null, table);
  }
  assert.equal(storage.data.has(LAST_VIEWED_KEY), false, 'nothing was written');
  assert.equal(await store.seen({ instance: ORIGIN, userId: USER, table: 'u_facilities_request', sysId: ID, proven: true }), null);
  assert.deepEqual(storage.data.get(LAST_VIEWED_KEY), { v: 2, instances: { [scopeOf(ORIGIN, await userHash(USER, ORIGIN))]: { [ID]: { table: 'u_facilities_request', at: new Date(NOW).toISOString() } } } });
  // a ticket still works as before, and is told its previous time
  assert.equal(await store.seen({ instance: ORIGIN, userId: USER, table: 'incident', sysId: 'b'.repeat(32) }), null);
  assert.equal(await store.seen({ instance: ORIGIN, userId: USER, table: 'incident', sysId: 'b'.repeat(32) }), NOW);
});

test('the panel\'s key: only a ticket page gets one, and only when the policy and the address allow it', () => {
  const record = (over) => ({ table: 'incident', sysId: ID.toUpperCase(), number: '', ...over });
  const key = (over, rest = {}) => lastViewedKey({ allowed: true, instance: ORIGIN, userId: USER, record: record(over), ...rest });
  assert.equal(key({}), `${ORIGIN}|${USER}|incident|${ID}`);
  assert.equal(key({}, { userId: '' }), '', 'the page does not say who is signed in: whose time it would be is not known');
  assert.equal(key({ table: 'ui_page' }), '');
  assert.equal(key({ table: 'home', number: '' }), '');
  assert.equal(key({ table: 'u_facilities_request' }), '');
  assert.equal(key({ table: 'u_facilities_request', number: 'FAC0001234' }), `${ORIGIN}|${USER}|u_facilities_request|${ID}`);
  assert.equal(key({ table: 'x_acme_hr_case' }, { extraPrefixes: ['x_acme_hr_'] }), `${ORIGIN}|${USER}|x_acme_hr_case|${ID}`);
  assert.equal(key({}, { allowed: false }), '', 'the policy turns it off');
  assert.equal(key({}, { instance: '' }), '', 'no instance address');
  assert.equal(key({ sysId: 'nope' }), '');
  assert.equal(lastViewedKey({ allowed: true, instance: ORIGIN, record: null }), '');
});
