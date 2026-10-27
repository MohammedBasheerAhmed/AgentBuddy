import test from 'node:test';
import assert from 'node:assert/strict';
import knowledgeOps from '../src/content/ops/knowledge.js';
import chatOps from '../src/content/ops/chat.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { allowedFields } from '../src/context/allowlists.js';
import { KB_LIST_FIELDS } from '../src/context/knowledge.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INTERACTION_ID, KB_IT, chatTables, id, incidentRows, knowledgeTables, linkTables } from './knowledge-fixtures.js';

const context = (tables, behaviour, groups) => {
  const deps = fakeDeps(tables, behaviour);
  if (groups) deps.countByColumn = async () => groups;
  return { deps, checkRecord, checkPack };
};
const kb = (behaviour) => context(knowledgeTables(), behaviour);
const tickets = (behaviour) => context({ incident: incidentRows(), ...linkTables() }, behaviour);

test('my operation names carry a kb/chat prefix, so they cannot shadow the built-in ones or another area\'s', () => {
  const BUILT_IN = ['pack', 'history', 'myday', 'similar', 'duplicates', 'knowledge', 'header'];
  for (const name of [...Object.keys(knowledgeOps), ...Object.keys(chatOps)]) {
    assert.match(name, /^(kb|chat)[A-Z]/, name);
    assert.ok(!BUILT_IN.includes(name), name);
  }
  assert.deepEqual(Object.keys(knowledgeOps).sort(), ['kbArticleTexts', 'kbDuplicates', 'kbGaps', 'kbScopes']);
  assert.deepEqual(Object.keys(chatOps), ['chatOverview']);
});

// ---- scopes and duplicates -----------------------------------------------------------------------------------------

test('kbScopes validates the knowledge base it is given', async () => {
  const ctx = context(knowledgeTables(), {}, [{ stats: { count: '3' }, groupby_fields: [{ field: 'kb_knowledge_base', value: KB_IT, display_value: 'IT' }] }]);
  assert.deepEqual((await knowledgeOps.kbScopes({}, ctx)).items, [{ id: KB_IT, name: 'IT', count: 3 }]);
  await assert.rejects(knowledgeOps.kbScopes({ knowledgeBase: 'x^y' }, ctx), /not a valid knowledge base/);
  await assert.rejects(knowledgeOps.kbScopes({ knowledgeBase: 5 }, ctx), /not a valid knowledge base/);
  assert.doesNotReject(knowledgeOps.kbScopes(undefined, ctx));
});

test('kbDuplicates: groups by title, reads titles and counts only, within the cap', async () => {
  const ctx = kb();
  const out = await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT }, ctx);
  assert.equal(out.scanned, 5);
  assert.equal(out.truncated, false);
  assert.equal(out.clusters.length, 1);
  assert.deepEqual(out.clusters[0].articles.map((a) => a.number), ['KB0000001', 'KB0000002', 'KB0000003']);
  assert.equal(out.clusters[0].keep.number, 'KB0000001');
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON');
  const call = ctx.deps.callsTo('kb_knowledge')[0];
  assert.deepEqual(call.fields, [...KB_LIST_FIELDS]);
  assert.ok(!call.fields.includes('text'));
  assert.ok(call.options.limit <= 300);
  assert.ok(ctx.deps.calls.every((c) => c.fn === 'queryTable' || c.fn === 'countRecords'), 'GET reads only');
  assert.equal(JSON.stringify(out).includes('ARTICLE-LEAK'), false);
});

test('kbDuplicates: the arguments are checked, the threshold is clamped, a lower threshold finds more', async () => {
  await assert.rejects(knowledgeOps.kbDuplicates({}, kb()), /Choose a knowledge base or a category/);
  await assert.rejects(knowledgeOps.kbDuplicates(undefined, kb()), /Choose a knowledge base or a category/);
  await assert.rejects(knowledgeOps.kbDuplicates({ knowledgeBase: 'nope' }, kb()), /not a valid knowledge base/);
  await assert.rejects(knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, category: ['a'] }, kb()), /not a valid category/);
  assert.equal((await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, threshold: 99 }, kb())).threshold, 0.9);
  assert.equal((await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, threshold: -4 }, kb())).threshold, 0.4);
  assert.equal((await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, threshold: 'x' }, kb())).threshold, 0.55);
  assert.equal((await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, threshold: 0.9 }, kb())).clusters.length, 0);
});

test('kbDuplicates: a table the user cannot read comes back as an access note, not an error', async () => {
  const out = await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT }, kb({ denied: ['kb_knowledge'] }));
  assert.deepEqual([out.scanned, out.clusters], [0, []]);
  assert.equal(out.access[0].status, 'denied');
});

// ---- the text of one group ---------------------------------------------------------------------------------------------

test('kbArticleTexts: the text of two to four articles through the merge spec, and how much of it overlaps', async () => {
  const ctx = kb();
  const out = await knowledgeOps.kbArticleTexts({ sysIds: [id(1), id(2), id(3)] }, ctx);
  assert.deepEqual(out.articles.map((a) => a.number), ['KB0000001', 'KB0000002', 'KB0000003']);
  assert.match(out.articles[0].text, /Open the VPN client/);
  assert.ok(!/<\w+>/.test(out.articles[0].text), 'plain text');
  assert.equal(out.pairs.length, 3);
  assert.ok(out.pairs.every((p) => p.containment >= 0 && p.containment <= 1));
  assert.deepEqual(Object.keys(out.articles[0]).sort(), ['category', 'knowledgeBase', 'meta', 'number', 'sysId', 'text', 'title']);
  const allowed = allowedFields('kb_knowledge', 'kb-merge-draft');
  for (const call of ctx.deps.callsTo('kb_knowledge')) for (const name of call.fields) assert.ok(allowed.includes(name), `asked for ${name}`);
  assert.equal(ctx.deps.callsTo('kb_knowledge').length, 3, 'one read per article, nothing more');
});

test('kbArticleTexts: the number and the shape of the ids are enforced', async () => {
  const ctx = kb();
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1)] }, ctx), /Pick two to 4/);
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1), id(1)] }, ctx), /Pick two to 4/, 'the same article twice is one article');
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1), id(2), id(3), id(4), id(5)] }, ctx), /Pick two to 4/);
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1), 'nope'] }, ctx), /not a valid article/);
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: `${id(1)},${id(2)}` }, ctx), /Pick two to 4/);
  await assert.rejects(knowledgeOps.kbArticleTexts(undefined, ctx), /Pick two to 4/);
  assert.equal(ctx.deps.calls.length, 0, 'nothing was read for bad input');
});

test('kbArticleTexts: an article that cannot be read stops the comparison with a clear message', async () => {
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1), id(999)] }, kb()), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(knowledgeOps.kbArticleTexts({ sysIds: [id(1), id(2)] }, kb({ denied: ['kb_knowledge'] })), (err) => err.code === 'ACCESS_DENIED');
});

// ---- the gap radar ------------------------------------------------------------------------------------------------------

test('kbGaps: tickets that already have an article are left out; the rest are grouped and ranked', async () => {
  const out = await knowledgeOps.kbGaps({ days: 60, tables: ['incident'] }, tickets());
  assert.equal(out.scanned, 7);
  assert.equal(out.link.known, true);
  assert.equal(out.withArticle, 3, 'INC1 and INC4 have an attached article, INC5 a knowledge-use row');
  assert.equal(out.candidates, 4);
  assert.equal(out.note, '');
  const labels = out.clusters.map((c) => c.label.toLowerCase());
  assert.equal(out.clusters.length, 2);
  assert.ok(labels.some((l) => l.includes('vpn')) && labels.some((l) => l.includes('outlook')));
  const vpn = out.clusters.find((c) => /vpn/i.test(c.label));
  assert.deepEqual(vpn.examples.map((e) => e.number).sort(), ['INC0000002', 'INC0000003']);
  assert.equal(vpn.withFix, 2);
  assert.ok(vpn.examples.every((e) => e.table === 'incident' && /^[0-9a-f]{32}$/.test(e.sysId)));
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'plain JSON');
  assert.ok(!JSON.stringify(out).includes('TICKET-LEAK'));
  assert.ok(!JSON.stringify(out).includes('Disabled power saving'), 'no resolution text');
});

test('kbGaps: when the link tables cannot be read it says so and counts every ticket', async () => {
  const out = await knowledgeOps.kbGaps({ days: 60, tables: ['incident'] }, tickets({ denied: ['m2m_kb_task', 'kb_use'] }));
  assert.equal(out.link.known, false);
  assert.match(out.note, /Could not tell which tickets had an article/);
  assert.equal(out.withArticle, 0);
  assert.equal(out.candidates, 7);
  assert.ok(out.clusters.some((c) => /print/i.test(c.label)), 'the printer tickets are back');
  assert.deepEqual(out.access.filter((a) => a.status === 'denied').map((a) => a.source), ['m2m_kb_task', 'kb_use']);
});

test('kbGaps: bounded reads, validated arguments', async () => {
  const ctx = tickets();
  await knowledgeOps.kbGaps({ days: 1000, tables: ['incident'] }, ctx);
  assert.match(ctx.deps.callsTo('incident')[0].query, /resolved_at>=/);
  assert.ok(ctx.deps.callsTo('incident')[0].options.limit <= 500);
  assert.equal((await knowledgeOps.kbGaps({ days: 1000, tables: ['incident'] }, tickets())).days, 90);
  assert.equal((await knowledgeOps.kbGaps({ tables: ['incident'] }, tickets())).days, 60);
  await assert.rejects(knowledgeOps.kbGaps({ tables: ['sn_hr_core_case'] }, tickets()), /Choose incidents or cases/);
  await assert.rejects(knowledgeOps.kbGaps({ tables: ['incident^ORactive=true'] }, tickets()), /Choose incidents or cases/);
  await assert.rejects(knowledgeOps.kbGaps({ tables: 'incident' }, tickets()), /Choose incidents or cases/);
  assert.equal((await knowledgeOps.kbGaps(undefined, tickets())).scanned, 7, 'incidents are the default');
});

test('kbGaps: an empty window reads no links at all', async () => {
  const ctx = context({ incident: [], ...linkTables() });
  const out = await knowledgeOps.kbGaps({ days: 30, tables: ['incident'] }, ctx);
  assert.deepEqual([out.scanned, out.clusters, out.note], [0, [], '']);
  assert.equal(ctx.deps.callsTo('m2m_kb_task').length + ctx.deps.callsTo('kb_use').length, 0);
});

// ---- the chat overview ------------------------------------------------------------------------------------------------------

test('chatOverview: the facts about a chat, from the same pack the AI features use', async () => {
  const ctx = context(chatTables());
  const out = await chatOps.chatOverview({ table: 'interaction', sysId: INTERACTION_ID }, ctx);
  assert.equal(out.number, 'IMS0001001');
  assert.equal(out.overview.count, 6);
  assert.deepEqual([out.overview.byCustomer, out.overview.byAgent, out.overview.byBot], [3, 2, 1]);
  assert.equal(out.overview.ended, true);
  assert.equal(out.overview.lastCustomer.text, 'Thanks, still not working. Can you fix it today?');
  assert.deepEqual(out.overview.participants.map((p) => p.name).sort(), ['Abel Tuter', 'Beth Anglin']);
  assert.equal(out.access.find((a) => a.source === 'chat').status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  assert.ok(ctx.deps.calls.every((c) => c.fn === 'queryTable'));
});

test('chatOverview: validates the record and refuses anything that is not a chat', async () => {
  const ctx = context(chatTables());
  await assert.rejects(chatOps.chatOverview({ table: 'interaction', sysId: 'nope' }, ctx), /not a valid record/);
  await assert.rejects(chatOps.chatOverview({ table: 'incident; drop', sysId: INTERACTION_ID }, ctx), /not a valid record/);
  await assert.rejects(chatOps.chatOverview({ table: 'incident', sysId: INTERACTION_ID }, ctx), /not a chat conversation/);
  await assert.rejects(chatOps.chatOverview({}, ctx), /not a valid record/);
  assert.equal(ctx.deps.calls.length, 0);
});

test('chatOverview: unreadable chat tables are reported, not hidden behind an empty chat', async () => {
  const ctx = context(chatTables(), { denied: ['sys_cs_conversation', 'live_group_profile', 'sys_cs_message'] });
  const out = await chatOps.chatOverview({ table: 'interaction', sysId: INTERACTION_ID }, ctx);
  assert.equal(out.overview.count, 0);
  const entry = out.access.find((a) => a.source === 'chat');
  assert.equal(entry.status, 'denied');
  assert.match(entry.note, /No chat messages are available to you/);
});
