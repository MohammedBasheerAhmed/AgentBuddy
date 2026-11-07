// The address matrix (audit 6, 2026-11-07): page x record x audience x intent, for src/lib/snLinks.js, the one place that knows the
// shape of a ServiceNow address. The rules under test:
//   - an article OPENED by an agent and an article COPIED for a customer are the same string on every surface;
//   - the link for a customer never depends on the tab the agent has open;
//   - a ticket stays in the agent's Workspace or portal, on the page chosen by the table's kind (never copied from the current page);
//   - nothing is ever built for another origin, or from a bad table, sys_id or number: '' instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLE_NUMBER_RE,
  PORTAL_TICKET_PAGES,
  TABLE_FAMILIES,
  articleNumber,
  blankFormLink,
  customerArticleLink,
  emailFormLink,
  familyOf,
  linkFor,
  listLink,
  originOf,
  portalBase,
  staysInOwnUi,
  ticketPageFor,
  workspacePrefix,
  workspaceRoute,
} from '../src/lib/snLinks.js';

const HOST = 'https://x.service-now.com';
const ID = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';

// ---- The pages an agent can be on ------------------------------------------------------------------------------------------------
const portal = (suffix, pageId, extra = '') => ({ href: `${HOST}/${suffix}?id=${pageId}${extra}`, surface: 'portal', portal: { base: `/${suffix}`, pageId }, tabId: 1 });
const PAGES = {
  classic: { href: `${HOST}/incident.do?sys_id=${ID}`, surface: 'classic', tabId: 1 },
  'classic in the Next Experience shell': { href: `${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}`, surface: 'classic', tabId: 1 },
  'Workspace (SOW) record': { href: `${HOST}/now/sow/record/incident/${ID}`, surface: 'workspace', tabId: 1 },
  'Workspace (CSM) record': { href: `${HOST}/now/cwf/agent/record/sn_customerservice_case/${ID}`, surface: 'workspace', tabId: 1 },
  'Workspace (HR) record': { href: `${HOST}/now/hr/agent/record/sn_hr_core_case/${ID}`, surface: 'workspace', tabId: 1 },
  'Workspace home': { href: `${HOST}/now/sow/home`, surface: 'workspace', tabId: 1 },
  'Workspace list': { href: `${HOST}/now/sow/list/incident`, surface: 'workspace', tabId: 1 },
  'portal /sp': portal('sp', 'ticket', `&table=incident&sys_id=${ID}`),
  'portal /esc': portal('esc', 'ticket', `&table=incident&sys_id=${ID}`),
  'portal /csm': portal('csm', 'csm_ticket', `&table=sn_customerservice_case&sys_id=${ID}`),
  'portal /hrsp': portal('hrsp', 'hr_ticket', `&table=sn_hr_core_case&sys_id=${ID}`),
  'portal home': portal('esc', 'index'),
  'portal without a description (the full-page dashboard)': { href: `${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=${ID}`, surface: 'portal', tabId: 1 },
  'portal with an own suffix': { href: `${HOST}/support?id=ticket`, surface: 'portal', tabId: 1 },
  other: { href: `${HOST}/some/where`, surface: 'other', tabId: 1 },
};
const pageEntries = Object.entries(PAGES);

const TICKET_TABLES = ['incident', 'sc_req_item', 'sc_task', 'sn_hr_core_case', 'sn_customerservice_case', 'change_request'];
const formOf = (table, id = ID) => `${HOST}/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${id}`)}`;
const readerOf = (number) => `${HOST}/kb_view.do?sysparm_article=${number}`;

// ---- The article: open === copy, on every surface -----------------------------------------------------------------------------------

test('an article OPENED by an agent and COPIED for a customer is one address on every surface (by number)', () => {
  for (const [name, page] of pageEntries) {
    const ref = { table: 'kb_knowledge', sysId: ID, number: 'KB0010001' };
    const open = linkFor(page, ref, { audience: 'agent', intent: 'read' });
    const byDefault = linkFor(page, ref);
    const copy = linkFor(page, ref, { audience: 'customer' });
    const copyWork = linkFor(page, ref, { audience: 'customer', intent: 'work' });
    assert.equal(open, readerOf('KB0010001'), name);
    assert.equal(byDefault, open, `${name}: no options is the same`);
    assert.equal(copy, open, `${name}: open == copy`);
    assert.equal(copyWork, open, `${name}: the intent does not change what a customer receives`);
    assert.equal(customerArticleLink(page, { sysId: ID, number: 'KB0010001' }), open, name);
  }
});

test('an article without a usable number is the reader by its sys_id, on every surface, open == copy', () => {
  for (const [name, page] of pageEntries) {
    const expected = `${HOST}/kb_view.do?sys_kb_id=${ID}`;
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID }), expected, name);
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID, number: 'not a number' }), expected, name);
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID, number: 'KB123' }), expected, `${name}: too few digits`);
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID }, { audience: 'customer' }), expected, name);
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID.toUpperCase() }), expected, `${name}: lower case`);
  }
});

test('the customer link is the same single address whatever tab the agent has open', () => {
  const seen = new Set();
  for (const [, page] of pageEntries) seen.add(customerArticleLink(page, { sysId: ID, number: 'KB0010001' }));
  assert.deepEqual([...seen], [readerOf('KB0010001')]);
  // and it is never one of the portals the agent happens to be on
  for (const [name, page] of pageEntries) {
    const url = customerArticleLink(page, { number: 'KB0010001' });
    assert.ok(!/[?&]id=/.test(url), `${name}: ${url}`);
  }
});

test('one number pattern for every article number: KB, KBA and the other prefix families, 4 to 12 digits', () => {
  const classic = PAGES.classic;
  for (const number of ['KB0010001', 'KBA0010001', 'ARTICLE0001234', 'KI0000123', 'kb0010001', ' KB0010001 ', 'AB1234', 'ABCDEFGH123456789012']) {
    const n = number.trim().toUpperCase();
    assert.equal(articleNumber(number), n, number);
    assert.equal(linkFor(classic, { table: 'kb_knowledge', number }), readerOf(n), number);
    assert.equal(linkFor(PAGES['portal /esc'], { table: 'kb_knowledge', number }), readerOf(n), `${number} from a portal`);
  }
  for (const number of ['KB123', 'KB1234567890123', 'K0001234', 'ABCDEFGHI0001234', 'KB 0010001', 'KB0010001&x=1', 'KB0010001/../x', 'KB-0010001', '', null, undefined, 5, {}]) {
    assert.equal(articleNumber(number), '', String(number));
    assert.equal(linkFor(classic, { table: 'kb_knowledge', number }), '', String(number));
  }
  assert.equal(ARTICLE_NUMBER_RE.test('KB0010001'), true);
});

test('the authoring form is only for intent "author" (the Duplicates screen), on every surface, never for a customer', () => {
  for (const [name, page] of pageEntries) {
    const form = formOf('kb_knowledge');
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID, number: 'KB0010001' }, { audience: 'agent', intent: 'author' }), form, name);
    // a customer never gets the form, whatever is asked
    assert.equal(linkFor(page, { table: 'kb_knowledge', sysId: ID, number: 'KB0010001' }, { audience: 'customer', intent: 'author' }), readerOf('KB0010001'), name);
    // the form needs the sys_id: without one there is nothing to open (the number alone is not a form)
    assert.equal(linkFor(page, { table: 'kb_knowledge', number: 'KB0010001' }, { intent: 'author' }), '', name);
  }
});

// ---- Tickets: stay in the Workspace or portal the agent works in ---------------------------------------------------------------------

test('a ticket on the classic UI, in the shell, on another page: the classic form, for every kind of ticket', () => {
  for (const name of ['classic', 'classic in the Next Experience shell', 'other', 'Workspace home', 'Workspace list']) {
    for (const table of TICKET_TABLES) assert.equal(linkFor(PAGES[name], { table, sysId: ID }), formOf(table), `${name} ${table}`);
  }
});

test('a ticket in a Workspace opens on the Workspace record route when the table is of the family the Workspace shows', () => {
  const sow = PAGES['Workspace (SOW) record'];
  for (const table of ['incident', 'sc_req_item', 'sc_task', 'change_request']) assert.equal(linkFor(sow, { table, sysId: ID2 }), `${HOST}/now/sow/record/${table}/${ID2}`, table);
  // tables of another family are not guessed (audit 9, S22): the classic form
  for (const table of ['sn_hr_core_case', 'sn_customerservice_case']) assert.equal(linkFor(sow, { table, sysId: ID2 }), formOf(table, ID2), table);
  const csm = PAGES['Workspace (CSM) record'];
  assert.equal(linkFor(csm, { table: 'sn_customerservice_case', sysId: ID2 }), `${HOST}/now/cwf/agent/record/sn_customerservice_case/${ID2}`);
  assert.equal(linkFor(csm, { table: 'sn_customerservice_task', sysId: ID2 }), `${HOST}/now/cwf/agent/record/sn_customerservice_task/${ID2}`);
  assert.equal(linkFor(csm, { table: 'incident', sysId: ID2 }), formOf('incident', ID2));
  const hr = PAGES['Workspace (HR) record'];
  assert.equal(linkFor(hr, { table: 'sn_hr_core_case', sysId: ID2 }), `${HOST}/now/hr/agent/record/sn_hr_core_case/${ID2}`);
  assert.equal(linkFor(hr, { table: 'change_request', sysId: ID2 }), formOf('change_request', ID2));
  // the same table as the one on screen always works, even when it is no known family
  const custom = { href: `${HOST}/now/sow/record/u_facilities/${ID}`, surface: 'workspace' };
  assert.equal(linkFor(custom, { table: 'u_facilities', sysId: ID2 }), `${HOST}/now/sow/record/u_facilities/${ID2}`);
  assert.equal(linkFor(custom, { table: 'u_other', sysId: ID2 }), formOf('u_other', ID2));
  assert.equal(linkFor(custom, { table: 'incident', sysId: ID2 }), formOf('incident', ID2));
});

test('a ticket on a portal opens on the portal the agent is on, on the page of the table\'s kind', () => {
  const expectedPage = { incident: 'ticket', sc_req_item: 'ticket', sc_task: 'ticket', change_request: 'ticket', sn_hr_core_case: 'hr_ticket', sn_customerservice_case: 'csm_ticket' };
  const portals = { 'portal /sp': '/sp', 'portal /esc': '/esc', 'portal /csm': '/csm', 'portal /hrsp': '/hrsp', 'portal home': '/esc', 'portal without a description (the full-page dashboard)': '/csm', 'portal with an own suffix': '/support' };
  for (const [name, base] of Object.entries(portals)) {
    for (const table of TICKET_TABLES) assert.equal(linkFor(PAGES[name], { table, sysId: ID }), `${HOST}${base}?id=${expectedPage[table]}&table=${table}&sys_id=${ID}`, `${name} ${table}`);
  }
});

test('the full-page dashboard (no portal description) builds the same address as the side panel', () => {
  for (const [suffix, pageId] of [['sp', 'ticket'], ['esc', 'ticket'], ['csm', 'csm_ticket'], ['hrsp', 'hr_ticket'], ['support', 'index']]) {
    const href = `${HOST}/${suffix}?id=${pageId}&table=incident&sys_id=${ID}`;
    const panel = { href, surface: 'portal', portal: { base: `/${suffix}`, pageId } };
    const dashboard = { href, surface: 'portal' };
    for (const table of [...TICKET_TABLES, 'kb_knowledge']) {
      const ref = { table, sysId: ID, number: table === 'kb_knowledge' ? 'KB0010001' : undefined };
      assert.equal(linkFor(dashboard, ref), linkFor(panel, ref), `${suffix} ${table}`);
    }
  }
});

test('the sys_id is lower case in every address', () => {
  const upper = ID.toUpperCase();
  for (const [name, page] of pageEntries) {
    for (const table of TICKET_TABLES) {
      const url = linkFor(page, { table, sysId: upper });
      assert.ok(url.includes(ID) && !url.includes(upper), `${name} ${table}: ${url}`);
    }
  }
  assert.ok(emailFormLink(PAGES.classic, { table: 'incident', sysId: upper }).includes(ID));
});

test('a ticket has no link for a customer (nothing builds a customer\'s ticket)', () => {
  for (const [name, page] of pageEntries) for (const table of TICKET_TABLES) assert.equal(linkFor(page, { table, sysId: ID }, { audience: 'customer' }), '', `${name} ${table}`);
});

test('the portal description from the page is not trusted blindly', () => {
  const href = `${HOST}/esc?id=ticket`;
  assert.equal(portalBase({ href, surface: 'portal', portal: { base: 'https://evil.example/x' } }), '/esc');
  assert.equal(portalBase({ href, surface: 'portal', portal: { base: '/a/b' } }), '/esc');
  assert.equal(portalBase({ href, surface: 'portal', portal: { base: '/../evil' } }), '/esc');
  assert.equal(portalBase({ href, surface: 'portal', portal: { base: '/ESC' } }), '/esc');
  assert.equal(portalBase({ href: `${HOST}/`, surface: 'portal' }), '/sp', 'nothing names a portal: the one fallback');
  assert.equal(portalBase({ href: 'not a url' }), '/sp');
  // the page id from the page is never copied into an address
  const sneaky = { href, surface: 'portal', portal: { base: '/esc', pageId: 'x&evil=1' } };
  assert.equal(linkFor(sneaky, { table: 'incident', sysId: ID }), `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`);
});

// ---- Nothing unsafe is ever built --------------------------------------------------------------------------------------------------

test('every address is built on the page\'s own origin, never another', () => {
  const other = 'https://y.service-now.com';
  for (const [name, page] of pageEntries) {
    const moved = { ...page, href: page.href.replace(HOST, other) };
    const urls = [
      ...TICKET_TABLES.map((table) => linkFor(moved, { table, sysId: ID })),
      linkFor(moved, { table: 'kb_knowledge', number: 'KB0010001' }),
      linkFor(moved, { table: 'kb_knowledge', sysId: ID }, { intent: 'author' }),
      customerArticleLink(moved, { number: 'KB0010001' }),
      listLink(moved, 'incident', 'active=true'),
      blankFormLink(moved, 'incident'),
      emailFormLink(moved, { table: 'incident', sysId: ID }),
    ];
    for (const url of urls) {
      assert.ok(url.startsWith(`${other}/`), `${name}: ${url}`);
      assert.equal(new URL(url).origin, other, `${name}: ${url}`);
    }
  }
  assert.equal(originOf({ href: `${HOST}:443/x` }), HOST);
});

test('bad input gives \'\', never a guess', () => {
  const classic = PAGES.classic;
  const goodRef = { table: 'incident', sysId: ID };
  // a bad table
  for (const table of ['Incident', 'a;b', '../x', 'incident&x=1', '', null, undefined, 5, {}, 'a b', '1abc', 'x'.repeat(81)]) {
    assert.equal(linkFor(classic, { table, sysId: ID }), '', String(table));
    assert.equal(linkFor(classic, { table, sysId: ID, number: 'KB0010001' }, { audience: 'customer' }), '', String(table));
    assert.equal(listLink(classic, table, 'a=1'), '', String(table));
    assert.equal(blankFormLink(classic, table), '', String(table));
    assert.equal(emailFormLink(classic, { table, sysId: ID }), '', String(table));
  }
  // a bad sys_id (a ticket needs one)
  for (const sysId of ['abc', `${ID}0`, `${ID.slice(1)}g`, '', null, undefined, 5, '-1', `${ID}&x=1`]) {
    assert.equal(linkFor(classic, { table: 'incident', sysId }), '', String(sysId));
    assert.equal(emailFormLink(classic, { table: 'incident', sysId }), '', String(sysId));
    assert.equal(linkFor(classic, { table: 'kb_knowledge', sysId }), '', `an article with neither number nor a good sys_id: ${String(sysId)}`);
  }
  // a bad page
  for (const page of [undefined, null, {}, { href: '' }, { href: 'not a url' }, { href: 'javascript:alert(1)' }, { href: 'http://x.service-now.com/incident.do' }, { href: 'ftp://x.service-now.com/' }, { href: 'data:text/html,x' }, { href: 5 }]) {
    assert.equal(linkFor(page, goodRef), '', JSON.stringify(page));
    assert.equal(linkFor(page, { table: 'kb_knowledge', number: 'KB0010001' }), '', JSON.stringify(page));
    assert.equal(customerArticleLink(page, { number: 'KB0010001' }), '', JSON.stringify(page));
    assert.equal(listLink(page, 'incident', 'a=1'), '', JSON.stringify(page));
    assert.equal(blankFormLink(page, 'incident'), '', JSON.stringify(page));
    assert.equal(emailFormLink(page, goodRef), '', JSON.stringify(page));
  }
  // no reference at all
  for (const ref of [undefined, null, {}, 'incident', 5]) assert.equal(linkFor(classic, ref), '', String(ref));
  // an unknown audience or intent is a mistake in the code that asks, not a link
  assert.equal(linkFor(classic, goodRef, { audience: 'everybody' }), '');
  assert.equal(linkFor(classic, goodRef, { audience: 'agent', intent: 'delete' }), '');
  assert.equal(linkFor(classic, { table: 'kb_knowledge', number: 'KB0010001' }, { audience: 'CUSTOMER' }), '');
  assert.equal(customerArticleLink(classic, undefined), '');
  assert.equal(customerArticleLink(classic, {}), '');
});

test('text in a number or a sys_id can never become part of an address', () => {
  const classic = PAGES.classic;
  for (const number of ['KB0010001&sysparm_foo=1', 'KB0010001#x', '../../etc', 'KB0010001%00', 'javascript:alert(1)', '<script>1234</script>']) {
    const url = linkFor(classic, { table: 'kb_knowledge', sysId: ID, number });
    assert.equal(url, `${HOST}/kb_view.do?sys_kb_id=${ID}`, number); // the number is rejected; the checked sys_id is used
    assert.ok(!url.includes('script') && !url.includes('&sysparm_foo'), number);
  }
});

// ---- Lists, blank forms, the email form: classic pages, the same from every tab ------------------------------------------------------

test('a list, a blank form and the email form are one address from every tab', () => {
  const list = listLink(PAGES.classic, 'incident', `assigned_to=${ID}^active=true`);
  assert.equal(list, `${HOST}/nav_to.do?uri=${encodeURIComponent(`incident_list.do?sysparm_query=${encodeURIComponent(`assigned_to=${ID}^active=true`)}`)}`);
  const blank = blankFormLink(PAGES.classic, 'incident');
  assert.equal(blank, `${HOST}/nav_to.do?uri=${encodeURIComponent('incident.do?sys_id=-1')}`);
  const email = emailFormLink(PAGES.classic, { table: 'incident', sysId: ID });
  assert.equal(email, `${HOST}/email_client.do?sysparm_table=incident&sysparm_sys_id=${ID}&sysparm_target=incident&sysparm_uniqueValue=${ID}`);
  for (const [name, page] of pageEntries) {
    assert.equal(listLink(page, 'incident', `assigned_to=${ID}^active=true`), list, name);
    assert.equal(blankFormLink(page, 'incident'), blank, name);
    assert.equal(emailFormLink(page, { table: 'incident', sysId: ID }), email, name);
  }
});

test('a list takes any filter the reports build (encoded), refuses a huge one, and allows none', () => {
  const page = PAGES.classic;
  assert.equal(listLink(page, 'task_sla', 'a=1'), `${HOST}/nav_to.do?uri=${encodeURIComponent('task_sla_list.do?sysparm_query=a%3D1')}`);
  assert.equal(listLink(page, 'incident'), `${HOST}/nav_to.do?uri=${encodeURIComponent('incident_list.do?sysparm_query=')}`);
  const odd = listLink(page, 'incident', "opened_at>=2026-11-01 00:00:00^short_descriptionLIKE'x'&y=1#z");
  assert.ok(!odd.includes('#') && !odd.includes(' ') && !odd.includes('&y=1') && !odd.includes('>='), 'nothing of the filter escapes the address');
  assert.equal(new URL(odd).searchParams.get('uri').split('sysparm_query=')[1].length > 0, true);
  assert.equal(listLink(page, 'incident', 'x'.repeat(6001)), '');
  assert.notEqual(listLink(page, 'incident', 'x'.repeat(6000)), '');
});

// ---- Where the address leads: does it keep the agent in his Workspace or portal? ----------------------------------------------------------

test('staysInOwnUi: a classic page never leaves; a Workspace only on its own record route; a portal only on its own pages', () => {
  const read = readerOf('KB0010001');
  const list = listLink(PAGES.classic, 'incident', 'a=1');
  const blank = blankFormLink(PAGES.classic, 'incident');
  for (const name of ['classic', 'classic in the Next Experience shell', 'other']) {
    for (const url of [read, list, blank, formOf('incident')]) assert.equal(staysInOwnUi(PAGES[name], url), true, `${name} ${url}`);
  }
  const sow = PAGES['Workspace (SOW) record'];
  assert.equal(staysInOwnUi(sow, `${HOST}/now/sow/record/sc_req_item/${ID2}`), true);
  for (const url of [read, list, blank, formOf('incident'), `${HOST}/now/cwf/agent/record/incident/${ID2}`]) assert.equal(staysInOwnUi(sow, url), false, url);
  // away from a record page the Workspace cannot be told: nothing stays
  assert.equal(staysInOwnUi(PAGES['Workspace home'], `${HOST}/now/sow/record/incident/${ID2}`), false);
  const esc = PAGES['portal /esc'];
  assert.equal(staysInOwnUi(esc, `${HOST}/esc?id=ticket&table=incident&sys_id=${ID2}`), true);
  assert.equal(staysInOwnUi(esc, `${HOST}/esc/?id=ticket`), true);
  for (const url of [read, list, blank, formOf('incident'), `${HOST}/sp?id=ticket&table=incident&sys_id=${ID2}`]) assert.equal(staysInOwnUi(esc, url), false, url);
  // another instance never
  for (const page of Object.values(PAGES)) for (const url of ['https://evil.example/kb_view.do', `${HOST}.evil.example/x`, 'javascript:alert(1)', '', 'not a url', undefined]) assert.equal(staysInOwnUi(page, url), false, String(url));
  assert.equal(staysInOwnUi(undefined, read), false);
});

// ---- The tables the assumptions live in ------------------------------------------------------------------------------------------------------

test('the page ids and table families are in one place: every family has its ticket page', () => {
  assert.deepEqual({ ...PORTAL_TICKET_PAGES }, { csm: 'csm_ticket', hr: 'hr_ticket', itsm: 'ticket' });
  for (const [id] of TABLE_FAMILIES) assert.ok(PORTAL_TICKET_PAGES[id], id);
  assert.equal(familyOf('sn_hr_core_case'), 'hr');
  assert.equal(familyOf('sn_hr_core_task'), 'hr');
  assert.equal(familyOf('sn_customerservice_case'), 'csm');
  assert.equal(familyOf('csm_consumer'), 'csm');
  for (const t of ['incident', 'problem', 'change_request', 'change_task', 'sc_request', 'sc_req_item', 'sc_task']) assert.equal(familyOf(t), 'itsm', t);
  for (const t of ['u_x', 'kb_knowledge', 'sys_user', '', null, undefined]) assert.equal(familyOf(t), '', String(t));
  assert.equal(ticketPageFor('u_x'), 'ticket', 'a table of no family: the shared page');
  assert.equal(ticketPageFor('sn_customerservice_case'), 'csm_ticket');
  assert.equal(ticketPageFor('sn_hr_core_case'), 'hr_ticket');
});

test('the Workspace route is read from the address; its prefix is plain segments only', () => {
  assert.deepEqual(workspaceRoute({ href: `${HOST}/now/sow/record/incident/${ID}` }), { prefix: '/now/sow', table: 'incident' });
  assert.deepEqual(workspaceRoute({ href: `${HOST}/now/cwf/agent/record/sn_customerservice_case/${ID}/params/x` }), { prefix: '/now/cwf/agent', table: 'sn_customerservice_case' });
  assert.equal(workspacePrefix({ href: `${HOST}/now/workspace/agent/record/incident/${ID}` }), '/now/workspace/agent');
  for (const href of [`${HOST}/now/a%2F..%2Fb/record/incident/${ID}`, `${HOST}/now/a/b/c/d/record/incident/${ID}`, `${HOST}/now/sow/home`, `${HOST}/incident.do?sys_id=${ID}`, 'not a url', undefined]) {
    assert.equal(workspaceRoute({ href }), null, String(href));
    assert.equal(workspacePrefix({ href }), '', String(href));
  }
});
