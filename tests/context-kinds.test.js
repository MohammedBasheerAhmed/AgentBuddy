import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL_PAGE_TABLES, isSensitiveTable, kindForTable, parseRecordRef, portalParams, tableForNumber } from '../src/context/kinds.js';

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

// ---- Portals: Service Portal, Employee Center, customer service portal, HR portal -------------------------

const PORTAL_RECORD_URLS = [
  // the usual ticket page, on every portal suffix
  [`${HOST}/sp?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=${ID}`, { table: 'sn_customerservice_case', sysId: ID }],
  [`${HOST}/csp?id=csm_ticket&table=sn_customerservice_case&sys_id=${ID}`, { table: 'sn_customerservice_case', sysId: ID }],
  [`${HOST}/hrsp?id=hr_ticket&table=sn_hr_core_case&sys_id=${ID}`, { table: 'sn_hr_core_case', sysId: ID }],
  [`${HOST}/esc?id=ticket&table=sn_hr_core_case&sys_id=${ID}`, { table: 'sn_hr_core_case', sysId: ID }],
  [`${HOST}/sp?id=standard_ticket&table=change_request&sys_id=${ID}`, { table: 'change_request', sysId: ID }],
  [`${HOST}/sp?id=ticket&table=sc_req_item&sys_id=${ID}`, { table: 'sc_req_item', sysId: ID }],
  // any suffix a customer chose, with or without a trailing slash, with other parameters around
  [`${HOST}/supportportal?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/it-help?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/sp/?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/sp?foo=1&id=ticket&sys_id=${ID}&view=ess&table=incident#comments`, { table: 'incident', sysId: ID }],
  [`/esc?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  // the query string is read without regard to case, a table or sys_id is normalised to lower case
  [`${HOST}/sp?ID=ticket&Table=Incident&Sys_ID=${ID2}`, { table: 'incident', sysId: ID2.toLowerCase() }],
  [`${HOST}/esc?id=ticket&TABLE=INCIDENT&SYS_ID=${ID}`, { table: 'incident', sysId: ID }],
  // sysparm_ spellings
  [`${HOST}/sp?id=ticket&sysparm_table=incident&sysparm_sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/sp?id=ticket&table=incident&sysparm_query=sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/sp?id=ticket&table=incident&sysparm_query=number=INC0010001`, { table: 'incident', number: 'INC0010001' }],
  // a request page has no table parameter: the table comes from the page id
  [`${HOST}/sp?id=sc_request&sys_id=${ID}`, { table: 'sc_request', sysId: ID }],
  [`${HOST}/esc?id=sc_request&sys_id=${ID}`, { table: 'sc_request', sysId: ID }],
  [`${HOST}/sp?id=sc_req_item&sys_id=${ID}`, { table: 'sc_req_item', sysId: ID }],
  [`${HOST}/sp?id=sc_task&sys_id=${ID}`, { table: 'sc_task', sysId: ID }],
  [`${HOST}/sp?id=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }], // a page named after its table
  [`${HOST}/sp?id=sc_request&number=REQ0010002`, { table: 'sc_request', number: 'REQ0010002' }],
  // a number instead of a sys_id
  [`${HOST}/sp?id=ticket&table=incident&number=INC0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/esc?id=ticket&table=incident&number=inc0010001`, { table: 'incident', number: 'INC0010001' }],
  [`${HOST}/esc?id=ticket&sysparm_number=CHG0030002`, { table: 'change_request', number: 'CHG0030002' }],
  [`${HOST}/esc?id=ticket&number=RITM0010050`, { table: 'sc_req_item', number: 'RITM0010050' }],
  [`${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&number=CS0001234`, { table: 'sn_customerservice_case', number: 'CS0001234' }],
  // knowledge
  [`${HOST}/sp?id=kb_article&sys_id=${ID}`, { table: 'kb_knowledge', sysId: ID }],
  [`${HOST}/esc?id=kb_article&table=kb_knowledge&sys_id=${ID}`, { table: 'kb_knowledge', sysId: ID }],
  [`${HOST}/esc?id=kb_article_view&sysparm_article=KB0010001`, { table: 'kb_knowledge', number: 'KB0010001' }],
  [`${HOST}/sp?id=kb_article_view&sysparm_article=kb0010001&sysparm_rank=1&sysparm_tsqueryId=abc`, { table: 'kb_knowledge', number: 'KB0010001' }],
  [`${HOST}/kb?id=kb_article_view&sysparm_article=KB0000015`, { table: 'kb_knowledge', number: 'KB0000015' }],
  [`${HOST}/esc?id=kb_article&number=KB0010001`, { table: 'kb_knowledge', number: 'KB0010001' }],
  // hash-routed variants
  [`${HOST}/sp#/?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc/#!/?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc#?id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc#id=ticket&table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/esc#/ticket?table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  [`${HOST}/sp#/?id=sc_request&sys_id=${ID}`, { table: 'sc_request', sysId: ID }],
  [`${HOST}/esc?id=ticket#/?table=incident&sys_id=${ID}`, { table: 'incident', sysId: ID }],
  // the real query string wins over the hash
  [`${HOST}/sp?id=ticket&table=incident&sys_id=${ID}#/?table=problem&sys_id=${ID2}`, { table: 'incident', sysId: ID }],
  // a portal address inside a classic navigation wrapper
  [`${HOST}/nav_to.do?uri=%2Fsp%3Fid%3Dticket%26table%3Dincident%26sys_id%3D${ID}`, { table: 'incident', sysId: ID }],
];

test('portal addresses of every shape give a table and a sys_id or number', () => {
  for (const [url, expected] of PORTAL_RECORD_URLS) assert.deepEqual(parseRecordRef(url), expected, url);
});

const PORTAL_NOT_RECORDS = [
  // list, search and home pages never parse as a record
  `${HOST}/sp?id=index`,
  `${HOST}/sp?id=home`,
  `${HOST}/esc?id=landing`,
  `${HOST}/sp?id=my_requests`,
  `${HOST}/sp?id=tickets`,
  `${HOST}/sp?id=tickets&table=incident`,
  `${HOST}/esc?id=my_tickets&table=incident`,
  `${HOST}/esc?id=tickets&sys_id=${ID}`,
  `${HOST}/sp?id=my_requests&table=sc_request&sys_id=${ID}`, // a list page is never a record, even with a table and a sys_id
  `${HOST}/sp?id=sc_cat_item&sys_id=${ID}`, // a catalog item to order is not a ticket
  `${HOST}/sp?id=sc_category&sys_id=${ID}`,
  `${HOST}/sp?id=search&q=vpn`,
  `${HOST}/csm?id=csm_ticket`, // no record named
  `${HOST}/csm?id=csm_ticket&table=sn_customerservice_case`,
  `${HOST}/sp`,
  `${HOST}/sp/`,
  `${HOST}/esc#/`,
  // new records and malformed ids
  `${HOST}/sp?id=ticket&table=incident&sys_id=-1`,
  `${HOST}/esc?id=sc_request&sys_id=-1`,
  `${HOST}/sp?id=ticket&table=incident&sys_id=`,
  `${HOST}/sp?id=ticket&table=incident&sys_id=abc`,
  `${HOST}/sp?id=ticket&table=incident&sys_id=${ID}0`,
  `${HOST}/sp?id=ticket&table=incident&sys_id=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`,
  `${HOST}/sp?id=ticket&table=incident&sys_id=-1&number=INC0010001`, // an invalid sys_id is not replaced by a number
  `${HOST}/sp#/?id=ticket&table=incident&sys_id=-1`,
  // an invalid table, or no way to tell the table
  `${HOST}/sp?id=ticket&table=incident;drop&sys_id=${ID}`,
  `${HOST}/sp?id=ticket&table=1incident&sys_id=${ID}`,
  `${HOST}/sp?id=ticket&table=../incident&sys_id=${ID}`,
  `${HOST}/sp?id=ticket&sys_id=${ID}`,
  `${HOST}/sp?id=ticket&number=ZZZ0000001`,
  `${HOST}/sp?id=ticket&table=incident&number=hello`,
  `${HOST}/sp?id=something_else&sys_id=${ID}`,
  // the knowledge base id (sys_kb_id) is not the article
  `${HOST}/esc?id=kb_article_view&sys_kb_id=${ID}`,
  `${HOST}/esc?id=kb_article_view&sysparm_article=hello`,
  // not portal-shaped: no table is inferred from a page id on a deep or API path
  `${HOST}/api/now/table/incident?id=sc_request&sys_id=${ID}`,
  `${HOST}/some/deep/path?id=sc_request&sys_id=${ID}`,
];

test('portal list and home pages, new records and invalid addresses give null', () => {
  for (const url of PORTAL_NOT_RECORDS) assert.equal(parseRecordRef(url), null, url);
});

test('the page-id table map is one obvious object and its tables are valid', () => {
  assert.equal(PORTAL_PAGE_TABLES.sc_request, 'sc_request');
  assert.equal(PORTAL_PAGE_TABLES.kb_article, 'kb_knowledge');
  for (const table of Object.values(PORTAL_PAGE_TABLES)) assert.match(table, /^[a-z][a-z0-9_]*$/);
});

test('an explicit table works on any path, as before; every classic and workspace address still parses the same', () => {
  assert.deepEqual(parseRecordRef(`${HOST}/anything?table=incident&sys_id=${ID}`), { table: 'incident', sysId: ID });
  for (const [url, expected] of RECORD_URLS) assert.deepEqual(parseRecordRef(url), expected, url);
});

test('portalParams reads names in any case, the query string before the hash', () => {
  const read = (u) => portalParams(new URL(u));
  assert.equal(read(`${HOST}/sp?ID=Ticket`).get('id'), 'Ticket');
  assert.equal(read(`${HOST}/sp#/?id=a&x=1`).get('x'), '1');
  assert.equal(read(`${HOST}/sp?id=q#/?id=h`).get('id'), 'q');
  assert.equal(read(`${HOST}/sp#/just/a/route`).size, 0);
});

// ---- F3: HR child tables, blank forms -----------------------------------------------------------------------------------------
import { parseNewRecordRef } from '../src/context/kinds.js';

test('HR case tables of every family are HR cases (the employee is then read as a person and masked); their tasks stay tasks', () => {
  for (const t of ['sn_hr_core_case', 'sn_hr_core_case_payroll', 'sn_hr_core_case_benefits', 'sn_hr_core_case_relations', 'sn_hr_le_case', 'sn_hr_er_case', 'SN_HR_LE_CASE']) {
    assert.equal(kindForTable(t), 'hr_case', t);
  }
  for (const [t, kind] of [['sn_hr_core_task', 'task'], ['sn_hr_core_case_task', 'other'], ['sn_hr_core_profile', 'other'], ['sn_hr_casey', 'other'], ['u_case', 'other'], ['toString', 'other'], ['__proto__', 'other']]) {
    assert.equal(kindForTable(t), kind, t);
  }
});

test('a blank form (sys_id=-1) is a new record of its table on every UI; it is never "a record"', () => {
  const cases = [
    [`${HOST}/incident.do?sys_id=-1`, 'incident'],
    [`${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D-1%26sysparm_stack%3Dincident_list.do`, 'incident'],
    [`${HOST}/nav_to.do?uri=%2Fkb_knowledge.do%3Fsys_id%3D-1`, 'kb_knowledge'],
    [`${HOST}/now/sow/record/incident/-1`, 'incident'],
    [`${HOST}/now/cwf/agent/record/sn_customerservice_case/-1/params/x`, 'sn_customerservice_case'],
  ];
  for (const [url, table] of cases) {
    assert.deepEqual(parseNewRecordRef(url), { table }, url);
    assert.equal(parseRecordRef(url), null, url);
  }
  for (const url of [`${HOST}/incident.do?sys_id=${ID}`, `${HOST}/incident_list.do?sys_id=-1`, `${HOST}/home`, '', null]) assert.equal(parseNewRecordRef(url), null, String(url));
});
