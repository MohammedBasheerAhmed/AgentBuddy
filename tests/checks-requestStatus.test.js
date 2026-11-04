import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStatus, accessNotes, describeApproval, taskLine } from '../src/checks/requestStatus.js';
import { approvalKind, daysSinceSnTime, finishedKind, isFinishedState, isHoldState, isOpenItem, ownerOf } from '../src/checks/states.js';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

// A pack as src/context builds it (only the parts the status reads).
const pack = (over = {}) =>
  deepFreeze({
    version: 1,
    table: 'sc_req_item',
    sysId: 'e'.repeat(32),
    number: 'RITM0010050',
    kind: 'requested_item',
    fields: { number: 'RITM0010050', state: 'Work in Progress', approval: 'Approved', assigned_to: 'Beth Anglin', assignment_group: 'Desktop Support' },
    people: [],
    journal: [],
    related: { approvals: [], catalogTasks: [] },
    access: [],
    ...over,
  });

const task = (number, desc, state, active, assignedTo = '', assignmentGroup = '') => ({ number, short_description: desc, state, active, assignedTo, assignmentGroup });

// ---- states ----------------------------------------------------------------------------------------------------------

test('finished states are recognised by what the person sees, and unknown words stay unknown', () => {
  for (const s of ['Closed Complete', 'Closed Incomplete', 'Closed Skipped', 'Cancelled', 'Canceled', 'Resolved', 'Complete']) assert.ok(isFinishedState(s), s);
  for (const s of ['Open', 'Work in Progress', 'Pending', 'Awaiting User Info', '', 'Completion pending', undefined]) assert.ok(!isFinishedState(s), String(s));
  assert.equal(finishedKind('Closed Complete'), 'done');
  assert.equal(finishedKind('Resolved'), 'done');
  assert.equal(finishedKind('Closed Incomplete'), 'ended');
  assert.equal(finishedKind('Cancelled'), 'ended');
  assert.equal(finishedKind('Closed Skipped'), 'ended');
  assert.equal(finishedKind('Open'), '');
});

test('hold states', () => {
  for (const s of ['On Hold', 'Pending', 'Awaiting Caller', 'Waiting for customer']) assert.ok(isHoldState(s), s);
  for (const s of ['Open', 'Work in Progress', 'Closed Complete', '']) assert.ok(!isHoldState(s), s);
});

test('approval words: asked, not yet asked, approved, rejected, ignored', () => {
  assert.equal(approvalKind('Requested'), 'pending');
  assert.equal(approvalKind('Awaiting approval'), 'pending');
  assert.equal(approvalKind('Not Yet Requested'), 'queued');
  assert.equal(approvalKind('Not requested'), 'queued');
  assert.equal(approvalKind('Approved'), 'approved');
  assert.equal(approvalKind('Rejected'), 'rejected');
  assert.equal(approvalKind('Cancelled'), 'ignored');
  assert.equal(approvalKind('Not Required'), 'ignored');
  assert.equal(approvalKind(''), '');
  assert.equal(approvalKind('Something else'), '');
});

test('an item is open by its active flag, else by its state; an unknown state counts as open', () => {
  assert.ok(isOpenItem({ active: 'true', state: 'Closed Complete' }));
  assert.ok(!isOpenItem({ active: 'false', state: 'Open' }));
  assert.ok(!isOpenItem({ active: '', state: 'Closed Complete' }));
  assert.ok(isOpenItem({ active: '', state: 'Work in Progress' }));
  assert.ok(isOpenItem({ state: 'Strange new state' }));
});

test('ownerOf and daysSinceSnTime', () => {
  assert.equal(ownerOf({ assignedTo: 'Beth Anglin', assignmentGroup: 'Desktop Support' }), 'Beth Anglin in Desktop Support');
  assert.equal(ownerOf({ assignmentGroup: 'Desktop Support' }), 'Desktop Support');
  assert.equal(ownerOf({ assignedTo: 'Beth Anglin' }), 'Beth Anglin');
  assert.equal(ownerOf({}), '');
  assert.equal(Math.round(daysSinceSnTime('2026-10-24 12:00:00', NOW)), 3);
  assert.ok(Number.isNaN(daysSinceSnTime('24/10/2026 12:00', NOW)));
  assert.ok(Number.isNaN(daysSinceSnTime('', NOW)));
});

// ---- the status line -------------------------------------------------------------------------------------------------

test('a finished request says so and has nothing to chase', () => {
  const s = requestStatus(pack({ fields: { state: 'Closed Complete' } }), { now: NOW });
  assert.equal(s.state, 'done');
  assert.match(s.line, /Finished \(Closed Complete\)/);
  assert.equal(s.owner, '');
  const ended = requestStatus(pack({ fields: { state: 'Closed Incomplete' } }), { now: NOW });
  assert.equal(ended.state, 'ended');
  assert.match(ended.line, /without being completed/);
  // A request keeps its state in request_state too.
  assert.equal(requestStatus(pack({ kind: 'request', fields: { state: '', request_state: 'Closed Complete' }, related: {} }), { now: NOW }).state, 'done');
});

test('a pending approval names the approver (or the group) and when it was asked', () => {
  const s = requestStatus(pack({ related: { approvals: [{ approver: 'Dave Loftus', group: '', state: 'Approved', updated: '2026-10-23 12:00:00' }, { approver: '', group: 'IT Procurement', state: 'Requested', updated: '2026-10-24 08:00:00' }], catalogTasks: [task('SCTASK1', 'Image', 'Open', 'true')] } }), { now: NOW });
  assert.equal(s.state, 'approval');
  assert.equal(s.line, 'Waiting for approval from IT Procurement (asked 2026-10-24 08:00:00).');
  assert.equal(s.owner, 'IT Procurement');
  assert.deepEqual(s.blockers, ['approval from IT Procurement']);
});

test('several pending approvals are listed, three at most then "and N more"', () => {
  const rows = ['A One', 'B Two', 'C Three', 'D Four', 'E Five'].map((approver) => ({ approver, group: '', state: 'Requested', updated: '' }));
  const s = requestStatus(pack({ related: { approvals: rows } }), { now: NOW });
  assert.match(s.line, /A One, B Two, C Three and 2 more/);
  const two = requestStatus(pack({ related: { approvals: rows.slice(0, 2) } }), { now: NOW });
  assert.match(two.line, /A One and B Two/);
});

test('a rejected approval wins over everything but being finished', () => {
  const s = requestStatus(pack({ related: { approvals: [{ approver: 'Dave Loftus', state: 'Rejected', updated: '' }, { approver: 'Eve', state: 'Requested', updated: '' }], catalogTasks: [task('T', 'x', 'Open', 'true')] } }), { now: NOW });
  assert.equal(s.state, 'rejected');
  assert.match(s.line, /rejected by Dave Loftus/);
  assert.equal(requestStatus(pack({ fields: { state: 'Work in Progress', approval: 'Rejected' }, related: {} }), { now: NOW }).state, 'rejected');
});

test('the approval column says "requested" but no approval row is visible: still waiting, and honest about why', () => {
  const hidden = requestStatus(pack({ fields: { state: 'Open', approval: 'Requested' }, related: {}, access: [{ source: 'sysapproval_approver', status: 'denied', note: '' }] }), { now: NOW });
  assert.equal(hidden.state, 'approval');
  assert.match(hidden.line, /you cannot see the approvals/);
  const empty = requestStatus(pack({ fields: { state: 'Open', approval: 'Requested' }, related: { approvals: [] } }), { now: NOW });
  assert.match(empty.line, /not visible to you/);
});

test('"not yet requested" approvals do not block', () => {
  const s = requestStatus(pack({ related: { approvals: [{ approver: 'Dave', state: 'Not Yet Requested', updated: '' }], catalogTasks: [] } }), { now: NOW });
  assert.equal(s.state, 'progress');
});

test('on hold shows the hold reason; without one it says the record gives none', () => {
  const withReason = requestStatus(pack({ fields: { state: 'On Hold', hold_reason: 'Awaiting stock', assigned_to: 'Beth Anglin', assignment_group: 'Desktop Support' } }), { now: NOW });
  assert.equal(withReason.state, 'hold');
  assert.equal(withReason.line, 'On hold: Awaiting stock.');
  assert.equal(withReason.owner, 'Beth Anglin in Desktop Support');
  const without = requestStatus(pack({ fields: { state: 'Pending' } }), { now: NOW });
  assert.equal(without.state, 'hold');
  assert.match(without.line, /Pending\. No reason is given/);
});

test('an open catalog task names its number, state and owner; closed ones are skipped; more open ones are counted', () => {
  const tasks = [task('SCTASK1', 'Image the laptop', 'Closed Complete', 'false', 'Beth Anglin', 'Desktop Support'), task('SCTASK2', 'Deliver the laptop', 'Work in Progress', 'true', 'Beth Anglin', 'Desktop Support'), task('SCTASK3', 'Collect the old one', 'Open', 'true')];
  const s = requestStatus(pack({ related: { approvals: [], catalogTasks: tasks } }), { now: NOW });
  assert.equal(s.state, 'task');
  assert.equal(s.line, 'Waiting on SCTASK2 (Deliver the laptop), Work in Progress, with Beth Anglin in Desktop Support. 1 more task is open after it.');
  assert.equal(s.owner, 'Beth Anglin in Desktop Support');
  assert.equal(s.blockers.length, 2);
  const unassigned = requestStatus(pack({ related: { approvals: [], catalogTasks: [task('SCTASK9', 'Ship', 'Open', 'true')] } }), { now: NOW });
  assert.match(unassigned.line, /not assigned to anyone yet/);
  assert.equal(unassigned.owner, '');
});

test('all tasks closed and nothing else blocking: in progress with the item\'s own owner', () => {
  const s = requestStatus(pack({ related: { approvals: [], catalogTasks: [task('SCTASK1', 'x', 'Closed Complete', 'false')] } }), { now: NOW });
  assert.equal(s.state, 'progress');
  assert.equal(s.line, 'In progress. Nothing is blocking it; it is with Beth Anglin in Desktop Support.');
});

test('in progress says when approvals or tasks could not be read, instead of claiming nothing blocks it', () => {
  const s = requestStatus(pack({ related: {}, access: [{ source: 'sysapproval_approver', status: 'denied', note: '' }, { source: 'sc_task', status: 'denied', note: '' }] }), { now: NOW });
  assert.equal(s.state, 'progress');
  assert.match(s.line, /approvals and catalog tasks could not be read, so this may be incomplete/);
  assert.equal(s.caveats.length, 2);
});

test('a request looks at its items: one open item, several, one waiting for approval, all done', () => {
  const item = (number, state, approval = 'Approved', over = {}) => ({ number, item: 'Laptop', short_description: '', state, approval, assignedTo: '', assignmentGroup: '', due: '', ...over });
  const req = (items, fields = {}) => pack({ table: 'sc_request', kind: 'request', fields: { number: 'REQ1', state: 'Open', request_state: 'In Process', ...fields }, related: { items, approvals: [] } });
  assert.equal(requestStatus(req([item('RITM1', 'Closed Complete'), item('RITM2', 'Work in Progress', 'Approved', { assignmentGroup: 'Desktop Support' })]), { now: NOW }).line, 'Waiting on RITM2 (Laptop), Work in Progress, with Desktop Support.');
  assert.equal(requestStatus(req([item('RITM1', 'Open'), item('RITM2', 'Open'), item('RITM3', 'Open')]), { now: NOW }).line, '3 requested items are still open: RITM1, RITM2 and RITM3.');
  const waiting = requestStatus(req([item('RITM1', 'Open', 'Requested'), item('RITM2', 'Open')]), { now: NOW });
  assert.equal(waiting.state, 'approval');
  assert.match(waiting.line, /RITM1 \(Laptop\) is waiting for approval/);
  const alldone = requestStatus(req([item('RITM1', 'Closed Complete')]), { now: NOW });
  assert.match(alldone.line, /All requested items are done, but the request itself is still open/);
});

test('a catalog task seen on its own is the work itself', () => {
  const s = requestStatus(pack({ kind: 'catalog_task', fields: { number: 'SCTASK1', short_description: 'Deliver', state: 'Open', assigned_to: 'Beth Anglin' }, related: {} }), { now: NOW });
  assert.equal(s.state, 'task');
  assert.equal(s.line, 'This task is open and with Beth Anglin.');
});

test('due date: shown as written; "past due" only when it is certain in any time zone', () => {
  const due = (text) => requestStatus(pack({ fields: { state: 'Work in Progress', due_date: text }, related: {} }), { now: NOW }).due;
  assert.deepEqual(due('2026-10-20 10:00:00'), { text: '2026-10-20 10:00:00', overdue: true });
  assert.deepEqual(due('2026-11-05 10:00:00'), { text: '2026-11-05 10:00:00', overdue: false });
  assert.equal(due('2026-10-27 15:00:00').overdue, null, 'within a day: the time zone decides, so no claim');
  assert.equal(due('27/10/2026').overdue, null);
  assert.equal(due(''), null);
});

test('SLA: breached first, else the running one, paused and finished are described', () => {
  const sla = (slas) => requestStatus(pack({ related: { slas, approvals: [], catalogTasks: [] } }), { now: NOW }).sla;
  assert.deepEqual(sla([{ name: 'Fulfil in 5 days', stage: 'In progress', breached: 'false', percentage: '60', plannedEnd: '2026-10-30 17:00:00' }]), { text: 'SLA "Fulfil in 5 days", 60% of the time used, due 2026-10-30 17:00:00.', breached: false });
  assert.deepEqual(sla([{ name: 'A', stage: 'In progress', breached: 'false' }, { name: 'B', stage: 'In progress', breached: 'true' }]), { text: 'SLA "B" is breached.', breached: true });
  assert.match(sla([{ name: 'P', stage: 'Paused', breached: 'false', plannedEnd: '2026-10-30' }]).text, /is paused\.$/);
  assert.match(sla([{ name: 'D', stage: 'Completed', breached: 'false' }]).text, /finished/);
  assert.equal(sla([]), null);
});

// Audit P3.15: when no SLA is running, the line names the SLA and says whether it was met or cancelled.
test('SLA: none running says which one, and a cancelled SLA is not called finished', () => {
  const sla = (slas) => requestStatus(pack({ related: { slas, approvals: [], catalogTasks: [] } }), { now: NOW }).sla;
  assert.deepEqual(sla([{ name: 'Deliver in 3 days', stage: 'Completed', breached: 'false' }]), { text: 'SLA "Deliver in 3 days" is finished.', breached: false });
  assert.deepEqual(sla([{ name: 'Deliver in 3 days', stage: 'Cancelled', breached: 'false' }]), { text: 'SLA "Deliver in 3 days" was cancelled.', breached: false });
  assert.deepEqual(sla([{ name: '', stage: 'Achieved', breached: 'false' }]), { text: 'SLA "unnamed" is finished.', breached: false });
  assert.equal(sla([{ name: 'A', stage: 'Cancelled' }, { name: 'B', stage: 'Cancelled' }]).text, 'Every SLA was cancelled.');
  assert.equal(sla([{ name: 'A', stage: 'Completed' }, { name: 'B', stage: 'Achieved' }]).text, 'Every SLA is finished.');
  assert.equal(sla([{ name: 'A', stage: 'Completed' }, { name: 'B', stage: 'Cancelled' }]).text, 'No SLA is running: some were met, some cancelled.');
});

test('access notes say what could not be read, in plain words, for the sources the view shows', () => {
  const notes = accessNotes([
    { source: 'sysapproval_approver', status: 'denied', note: '' },
    { source: 'sc_task', status: 'error', note: 'Could not read sc_task: boom' },
    { source: 'task_sla', status: 'empty-or-hidden', note: '' },
    { source: 'sc_item_option_mtom', status: 'ok', note: '2 masked or secret answers were left out.' },
    { source: 'sys_user', status: 'denied', note: '' },
  ]);
  assert.deepEqual(notes, [
    'You cannot see approvals on this instance, so they are left out.',
    'Catalog tasks could not be read just now, so they are left out.',
    'Your user sees no SLAs at all, so there may be some that an access rule hides.',
  ]);
  assert.deepEqual(accessNotes(undefined), []);
});

test('the status is pure: a frozen pack is never changed and the same input gives the same answer', () => {
  const p = pack({ related: { approvals: [{ approver: 'Dave', state: 'Requested', updated: '' }], catalogTasks: [] } });
  assert.deepEqual(requestStatus(p, { now: NOW }), requestStatus(p, { now: NOW }));
});

test('describeApproval and taskLine', () => {
  assert.deepEqual(describeApproval({ approver: '', group: '', state: 'Requested', updated: 'x' }), { who: 'an approver you cannot see', named: false, state: 'Requested', kind: 'pending', updated: 'x' });
  assert.equal(taskLine({ number: 'SCTASK1', short_description: 'Image' }), 'SCTASK1 (Image)');
  assert.equal(taskLine({ number: 'RITM1', item: 'Laptop' }), 'RITM1 (Laptop)');
  assert.equal(taskLine({ number: 'RITM1' }), 'RITM1');
});
