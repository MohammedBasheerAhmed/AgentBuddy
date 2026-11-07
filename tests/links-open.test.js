// Where an address opens (audit 9, S2/S3/S12, and audit 6 I7): a "look at this" link opens in a NEW tab next to the ticket; a "go work
// on this" link in the tab the panel is attached to; and a link that would replace a Workspace or portal tab with a classic page
// opens in a new tab instead. Plus: nothing but src/lib/snLinks.js builds an address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordLink from '../src/sidepanel/RecordLink.jsx';
import { ItemLink } from '../src/sidepanel/ticket/cards/bits.jsx';
import { newRecordOpensInNewTab, newRecordUrl, openInNewTab, openNewRecord, openRecord, openUrl, openWork, recordUrl } from '../src/sidepanel/openRecord.js';
import { listUrl, openInPageTab, openList, openTicket } from '../src/sidepanel/reports/drill.js';
import { fullListUrl } from '../src/mywork/links.js';
import { emailFormUrl } from '../src/compose/emailRecommend.js';
import { emailFormLink, listLink } from '../src/lib/snLinks.js';

const HOST = 'https://x.service-now.com';
const ID = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const classic = { href: `${HOST}/incident.do?sys_id=${ID}`, surface: 'classic', tabId: 7, windowId: 3 };
const workspace = { href: `${HOST}/now/sow/record/incident/${ID}`, surface: 'workspace', tabId: 7, windowId: 3 };
const workspaceHome = { href: `${HOST}/now/sow/home`, surface: 'workspace', tabId: 7, windowId: 3 };
const portal = { href: `${HOST}/esc?id=ticket&table=incident&sys_id=${ID}`, surface: 'portal', portal: { base: '/esc', pageId: 'ticket' }, tabId: 7, windowId: 3 };

/** A fake browser: every tab that was changed and every tab that was created, in order. */
function fakeBrowser() {
  const calls = [];
  globalThis.chrome = {
    tabs: {
      get: async (id) => ({ id, index: 4, windowId: 3 }),
      update: (id, props) => calls.push({ how: 'update', id, ...props }),
      create: async (props) => calls.push({ how: 'create', ...props }),
    },
    windows: { update: (id, props) => calls.push({ how: 'window', id, ...props }) },
  };
  return calls;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const howOf = (calls) => calls.map((c) => c.how);
const click = (element) => element.props.onClick({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() {} });

// ---- The openers -------------------------------------------------------------------------------------------------------------------------

test('"go work on this" opens in the tab the panel is attached to, in front, when it stays in the agent\'s UI', async () => {
  const calls = fakeBrowser();
  assert.equal(openRecord(classic, { table: 'incident', sysId: ID2 }), true);
  assert.equal(openRecord(workspace, { table: 'sc_req_item', sysId: ID2 }), true);
  assert.equal(openRecord(portal, { table: 'incident', sysId: ID2 }), true);
  await settle();
  assert.deepEqual(howOf(calls), ['update', 'update', 'update']);
  assert.deepEqual(calls.map((c) => c.url), [recordUrl(classic, { table: 'incident', sysId: ID2 }), `${HOST}/now/sow/record/sc_req_item/${ID2}`, `${HOST}/esc?id=ticket&table=incident&sys_id=${ID2}`]);
  assert.ok(calls.every((c) => c.id === 7 && c.active === true));
});

test('a Workspace or portal tab is never replaced by a classic page: a ticket from a Workspace home, a blank form, a list, an article', async () => {
  const calls = fakeBrowser();
  assert.equal(openRecord(workspaceHome, { table: 'incident', sysId: ID2 }), true, 'no record route to stay on');
  assert.equal(openRecord(workspace, { table: 'sn_hr_core_case', sysId: ID2 }), true, 'a table the Workspace may not show');
  assert.equal(openNewRecord(workspace, 'incident'), true);
  assert.equal(openNewRecord(portal, 'kb_knowledge'), true);
  assert.equal(openList(workspace, 'incident', 'active=true'), true);
  assert.equal(openList(portal, 'incident', 'active=true'), true);
  assert.equal(openWork(workspace, `${HOST}/kb_view.do?sysparm_article=KB0010001`), true);
  await settle();
  assert.deepEqual(howOf(calls), Array(7).fill('create'), 'every one opened a new tab');
  assert.ok(calls.every((c) => c.active === true && c.index === 5 && c.openerTabId === 7 && c.windowId === 3), 'next to the tab, in front');
  assert.ok(!calls.some((c) => c.how === 'update'), 'the Workspace and portal tabs stay as they are');
});

test('a list, a blank form and an article from the classic UI keep the work in the same tab', async () => {
  const calls = fakeBrowser();
  assert.equal(openList(classic, 'incident', 'active=true'), true);
  assert.equal(openNewRecord(classic, 'incident'), true);
  assert.equal(openTicket(classic, { table: 'incident', sysId: ID2 }), true);
  await settle();
  assert.deepEqual(howOf(calls), ['update', 'update', 'update']);
});

test('the full page brings the ServiceNow tab forward; a Workspace tab is left alone and the list opens next to it', async () => {
  const calls = fakeBrowser();
  assert.equal(openList(classic, 'incident', 'a=1', { focus: true }), true);
  assert.equal(calls[0].how, 'update');
  assert.equal(calls[0].active, true);
  assert.deepEqual(calls[1], { how: 'window', id: 3, focused: true });
  calls.length = 0;
  assert.equal(openList(workspace, 'incident', 'a=1', { focus: true }), true);
  assert.equal(openTicket(workspaceHome, { table: 'incident', sysId: ID2 }, { focus: true }), true);
  await settle();
  assert.equal(calls.filter((c) => c.how === 'create').length, 2, 'a new tab for each, in front');
  assert.ok(calls.filter((c) => c.how === 'create').every((c) => c.active === true && c.openerTabId === 7));
  assert.equal(calls.filter((c) => c.how === 'window').length, 2, 'and the window is brought forward');
  assert.ok(!calls.some((c) => c.how === 'update'), 'the Workspace tab itself is not replaced');
});

test('nothing outside the instance of the page is ever opened, in any tab', async () => {
  const calls = fakeBrowser();
  for (const url of ['https://evil.example/x', `${HOST}.evil.example/x`, 'http://x.service-now.com/x', 'javascript:alert(1)', '', 'not a url']) {
    assert.equal(openUrl(workspace, url), false, url);
    assert.equal(openInNewTab(workspace, url), false, url);
    assert.equal(openInPageTab(workspace, url), false, url);
    assert.equal(openWork(workspace, url), false, url);
  }
  await settle();
  assert.equal(calls.length, 0);
});

test('a tab that went away is not an error, in either way of opening', async () => {
  globalThis.chrome = { tabs: { update: () => { throw new Error('No tab with id'); }, create: () => { throw new Error('No window'); } } };
  assert.equal(openRecord(classic, { table: 'incident', sysId: ID2 }), false);
  assert.equal(openList(classic, 'incident', 'a=1'), false);
  // (a new tab is started and answers later: a window that is gone is swallowed, never thrown)
  assert.doesNotThrow(() => openNewRecord(workspace, 'incident'));
});

test('where a blank form opens can be said in words: a new tab from a Workspace or portal, this tab elsewhere', () => {
  assert.equal(newRecordOpensInNewTab(classic, 'incident'), false);
  assert.equal(newRecordOpensInNewTab(workspace, 'incident'), true);
  assert.equal(newRecordOpensInNewTab(portal, 'incident'), true);
  assert.equal(newRecordOpensInNewTab(workspace, 'bad table'), false, 'nothing to open');
  assert.equal(newRecordUrl(workspace, 'incident'), `${HOST}/nav_to.do?uri=${encodeURIComponent('incident.do?sys_id=-1')}`);
});

// ---- RecordLink ----------------------------------------------------------------------------------------------------------------------------

test('RecordLink: a plain click opens a new tab by default; sameTab is the explicit worklist case', async () => {
  const calls = fakeBrowser();
  const item = { table: 'incident', sysId: ID2 };
  click(RecordLink({ page: classic, item, children: 'INC1' }));
  click(RecordLink({ page: classic, item, sameTab: true, children: 'INC1' }));
  click(RecordLink({ page: classic, item, newTab: true, children: 'INC1' }));
  await settle();
  assert.deepEqual(howOf(calls).sort(), ['create', 'create', 'update'], 'two new tabs and one replaced tab');
  assert.deepEqual(calls.filter((c) => c.how === 'update').map((c) => c.url), [recordUrl(classic, item)], 'only the sameTab one');
  // a worklist link that would replace a Workspace tab with a classic page opens next to it
  calls.length = 0;
  click(RecordLink({ page: workspaceHome, url: listLink(workspaceHome, 'incident', 'active=true'), sameTab: true, children: 'list' }));
  await settle();
  assert.deepEqual(howOf(calls), ['create']);
  // onOpen still replaces the plain-click action (the My work rows)
  calls.length = 0;
  let opened = 0;
  click(RecordLink({ page: classic, item, onOpen: () => { opened += 1; }, children: 'INC1' }));
  await settle();
  assert.equal(opened, 1);
  assert.equal(calls.length, 0);
});

test('RecordLink: Ctrl+click and the other modified clicks are left to the browser', async () => {
  const calls = fakeBrowser();
  const link = RecordLink({ page: classic, item: { table: 'incident', sysId: ID2 }, children: 'INC1' });
  let prevented = false;
  link.props.onClick({ button: 0, ctrlKey: true, preventDefault() { prevented = true; } });
  link.props.onClick({ button: 1, preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, false);
  assert.equal(calls.length, 0);
});

test('RecordLink: the hint says where it opens', () => {
  const item = { table: 'incident', sysId: ID2 };
  assert.match(renderToStaticMarkup(<RecordLink page={classic} item={item}>x</RecordLink>), /new tab next to this ticket/);
  assert.match(renderToStaticMarkup(<RecordLink page={classic} item={item} sameTab>x</RecordLink>), /Opens in this tab/);
  // a same-tab link that would leave a Workspace opens in a new tab, and says so
  const url = listLink(workspaceHome, 'incident', 'a=1');
  assert.match(renderToStaticMarkup(<RecordLink page={workspaceHome} url={url} sameTab>x</RecordLink>), /new tab next to this ticket/);
  assert.match(renderToStaticMarkup(<RecordLink page={classic} url={listLink(classic, 'incident', 'a=1')} sameTab>x</RecordLink>), /Opens in this tab/);
  assert.match(renderToStaticMarkup(<RecordLink page={classic} item={item} sameTab title="Mine">x</RecordLink>), /title="Mine"/);
});

test('RecordLink: an article opens at the reader by its number from every surface; the Duplicates screen asks for the form', () => {
  const article = { table: 'kb_knowledge', sysId: ID2, number: 'KB0010001' };
  for (const page of [classic, workspace, workspaceHome, portal]) {
    const html = renderToStaticMarkup(<RecordLink page={page} item={article}>KB</RecordLink>);
    assert.ok(html.includes(`href="${HOST}/kb_view.do?sysparm_article=KB0010001"`), html);
    const form = renderToStaticMarkup(<RecordLink page={page} item={article} intent="author">KB</RecordLink>);
    assert.ok(form.includes(`href="${HOST}/nav_to.do?uri=kb_knowledge.do%3Fsys_id%3D${ID2}"`), form);
  }
  // a Ticket-screen card row passes the whole hit: the number is read from it
  const row = renderToStaticMarkup(<ItemLink page={workspace} item={{ ...article, short_description: 'How to reset' }} />);
  assert.ok(row.includes(`href="${HOST}/kb_view.do?sysparm_article=KB0010001"`), row);
  // a link that cannot be built is plain text
  assert.ok(!renderToStaticMarkup(<RecordLink page={classic} item={{ table: 'kb_knowledge' }}>KB</RecordLink>).includes('<a '));
});

// ---- The thin wrappers answer as before ------------------------------------------------------------------------------------------------------

test('the wrappers keep their names and give the shared builders\' answers', () => {
  assert.equal(listUrl(classic, 'incident', 'a=1'), listLink(classic, 'incident', 'a=1'));
  assert.equal(fullListUrl(classic, 'incident', 'a=1'), listLink(classic, 'incident', 'a=1'));
  assert.equal(listUrl(classic, 'incident', ''), listLink(classic, 'incident', ''), 'a list with no filter is a list');
  assert.equal(fullListUrl(classic, 'incident', ''), '', 'My work always filters');
  assert.equal(fullListUrl(classic, 'incident', 'a<script>'), '', 'My work writes only column names, operators and sys_ids');
  assert.equal(listUrl(classic, 'incident', 'opened_at>=2026-11-01 00:00:00'), listLink(classic, 'incident', 'opened_at>=2026-11-01 00:00:00'), 'the reports\' filters are free');
  assert.equal(emailFormUrl(classic.href, { table: 'incident', sysId: ID }), emailFormLink(classic, { table: 'incident', sysId: ID }));
  assert.equal(emailFormUrl('http://x.service-now.com/', { table: 'incident', sysId: ID }), '');
  assert.equal(recordUrl(classic, { table: 'incident', sysId: ID }), `${HOST}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${ID}`)}`);
});

// ---- Nothing but snLinks.js builds an address -------------------------------------------------------------------------------------------------

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const SRC = path.resolve('src');
const sources = walk(SRC).filter((f) => /\.(js|jsx)$/.test(f) && !f.includes(`${path.sep}i18n${path.sep}`));
// the code of a file without its comment lines (an address in a comment explains it; it builds nothing)
const codeOf = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('only src/lib/snLinks.js builds a ServiceNow address (a record, an article, a list, a blank form, the email form)', () => {
  assert.ok(sources.length > 100, 'the scan found the sources');
  const builders = [/nav_to\.do\?uri=\$\{/, /kb_view\.do\?/, /email_client\.do\?sysparm_table=\$/, /\/record\/\$\{/, /\?id=\$\{/, /_list\.do\?sysparm_query=\$\{/, /\.do\?sys_id=-1/];
  const offenders = [];
  for (const file of sources) {
    if (file.endsWith(path.join('lib', 'snLinks.js'))) continue;
    const code = codeOf(file);
    for (const re of builders) if (re.test(code)) offenders.push(`${path.relative(SRC, file)} ${re}`);
  }
  assert.deepEqual(offenders, []);
});

test('no function named articleShareUrl is left: there is one address for an article', () => {
  const left = sources.filter((f) => /articleShareUrl/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f));
  assert.deepEqual(left, []);
  assert.equal(fs.existsSync(path.join(SRC, 'insights', 'links.js')), false);
});

test('the screens that open an article pass its number, and the "look at" screens use the default new tab', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  assert.match(read('sidepanel/knowledgeScreen/SearchCard.jsx'), /table: 'kb_knowledge', sysId: hit\.sysId, number: hit\.number/);
  assert.match(read('sidepanel/knowledge/DuplicatesPanel.jsx'), /table: 'kb_knowledge', sysId: a\.sysId, number: a\.number \}\} intent="author"/);
  for (const rel of ['sidepanel/knowledgeScreen/SearchCard.jsx', 'sidepanel/knowledge/DuplicatesPanel.jsx', 'sidepanel/knowledge/GapsPanel.jsx', 'sidepanel/ticket/cards/bits.jsx']) {
    assert.ok(!/<RecordLink[^>]*sameTab/.test(read(rel)), `${rel}: a "look at this" link does not ask for the same tab`);
  }
  // the two places an article's address is copied use the one builder
  assert.match(read('sidepanel/knowledgeScreen/SearchCard.jsx'), /customerArticleLink\(page, hit\)/);
  assert.match(read('sidepanel/ticket/cards/KnowledgeCard.jsx'), /customerArticleLink\(page, h\)/);
});
