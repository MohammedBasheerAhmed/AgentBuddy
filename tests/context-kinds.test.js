import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveTable, kindForTable, parseRecordRef, tableForNumber } from '../src/context/kinds.js';

const ID = '57af7aec73d423002728660c4cf6a71c';
const ID2 = 'FE3B4D55A1C94E26B7E0C8D2F1A09B73';
const HOST = 'https://dev12345.service-now.com';

test('tables map to the kinds of the contract', () => {
  const expected = {
    incident: 'incident',
    problem: 'problem',
    change_request: 'change',
    sc_request: 'request',
    sc_req_item: 'requested_item',
    sc_task: 'catalog_task',
    sn_customerservice_case: 'case',
    sn_hr_core_case: 'hr_case',
    task: 'task',
    incident_task: 'task',
    change_task: 'task',
    problem_task: 'task',
    sn_customerservice_task: 'task',
    sn_hr_core_task: 'task',
    cmdb_ci: 'other',
    u_custom_thing: 'other',
    '': 'other',
  };
  for (const [table, kind] of Object.entries(expected)) assert.equal(kindForTable(table), kind, table);
  assert.equal(kindForTable('INCIDENT'), 'incident');
  assert.equal(kindForTable(undefined), 'other');
});

test('the HR family is sensitive, nothing else is', () => {
  for (const t of ['sn_hr_core_case', 'sn_hr_core_task', 'sn_hr_le_case', 'SN_HR_core_case']) assert.equal(isSensitiveTable(t), true, t);
  for (const t of ['incident', 'sn_customerservice_case', 'task', 'sys_user', '', null]) assert.equal(isSensitiveTable(t), false, String(t));
});

test('record numbers suggest their table', () => {
  assert.equal(tableForNumber('INC0010001'), 'incident');
  assert.equal(tableForNumber('chg0030002'), 'change_request');
  assert.equal(tableForNumber('RITM0010050'), 'sc_req_item');
  assert.equal(tableForNumber('SCTASK0010060'), 'sc_task');
  assert.equal(tableForNumber('ZZZ0000001'), '');
  assert.equal(tableForNumber('not a number'), '');
});

// ---- URLs --------------------------------------------------------------------------------------------

const RECORD_URLS = [
  // classic forms
  [`${HOST}/incident.do?sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/incident.do?sys_id=${ID}&sysparm_view=ess&sysparm_record_target=incident`, { table: 'incident', sysId: ID }],
  [`${HOST}/incident.do?sysparm_view=ess&sys_id=${ID}#top`, { table: 'incident', sysId: ID }],
  [`${HOST}/incident.do?sys_id=${ID2}`, { table: 'incident', sysId: ID2.toLowerCase() }],
  [`${HOST}/change_request.do?sys_id=${ID}`, { table: 'change_request', sysId: ID }],
  [`${HOST}/sn_customerservice_case.do?sys_id=${ID}`, { table: 'sn_customerservice_case', sysId: ID }],
  [`/incident.do?sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`incident.do?sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`  ${HOST}/incident.do?sys_id=${ID}  `, { table: 'incident', sysId: ID }],
  [`${HOST}/incident.do/?sys_id=${ID}`, { table: 'incident', sysId: ID }],
  // by number
  [`${HOST}/incident.do?sysparm_query=number=INC0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/incident.do?sysparm_query=number%3DINC0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/incident.do?sysparm_query=active=true^number=INC0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/incident.do?sysparm_query=number=inc0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/sc_req_item.do?sysparm_query=number=RITM0010050&sysparm_view=`, { table: 'sc_req_item', number: 'RITM0010050' }],
  [`${HOST}/incident.do?sysparm_query=sys_id=${ID}`, { table: 'incident', sysId: ID }],
  // nav_to wrappers
  [`${HOST}/nav_to.do?uri=incident.do%3Fsys_id%3D${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/nav_to.do?uri=%2Fincident.do%3Fsys_id%3D${ID}%26sysparm_view%3D`, { table: 'incident', sysId: ID }],
  [`${HOST}/nav_to.do?uri=/incident.do?sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/nav_to.do?uri=/incident.do?sys_id=${ID}&sysparm_view=ess`, { table: 'incident', sysId: ID }],
  [`${HOST}/nav_to.do?uri=incident.do%253Fsys_id%253D${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/nav_to.do?uri=%2Fincident.do%3Fsysparm_query%3Dnumber%3DINC0010001`, { table: 'incident', number: 'INC0010001' }],
  // Next Experience / workspaces
  [`${HOST}/now/sow/record/incident/${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/sow/record/incident/${ID}/`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/sow/record/incident/${ID}?foo=bar#frag`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/sow/record/incident/${ID}/params/selected-tab-index/0`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/workspace/agent/record/incident/${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/workspace/agent/record/sc_req_item/${ID}/params/foo/bar`, { table: 'sc_req_item', sysId: ID }],
  [`${HOST}/now/csm-agent-workspace/record/sn_customerservice_case/${ID}`, { table: 'sn_customerservice_case', sysId: ID }],
  [`${HOST}/now/hr-agent-workspace/record/sn_hr_core_case/${ID}`, { table: 'sn_hr_core_case', sysId: ID }],
  [`${HOST}/now/hr-agent-workspace/home/record/sn_hr_core_case/${ID}/`, { table: 'sn_hr_core_case', sysId: ID }],
  [`${HOST}/now/cwf/agent/record/change_request/${ID}`, { table: 'change_request', sysId: ID }],
  [`${HOST}/now/sow/record/INCIDENT/${ID2}`, { table: 'incident', sysId: ID2.toLowerCase() }],
  [`${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}%26sysparm_view%3Dess`, { table: 'incident', sysId: ID }],
  [`${HOST}/now/nav/ui/classic/params/target/sc_req_item.do%3Fsysparm_query%3Dnumber%253DRITM0010050`, { table: 'sc_req_item', number: 'RITM0010050' }],
  [`${HOST}/now/nav/ui/classic/params/target/incident.do%253Fsys_id%253D${ID}`, { table: 'incident', sysId: ID }],
  // portals
  [`${HOST}/sp?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc?id=ticket&table=sn_hr_core_case&sys_id=${ID}`, { table: 'sn_hr_core_case', sysId: ID }],
];

test('record URLs of every shape give a table and a sys_id or number', () => {
  for (const [url, expected] of RECORD_URLS) assert.deepEqual(parseRecordRef(url), expected, url);
});

const NOT_RECORDS = [
  `${HOST}/incident.do?sys_id=-1`, // a new, unsaved record
  `${HOST}/incident.do?sys_id=-1&sysparm_query=active=true`,
  `${HOST}/now/sow/record/incident/-1`,
  `${HOST}/now/workspace/agent/record/incident/-1/params/x/y`,
  `${HOST}/nav_to.do?uri=incident.do%3Fsys_id%3D-1`,
  `${HOST}/incident.do`,
  `${HOST}/incident.do?sysparm_view=ess`,
  `${HOST}/incident.do?sys_id=abc`,
  `${HOST}/incident.do?sys_id=${ID}0`, // 33 characters
  `${HOST}/incident.do?sys_id=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`,
  `${HOST}/incident_list.do?sysparm_query=active=true`,
  `${HOST}/incident_list.do?sysparm_query=number=INC0010001`,
  `${HOST}/nav_to.do?uri=incident_list.do%3Fsysparm_query%3Dactive%3Dtrue`,
  `${HOST}/nav_to.do`,
  `${HOST}/now/sow/home`,
  `${HOST}/now/sow/list/params/list-id/incident`,
  `${HOST}/now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dactive%3Dtrue`,
  `${HOST}/sp?id=index`,
  `${HOST}/`,
  `${HOST}`,
  '',
  '   ',
  null,
  undefined,
  42,
  {},
];

test('lists, new records, malformed ids and non-addresses give null', () => {
  for (const url of NOT_RECORDS) assert.equal(parseRecordRef(url), null, String(url));
});

test('a sys_id wins over a number when both are present', () => {
  assert.deepEqual(parseRecordRef(`${HOST}/incident.do?sys_id=${ID}&sysparm_query=number=INC0010001`), { table: 'incident', sysId: ID });
});

test('a number that is not shaped like a record number is not used', () => {
  assert.equal(parseRecordRef(`${HOST}/incident.do?sysparm_query=number=hello`), null);
  assert.equal(parseRecordRef(`${HOST}/incident.do?sysparm_query=short_descriptionLIKEvpn`), null);
});
