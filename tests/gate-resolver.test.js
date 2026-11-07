import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecordResolver } from '../src/content/recordResolver.js';
import { forgetTaskClasses } from '../src/context/kinds.js';

// The record resolver's gate (audit of 2026-11-07, part 2): a page is a ticket record only when its table is a ticket-like one, one of
// the organisation's families, or the live form proves it with a number. Everything else is "no record" and nothing is read for it.

const HOST = 'https://dev364920.service-now.com';
const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';

/** A resolver with a page that has no form (unless `meta`), reads that answer `answer(table, query)`, and a policy that names `prefixes`. */
function setup({ meta = null, answer = () => [], prefixes } = {}) {
  const reads = [];
  const asked = [];
  const resolver = makeRecordResolver({
    guardedDeps: async (policy) => {
      asked.push(policy);
      return {
        sensitivePrefixes: prefixes,
        queryTable: async (table, query, fields) => {
          reads.push({ table, query, fields });
          return answer(table, query);
        },
      };
    },
    formMeta: async () => meta,
  });
  return { ...resolver, reads, asked };
}

const form = (over = {}) => ({ table: 'ui_page', sysId: ID, isNewRecord: false, number: null, ...over });

// ---- the owner's page: a UI page ----------------------------------------------------------------------------------------------

test('an address of a page that is no ticket\'s is no record, and nothing is read for it', async () => {
  for (const path of [
    `/ui_page.do?sys_id=${ID}`,
    `/now/nav/ui/classic/params/target/ui_page.do%3Fsys_id%3D${ID}`,
    `/ui_page.do?sysparm_query=sys_id=${ID}`,
    `/sys_ui_page.do?sys_id=${ID}`,
    `/sys_user.do?sys_id=${ID}`,
    `/home.do?sys_id=${ID}`,
    `/welcome.do?sys_id=${ID}`,
    `/sp?id=form&table=sys_ui_page&sys_id=${ID}`,
    `/now/sow/record/ui_page/${ID}`,
    // a number in the address of such a page used to be looked up in a table named after the page
    `/ui_page.do?sysparm_query=number=INC0010001`,
    `/home.do?sysparm_query=number%3DINC0010001`,
  ]) {
    const page = setup({ answer: () => [{ sys_id: ID, number: 'INC0010001' }] });
    assert.equal(await page.resolveRecord(`${HOST}${path}`), null, path);
    assert.deepEqual(page.reads, [], `no read for ${path}`);
  }
});

test('a form (g_form) of a table that is no ticket\'s and has no number is no record', async () => {
  for (const meta of [form(), form({ number: '' }), form({ number: '   ' }), form({ number: 42 }), form({ number: {} }), form({ table: 'home' }), form({ table: 'sys_user' })]) {
    const page = setup({ meta });
    assert.equal(await page.resolveRecord(`${HOST}/home.do`), null, JSON.stringify(meta));
    assert.deepEqual(page.reads, []);
  }
  // the form is not a record, but the address names one: the address is looked at
  const page = setup({ meta: form() });
  assert.deepEqual(await page.resolveRecord(`${HOST}/incident.do?sys_id=${OTHER}`), { table: 'incident', sysId: OTHER, number: '', kind: 'incident' });
  // and when the address names the same non-ticket page, there is nothing
  assert.equal(await page.resolveRecord(`${HOST}/ui_page.do?sys_id=${ID}`), null);
});

// ---- custom task tables keep working when the live form proves a number -----------------------------------------------------

test('a customer\'s own task table is a record when the live form says its number', async () => {
  const page = setup({ meta: form({ table: 'u_facilities_request', number: 'FAC0001234' }) });
  assert.deepEqual(await page.resolveRecord(`${HOST}/u_facilities_request.do?sys_id=${ID}`), { table: 'u_facilities_request', sysId: ID, number: 'FAC0001234', kind: 'other' });
  assert.deepEqual(page.reads, [], 'the form is the proof: nothing is read');
  for (const table of ['x_acme_visit', 'u_one', 'sn_si_incident']) {
    const p = setup({ meta: form({ table, number: ' TKT0000001 ' }) });
    assert.deepEqual(await p.resolveRecord(`${HOST}/anything`), { table, sysId: ID, number: 'TKT0000001', kind: 'other' }, table);
  }
  // the number is text from the page: trimmed and short
  const long = setup({ meta: form({ table: 'u_x', number: 'N'.repeat(100) }) });
  assert.equal((await long.resolveRecord(`${HOST}/x`)).number.length, 40);
  // without a number the same form is not a record
  assert.equal(await setup({ meta: form({ table: 'u_facilities_request' }) }).resolveRecord(`${HOST}/u_facilities_request.do?sys_id=${ID}`), null);
});

test('a form of a table the product knows is a record with or without a number; a blank form is not a record', async () => {
  assert.deepEqual(await setup({ meta: form({ table: 'incident' }) }).resolveRecord(`${HOST}/x`), { table: 'incident', sysId: ID, number: '', kind: 'incident' });
  assert.deepEqual(await setup({ meta: form({ table: 'kb_knowledge', number: 'KB0010001' }) }).resolveRecord(`${HOST}/x`), { table: 'kb_knowledge', sysId: ID, number: 'KB0010001', kind: 'knowledge' });
  assert.equal(await setup({ meta: form({ table: 'u_x', number: 'N0000001', isNewRecord: true, sysId: '-1' }) }).resolveRecord(`${HOST}/x`), null);
});

test('a record opened through the base class task keeps its real class, a custom class included', async () => {
  const page = setup({ meta: form({ table: 'task', number: 'TASK0010001' }), answer: (table) => (table === 'task' ? [{ sys_id: ID, sys_class_name: 'u_facilities_request' }] : []) });
  assert.deepEqual(await page.resolveRecord(`${HOST}/task.do?sys_id=${ID}`), { table: 'u_facilities_request', sysId: ID, number: 'TASK0010001', kind: 'task' });
  // (audit of 2026-11-07, F7: a class a record reports through `task` IS a kind of task, so its kind is task, not 'other')
  assert.equal(page.reads.length, 1);
  const byAddress = setup({ answer: (table) => (table === 'task' ? [{ sys_id: ID, sys_class_name: 'incident' }] : []) });
  assert.deepEqual(await byAddress.resolveRecord(`${HOST}/now/sow/record/task/${ID}`), { table: 'incident', sysId: ID, number: '', kind: 'incident' });
  // the real class is a table nobody listed and the page has no form to say a number: it came out of `task`, so it is a kind of task and a
  // record (F7; before, only the name was looked at, and the table was 'not a ticket'). An address that names such a table is still not one.
  const unlisted = setup({ answer: (table) => (table === 'task' ? [{ sys_id: ID, sys_class_name: 'u_facilities_request' }] : []) });
  assert.deepEqual(await unlisted.resolveRecord(`${HOST}/now/sow/record/task/${ID}`), { table: 'u_facilities_request', sysId: ID, number: '', kind: 'task' });
  forgetTaskClasses();
  assert.equal(await setup().resolveRecord(`${HOST}/now/sow/record/u_facilities_request/${ID}`), null);
  const family = setup({ prefixes: ['x_acme_hr_'], answer: (table) => (table === 'task' ? [{ sys_id: ID, sys_class_name: 'x_acme_hr_case' }] : []) });
  assert.deepEqual(await family.resolveRecord(`${HOST}/now/sow/record/task/${ID}`), { table: 'x_acme_hr_case', sysId: ID, number: '', kind: 'task' });
  // a class that cannot be looked up stays task, which is a ticket (the pack read then treats it as sensitive)
  const lost = setup({ answer: () => { throw new Error('403'); } });
  assert.deepEqual(await lost.resolveRecord(`${HOST}/now/sow/record/task/${ID}`), { table: 'task', sysId: ID, number: '', kind: 'task' });
});

// ---- the organisation's own families -------------------------------------------------------------------------------------------

test('the policy\'s own record families count, and are asked only for a table the product does not know', async () => {
  const page = setup({ prefixes: ['x_acme_hr_'] });
  forgetTaskClasses(); // (an earlier test saw this class come out of `task`: here only its address names it)
  assert.deepEqual(await page.resolveRecord(`${HOST}/x_acme_hr_case.do?sys_id=${ID}`, undefined, { sensitiveTablePrefixes: ['x_acme_hr_'] }), { table: 'x_acme_hr_case', sysId: ID, number: '', kind: 'other' });
  assert.equal(await page.resolveRecord(`${HOST}/x_acme_visit.do?sys_id=${ID}`), null);
  assert.deepEqual(page.asked.slice(-2), [{ sensitiveTablePrefixes: ['x_acme_hr_'] }, undefined], "the panel's policy goes to the guard");
  const known = setup();
  await known.resolveRecord(`${HOST}/incident.do?sys_id=${ID}`);
  assert.deepEqual(known.asked, [], 'a table the product knows needs no policy');
  // the policy cannot be read: the table stays unknown, no failure
  const broken = makeRecordResolver({ guardedDeps: async () => { throw new Error('no policy'); }, formMeta: async () => null });
  assert.equal(await broken.resolveRecord(`${HOST}/x_acme_hr_case.do?sys_id=${ID}`), null);
  assert.equal((await broken.resolveRecord(`${HOST}/incident.do?sys_id=${ID}`)).table, 'incident');
});

// ---- the number-only lookup ----------------------------------------------------------------------------------------------------

test('a number in the address is looked up only in a ticket\'s table, and the row must carry that number', async () => {
  const page = setup({ answer: () => [{ sys_id: ID, number: 'INC0010001' }] });
  assert.deepEqual(await page.resolveRecord(`${HOST}/incident.do?sysparm_query=number=INC0010001`), { table: 'incident', sysId: ID, number: 'INC0010001', kind: 'incident' });
  assert.deepEqual(page.reads, [{ table: 'incident', query: 'number=INC0010001', fields: ['sys_id', 'number'] }]);
});

// ---- S9: the article reader -------------------------------------------------------------------------------------------------------

test('S9: the classic article reader resolves to the article, by its number', async () => {
  const page = setup({ answer: (table) => (table === 'kb_knowledge' ? [{ sys_id: ID, number: 'KB0010001' }] : []) });
  assert.deepEqual(await page.resolveRecord(`${HOST}/kb_view.do?sysparm_article=KB0010001`), { table: 'kb_knowledge', sysId: ID, number: 'KB0010001', kind: 'knowledge' });
  assert.deepEqual(page.reads, [{ table: 'kb_knowledge', query: 'number=KB0010001', fields: ['sys_id', 'number'] }]);
  // by its own id: no read at all
  const byId = setup();
  assert.deepEqual(await byId.resolveRecord(`${HOST}/kb_view.do?sys_kb_id=${ID}`), { table: 'kb_knowledge', sysId: ID, number: '', kind: 'knowledge' });
  assert.deepEqual(byId.reads, []);
  // an article that cannot be found is no record
  assert.equal(await setup().resolveRecord(`${HOST}/kb_view.do?sysparm_article=KB0099999`), null);
});

// ---- blank forms ------------------------------------------------------------------------------------------------------------------

test('a blank form is offered only for a ticket\'s table (the form says so, or the address does)', async () => {
  const blank = (over = {}) => ({ table: 'incident', sysId: '-1', isNewRecord: true, number: null, ...over });
  assert.deepEqual(await setup({ meta: blank() }).resolveNewRecord(`${HOST}/incident.do`), { table: 'incident', kind: 'incident' });
  forgetTaskClasses(); // (an earlier test saw the table come out of `task`: here nothing is known about it)
  assert.deepEqual(await setup({ meta: blank({ table: 'u_facilities_request', number: 'FAC0001235' }) }).resolveNewRecord(`${HOST}/x`), { table: 'u_facilities_request', kind: 'other' });
  assert.equal(await setup({ meta: blank({ table: 'u_facilities_request' }) }).resolveNewRecord(`${HOST}/x`), null, 'no number: not proven');
  assert.equal(await setup({ meta: blank({ table: 'ui_page' }) }).resolveNewRecord(`${HOST}/ui_page.do?sys_id=-1`), null);
  // the address, when the bridge cannot reach the form (Next Experience, Workspaces)
  assert.deepEqual(await setup().resolveNewRecord(`${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D-1`), { table: 'incident', kind: 'incident' });
  assert.deepEqual(await setup().resolveNewRecord(`${HOST}/now/sow/record/sn_customerservice_case/-1`), { table: 'sn_customerservice_case', kind: 'case' });
  assert.equal(await setup().resolveNewRecord(`${HOST}/ui_page.do?sys_id=-1`), null);
  assert.equal(await setup().resolveNewRecord(`${HOST}/home.do?sys_id=-1`), null);
  assert.equal(await setup().resolveNewRecord(`${HOST}/now/nav/ui/classic/params/target/sys_ui_page.do%3Fsys_id%3D-1`), null);
  // a saved record on the form: not a blank form, whatever the address says
  assert.equal(await setup({ meta: { table: 'incident', sysId: ID, isNewRecord: false } }).resolveNewRecord(`${HOST}/incident.do?sys_id=-1`), null);
  // a form of a table that is no ticket's does not hide the address of a blank ticket form
  assert.deepEqual(await setup({ meta: blank({ table: 'ui_page' }) }).resolveNewRecord(`${HOST}/incident.do?sys_id=-1`), { table: 'incident', kind: 'incident' });
  // `known` given by the caller is used as it is
  assert.deepEqual(await setup({ meta: null }).resolveNewRecord(`${HOST}/x`, blank()), { table: 'incident', kind: 'incident' });
  assert.equal(await setup({ meta: blank() }).resolveNewRecord(`${HOST}/x`, null), null);
});

test('clear() still forgets everything, and the resolver offers the two calls', async () => {
  const page = setup({ answer: () => [{ sys_id: ID, number: 'INC0010001' }] });
  await page.resolveRecord(`${HOST}/incident.do?sysparm_query=number=INC0010001`);
  page.clear();
  await page.resolveRecord(`${HOST}/incident.do?sysparm_query=number=INC0010001`);
  assert.equal(page.reads.length, 2);
  assert.equal(typeof page.resolveNewRecord, 'function');
});
