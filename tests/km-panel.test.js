import { mount, click, choose, settle, makeChrome, fakeAiFetch, deferred, during, focused } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import knowledgeOps from '../src/content/ops/knowledge.js';
import { KnowledgeAssist, KnowledgeInsights } from '../src/sidepanel/knowledgeScreen/index.js';
import { clearShared } from '../src/sidepanel/knowledgeScreen/shared.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { MSG } from '../src/lib/messages.js';
import { CAT_MAIL, CAT_VPN, KB_IT, answerFrom, kbBase, kbDeps } from './km-fixtures.js';

// Wave 6, knowledge manager: the Duplicates and Gaps tools on a knowledge base of a real size, driven like a person would, with the
// real operations behind a fake content script. What the line says, when it may say "No duplicates found.", how the scan goes on, what
// a group says about itself, and that the group being compared survives the next 300.

const ORIGIN = 'https://acme.service-now.com';
const page = { status: 'no-record', tabId: 7, href: `${ORIGIN}/home`, surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth Anglin', userId: 'u1' } };
const eff = () => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', profiles: ['it', 'km'] }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });
const DUP = 'Reset your VPN password';

function setup(rows, behaviour) {
  clearShared();
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('# Reset your VPN password\n\n1. Open the portal.');
  const deps = kbDeps(rows, behaviour);
  answerFrom(fake, deps);
  fake.onRead('kbArticleTexts', () => ({
    pairs: [{ a: 'KB1000650', b: 'KB1000350', containment: 0.8, jaccard: 0.5 }],
    articles: [
      { sysId: rows[650].sys_id.value, number: 'KB1000650', title: DUP, text: 'Open the portal and choose Reset.', meta: '', knowledgeBase: 'IT', category: 'VPN' },
      { sysId: rows[350].sys_id.value, number: 'KB1000350', title: DUP, text: 'Go to the portal, then Reset.', meta: '', knowledgeBase: 'IT', category: 'VPN' },
    ],
    access: [],
    people: [],
  }));
  return { fake, deps };
}

const open = async (ui, title) => click(ui.$$('.ab-wk-toggle').find((b) => b.textContent.includes(title)));
const startScan = async (ui, category) => {
  await open(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), KB_IT);
  if (category) await choose(ui.field('Category (optional)'), category);
  await click(ui.button('Find duplicates'));
};
const coverage = (ui) => ui.$('[data-coverage="duplicates"]').textContent.replace(/\s+/g, ' ').trim();
const countsOf = (deps) => deps.calls.filter((c) => c.options.limit === 100000).length;

test('a base of 700: each step says how many of how many, "No duplicates found." comes only at the end, and the scope is counted once', async () => {
  const { fake, deps } = setup(kbBase(700, { titles: { 650: DUP, 350: DUP, 50: DUP } }));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  // page 1 holds the newest 300: one of the three look-alikes; nothing groups yet
  assert.equal(coverage(ui), 'Compared 300 of 700 articles in IT Knowledge Base. No duplicates among the 300 compared.');
  assert.ok(!/No duplicates found/.test(ui.text()), 'not said while 400 articles have not been looked at');
  assert.ok(ui.hasButton('Compare the next 300'));
  assert.ok(ui.button('Compare the next 300').className.includes('ab-btn-quiet'), 'a quiet button, not a primary one');
  assert.equal(ui.button('Find duplicates').className.includes('ab-btn-primary'), false);

  await click(ui.button('Compare the next 300'));
  assert.equal(coverage(ui), 'Compared 600 of 700 articles in IT Knowledge Base. 1 group read alike.', 'two of the three look-alikes meet now');
  assert.equal(focused(), ui.$('[data-coverage="duplicates"]'), 'the button that was pressed is gone: focus lands on the line that says what is compared now');
  assert.ok(ui.hasButton('Compare the next 100'), 'the last window is the 100 that remain');
  assert.match(ui.text(), /2 articles with the same title/);

  await click(ui.button('Compare the next 100'));
  assert.equal(coverage(ui), 'Compared 700 of 700 articles in IT Knowledge Base. 1 group read alike.');
  assert.match(ui.text(), /3 articles with the same title/, 'the groups of earlier pages stay, and grow with the later ones');
  assert.ok(!ui.hasButton(/^Compare the next/), 'nothing left to compare');

  assert.deepEqual(fake.readsOf('kbDuplicates').map((a) => a.offset), [0, 300, 600]);
  assert.deepEqual(fake.readsOf('kbDuplicates').map((a) => a.total), [undefined, 700, 700], 'the later pages are told the count of the first');
  assert.equal(countsOf(deps), 1, 'ONE count read for the whole scan');
  assert.ok(fake.sent.every((s) => s.message.type === MSG.READ), 'reads only');
  assert.equal(globalThis.fetch.calls.length, 0, 'no AI');
  await ui.unmount();
});

test('a complete scan with nothing alike says "No duplicates found."', async () => {
  const { fake } = setup(kbBase(40));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  assert.equal(coverage(ui), 'Compared 40 of 40 articles in IT Knowledge Base. No duplicates found.');
  assert.ok(!ui.hasButton(/^Compare the next/));
  assert.equal(fake.readsOf('kbDuplicates').length, 1);
  await ui.unmount();
});

test('the instance counts more than this person can read: the shortfall is said, and the scan is never "clean"', async () => {
  const { deps } = setup(kbBase(700));
  // a row rule hides every third article from this person; the count still says 700
  const inner = deps.queryTable;
  deps.queryTable = async (table, query, fields, options) => {
    const out = await inner(table, query, fields, options);
    return options.limit === 100000 ? out : out.filter((_, i) => i % 3 !== 2);
  };
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  await click(ui.button('Compare the next 300'));
  await click(ui.button('Compare the next 100'));
  assert.equal(coverage(ui), 'Compared 467 of 700 articles in IT Knowledge Base. No duplicates among the 467 compared.');
  assert.match(ui.text(), /The other 233 could not be read; your role may hide them\./);
  assert.ok(!/No duplicates found/.test(ui.text()));
  assert.ok(!ui.hasButton(/^Compare the next/));
  await ui.unmount();
});

test('the total cannot be counted: "of an unknown number", the scan goes on while pages are full, and it is never called complete', async () => {
  const { deps } = setup(kbBase(340));
  deps.countRecords = async () => {
    throw Object.assign(new Error('refused'), { code: 'ACCESS_DENIED' });
  };
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  assert.equal(coverage(ui), 'Compared 300 of an unknown number of articles in IT Knowledge Base. No duplicates among the 300 compared.');
  assert.ok(ui.hasButton('Compare the next 300'), 'a full page: more may follow');
  await click(ui.button('Compare the next 300'));
  assert.equal(coverage(ui), 'Compared 340 of an unknown number of articles in IT Knowledge Base. No duplicates among the 340 compared.');
  assert.ok(!ui.hasButton(/^Compare the next/), 'a short page: the end of what was returned');
  await ui.unmount();
});

test('one scan stops at 1,500 and says so; a category then covers what is left', async () => {
  const { fake } = setup(kbBase(1700, { titles: { 1650: DUP, 3: DUP } }));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  for (let i = 0; i < 4; i += 1) {
    await click(ui.button(/^Compare the next/));
  }
  assert.equal(fake.readsOf('kbDuplicates').length, 5);
  assert.equal(coverage(ui), 'Compared 1,500 of 1,700 articles in IT Knowledge Base. No duplicates among the 1,500 compared.', 'the other look-alike is among the 200 oldest, which were not compared');
  assert.match(ui.text(), /Only the 1,500 most recently changed articles were compared \(of 1,700\)\. Choose a category to narrow it\./);
  assert.ok(!ui.hasButton(/^Compare the next/), 'the scan cannot go further');
  assert.ok(!/No duplicates found/.test(ui.text()));

  // the category: its own scan, its own coverage; what was found for the whole base is gone (it was for the whole base)
  await choose(ui.field('Category (optional)'), CAT_MAIL);
  assert.ok(!/Compared 1,500/.test(ui.text()));
  await click(ui.button('Find duplicates'));
  assert.deepEqual(fake.readsOf('kbDuplicates').slice(-1)[0], { knowledgeBase: KB_IT, category: CAT_MAIL, offset: 0 });
  assert.match(coverage(ui), /^Compared 300 of 567 articles in IT Knowledge Base, category Email\./);
  await click(ui.button('Compare the next 267'));
  assert.match(coverage(ui), /^Compared 567 of 567 articles in IT Knowledge Base, category Email\./);
  await ui.unmount();
});

test('a category too big for one scan says so, and does not tell the person to choose a category again', async () => {
  const { fake } = setup(kbBase(5000, { titles: {} }));
  fake.onRead('kbScopes', (args) => ({
    items: args.knowledgeBase ? [{ id: CAT_VPN, name: 'VPN', count: 4200 }] : [{ id: KB_IT, name: 'IT Knowledge Base', count: 5000 }],
    access: [],
  }));
  // a category of 4,200: the fake answers its pages from the base, but the count says what the category would hold
  fake.onRead('kbDuplicates', async (args) => {
    const rows = kbBase(5000).filter((r) => r.kb_category.value === CAT_VPN);
    const start = args.offset || 0;
    const slice = rows.slice(start, start + 300);
    const articles = slice.map((r) => ({ sysId: r.sys_id.value, number: r.number.value, title: r.short_description.value, views: 1, updated: '2026-09-01', category: 'VPN' }));
    const reached = start + 300;
    return { scanned: articles.length, total: 4200, truncated: reached < 4200, next: reached < 4200 && reached <= 1200 ? reached : null, offset: start, articles, access: [] };
  });
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui, CAT_VPN);
  for (let i = 0; i < 4; i += 1) {
    await click(ui.button(/^Compare the next/));
  }
  assert.match(ui.text(), /A category this large cannot be compared in full\./);
  assert.ok(!/Choose a category to narrow it/.test(ui.text()));
  await ui.unmount();
});

test('the categories of a knowledge base are read once, kept for the signed-in person, and read again for another', async () => {
  const { fake } = setup(kbBase(40));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  const catReads = () => fake.readsOf('kbScopes').filter((a) => a.knowledgeBase).length;
  await open(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), KB_IT);
  assert.equal(catReads(), 1);
  assert.deepEqual(ui.field('Category (optional)').querySelectorAll('option').map((o) => o.textContent), ['All categories', 'VPN (26)', 'Email (14)']);
  await choose(ui.field('Knowledge base'), '');
  await choose(ui.field('Knowledge base'), KB_IT);
  assert.equal(catReads(), 1, 'the same base again: from memory');
  // another person on the same browser: not what was read for the first
  await ui.rerender(<KnowledgeInsights page={{ ...page, user: { name: 'Abel Tuter', userId: 'u2' } }} eff={eff()} active />);
  await choose(ui.field('Knowledge base'), KB_IT);
  assert.equal(catReads(), 2, 'read again for the next person');
  await ui.unmount();
});

test('categories that did not fit in the list are counted, not dropped without a word', async () => {
  const { fake } = setup(kbBase(40));
  fake.onRead('kbScopes', (args) => (args.knowledgeBase ? { items: [{ id: CAT_VPN, name: 'VPN', count: 27 }], hidden: 40, access: [] } : { items: [{ id: KB_IT, name: 'IT Knowledge Base', count: 40 }], hidden: 1, access: [] }));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await open(ui, 'Duplicate articles');
  assert.match(ui.text(), /1 smaller knowledge base is not listed\./);
  await choose(ui.field('Knowledge base'), KB_IT);
  assert.match(ui.text(), /40 smaller categories are not listed\./);
  await ui.unmount();
});

test('a group explains itself in one line from what the grouping used, and the category is a plain fact beside it', async () => {
  setup(kbBase(40, { titles: { 30: DUP, 33: DUP, 5: 'Mailbox quota increase request form', 6: 'Request form for mailbox quota increase' } }));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  const rows = ui.$$('.ab-kb-cluster').map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(rows.length, 2);
  const exact = rows.find((r) => /same title/.test(r));
  assert.match(exact, /The titles use the same words\./);
  assert.match(exact, /All are in the category Email\./, 'articles 30 and 33 are both in Email');
  const alike = rows.find((r) => /read alike/.test(r));
  assert.match(alike, /The titles share .*mailbox.* and are about \d+% alike\./);
  assert.match(alike, /They are in different categories\./, 'articles 5 and 6 are in VPN and in Email');
  assert.ok(!ui.$('.ab-kb-cluster .ab-chip'), 'the words are in the line, not in a second row of chips');
  // a scan by category does not repeat the category on every group
  await choose(ui.field('Category (optional)'), CAT_VPN);
  await click(ui.button('Find duplicates'));
  assert.ok(!/All are in the category/.test(ui.text()));
  await ui.unmount();
});

test('"Compare the next 300" keeps the group that is being compared, and what AI Assist was handed', async () => {
  setup(kbBase(700, { titles: { 650: DUP, 649: DUP } }));
  const insights = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  const assist = await mount(<KnowledgeAssist page={page} eff={eff()} active />);
  await startScan(insights);
  assert.match(insights.text(), /2 articles with the same title/);
  await click(insights.button('Compare'));
  await click(insights.button('Compare their text'));
  assert.match(insights.text(), /80% of the shorter text also appears in the other/);
  assert.match(assist.text(), /KB1000650/, 'AI Assist has the group');
  await click(insights.button('Compare the next 300'));
  assert.match(insights.text(), /Compared 600 of 700/);
  assert.match(insights.text(), /Compare the text/, 'the comparison is still open');
  assert.match(insights.text(), /80% of the shorter text also appears in the other/, 'and so is what was read of the text');
  assert.match(assist.text(), /KB1000650/, 'AI Assist still has the group');
  assert.ok(insights.$('.ab-kb-picked'), 'the group is still marked in the list');
  assert.equal(insights.$$('.ab-kb-picked').length, 1);
  await insights.unmount();
  await assist.unmount();
});

test('Stop while the next 300 are read keeps what was compared; a failed read says so and can be tried again', async () => {
  const { fake, deps } = setup(kbBase(700));
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await startScan(ui);
  // Stop
  const held = deferred();
  const handler = (args) => (args.offset === 300 ? held.promise : { articles: [], truncated: false, next: null, access: [] });
  fake.onRead('kbDuplicates', handler);
  await click(ui.button('Compare the next 300'));
  assert.match(ui.text(), /Comparing titles/);
  await click(ui.button('Stop'));
  assert.ok(!/Comparing titles/.test(ui.text()));
  assert.match(coverage(ui), /^Compared 300 of 700 articles/, 'the first 300 stay');
  assert.ok(ui.hasButton('Compare the next 300'), 'and the person can go on');
  await during(() => held.resolve({ articles: [{ sysId: 'f'.repeat(32), number: 'KB9', title: 'Late' }], total: 700, truncated: false, next: null, access: [] }));
  assert.match(coverage(ui), /^Compared 300 of 700 articles/, 'the late answer is dropped');
  // a failed read
  let calls = 0;
  fake.onRead('kbDuplicates', (args) => {
    calls += 1;
    if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return knowledgeOps.kbDuplicates(args, { deps });
  });
  await click(ui.button('Compare the next 300'));
  assert.match(ui.text(), /lost touch with this page/);
  assert.match(coverage(ui), /^Compared 300 of 700 articles/, 'what was compared stays on screen');
  await click(ui.button('Try again'));
  await settle(4);
  assert.match(coverage(ui), /^Compared 600 of 700 articles/);
  await ui.unmount();
});

// ---- the gap radar ---------------------------------------------------------------------------------------------------------------------

const topic = (over = {}) => ({ id: 'g1', label: 'VPN + disconnect', count: 3, withFix: 2, category: 'Network', ci: 'VPN Gateway EU', examples: [{ table: 'incident', sysId: 'f'.repeat(32), number: 'INC0000001', title: 'VPN drops' }], keywords: ['VPN'], ...over });
const gapsAnswer = (over = {}) => ({ scanned: 500, total: 12400, days: 60, withArticle: 37, link: { known: true }, clusters: [topic()], access: [], truncated: true, note: '', ...over });

async function gaps(answer) {
  const { fake } = setup(kbBase(5));
  fake.onRead('kbGapScopes', () => ({ categories: [], total: 12400, access: [] }));
  fake.onRead('kbGaps', () => answer);
  const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
  await open(ui, 'Articles to write');
  await click(ui.button('Find topics'));
  return ui;
}

test('each topic shows how many tickets stand behind it and how many hold a written fix, on screen (not only in the CSV)', async () => {
  const ui = await gaps(gapsAnswer({ clusters: [topic(), topic({ id: 'g2', label: 'Printer + jam', count: 1, withFix: 0 }), topic({ id: 'g3', label: 'Outlook + sync', count: 12, withFix: 0 })] }));
  const rows = ui.$$('.ab-kb-cluster').map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  assert.match(rows[0], /VPN \+ disconnect\s*3 tickets, 2 with a written fix/);
  assert.match(rows[1], /Printer \+ jam\s*1 ticket, 0 with a written fix/);
  assert.match(rows[2], /Outlook \+ sync\s*12 tickets, 0 with a written fix/, 'none with a fix is worth knowing too');
  assert.match(ui.text(), /Looked at 500 of 12,400 tickets resolved in the last 60 days\. 37 already had an article\./);
  await ui.unmount();
});

test('a read that was cut and could not be counted says "an unknown number", not a bare 500', async () => {
  const ui = await gaps(gapsAnswer({ total: null }));
  assert.match(ui.text(), /Looked at the newest 500 of an unknown number of tickets resolved in the last 60 days\./);
  await ui.unmount();
});

test('a read that was not cut is complete: no "of"', async () => {
  const ui = await gaps(gapsAnswer({ scanned: 7, total: 7, truncated: false }));
  assert.match(ui.text(), /Looked at 7 tickets resolved in the last 60 days\. 37 already had an article\./);
  assert.ok(!/Looked at 7 of/.test(ui.text()));
  await ui.unmount();
});
