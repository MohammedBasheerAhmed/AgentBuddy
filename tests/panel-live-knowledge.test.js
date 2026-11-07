import { mount, click, choose, type, settle, makeChrome, fakeAiFetch, fakeClipboard, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeAssist, KnowledgeInsights } from '../src/sidepanel/knowledgeScreen/index.js';
import { clearShared } from '../src/sidepanel/knowledgeScreen/shared.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// The Knowledge screen driven like a person would (round 3: Insights and AI Assist): search, find duplicates, page through more
// titles, compare a group's text in Insights, then draft the merged article in AI Assist; a long search can be stopped; a failing read
// says so in plain words. Reads are answered by a fake content script; the AI by a fake fetch, through the real useRun flow.

const ORIGIN = 'https://acme.service-now.com';
const page = { status: 'no-record', tabId: 7, href: `${ORIGIN}/home`, surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth Anglin' } };
const eff = (apiKey = 'sk-ant-test-0123456789', profiles = ['it', 'km']) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', profiles }, {}), apiKey, keyLocked: false });
const sys = (c) => c.repeat(32);
const article = (n, c, title = `Reset your VPN password ${n}`) => ({ sysId: sys(c), number: `KB000000${n}`, title, views: 10 * n, updated: '2026-10-01 10:00:00' });
const PAGE_ONE = { scanned: 2, total: 4, truncated: true, offset: 0, articles: [article(1, 'a'), article(2, 'b')], clusters: [], access: [] };
const PAGE_TWO = { scanned: 2, total: 4, truncated: false, offset: 2, articles: [article(3, 'c'), article(4, 'd', 'Install the printer driver')], clusters: [], access: [] };

function setup() {
  clearShared();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('# Reset your VPN password\n\n1. Open the portal.\n2. Choose Reset.');
  const copied = fakeClipboard();
  fake.onRead('kbScopes', (args) => (args.knowledgeBase ? { items: [{ id: 'c1', name: 'Network', count: 3 }], access: [] } : { items: [{ id: 'kb1', name: 'IT', count: 12 }], access: [] }));
  fake.onRead('kbDuplicates', (args) => (args.offset ? PAGE_TWO : PAGE_ONE));
  fake.onRead('kbArticleTexts', () => ({
    pairs: [{ a: 'KB0000001', b: 'KB0000002', containment: 0.8, jaccard: 0.5 }],
    articles: [
      { ...article(1, 'a'), text: 'Open the portal and choose Reset.' },
      { ...article(2, 'b'), text: 'Go to the portal, then Reset.' },
    ],
    access: [],
    people: [],
  }));
  fake.onRead('kbGapScopes', () => ({ categories: [{ value: 'network', name: 'Network', count: 40 }], total: 120, access: [] }));
  fake.onRead('kbGaps', () => ({ scanned: 0, total: 0, days: 60, withArticle: 0, link: { known: true }, clusters: [], access: [], truncated: false, note: '' }));
  fake.onRead('kbSearch', () => ({
    hits: [{ sysId: sys('a'), number: 'KB0000001', title: 'Reset your VPN password', knowledgeBase: 'IT', category: 'Network', excerpt: 'Open the VPN client and choose Forgot password.', viewCount: 40, updated: '2026-10-01', ageDays: 29, expiresInDays: null, score: 100, why: [] }],
    keywords: ['vpn', 'password'],
    more: false,
    access: [{ source: 'kb_knowledge', status: 'ok', note: '' }],
  }));
  return { fake, copied };
}

const openCard = async (ui, title) => click(ui.$$('.ab-wk-toggle').find((b) => b.textContent.includes(title)));

test('knowledge search for everyone: a result opens in the agent\'s own UI and "Copy link" copies the article\'s share address', async () => {
  const { fake, copied } = setup();
  const ui = await mount(<KnowledgeInsights page={page} eff={eff(undefined, ['it'])} active />);
  assert.ok(!/Duplicate articles/.test(ui.text()), 'no knowledge-manager tools without the profile');
  await type(ui.field('Search knowledge'), 'vpn password reset');
  await click(ui.button('Search'));
  assert.deepEqual(fake.readsOf('kbSearch'), [{ query: 'vpn password reset' }]);
  assert.match(ui.text(), /KB0000001 Reset your VPN password/);
  assert.match(ui.text(), /Updated 4 weeks ago/);
  const link = ui.$('a.ab-kbx-hit-title');
  // (audit 6, 2026-11-07) an article opens at the article reader, by its number, and "Copy link" copies the very same address
  assert.equal(link.getAttribute('href'), `${ORIGIN}/kb_view.do?sysparm_article=KB0000001`);
  await click(ui.button('Copy link'));
  assert.deepEqual(copied, [link.getAttribute('href')]);
  assert.ok(ui.hasButton('Link copied'));
  await ui.unmount();
});

const ticketPage = (sysId, number) => ({ ...page, status: 'record', href: `${ORIGIN}/incident.do?sys_id=${sysId}`, record: { table: 'incident', sysId, number, kind: 'incident' } });
const TITLES = { [sys('1')]: 'VPN keeps disconnecting', [sys('2')]: 'Printer jam on floor 2' };

test('with a ticket open the screen starts with its articles: the knowledge search on its title, once per record, reads only', async () => {
  const { fake, copied } = setup();
  fake.onRead('header', (args) => ({ number: args.sysId === sys('1') ? 'INC0010001' : 'INC0010002', short_description: TITLES[args.sysId] || '', state: 'New', priority: '3 - Moderate' }));
  const ui = await mount(<KnowledgeInsights page={ticketPage(sys('1'), 'INC0010001')} eff={eff(undefined, ['it'])} active />);
  assert.deepEqual(fake.readsOf('kbSearch'), [{ query: 'VPN keeps disconnecting' }], 'the search the screen already has, on the title');
  assert.match(ui.text(), /Articles for INC0010001 KB0000001 Reset your VPN password IT · Network/);
  assert.equal(ui.field('Search knowledge').value, '', 'the search box stays for other words');
  // The panel polls the page: the same record again is not searched again.
  await ui.rerender(<KnowledgeInsights page={{ ...ticketPage(sys('1'), 'INC0010001') }} eff={eff(undefined, ['it'])} active />);
  assert.equal(fake.readsOf('kbSearch').length, 1);
  await click(ui.button('Copy link'));
  assert.deepEqual(copied, [`${ORIGIN}/kb_view.do?sysparm_article=KB0000001`]);
  // Another record: its own title is searched; an answer still on its way for the first record never shows under the second.
  const held = deferred();
  fake.onRead('kbSearch', (args) => (args.query === TITLES[sys('2')] ? held.promise : { hits: [], more: false, access: [] }));
  await ui.rerender(<KnowledgeInsights page={ticketPage(sys('2'), 'INC0010002')} eff={eff(undefined, ['it'])} active />);
  assert.deepEqual(fake.readsOf('kbSearch').map((a) => a.query), ['VPN keeps disconnecting', 'Printer jam on floor 2']);
  assert.match(ui.text(), /Articles for INC0010002 Searching…/);
  assert.ok(!/Reset your VPN password/.test(ui.text()), 'the first ticket\'s articles are gone');
  await during(() => held.resolve({ hits: [{ sysId: sys('c'), number: 'KB0000003', title: 'Clear a printer jam', knowledgeBase: 'IT', excerpt: '', access: [] }], more: false, access: [] }));
  assert.match(ui.text(), /Articles for INC0010002 KB0000003 Clear a printer jam/);
  assert.equal(globalThis.fetch.calls.length, 0, 'no AI');
  await ui.unmount();
});

test('the articles for the ticket: nothing is read while the screen is not on show; a title that may not be read is said, not searched', async () => {
  const { fake } = setup();
  fake.onRead('header', () => ({ number: 'HRC0001001', short_description: '', state: 'Open', priority: '' }));
  const ui = await mount(<KnowledgeInsights page={ticketPage(sys('3'), 'HRC0001001')} eff={eff(undefined, ['it'])} active={false} />);
  assert.equal(fake.readsOf('header').length + fake.readsOf('kbSearch').length, 0);
  await ui.rerender(<KnowledgeInsights page={ticketPage(sys('3'), 'HRC0001001')} eff={eff(undefined, ['it'])} active />);
  assert.deepEqual(fake.readsOf('header'), [{ table: 'incident', sysId: sys('3'), allowSensitive: false }]);
  assert.equal(fake.readsOf('kbSearch').length, 0);
  assert.match(ui.text(), /This ticket's title cannot be read here, so search with your own words below\./);
  await ui.unmount();
});

test('the duplicate finder pages through more titles and compares them all; the compared group is drafted in AI Assist', async () => {
  const { fake } = setup();
  const insights = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await openCard(insights, 'Duplicate articles');
  await choose(insights.field('Knowledge base'), 'kb1');
  await click(insights.button('Find duplicates'));
  // (Wave 6: the line names the scope, and the button is "Compare the next {n}"; the wording is tested in tests/km-panel.test.js.)
  assert.match(insights.text(), /Compared 2 of 4 articles in IT\. 1 group read alike\./);
  await click(insights.button('Compare the next 2'));
  assert.deepEqual(fake.readsOf('kbDuplicates').map((a) => a.offset), [0, 2]);
  assert.equal(fake.readsOf('kbDuplicates')[1].total, 4, 'the second page is told the count of the first: the scope is counted once');
  assert.match(insights.text(), /Compared 4 of 4 articles in IT\. 1 group read alike\./, 'the second page is compared with the first');
  assert.match(insights.text(), /3 articles that read alike/);
  await click(insights.button('Compare'));
  await click(insights.button('Compare their text'));
  assert.match(insights.text(), /80% of the shorter text also appears in the other/);
  assert.match(insights.text(), /switch to AI Assist/);
  assert.ok(!insights.$('.ab-ai-badge'), 'no AI mark in Insights');

  const assist = await mount(<KnowledgeAssist page={page} eff={eff()} active />);
  assert.match(assist.text(), /KB0000001 Reset your VPN password 1/);
  await click(assist.button(/Draft a merged article/));
  await settle(6);
  assert.match(assist.text(), /Open the portal\./, 'the draft is on screen');
  await insights.unmount();
  await assist.unmount();
});

test('a category chosen while "Find duplicates" is still reading: the late answer (for all categories) is not shown as the category\'s', async () => {
  const { fake } = setup();
  const held = deferred();
  fake.onRead('kbDuplicates', () => held.promise);
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await openCard(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /Comparing titles/);
  await choose(ui.field('Category (optional)'), 'c1');
  await during(() => held.resolve(PAGE_ONE));
  assert.ok(!/Compared 2 of 4/.test(ui.text()), 'the groups found for all categories are not shown under "Network"');
  assert.ok(!ui.hasButton('Compare'));
  await ui.unmount();
});

test('a long duplicate search can be stopped; its answer is then dropped', async () => {
  const { fake } = setup();
  const held = deferred();
  fake.onRead('kbDuplicates', () => held.promise);
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await openCard(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  await click(ui.button('Stop'));
  assert.ok(!/Comparing titles/.test(ui.text()));
  assert.equal(ui.button('Find duplicates').disabled, false, 'the person can search again at once');
  await during(() => held.resolve(PAGE_ONE));
  assert.ok(!/Compared 2/.test(ui.text()));
  await ui.unmount();
});

test('the gap radar: scope choices with counts, choices locked while it reads, and a search that can be stopped', async () => {
  const { fake } = setup();
  const held = deferred();
  fake.onRead('kbGaps', () => held.promise);
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  assert.equal(fake.readsOf('kbGapScopes').length, 0, 'nothing is read while the radar is folded');
  await openCard(ui, 'Articles to write');
  assert.equal(fake.readsOf('kbGapScopes').length, 1);
  const scope = ui.field('Whose tickets');
  assert.deepEqual(scope.querySelectorAll('option').map((o) => o.textContent), ['Everything I can see (120)', 'My groups', 'Category: Network (40)']);
  await choose(scope, 'cat:network');
  await click(ui.button('Find topics'));
  assert.deepEqual(fake.readsOf('kbGaps')[0], { days: 60, tables: ['incident'], scope: 'category', category: 'network' });
  assert.equal(ui.field('Resolved in the last').disabled, true);
  await click(ui.button('Stop'));
  assert.equal(ui.field('Resolved in the last').disabled, false);
  await during(() => held.resolve({ scanned: 5, total: 5, days: 60, withArticle: 0, link: { known: true }, clusters: [], access: [], truncated: false, note: '' }));
  assert.ok(!/Looked at 5/.test(ui.text()));
  await ui.unmount();
});

test('the gap radar says how many of how many tickets it looked at, and hands its topics to AI Assist', async () => {
  const { fake } = setup();
  const topic = { id: 'g1', label: 'VPN + disconnect', count: 3, withFix: 2, category: 'Network', ci: 'VPN Gateway EU', examples: [{ table: 'incident', sysId: sys('f'), number: 'INC0000001', title: 'VPN drops' }], keywords: ['VPN', 'disconnect'] };
  fake.onRead('kbGaps', () => ({ scanned: 500, total: 12400, days: 60, withArticle: 37, link: { known: true }, clusters: [topic], access: [], truncated: true, note: '', scope: { kind: 'mine', groups: 1 } }));
  const insights = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await openCard(insights, 'Articles to write');
  await choose(insights.field('Whose tickets'), 'mine');
  await click(insights.button('Find topics'));
  assert.match(insights.text(), /Looked at 500 of 12,400 tickets resolved in the last 60 days in your group\. 37 already had an article\./);
  assert.ok(insights.hasButton('Export topics (CSV)'));
  const assist = await mount(<KnowledgeAssist page={page} eff={eff()} active />);
  assert.match(assist.text(), /VPN \+ disconnect/);
  await click(assist.button(/Draft an article outline/));
  await settle(6);
  assert.match(assist.text(), /Open the portal\./);
  await insights.unmount();
  await assist.unmount();
});

test('another instance in the tab: search results, duplicate groups and topics of the first one are gone, and so are its late answers', async () => {
  const { fake } = setup();
  const topic = { id: 'g1', label: 'VPN + disconnect', count: 3, withFix: 2, category: 'Network', ci: '', examples: [{ table: 'incident', sysId: sys('f'), number: 'INC0000001', title: 'VPN drops' }], keywords: ['VPN'] };
  fake.onRead('kbGaps', () => ({ scanned: 3, total: 3, days: 60, withArticle: 0, link: { known: true }, clusters: [topic], access: [], truncated: false, note: '' }));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await type(ui.field('Search knowledge'), 'vpn');
  await click(ui.button('Search'));
  await openCard(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  await openCard(ui, 'Articles to write');
  await click(ui.button('Find topics'));
  let text = ui.text();
  assert.match(text, /KB0000001 Reset your VPN password IT · Network/);
  assert.match(text, /Compared 2 of 4 articles/);
  assert.match(text, /Looked at 3 tickets/);
  assert.match(text, /Knowledge search 1 for "vpn"/);
  // A search on its way when the tab moves on is dropped too.
  const held = deferred();
  fake.onRead('kbSearch', () => held.promise);
  await click(ui.button('Search'));
  const other = { ...page, href: 'https://other-company.service-now.com/home' };
  await ui.rerender(<KnowledgeInsights page={other} eff={eff()} active />);
  await during(() => held.resolve({ hits: [{ sysId: sys('e'), number: 'KB0000009', title: 'Late answer', excerpt: '', access: [] }], more: false, access: [] }));
  text = ui.text();
  for (const old of ['KB0000001', 'KB0000009', 'Compared 2 of 4', 'Looked at 3', 'INC0000001', '1 for "vpn"']) assert.ok(!text.includes(old), `not on the other instance: ${old}`);
  assert.equal(ui.field('Search knowledge').value, '', 'the search starts over');
  assert.equal(ui.field('Knowledge base').value, '', 'no knowledge base of the first instance is chosen');
  assert.equal(fake.readsOf('kbScopes').filter((a) => !a.knowledgeBase).length, 2, 'the other instance\'s knowledge bases are listed');
  assert.equal(ui.$$('a').filter((a) => (a.getAttribute('href') || '').includes(sys('a'))).length, 0, 'no link to an article of the first instance');
  await ui.unmount();
});

test('a read that fails says so in plain words and offers to try again', async () => {
  const { fake } = setup();
  let calls = 0;
  fake.onRead('kbDuplicates', () => {
    calls += 1;
    if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return PAGE_ONE;
  });
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await openCard(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), 'kb1');
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /lost touch with this page/);
  assert.ok(!/Receiving end/.test(ui.text()));
  await click(ui.button('Try again'));
  assert.match(ui.text(), /Compared 2 of 4 articles/);
  await ui.unmount();
});
