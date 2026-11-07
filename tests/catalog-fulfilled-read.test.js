import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/content/ops/index.js';
import fixOps, { FULFILLED_SHOWN, readFulfilledBefore } from '../src/content/ops/fix.js';
import { checkRecord } from '../src/content/ops/validate.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { FEATURES, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, SEARCH_ONLY_FEATURES, allowedFields } from '../src/context/allowlists.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { BETH, ABEL } from './fixtures/sn-users.js';

// Wave 6, the catalog fulfiller: "Fulfilled before". The read behind the card (src/content/ops/fix.js fulfilledBefore) against a fake
// instance: the last Closed Complete tasks of the SAME catalog item, newest first, at most five, never the open item's own tasks; one small
// read of the open record and ONE limited read of the task table, GET only through the guarded deps, every row checked again, and every
// refusal, hidden column or blocked table said as such (never as "none").

const hex = (prefix, n) => `${prefix}${String(n).padStart(2, '0')}`.padEnd(32, '0');
const ITEM = 'c1a2b3c4d5e64f708192a3b4c5d6e7f8'; // the catalog item the open ticket is for
const OTHER_ITEM = 'd2b3c4d5e6f74a819203b4c5d6e7f809';
const OPEN_RITM = 'e3f4a5b6c7d84e9fa0b1c2d3e4f5a6b7';
const OPEN_TASK = 'c0ffee00c0ffee00c0ffee00c0ffee01';
const NOW = Date.UTC(2026, 10, 7, 12);

const withClock = (deps) => Object.assign(deps, { now: () => NOW });
const ctx = (deps, extra = {}) => ({ deps, checkRecord, allowSensitive: false, ...extra });

/** A catalog task row as the Table API returns it with display values and the walked item. */
function task(n, over = {}) {
  const { state = '3', stateLabel = state === '3' ? 'Closed Complete' : state === '4' ? 'Closed Incomplete' : 'Work in Progress', ritm = hex('b1', n), item = ITEM, opened = '', closed = '', who = null, notes = '', ...rest } = over;
  return {
    sys_id: v(hex('a1', n)),
    number: v(`SCTASK00200${String(n).padStart(2, '0')}`),
    short_description: v(`Prepare laptop ${n}`),
    state: v(state, stateLabel),
    assigned_to: who ? v(who.sysId, who.name) : v('', ''),
    opened_at: v(opened, opened),
    closed_at: v(closed, closed),
    close_notes: v(notes),
    request_item: v(ritm, `RITM00300${String(n).padStart(2, '0')}`),
    'request_item.cat_item': v(item, item === ITEM ? 'Standard Laptop' : 'Phone'),
    ...rest,
  };
}

const openTask = () => task(0, { sys_id: v(OPEN_TASK), number: v('SCTASK0020000'), state: '2', ritm: OPEN_RITM });

function tables() {
  return {
    sc_task: [
      openTask(),
      // another step of the open item that is already done: current work, not "before"
      task(20, { ritm: OPEN_RITM, closed: '2026-11-06 09:00:00', opened: '2026-11-06 08:00:00' }),
      // seven earlier completed tasks of the same item, in no order
      task(3, { closed: '2026-11-01 15:00:00', opened: '2026-11-01 10:00:00', who: ABEL, notes: 'Imaged the laptop. Joined it to the domain.' }),
      task(1, { closed: '2026-11-05 10:00:00', opened: '2026-11-03 10:00:00', who: BETH, notes: 'Re-imaged and enrolled the laptop in Intune. Handed over to the user. Asked them to sign the receipt.' }),
      task(5, { closed: '2026-10-20 10:00:00', opened: '2026-10-19 10:00:00', who: BETH, notes: 'Done.' }),
      task(2, { closed: '2026-11-04 11:30:00', opened: '2026-11-04 11:00:00', who: BETH, notes: 'Swapped the dock.' }),
      task(4, { closed: '2026-10-28 09:00:00', opened: '2026-10-24 09:00:00', who: ABEL, notes: 'Waited for stock, then built it.' }),
      task(6, { closed: '2026-10-10 09:00:00', opened: '2026-10-09 09:00:00' }),
      task(7, { closed: '2026-10-01 09:00:00', opened: '2026-09-30 09:00:00' }),
      // never to be listed: not Closed Complete, another item, still open
      task(8, { state: '4', closed: '2026-11-06 10:00:00', opened: '2026-11-05 10:00:00' }),
      task(9, { item: OTHER_ITEM, closed: '2026-11-06 11:00:00', opened: '2026-11-05 10:00:00' }),
      task(10, { state: '2', closed: '', opened: '2026-11-06 12:00:00' }),
    ],
    sc_req_item: [{ sys_id: v(OPEN_RITM), number: v('RITM0030000'), cat_item: v(ITEM, 'Standard Laptop') }],
  };
}

const numbers = (out) => out.items.map((x) => x.number);

/** An instance that answers every query with every row of the table (as one that ignored all the conditions would). */
const loose = (all) => ({
  calls: [],
  async queryTable(table, query, fields) {
    this.calls.push({ table, query, fields });
    return (all[table] || []).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => fields.includes(k))));
  },
});

// ---- the answer --------------------------------------------------------------------------------------------------------------------------

test('a catalog task: the five newest Closed Complete tasks of the same item, with who, when and the notes; the open item\'s own tasks and the rest are left out', async () => {
  const deps = withClock(fakeDeps(tables()));
  const out = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, deps);
  // newest closed first: 1 (Nov 5), 2 (Nov 4), 3 (Nov 1), 4 (Oct 28), 5 (Oct 20); 6 and 7 are older than five
  assert.deepEqual(numbers(out), ['SCTASK0020001', 'SCTASK0020002', 'SCTASK0020003', 'SCTASK0020004', 'SCTASK0020005']);
  assert.equal(out.items.length, FULFILLED_SHOWN);
  assert.deepEqual(out.access, [{ source: 'sc_task', status: 'ok', note: '' }]);
  const first = out.items[0];
  assert.deepEqual(first, {
    table: 'sc_task',
    sysId: hex('a1', 1),
    number: 'SCTASK0020001',
    short_description: 'Prepare laptop 1',
    who: BETH.name,
    notes: 'Re-imaged and enrolled the laptop in Intune. Handed over to the user. Asked them to sign the receipt.',
    notesUnread: false,
    openedUtc: '2026-11-03 10:00:00',
    closedUtc: '2026-11-05 10:00:00',
    people: [BETH.name],
  });
  // never: the task being worked, a sibling of the open item (done or not), an incomplete one, another item's, one still open
  for (const hidden of ['SCTASK0020000', 'SCTASK0020020', 'SCTASK0020008', 'SCTASK0020009', 'SCTASK0020010']) assert.ok(!numbers(out).includes(hidden), hidden);
});

test('exactly two reads, both GET through the guarded deps: the open record\'s item, then ONE limited read of the task table', async () => {
  const deps = withClock(fakeDeps(tables()));
  await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, deps);
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'), 'queries only: no write exists in this path');
  assert.equal(deps.calls.length, 2);
  const [own, list] = deps.calls;
  assert.equal(own.table, 'sc_task');
  assert.equal(own.query, `sys_id=${OPEN_TASK}`);
  assert.deepEqual(own.fields, ['sys_id', 'request_item', 'request_item.cat_item'], 'the open record is asked for its item and nothing else');
  assert.equal(own.options.limit, 1);
  assert.equal(list.table, 'sc_task');
  assert.equal(list.query, `request_item.cat_item=${ITEM}^state=3^request_item!=${OPEN_RITM}^ORDERBYDESCclosed_at`, 'ids only: nothing the panel sent, no text of the record');
  assert.deepEqual(list.fields, ['sys_id', ...allowedFields('sc_task', 'fulfilled-before')]);
  assert.equal(list.options.limit, 15, 'a few more than shown; the checks drop the rows that do not belong');
  assert.equal(list.options.displayValue, true);
});

test('a requested item: its own catalog item is read from it, and its own tasks are not "before"', async () => {
  const deps = withClock(fakeDeps(tables()));
  const out = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, deps);
  assert.deepEqual(deps.calls.map((c) => [c.table, c.query]), [
    ['sc_req_item', `sys_id=${OPEN_RITM}`],
    ['sc_task', `request_item.cat_item=${ITEM}^state=3^request_item!=${OPEN_RITM}^ORDERBYDESCclosed_at`],
  ]);
  assert.deepEqual(deps.calls[0].fields, ['sys_id', 'cat_item']);
  assert.deepEqual(numbers(out).slice(0, 2), ['SCTASK0020001', 'SCTASK0020002']);
  assert.ok(!numbers(out).includes('SCTASK0020020'), 'the open item\'s own finished step');
});

test('the columns read are the feature\'s spec, inside the kind\'s ceiling, with no person but the one who did it', () => {
  assert.ok(FEATURES.includes('fulfilled-before'));
  assert.ok(SEARCH_ONLY_FEATURES.includes('fulfilled-before'), 'it sends nothing to an AI, so it reads no person column for masking');
  const task_ = [...allowedFields('sc_task', 'fulfilled-before')].sort();
  assert.deepEqual(task_, ['assigned_to', 'close_notes', 'closed_at', 'number', 'opened_at', 'request_item', 'request_item.cat_item', 'short_description', 'state']);
  assert.deepEqual([...allowedFields('sc_req_item', 'fulfilled-before')].sort(), ['cat_item', 'number']);
  for (const column of task_) assert.ok(FIELDS_BY_KIND.catalog_task.includes(column), `${column} is on the catalog task ceiling`);
  for (const column of ['opened_by', 'request_item.requested_for', 'caller_id', 'description', 'special_instructions', 'comments', 'work_notes']) assert.ok(!task_.includes(column), `${column} is not read`);
  // no other kind reads anything for it but the number
  for (const table of ['incident', 'change_request', 'sn_customerservice_case']) assert.deepEqual(allowedFields(table, 'fulfilled-before'), ['number'], table);
  assert.deepEqual(FEATURE_RELATED['fulfilled-before'], []);
  assert.equal(FEATURE_JOURNAL['fulfilled-before'], false);
  assert.equal(FEATURE_FIELDS['fulfilled-before'].catalog_task.includes('close_notes'), true);
  assert.equal(FEATURE_FIELDS['fulfilled-before'].requested_item.includes('close_notes'), false);
});

test('the operation is registered and checks its arguments before anything is asked', async () => {
  assert.equal(OPS.fulfilledBefore, fixOps.fulfilledBefore);
  const deps = withClock(fakeDeps(tables()));
  await assert.rejects(OPS.fulfilledBefore({ table: 'sc_task; drop', sysId: OPEN_TASK }, ctx(deps)), /not a valid record/);
  await assert.rejects(OPS.fulfilledBefore({ table: 'sc_task', sysId: 'nope' }, ctx(deps)), /not a valid record/);
  await assert.rejects(OPS.fulfilledBefore(undefined, ctx(deps)), /not a valid record/);
  assert.equal(deps.calls.length, 0);
  const out = await OPS.fulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK.toUpperCase() }, ctx(deps));
  assert.equal(out.items.length, 5, 'the id is lower-cased before it is used');
  assert.equal(deps.calls[0].query, `sys_id=${OPEN_TASK}`);
});

test('a ticket that is not a requested item or a catalog task is not looked up', async () => {
  const deps = withClock(fakeDeps(tables()));
  const out = await readFulfilledBefore({ table: 'incident', sysId: OPEN_TASK }, deps);
  assert.deepEqual(out.items, []);
  assert.equal(out.access[0].status, 'skipped');
  assert.equal(deps.calls.length, 0);
});

// ---- honest: nothing is "none" unless it was seen --------------------------------------------------------------------------------------

test('no earlier task: "none" only after the table is known to be readable; a table the person sees none of is "cannot tell"', async () => {
  const only = tables();
  only.sc_task = only.sc_task.filter((row) => ['SCTASK0020000', 'SCTASK0020020'].includes(row.number.value));
  const none = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(only)));
  assert.deepEqual(none.items, []);
  assert.deepEqual(none.access, [{ source: 'sc_task', status: 'empty', note: '' }], 'tasks are visible, none is of this item');
  // every row filtered out for this person: the second, unfiltered read also finds nothing
  const hidden = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(tables(), { hidden: ['sc_task'] })));
  assert.deepEqual(hidden.items, []);
  assert.equal(hidden.access[0].status, 'empty-or-hidden');
});

test('a refused or failed read says so, and a lost sign-in stops the read', async () => {
  const denied = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(tables(), { denied: ['sc_task'] })));
  assert.deepEqual(denied.items, []);
  assert.equal(denied.access[0].status, 'denied');
  assert.equal(denied.access[0].source, 'sc_task');
  // the open record itself cannot be read: the same, about that table
  const deniedOwn = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, withClock(fakeDeps(tables(), { denied: ['sc_task'] })));
  assert.equal(deniedOwn.access[0].status, 'denied');
  const failed = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(tables(), { errors: { sc_task: new Error('boom') } })));
  assert.equal(failed.access[0].status, 'error');
  await assert.rejects(readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(tables(), { expired: ['sc_task'] }))), (e) => e.code === 'SESSION_EXPIRED');
});

test('the organisation\'s policy: a blocked table (or a dot-walk through one) is refused before a request, and said as the organisation\'s rule', async () => {
  const walk = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['sc_req_item'] } }) });
  const fakeA = withClock(fakeDeps(tables()));
  const a = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, await walk.deps(fakeA));
  assert.deepEqual(a.items, []);
  assert.equal(a.access[0].status, 'blocked', 'the task\'s item is walked through the requested item table');
  assert.equal(fakeA.calls.length, 0, 'nothing was asked of the instance');

  const direct = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['sc_task'] } }) });
  const fakeB = withClock(fakeDeps(tables()));
  const b = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, await direct.deps(fakeB));
  assert.equal(b.access[0].status, 'blocked');
  assert.equal(b.access[0].source, 'sc_task');
  assert.equal(fakeB.callsTo('sc_task').length, 0);
});

test('sensitive data: a site that marks the catalog task table as sensitive gets no read unless sensitive data is allowed', async () => {
  const deps = withClock(Object.assign(fakeDeps(tables()), { sensitivePrefixes: ['sc_'] }));
  const skipped = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, deps);
  assert.deepEqual(skipped.items, []);
  assert.equal(skipped.access[0].status, 'skipped');
  assert.equal(deps.calls.length, 0);
  const allowed = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, deps, { allowSensitive: true });
  assert.equal(allowed.items.length, 5);
});

test('a column the person cannot read is not "empty": the item hidden from them is "could not check", a hidden name or note is left unnamed', async () => {
  // the open task's walked item did not come back at all (a key missing from the row)
  const noKey = tables();
  delete noKey.sc_task[0]['request_item.cat_item'];
  const a = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, withClock(fakeDeps(noKey)));
  assert.deepEqual(a.items, []);
  assert.equal(a.access[0].status, 'denied');
  assert.equal(a.access[0].reason, 'hidden-field');
  // the item is named by the task but its own catalog item came back empty: hidden from this person, not "no item"
  const emptyWalk = tables();
  emptyWalk.sc_task[0]['request_item.cat_item'] = v('', '');
  const b = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, withClock(fakeDeps(emptyWalk)));
  assert.equal(b.access[0].reason, 'hidden-field');
  // a task with no requested item at all, and a requested item with no catalog item: nothing to compare, said as not looked up
  const none = tables();
  none.sc_task[0].request_item = v('', '');
  none.sc_task[0]['request_item.cat_item'] = v('', '');
  const c = await readFulfilledBefore({ table: 'sc_task', sysId: OPEN_TASK }, withClock(fakeDeps(none)));
  assert.equal(c.access[0].status, 'skipped');
  assert.match(c.access[0].note, /no catalog item/);
  const bare = tables();
  bare.sc_req_item[0].cat_item = v('', '');
  const d = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(bare)));
  assert.equal(d.access[0].status, 'skipped');

  // on the earlier tasks: the person's name or the notes column missing from a row (hidden) are not "nobody" and "no notes"
  const rows = tables();
  delete rows.sc_task.find((r) => r.number.value === 'SCTASK0020001').assigned_to;
  delete rows.sc_task.find((r) => r.number.value === 'SCTASK0020002').close_notes;
  const out = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, withClock(fakeDeps(rows)));
  const one = out.items.find((x) => x.number === 'SCTASK0020001');
  const two = out.items.find((x) => x.number === 'SCTASK0020002');
  assert.equal(one.who, '');
  assert.deepEqual(one.people, []);
  assert.equal(two.notesUnread, true);
  assert.equal(two.notes, '');
  const written = out.items.find((x) => x.number === 'SCTASK0020005');
  assert.equal(written.notesUnread, false);
});

test('an instance that ignored a condition does not leak the tasks of other items, other states, or the open item\'s steps', async () => {
  // it answers with every row, whatever the query said: some are another item's
  const a = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, loose(tables()));
  assert.deepEqual(a.items, []);
  assert.equal(a.access[0].status, 'error');
  assert.match(a.access[0].note, /did not narrow the results/);
  // every row is of the item, but the state and the open item's own tasks were not filtered: only the real ones are kept
  const all = tables();
  all.sc_task = all.sc_task.filter((r) => r['request_item.cat_item'].value === ITEM);
  const b = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, loose(all));
  assert.deepEqual(numbers(b), ['SCTASK0020001', 'SCTASK0020002', 'SCTASK0020003', 'SCTASK0020004', 'SCTASK0020005']);
  // nothing usable among what it sent is not "none"
  const nothing = tables();
  nothing.sc_task = nothing.sc_task.filter((r) => r['request_item.cat_item'].value === ITEM && r.state.value !== '3');
  const c = await readFulfilledBefore({ table: 'sc_req_item', sysId: OPEN_RITM }, loose(nothing));
  assert.equal(c.access[0].status, 'error');
  assert.deepEqual(c.items, []);
});
