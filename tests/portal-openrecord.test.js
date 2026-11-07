const test = require('node:test');
const assert = require('node:assert/strict');
import { newRecordUrl, openInNewTab, openNewRecord, openRecord, openRecordTab, openUrl, recordUrl, workspacePrefix } from '../src/sidepanel/openRecord.js';

const ID = '57af7aec73d423002728660c4cf6a71c';
const HOST = 'https://dev12345.service-now.com';
const classic = { href: `${HOST}/incident.do?sys_id=${ID}`, surface: 'classic', tabId: 7 };
const workspace = { href: `${HOST}/now/sow/record/incident/${ID}`, surface: 'workspace', tabId: 7 };
const portal = (href, info) => ({ href, surface: 'portal', tabId: 7, ...(info ? { portal: info } : {}) });

test('on the classic UI a record opens through nav_to.do; in a Workspace on the Workspace route of its own', () => {
  const classicUrl = `${HOST}/nav_to.do?uri=${encodeURIComponent(`sc_req_item.do?sys_id=${ID}`)}`;
  assert.equal(recordUrl(classic, { table: 'sc_req_item', sysId: ID }), classicUrl);
  assert.equal(recordUrl(workspace, { table: 'sc_req_item', sysId: ID }), `${HOST}/now/sow/record/sc_req_item/${ID}`);
  const csm = { href: `${HOST}/now/cwf/agent/record/sn_customerservice_case/${ID}/params/x`, surface: 'workspace', tabId: 7 };
  assert.equal(recordUrl(csm, { table: 'sn_customerservice_task', sysId: 'b'.repeat(32) }), `${HOST}/now/cwf/agent/record/sn_customerservice_task/${'b'.repeat(32)}`);
  assert.equal(recordUrl(csm, { table: 'sn_customerservice_case', sysId: 'b'.repeat(32) }), `${HOST}/now/cwf/agent/record/sn_customerservice_case/${'b'.repeat(32)}`);
  // (audit 9, S22) a table of another family is not guessed on a Workspace's route: the classic form, which always exists
  assert.equal(recordUrl(csm, { table: 'incident', sysId: 'b'.repeat(32) }), `${HOST}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${'b'.repeat(32)}`)}`);
  assert.equal(recordUrl(workspace, { table: 'sn_hr_core_case', sysId: 'b'.repeat(32) }), `${HOST}/nav_to.do?uri=${encodeURIComponent(`sn_hr_core_case.do?sys_id=${'b'.repeat(32)}`)}`);
  // away from a record page the Workspace cannot be told for sure: the classic address works everywhere
  assert.equal(recordUrl({ href: `${HOST}/now/sow/home`, surface: 'workspace' }, { table: 'sc_req_item', sysId: ID }), classicUrl);
  // an article opens at the article reader on every surface, by number (audit 6, 2026-11-07; was: the authoring form via nav_to.do)
  assert.equal(recordUrl(workspace, { table: 'kb_knowledge', sysId: ID, number: 'KB0010001' }), `${HOST}/kb_view.do?sysparm_article=KB0010001`);
  assert.equal(recordUrl(workspace, { table: 'kb_knowledge', sysId: ID }), `${HOST}/kb_view.do?sys_kb_id=${ID}`);
  // only the Duplicates screen asks for the authoring form
  assert.equal(recordUrl(workspace, { table: 'kb_knowledge', sysId: ID }, { intent: 'author' }), `${HOST}/nav_to.do?uri=${encodeURIComponent(`kb_knowledge.do?sys_id=${ID}`)}`);
  // the prefix is plain segments only
  assert.equal(workspacePrefix({ href: `${HOST}/now/a%2F..%2Fb/record/incident/${ID}` }), '');
  assert.equal(workspacePrefix({ href: `${HOST}/now/a/b/c/d/record/incident/${ID}` }), '');
  assert.equal(workspacePrefix({ href: 'not a url' }), '');
});

test('on a portal a record opens on the same portal, never on /sp by default', () => {
  assert.equal(recordUrl(portal(`${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`, { base: '/esc', pageId: 'ticket' }), { table: 'incident', sysId: ID }), `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`);
  assert.equal(recordUrl(portal(`${HOST}/sp?id=index`, { base: '/sp', pageId: 'index' }), { table: 'sc_request', sysId: ID }), `${HOST}/sp?id=ticket&table=sc_request&sys_id=${ID}`);
  // without the content script's description, the address says which portal it is (and the ticket page comes from the table's family)
  assert.equal(recordUrl(portal(`${HOST}/hrsp?id=hr_home`), { table: 'sn_hr_core_case', sysId: ID }), `${HOST}/hrsp?id=hr_ticket&table=sn_hr_core_case&sys_id=${ID}`);
  assert.equal(recordUrl(portal(`${HOST}/supportportal?id=index`), { table: 'incident', sysId: ID }), `${HOST}/supportportal?id=ticket&table=incident&sys_id=${ID}`);
});

test('a portal ticket opens on the ticket page of its own kind of table (audit 6, I8), never the page the agent happens to be on', () => {
  const csm = portal(`${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=${ID}`, { base: '/csm', pageId: 'csm_ticket' });
  assert.equal(recordUrl(csm, { table: 'sn_customerservice_case', sysId: 'b'.repeat(32) }), `${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=${'b'.repeat(32)}`);
  // an incident from the customer service portal is an incident ticket (was: csm_ticket, copied from the page)
  assert.match(recordUrl(csm, { table: 'incident', sysId: ID }), /\?id=ticket&table=incident&/);
  const standard = portal(`${HOST}/sp?id=standard_ticket&table=incident&sys_id=${ID}`, { base: '/sp', pageId: 'standard_ticket' });
  assert.match(recordUrl(standard, { table: 'incident', sysId: ID }), /\?id=ticket&/);
  // whatever page the agent is on, the table decides
  assert.match(recordUrl(portal(`${HOST}/csm?id=my_cases`, { base: '/csm', pageId: 'my_cases' }), { table: 'sn_customerservice_case', sysId: ID }), /\?id=csm_ticket&/);
  assert.match(recordUrl(portal(`${HOST}/hrsp?id=csm_ticket`, { base: '/hrsp', pageId: 'csm_ticket' }), { table: 'sn_hr_core_case', sysId: ID }), /\?id=hr_ticket&/);
  assert.match(recordUrl(portal(`${HOST}/hrsp?id=hr_ticket`, { base: '/hrsp', pageId: 'hr_ticket' }), { table: 'change_request', sysId: ID }), /\?id=ticket&/);
});

test('an article opens at the article reader, also from a portal (audit 6, 2026-11-07; was: the portal\'s article page)', () => {
  const esc = portal(`${HOST}/esc?id=ticket`, { base: '/esc', pageId: 'ticket' });
  assert.equal(recordUrl(esc, { table: 'kb_knowledge', sysId: ID }), `${HOST}/kb_view.do?sys_kb_id=${ID}`);
  assert.equal(recordUrl(esc, { table: 'kb_knowledge', sysId: ID, number: 'KB0010001' }), `${HOST}/kb_view.do?sysparm_article=KB0010001`);
});

test('the portal description from the page is not trusted blindly', () => {
  // a base that is not a plain portal suffix is ignored; the address of the tab decides
  const evil = portal(`${HOST}/esc?id=ticket`, { base: 'https://evil.example/x', pageId: 'ticket' });
  assert.equal(recordUrl(evil, { table: 'incident', sysId: ID }), `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`);
  const odd = portal(`${HOST}/esc?id=ticket`, { base: '/a/b', pageId: 'ticket' });
  assert.ok(recordUrl(odd, { table: 'incident', sysId: ID }).startsWith(`${HOST}/esc?`));
  // a page id that does not end in "ticket" is not copied into the address
  const sneaky = portal(`${HOST}/esc?id=ticket`, { base: '/esc', pageId: 'x&evil=1' });
  assert.ok(recordUrl(sneaky, { table: 'incident', sysId: ID }).includes('?id=ticket&table='));
  // the origin is always the tab's own
  assert.ok(recordUrl(evil, { table: 'incident', sysId: ID }).startsWith(`${HOST}/`));
});

test('nothing is built from an invalid table or sys_id, or a page without an address', () => {
  for (const ref of [{ table: 'Incident', sysId: ID }, { table: 'a;b', sysId: ID }, { table: '../x', sysId: ID }, { table: 'incident', sysId: 'abc' }, { table: 'incident', sysId: `${ID}0` }, { table: '', sysId: ID }, {}]) {
    assert.equal(recordUrl(classic, ref), '', JSON.stringify(ref));
    assert.equal(recordUrl(portal(`${HOST}/sp?id=index`), ref), '', JSON.stringify(ref));
  }
  assert.equal(recordUrl({ href: 'not a url', surface: 'portal' }, { table: 'incident', sysId: ID }), '');
  assert.equal(recordUrl({ surface: 'portal' }, { table: 'incident', sysId: ID }), '');
});

test('a blank form always opens on the classic UI of the same instance', () => {
  const url = `${HOST}/nav_to.do?uri=${encodeURIComponent('kb_knowledge.do?sys_id=-1')}`;
  assert.equal(newRecordUrl(portal(`${HOST}/esc?id=index`), 'kb_knowledge'), url);
  assert.equal(newRecordUrl(classic, 'kb_knowledge'), url);
  assert.equal(newRecordUrl(classic, 'bad table'), '');
  assert.equal(newRecordUrl({ href: 'nope' }, 'incident'), '');
});

test('openUrl navigates the tab, but only within the instance', () => {
  const updates = [];
  globalThis.chrome = { tabs: { update: (tabId, props) => updates.push([tabId, props]) } };
  const page = portal(`${HOST}/esc?id=index`, { base: '/esc', pageId: 'index' });
  assert.equal(openUrl(page, `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`), true);
  assert.deepEqual(updates, [[7, { url: `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`, active: true }]], 'in front: a tab changed in the background would look like nothing happened (audit 9, S12)');
  for (const url of ['', 'https://evil.example/esc?id=ticket', 'http://dev12345.service-now.com/esc', 'https://dev12345.service-now.com.evil.example/', 'javascript:alert(1)', 'not a url']) {
    assert.equal(openUrl(page, url), false, url);
  }
  assert.equal(updates.length, 1);
});

test('openRecord and openNewRecord build the address and navigate; a vanished tab is not an error', async () => {
  const updates = [];
  const created = [];
  globalThis.chrome = { tabs: { update: (tabId, props) => updates.push([tabId, props.url]), create: async (props) => created.push(props.url) } };
  const page = portal(`${HOST}/csm?id=my_cases`, { base: '/csm', pageId: 'my_cases' });
  assert.equal(openRecord(page, { table: 'sn_customerservice_case', sysId: ID }), true);
  assert.equal(updates[0][1], `${HOST}/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=${ID}`);
  assert.equal(openRecord(page, { table: 'bad table', sysId: ID }), false);
  // a blank form is a classic page: from a portal tab it opens next to it and the portal tab is not replaced (audit 9, S3)
  assert.equal(openNewRecord(page, 'kb_knowledge'), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(updates.length, 1);
  assert.match(created[0], /\/nav_to\.do\?uri=/);
  // from the classic UI it opens in the same tab
  assert.equal(openNewRecord(classic, 'kb_knowledge'), true);
  assert.match(updates[1][1], /\/nav_to\.do\?uri=/);
  globalThis.chrome = { tabs: { update: () => { throw new Error('No tab with id'); } } };
  assert.equal(openRecord(page, { table: 'incident', sysId: ID }), false);
});

test('openInNewTab opens a new tab right after the ticket tab, never another instance, and leaves the ticket tab alone', async () => {
  const created = [];
  const updates = [];
  globalThis.chrome = {
    tabs: {
      get: async (tabId) => ({ id: tabId, index: 4, windowId: 2 }),
      create: async (props) => created.push(props),
      update: (tabId, props) => updates.push([tabId, props]),
    },
  };
  const page = { href: `${HOST}/incident.do?sys_id=${ID}`, surface: 'classic', tabId: 7 };
  assert.equal(openRecordTab(page, { table: 'incident', sysId: 'b'.repeat(32) }), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(created, [{ url: `${HOST}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${'b'.repeat(32)}`)}`, active: true, index: 5, openerTabId: 7, windowId: 2 }]);
  assert.equal(updates.length, 0, 'the ticket being worked on is not replaced');
  for (const url of ['', 'https://evil.example/x', 'javascript:alert(1)']) assert.equal(openInNewTab(page, url), false, url);
  assert.equal(openRecordTab(page, { table: 'bad table', sysId: ID }), false);
  // the tab position cannot be read: a plain new tab
  created.length = 0;
  globalThis.chrome.tabs.get = async () => {
    throw new Error('No tab');
  };
  assert.equal(openInNewTab(page, `${HOST}/x.do`), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(created, [{ url: `${HOST}/x.do`, active: true }]);
});
