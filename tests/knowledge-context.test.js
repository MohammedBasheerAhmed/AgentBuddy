import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_FIELDS, FIELDS_BY_KIND, LIMITS, allowedFields, fieldLimit } from '../src/context/allowlists.js';
import {
  GAP_FIELDS, GAP_TABLES, KB_LIST_FIELDS, LINK_SOURCES, articleHtmlStats, readArticleLinks, readKnowledgeList, readKnowledgeScopes,
  readResolvedTickets, statsToStrings,
} from '../src/context/knowledge.js';
import { readContextPack } from '../src/context/pack.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { KB_HR, KB_IT, CAT_VPN, NOW, id, incidentId, incidentRows, knowledgeTables, linkTables } from './knowledge-fixtures.js';

const kbTables = () => knowledgeTables();
const ticketTables = () => ({ incident: incidentRows(), ...linkTables() });

// The aggregate read of the real client returns this shape; the fake of the row reads answers [] for it.
const withGroups = (deps, groups) => ({ ...deps, countByColumn: async (table, query, column) => (typeof groups === 'function' ? groups(table, query, column) : groups) });
const group = (value, display, count, field = 'kb_knowledge_base') => ({ stats: { count: String(count) }, groupby_fields: [{ field, value, display_value: display }] });

// ---- the ceilings and the specs ----------------------------------------------------------------------------------

test('the knowledge and chat ceilings are the documented ones, and every feature stays inside them', () => {
  for (const name of ['number', 'short_description', 'text', 'workflow_state', 'kb_knowledge_base', 'kb_category', 'meta', 'valid_to', 'sys_updated_on', 'sys_view_count']) {
    assert.ok(FIELDS_BY_KIND.knowledge.includes(name), name);
  }
  assert.ok(FIELDS_BY_KIND.knowledge.includes('author'), 'the author is read, as a person, so the privacy filter knows the name');
  assert.ok(!FIELDS_BY_KIND.chat.includes('comments') && !FIELDS_BY_KIND.chat.includes('work_notes'));
  for (const feature of ['article-check', 'article-optimise', 'kb-merge-draft', 'kb-gap-outline', 'chat-summary', 'chat-reply']) {
    for (const kind of ['knowledge', 'chat', 'incident', 'case']) {
      const ceiling = new Set(FIELDS_BY_KIND[kind]);
      for (const name of FEATURE_FIELDS[feature][kind]) assert.ok(ceiling.has(name), `${feature}/${kind}: ${name}`);
    }
  }
  assert.ok(FEATURE_FIELDS['article-optimise'].knowledge.length < FEATURE_FIELDS['article-check'].knowledge.length);
  assert.ok(!FEATURE_FIELDS['article-optimise'].knowledge.includes('sys_view_count'), 'the AI feature does not get the view count');
  assert.ok(!FEATURE_FIELDS['chat-reply'].chat.includes('opened_at'));
  assert.equal(fieldLimit('text'), 6000);
  assert.equal(LIMITS.description, 4000, 'other limits are untouched');
});

test('the bulk reads stay inside the ceiling of the kinds they read', () => {
  for (const name of KB_LIST_FIELDS.filter((n) => n !== 'sys_id')) assert.ok(FIELDS_BY_KIND.knowledge.includes(name), `duplicate finder: ${name}`);
  assert.ok(!KB_LIST_FIELDS.includes('text'), 'the first read never carries article text');
  for (const [table, kind] of Object.entries(GAP_TABLES)) {
    const columns = GAP_FIELDS[table].filter((n) => n !== 'sys_id');
    for (const name of columns) assert.ok(FIELDS_BY_KIND[kind].includes(name), `gap radar ${table}: ${name}`);
    for (const name of columns) assert.ok(FEATURE_FIELDS['kb-gap-outline'][kind].includes(name), `kb-gap-outline spec ${kind}: ${name}`);
  }
  assert.ok(GAP_FIELDS.incident.includes('caller_id') && GAP_FIELDS.sn_customerservice_case.includes('contact'), 'the people of a ticket are read');
  assert.ok(!Object.keys(GAP_TABLES).some((t) => t.startsWith('sn_hr_')), 'HR cases are never part of the radar');
});

// ---- one article through the context engine ------------------------------------------------------------------------

const article = (n = 1, feature = 'article-check', behaviour) => {
  const deps = fakeDeps(kbTables(), behaviour);
  return readContextPack({ table: 'kb_knowledge', sysId: id(n) }, deps, { feature }).then((pack) => ({ pack, deps }));
};

test('an article pack: plain text up to 6000 characters, display fields, stored dates, structure counted from the HTML', async () => {
  const { pack } = await article(1);
  assert.equal(pack.kind, 'knowledge');
  assert.equal(pack.number, 'KB0000001');
  assert.equal(pack.fields.short_description, 'How to reset your VPN password');
  assert.equal(pack.fields.kb_knowledge_base, 'IT Knowledge Base');
  assert.equal(pack.fields.workflow_state, 'Published');
  assert.match(pack.fields.text, /^Before you begin\n\nYou need your company laptop/);
  assert.ok(!/<|&nbsp;/.test(pack.fields.text), 'HTML is gone');
  assert.deepEqual(pack.related.times, { published: '2026-01-10', valid_to: '2027-12-31', sys_updated_on: '2026-10-01 09:00:00' });
  assert.equal(pack.related.article.headings, '3');
  assert.equal(pack.related.article.orderedLists, '1');
  assert.equal(pack.related.article.listItems, '4');
  assert.ok(Number(pack.related.article.textLength) > 200);
  // Every related value is a string, as the contract says.
  for (const group2 of Object.values(pack.related)) for (const value of Object.values(group2)) assert.equal(typeof value, 'string');
  assert.deepEqual(pack.journal, []);
  // The author is read as a person (so the privacy filter knows the name), with the email when sys_user allows it.
  assert.deepEqual(pack.people.map((p) => [p.role, p.name, p.email]), [['author', 'Abel Tuter', 'abel.tuter@example.com']]);
});

test('a long article is capped in the pack but its full length is still counted', async () => {
  const tables = kbTables();
  tables.kb_knowledge[0].text = v('', `<p>${'word '.repeat(5000)}</p>`);
  const pack = await readContextPack({ table: 'kb_knowledge', sysId: id(1) }, fakeDeps(tables), { feature: 'article-check' });
  assert.equal(pack.fields.text.length, 6000);
  assert.ok(Number(pack.related.article.textLength) >= 24999);
  assert.ok(Number(pack.related.article.words) >= 5000);
});

test('the AI feature reads fewer columns than the check, and the allowlist holds when the instance returns everything', async () => {
  const { pack: ai } = await article(1, 'article-optimise');
  assert.ok(!('sys_view_count' in ai.fields) && !('workflow_state' in ai.fields) && !('kb_knowledge_base' in ai.fields));
  assert.ok('meta' in ai.fields && 'text' in ai.fields);
  for (const feature of ['article-check', 'article-optimise', 'kb-merge-draft']) {
    const { pack, deps } = await article(1, feature, { leaky: true });
    const text = JSON.stringify(pack);
    for (const leak of ['ARTICLE-LEAK-1', 'LEAK-VERSION-9']) assert.ok(!text.includes(leak), `${feature} leaked ${leak}`);
    const allowed = new Set(allowedFields('kb_knowledge', feature));
    for (const key of Object.keys(pack.fields)) assert.ok(allowed.has(key), `${feature}: ${key}`);
    for (const call of deps.callsTo('kb_knowledge')) for (const name of call.fields) assert.ok(allowed.has(name), `${feature} asked for ${name}`);
    assert.equal(deps.callsTo('sys_journal_field').length, 0);
    assert.equal(deps.callsTo('sys_user').length, 1, 'one read for the author, nothing else');
  }
});

test('an article that cannot be read is NOT_FOUND or denied, not an empty pack', async () => {
  await assert.rejects(article(999), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(article(1, 'article-check', { denied: ['kb_knowledge'] }), (err) => err.code === 'ACCESS_DENIED');
});

test('html stats count what plain text loses', () => {
  const s = articleHtmlStats('<h1>T</h1><h2>S</h2><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol><table><tr><td>x</td></tr></table><img src="a.png"><a href="x">link</a><pre>code</pre>');
  assert.deepEqual([s.headings, s.bulletLists, s.orderedLists, s.listItems, s.tables, s.images, s.links, s.codeBlocks], [2, 1, 1, 3, 1, 1, 1, 1]);
  assert.ok(s.textLength > 0 && s.words > 0);
  assert.deepEqual(articleHtmlStats('').headings, 0);
  assert.deepEqual(articleHtmlStats(null).textLength, 0);
  assert.deepEqual(statsToStrings({ a: 1, b: 0 }), { a: '1', b: '0' });
});

// ---- scopes -------------------------------------------------------------------------------------------------

test('knowledge bases come from one aggregate read, biggest first, unnamed groups dropped', async () => {
  const deps = withGroups(fakeDeps(kbTables()), [group(KB_HR, 'HR Knowledge Base', 3), group(KB_IT, 'IT Knowledge Base', 40), group('', '', 5), group(id(0x999), 'Empty', 0)]);
  const { items, access } = await readKnowledgeScopes({}, deps, {});
  assert.deepEqual(items, [{ id: KB_IT, name: 'IT Knowledge Base', count: 40 }, { id: KB_HR, name: 'HR Knowledge Base', count: 3 }]);
  assert.equal(access[0].status, 'ok');
});

test('categories of one knowledge base: the base id is validated, the column and the query are the expected ones', async () => {
  const seen = [];
  const deps = withGroups(fakeDeps(kbTables()), (table, query, column) => {
    seen.push([table, query, column]);
    return [group(CAT_VPN, 'VPN', 2, 'kb_category')];
  });
  const { items } = await readKnowledgeScopes({ knowledgeBase: KB_IT.toUpperCase() }, deps, {});
  assert.deepEqual(items, [{ id: CAT_VPN, name: 'VPN', count: 2 }]);
  assert.deepEqual(seen, [['kb_knowledge', `workflow_state=published^kb_knowledge_base=${KB_IT}`, 'kb_category']]);
  seen.length = 0;
  await readKnowledgeScopes({ knowledgeBase: 'x^ORactive=true' }, deps, {});
  assert.equal(seen[0][1], 'workflow_state=published', 'an invalid id is ignored, never put into a query');
});

test('scopes degrade: a denied aggregate, a hidden table, a lost session', async () => {
  const denied = withGroups(fakeDeps(kbTables()), () => {
    const err = new Error('Your user is not allowed to read this (403)');
    err.code = 'ACCESS_DENIED';
    throw err;
  });
  const out = await readKnowledgeScopes({}, denied, {});
  assert.deepEqual(out.items, []);
  assert.equal(out.access[0].status, 'denied');

  const hidden = withGroups(fakeDeps(kbTables(), { hidden: ['kb_knowledge'] }), []);
  assert.equal((await readKnowledgeScopes({}, hidden, {})).access[0].status, 'empty-or-hidden');
  const none = withGroups(fakeDeps(kbTables()), []);
  assert.equal((await readKnowledgeScopes({}, none, {})).access[0].status, 'empty');

  const expired = withGroups(fakeDeps(kbTables()), () => {
    const err = new Error('expired');
    err.code = 'SESSION_EXPIRED';
    throw err;
  });
  await assert.rejects(readKnowledgeScopes({}, expired, {}), (err) => err.code === 'SESSION_EXPIRED');
});

// ---- the bounded article list ------------------------------------------------------------------------------------

test('the list: published articles of one knowledge base only, titles and counts only, newest change first', async () => {
  const deps = fakeDeps(kbTables());
  const { articles, truncated, total, access } = await readKnowledgeList({ knowledgeBase: KB_IT }, deps, {});
  assert.deepEqual(articles.map((a) => a.number).sort(), ['KB0000001', 'KB0000002', 'KB0000003', 'KB0000004', 'KB0000005']);
  assert.equal(articles.length, 5, 'the draft and the HR article are not in it');
  assert.ok(articles.every((a) => a.knowledgeBase === 'IT Knowledge Base'));
  assert.deepEqual(Object.keys(articles[0]).sort(), ['category', 'knowledgeBase', 'number', 'sysId', 'title', 'updated', 'updatedUtc', 'views']);
  assert.equal(articles.find((a) => a.number === 'KB0000001').views, 340);
  assert.equal(truncated, false);
  assert.equal(total, 5);
  assert.equal(access[0].status, 'ok');
  const call = deps.callsTo('kb_knowledge')[0];
  assert.deepEqual(call.fields, [...KB_LIST_FIELDS]);
  assert.ok(!call.fields.includes('text'));
  assert.ok(call.options.limit <= 300);
  // (Wave 6: the second sort key is a tie-break, so a run of articles changed in the same second pages without overlaps or gaps.)
  assert.equal(call.query, `workflow_state=published^kb_knowledge_base=${KB_IT}^ORDERBYDESCsys_updated_on^ORDERBYDESCsys_id`);
  // newest first
  const updated = articles.map((a) => a.updated);
  assert.deepEqual(updated, [...updated].sort().reverse());
});

test('the list: a category narrows it further; with neither, nothing is read', async () => {
  const deps = fakeDeps(kbTables());
  const narrowed = await readKnowledgeList({ knowledgeBase: KB_IT, category: CAT_VPN }, deps, {});
  assert.deepEqual(narrowed.articles.map((a) => a.number).sort(), ['KB0000001', 'KB0000002', 'KB0000003']);
  const before = deps.callsTo('kb_knowledge').length;
  const none = await readKnowledgeList({}, deps, {});
  assert.deepEqual([none.articles, none.access[0].status], [[], 'skipped']);
  assert.equal(deps.callsTo('kb_knowledge').length, before, 'the empty scope made no read');
});

test('the list is capped at 300 rows and says when more existed', async () => {
  const tables = { kb_knowledge: [] };
  for (let i = 0; i < 350; i += 1) tables.kb_knowledge.push(knowledgeRow(i));
  const deps = fakeDeps(tables);
  const out = await readKnowledgeList({ knowledgeBase: KB_IT }, deps, {});
  assert.equal(out.articles.length, 300);
  assert.equal(out.truncated, true);
  assert.equal(out.total, 350);
  // (Wave 6: "Only the N most recently changed articles were compared (of M)" is the panel's sentence now, with the number compared
  // across ALL pages; the list says where to go on.)
  assert.equal(out.next, 300, 'the next page starts where this window ended');
  assert.equal(out.access[0].note, '');
  assert.equal(deps.callsTo('kb_knowledge')[0].options.limit, 300);
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT }, deps, { max: 5000 })).articles.length, 300, 'a larger max is clamped');
});

function knowledgeRow(i) {
  return {
    sys_id: v(id(0x2000 + i)), number: v(`KB${i}`), short_description: v(`Article ${i}`), workflow_state: v('published', 'Published'),
    kb_knowledge_base: v(KB_IT, 'IT'), kb_category: v(CAT_VPN, 'VPN'), sys_updated_on: v(`2026-01-01 00:${String(i % 60).padStart(2, '0')}:00`), sys_view_count: v('1'),
  };
}

test('the list: an instance that ignores the filter, a denied table, a hidden table', async () => {
  const tables = kbTables();
  // An instance that answered with an article of another knowledge base: it ignored the condition, so nothing is used.
  const ignoring = { queryTable: async () => [{ sys_id: v(id(1)), number: v('KB1'), short_description: v('x'), workflow_state: v('published'), kb_knowledge_base: v(KB_HR, 'HR') }] };
  const out = await readKnowledgeList({ knowledgeBase: KB_IT }, ignoring, {});
  assert.equal(out.articles.length, 0);
  assert.match(out.access[0].note, /did not narrow the results as asked/);
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT }, fakeDeps(tables, { denied: ['kb_knowledge'] }), {})).access[0].status, 'denied');
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT }, fakeDeps(tables, { hidden: ['kb_knowledge'] }), {})).access[0].status, 'empty-or-hidden');
  const emptyScope = await readKnowledgeList({ knowledgeBase: id(0x5555) }, fakeDeps(tables), {});
  assert.equal(emptyScope.access[0].status, 'empty', 'the user sees articles elsewhere, so this scope really is empty');
});

// ---- resolved tickets ------------------------------------------------------------------------------------------

test('resolved tickets: the last 60 days only, short fields only, the close notes reduced to a length', async () => {
  const deps = fakeDeps(ticketTables());
  const { tickets, days, truncated, access } = await readResolvedTickets({ days: 60, tables: ['incident'] }, deps, { now: NOW });
  assert.equal(days, 60);
  assert.equal(truncated, false);
  assert.equal(tickets.length, 7, 'the ticket resolved in May is outside the window');
  assert.ok(tickets.every((t) => t.resolvedUtc >= '2026-08-27'));
  assert.deepEqual(Object.keys(tickets[0]).sort(), ['category', 'ci', 'fixLength', 'kind', 'number', 'resolvedUtc', 'sysId', 'table', 'title', 'who']);
  assert.deepEqual(tickets[0].who, ['Abel Tuter'], 'the name of who raised it, for the privacy filter');
  const first = tickets.find((t) => t.number === 'INC0000001');
  assert.equal(first.fixLength, 'Restarted the gateway profile and renewed the certificate for the user.'.length);
  assert.ok(!JSON.stringify(tickets).includes('Restarted the gateway'), 'the notes themselves are dropped');
  assert.ok(!JSON.stringify(tickets).includes('TICKET-LEAK'));
  assert.equal(tickets.find((t) => t.number === 'INC0000007').fixLength, 0);
  assert.equal(access[0].status, 'ok');
  const call = deps.callsTo('incident')[0];
  assert.deepEqual(call.fields, [...GAP_FIELDS.incident]);
  assert.ok(call.options.limit <= 500);
  assert.match(call.query, /^resolved_atISNOTEMPTY\^resolved_at>=2026-08-27 12:00:00\^ORDERBYDESCresolved_at$/);
});

test('resolved tickets: days are clamped, tables are checked, the 500-row cap is shared between tables', async () => {
  const deps = fakeDeps(ticketTables());
  assert.equal((await readResolvedTickets({ days: 100000, tables: ['incident'] }, deps, { now: NOW })).days, 90);
  assert.equal((await readResolvedTickets({ days: 'x', tables: ['incident'] }, deps, { now: NOW })).days, 60);
  assert.equal((await readResolvedTickets({ days: -5, tables: ['incident'] }, deps, { now: NOW })).days, 1);
  const bad = await readResolvedTickets({ days: 60, tables: ['sn_hr_core_case', 'sys_user', 'incident; drop'] }, deps, { now: NOW });
  assert.deepEqual(bad.tickets, []);
  assert.equal(bad.access[0].status, 'skipped');
  const both = fakeDeps({ incident: [], sn_customerservice_case: [] });
  await readResolvedTickets({ days: 60, tables: ['incident', 'sn_customerservice_case'] }, both, { now: NOW });
  assert.deepEqual([both.callsTo('incident')[0].options.limit, both.callsTo('sn_customerservice_case')[0].options.limit], [250, 250]);
  const one = fakeDeps({ incident: [] });
  await readResolvedTickets({ days: 60, tables: ['incident'] }, one, { now: NOW, max: 100000 });
  assert.equal(one.callsTo('incident')[0].options.limit, 500);
});

test('resolved tickets: truncation is reported; a date filter the instance ignored is not trusted; failures are access notes', async () => {
  const many = { incident: [] };
  for (let i = 0; i < 6; i += 1) many.incident.push({ sys_id: v(incidentId(i + 20)), number: v(`INC${i}`), short_description: v('x'), resolved_at: v('2026-10-20 00:00:00') });
  const capped = await readResolvedTickets({ days: 60, tables: ['incident'] }, fakeDeps(many), { now: NOW, max: 5 });
  assert.equal(capped.tickets.length, 5);
  assert.equal(capped.truncated, true);
  assert.match(capped.access[0].note, /newest 5/);

  const ignoring = { incident: [{ sys_id: v(incidentId(30)), number: v('OLD'), short_description: v('old'), resolved_at: v('2020-01-01 00:00:00') }, { sys_id: v(incidentId(31)), number: v('NEW'), short_description: v('new'), resolved_at: v('2026-10-25 00:00:00') }] };
  // A deps that answers every query with all rows, like an instance that ignored the condition.
  const all = { queryTable: async () => ignoring.incident.map((r) => ({ ...r })) };
  const filtered = await readResolvedTickets({ days: 60, tables: ['incident'] }, all, { now: NOW });
  assert.deepEqual(filtered.tickets.map((t) => t.number), ['NEW']);
  assert.match(filtered.access[0].note, /did not apply the date range as asked/);

  assert.equal((await readResolvedTickets({ tables: ['incident'] }, fakeDeps({}, { denied: ['incident'] }), { now: NOW })).access[0].status, 'denied');
  assert.equal((await readResolvedTickets({ tables: ['incident'] }, fakeDeps({}, { hidden: ['incident'] }), { now: NOW })).access[0].status, 'empty-or-hidden');
  assert.equal((await readResolvedTickets({ tables: ['incident'] }, fakeDeps({ incident: [{ sys_id: v(incidentId(1)), resolved_at: v('2020-01-01 00:00:00') }] }), { now: NOW })).tickets.length, 0);
});

// ---- article links ----------------------------------------------------------------------------------------------

const ticketIds = () => incidentRows().map((r) => r.sys_id.value);

test('links: tickets with an attached article (m2m_kb_task) or a use (kb_use) are found; the rest are not', async () => {
  const deps = fakeDeps(ticketTables());
  const out = await readArticleLinks(ticketIds(), deps, {});
  assert.equal(out.known, true);
  assert.deepEqual([...out.linked].sort(), [incidentId(1), incidentId(4), incidentId(5)].sort());
  assert.deepEqual(out.sources.map((s) => [s.table, s.usable]), [['m2m_kb_task', true], ['kb_use', true]]);
  assert.deepEqual(LINK_SOURCES.map((s) => s.table), ['m2m_kb_task', 'kb_use']);
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'));
});

test('links: ids go in chunks of 40, two reads at a time at most, columns kept to the ticket id', async () => {
  const many = [];
  for (let i = 0; i < 130; i += 1) many.push(incidentId(0x100 + i));
  const deps = fakeDeps({ m2m_kb_task: [{ sys_id: v(id(1)), task: v(many[100]) }], kb_use: [{ sys_id: v(id(2)), task_id: v(many[1]) }] });
  const out = await readArticleLinks(many, deps, {});
  const m2m = deps.callsTo('m2m_kb_task').filter((c) => c.query !== '');
  assert.equal(m2m.length, 4, '130 ids = 4 chunks');
  assert.ok(m2m.every((c) => c.query.split(',').length <= 40 && c.options.limit <= 1000));
  assert.deepEqual(m2m[0].fields, ['sys_id', 'task']);
  assert.deepEqual([...out.linked].sort(), [many[1], many[100]].sort());
});

test('links: when a table cannot be read, the other still counts; when none can, nothing is claimed', async () => {
  const half = await readArticleLinks(ticketIds(), fakeDeps(ticketTables(), { denied: ['m2m_kb_task'] }), {});
  assert.equal(half.known, true);
  assert.deepEqual([...half.linked], [incidentId(5)]);
  assert.equal(half.sources[0].status, 'denied');
  assert.equal(half.sources[0].usable, false);

  const none = await readArticleLinks(ticketIds(), fakeDeps(ticketTables(), { denied: ['m2m_kb_task', 'kb_use'] }), {});
  assert.equal(none.known, false);
  assert.equal(none.linked.size, 0);
  assert.deepEqual(none.access.map((a) => a.status), ['denied', 'denied']);
});

test('links: a table that shows no rows at all is "cannot tell", not "no article"', async () => {
  const hidden = await readArticleLinks(ticketIds(), fakeDeps(ticketTables(), { hidden: ['m2m_kb_task', 'kb_use'] }), {});
  assert.equal(hidden.known, false);
  assert.deepEqual(hidden.sources.map((s) => s.status), ['empty-or-hidden', 'empty-or-hidden']);
  // The table is visible and has links, just none for these tickets: that IS an answer.
  const tables = ticketTables();
  tables.m2m_kb_task = [{ sys_id: v(id(1)), task: v(id(0x9999)) }];
  tables.kb_use = [];
  const visible = await readArticleLinks([incidentId(2), incidentId(3)], fakeDeps(tables), {});
  assert.equal(visible.known, true);
  assert.equal(visible.linked.size, 0);
  assert.equal(visible.sources[0].usable, true);
  assert.equal(visible.sources[1].usable, false, 'kb_use is empty for everyone, so it says nothing');
});

test('links: a table without the task column answers with every row; those rows are not used', async () => {
  const tables = { m2m_kb_task: [{ sys_id: v(id(1)), kb_knowledge: v(id(7)) }], kb_use: [{ sys_id: v(id(2)), task_id: v('f'.repeat(32)) }] };
  // m2m: no task column -> condition ignored -> row has no task. kb_use: a row for a ticket nobody asked about.
  const deps = { queryTable: async (table) => tables[table].map((r) => ({ ...r })) };
  const out = await readArticleLinks([incidentId(1)], deps, {});
  assert.equal(out.known, false);
  assert.equal(out.linked.size, 0);
  assert.ok(out.sources.every((s) => s.status === 'error' && /did not narrow the results as asked/.test(s.note)));
});

test('links: nothing asked, nothing read; bad ids are dropped before they reach a query', async () => {
  const deps = fakeDeps(ticketTables());
  assert.equal((await readArticleLinks([], deps, {})).known, false);
  assert.equal((await readArticleLinks(['nope', 'a^ORb'], deps, {})).known, false);
  assert.equal(deps.calls.length, 0);
  await readArticleLinks([incidentId(1).toUpperCase(), 'zz'], deps, {});
  assert.ok(deps.callsTo('m2m_kb_task').every((c) => c.query === '' || c.query === `taskIN${incidentId(1)}`));
});

test('links: a lost session stops the whole read', async () => {
  await assert.rejects(readArticleLinks(ticketIds(), fakeDeps(ticketTables(), { expired: ['m2m_kb_task'] }), {}), (err) => err.code === 'SESSION_EXPIRED');
});
