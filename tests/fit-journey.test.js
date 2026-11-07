import test from 'node:test';
import assert from 'node:assert/strict';
import insightOps, { readFieldHistory } from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_META, INCIDENT_META_AR, withMeta } from './live-fixtures.js';

// Audit of 2026-11-07, I7: the labels of the states and priorities in the journey and in "Since you last looked" come in the person's
// own language, a retired choice still names an old value, and a value no list names is not given as "State 10".
// Wave 4 (live checks of 2026-11-07, docs/live-checks-2026-11-07.md): a plain agent cannot read the choice table (403 in every query
// shape), so the words come from the UI meta service instead (readTableMeta); the choice table is never asked.

const ID = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const GROUP = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const HR = 'sn_hr_core_case_payroll';

const audit = (field, oldvalue, newvalue, at) => ({ sys_id: `au${at}`, tablename: HR, documentkey: ID, fieldname: field, oldvalue, newvalue, sys_created_on: `2026-11-0${at} 10:00:00` });

// What the instance says for an HR case child in the person's language: its own retired state 10 is in the list, as the service gives it.
const HR_META = {
  result: {
    columns: {
      state: { label: 'State', choices: [{ value: '1', label: 'New' }, { value: '2', label: 'Work in Progress' }, { value: '10', label: 'Awaiting Info' }] },
      priority: { label: 'Priority', choices: [{ value: '3', label: '3 - Moderate' }] },
    },
  },
};
const HR_META_AR = {
  result: { columns: { state: { label: 'الحالة', choices: [{ value: '1', label: 'جديد' }, { value: '2', label: 'قيد العمل' }, { value: '10', label: 'Awaiting Info' }] }, priority: { label: 'الأولوية', choices: [{ value: '3', label: '3 - Moderate' }] } } },
};

function tables(over = {}) {
  return {
    sys_audit: [audit('state', '1', '10', 1), audit('state', '10', '2', 2), audit('priority', '3', '9', 3), audit('assignment_group', '', GROUP, 4)],
    sys_user_group: [],
    ...over,
  };
}

const read = (t, meta = HR_META, table = HR, options) => {
  const deps = withMeta(fakeDeps(t), { [table]: meta }, options);
  return readFieldHistory({ table, sysId: ID }, deps, new Map()).then((answer) => ({ answer, deps }));
};

test('I7: the labels are asked for once, from the table the ticket is in, for state and priority only; the choice table is never read', async () => {
  const { deps } = await read(tables());
  assert.deepEqual(deps.metaCalls, [{ table: HR, columns: ['state', 'priority'] }]);
  assert.equal(deps.callsTo('sys_choice').length, 0, 'a plain agent cannot read the choice table');
  // a ticket whose history holds only state changes asks for the state alone
  const onlyState = await read(tables({ sys_audit: [audit('state', '1', '2', 1)] }));
  assert.deepEqual(onlyState.deps.metaCalls, [{ table: HR, columns: ['state'] }]);
  // a history of group changes needs no labels at all
  const onlyGroups = await read(tables({ sys_audit: [audit('assignment_group', '', GROUP, 1)] }));
  assert.deepEqual(onlyGroups.deps.metaCalls, []);
});

test('I7: the words are the ones the instance gives in the person\'s language, retired choices included', async () => {
  const { answer } = await read(tables(), HR_META_AR);
  const states = answer.changes.filter((c) => c.field === 'state');
  assert.deepEqual(states.map((c) => [c.from, c.to]), [['جديد', 'Awaiting Info'], ['Awaiting Info', 'قيد العمل']], 'Arabic where the instance has it; its own wording otherwise');
  const english = await read(tables());
  assert.deepEqual(english.answer.changes.filter((c) => c.field === 'state').map((c) => [c.from, c.to]), [['New', 'Awaiting Info'], ['Awaiting Info', 'Work in Progress']]);
});

test('I7: a value no list names has no label and says so; a group the user cannot see likewise; an empty value is just empty', async () => {
  const { answer } = await read(tables());
  const priority = answer.changes.find((c) => c.field === 'priority');
  assert.equal(priority.from, '3 - Moderate');
  assert.equal(priority.to, '', 'no "Priority 9"');
  assert.equal(priority.toUnlabelled, true);
  const group = answer.changes.find((c) => c.field === 'assignment_group');
  assert.equal(group.from, '');
  assert.equal(group.fromUnlabelled, undefined, 'the group was empty before: that is not an unnamed one');
  assert.equal(group.to, '');
  assert.equal(group.toUnlabelled, true);
  assert.ok(!JSON.stringify(answer).match(/State \d|Priority \d|a group you cannot see|[0-9a-f]{32}/), 'no raw value, no English sentence of the panel, no id reaches the panel');
});

test('I7: when the words cannot be read at all, the ticket\'s own display value names the value it holds now, and nothing is made up for the rest', async () => {
  const incident = (extra = {}) => ({ sys_id: ID, state: v('2', 'In Progress'), priority: v('3', '3 - Moderate'), ...extra });
  const rows = [{ ...audit('state', '1', '77', 1), tablename: 'incident' }, { ...audit('state', '77', '2', 2), tablename: 'incident' }];
  for (const [name, options] of [['refused', { denied: ['incident'] }], ['the service is down', { failWith: Object.assign(new Error('x'), { code: 'SN_UNAVAILABLE' }) }]]) {
    const deps = withMeta(fakeDeps(tables({ sys_audit: rows, incident: [incident()] })), { incident: INCIDENT_META }, options);
    const bare = await readFieldHistory({ table: 'incident', sysId: ID }, deps, new Map());
    assert.deepEqual(bare.changes.map((c) => [c.from, c.to, Boolean(c.fromUnlabelled), Boolean(c.toUnlabelled)]), [['', '', true, true], ['', 'In Progress', true, false]], name);
    const ask = deps.callsTo('incident')[0];
    assert.deepEqual(ask.fields, ['sys_id', 'state'], 'only the fields that still need a word');
    assert.equal(ask.options.displayValue, true);
    assert.equal(ask.options.limit, 1);
  }
  // no display value of the ticket either: plain wording, never the code
  const none = withMeta(fakeDeps(tables({ sys_audit: rows })), {}, { denied: ['incident'] });
  const answer = await readFieldHistory({ table: 'incident', sysId: ID }, none, new Map());
  assert.deepEqual(answer.changes.map((c) => [c.from, c.to, c.fromUnlabelled, c.toUnlabelled]), [['', '', true, true], ['', '', true, true]]);
  assert.ok(!JSON.stringify(answer).match(/\b77\b|State \d/), 'the stored value is never given as a word');
  // a display value that is only the stored value again is no word
  const same = withMeta(fakeDeps(tables({ sys_audit: rows, incident: [incident({ state: v('2', '2') })] })), {}, { denied: ['incident'] });
  const echoed = await readFieldHistory({ table: 'incident', sysId: ID }, same, new Map());
  assert.equal(echoed.changes[1].to, '');
});

test('I7: the list names the value, so the ticket is not read again; a list without the value falls back to the ticket', async () => {
  const rows = [{ ...audit('state', '1', '2', 1), tablename: 'incident' }];
  const deps = withMeta(fakeDeps(tables({ sys_audit: rows, incident: [{ sys_id: ID, state: v('2', 'In Progress') }] })), { incident: INCIDENT_META });
  const answer = await readFieldHistory({ table: 'incident', sysId: ID }, deps, new Map());
  assert.deepEqual(answer.changes.map((c) => [c.from, c.to]), [['New', 'In Progress']]);
  assert.equal(deps.callsTo('incident').length, 0, 'the list named both values');
  // the list lacks value 2 (a customer\'s own list): the ticket holds it, so its display value names it
  const lacking = { result: { columns: { state: { label: 'State', choices: [{ value: '1', label: 'New' }] } } } };
  const second = withMeta(fakeDeps(tables({ sys_audit: rows, incident: [{ sys_id: ID, state: v('2', 'Being worked') }] })), { incident: lacking });
  const got = await readFieldHistory({ table: 'incident', sysId: ID }, second, new Map());
  assert.deepEqual(got.changes.map((c) => [c.from, c.to]), [['New', 'Being worked']]);
});

test('I7: the journey read needs no language and sends none to the instance; the words come from the service', async () => {
  const deps = withMeta(fakeDeps(tables({ sys_audit: [{ ...audit('state', '1', '2', 1), tablename: 'incident' }] })), { incident: INCIDENT_META_AR });
  const ctx = { deps, checkRecord, checkPack };
  const answer = await insightOps.journey({ table: 'incident', sysId: ID, language: 'ar' }, ctx);
  assert.equal(answer.available, true);
  assert.deepEqual(deps.metaCalls, [{ table: 'incident', columns: ['state'] }]);
  assert.equal(answer.changes[0].to, 'قيد التقدم');
  for (const call of deps.calls) assert.ok(!/language|sys_choice/.test(`${call.table} ${call.query}`), `${call.table}: ${call.query}`);
  // a hostile language changes nothing: it is not used
  for (const language of ['ar^ORname=task', null, 5, { a: 1 }]) {
    const again = withMeta(fakeDeps(tables({ sys_audit: [{ ...audit('state', '1', '2', 1), tablename: 'incident' }] })), { incident: INCIDENT_META });
    await insightOps.journey({ table: 'incident', sysId: ID, language }, { deps: again, checkRecord, checkPack });
    assert.ok(again.calls.every((call) => !String(call.query).includes('^ORname')), String(language));
  }
});
