// W-03 and W-20 of the audit of 2026-11-07: the roles the bridge reads. A list is "the page said", an empty list is "asked, and none of
// them", null is "the page could not say" and must never be read as "no roles". Only the page is asked (never REST), a fixed list of
// names is asked with hasRoleExactly (hasRole is true for every name when the person is an admin), and nothing is built from page data.
const test = require('node:test');
const assert = require('node:assert/strict');
import { BRIDGE_SOURCE, loadBridge } from './bridge-fixtures.js';

const USER = { userName: 'abel', userID: 'a'.repeat(32), firstName: 'Abel', lastName: 'Tuter' };
const rolesOf = (g_user, extra = {}) => loadBridge({ g_user, ...extra }).ask('getSessionInfo');

test('g_user.roles as an array, or as a comma list, is a list of names', () => {
  assert.deepEqual(rolesOf({ ...USER, roles: ['itil', 'sn_incident_write'] }).roles, ['itil', 'sn_incident_write']);
  assert.deepEqual(rolesOf({ ...USER, roles: 'itil, catalog_admin ,,' }).roles, ['itil', 'catalog_admin']);
});

test('without the roles property, getRoles() gives every role the person holds', () => {
  assert.deepEqual(rolesOf({ ...USER, getRoles: () => ['itil', 'sn_customerservice_agent'] }).roles, ['itil', 'sn_customerservice_agent']);
  assert.deepEqual(rolesOf({ ...USER, getRoles: () => 'itil,knowledge' }).roles, ['itil', 'knowledge']);
});

test('with only hasRoleExactly, a FIXED list of names is asked, exactly, and the ones that are true come back', () => {
  const asked = [];
  const held = new Set(['itil', 'sn_hr_core.case_writer']);
  const info = rolesOf({
    ...USER,
    hasRoleExactly: (name) => (asked.push(name), held.has(name)),
    hasRole: () => {
      throw new Error('hasRole is true for every name when the person is an admin: it must not be used');
    },
  });
  assert.deepEqual(info.roles, ['itil', 'sn_hr_core.case_writer']);
  assert.ok(asked.length >= 15 && asked.length <= 40, `a short fixed list (${asked.length} names)`);
  assert.ok(asked.every((name) => /^[a-z][a-z0-9_.]*$/.test(name)), 'plain role names only');
  for (const name of ['itil', 'itil_admin', 'sn_incident_write', 'sn_customerservice_agent', 'approver_user', 'admin']) assert.ok(asked.includes(name), name);
  assert.equal(new Set(asked).size, asked.length, 'each name once');
});

test('an admin: hasRole says yes to everything, hasRoleExactly only to what is held, and only the second is asked', () => {
  const info = rolesOf({ ...USER, hasRole: () => true, hasRoleExactly: (name) => name === 'admin' });
  assert.deepEqual(info.roles, ['admin']);
});

test('a person who holds none of the listed roles gets an EMPTY list (asked, and none), not null', () => {
  assert.deepEqual(rolesOf({ ...USER, hasRoleExactly: () => false }).roles, []);
});

test('the page could not say: null, never an empty list (unknown is not "no roles")', () => {
  assert.equal(rolesOf({ ...USER }).roles, null, 'a g_user with no roles at all');
  assert.equal(rolesOf({ ...USER, roles: '' }).roles, null);
  assert.equal(rolesOf({ ...USER, roles: 7 }).roles, null);
  assert.equal(rolesOf({ ...USER, getRoles: () => undefined }).roles, null);
  assert.equal(rolesOf({ ...USER, getRoles: () => { throw new Error('not here'); } }).roles, null, 'a call that fails is not an answer');
  assert.equal(rolesOf({ ...USER, hasRoleExactly: () => { throw new Error('not here'); } }).roles, null, 'every name failing is not "none of them"');
});

test('an empty list from the roles property is weak: the other ways are asked, and an empty list stands only when nothing else exists', () => {
  assert.deepEqual(rolesOf({ ...USER, roles: [], hasRoleExactly: (name) => name === 'itil' }).roles, ['itil']);
  assert.deepEqual(rolesOf({ ...USER, roles: [], getRoles: () => ['knowledge'] }).roles, ['knowledge']);
  assert.deepEqual(rolesOf({ ...USER, roles: [] }).roles, []);
});

test('a page that answers with odd values cannot push anything but short plain names into the panel', () => {
  const info = rolesOf({ ...USER, roles: ['itil', { toString: () => 'x'.repeat(500) }, ...Array.from({ length: 300 }, (_, i) => `r${i}`)] });
  assert.ok(info.roles.length <= 200);
  assert.ok(info.roles.every((r) => typeof r === 'string' && r.length <= 80));
  // hasRoleExactly answers that are not exactly true do not count
  assert.deepEqual(rolesOf({ ...USER, hasRoleExactly: (name) => (name === 'itil' ? 'yes' : name === 'admin' ? 1 : false) }).roles, []);
});

test('no g_user at all: there is no one to ask, and the answer says so', () => {
  assert.equal(loadBridge({}).ask('getSessionInfo'), null);
});

test('a portal page: the roles of the user on NOW come the same way, and are null when it carries none', () => {
  const portal = (user) => loadBridge({ pathname: '/sp', NOW: { user } }).ask('getSessionInfo');
  assert.deepEqual(portal({ userID: 'b'.repeat(32), userName: 'sam', roles: 'itil,knowledge' }).roles, ['itil', 'knowledge']);
  assert.equal(portal({ userID: 'b'.repeat(32), userName: 'sam' }).roles, null);
});

test('roles are read from the page alone: no request of any kind, no roles table, and the names asked are literals of the file', () => {
  assert.ok(!/sys_user_has_role|sys_user_role|XMLHttpRequest|\bfetch\(|\.hasRole\(/.test(BRIDGE_SOURCE), 'no REST, and never hasRole (true for an admin on every name)');
  const code = BRIDGE_SOURCE.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  const calls = code.match(/\.hasRoleExactly\([^)]*\)/g) || [];
  assert.deepEqual(calls, ['.hasRoleExactly(ROLE_PROBE[i])'], 'hasRoleExactly is only ever called with a name of the fixed list');
});
