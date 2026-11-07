import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_TABLES, bucketFor, classifyState, reportClassFor, stageFor, waitsOn } from '../src/domain/states.js';

// Wave 4, live checks of 2026-11-07 (docs/live-checks-2026-11-07.md): the state values read on the real instance.

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'states.md'), 'utf8');
const cls = (table, value, extra = {}) => classifyState({ table, value, ...extra });

test('a problem task has its own values: 151 New, 152 Assess, 154 Work in Progress, 157 Closed', () => {
  assert.equal(cls('problem_task', '151'), 'new');
  assert.equal(cls('problem_task', '152'), 'working');
  assert.equal(cls('problem_task', '154'), 'working');
  assert.equal(cls('problem_task', '157'), 'closed');
  // by the stored value alone, and agreeing with the words the instance shows
  assert.equal(cls('problem_task', 152, { label: 'Assess' }), 'working');
  assert.equal(cls('problem_task', ' 157 ', { label: 'Closed' }), 'closed');
  // the screens' words follow
  assert.equal(stageFor({ table: 'problem_task', value: '151' }), 'new');
  assert.equal(stageFor({ table: 'problem_task', value: '157' }), 'closed');
  assert.equal(bucketFor({ table: 'problem_task', value: '152' }), 'progress');
  assert.equal(reportClassFor({ table: 'problem_task', value: '157' }), 'resolved');
  // a renamed state on a site is still understood by its stored value (the table is Sure)
  assert.equal(cls('problem_task', '157', { label: 'Erledigt und weg' }), 'closed');
  // the task values stay for a release that uses them
  assert.equal(cls('problem_task', '3'), 'closed');
  assert.equal(cls('problem_task', '-5'), 'waiting');
});

test('a change task has -5 Pending, 1 Open, 2 In Progress, 3 Closed (closed), 4 Canceled (cancelled)', () => {
  assert.deepEqual(
    ['-5', '1', '2', '3', '4'].map((value) => cls('change_task', value)),
    ['waiting', 'working', 'working', 'closed', 'cancelled']
  );
  assert.equal(cls('change_task', '3', { label: 'Closed' }), 'closed');
  assert.equal(cls('change_task', '4', { label: 'Canceled' }), 'cancelled');
  assert.equal(cls('change_task', '', { label: 'Canceled' }), 'cancelled', 'the live word alone');
  assert.equal(cls('change_task', '', { label: 'In Progress' }), 'working');
  const live = STATE_TABLES.change_task.rows.map(([value, label]) => [value, label]).filter(([value]) => value !== '7');
  assert.deepEqual(live, [['-5', 'Pending'], ['1', 'Open'], ['2', 'In Progress'], ['3', 'Closed'], ['4', 'Canceled']]);
});

test('the task family reads -5/1/2/3/4/7 (task, sc_task, sc_req_item), as measured', () => {
  for (const table of ['sc_task', 'sc_req_item', 'incident_task']) {
    assert.deepEqual(['-5', '1', '2', '3', '4', '7'].map((value) => cls(table, value)), ['waiting', 'working', 'working', 'closed', 'cancelled', 'cancelled'], table);
  }
});

// ---- the stage of a requested item ------------------------------------------------------------------------------------------------

test('a requested item\'s stage decides where the state says nothing: delivery and fulfillment are working, complete is closed, request_cancelled is cancelled', () => {
  const ritm = { table: 'sc_req_item' };
  for (const [stage, meaning] of [
    ['delivery', 'working'],
    ['fulfillment', 'working'],
    ['Fulfillment', 'working'],
    ['Delivery', 'working'],
    ['complete', 'closed'],
    ['Complete', 'closed'],
    ['closed_complete', 'closed'],
    ['request_cancelled', 'cancelled'],
    ['Request Cancelled', 'cancelled'],
    ['closed_cancelled', 'cancelled'],
    ['waiting_for_approval', 'waiting'],
    ['Waiting for Approval', 'waiting'],
  ]) assert.equal(classifyState({ ...ritm, stage }), meaning, stage);
  // the same with a state this file does not know and a label that says nothing
  assert.equal(classifyState({ ...ritm, value: '55', label: 'Zzz', stage: 'fulfillment' }), 'working');
});

test('any other stage falls back to the words of its label; a stage with none stays unknown', () => {
  const ritm = { table: 'sc_req_item' };
  assert.equal(classifyState({ ...ritm, stage: 'request_approved' }), 'working', 'approved');
  assert.equal(classifyState({ ...ritm, stage: 'Rejected' }), 'cancelled');
  assert.equal(classifyState({ ...ritm, stage: 'Awaiting Delivery' }), 'waiting');
  assert.equal(classifyState({ ...ritm, stage: 'مكتمل' }), 'closed');
  assert.equal(classifyState({ ...ritm, stage: 'Zzz' }), 'unknown');
  assert.equal(classifyState({ ...ritm, stage: '' }), 'unknown');
  assert.equal(classifyState({ ...ritm }), 'unknown');
});

test('the stage never overrules a state the file knows, and never reopens or closes a ticket on its own say-so', () => {
  const ritm = { table: 'sc_req_item' };
  assert.equal(classifyState({ ...ritm, value: '3', stage: 'fulfillment' }), 'closed', 'a closed item at the fulfillment stage is closed');
  assert.equal(classifyState({ ...ritm, value: '1', stage: 'complete' }), 'working', 'an open item is open until its state says otherwise');
  assert.equal(classifyState({ ...ritm, value: '4', stage: 'delivery' }), 'cancelled');
  assert.equal(classifyState({ ...ritm, value: '3', stage: 'waiting_for_approval' }), 'closed');
  assert.equal(classifyState({ ...ritm, value: '1', stage: 'waiting_for_approval' }), 'waiting', 'the approval wait still moves live work');
  // only a requested item (or a request) has a stage
  assert.equal(classifyState({ table: 'sc_task', stage: 'fulfillment' }), 'unknown');
  assert.equal(classifyState({ table: 'incident', stage: 'complete' }), 'unknown');
  assert.equal(waitsOn({ ...ritm, value: '1', stage: 'waiting_for_approval' }), 'approval');
  assert.equal(waitsOn({ ...ritm, stage: 'fulfillment' }), '');
});

// ---- docs/states.md says it ---------------------------------------------------------------------------------------------------------

test('docs/states.md marks each value read live as VERIFIED LIVE 2026-11-07', () => {
  const lines = DOC.split('\n');
  const rowOf = (table, value) => lines.find((l) => l.startsWith(`| ${table} | ${value} | `));
  for (const value of ['151', '152', '154', '157']) assert.match(rowOf('problem_task', value) || '', /VERIFIED LIVE 2026-11-07/, `problem_task ${value}`);
  for (const value of ['-5', '1', '2', '3', '4']) assert.match(rowOf('change_task', value) || '', /VERIFIED LIVE 2026-11-07/, `change_task ${value}`);
  assert.match(rowOf('change_task', '7') || '', /Not verified/);
  for (const value of ['1', '2', '3', '6', '7', '8']) assert.match(rowOf('incident', value) || '', /VERIFIED LIVE 2026-11-07/, `incident ${value}`);
  for (const value of ['101', '102', '103', '104', '106', '107']) assert.match(rowOf('problem', value) || '', /VERIFIED LIVE 2026-11-07/, `problem ${value}`);
  for (const value of ['-5', '-4', '-3', '-2', '-1', '0', '3', '4']) assert.match(rowOf('change_request', value) || '', /VERIFIED LIVE 2026-11-07/, `change_request ${value}`);
  const stages = DOC.slice(DOC.indexOf('| Stage (stored value) |'));
  for (const stage of ['waiting_for_approval', 'fulfillment', 'delivery', 'complete', 'request_cancelled', 'any other stage']) assert.ok(stages.includes(stage), stage);
  assert.match(DOC, /## Verified live, 2026-11-07/);
});
