import test from 'node:test';
import assert from 'node:assert/strict';
import { readContextPack } from '../src/context/pack.js';
import { findOpenDuplicates, findSimilarTickets, scoreArticle, scoreHit, searchKeywords, searchKnowledge } from '../src/context/similar.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { HR_CASE_ID } from './fixtures/sn-hr-case.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

const incidentPack = async (tables = buildInstance(), feature = 'similar') =>
  readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(tables), { feature });

// ---- Keywords ---------------------------------------------------------------------------------------------------

test('search words skip emails, phone numbers, links and the names of the people on the record', async () => {
  const pack = {
    fields: { short_description: 'VPN keeps disconnecting for Abel Tuter (abel.tuter@example.com) call +1 555-0134 see https://kb.example.com/vpn' },
    people: [{ name: 'Abel Tuter', firstName: 'Abel', lastName: 'Tuter' }],
  };
  assert.deepEqual(searchKeywords(pack), ['vpn', 'disconnecting', 'keeps', 'call']);
  assert.deepEqual(searchKeywords({ fields: { short_description: 'Printer jam' } }), ['printer', 'jam']);
  assert.deepEqual(searchKeywords({ fields: {} }), []);
});

// ---- Similar tickets --------------------------------------------------------------------------------------------

test('scoreHit: overlap, same CI, same category and documented fix add up, capped at 100', () => {
  const pack = { fields: { cmdb_ci: 'VPN Gateway EU', category: 'Network' } };
  const base = { shared: 3, total: 4, words: ['vpn', 'keeps', 'disconnecting'] };
  const full = scoreHit({ ...base, item: { cmdb_ci: 'vpn gateway eu', category: 'Network', close_notes: 'fixed' } }, pack);
  assert.equal(full.score, 80);
  assert.deepEqual(full.why, ['shares vpn, keeps, disconnecting', 'same CI (vpn gateway eu)', 'same category (Network)', 'has resolution notes']);
  const none = scoreHit({ ...base, shared: 1, total: 4, words: ['vpn'], item: { cmdb_ci: 'Other', category: 'Hardware', close_notes: '' } }, pack);
  assert.equal(none.score, 15);
  assert.deepEqual(none.why, ['shares vpn']);
  assert.equal(scoreHit({ ...base, shared: 4, total: 4, item: { cmdb_ci: 'VPN Gateway EU', category: 'Network', close_notes: 'x' } }, pack).score, 95);
  const catalog = scoreHit({ shared: 1, total: 2, words: ['laptop'], item: { cat_item: 'Standard Laptop', close_notes: '' } }, { fields: { cat_item: 'Standard Laptop' } });
  assert.deepEqual(catalog.why, ['shares laptop', 'same catalog item (Standard Laptop)']);
});

test('similar tickets are ranked, boosted by CI and category, and never include the ticket itself', async () => {
  const pack = await incidentPack(buildInstance(), 'record-summary'); // has the people, so the caller's name is not a search word
  const deps = fakeDeps(buildInstance());
  const { hits, keywords, access } = await findSimilarTickets(pack, deps);
  assert.deepEqual(keywords, ['vpn', 'disconnecting', 'keeps']);
  assert.equal(hits[0].number, 'INC0009001');
  assert.equal(hits[0].score, 95);
  assert.deepEqual(hits[0].why, ['shares vpn, disconnecting, keeps', 'same CI (VPN Gateway EU)', 'same category (Network)', 'has resolution notes']);
  assert.ok(!hits.some((h) => h.number === 'INC0010001'));
  assert.ok(!hits.some((h) => h.number === 'INC0008900'), 'a ticket sharing no word is not a hit');
  assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score), 'best first');
  assert.deepEqual(access.map((a) => [a.source, a.status]), [['incident', 'ok']]);

  const shape = hits[0];
  assert.deepEqual(Object.keys(shape).sort(), ['category', 'close_code', 'close_notes', 'cmdb_ci', 'cat_item', 'number', 'product', 'resolved_at', 'score', 'short_description', 'state', 'sysId', 'table', 'why'].sort());
  assert.equal(shape.close_notes, 'Reinstalled the VPN client v5.2 and cleared the cached profile. Verified stable for 24h.');
  assert.equal(shape.close_code, 'Solution provided');
  assert.equal(shape.state, 'Closed');
});

test('same CI outranks the same word on another CI', async () => {
  const pack = await incidentPack();
  const { hits } = await findSimilarTickets(pack, fakeDeps(buildInstance()), { limit: 20 });
  const eu = hits.find((h) => h.number === 'INC0008800'); // VPN Gateway EU, Network
  const us = hits.find((h) => h.number === 'INC0008812'); // VPN Gateway US, Network, no notes
  assert.ok(eu.score > us.score);
  assert.ok(eu.why.includes('same CI (VPN Gateway EU)'));
  assert.ok(!us.why.some((w) => w.startsWith('same CI')));
});

test('resolvedOnly keeps tickets with a documented fix, in the query and in the result', async () => {
  const pack = await incidentPack();
  const deps = fakeDeps(buildInstance());
  const { hits } = await findSimilarTickets(pack, deps, { resolvedOnly: true, limit: 20 });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.close_notes));
  assert.ok(!hits.some((h) => h.number === 'INC0008812'));
  const query = deps.callsTo('incident')[0].query;
  assert.match(query, /\^close_notesISNOTEMPTY\^ORDERBYDESCsys_updated_on$/);
  assert.ok(query.includes(`sys_id!=${INCIDENT_ID}`));
});

test('the limit applies', async () => {
  const pack = await incidentPack();
  const { hits } = await findSimilarTickets(pack, fakeDeps(buildInstance()), { limit: 2 });
  assert.equal(hits.length, 2);
});

test('similar tickets: nothing to search, a denied table, a sensitive table', async () => {
  const noWords = await findSimilarTickets({ table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'Help please' }, people: [] }, fakeDeps(buildInstance()));
  assert.deepEqual(noWords.hits, []);
  assert.equal(noWords.access[0].status, 'skipped');

  const denied = await findSimilarTickets(await incidentPack(), fakeDeps(buildInstance(), { denied: ['incident'] }));
  assert.equal(denied.access[0].status, 'denied');

  const hrDeps = fakeDeps(buildInstance());
  const hrPack = { table: 'sn_hr_core_case', sysId: HR_CASE_ID, fields: { short_description: 'Leave request' }, people: [] };
  const hr = await findSimilarTickets(hrPack, hrDeps);
  assert.equal(hr.access[0].status, 'skipped');
  assert.equal(hrDeps.calls.length, 0, 'other people\'s HR cases are not searched');
});

test('similar tickets: nothing matches is "empty" on the ticket\'s own table', async () => {
  const pack = await incidentPack();
  const tables = buildInstance();
  tables.incident = tables.incident.filter((r) => r.number.value === 'INC0010001');
  const { hits, access } = await findSimilarTickets(pack, fakeDeps(tables));
  assert.deepEqual(hits, []);
  assert.equal(access[0].status, 'empty');
});

// ---- Open duplicates --------------------------------------------------------------------------------------------

test('open duplicates: same CI or service, still open, inside the window, best match first', async () => {
  const pack = await incidentPack();
  const deps = fakeDeps(buildInstance());
  const { hits, windowHours, access } = await findOpenDuplicates(pack, deps, { now: NOW });
  assert.equal(windowHours, 24);
  assert.deepEqual(hits.map((h) => [h.number, h.same]), [
    ['INC0010002', ['cmdb_ci', 'business_service']],
    ['INC0010004', ['business_service']],
  ]);
  assert.equal(hits[0].hoursAgo, 4.5);
  assert.equal(hits[0].state, 'New');
  assert.equal(hits[0].opened_at, '2026-10-26 09:30:00', 'as the user sees it');
  assert.ok(!hits.some((h) => h.number === 'INC0010001'), 'not the ticket itself');
  assert.ok(!hits.some((h) => h.number === 'INC0009588'), 'opened weeks ago');
  assert.deepEqual(access.map((a) => [a.source, a.status]), [['incident', 'ok']]);
  const queries = deps.callsTo('incident').map((c) => c.query);
  assert.equal(queries[0], `cmdb_ci.name=VPN Gateway EU^active=true^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`);
  assert.equal(queries[1], `business_service.name=Remote Access^active=true^sys_id!=${INCIDENT_ID}^ORDERBYDESCopened_at`);
});

test('the window decides: 48 hours also finds the ticket from yesterday, 1 hour finds nothing', async () => {
  const pack = await incidentPack();
  const wide = await findOpenDuplicates(pack, fakeDeps(buildInstance()), { now: NOW, windowHours: 48 });
  assert.ok(wide.hits.some((h) => h.number === 'INC0010003'));
  const narrow = await findOpenDuplicates(pack, fakeDeps(buildInstance()), { now: NOW, windowHours: 1 });
  assert.deepEqual(narrow.hits, []);
  assert.equal(narrow.access[0].status, 'empty');
});

test('open duplicates need a CI or a service, a readable table, and respect sensitivity', async () => {
  const bare = await findOpenDuplicates({ table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'x' } }, fakeDeps(buildInstance()), { now: NOW });
  assert.equal(bare.access[0].status, 'skipped');

  const denied = await findOpenDuplicates(await incidentPack(), fakeDeps(buildInstance(), { denied: ['incident'] }), { now: NOW });
  assert.equal(denied.hits.length, 0);
  assert.equal(denied.access[0].status, 'denied');

  const hr = await findOpenDuplicates({ table: 'sn_hr_core_case', sysId: HR_CASE_ID, fields: { cmdb_ci: 'x' } }, fakeDeps(buildInstance()), { now: NOW });
  assert.equal(hr.access[0].status, 'skipped');
});

test('rows of other CIs are not duplicates when the instance ignored the condition', async () => {
  const pack = await incidentPack();
  const tables = buildInstance();
  // without a cmdb_ci/business_service column on any row the dotted conditions are ignored and every active ticket comes back
  tables.incident = tables.incident.map(({ cmdb_ci, business_service, ...rest }) => rest);
  const { hits, access } = await findOpenDuplicates(pack, fakeDeps(tables), { now: NOW });
  assert.deepEqual(hits, []);
  assert.equal(access[0].status, 'error');
  assert.match(access[0].note, /did not apply the filter/);
});

test('open duplicates: a CI name with a caret in it is not put into a query', async () => {
  const deps = fakeDeps(buildInstance());
  const { hits, access } = await findOpenDuplicates({ table: 'incident', sysId: INCIDENT_ID, fields: { cmdb_ci: 'a^b' } }, deps, { now: NOW });
  assert.deepEqual(hits, []);
  assert.equal(access[0].status, 'skipped');
  assert.equal(deps.calls.length, 0);
});

// ---- Knowledge --------------------------------------------------------------------------------------------------

test('scoreArticle: a word in the title counts double a word in the text', () => {
  const { score, why } = scoreArticle({ title: 'Troubleshooting VPN disconnects', body: 'The VPN keeps disconnecting' }, ['vpn', 'disconnecting', 'keeps', 'timeout']);
  assert.equal(score, 50);
  assert.deepEqual(why, ['title mentions vpn', 'text mentions disconnecting, keeps']);
  assert.equal(scoreArticle({ title: 'x', body: 'y' }, ['vpn']).score, 0);
});

test('knowledge: published, current, ranked by overlap, with a plain-text excerpt', async () => {
  const pack = await incidentPack(buildInstance(), 'kb-recs');
  const deps = fakeDeps(buildInstance());
  const { hits, access } = await searchKnowledge(pack, deps, { now: NOW });
  assert.deepEqual(hits.map((h) => h.number), ['KB0010001', 'KB0010002']);
  assert.ok(!hits.some((h) => h.number === 'KB0010003'), 'expired articles are dropped');
  assert.ok(!hits.some((h) => h.number === 'KB0010005'), 'drafts never match the query');
  assert.ok(!hits.some((h) => h.number === 'KB0010004'), 'unrelated');

  const top = hits[0];
  assert.equal(top.short_description, 'Troubleshooting VPN disconnects');
  assert.equal(top.knowledgeBase, 'IT Knowledge Base');
  assert.equal(top.viewCount, 482);
  assert.ok(top.score > hits[1].score);
  assert.match(top.excerpt, /^Symptoms\n\nThe VPN keeps disconnecting every few minutes\./);
  assert.ok(!/<[a-z]/i.test(top.excerpt));
  assert.deepEqual(access.map((a) => [a.source, a.status]), [['kb_knowledge', 'ok']]);

  const query = deps.callsTo('kb_knowledge')[0].query;
  assert.ok(query.startsWith('workflow_state=published^'));
  assert.ok(query.includes('short_descriptionLIKEvpn^ORtextLIKEvpn'));
  assert.deepEqual(deps.callsTo('kb_knowledge')[0].fields.slice(0, 5), ['sys_id', 'number', 'short_description', 'text', 'sys_updated_on']);
});

test('knowledge excerpts are capped at 600 characters after the HTML is gone', async () => {
  const tables = buildInstance();
  tables.kb_knowledge[0].text = v(`<p>VPN ${'long '.repeat(500)}</p>`);
  const { hits } = await searchKnowledge(await incidentPack(), fakeDeps(tables), { now: NOW });
  const long = hits.find((h) => h.number === 'KB0010001');
  assert.ok(long.excerpt.length <= 600 && long.excerpt.length > 590);
  assert.ok(long.excerpt.endsWith('…'));
  assert.ok(!long.excerpt.includes('<'));
});

test('knowledge: the limit, and view count breaks ties', async () => {
  const pack = await incidentPack();
  const limited = await searchKnowledge(pack, fakeDeps(buildInstance()), { now: NOW, limit: 1 });
  assert.equal(limited.hits.length, 1);

  const tables = buildInstance();
  tables.kb_knowledge[0].text = v('<p>nothing relevant</p>');
  const { hits } = await searchKnowledge(pack, fakeDeps(tables), { now: NOW });
  assert.deepEqual(hits.map((h) => h.number), ['KB0010002', 'KB0010001'], 'equal title match: the more viewed article first');
});

test('knowledge: hidden and denied tables are not "no articles"', async () => {
  const pack = await incidentPack();
  const hidden = await searchKnowledge(pack, fakeDeps(buildInstance(), { hidden: ['kb_knowledge'] }), { now: NOW });
  assert.deepEqual(hidden.hits, []);
  assert.equal(hidden.access[0].status, 'empty-or-hidden');
  const denied = await searchKnowledge(pack, fakeDeps(buildInstance(), { denied: ['kb_knowledge'] }), { now: NOW });
  assert.equal(denied.access[0].status, 'denied');
  const none = await searchKnowledge({ fields: { short_description: 'Zebra stripes' }, people: [] }, fakeDeps(buildInstance()), { now: NOW });
  assert.deepEqual(none.hits, []);
  assert.equal(none.access[0].status, 'empty', 'the knowledge base is visible, it simply has nothing on this');
  const empty = await searchKnowledge({ fields: {}, people: [] }, fakeDeps(buildInstance()), { now: NOW });
  assert.equal(empty.access[0].status, 'skipped');
});
