import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL_PAGE_TABLES, TICKET_TABLES, isTicketTable, parseNewRecordRef, parseRecordRef } from '../src/context/kinds.js';

// The one gate: a page counts as a ticket record only when its table is a ticket-like one (audit of 2026-11-07, part 2: the owner's
// home page showed the raw name "ui_page" because ANY /<name>.do?sys_id=<hex> was trusted as "a record of table <name>").

const ID = '57af7aec73d423002728660c4cf6a71c';
const HOST = 'https://dev364920.service-now.com';

test('isTicketTable: the kinds the product knows, the families it handles, the lists a person with the source can extend', () => {
  for (const table of [
    'incident', 'problem', 'change_request', 'sc_request', 'sc_req_item', 'sc_task', 'sn_customerservice_case', 'sn_hr_core_case', 'task',
    'incident_task', 'change_task', 'problem_task', 'sn_customerservice_task', 'sn_hr_core_task', 'kb_knowledge', 'interaction',
    'sys_cs_conversation', 'SN_HR_LE_CASE', 'Incident', ' incident ',
  ]) {
    assert.equal(isTicketTable(table), true, table);
  }
  // the built-in families (security, vulnerability, GRC, risk, compliance, audit): work records the product already treats with care
  for (const table of ['sn_si_incident', 'sn_vul_vulnerable_item', 'sn_grc_issue', 'sn_audit_task', 'sn_risk_risk']) assert.equal(isTicketTable(table), true, table);
  // the page tables the portal map names
  for (const table of Object.values(PORTAL_PAGE_TABLES)) assert.equal(isTicketTable(table), true, table);
  assert.ok(Array.isArray(TICKET_TABLES) && Object.isFrozen(TICKET_TABLES), 'the list a person with the source extends is a frozen list');
});

test('isTicketTable: a UI page, a script, a user, a report, the home page and every unknown table are not tickets', () => {
  for (const table of [
    'ui_page', 'sys_ui_page', 'sys_ui_macro', 'sys_script', 'sys_report', 'sys_user', 'sys_user_group', 'sys_properties', 'cmdb_ci',
    'cmdb_ci_server', 'sc_cat_item', 'home', 'welcome', 'navpage', 'login', 'u_custom_thing', 'x_acme_visit', 'my_page', 'kb_view',
    'sn_hr', 'sn_hrx_case', 'sn_sia_incident', 'sn_customerservice_account',
  ]) {
    assert.equal(isTicketTable(table), false, table);
  }
  // not a table name at all
  for (const odd of ['', '   ', null, undefined, 42, {}, 'Not A Table', 'incident; drop', '../incident', '1incident', 'toString', '__proto__', 'constructor']) {
    assert.equal(isTicketTable(odd), false, String(odd));
  }
});

test('isTicketTable: the organisation\'s own families (policy sensitiveTablePrefixes) and tables the caller was told to trust', () => {
  assert.equal(isTicketTable('x_acme_hr_case'), false);
  assert.equal(isTicketTable('x_acme_hr_case', { extraPrefixes: ['x_acme_hr_'] }), true);
  assert.equal(isTicketTable('X_ACME_HR_CASE', { extraPrefixes: ['X_Acme_HR_'] }), true, 'case does not matter');
  assert.equal(isTicketTable('x_acme_visit', { extraPrefixes: ['x_acme_hr_'] }), false);
  assert.equal(isTicketTable('u_facilities_request', { extraTables: ['u_facilities_request'] }), true);
  assert.equal(isTicketTable('u_facilities_request', { extraTables: ['u_other'] }), false);
  for (const odd of [null, 'x_acme_hr_', {}, 7]) assert.equal(isTicketTable('x_acme_visit', { extraPrefixes: odd, extraTables: odd }), false, String(odd));
  // an empty prefix in the list does not make every table a ticket
  assert.equal(isTicketTable('ui_page', { extraPrefixes: [''] }), false);
});

// ---- parseRecordRef: the rows of the audit's table that were "BUG" are no record now -----------------------------------------

const NO_RECORD = [
  `${HOST}/ui_page.do?sys_id=${ID}`,
  `${HOST}/now/nav/ui/classic/params/target/ui_page.do%3Fsys_id%3D${ID}`,
  `${HOST}/ui_page.do?sysparm_query=sys_id=${ID}`,
  `${HOST}/sys_ui_page.do?sys_id=${ID}`,
  `${HOST}/sys_ui_macro.do?sys_id=${ID}`,
  `${HOST}/sys_script.do?sys_id=${ID}`,
  `${HOST}/sys_report.do?sys_id=${ID}`,
  `${HOST}/sys_user.do?sys_id=${ID}`,
  `${HOST}/sys_user_group.do?sys_id=${ID}`,
  `${HOST}/cmdb_ci_server.do?sys_id=${ID}`,
  `${HOST}/sc_cat_item.do?sys_id=${ID}`,
  `${HOST}/my_page.do?sys_id=${ID}`,
  `${HOST}/home.do?sys_id=${ID}`,
  `${HOST}/welcome.do?sys_id=${ID}`,
  `${HOST}/nav_to.do?uri=ui_page.do%3Fsys_id%3D${ID}`,
  // a number in the address of a page that is no ticket's is not looked up in a table named after the page
  `${HOST}/ui_page.do?sysparm_query=number=INC0010001`,
  `${HOST}/home.do?sysparm_query=number%3DINC0010001`,
  // portals and workspaces that name such a table
  `${HOST}/sp?id=ui_page&table=sys_ui_page&sys_id=${ID}`,
  `${HOST}/sp?id=form&table=sys_ui_page&sys_id=${ID}`,
  `${HOST}/esc?id=form&table=sys_user&sys_id=${ID}`,
  `${HOST}/anything?table=ui_page&sys_id=${ID}`,
  `${HOST}/now/sow/record/ui_page/${ID}`,
  `${HOST}/now/workspace/agent/record/sys_user/${ID}`,
];

test('an address that names a table that is not a ticket\'s is no record, on every kind of page', () => {
  for (const url of NO_RECORD) assert.equal(parseRecordRef(url), null, url);
});

test('anyTable gives the address as it reads (the resolver decides with more than the address)', () => {
  assert.deepEqual(parseRecordRef(`${HOST}/ui_page.do?sys_id=${ID}`, { anyTable: true }), { table: 'ui_page', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/ui_page.do?sysparm_query=number=INC0010001`, { anyTable: true }), { table: 'ui_page', number: 'INC0010001' });
  assert.deepEqual(parseRecordRef(`${HOST}/sp?id=form&table=sys_ui_page&sys_id=${ID}`, { anyTable: true }), { table: 'sys_ui_page', sysId: ID });
  assert.equal(parseRecordRef(`${HOST}/ui_page.do`, { anyTable: true }), null, 'still no record when there is no id');
  assert.equal(parseRecordRef(`${HOST}/ui_page_list.do?sys_id=${ID}`, { anyTable: true }), null, 'a list is never a record');
  assert.equal(parseRecordRef(`${HOST}/incident.do?sys_id=-1`, { anyTable: true }), null, 'a new record is never a record');
});

test('the controls still parse: tickets, tasks, the base class, knowledge and the families of the policy', () => {
  assert.deepEqual(parseRecordRef(`${HOST}/incident.do?sys_id=${ID}`), { table: 'incident', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/task.do?sys_id=${ID}`), { table: 'task', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/kb_knowledge.do?sys_id=${ID}`), { table: 'kb_knowledge', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/sn_si_incident.do?sys_id=${ID}`), { table: 'sn_si_incident', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/now/sow/record/sn_customerservice_case/${ID}`), { table: 'sn_customerservice_case', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/sp?id=ticket&table=incident&sys_id=${ID}`), { table: 'incident', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/incident.do?sysparm_query=number=INC0010001`), { table: 'incident', number: 'INC0010001' });
  // a customer's own family, told by the policy
  assert.equal(parseRecordRef(`${HOST}/x_acme_hr_case.do?sys_id=${ID}`), null);
  assert.deepEqual(parseRecordRef(`${HOST}/x_acme_hr_case.do?sys_id=${ID}`, { extraPrefixes: ['x_acme_hr_'] }), { table: 'x_acme_hr_case', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/now/sow/record/u_facilities_request/${ID}`, { extraTables: ['u_facilities_request'] }), { table: 'u_facilities_request', sysId: ID });
});

// ---- blank forms -------------------------------------------------------------------------------------------------------------

test('a blank form of a table that is not a ticket\'s is not "a new ui page form"', () => {
  for (const [url, table] of [
    [`${HOST}/ui_page.do?sys_id=-1`, 'ui_page'],
    [`${HOST}/home.do?sys_id=-1`, 'home'],
    [`${HOST}/now/nav/ui/classic/params/target/sys_ui_page.do%3Fsys_id%3D-1`, 'sys_ui_page'],
    [`${HOST}/now/sow/record/sys_user/-1`, 'sys_user'],
  ]) {
    assert.equal(parseNewRecordRef(url), null, url);
    assert.deepEqual(parseNewRecordRef(url, { anyTable: true }), { table }, url);
  }
  // the controls
  assert.deepEqual(parseNewRecordRef(`${HOST}/incident.do?sys_id=-1`), { table: 'incident' });
  assert.deepEqual(parseNewRecordRef(`${HOST}/nav_to.do?uri=%2Fkb_knowledge.do%3Fsys_id%3D-1`), { table: 'kb_knowledge' });
  assert.deepEqual(parseNewRecordRef(`${HOST}/now/cwf/agent/record/sn_customerservice_case/-1/params/x`), { table: 'sn_customerservice_case' });
  assert.deepEqual(parseNewRecordRef(`${HOST}/x_acme_hr_case.do?sys_id=-1`, { extraPrefixes: ['x_acme_hr_'] }), { table: 'x_acme_hr_case' });
  assert.equal(parseNewRecordRef(`${HOST}/incident.do?sys_id=${ID}`), null);
});

// ---- S9: the article reader --------------------------------------------------------------------------------------------------

test('S9: the article reader of the classic UI is a knowledge article (by number, else by its own id)', () => {
  const article = { table: 'kb_knowledge', number: 'KB0010001' };
  for (const url of [
    `${HOST}/kb_view.do?sysparm_article=KB0010001`,
    `${HOST}/kb_view.do?sysparm_article=kb0010001`,
    `${HOST}/kb_view.do?sysparm_article=KB0010001&sysparm_rank=1&sysparm_tsqueryId=abc`,
    `${HOST}/kb_view_customer.do?sysparm_article=KB0010001`,
    `${HOST}/nav_to.do?uri=kb_view.do%3Fsysparm_article%3DKB0010001`,
    `${HOST}/nav_to.do?uri=%2Fkb_view.do%3Fsysparm_article%3DKB0010001`,
    `${HOST}/now/nav/ui/classic/params/target/kb_view.do%3Fsysparm_article%3DKB0010001`,
    `/kb_view.do?sysparm_article=KB0010001`,
  ]) {
    assert.deepEqual(parseRecordRef(url), article, url);
  }
  // the number is the sure part: it wins over an id that might be the knowledge base's
  assert.deepEqual(parseRecordRef(`${HOST}/kb_view.do?sysparm_article=KB0010001&sys_kb_id=${ID}`), article);
  assert.deepEqual(parseRecordRef(`${HOST}/kb_view.do?sys_kb_id=${ID}`), { table: 'kb_knowledge', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/now/nav/ui/classic/params/target/kb_view.do%3Fsys_kb_id%3D${ID}`), { table: 'kb_knowledge', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/kb_view.do?sysparm_article=hello&sys_kb_id=${ID.toUpperCase()}`), { table: 'kb_knowledge', sysId: ID });
  // nothing to point at: not a record, and not a table called kb_view
  for (const url of [`${HOST}/kb_view.do`, `${HOST}/kb_view.do?sysparm_article=hello`, `${HOST}/kb_view.do?sys_kb_id=abc`, `${HOST}/kb_view.do?sys_kb_id=-1`, `${HOST}/kb_view.do?sysparm_query=number=INC0010001`]) {
    assert.equal(parseRecordRef(url), null, url);
  }
});

test('S9: the portal article pages are knowledge articles too, and the article form still is', () => {
  const article = { table: 'kb_knowledge', number: 'KB0010001' };
  for (const url of [
    `${HOST}/sp?id=kb_article_view&sysparm_article=KB0010001`,
    `${HOST}/esc?id=kb_article&sysparm_article=KB0010001`,
    `${HOST}/kb?id=kb_article_view&sysparm_article=KB0010001`,
    `${HOST}/csm?id=kb_article&sysparm_article=KB0010001`,
  ]) {
    assert.deepEqual(parseRecordRef(url), article, url);
  }
  assert.deepEqual(parseRecordRef(`${HOST}/sp?id=kb_article&sys_id=${ID}`), { table: 'kb_knowledge', sysId: ID });
  assert.deepEqual(parseRecordRef(`${HOST}/kb_knowledge.do?sys_id=${ID}`), { table: 'kb_knowledge', sysId: ID });
  // a knowledge-base landing or search page is not an article
  assert.equal(parseRecordRef(`${HOST}/sp?id=kb`), null);
  assert.equal(parseRecordRef(`${HOST}/sp?id=kb_search&q=vpn`), null);
});
