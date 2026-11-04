import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecordResolver } from '../src/content/recordResolver.js';

// Which record the page shows (src/content/recordResolver.js, used by src/content/index.js). Audit P2.25: a number's sys_id was taken
// from the first row without checking the row is that number (ServiceNow ignores a condition on a column the table does not have and
// answers with its first row). Audit P2.26: a `task` record whose real class could not be looked up was looked up again on every
// request (the bar asks every 2 seconds).

const INC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';
const BY_NUMBER = 'https://acme.service-now.com/incident.do?sysparm_query=number%3DINC0010001';
const TASK_ADDRESS = `https://acme.service-now.com/now/sow/record/task/${INC}`;

/** A resolver with a clock, a page with no form (unless `meta`), and reads that answer `answer(table, query)`. */
function setup(answer, { meta = null } = {}) {
  let clock = 1000;
  const reads = [];
  const policies = [];
  const resolver = makeRecordResolver({
    guardedDeps: async (policy) => {
      policies.push(policy);
      return {
        queryTable: async (table, query, fields) => {
          reads.push({ table, query, fields });
          return answer(table, query);
        },
      };
    },
    formMeta: async () => meta,
    now: () => clock,
  });
  return {
    ...resolver,
    reads,
    policies,
    later: (ms) => {
      clock += ms;
    },
  };
}

// ---- a number on the address --------------------------------------------------------------------------------------------------

test('a number on the address: the row must carry that number; then its sys_id is used and remembered', async () => {
  const page = setup(() => [{ sys_id: INC, number: 'INC0010001' }]);
  assert.deepEqual(await page.resolveRecord(BY_NUMBER, undefined, { blockedTables: ['x'] }), { table: 'incident', sysId: INC, number: 'INC0010001', kind: 'incident' });
  assert.deepEqual(page.reads, [{ table: 'incident', query: 'number=INC0010001', fields: ['sys_id', 'number'] }]);
  assert.deepEqual(page.policies, [{ blockedTables: ['x'] }], "the panel's policy goes to the guard");
  await page.resolveRecord(BY_NUMBER);
  assert.equal(page.reads.length, 1, 'remembered');
  // the number as the instance stores it, in another case, is the same number
  assert.equal((await setup(() => [{ sys_id: INC, number: 'inc0010001' }]).resolveRecord(BY_NUMBER)).sysId, INC);
});

test('a row that is not that number (the filter was ignored) is no record, and is not asked again for 30 seconds', async () => {
  for (const row of [{ sys_id: OTHER, number: 'INC0099999' }, { sys_id: OTHER }, { sys_id: OTHER, number: '' }, { sys_id: 'nope', number: 'INC0010001' }]) {
    const page = setup(() => [row]);
    assert.equal(await page.resolveRecord(BY_NUMBER), null, JSON.stringify(row));
    page.later(29000);
    assert.equal(await page.resolveRecord(BY_NUMBER), null);
    assert.equal(page.reads.length, 1, 'not asked again within 30 seconds');
    page.later(2000);
    await page.resolveRecord(BY_NUMBER);
    assert.equal(page.reads.length, 2, 'asked again after 30 seconds');
  }
  // nothing found, a failed read, an odd answer: the same
  for (const answer of [() => [], () => { throw new Error('403'); }, () => 'rows', () => null]) {
    const page = setup(answer);
    assert.equal(await page.resolveRecord(BY_NUMBER), null);
    await page.resolveRecord(BY_NUMBER);
    assert.equal(page.reads.length, 1);
  }
});

// ---- the real class of a `task` record ------------------------------------------------------------------------------------------

test('a task record: its real class is looked up once and remembered', async () => {
  const page = setup((table) => (table === 'task' ? [{ sys_id: INC, sys_class_name: 'incident' }] : []));
  assert.deepEqual(await page.resolveRecord(TASK_ADDRESS), { table: 'incident', sysId: INC, number: '', kind: 'incident' });
  await page.resolveRecord(TASK_ADDRESS);
  assert.equal(page.reads.length, 1);
});

test('a class that cannot be looked up stays task, and is not looked up again for 30 seconds (the bar asks every 2)', async () => {
  for (const answer of [() => { throw new Error('403'); }, () => [], () => [{ sys_id: INC, sys_class_name: 'Not A Table' }]]) {
    const page = setup(answer, { meta: { table: 'task', sysId: INC, isNewRecord: false, number: 'TASK0010001' } });
    assert.deepEqual(await page.resolveRecord('https://acme.service-now.com/task.do'), { table: 'task', sysId: INC, number: 'TASK0010001', kind: 'task' });
    for (let i = 0; i < 14; i += 1) {
      page.later(2000);
      assert.equal((await page.resolveRecord('https://acme.service-now.com/task.do')).table, 'task');
    }
    assert.equal(page.reads.length, 1, 'one read in 28 seconds, not fifteen');
    page.later(3000);
    await page.resolveRecord('https://acme.service-now.com/task.do');
    assert.equal(page.reads.length, 2, 'tried again after 30 seconds');
  }
  // once the class can be read it is used (and remembered)
  let failing = true;
  const page = setup(() => {
    if (failing) throw new Error('timeout');
    return [{ sys_id: INC, sys_class_name: 'sn_customerservice_case' }];
  });
  assert.equal((await page.resolveRecord(TASK_ADDRESS)).table, 'task');
  failing = false;
  page.later(31000);
  assert.equal((await page.resolveRecord(TASK_ADDRESS)).table, 'sn_customerservice_case');
  page.later(31000);
  await page.resolveRecord(TASK_ADDRESS);
  assert.equal(page.reads.length, 2);
});

test('clear() forgets every answer and every miss (the content script retires)', async () => {
  const page = setup((table) => (table === 'task' ? [] : [{ sys_id: INC, number: 'INC0010001' }]));
  await page.resolveRecord(BY_NUMBER);
  await page.resolveRecord(TASK_ADDRESS);
  assert.equal(page.reads.length, 2);
  page.clear();
  await page.resolveRecord(BY_NUMBER);
  await page.resolveRecord(TASK_ADDRESS);
  assert.equal(page.reads.length, 4);
});

test('the form comes first; a blank form, an odd answer from the page or an address with no record is no record', async () => {
  const page = setup(() => [], { meta: { table: 'incident', sysId: INC, isNewRecord: false, number: 'INC0010001' } });
  assert.deepEqual(await page.resolveRecord('https://acme.service-now.com/home.do'), { table: 'incident', sysId: INC, number: 'INC0010001', kind: 'incident' });
  assert.equal(await setup(() => [], { meta: { table: 'incident', sysId: '-1', isNewRecord: true } }).resolveRecord('https://acme.service-now.com/incident.do?sys_id=-1'), null);
  assert.equal(await setup(() => [], { meta: { table: 'Incident; drop', sysId: INC } }).resolveRecord('https://acme.service-now.com/home.do'), null);
  assert.equal(await setup(() => []).resolveRecord('https://acme.service-now.com/incident_list.do'), null);
  // `known`: the form the caller asked about already (pageState asks the page once)
  const asked = setup(() => [], { meta: null });
  assert.equal((await asked.resolveRecord('https://acme.service-now.com/home.do', { table: 'problem', sysId: OTHER, isNewRecord: false })).table, 'problem');
});
