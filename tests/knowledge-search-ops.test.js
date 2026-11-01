import test from 'node:test';
import assert from 'node:assert/strict';
import knowledgeOps from '../src/content/ops/knowledge.js';
import { KB_SEARCH_FIELDS, excerptAround, knowledgeSearchQuery, searchKnowledgeText, searchTerms } from '../src/context/knowledge.js';
import { scoreArticle } from '../src/context/similar.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { articleShareUrl, freshnessOf } from '../src/sidepanel/knowledgeScreen/articleInfo.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { KB_IT, NOW, articleRow, id, knowledgeTables } from './knowledge-fixtures.js';

// N23 Knowledge search (round 3): the words typed become plain keywords, the instance is asked for published articles with every
// word (then any word), and the answer is ranked like the ticket's "Knowledge that may help" (scoreArticle). GET only.

test('the words of a search: no filler, no emails, links or phone numbers; an article number is looked up by itself', () => {
  assert.deepEqual(searchTerms('How do I reset my VPN password?'), { number: '', keywords: ['vpn', 'password', 'reset'] });
  const scrubbed = searchTerms('mail abel.tuter@example.com or https://evil.example/x or +1 555 0134 9988 about outlook').keywords;
  assert.ok(scrubbed.includes('outlook'));
  assert.ok(!scrubbed.some((w) => /abel|tuter|example|evil|555|0134/.test(w)), scrubbed.join(','));
  assert.deepEqual(searchTerms('kb0010001'), { number: 'KB0010001', keywords: [] });
  assert.deepEqual(searchTerms('the and is'), { number: '', keywords: [] });
  assert.ok(searchTerms('x'.repeat(5000)).keywords.every((w) => w.length <= 200));
  for (const nasty of ['vpn^ORsys_idISNOTEMPTY', 'password=javascript:alert(1)', 'a\nb^c']) {
    for (const w of searchTerms(nasty).keywords) assert.match(w, /^[a-z0-9_-]+$/, `${nasty} -> ${w}`);
  }
});

test('the query: every word in the title or the text (AND of ORs), or any word; published only, newest first', () => {
  assert.equal(knowledgeSearchQuery({ keywords: ['vpn', 'password'] }), 'workflow_state=published^short_descriptionLIKEvpn^ORtextLIKEvpn^short_descriptionLIKEpassword^ORtextLIKEpassword^ORDERBYDESCsys_updated_on');
  assert.equal(knowledgeSearchQuery({ keywords: ['vpn', 'password'] }, { all: false }), 'workflow_state=published^short_descriptionLIKEvpn^ORtextLIKEvpn^ORshort_descriptionLIKEpassword^ORtextLIKEpassword^ORDERBYDESCsys_updated_on');
  assert.equal(knowledgeSearchQuery({ number: 'KB0010001' }), 'workflow_state=published^number=KB0010001');
  assert.equal(knowledgeSearchQuery({ number: 'KB^1' }), '');
  assert.equal(knowledgeSearchQuery({ keywords: ['^', '=='] }), '');
});

test('a search finds published, current articles, ranked like the ticket card, with a short excerpt and freshness', async () => {
  const deps = fakeDeps(knowledgeTables());
  const out = await searchKnowledgeText({ query: 'reset vpn password' }, deps, { now: NOW });
  assert.deepEqual(out.hits.slice(0, 3).map((h) => h.number), ['KB0000001', 'KB0000002', 'KB0000003'], 'the articles with every word first');
  assert.ok(out.hits.slice(3).every((h) => h.score <= out.hits[2].score), 'articles with only some of the words below them');
  const hit = out.hits[0];
  assert.equal(hit.title, 'How to reset your VPN password');
  assert.equal(hit.knowledgeBase, 'IT Knowledge Base');
  assert.equal(hit.category, 'VPN');
  assert.ok(hit.excerpt.length <= 230 && hit.excerpt.length > 20, 'a short excerpt, never the whole article');
  assert.equal(hit.ageDays, 25);
  assert.equal(hit.expiresInDays, 431);
  assert.deepEqual({ score: hit.score, why: hit.why }, scoreArticle({ title: hit.title, body: 'Before you begin You need your company laptop and your user name. Steps Open the VPN client. Click Forgot password. Enter your user name and press Submit. Open the email you receive and select the link. If this does not work Call the service desk on 555-0100.' }, out.keywords), 'the same ranking as the ticket card');
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'), 'GET reads only');
  assert.deepEqual(deps.callsTo('kb_knowledge')[0].fields, [...KB_SEARCH_FIELDS]);
  assert.ok(!JSON.stringify(out).includes('LEAK'), 'nothing outside the columns asked for');
  assert.ok(!JSON.stringify(out).includes('<h2>'), 'no HTML');
  for (const name of KB_SEARCH_FIELDS.filter((f) => f !== 'sys_id')) assert.ok(FIELDS_BY_KIND.knowledge.includes(name), `${name} is inside the knowledge ceiling`);
});

test('every word first, then any word to fill up; drafts, expired articles and other knowledge bases\' rules are the instance\'s', async () => {
  const tables = knowledgeTables();
  tables.kb_knowledge.push(articleRow({ n: 8, title: 'Old VPN guide', validTo: '2026-01-01' }));
  tables.kb_knowledge.push(articleRow({ n: 9, title: 'Outlook on Mac crashes', html: '<p>Install the update.</p>' }));
  const deps = fakeDeps(tables);
  const out = await searchKnowledgeText({ query: 'outlook mac crashes' }, deps, { now: NOW });
  assert.equal(deps.callsTo('kb_knowledge').length, 2, 'few full matches: a second read for any word');
  assert.equal(out.hits[0].number, 'KB0000009', 'the full match first');
  assert.ok(out.hits.some((h) => h.number === 'KB0000004'), 'a partial match fills up');
  const vpn = await searchKnowledgeText({ query: 'vpn guide' }, fakeDeps(tables), { now: NOW });
  assert.ok(!vpn.hits.some((h) => h.number === 'KB0000008'), 'an expired article is left out');
  assert.ok(!vpn.hits.some((h) => h.number === 'KB0000007'), 'a draft is never a result');
  const byNumber = await searchKnowledgeText({ query: 'KB0000004' }, fakeDeps(tables), { now: NOW });
  assert.deepEqual(byNumber.hits.map((h) => h.number), ['KB0000004']);
});

test('an instance that ignores the filter cannot slip drafts in; a denied table is said, not shown as "nothing found"', async () => {
  const leaky = fakeDeps(knowledgeTables());
  const queryTable = leaky.queryTable;
  leaky.queryTable = (table, query, fields, options) => queryTable(table, '', fields, options); // every row, whatever was asked
  const out = await searchKnowledgeText({ query: 'old draft' }, leaky, { now: NOW });
  assert.ok(!out.hits.some((h) => h.number === 'KB0000007'));
  const denied = await searchKnowledgeText({ query: 'vpn' }, fakeDeps(knowledgeTables(), { denied: ['kb_knowledge'] }), { now: NOW });
  assert.deepEqual([denied.hits, denied.access[0].status], [[], 'denied']);
  const hidden = await searchKnowledgeText({ query: 'vpn' }, fakeDeps(knowledgeTables(), { hidden: ['kb_knowledge'] }), { now: NOW });
  assert.equal(hidden.access[0].status, 'empty-or-hidden');
  const nothing = await searchKnowledgeText({ query: 'zebra unicorn' }, fakeDeps(knowledgeTables()), { now: NOW });
  assert.deepEqual([nothing.hits, nothing.access[0].status], [[], 'empty']);
  const noWords = await searchKnowledgeText({ query: 'the of' }, fakeDeps({}), { now: NOW });
  assert.equal(noWords.access[0].status, 'skipped');
});

test('the kbSearch op validates what it is given', async () => {
  const ctx = { deps: fakeDeps(knowledgeTables()) };
  await assert.rejects(() => knowledgeOps.kbSearch({ query: '  ' }, ctx), /Type a few words/);
  await assert.rejects(() => knowledgeOps.kbSearch({ query: 7 }, ctx), /Type a few words/);
  await assert.rejects(() => knowledgeOps.kbSearch(undefined, ctx), /Type a few words/);
  const out = await knowledgeOps.kbSearch({ query: 'vpn password' }, ctx);
  assert.ok(out.hits.length >= 1);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON');
  assert.equal(id(1).length, 32);
  assert.ok(KB_IT);
});

test('an excerpt is cut around the first search word, on word boundaries', () => {
  const text = `${'filler '.repeat(60)}the VPN client needs a restart ${'more '.repeat(60)}`;
  const out = excerptAround(text, ['vpn'], 120);
  assert.ok(out.startsWith('...') && out.endsWith('...'));
  assert.match(out, /VPN client/);
  assert.ok(out.length <= 130);
  assert.equal(excerptAround('short text', ['x']), 'short text');
  assert.ok(excerptAround('a'.repeat(500), ['zzz'], 100).startsWith('aaa'));
});

test('freshness in words: expiring, stale, ageing, fresh', () => {
  assert.deepEqual(freshnessOf({ ageDays: 3, expiresInDays: 400 }), { level: 'fresh', text: 'Updated 3 days ago' });
  assert.deepEqual(freshnessOf({ ageDays: 0 }), { level: 'fresh', text: 'Updated today' });
  assert.deepEqual(freshnessOf({ ageDays: 29 }), { level: 'fresh', text: 'Updated 4 weeks ago' });
  assert.deepEqual(freshnessOf({ ageDays: 200 }), { level: 'aging', text: 'Updated 6 months ago' });
  assert.deepEqual(freshnessOf({ ageDays: 800 }), { level: 'stale', text: 'Not updated for 2 years' });
  assert.deepEqual(freshnessOf({ ageDays: 10, expiresInDays: 12 }), { level: 'expiring', text: 'Expires in 12 days' });
  assert.deepEqual(freshnessOf({ ageDays: 10, expiresInDays: 0 }), { level: 'expiring', text: 'Expires today' });
  assert.deepEqual(freshnessOf({}), { level: 'unknown', text: '' });
});

test('the share link: by number on the instance only, the portal\'s article page on a portal', () => {
  const classic = { href: 'https://acme.service-now.com/incident.do', surface: 'classic' };
  assert.equal(articleShareUrl(classic, { number: 'kb0010001', sysId: 'a'.repeat(32) }), 'https://acme.service-now.com/kb_view.do?sysparm_article=KB0010001');
  assert.equal(articleShareUrl(classic, { number: 'not a number', sysId: 'A'.repeat(32) }), `https://acme.service-now.com/kb_view.do?sys_kb_id=${'a'.repeat(32)}`);
  assert.equal(articleShareUrl({ href: 'https://acme.service-now.com/esc?id=ticket', surface: 'portal', portal: { base: '/esc' } }, { number: 'KB0010001' }), 'https://acme.service-now.com/esc?id=kb_article&sysparm_article=KB0010001');
  assert.equal(articleShareUrl({ href: 'https://acme.service-now.com/x', surface: 'portal', portal: { base: '/../evil' } }, { number: 'KB0010001' }), 'https://acme.service-now.com/sp?id=kb_article&sysparm_article=KB0010001');
  assert.equal(articleShareUrl(classic, { number: 'KB1^x', sysId: 'nope' }), '');
  assert.equal(articleShareUrl({ href: 'http://acme.service-now.com/' }, { number: 'KB0010001' }), '', 'https only');
  assert.equal(articleShareUrl({ href: 'not a url' }, { number: 'KB0010001' }), '');
});
