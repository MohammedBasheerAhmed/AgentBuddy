import test from 'node:test';
import assert from 'node:assert/strict';
import { v, fakeDeps } from './fixtures/sn-fakeDeps.js';
import { STATUS, NOTE_TEXT, READ_REASON, absentColumns, hiddenFieldEntry, readFailureText } from '../src/context/access.js';
import { NOT_SEEN, isNotMade, readDone, readFully, sourceDone, unseen } from '../src/context/seen.js';
import { disp, raw } from '../src/context/util.js';
import { readContextPack } from '../src/context/pack.js';
import { readChangesOnTarget, readRelated } from '../src/context/related.js';
import { findOpenDuplicates, findSimilarTickets, searchKnowledge } from '../src/context/similar.js';
import { readJournal } from '../src/context/journal.js';
import { readCallerHistory } from '../src/context/history.js';
import { resolvePeople } from '../src/context/people.js';
import { readKnownErrors, readVip } from '../src/content/ops/insights.js';
import domainOps from '../src/content/ops/domain.js';
import { checkRecord } from '../src/content/ops/validate.js';
import { callerSummary, relatedSummary } from '../src/insights/related.js';
import { outageSignal } from '../src/insights/outage.js';
import { missingDetails } from '../src/insights/missing.js';
import { riskSignals } from '../src/insights/risk.js';
import { routingVote } from '../src/insights/routing.js';
import { ownerText } from '../src/insights/glance.js';
import { chaseLine } from '../src/insights/fixes.js';
import { requestStatus } from '../src/checks/requestStatus.js';
import { relatedText } from '../src/domain/parts.js';
import { accessLine } from '../src/sidepanel/plainAccess.js';
import { describeHeader } from '../src/sidepanel/recordHeader.js';
import { glanceChips, glanceDetails } from '../src/sidepanel/ticket/cards/Glance.jsx';
import { factsNotRead } from '../src/sidepanel/ticket/cards/RiskCard.jsx';
import { callerUnreadable } from '../src/sidepanel/ticket/cards/data.js';
import { keyName, nameOf, normalizeGroups } from '../src/reports/engine/reader.js';
import { foldByOwner } from '../src/reports/engine/workload.js';

// "Honest reads" (audit of 2026-11-07, part 3): the panel states an absence ("none", "nobody", "no warning signs", a green "all clear") only
// when the read for it completed. A field the user may not read is "could not read it", never "empty"; a reference whose name is hidden
// is never shown as an id. The rules sit in src/context/seen.js and are used by the readers (src/context, src/content/ops) and by the
// cards (src/insights, src/sidepanel/ticket/cards); tests/honest-cards.test.js draws the cards.

const ID = '9de5069c5afe602b2d6d343a7c50b3e4';
const GROUP_ID = 'd625dccec0a8016700a222a0f7900d06';
const CI = '0c1d2e3f4a5b4c6d8e7f9a0b1c2d3e4f';
const SERVICE = '1d2e3f4a5b6c4d7e8f9a0b1c2d3e4f50';
const USER_ID = '46d44a23a9fe19810012d100cca80666';
const OTHER_ID = 'a8f98bb0eb32010045e1a5115206fe3a';
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

// ---- the rule ----------------------------------------------------------------------------------------------------------------------

test('seen: an absence is stated only when no entry says the read could not see everything', () => {
  assert.deepEqual([...NOT_SEEN].sort(), ['blocked', 'denied', 'empty-or-hidden', 'error']);
  assert.equal(readFully([{ status: 'ok' }, { status: 'empty' }]), true);
  assert.equal(readFully(undefined, [], null), true, 'no entry is no complaint');
  for (const status of NOT_SEEN) assert.equal(readFully([{ status: 'ok' }], [{ status }]), false, status);
  assert.equal(readFully([{ status: 'skipped', note: 'HR cases are only included when sensitive data is allowed.' }]), true, 'a read not made on purpose is not a failed read');
  assert.equal(isNotMade({ status: 'skipped' }), true);
  assert.equal(readDone([]), false, 'a read that must have run has an entry');
  assert.equal(readDone([{ status: 'empty' }]), true);
  assert.equal(readDone([{ status: 'ok' }, { status: 'denied' }]), false);
  assert.equal(sourceDone([{ source: 'task_sla', status: 'empty' }, { source: 'sys_user', status: 'denied' }], 'task_sla'), true, 'one source on its own');
  assert.equal(sourceDone([{ source: 'sys_user', status: 'denied' }], 'task_sla'), false);
  assert.deepEqual(unseen([{ status: 'ok' }, { status: 'denied', source: 'a' }], [{ status: 'error', source: 'b' }]).map((a) => a.source), ['a', 'b']);
});

// ---- D1 / R-13: a name is never an id ---------------------------------------------------------------------------------------------

test('disp: a reference the user cannot read has no name, never its id; raw keeps the id for logic', () => {
  assert.equal(disp({ value: GROUP_ID, display_value: '' }), '', 'no display value: the stored value is an id');
  assert.equal(disp({ value: GROUP_ID, display_value: GROUP_ID }), '', 'the id as the display value');
  assert.equal(disp(GROUP_ID), '', 'a plain id');
  assert.equal(raw({ value: GROUP_ID, display_value: '' }), GROUP_ID);
  assert.equal(disp({ value: '2', display_value: '' }), '2', 'a stored value that is not an id still stands in (a choice with no label)');
  assert.equal(disp({ value: GROUP_ID, display_value: 'Network Support' }), 'Network Support');
  assert.equal(disp(null), '');
  assert.equal(disp('plain text'), 'plain text');
});

test('the Team numbers: a group-by key that is an id with no name is "a person you cannot see", not "(unassigned)" and not the id', () => {
  const groups = normalizeGroups([
    { stats: { count: '4' }, groupby_fields: [{ field: 'assigned_to', value: OTHER_ID, display_value: '' }] },
    { stats: { count: '2' }, groupby_fields: [{ field: 'assigned_to', value: '', display_value: '' }] },
    { stats: { count: '1' }, groupby_fields: [{ field: 'assigned_to', value: USER_ID, display_value: 'Beth Anglin' }] },
  ]);
  assert.deepEqual(groups.map((g) => g.keys[0].display), ['', '', 'Beth Anglin'], 'no id as a name');
  assert.equal(keyName(groups[0].keys[0], '(unassigned)', 'A person you cannot see'), 'A person you cannot see');
  assert.equal(keyName(groups[1].keys[0], '(unassigned)', 'A person you cannot see'), '(unassigned)');
  assert.equal(keyName(groups[2].keys[0], '(unassigned)'), 'Beth Anglin');
  assert.equal(keyName(groups[0].keys[0], ''), 'Not shown to you', 'the default for a hidden name');
  // A ticket row in a hand-over or SLA list: the owner whose name is hidden is not "(unassigned)" and not an id.
  assert.equal(nameOf({ value: OTHER_ID, display_value: '' }), 'Not shown to you');
  assert.equal(nameOf({ value: '', display_value: '' }), '');
  assert.equal(nameOf({ value: USER_ID, display_value: 'Beth Anglin' }), 'Beth Anglin');
  const rows = foldByOwner([{ table: 'incident', groups: [{ count: 4, avg: {}, keys: [groups[0].keys[0], { field: 'state', value: '2', display: 'In Progress' }] }, { count: 2, avg: {}, keys: [groups[1].keys[0], { field: 'state', value: '2', display: 'In Progress' }] }] }], '(unassigned)', 'A person you cannot see');
  assert.deepEqual(rows.map((r) => [r.name, r.count]), [['A person you cannot see', 4], ['(unassigned)', 2]]);
  for (const r of rows) assert.ok(!/[0-9a-f]{32}/.test(r.name), 'no id as a name');
});

// ---- R-14: a column that did not come back is not an empty one -----------------------------------------------------------------------

const incident = (over = {}) => ({
  sys_id: v(ID),
  number: v('INC0010001'),
  short_description: v('VPN keeps disconnecting'),
  description: v('It drops every ten minutes since Monday and then the error 809 comes up.'),
  state: v('2', 'In Progress'),
  priority: v('2', '2 - High'),
  category: v('network', 'Network'),
  assignment_group: v(GROUP_ID, 'Network Support'),
  assigned_to: v(USER_ID, 'Beth Anglin'),
  caller_id: v(OTHER_ID, 'Abel Tuter'),
  cmdb_ci: v(CI, 'VPN Gateway EU'),
  business_service: v(SERVICE, 'Remote Access'),
  opened_at: v('2026-10-26 08:00:00'),
  sys_updated_on: v('2026-10-26 09:00:00'),
  ...over,
});
const without = (row, ...names) => Object.fromEntries(Object.entries(row).filter(([k]) => !names.includes(k)));

test('absentColumns: a missing key is not an empty value', () => {
  assert.deepEqual(absentColumns({ a: '', b: v('') }, ['a', 'b', 'c']), ['c']);
  assert.deepEqual(absentColumns(null, ['a']), ['a']);
  assert.deepEqual(absentColumns({}, undefined), []);
});

test('the pack: a column that did not come back is listed as unreadable; an empty one is simply empty; a hidden name is unreadable too', async () => {
  const deps = fakeDeps({ incident: [incident({ category: v(''), assigned_to: v(USER_ID, ''), ...{} })].map((r) => without(r, 'description', 'cmdb_ci')) });
  const pack = await readContextPack({ table: 'incident', sysId: ID }, deps, { feature: 'insights-ticket' });
  assert.ok(!('description' in pack.fields) && !('category' in pack.fields), 'neither is a field of the pack');
  assert.ok(pack.unreadable.includes('description') && pack.unreadable.includes('cmdb_ci'), 'the keys that were missing');
  assert.ok(!pack.unreadable.includes('category'), 'a column that came back empty is empty, not unreadable');
  assert.ok(pack.unreadable.includes('assigned_to'), 'an owner whose name is hidden: the id is not a name and "unassigned" would be false');
  assert.equal(pack.fields.assigned_to, undefined);
  assert.ok(!JSON.stringify(pack).includes(USER_ID) || pack.people.some((p) => p.sysId === USER_ID), 'the id only as a person\'s id');
  // Nothing hidden: the key is not there at all.
  const whole = await readContextPack({ table: 'incident', sysId: ID }, fakeDeps({ incident: [incident({ category: v('') })].map((r) => ({ ...r, hold_reason: v(''), reopen_count: v('0'), reassignment_count: v('0'), contact_type: v(''), subcategory: v(''), impact: v('2'), urgency: v('2'), approval: v(''), due_date: v(''), resolved_at: v(''), closed_at: v(''), close_code: v(''), requested_for: v(''), contact: v(''), consumer: v(''), opened_by: v(OTHER_ID, 'Abel Tuter') })) }), { feature: 'insights-ticket' });
  assert.equal(whole.unreadable, undefined, 'a pack with nothing hidden carries no list');
});

test('missing details: "No description", "No category", "No configuration item" are said only of columns that came back empty', () => {
  const base = { kind: 'incident', fields: { short_description: 'VPN keeps disconnecting', state: 'In Progress' }, people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel@example.com', sysId: OTHER_ID }], access: [] };
  const emptyOnes = missingDetails(base);
  assert.ok(['description', 'ci', 'category'].every((id) => emptyOnes.items.some((i) => i.id === id)), 'empty columns are missing');
  assert.deepEqual(emptyOnes.unchecked, []);
  const hidden = missingDetails({ ...base, unreadable: ['description', 'cmdb_ci', 'category'] });
  assert.ok(!hidden.items.some((i) => ['description', 'ci', 'category', 'impact', 'error', 'steps'].includes(i.id)), 'none of them is reported as missing');
  assert.deepEqual([...hidden.unchecked].sort(), ['category', 'ci', 'description', 'error', 'impact', 'steps']);
  // The caller: a column that did not come back is not "no caller"; an email that did not come back is not "no email".
  const noPeople = { ...base, people: [] };
  assert.ok(missingDetails(noPeople).items.some((i) => i.id === 'contact' && i.title === 'No caller or contact'));
  const callerHidden = missingDetails({ ...noPeople, unreadable: ['caller_id'] });
  assert.ok(!callerHidden.items.some((i) => i.id === 'contact') && callerHidden.unchecked.includes('contact'));
  const noEmail = { ...base, people: [{ role: 'caller', name: 'Abel Tuter', email: '', sysId: OTHER_ID }] };
  assert.ok(missingDetails(noEmail).items.some((i) => i.title === 'No email address for the caller'), 'an empty email is missing');
  const emailHidden = missingDetails({ ...base, people: [{ role: 'caller', name: 'Abel Tuter', email: '', sysId: OTHER_ID, emailUnreadable: true }] });
  assert.ok(!emailHidden.items.some((i) => i.id === 'contact') && emailHidden.unchecked.includes('contact'), 'an email that did not come back may exist');
});

test('people: an email column that did not come back is "cannot read it", an empty one is "no email"; the note says which', async () => {
  const deps = fakeDeps({
    sys_user: [
      { sys_id: v(USER_ID), name: v('Beth Anglin'), email: v('beth@example.com') },
      { sys_id: v(OTHER_ID), name: v('Abel Tuter') }, // no email key at all
    ],
  });
  const { people, access } = await resolvePeople(
    { refs: [{ role: 'assigned_to', sysId: USER_ID, name: 'Beth Anglin', table: 'sys_user' }, { role: 'caller', sysId: OTHER_ID, name: 'Abel Tuter', table: 'sys_user' }] },
    deps
  );
  assert.equal(people.find((p) => p.sysId === USER_ID).emailUnreadable, undefined);
  assert.equal(people.find((p) => p.sysId === OTHER_ID).emailUnreadable, true);
  assert.equal(access[0].status, 'ok');
  assert.equal(access[0].partial, true, 'read, but not everything about these people');
  assert.equal(access[0].note, '1 of 2 people have an email address that you cannot read.');
  const empty = await resolvePeople({ refs: [{ role: 'caller', sysId: OTHER_ID, name: 'Abel Tuter', table: 'sys_user' }] }, fakeDeps({ sys_user: [{ sys_id: v(OTHER_ID), name: v('Abel Tuter'), email: v('') }] }));
  assert.equal(empty.people[0].emailUnreadable, undefined);
  assert.equal(empty.access[0].note, '1 of 1 people have no email address that you can read.');
  assert.equal(empty.access[0].partial, undefined);
});

test('the header: a title that did not come back is not "no short description"', () => {
  const record = { table: 'incident', number: 'INC1' };
  const empty = describeHeader({ phase: 'ready', header: { number: 'INC1', short_description: '', state: 'New', priority: '3' } }, record);
  assert.deepEqual([empty.title, empty.titleKind], ['(no short description)', 'missing']);
  const hidden = describeHeader({ phase: 'ready', header: { number: 'INC1', short_description: '', titleHidden: true, state: 'New', priority: '3' } }, record);
  assert.deepEqual([hidden.title, hidden.titleKind, hidden.tags], ['(short description not shown to you)', 'hidden', ['New', '3']]);
  const text = describeHeader({ phase: 'ready', header: { number: 'INC1', short_description: 'VPN down', titleHidden: true } }, record);
  assert.deepEqual([text.title, text.titleKind], ['VPN down', 'text']);
});

test('the Glance: an owner or group whose name is hidden is "not shown to you", never "nobody yet" or "Unassigned"', () => {
  const pack = { kind: 'incident', fields: { number: 'INC1', state: 'In Progress' }, unreadable: ['assigned_to', 'assignment_group'], people: [], access: [] };
  const rows = glanceDetails(pack, NOW);
  assert.equal(rows.find((r) => r.key === 'assigned').value, 'Not shown to you');
  assert.equal(rows.find((r) => r.key === 'group').value, 'Not shown to you');
  assert.ok(!glanceChips({ g: {}, state: 'In Progress', pack }).some((c) => c.key === 'unassigned'));
  const nobody = { ...pack, unreadable: undefined };
  assert.equal(glanceDetails(nobody, NOW).find((r) => r.key === 'assigned').value, 'Nobody yet');
  assert.ok(glanceChips({ g: {}, state: 'New', pack: nobody }).some((c) => c.key === 'unassigned'));
  assert.equal(ownerText({}, ['assigned_to']), 'Owner not shown to you');
  assert.equal(ownerText({ assignment_group: 'Network Support' }, ['assigned_to']), 'Network Support (owner not shown to you)');
  assert.equal(ownerText({}), 'Unassigned');
  assert.equal(chaseLine({ state: 'progress', owner: '', ownerHidden: true }).text, 'Chase: the owner (not shown to you)');
  assert.equal(chaseLine({ state: 'progress', owner: '' }).text, 'Nobody is named to chase yet.');
});

test('a request: an owner that is not shown is not "nobody is named as owner yet"', () => {
  const pack = { kind: 'requested_item', fields: { number: 'RITM1', state: 'Work in Progress' }, related: { approvals: [], catalogTasks: [] }, access: [] };
  const plain = requestStatus(pack);
  assert.match(plain.line, /nobody is named as owner yet/);
  assert.equal(plain.ownerHidden, false);
  const hidden = requestStatus({ ...pack, unreadable: ['assigned_to'] });
  assert.match(hidden.line, /who has it is not shown to you/);
  assert.equal(hidden.ownerHidden, true);
  // An approver whose name is hidden stays "an approver you cannot see" (the id is not a name).
  const waiting = requestStatus({ ...pack, related: { approvals: [{ approver: '', group: '', state: 'requested', updated: '' }] } });
  assert.match(waiting.line, /an approver you cannot see/);
});

// ---- R-09: the Caller card ---------------------------------------------------------------------------------------------------------

test('caller summary: "none" is said only when every table was checked and the caller column was read', () => {
  const none = { items: [], signals: null };
  assert.equal(callerSummary({ history: { ...none, access: [{ status: 'empty' }, { status: 'empty' }] } }).line, 'No earlier tickets from this caller');
  assert.equal(callerSummary({ history: { ...none, access: [{ status: 'empty' }, { status: 'skipped', note: 'HR cases are only included when sensitive data is allowed.' }] } }).complete, true, 'HR left out on purpose is a rule, not a failure');
  for (const status of ['denied', 'error', 'empty-or-hidden', 'blocked']) {
    const s = callerSummary({ history: { ...none, access: [{ status: 'empty' }, { status }] } });
    assert.equal(s.line, 'Could not check all earlier tickets', status);
    assert.equal(s.complete, false);
  }
  // Found some, could not check the others: what was found stands, and the line says it may not be all.
  const some = callerSummary({ history: { items: [{}, {}], signals: { openCount: 1 }, access: [{ status: 'ok' }, { status: 'denied' }] } });
  assert.equal(some.line, '2 earlier tickets · 1 still open · some could not be checked');
  // The caller column: nobody named is a fact only when the column was read.
  assert.deepEqual([callerSummary({ history: { ...none, noCaller: true } }).line, callerSummary({ history: { ...none, noCaller: true } }).complete], ['Nobody is named as the caller', true]);
  const unread = callerSummary({ history: { ...none, noCaller: 'unreadable' } });
  assert.equal(unread.line, 'Could not read who the caller is');
  assert.deepEqual([unread.noCaller, unread.unreadableCaller, unread.complete], [true, true, false]);
});

test('the earlier tickets of the caller: a full page is "at least"', async () => {
  const row = (n) => ({ sys_id: v(`${String(n).padStart(2, '0')}${'7'.repeat(30)}`), number: v(`INC${n}`), short_description: v('x'), state: v('7', 'Closed'), opened_at: v(`2026-10-${10 + (n % 15)} 08:00:00`), caller_id: v(OTHER_ID, 'Abel') });
  const many = await readCallerHistory({ callerSysId: OTHER_ID, excludeSysId: ID }, fakeDeps({ incident: Array.from({ length: 14 }, (_, i) => row(i + 10)), sc_req_item: [], sn_customerservice_case: [] }), {});
  assert.equal(many.truncated, true);
  assert.equal(many.items.length, 10);
  const few = await readCallerHistory({ callerSysId: OTHER_ID, excludeSysId: ID }, fakeDeps({ incident: [row(10), row(11)], sc_req_item: [], sn_customerservice_case: [] }), {});
  assert.equal(few.truncated, false);
  assert.equal(callerSummary({ history: { items: Array.from({ length: 10 }, () => ({})), signals: { openCount: 0 }, truncated: true, access: [] } }).line, 'At least 10 earlier tickets');
  assert.equal(callerSummary({ history: { items: [{}, {}], signals: { openCount: 0 }, truncated: false, access: [] } }).line, '2 earlier tickets');
});

test('the caller column: a person column that did not come back, and a ticket read without its people, are not "nobody"', () => {
  assert.equal(callerUnreadable({ unreadable: ['caller_id'] }), true);
  assert.equal(callerUnreadable({ unreadable: ['opened_by'] }), false, '"opened by" only stands in for the others');
  assert.equal(callerUnreadable({ unreadable: ['description'] }), false);
  assert.equal(callerUnreadable({ sensitive: true }), true);
  assert.equal(callerUnreadable({ table: 'sn_hr_core_case', access: [{ source: 'sn_hr_core_case', status: 'skipped' }] }), true, 'an HR case is read without its people');
  assert.equal(callerUnreadable({ table: 'incident', access: [{ source: 'journal', status: 'skipped' }] }), false);
  assert.equal(callerUnreadable({}), false);
});

test('related tickets: "0 solved" is said only when the search saw everything', () => {
  assert.equal(relatedSummary({ lookalikes: [], lookalikesSeen: true }).line, '0 solved');
  const unseen = relatedSummary({ lookalikes: [], lookalikesSeen: false });
  assert.equal(unseen.line, 'Could not check solved tickets');
  assert.equal(unseen.solved, null);
  assert.equal(relatedSummary({ lookalikes: [{}, {}], lookalikesSeen: false }).line, '2 solved', 'what was found stands');
  assert.equal(relatedSummary({ lookalikes: [], open: [{}], lookalikesSeen: false }).line, 'Could not check solved tickets · 1 open on the same item');
});

// ---- R-04: the outage spotter ------------------------------------------------------------------------------------------------------

test('outage: a read that could not see is never "no other open tickets"; a full page is "at least"', () => {
  const pack = { fields: { cmdb_ci: 'VPN Gateway EU' } };
  const ok = outageSignal({ hits: [], windowHours: 24, access: [{ status: 'empty' }] }, pack);
  assert.deepEqual([ok.checked, ok.failed, ok.line], [true, false, 'No other open tickets found on VPN Gateway EU in the last 24 h']);
  const hidden = outageSignal({ hits: [], windowHours: 24, access: [{ status: 'empty-or-hidden' }] }, pack);
  assert.deepEqual([hidden.checked, hidden.failed, hidden.line], [false, true, 'Could not check other open tickets on this item']);
  const hit = (i) => ({ number: `INC${i}`, hoursAgo: 0.5, same: ['cmdb_ci'] });
  const cut = outageSignal({ hits: [hit(1), hit(2), hit(3)], truncated: true, access: [{ status: 'ok' }] }, pack);
  assert.equal(cut.atLeast, true);
  assert.equal(cut.line, 'At least 3 other open tickets on VPN Gateway EU in the last 2 h');
  const whole = outageSignal({ hits: [hit(1), hit(2), hit(3)], access: [{ status: 'ok' }] }, pack);
  assert.equal(whole.line, '3 other open tickets on VPN Gateway EU in the last 2 h');
  const skipped = outageSignal({ hits: [], access: [{ status: 'skipped', note: 'No CI.' }] }, pack);
  assert.deepEqual([skipped.checked, skipped.failed], [false, false], 'a skip is neither a check nor a failure');
});

test('findOpenDuplicates: the item or the service not coming back is "hidden", and a full page says so', async () => {
  const row = (n) => ({ sys_id: v(`${String(n).padStart(2, '0')}${'c'.repeat(30)}`), number: v(`INC${n}`), short_description: v('x'), state: v('2'), active: v('true'), opened_at: v('2026-10-26 11:30:00'), assignment_group: v(GROUP_ID, 'NS'), cmdb_ci: v(CI), business_service: v(SERVICE) });
  const own = incident();
  const hiddenCi = fakeDeps({ incident: [without(own, 'cmdb_ci')] });
  const a = await findOpenDuplicates({ table: 'incident', sysId: ID }, hiddenCi, { now: NOW });
  assert.equal(a.access[0].status, STATUS.DENIED);
  assert.equal(a.access[0].reason, READ_REASON.HIDDEN_FIELD);
  assert.deepEqual(hiddenCi.calls.map((c) => c.query), [`sys_id=${ID}`], 'nothing else was asked');
  // A full page of 50: the count is a lower bound.
  const many = fakeDeps({ incident: [own, ...Array.from({ length: 60 }, (_, i) => row(i + 10))] });
  const b = await findOpenDuplicates({ table: 'incident', sysId: ID }, many, { now: NOW, limit: 5 });
  assert.equal(b.truncated, true);
  const few = fakeDeps({ incident: [own, row(10), row(11)] });
  assert.equal((await findOpenDuplicates({ table: 'incident', sysId: ID }, few, { now: NOW })).truncated, false);
});

// ---- R-03, R-21: the look-alikes and the articles read the newest only -------------------------------------------------------------------

test('look-alikes and articles: a full page says that older matches were not read', async () => {
  const kb = (n) => ({ sys_id: v(`${String(n).padStart(2, '0')}${'d'.repeat(30)}`), number: v(`KB${n}`), short_description: v('VPN drops every ten minutes'), text: v('<p>restart the client</p>'), workflow_state: v('published'), sys_updated_on: v('2026-10-01 00:00:00'), kb_knowledge_base: v('b', 'IT'), active: v('true') });
  const pack = { table: 'incident', sysId: ID, fields: { short_description: 'VPN drops every ten minutes' }, people: [] };
  const full = await searchKnowledge(pack, fakeDeps({ kb_knowledge: Array.from({ length: 20 }, (_, i) => kb(i + 10)) }), { now: NOW });
  assert.equal(full.truncated, true);
  const small = await searchKnowledge(pack, fakeDeps({ kb_knowledge: [kb(10), kb(11)] }), { now: NOW });
  assert.equal(small.truncated, false);
  // A retired article is dropped when the row says so (no new read: the column rides on the same one).
  const retired = await searchKnowledge(pack, fakeDeps({ kb_knowledge: [kb(10), { ...kb(11), active: v('false') }] }), { now: NOW });
  assert.deepEqual(retired.hits.map((h) => h.number), ['KB10']);
  const sim = (n) => ({ sys_id: v(`${String(n).padStart(2, '0')}${'e'.repeat(30)}`), number: v(`INC${n}`), short_description: v('VPN drops every ten minutes'), state: v('7', 'Closed'), close_notes: v('Restarted the client.'), sys_updated_on: v(`2026-10-${10 + (n % 15)} 00:00:00`) });
  const look = await findSimilarTickets(pack, fakeDeps({ incident: Array.from({ length: 40 }, (_, i) => sim(i + 10)) }), { resolvedOnly: true });
  assert.equal(look.truncated, true);
});

// ---- R-06, R-14: changes and problems on the ticket's item --------------------------------------------------------------------------

test('changes on the ticket\'s item: an item that did not come back is "hidden", not "no CI"; a ticket with none is a fact', async () => {
  const own = incident();
  const hidden = await readChangesOnTarget({ table: 'incident', sysId: ID }, fakeDeps({ incident: [without(own, 'cmdb_ci')], change_request: [] }), { now: NOW });
  assert.equal(hidden.access[0].status, STATUS.DENIED);
  assert.equal(hidden.access[0].reason, READ_REASON.HIDDEN_FIELD);
  assert.equal(hidden.noTarget, undefined);
  const none = await readChangesOnTarget({ table: 'incident', sysId: ID }, fakeDeps({ incident: [incident({ cmdb_ci: v(''), business_service: v('') })], change_request: [] }), { now: NOW });
  assert.equal(none.access[0].status, STATUS.SKIPPED);
  assert.equal(none.noTarget, true, 'the ticket really has no item');
  const known = await readKnownErrors({ table: 'incident', sysId: ID }, fakeDeps({ incident: [without(own, 'business_service')], problem: [] }));
  assert.equal(known.access[0].status, STATUS.DENIED);
  const noTarget = await readKnownErrors({ table: 'incident', sysId: ID }, fakeDeps({ incident: [incident({ cmdb_ci: v(''), business_service: v('') })], problem: [] }));
  assert.equal(noTarget.noTarget, true);
});

test('changes and problems on the item: one of the two checks failing is not "none"', async () => {
  // The check by service fails (a busy instance); the check by configuration item finds nothing. That is not "no change", "no problem".
  const failing = (tables) => {
    const deps = fakeDeps(tables);
    const ask = deps.queryTable;
    deps.queryTable = async (table, query, ...rest) => {
      if (table !== 'incident' && /business_service=/.test(query)) throw Object.assign(new Error('busy'), { code: 'SN_UNAVAILABLE', reason: 'unavailable' });
      return ask(table, query, ...rest);
    };
    return deps;
  };
  const changes = await readChangesOnTarget({ table: 'incident', sysId: ID }, failing({ incident: [incident()], change_request: [{ sys_id: v('f'.repeat(32)), number: v('CHG1') }] }), { now: NOW });
  assert.equal(changes.access[0].status, STATUS.ERROR, JSON.stringify(changes.access));
  const problems = await readKnownErrors({ table: 'incident', sysId: ID }, failing({ incident: [incident()], problem: [{ sys_id: v('e'.repeat(32)), number: v('PRB1') }] }));
  assert.equal(problems.access[0].status, STATUS.ERROR, JSON.stringify(problems.access));
  // Both worked and found nothing: a fact (the user sees the table).
  const calm = fakeDeps({ incident: [incident()], change_request: [{ sys_id: v('f'.repeat(32)), number: v('CHG1'), cmdb_ci: v('9'.repeat(32)), business_service: v('8'.repeat(32)), start_date: v('2026-10-26 10:00:00'), end_date: v('2026-10-26 14:00:00') }] });
  assert.equal((await readChangesOnTarget({ table: 'incident', sysId: ID }, calm, { now: NOW })).access[0].status, STATUS.EMPTY);
});

test('schedule conflicts: none found is a fact only when the user can see changes at all', async () => {
  const change = { sys_id: v(ID), number: v('CHG0001'), short_description: v('x'), state: v('1'), type: v('normal'), risk: v('2'), start_date: v('2026-10-27 10:00:00'), end_date: v('2026-10-27 12:00:00'), cmdb_ci: v(CI, 'GW'), business_service: v(SERVICE, 'RA'), requested_by: v(USER_ID, 'Beth'), assigned_to: v(USER_ID, 'Beth') };
  const run = (tables, behaviour) => readRelated(['conflicts'], { table: 'change_request', sysId: ID }, fakeDeps(tables, behaviour), new Map());
  const hidden = await run({ change_request: [change] }, { hidden: ['change_request'] });
  // (the change itself is read by the record read in the pack; here the conflicts read sees a table whose every row is filtered)
  assert.ok(hidden.access[0].status !== STATUS.EMPTY, JSON.stringify(hidden.access));
  const seen = await run({ change_request: [change] });
  assert.equal(seen.access[0].status, STATUS.EMPTY, 'the user sees the table (this change) and no other overlaps: none');
  assert.deepEqual(seen.related.conflicts, []);
  const noItem = await run({ change_request: [without(change, 'cmdb_ci')] });
  assert.equal(noItem.access[0].status, STATUS.DENIED);
  assert.equal(noItem.access[0].reason, READ_REASON.HIDDEN_FIELD);
  assert.equal(noItem.related.conflicts, undefined, 'no list: the AI is told it is not available, never "none"');
});

test('the account of a case: a column that did not come back is "hidden", not "no account"', async () => {
  const kase = { sys_id: v(ID), number: v('CS1'), short_description: v('x'), account: v('') };
  const withAccount = async (row) => domainOps.accountCases({ table: 'sn_customerservice_case', sysId: ID }, { deps: fakeDeps({ sn_customerservice_case: [row] }), checkRecord });
  assert.equal((await withAccount(kase)).access[0].status, STATUS.SKIPPED, 'a case with an empty account has none');
  const hidden = await withAccount(without(kase, 'account'));
  assert.equal(hidden.access[0].status, STATUS.DENIED);
  assert.equal(hidden.access[0].reason, READ_REASON.HIDDEN_FIELD);
});

test('the access line of a hidden field says it plainly, with no table or column name', () => {
  const line = accessLine(hiddenFieldEntry('change_request'));
  assert.match(line, /part of this ticket is hidden from you, so this could not be looked up\.$/);
  assert.ok(!/change_request|cmdb_ci|403/.test(line), line);
  assert.equal(readFailureText(hiddenFieldEntry('problem'), { thing: 'Problems' }), 'Problems: part of this ticket is hidden from you, so this could not be looked up.');
  assert.equal(NOTE_TEXT.fieldHidden, 'Part of this ticket is hidden from you, so this could not be looked up.');
});

// ---- R-18, R-19: notes that may be hidden ------------------------------------------------------------------------------------------------

test('notes: work notes that did not come back, with none found another way, are "may be hidden"; empty ones are not', async () => {
  const journalRow = (value, element = 'comments') => ({ sys_id: v('1'.repeat(32)), element: v(element), value: v(value), sys_created_on: v('2026-10-26 09:00:00'), sys_created_by: v('beth.anglin'), element_id: v(ID), name: v('incident') });
  const deps = (rows) => fakeDeps({ sys_journal_field: rows });
  const read = (rows, hiddenColumns, recordText = { comments: '', work_notes: '' }) => readJournal({ table: 'incident', sysId: ID, recordText, hiddenColumns }, deps(rows), {});
  const hidden = await read([journalRow('Please restart the client.')], ['work_notes']);
  assert.equal(hidden.access[0].status, STATUS.OK);
  assert.equal(hidden.access[0].workNotesHidden, true);
  assert.match(hidden.access[0].note, /Some internal notes may be hidden from you\./);
  const empty = await read([journalRow('Please restart the client.')], []);
  assert.equal(empty.access[0].workNotesHidden, undefined, 'the column came back (empty): no note');
  assert.ok(!/hidden/.test(empty.access[0].note));
  const found = await read([journalRow('Please restart the client.'), journalRow('Checked the gateway.', 'work_notes')], ['work_notes']);
  assert.equal(found.access[0].workNotesHidden, undefined, 'a work note was found another way: nothing is hidden that we can tell');
  const comments = await read([journalRow('Checked the gateway.', 'work_notes')], ['comments']);
  assert.equal(comments.access[0].commentsHidden, true);
  assert.match(comments.access[0].note, /Some comments to the customer may be hidden from you\./);
  // Nothing at all: both columns missing from the record is "may be hidden"; an empty journal the user can see is "none that you can see".
  const both = await read([], ['comments', 'work_notes']);
  assert.equal(both.access[0].status, STATUS.EMPTY_OR_HIDDEN);
  const visible = await readJournal({ table: 'incident', sysId: ID, recordText: { comments: '', work_notes: '' }, hiddenColumns: [] }, fakeDeps({ sys_journal_field: [{ ...journalRow('x'), element_id: v('2'.repeat(32)) }] }), {});
  assert.equal(visible.access[0].status, STATUS.EMPTY);
  assert.equal(visible.access[0].note, 'No notes or comments that you can see.');
});

// ---- R-20: risk ------------------------------------------------------------------------------------------------------------------------

test('risk: "no warning signs" is said of what could be read, and the rest is named', () => {
  const pack = { kind: 'incident', fields: { priority: '3 - Moderate', short_description: 'x' }, people: [], journal: [], related: {}, access: [] };
  const clean = riskSignals({ pack, now: NOW });
  assert.equal(clean.summary, 'No warning signs');
  assert.deepEqual(clean.notChecked, []);
  const partial = riskSignals({ pack, now: NOW, notChecked: ['sla', 'vip', 'sla'] });
  assert.equal(partial.summary, 'No warning signs found; could not check the SLA, the VIP flag');
  assert.equal(partial.couldNot, 'the SLA, the VIP flag');
  assert.deepEqual(partial.notChecked, ['sla', 'vip']);
  // A real signal still leads; the unread facts do not hide it.
  const vip = riskSignals({ pack, now: NOW, vip: true, notChecked: ['sla'] });
  assert.match(vip.summary, /VIP caller/);
  assert.equal(vip.couldNot, 'the SLA');
});

test('risk: which facts the glance read could not see', () => {
  const answer = (over = {}) => ({ pack: { access: [{ source: 'journal', status: 'ok' }] }, slas: { access: [{ status: 'empty' }] }, vip: { status: 'no', access: [] }, ...over });
  assert.deepEqual(factsNotRead(answer(), null), []);
  assert.deepEqual(factsNotRead(answer({ slas: { access: [{ status: 'denied' }] } }), null), ['sla']);
  assert.deepEqual(factsNotRead(answer({ vip: { status: 'unknown', access: [{ status: 'denied' }] } }), null), ['vip']);
  assert.deepEqual(factsNotRead(answer(), { failed: true }), ['outage']);
  assert.deepEqual(factsNotRead(answer({ pack: { access: [{ source: 'journal', status: 'empty-or-hidden' }], unreadable: ['reopen_count'] } }), null), ['notes', 'counts']);
});

test('the VIP flag: a caller row or a column that did not come back is "could not read", not "not a VIP"', async () => {
  const pack = { table: 'incident', sysId: ID, people: [{ role: 'caller', sysId: OTHER_ID, name: 'Abel' }], access: [] };
  const flag = (v1) => readVip(pack, fakeDeps({ sys_user: [{ sys_id: v(OTHER_ID), ...v1 }] }));
  const no = await flag({ vip: v('false') });
  assert.deepEqual([no.status, no.access.length], ['no', 0]);
  const hidden = await flag({});
  assert.equal(hidden.status, 'unknown');
  assert.equal(hidden.access.length, 1, 'said, so the risk card names it');
  assert.equal((await readVip(pack, fakeDeps({ sys_user: [] }))).access.length, 1, 'no row at all');
});

test('routing: "no assignment group yet" is not said when the group did not come back', () => {
  const hits = [
    { number: 'INC1', assignment_group: 'Network Support', category: 'network' },
    { number: 'INC2', assignment_group: 'Network Support', category: 'network' },
    { number: 'INC3', assignment_group: 'Network Support', category: 'network' },
  ];
  assert.equal(routingVote(hits, { group: '', category: 'network' }).detail, 'This ticket has no assignment group yet.');
  assert.equal(routingVote(hits, { group: '', category: 'network', groupUnreadable: true }).detail, '');
});

// ---- R-05, R-07: the AI side says "that your user can see" ---------------------------------------------------------------------------------

test('the empty lists the AI is told about all say "that your user can see"', () => {
  for (const key of ['slas', 'approvals', 'childTasks', 'changeTasks', 'linkedIncidents']) {
    assert.match(relatedText(key, { related: { [key]: [] } }), /that your user can see/, key);
  }
  assert.equal(relatedText('childTasks', { related: {} }), '', 'a list that could not be read is not described as empty');
});
