import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCommentCaution, describeInsert } from '../src/lib/fillable.js';
import { recordWithReads, requesterCanRead } from '../src/domain/requesterReads.js';
import { requesterCommentLabel } from '../src/features/packs/kinds.js';
import { featureById } from '../src/features/registry.js';
import insightOps from '../src/content/ops/insights.js';
import { checkRecord } from '../src/content/ops/validate.js';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_CATALOG } from '../src/i18n/ar/catalog.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { RITM_ID, RITM_NUMBER } from './fixtures/sn-requested-item.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { BETH, CHARLIE, DAVE } from './fixtures/sn-users.js';

// Wave 6, the catalog fulfiller: the exact words about who can read a comment on a catalog task. The platform does not decide it
// (docs/live-checks-2026-11-07.md): a requester reads a catalog task only by its read rule, which asks who OPENED it, and its comments have
// no rule of their own. So one boolean (requesterCanRead: true when the person who opened the task is the requester, false when someone
// else did, null when either is not known) comes from the ticket's own read and picks one of three sentences. No new read.

registerCatalogue('ar', AR_CATALOG); // (until the lead wires it into src/i18n/ar/index.js)
test.afterEach(() => setLanguage('en'));

const TASK_ID = 'c0ffee00c0ffee00c0ffee00c0ffee01';
const taskRow = (over = {}) => ({
  sys_id: v(TASK_ID),
  number: v('SCTASK0010099'),
  short_description: v('Deliver the laptop'),
  description: v('Take the laptop to the third floor.'),
  state: v('2', 'Work in Progress'),
  priority: v('3', '3 - Moderate'),
  request_item: v(RITM_ID, RITM_NUMBER),
  'request_item.requested_for': v(CHARLIE.sysId, CHARLIE.name),
  'request_item.cat_item': v('ci1', 'Standard Laptop'),
  assignment_group: v('a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d', 'Desktop Support'),
  assigned_to: v(BETH.sysId, BETH.name),
  opened_by: v(DAVE.sysId, DAVE.name),
  opened_at: v('2026-10-23 09:00:00', '2026-10-23 11:00:00'),
  sys_updated_on: v('2026-10-26 08:00:00', '2026-10-26 10:00:00'),
  closed_at: v('', ''),
  due_date: v('', ''),
  close_notes: v('', ''),
  hold_reason: v('', ''),
  comments: v('', ''),
  work_notes: v('', ''),
  ...over,
});

/** The pack the Ticket screen's own read (the glance) holds for the catalog task, over a fake instance. */
async function glancePack(over = {}, drop = []) {
  const row = taskRow(over);
  for (const key of drop) delete row[key];
  const tables = buildInstance();
  tables.sc_task = [row];
  const deps = fakeDeps(tables);
  const { pack } = await insightOps.glance({ table: 'sc_task', sysId: TASK_ID }, { deps, checkRecord, allowSensitive: false });
  return pack;
}

// ---- who can read: one boolean from the ticket's own read ------------------------------------------------------------------------------

test('the person who opened the task is the requester: true; someone else opened it: false', async () => {
  const same = await glancePack({ opened_by: v(CHARLIE.sysId, CHARLIE.name) });
  assert.equal(requesterCanRead(same), true);
  // (the pack lists a person once: the requester and the opener are one entry, not two)
  assert.equal(same.people.filter((p) => p.name === CHARLIE.name).length, 1);
  const other = await glancePack();
  assert.equal(other.people.filter((p) => ['opened_by', 'requested_for'].includes(p.role)).length, 2);
  assert.equal(requesterCanRead(other), false);
});

test('not known: a column the person cannot read, or nobody named, is null (the careful words stay)', async () => {
  assert.equal(requesterCanRead(await glancePack({}, ['opened_by'])), null, 'the opener\'s column did not come back at all');
  assert.equal(requesterCanRead(await glancePack({}, ['request_item.requested_for'])), null, 'the requester did not come back');
  assert.equal(requesterCanRead(await glancePack({ opened_by: v('', '') })), null, 'nobody opened it that is named');
  assert.equal(requesterCanRead(await glancePack({ 'request_item.requested_for': v('', '') })), null);
  assert.equal(requesterCanRead(null), null);
  assert.equal(requesterCanRead({}), null);
});

test('only a catalog task has the question; the pack\'s own rules for the other kinds do not apply', async () => {
  const pack = await glancePack({ opened_by: v(CHARLIE.sysId, CHARLIE.name) });
  assert.equal(requesterCanRead({ ...pack, kind: 'task' }), null);
  assert.equal(requesterCanRead({ ...pack, kind: 'requested_item' }), null);
  assert.equal(requesterCanRead({ ...pack, kind: 'incident' }), null);
});

test('by hand: people listed once, ids decide, and a person folded into another role is read from the names', () => {
  const person = (role, sysId, name) => ({ role, sysId, name });
  const pack = (people, fields = { opened_by: 'Ann Lee', requested_for: 'Ann Lee' }, extra = {}) => ({ kind: 'catalog_task', fields, people, ...extra });
  // both listed: the ids decide, whatever the names say
  assert.equal(requesterCanRead(pack([person('opened_by', 'a'.repeat(32), 'Ann Lee'), person('requested_for', 'a'.repeat(32), 'Ann Lee')])), true);
  assert.equal(requesterCanRead(pack([person('opened_by', 'a'.repeat(32), 'Ann Lee'), person('requested_for', 'b'.repeat(32), 'Ann Lee')])), false, 'two people with one name');
  // one role listed (the other was the same person): the names agree and one person has that name
  assert.equal(requesterCanRead(pack([person('opened_by', 'a'.repeat(32), 'Ann Lee')])), true);
  // different names are different people, listed or not
  assert.equal(requesterCanRead(pack([person('opened_by', 'a'.repeat(32), 'Ann Lee')], { opened_by: 'Ann Lee', requested_for: 'Bo Chen' })), false);
  // one name, two people listed (one was folded into the assignee): cannot be told
  assert.equal(requesterCanRead(pack([person('assigned_to', 'a'.repeat(32), 'Ann Lee'), person('requested_for', 'b'.repeat(32), 'Ann Lee')])), null);
  assert.equal(requesterCanRead(pack([])), null);
  // the pack says a column was unreadable
  assert.equal(requesterCanRead(pack([person('opened_by', 'a'.repeat(32), 'Ann Lee')], undefined, { unreadable: ['requested_for'] })), null);
});

test('the record the answers are drawn for carries the boolean only when it is known', () => {
  const record = { table: 'sc_task', sysId: TASK_ID, kind: 'catalog_task' };
  assert.deepEqual(recordWithReads(record, true), { ...record, requesterCanRead: true });
  assert.deepEqual(recordWithReads(record, false), { ...record, requesterCanRead: false });
  assert.equal(recordWithReads(record, null), record, 'the very record, so nothing downstream is redrawn for nothing');
  assert.equal(record.requesterCanRead, undefined, 'the page own record is never changed');
});

// ---- the three sentences ---------------------------------------------------------------------------------------------------------------

const comment = (over = {}) => describeInsert({ field: 'comments', fieldLabel: 'Additional comments', kind: 'catalog_task', mode: 'append', ...over });

test('a comment on a catalog task: three states, three sets of words', () => {
  const yes = comment({ requesterCanRead: true });
  assert.equal(yes.where, 'Goes below what is in Additional comments, which the requester can read.');
  assert.equal(yes.caution, 'The requester can read comments on this task.');
  const no = comment({ requesterCanRead: false });
  assert.equal(no.where, 'Goes below what is in Additional comments, which the requester may not see.');
  assert.equal(no.caution, 'The requester may not see this. Use the requested item to reach them.');
  // not known (null, or not told at all): exactly what the panel said before
  for (const unknown of [comment({ requesterCanRead: null }), comment()]) {
    assert.equal(unknown.where, 'Goes below what is in Additional comments, which the requester may not see.');
    assert.equal(unknown.caution, 'The requester may not see comments on a catalog task. Use the requested item to reach them.');
  }
  // Replace says the same about its reader
  assert.equal(comment({ requesterCanRead: true, mode: 'replace' }).where, 'Replaces what is in Additional comments, which the requester can read.');
  assert.equal(comment({ requesterCanRead: false, mode: 'replace' }).where, 'Replaces what is in Additional comments, which the requester may not see.');
  // what to do next is the same in all three: nothing here claims the requester is emailed
  assert.equal(yes.next, 'Then press Save.');
  assert.equal(no.next, yes.next);
});

test('the same three states in Arabic', () => {
  setLanguage('ar');
  assert.equal(getLanguage(), 'ar');
  const yes = comment({ requesterCanRead: true });
  assert.equal(yes.caution, 'يستطيع مقدّم الطلب قراءة التعليقات على هذه المهمة.');
  assert.match(yes.where, /ويستطيع مقدّم الطلب قراءته\.$/);
  const no = comment({ requesterCanRead: false });
  assert.equal(no.caution, 'قد لا يراه مقدّم الطلب. استخدم العنصر المطلوب للوصول إليه.');
  assert.match(no.where, /وقد لا يظهر لمقدّم الطلب\.$/);
  const unknown = comment({ requesterCanRead: null });
  assert.equal(unknown.caution, 'قد لا يرى مقدّم الطلب التعليقات على مهمة الكتالوج. استخدم العنصر المطلوب للوصول إليه.');
  assert.equal(unknown.where, no.where);
  assert.equal(describeInsert({ field: 'comments', fieldLabel: 'Additional comments', kind: 'catalog_task', mode: 'replace', requesterCanRead: true }).where.startsWith('يستبدل'), true);
});

test('only a comment on a catalog task changes: work notes, other kinds and other fields ignore the boolean', () => {
  for (const reads of [true, false, null]) {
    assert.deepEqual(describeInsert({ field: 'work_notes', fieldLabel: 'Work notes', kind: 'catalog_task', requesterCanRead: reads }), describeInsert({ field: 'work_notes', fieldLabel: 'Work notes', kind: 'catalog_task' }));
    // a plain task and a problem keep their careful words even if a caller passes true
    const task = describeInsert({ field: 'comments', fieldLabel: 'Additional comments', kind: 'task', requesterCanRead: reads });
    assert.equal(task.where, 'Goes below what is in Additional comments, which the requester may not see.');
    assert.equal(task.caution, 'The requester may not see comments on a task. Check who can see them.');
    assert.equal(describeInsert({ field: 'comments', fieldLabel: 'Additional comments', kind: 'incident', requesterCanRead: reads }).where, 'Goes below what is in Additional comments, which the customer sees.');
    assert.equal(describeInsert({ field: 'comments', fieldLabel: 'Additional comments', kind: 'problem', requesterCanRead: reads }).where, 'Goes below what is in Additional comments, which the requester may not see.');
  }
  // the notes of a close are not a comment
  assert.equal(describeInsert({ field: 'close_notes', fieldLabel: 'Close notes', kind: 'catalog_task', requesterCanRead: true }).caution, '');
});

test('the helper says the same three sentences (the feature list\'s caution uses it)', () => {
  assert.equal(catalogCommentCaution(true), 'The requester can read comments on this task.');
  assert.equal(catalogCommentCaution(false), 'The requester may not see this. Use the requested item to reach them.');
  assert.equal(catalogCommentCaution(null), 'The requester may not see comments on a catalog task. Use the requested item to reach them.');
  assert.equal(catalogCommentCaution(), catalogCommentCaution(null));
});

test('the comment choice\'s own label follows the boolean too, in English and Arabic', () => {
  assert.equal(requesterCommentLabel(), 'Insert as a comment (the requester may not see it)');
  assert.equal(requesterCommentLabel(null), 'Insert as a comment (the requester may not see it)');
  assert.equal(requesterCommentLabel(false), 'Insert as a comment (the requester may not see it)');
  assert.equal(requesterCommentLabel(true), 'Insert as a comment (the requester can read it)');
  // every insert that offers the comment on a catalog task carries both: `label` (careful) and `labelFor` (the one the Insert path asks)
  for (const id of ['reply-draft', 'missing-info', 'request-explain']) {
    const insert = featureById(id).insert.find((spec) => spec.field === 'comments' && spec.kinds.includes('catalog_task') && !spec.kinds.includes('incident'));
    assert.ok(insert, id);
    assert.equal(insert.label, 'Insert as a comment (the requester may not see it)', id);
    assert.equal(insert.labelFor(true), 'Insert as a comment (the requester can read it)', id);
    assert.equal(insert.labelFor(false), insert.label, id);
  }
  setLanguage('ar');
  assert.equal(requesterCommentLabel(true), 'أدرج كتعليق (يستطيع مقدّم الطلب قراءته)');
  assert.equal(requesterCommentLabel(null), 'أدرج كتعليق (قد لا يراه مقدّم الطلب)');
});

// ---- no new read ---------------------------------------------------------------------------------------------------------------------------

test('the Ticket screen takes the boolean from the read the Glance already makes: one read of the ticket, not two', async () => {
  insightStore.clear();
  const row = taskRow({ opened_by: v(CHARLIE.sysId, CHARLIE.name) });
  const tables = buildInstance();
  tables.sc_task = [row];
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const deps = fakeDeps(tables);
  const pack = await insightOps.glance({ table: 'sc_task', sysId: TASK_ID }, { deps, checkRecord, allowSensitive: false });
  fake.onRead('glance', () => pack);
  fake.onRead('header', () => ({ number: 'SCTASK0010099', short_description: 'Deliver the laptop', state: 'Work in Progress', stateValue: '2', priority: '3 - Moderate' }));
  const eff = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['req'], profilesConfirmed: true }, {}), apiKey: '', keyLocked: false };
  const page = {
    status: 'record',
    tabId: 321,
    href: `https://acme.service-now.com/sc_task.do?sys_id=${TASK_ID}`,
    surface: 'classic',
    portal: null,
    record: { table: 'sc_task', sysId: TASK_ID, number: 'SCTASK0010099', kind: 'catalog_task' },
    newRecord: null,
    user: { name: 'Beth Anglin' },
  };
  const ui = await mount(<TicketView page={page} eff={eff} active />);
  try {
    await settle(8);
    assert.equal(fake.readsOf('glance').length, 1, 'the Glance and the wording share one read');
  } finally {
    await ui.unmount();
  }
});
