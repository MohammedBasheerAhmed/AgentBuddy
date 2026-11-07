const test = require('node:test');
const assert = require('node:assert/strict');
import { cleanSessionInfo, getSessionUser, resetSessionUser } from '../src/content/sessionToken.js';
import { cleanPortal } from '../src/sidepanel/usePage.js';

const ID = 'a'.repeat(32);

// The content script talks to the page bridge through CustomEvents on `document`. Here the "page" answers getSessionInfo with
// whatever the test says (or does not answer at all).
function pageAnswers(sessionInfo) {
  const listeners = [];
  globalThis.document = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: (event) => {
      if (event.detail.action === 'getSessionInfo') {
        listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result: sessionInfo } }));
      }
      return true;
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  };
}

const rowsFor = (rows, calls = []) => async (...args) => {
  calls.push(args);
  return rows;
};

test('the answer from the page is reduced to id, user name, name and roles, and checked', () => {
  assert.deepEqual(cleanSessionInfo({ userId: ID.toUpperCase(), userName: ' beth ', firstName: 'Beth', lastName: 'Anglin', roles: ['itil', 7, '', 'x'.repeat(200)], extra: 'secret' }), {
    userId: ID,
    userName: 'beth',
    name: 'Beth Anglin',
    roles: ['itil', 'x'.repeat(80)],
  });
  assert.equal(cleanSessionInfo({ displayName: 'Abel Tuter' }).name, 'Abel Tuter');
  assert.equal(cleanSessionInfo({ firstName: 'A', displayName: 'Ignored' }).name, 'A');
  assert.equal(cleanSessionInfo({ userId: 'not-an-id' }).userId, '');
  assert.equal(cleanSessionInfo({ userId: 42, roles: 'itil' }).userId, '');
  assert.equal(cleanSessionInfo({ roles: 'itil' }).roles, null); // not a list: unknown, never 'none'
  for (const bad of [null, undefined, 'x', 7, []]) assert.deepEqual(cleanSessionInfo(bad), { userId: '', userName: '', name: '', roles: null });
});

test('when the page knows the user no read is made', async () => {
  resetSessionUser();
  pageAnswers({ userId: ID, userName: 'beth', firstName: 'Beth', lastName: 'Anglin', roles: ['itil'] });
  const calls = [];
  const user = await getSessionUser({ queryTable: rowsFor([], calls) });
  assert.equal(user.userId, ID);
  assert.equal(user.name, 'Beth Anglin');
  assert.equal(calls.length, 0);
});

test('when the page has no user id, one small read of the person\'s own row finds it, once for ten minutes', async () => {
  resetSessionUser();
  pageAnswers(null);
  const calls = [];
  const queryTable = rowsFor([{ sys_id: ID, user_name: 'beth', name: 'Beth Anglin' }], calls);
  const user = await getSessionUser({ queryTable });
  assert.equal(user.userId, ID);
  assert.equal(user.name, 'Beth Anglin');
  assert.equal(calls.length, 1);
  const [table, query, fields, options] = calls[0];
  assert.equal(table, 'sys_user');
  assert.equal(query, 'sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe'); // the dynamic filter "Me": no script is evaluated
  assert.deepEqual(fields, ['sys_id', 'user_name', 'name']); // nothing beyond id, user name and display name
  assert.deepEqual(options, { limit: 2 });
  await getSessionUser({ queryTable });
  await getSessionUser({ queryTable });
  assert.equal(calls.length, 1, 'cached');
});

test('requests that overlap share one read', async () => {
  resetSessionUser();
  pageAnswers(null);
  let calls = 0;
  const queryTable = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [{ sys_id: ID, user_name: 'beth', name: 'Beth Anglin' }];
  };
  const users = await Promise.all([getSessionUser({ queryTable }), getSessionUser({ queryTable }), getSessionUser({ queryTable })]);
  assert.equal(calls, 1);
  assert.ok(users.every((u) => u.userId === ID));
});

test('a user name from the page and the row must agree', async () => {
  resetSessionUser();
  pageAnswers({ userName: 'beth' });
  const user = await getSessionUser({ queryTable: rowsFor([{ sys_id: ID, user_name: 'someone.else', name: 'Someone Else' }]) });
  assert.equal(user.userId, '');
  resetSessionUser();
  const agrees = await getSessionUser({ queryTable: rowsFor([{ sys_id: ID, user_name: 'Beth', name: 'Beth Anglin' }]) });
  assert.equal(agrees.userId, ID);
});

test('a server that ignored the filter (several users listed) is not believed', async () => {
  resetSessionUser();
  pageAnswers(null);
  const calls = [];
  const queryTable = rowsFor([{ sys_id: ID, user_name: 'a' }, { sys_id: 'b'.repeat(32), user_name: 'b' }], calls);
  assert.equal((await getSessionUser({ queryTable })).userId, '');
  assert.equal((await getSessionUser({ queryTable })).userId, '');
  assert.equal(calls.length, 1, 'a failed attempt is not repeated for a minute');
  resetSessionUser();
  assert.equal((await getSessionUser({ queryTable: rowsFor([]) })).userId, '');
  resetSessionUser();
  assert.equal((await getSessionUser({ queryTable: rowsFor([{ sys_id: 'nope', user_name: 'a' }]) })).userId, '');
});

test('a denied or failing read leaves the user unknown instead of throwing', async () => {
  resetSessionUser();
  pageAnswers(null);
  const denied = Object.assign(new Error('403'), { code: 'ACCESS_DENIED' });
  const user = await getSessionUser({ queryTable: async () => { throw denied; } });
  assert.deepEqual(user, { userId: '', userName: '', name: '', roles: null });
});

test('without a way to read, the page answer is all there is', async () => {
  resetSessionUser();
  pageAnswers({ firstName: 'Only', lastName: 'Name' });
  assert.deepEqual(await getSessionUser(), { userId: '', userName: '', name: 'Only Name', roles: null });
});

test('the panel only accepts a well-formed portal description, and only on a portal page', () => {
  assert.deepEqual(cleanPortal({ base: '/esc', pageId: 'ticket' }, 'portal'), { base: '/esc', pageId: 'ticket' });
  assert.deepEqual(cleanPortal({ base: '/CSM', pageId: 'Csm_Ticket' }, 'portal'), { base: '/csm', pageId: 'csm_ticket' });
  assert.deepEqual(cleanPortal({ base: '/sp', pageId: '' }, 'portal'), { base: '/sp', pageId: '' });
  assert.equal(cleanPortal({ base: '/esc', pageId: 'ticket' }, 'classic'), null);
  assert.equal(cleanPortal({ base: '/esc', pageId: 'ticket' }, undefined), null);
  for (const bad of [null, undefined, 'x', 7, {}, { base: 'esc', pageId: 'a' }, { base: 'https://evil.example/', pageId: 'a' }, { base: '/a/b', pageId: 'a' }, { base: '/esc', pageId: '<b>' }, { base: '/esc', pageId: 'x'.repeat(200) }, { base: ['/esc'], pageId: 'a' }]) {
    assert.equal(cleanPortal(bad, 'portal'), null, JSON.stringify(bad));
  }
});
