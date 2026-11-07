// One meaning of a ticket's state (audit of 2026-11-07, F9; docs/states.md). Every row of the table, the disagreements the audits found,
// the label words in English, German and Arabic, and the helpers each screen asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEANINGS,
  STATE_TABLES,
  classifyState,
  isFinishedState,
  isOpenState,
  isWaitingState,
  finishedKind,
  waitsOn,
  stageFor,
  bucketFor,
  reportClassFor,
} from '../src/domain/states.js';

const cls = (table, label, value = '') => classifyState({ table, label, value });

// ---- every row of the table --------------------------------------------------------------------------------------------------------

test('every row of the table: its stored value gives its meaning, whatever the label says or in which language', () => {
  let rows = 0;
  for (const [table, { rows: list }] of Object.entries(STATE_TABLES)) {
    for (const [value, label, meaning] of list) {
      rows += 1;
      assert.ok(MEANINGS.includes(meaning), `${table} ${value}: ${meaning} is one of the meanings`);
      assert.equal(classifyState({ table, value }), meaning, `${table} ${value} by its value alone`);
      assert.equal(classifyState({ table, value, label }), meaning, `${table} ${value} with ServiceNow's own label`);
      // (a number that arrives as a number, or padded)
      if (/^-?\d+$/.test(value)) {
        assert.equal(classifyState({ table, value: Number(value), label }), meaning, `${table} ${value} as a number`);
        assert.equal(classifyState({ table, value: ` ${value} `, label }), meaning, `${table} ${value} padded`);
      }
    }
  }
  assert.ok(rows >= 60, `all the rows were visited (${rows})`);
});

test('the table says what the audit decided for the base values', () => {
  const expect = {
    incident: { 1: 'new', 2: 'working', 3: 'waiting', 6: 'resolved', 7: 'closed', 8: 'cancelled' },
    problem: { 101: 'new', 102: 'working', 103: 'working', 104: 'working', 106: 'resolved', 107: 'closed' },
    change_request: { '-5': 'new', '-4': 'working', '-3': 'waiting', '-2': 'working', '-1': 'working', 0: 'working', 3: 'closed', 4: 'cancelled' },
    sc_task: { '-5': 'waiting', 1: 'working', 2: 'working', 3: 'closed', 4: 'cancelled', 7: 'cancelled' },
    sc_req_item: { '-5': 'waiting', 1: 'working', 2: 'working', 3: 'closed', 4: 'cancelled', 7: 'cancelled' },
    change_task: { '-5': 'waiting', 1: 'working', 2: 'working', 3: 'closed', 4: 'cancelled', 7: 'cancelled' },
    sn_customerservice_case: { 1: 'new', 10: 'working', 18: 'waiting', 6: 'resolved', 3: 'closed', 7: 'cancelled' },
  };
  for (const [table, values] of Object.entries(expect)) for (const [value, meaning] of Object.entries(values)) assert.equal(cls(table, '', value), meaning, `${table} ${value}`);
});

// ---- the disagreements of the audits (cls.mjs, 2026-11-04 "Still yours to decide") ------------------------------------------------------

test('the disagreements: one answer each, by label alone (the header read gives no stored value)', () => {
  const rows = [
    // [table, label, meaning]
    ['sc_task', 'Pending', 'waiting'],
    ['sc_req_item', 'Pending', 'waiting'],
    ['sc_task', 'Open', 'working'],
    ['sc_task', 'Work in Progress', 'working'],
    ['sc_task', 'Closed Complete', 'closed'],
    ['sc_task', 'Closed Incomplete', 'cancelled'],
    ['sc_task', 'Closed Skipped', 'cancelled'],
    ['change_request', 'Assess', 'working'],
    ['change_request', 'Authorize', 'waiting'],
    ['change_request', 'Scheduled', 'working'],
    ['change_request', 'Implement', 'working'],
    ['change_request', 'Review', 'working'],
    ['change_request', 'Closed', 'closed'],
    ['sn_hr_core_case', 'Awaiting Info', 'waiting'],
    ['sn_hr_core_case', 'Ready', 'new'],
    ['sn_hr_core_case', 'Open', 'working'],
    ['sn_hr_core_case', 'Closed Incomplete', 'cancelled'],
    ['sn_customerservice_case', 'Awaiting Info', 'waiting'],
    ['problem', 'Root Cause Analysis', 'working'],
    ['problem', 'Fix in Progress', 'working'],
    ['problem', 'Assess', 'working'],
    ['incident', 'Resolved', 'resolved'],
    ['incident', 'On Hold', 'waiting'],
    // the lines of the 2026-11-04 list
    ['incident', 'Open', 'working'],
    ['incident', 'Awaiting Approval', 'waiting'],
    ['incident', 'Closed', 'closed'],
    ['incident', 'Complete', 'closed'],
    ['incident', 'Cancelled', 'cancelled'],
    ['incident', 'Canceled', 'cancelled'],
    ['sc_request', 'Fulfilled', 'closed'],
    ['sc_task', 'Skipped', 'cancelled'],
    ['sc_task', 'Incomplete', 'cancelled'],
    ['sc_req_item', 'Requested', 'new'],
    ['sc_req_item', 'Delivered', 'closed'],
  ];
  for (const [table, label, meaning] of rows) assert.equal(cls(table, label), meaning, `${table} "${label}"`);
});

// ---- German and Arabic labels -----------------------------------------------------------------------------------------------------

test('a stored value that is known wins over a label in any language', () => {
  const german = { 1: 'Neu', 2: 'In Bearbeitung', 3: 'Wartend', 6: 'Gelöst', 7: 'Geschlossen', 8: 'Storniert' };
  const arabic = { 1: 'جديد', 2: 'قيد التقدم', 3: 'معلق', 6: 'تم الحل', 7: 'مغلق', 8: 'ملغى' };
  const odd = { 1: 'Zzz', 2: 'Zzz', 3: 'Zzz', 6: 'Zzz', 7: 'Zzz', 8: 'Zzz' }; // a label nothing can read
  for (const names of [german, arabic, odd]) {
    const got = Object.entries(names).map(([value, label]) => classifyState({ table: 'incident', value, label }));
    assert.deepEqual(got, ['new', 'working', 'waiting', 'resolved', 'closed', 'cancelled'], JSON.stringify(names));
  }
  // The German "Closed Complete" of a catalog task, with and without its value
  assert.equal(classifyState({ table: 'sc_task', value: '3', label: 'Geschlossen abgeschlossen' }), 'closed');
  assert.equal(cls('sc_task', 'Geschlossen abgeschlossen'), 'closed');
  assert.equal(cls('sc_task', 'Geschlossen unvollständig'), 'cancelled');
  assert.equal(cls('sc_task', 'Geschlossen übersprungen'), 'cancelled');
});

test('with no stored value the words of a German label decide', () => {
  const rows = [
    ['Neu', 'new'], ['Entwurf', 'new'],
    ['In Bearbeitung', 'working'], ['Offen', 'working'], ['Aktiv', 'working'], ['Genehmigt', 'working'], ['Geplant', 'working'],
    ['Wartend', 'waiting'], ['Angehalten', 'waiting'], ['In Warteschleife', 'waiting'], ['Wartet auf Rückmeldung', 'waiting'], ['Ausstehend', 'waiting'], ['Zurückgestellt', 'waiting'],
    ['Gelöst', 'resolved'], ['Behoben', 'resolved'],
    ['Geschlossen', 'closed'], ['Abgeschlossen', 'closed'], ['Erledigt', 'closed'],
    ['Storniert', 'cancelled'], ['Abgebrochen', 'cancelled'], ['Abgelehnt', 'cancelled'], ['Übersprungen', 'cancelled'], ['Unvollständig', 'cancelled'],
  ];
  for (const [label, meaning] of rows) assert.equal(cls('u_anything', label), meaning, label);
});

test('with no stored value the words of an Arabic label decide', () => {
  const rows = [
    ['جديد', 'new'], ['جديدة', 'new'], ['مسودة', 'new'],
    ['قيد التقدم', 'working'], ['قيد التنفيذ', 'working'], ['مفتوح', 'working'], ['نشط', 'working'], ['قيد المراجعة', 'working'],
    ['قيد الانتظار', 'waiting'], ['معلق', 'waiting'], ['بانتظار رد العميل', 'waiting'], ['موقوف', 'waiting'], ['في الانتظار', 'waiting'],
    ['تم الحل', 'resolved'], ['محلول', 'resolved'],
    ['مغلق', 'closed'], ['مغلقة', 'closed'], ['مكتمل', 'closed'], ['اكتمل', 'closed'],
    ['ملغى', 'cancelled'], ['ملغاة', 'cancelled'], ['الغاء', 'cancelled'], ['مرفوض', 'cancelled'], ['غير مكتمل', 'cancelled'], ['تم التخطي', 'cancelled'],
  ];
  for (const [label, meaning] of rows) assert.equal(cls('u_anything', label), meaning, label);
  // the same words with marks and spelling variants
  assert.equal(cls('u_anything', 'مُغْلَق'), 'closed');
  assert.equal(cls('u_anything', 'ألغيت'), 'unknown', 'a word the list does not hold stays unknown');
});

// ---- the words of English labels ----------------------------------------------------------------------------------------------------

test('English labels: the usual words, in any case and spelling', () => {
  const rows = [
    ['New', 'new'], ['Draft', 'new'], ['Not started', 'new'], ['Submitted', 'new'], ['Requested', 'new'],
    ['In Progress', 'working'], ['Work in Progress', 'working'], ['Active', 'working'], ['Open', 'working'], ['Assess', 'working'], ['Root Cause Analysis', 'working'], ['Fix in Progress', 'working'], ['Implement', 'working'], ['Scheduled', 'working'], ['Approved', 'working'], ['Under Review', 'working'],
    ['On Hold', 'waiting'], ['on-hold', 'waiting'], ['ON_HOLD', 'waiting'], ['Hold', 'waiting'], ['Pending', 'waiting'], ['Pending customer response', 'waiting'], ['Awaiting User Info', 'waiting'], ['Awaiting Caller', 'waiting'], ['Awaiting Approval', 'waiting'], ['Awaiting Vendor', 'waiting'], ['Waiting for Approval', 'waiting'], ['Suspended', 'waiting'],
    ['Resolved', 'resolved'], ['Solved', 'resolved'], ['Resolution Proposed', 'resolved'], ['Awaiting Closure', 'resolved'], ['Pending Closure', 'resolved'],
    ['Closed', 'closed'], ['Complete', 'closed'], ['Completed', 'closed'], ['Closed Complete', 'closed'], ['Fulfilled', 'closed'], ['Delivered', 'closed'],
    ['Cancelled', 'cancelled'], ['Canceled', 'cancelled'], ['Closed Incomplete', 'cancelled'], ['Closed Skipped', 'cancelled'], ['Skipped', 'cancelled'], ['Rejected', 'cancelled'], ['Withdrawn', 'cancelled'],
  ];
  for (const [label, meaning] of rows) assert.equal(cls('', label), meaning, label);
  // a closed state that goes on to say how it was closed is still closed (not "resolved": it is finished, not awaiting closure)
  assert.equal(cls('', 'Closed - Resolved by caller'), 'closed');
  assert.equal(cls('', 'Geschlossen - gelöst'), 'closed');
  assert.equal(cls('', 'مغلق - تم الحل'), 'closed');
  assert.equal(cls('', 'Resolved'), 'resolved');
  assert.equal(cls('', 'Closed Incomplete'), 'cancelled', 'cancelled words still win');
  // a choice list that shows its value in front, and spaces
  assert.equal(cls('', '7 - Closed'), 'closed');
  assert.equal(cls('', '  2 - Work in Progress '), 'working');
  assert.equal(cls('', '-5 - Pending'), 'waiting');
});

test('words that only look like states stay unknown, and unknown is never closed or waiting', () => {
  for (const label of ['', '   ', 'Triage', 'Inactive', 'Reopened', 'Zzz', '3', 'Customer Responded', 'Backlog', 'With Acme']) {
    assert.equal(cls('u_anything', label), 'unknown', JSON.stringify(label));
    assert.equal(isOpenState({ table: 'u_anything', label }), true, `${label}: unknown is live work`);
    assert.equal(isFinishedState({ table: 'u_anything', label }), false);
    assert.equal(isWaitingState({ table: 'u_anything', label }), false);
  }
  assert.equal(classifyState(), 'unknown');
  assert.equal(classifyState({}), 'unknown');
  assert.equal(classifyState({ table: null, value: null, label: undefined }), 'unknown');
  assert.equal(classifyState({ label: { not: 'text' } }), 'unknown');
});

// ---- value, label, table: who wins ---------------------------------------------------------------------------------------------------

test('a value this file does not know falls back to the label; so does a table it does not know', () => {
  assert.equal(classifyState({ table: 'incident', value: '10', label: 'Awaiting Vendor' }), 'waiting', 'a state the site added');
  assert.equal(classifyState({ table: 'incident', value: '4', label: 'Awaiting User Info' }), 'waiting', 'a legacy incident state');
  assert.equal(classifyState({ table: 'incident', value: '10', label: 'With Acme' }), 'unknown');
  assert.equal(classifyState({ table: 'u_facilities', value: '3', label: 'Closed' }), 'closed', 'a custom class: the value is not read, the label is');
  assert.equal(classifyState({ table: 'u_facilities', value: '3', label: '' }), 'unknown', 'a custom class with only a number stays unknown');
  assert.equal(classifyState({ table: 'u_facilities', value: '3', label: 'Wartend' }), 'waiting', 'the same number means On Hold on an incident and Closed Complete on a task, so a custom class never trusts it');
});

test('a table that is believed (Sure) is read by its value even against a label it can read; one that is not gives way to the label', () => {
  // incident 6 is Resolved on every site, whatever the label says
  assert.equal(classifyState({ table: 'incident', value: '6', label: 'Awaiting Caller' }), 'resolved');
  assert.equal(classifyState({ table: 'sc_task', value: '3', label: 'On Hold' }), 'closed');
  // a case or an HR case: the values are assumed, so a label that can be read wins
  assert.equal(classifyState({ table: 'sn_hr_core_case', value: '6', label: 'Awaiting Info' }), 'waiting');
  assert.equal(classifyState({ table: 'sn_customerservice_case', value: '18', label: 'Closed' }), 'closed');
  // ... and when the label cannot be read the value is used
  assert.equal(classifyState({ table: 'sn_hr_core_case', value: '6', label: 'Zzz' }), 'resolved');
  assert.equal(classifyState({ table: 'sn_customerservice_case', value: '18', label: 'Zzz' }), 'waiting');
});

test('the same number means different things on different tables', () => {
  assert.equal(cls('incident', '', '3'), 'waiting');
  assert.equal(cls('sc_task', '', '3'), 'closed');
  assert.equal(cls('change_request', '', '3'), 'closed');
  assert.equal(cls('sn_customerservice_case', '', '3'), 'closed');
  assert.equal(cls('incident', '', '7'), 'closed');
  assert.equal(cls('sc_task', '', '7'), 'cancelled');
  assert.equal(cls('incident', '', '1'), 'new');
  assert.equal(cls('sc_task', '', '1'), 'working');
});

test('a kind stands where a table is asked for; the child tables of a family take its row', () => {
  assert.equal(cls('catalog_task', '', '-5'), 'waiting');
  assert.equal(cls('requested_item', '', '3'), 'closed');
  assert.equal(cls('change', '', '-3'), 'waiting');
  assert.equal(cls('case', '', '18'), 'waiting');
  assert.equal(cls('hr_case', '', '3'), 'closed');
  assert.equal(cls('sn_hr_core_case_payroll', '', '3'), 'closed');
  assert.equal(cls('sn_hr_le_case', '', '6'), 'resolved');
  assert.equal(cls('sn_hr_core_task_x', '', '1'), 'working');
  assert.equal(cls('sn_customerservice_task', '', '4'), 'cancelled');
  assert.equal(cls('task', '', '7'), 'cancelled');
});

test('a request has the task values and its own request state', () => {
  assert.equal(cls('sc_request', '', 'requested'), 'new');
  assert.equal(cls('sc_request', '', 'in_process'), 'working');
  assert.equal(cls('sc_request', '', 'closed_cancelled'), 'cancelled');
  assert.equal(cls('sc_request', '', 'closed_complete'), 'closed');
  assert.equal(cls('sc_request', 'Requested'), 'new');
  assert.equal(cls('sc_request', '', '3'), 'closed');
});

// ---- the stage of a requested item -----------------------------------------------------------------------------------------------

test('a requested item that waits for its approval is waiting; a finished one is not touched', () => {
  const ritm = { table: 'sc_req_item' };
  assert.equal(classifyState({ ...ritm, value: '1', stage: 'waiting_for_approval' }), 'waiting');
  assert.equal(classifyState({ ...ritm, value: '1', stage: 'Waiting for Approval' }), 'waiting');
  assert.equal(classifyState({ ...ritm, label: 'Zzz', stage: 'waiting_for_approval' }), 'waiting');
  assert.equal(classifyState({ ...ritm, value: '1', stage: 'fulfillment' }), 'working');
  assert.equal(classifyState({ ...ritm, value: '3', stage: 'waiting_for_approval' }), 'closed');
  assert.equal(classifyState({ table: 'incident', value: '2', stage: 'waiting_for_approval' }), 'working', 'only a requested item has a stage');
  assert.equal(waitsOn({ ...ritm, value: '1', stage: 'waiting_for_approval' }), 'approval');
});

// ---- the helpers -----------------------------------------------------------------------------------------------------------------------

test('finished, open, waiting and the kind of ending', () => {
  const finished = ['resolved', 'closed', 'cancelled'];
  const labels = { New: 'new', 'In Progress': 'working', 'On Hold': 'waiting', Resolved: 'resolved', Closed: 'closed', Canceled: 'cancelled', Zzz: 'unknown' };
  for (const [label, meaning] of Object.entries(labels)) {
    const args = { table: 'incident', label };
    assert.equal(classifyState(args), meaning);
    assert.equal(isFinishedState(args), finished.includes(meaning), label);
    assert.equal(isOpenState(args), !finished.includes(meaning), label);
    assert.equal(isWaitingState(args), meaning === 'waiting', label);
    assert.equal(finishedKind(args), meaning === 'cancelled' ? 'ended' : meaning === 'resolved' || meaning === 'closed' ? 'done' : '', label);
  }
  // the checks' words
  for (const [label, kind] of Object.entries({ 'Closed Complete': 'done', Complete: 'done', Fulfilled: 'done', Delivered: 'done', 'Closed Incomplete': 'ended', 'Closed Skipped': 'ended', Cancelled: 'ended', Rejected: 'ended', Withdrawn: 'ended', Open: '', Pending: '', Zzz: '' })) {
    assert.equal(finishedKind({ label }), kind, label);
  }
});

test('who a waiting ticket waits for', () => {
  const w = (over) => waitsOn({ table: 'incident', label: 'On Hold', value: '3', ...over });
  // an incident: the hold reason says for whom
  assert.equal(w({ holdReason: 'Awaiting Caller', holdReasonValue: '1' }), 'customer');
  assert.equal(w({ holdReasonValue: '1' }), 'customer');
  assert.equal(w({ holdReason: 'Awaiting Vendor', holdReasonValue: '4' }), 'other');
  assert.equal(w({ holdReason: 'Awaiting Change', holdReasonValue: '3' }), 'other');
  assert.equal(w({ holdReason: 'Awaiting Approval' }), 'approval');
  assert.equal(w({ holdReason: 'Awaiting user info' }), 'customer');
  assert.equal(w({ holdReason: 'None' }), 'other');
  assert.equal(w({ holdReason: '-- None --' }), 'other');
  assert.equal(w({}), 'other', 'on hold with no reason: for somebody else');
  // the words of the state itself when there is no hold reason
  assert.equal(waitsOn({ table: 'sn_hr_core_case', label: 'Awaiting Acceptance' }), 'customer');
  assert.equal(waitsOn({ table: 'sn_customerservice_case', label: 'Awaiting Info', value: '18' }), 'customer');
  assert.equal(waitsOn({ table: 'sn_customerservice_case', label: 'Zzz', value: '18' }), 'customer', 'a case in state 18 waits for the customer');
  assert.equal(waitsOn({ table: 'sc_task', label: 'Pending', value: '-5' }), 'other');
  assert.equal(waitsOn({ table: 'change_request', label: 'Authorize', value: '-3' }), 'approval');
  assert.equal(waitsOn({ table: 'incident', label: 'Pending customer response' }), 'customer');
  assert.equal(waitsOn({ table: 'incident', label: 'Awaiting Approval' }), 'approval');
  // the state decides: a hold reason left behind after the ticket went back to work is nobody's wait
  assert.equal(waitsOn({ table: 'incident', label: 'In Progress', value: '2', holdReason: 'Awaiting Caller', holdReasonValue: '1' }), '');
  assert.equal(waitsOn({ table: 'incident', label: 'Resolved', value: '6', holdReasonValue: '1' }), '');
  // German and Arabic
  assert.equal(waitsOn({ table: 'incident', label: 'Wartend', value: '3', holdReason: 'Warten auf Anrufer' }), 'customer');
  assert.equal(waitsOn({ table: 'incident', label: 'قيد الانتظار', value: '3', holdReason: 'بانتظار العميل' }), 'customer');
  assert.equal(waitsOn({ table: 'incident', label: 'Wartend', value: '3', holdReason: 'Warten auf Genehmigung' }), 'approval');
  assert.equal(waitsOn({ table: 'incident', label: 'Wartend', value: '3', holdReason: 'Warten auf Lieferant' }), 'other');
});

test('the meaning in the words of each screen', () => {
  const by = (meaning) => ({ new: { table: 'incident', value: '1' }, working: { table: 'incident', value: '2' }, waiting: { table: 'incident', value: '3' }, resolved: { table: 'incident', value: '6' }, closed: { table: 'incident', value: '7' }, cancelled: { table: 'incident', value: '8' }, unknown: { table: 'u_x', label: 'Zzz' } })[meaning];
  const stage = { new: 'new', working: 'working', waiting: 'working', resolved: 'resolve', closed: 'closed', cancelled: 'closed', unknown: null };
  const bucket = { new: 'new', working: 'progress', waiting: 'hold', resolved: 'resolved', closed: 'closed', cancelled: 'closed', unknown: 'progress' };
  const report = { new: 'new', working: 'working', waiting: 'waiting', resolved: 'resolved', closed: 'resolved', cancelled: 'resolved', unknown: 'other' };
  for (const meaning of MEANINGS) {
    assert.equal(classifyState(by(meaning)), meaning);
    assert.equal(stageFor(by(meaning)), stage[meaning], `stage of ${meaning}`);
    assert.equal(bucketFor(by(meaning)), bucket[meaning], `bucket of ${meaning}`);
    assert.equal(reportClassFor(by(meaning)), report[meaning], `report class of ${meaning}`);
  }
});

// ---- the old readers, run on the audit's table (cls.mjs) ----------------------------------------------------------------------------

test('the five old readers disagreed on these; now each one has one answer on every screen', () => {
  // [table, label, stage, bucket, report class]
  const rows = [
    ['sc_task', 'Pending', 'working', 'hold', 'waiting'],
    ['sc_task', 'Open', 'working', 'progress', 'working'],
    ['sc_task', 'Work in Progress', 'working', 'progress', 'working'],
    ['sc_task', 'Closed Complete', 'closed', 'closed', 'resolved'],
    ['sc_req_item', 'Pending', 'working', 'hold', 'waiting'],
    ['change_request', 'Assess', 'working', 'progress', 'working'],
    ['change_request', 'Authorize', 'working', 'hold', 'waiting'],
    ['change_request', 'Scheduled', 'working', 'progress', 'working'],
    ['change_request', 'Review', 'working', 'progress', 'working'],
    ['sn_hr_core_case', 'Ready', 'new', 'new', 'new'],
    ['sn_hr_core_case', 'Awaiting Info', 'working', 'hold', 'waiting'],
    ['problem', 'Root Cause Analysis', 'working', 'progress', 'working'],
    ['sc_task', 'Geschlossen abgeschlossen', 'closed', 'closed', 'resolved'],
  ];
  for (const [table, label, stage, bucket, report] of rows) {
    const args = { table, label };
    assert.deepEqual([stageFor(args), bucketFor(args), reportClassFor(args)], [stage, bucket, report], `${table} ${label}`);
  }
});
