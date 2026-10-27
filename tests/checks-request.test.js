import test from 'node:test';
import assert from 'node:assert/strict';
import { answersModel, approvalsModel, buildRequestView, chainModel, requestExplainParts } from '../src/checks/requestView.js';
import { readContextPack } from '../src/context/pack.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { REQUEST_ID, RITM_ID } from './fixtures/sn-requested-item.js';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const ritm = (over = {}) => ({ kind: 'requested_item', fields: { number: 'RITM1', state: 'Open' }, related: {}, access: [], ...over });

// ---- the answers table -------------------------------------------------------------------------------------------------

test('answers: question and answer rows; masked answers show as one "hidden" row from the access note', () => {
  const model = answersModel(ritm({
    related: { variables: [{ question: 'Operating system', value: 'Windows 11' }] },
    access: [{ source: 'sc_item_option_mtom', status: 'ok', note: '2 masked or secret answers were left out. 1 reference answer could not be shown.' }],
  }));
  assert.equal(model.applicable, true);
  assert.deepEqual(model.rows, [
    { question: 'Operating system', value: 'Windows 11', hidden: false },
    { question: 'Masked or secret answers', value: 'hidden (2)', hidden: true },
  ]);
  assert.equal(model.note, '1 reference answer could not be shown.');
});

test('answers: a row the context engine marks hidden, or an empty one, shows "hidden" and never a value', () => {
  const model = answersModel(ritm({ related: { variables: [{ question: 'Admin password', value: 'sekret-1', hidden: true }, { question: 'Blank', value: '' }] } }));
  assert.deepEqual(model.rows.map((r) => [r.question, r.value, r.hidden]), [['Admin password', 'hidden', true], ['Blank', 'hidden', true]]);
  assert.ok(!JSON.stringify(model).includes('sekret-1'));
});

test('answers: only a requested item has them; a denied read says so', () => {
  assert.equal(answersModel({ kind: 'request', related: {} }).applicable, false);
  assert.equal(answersModel({ kind: 'catalog_task', related: {} }).applicable, false);
  const denied = answersModel(ritm({ related: {}, access: [{ source: 'sc_item_option_mtom', status: 'denied', note: 'x' }] }));
  assert.equal(denied.available, false);
  assert.match(denied.note, /cannot read the answers/);
  const none = answersModel(ritm({ related: { variables: [] } }));
  assert.equal(none.available, true);
  assert.deepEqual(none.rows, []);
});

// ---- approvals and chain -------------------------------------------------------------------------------------------------

test('approvals: who, state, when and a tone; an approval with no name is not invented', () => {
  const model = approvalsModel(ritm({ related: { approvals: [{ approver: 'Dave', state: 'Approved', updated: 'a' }, { approver: '', group: '', state: 'Requested', updated: '' }, { approver: 'Eve', state: 'Rejected', updated: '' }] } }));
  assert.deepEqual(model.rows.map((r) => [r.who, r.tone]), [['Dave', 'ok'], ['an approver you cannot see', 'warn'], ['Eve', 'danger']]);
  assert.equal(approvalsModel({ kind: 'catalog_task', related: {} }).applicable, false);
  assert.equal(approvalsModel(ritm({ related: {} })).available, false);
});

test('chain: catalog tasks under an item, items under a request, the open record marked', () => {
  const rows = [{ number: 'SCTASK1', short_description: 'Image', state: 'Closed Complete', assignedTo: 'Beth', assignmentGroup: 'DS', active: 'false' }, { number: 'SCTASK2', short_description: 'Ship', state: 'Open', assignedTo: '', assignmentGroup: '', active: 'true' }];
  const model = chainModel(ritm({ related: { catalogTasks: rows } }), { currentNumber: 'SCTASK2' });
  assert.equal(model.title, 'Catalog tasks');
  assert.deepEqual(model.rows.map((r) => [r.number, r.open, r.done, r.current, r.owner]), [['SCTASK1', false, true, false, 'Beth in DS'], ['SCTASK2', true, false, true, '']]);
  const items = chainModel({ kind: 'request', related: { items: [{ number: 'RITM1', item: 'Laptop', short_description: '', state: 'Open', due: '2026-10-30' }] } });
  assert.equal(items.title, 'Requested items');
  assert.equal(items.rows[0].label, 'Laptop');
  assert.equal(chainModel({ kind: 'catalog_task', related: {} }).applicable, false);
  assert.equal(chainModel(ritm({ related: {} })).available, false);
});

// ---- from a real pack (the fixture requested item and request) --------------------------------------------------------------

test('the Request tab for the fixture requested item: waits for the procurement approval, shows answers, approvals and the chain', async () => {
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, fakeDeps(buildInstance()), { feature: 'request-status' });
  const view = buildRequestView(pack, { currentNumber: 'SCTASK0010061', now: NOW });
  assert.equal(view.number, 'RITM0010050');
  assert.equal(view.status.state, 'approval');
  assert.equal(view.status.owner, 'IT Procurement');
  assert.deepEqual(view.status.due, { text: '2026-10-30 17:00:00', overdue: false });
  assert.ok(view.answers.rows.some((r) => r.question === 'Operating system' && r.value === 'Windows 11'));
  assert.ok(view.answers.rows.some((r) => r.hidden && /hidden \(2\)/.test(r.value)), 'the two masked answers are one hidden row');
  assert.ok(!JSON.stringify(view).includes('hunter2'), 'the secret answer is nowhere');
  assert.ok(!JSON.stringify(view).includes('4417'), 'the answer to a question named like a secret is nowhere');
  assert.deepEqual(view.approvals.rows.map((r) => r.who), ['IT Procurement', 'Dave Loftus']);
  assert.deepEqual(view.chain.rows.map((r) => [r.number, r.current]), [['SCTASK0010060', false], ['SCTASK0010061', true]]);
  assert.ok(view.facts.some(([label, value]) => label === 'Opened' && value === '2026-10-23 11:00:00'));
  assert.ok(!view.facts.some(([label]) => label === 'Due'), 'the due date is on the status card, not repeated');
});

test('the Request tab for the fixture request: items are the chain', async () => {
  const pack = await readContextPack({ table: 'sc_request', sysId: REQUEST_ID }, fakeDeps(buildInstance()), { feature: 'request-status' });
  const view = buildRequestView(pack, { now: NOW });
  assert.equal(view.chain.title, 'Requested items');
  assert.equal(view.chain.rows[0].number, 'RITM0010050');
  assert.equal(view.answers.applicable, false);
  assert.equal(view.status.state, 'task');
  assert.match(view.status.line, /RITM0010050/);
});

test('when approvals are hidden from the user the tab says so instead of saying nothing is waiting', async () => {
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, fakeDeps(buildInstance(), { denied: ['sysapproval_approver'] }), { feature: 'request-status' });
  const view = buildRequestView(pack, { now: NOW });
  assert.equal(view.approvals.available, false);
  assert.ok(view.status.caveats.some((c) => /cannot see approvals/.test(c)));
});

// ---- what the AI message is written from -------------------------------------------------------------------------------------

test('request-explain parts: the status the tool worked out, approvals and tasks; no answers, no work notes', async () => {
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, fakeDeps(buildInstance()), { feature: 'request-explain' });
  const parts = requestExplainParts({ ...pack, journal: [...pack.journal, { when: '2026-10-26 09:00:00', by: 'Beth Anglin', type: 'work_note', text: 'INTERNAL-WORK-NOTE' }] });
  const text = parts.map((p) => `${p.label}\n${p.text}`).join('\n---\n');
  assert.match(text, /Status worked out from the records/);
  assert.match(text, /Waiting for approval from IT Procurement/);
  assert.match(text, /Approvals\nIT Procurement: Requested/);
  assert.match(text, /Catalog tasks/);
  assert.match(text, /SCTASK0010061 \(Deliver the laptop\): Work in Progress, with Beth Anglin in Desktop Support/);
  assert.ok(!text.includes('Windows 11'), 'the answers to the request questions are not sent');
  assert.ok(!text.includes('INTERNAL-WORK-NOTE'), 'work notes are not sent');
  for (const p of parts) assert.ok(p.label && p.field && typeof p.text === 'string' && p.text.trim(), JSON.stringify(p));
});

test('the request-explain pack reads less than the Request tab: no answers, no assignee column', async () => {
  const deps = fakeDeps(buildInstance());
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, deps, { feature: 'request-explain' });
  assert.equal(pack.related.variables, undefined);
  assert.equal(deps.callsTo('sc_item_option_mtom').length, 0);
  assert.equal(pack.fields.assigned_to, undefined);
  assert.equal(pack.fields.assignment_group, undefined);
  assert.ok(pack.fields.requested_for, 'the requester is on the pack so the firewall masks the name exactly');
});
