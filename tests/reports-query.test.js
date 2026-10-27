const test = require('node:test');
const assert = require('node:assert/strict');
import { buildQuery, escapeValue, QueryError, andQuery, presetConditions, normalizePresets, windowDaysOf, FILTER_PRESETS } from '../src/reports/engine/queryBuilder.js';
import { USER, GROUP_A, GROUP_B, NOW, DAY } from './reports-fixtures.js';

test('each condition type is written as ServiceNow expects', () => {
  assert.equal(buildQuery([{ op: 'true', field: 'active' }]), 'active=true');
  assert.equal(buildQuery([{ op: 'false', field: 'active' }]), 'active=false');
  assert.equal(buildQuery([{ op: 'eq', field: 'assigned_to', value: USER }]), `assigned_to=${USER}`);
  assert.equal(buildQuery([{ op: 'ne', field: 'state', value: '7' }]), 'state!=7');
  assert.equal(buildQuery([{ op: 'in', field: 'assignment_group', values: [GROUP_A, GROUP_B] }]), `assignment_groupIN${GROUP_A},${GROUP_B}`);
  assert.equal(buildQuery([{ op: 'notIn', field: 'state', values: ['6', '7'] }]), 'stateNOT IN6,7');
  assert.equal(buildQuery([{ op: 'empty', field: 'assigned_to' }]), 'assigned_toISEMPTY');
  assert.equal(buildQuery([{ op: 'notEmpty', field: 'resolved_at' }]), 'resolved_atISNOTEMPTY');
  assert.equal(buildQuery([{ op: 'since', field: 'opened_at', ms: NOW }]), 'opened_at>=2026-10-27 12:00:00');
  assert.equal(buildQuery([{ op: 'after', field: 'opened_at', ms: NOW - DAY }]), 'opened_at>2026-10-26 12:00:00');
  assert.equal(buildQuery([{ op: 'before', field: 'sys_updated_on', ms: NOW }]), 'sys_updated_on<2026-10-27 12:00:00');
  assert.equal(buildQuery([{ op: 'until', field: 'planned_end_time', ms: NOW }]), 'planned_end_time<=2026-10-27 12:00:00');
  assert.equal(buildQuery([{ op: 'gte', field: 'reassignment_count', value: 3 }]), 'reassignment_count>=3');
  assert.equal(buildQuery([{ op: 'gt', field: 'reopen_count', value: 0 }]), 'reopen_count>0');
  assert.equal(buildQuery([{ op: 'like', field: 'name', value: 'Service Desk' }]), 'nameLIKEService Desk');
});

test('conditions are joined with AND and an order can be added', () => {
  assert.equal(buildQuery([{ op: 'true', field: 'active' }, { op: 'empty', field: 'assigned_to' }], { orderBy: 'opened_at', descending: true }), 'active=true^assigned_toISEMPTY^ORDERBYDESCopened_at');
  assert.equal(buildQuery([], { orderBy: 'opened_at' }), 'ORDERBYopened_at');
  assert.equal(buildQuery([]), '');
  assert.equal(buildQuery(null), '');
  assert.equal(andQuery('a=1', '', 'b=2', undefined), 'a=1^b=2');
});

test('a caret in a value is doubled, so it can never start a new condition', () => {
  assert.equal(escapeValue('a^b'), 'a^^b');
  assert.equal(buildQuery([{ op: 'eq', field: 'category', value: 'x^assigned_to=1^ORDERBYname' }]), 'category=x^^assigned_to=1^^ORDERBYname');
  // The attack text stays inside ONE condition: splitting on single carets (not doubled ones) yields one part.
  const parts = buildQuery([{ op: 'eq', field: 'category', value: 'a^^b^c' }]).split(/(?<!\^)\^(?!\^)/);
  assert.equal(parts.length, 1);
});

test('values with control characters, javascript: or absurd length are refused', () => {
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: 'a\nb' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: 'a\u0000b' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: 'javascript:gs.log(1)' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: ' JavaScript : x' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: 'x'.repeat(300) }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'eq', field: 'category', value: '   ' }]), QueryError);
});

test('field names must be plain identifiers (dot-walking allowed)', () => {
  for (const field of ['a^b', 'a=b', 'a b', 'A', '1a', '', 'a;b', 'a.b.c.d', "a'", 'ORDERBY^x']) {
    assert.throws(() => buildQuery([{ op: 'true', field }]), QueryError, field);
  }
  assert.equal(buildQuery([{ op: 'true', field: 'task.active' }]), 'task.active=true');
  assert.throws(() => buildQuery([], { orderBy: 'a^b' }), QueryError);
});

test('IN lists accept sys_ids and safe tokens only, and are capped', () => {
  assert.throws(() => buildQuery([{ op: 'in', field: 'state', values: ['1', '2^x'] }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'in', field: 'state', values: ['1,2'] }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'in', field: 'state', values: [] }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'in', field: 'state', values: Array.from({ length: 101 }, (_, i) => String(i)) }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'in', field: 'state', values: ['javascript:1'] }]), QueryError);
});

test('dates and numbers must be real numbers', () => {
  assert.throws(() => buildQuery([{ op: 'since', field: 'opened_at', ms: 'yesterday' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'since', field: 'opened_at', ms: NaN }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'gte', field: 'reassignment_count', value: '3^x' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'gte', field: 'reassignment_count', value: Infinity }]), QueryError);
});

test('unknown operations and non-objects are refused or skipped', () => {
  assert.throws(() => buildQuery([{ op: 'script', field: 'active', value: 'x' }]), QueryError);
  assert.throws(() => buildQuery([{ op: '__proto__', field: 'active' }]), QueryError);
  assert.throws(() => buildQuery([{ op: 'toString', field: 'active' }]), QueryError);
  assert.equal(buildQuery([null, 'x', 5, { op: 'true', field: 'active' }]), 'active=true');
});

test('presets turn into conditions; unknown presets are dropped; only one time window', () => {
  assert.deepEqual(normalizePresets(['open', 'bogus', 'open', 'last_7', 'last_30', 'my_groups']), ['open', 'last_7', 'my_groups']);
  assert.deepEqual(normalizePresets('open'), []);
  assert.equal(windowDaysOf(['open', 'last_30']), 30);
  assert.equal(windowDaysOf(['open']), 0);
  const q = buildQuery(presetConditions(['open', 'assigned_to_me', 'my_groups', 'unassigned', 'last_7'], { userId: USER, groupIds: [GROUP_A], now: NOW }));
  assert.equal(q, `active=true^assigned_to=${USER}^assignment_groupIN${GROUP_A}^assigned_toISEMPTY^opened_at>=2026-10-20 12:00:00`);
  assert.equal(FILTER_PRESETS.length, 8);
});

test('presets that need an id or a group say so instead of building an open query', () => {
  assert.throws(() => presetConditions(['assigned_to_me'], { userId: '' }), /who is signed in/);
  assert.throws(() => presetConditions(['assigned_to_me'], { userId: 'nope' }), QueryError);
  assert.throws(() => presetConditions(['my_groups'], { groupIds: [] }), /not in any group/);
});
