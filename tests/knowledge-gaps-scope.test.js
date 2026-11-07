import test from 'node:test';
import assert from 'node:assert/strict';
import knowledgeOps from '../src/content/ops/knowledge.js';
import { GAP_FIELDS, cleanCategory, readGapCategories, readKnowledgeList, readMyGroups, readResolvedTickets, scopeCondition } from '../src/context/knowledge.js';
import { FEATURE_FIELDS, FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { toCsv } from '../src/lib/export.js';
import { mergePages } from '../src/sidepanel/knowledge/DuplicatesPanel.jsx';
import { lookedAtText, scopeWords } from '../src/sidepanel/knowledge/GapsPanel.jsx';
import { DUPLICATE_COLUMNS, TOPIC_COLUMNS, duplicateRows, exportFileName, topicRows } from '../src/sidepanel/knowledgeScreen/articleInfo.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { KB_IT, NOW, articleRow, id, incidentId, incidentRows, linkTables } from './knowledge-fixtures.js';

// N18 and N19 (round 3): the duplicate finder pages through more titles; the gap radar can be limited to my groups or one category,
// says "500 of 12,400", and both export what they found.

const NET = id(0x901);
const DESK = id(0x902);
const ME = id(0x903);

// The fixture incidents, half in the Network group and half at the Service Desk.
function groupedIncidents() {
  return incidentRows().map((row, i) => ({ ...row, assignment_group: v(i % 2 ? DESK : NET, i % 2 ? 'Service Desk' : 'Network Support') }));
}

// The fake understands the "Me" dynamic filter only as far as these tests need: my memberships, or (ignored) everyone's.
function withMemberships(deps, { rows = [{ user: v(ME, 'Beth Anglin'), group: v(NET, 'Network Support') }], ignore = false } = {}) {
  const queryTable = deps.queryTable;
  deps.queryTable = async (table, query, fields, options) => {
    if (table === 'sys_user_grmember') {
      deps.calls.push({ fn: 'queryTable', table, query, fields: [...fields], options: { ...options } });
      return ignore ? [...rows, { user: v(id(0x999), 'Someone Else'), group: v(DESK, 'Service Desk') }] : rows;
    }
    return queryTable(table, query, fields, options);
  };
  return deps;
}

const gapDeps = (extra = {}) => fakeDeps({ incident: groupedIncidents(), ...linkTables(), ...extra });

test('a scope is a condition and a row check: my groups by sys_id, a category by its plain value', () => {
  const groups = scopeCondition({ groups: [NET, 'not-an-id', NET.toUpperCase(), DESK] });
  assert.equal(groups.query, `assignment_groupIN${NET},${DESK}`);
  assert.equal(groups.accepts({ assignment_group: v(NET) }), true);
  assert.equal(groups.accepts({ assignment_group: v(id(0x904)) }), false);
  assert.equal(scopeCondition({ groups: [] }).ok, false, 'no group: nothing to read');
  const category = scopeCondition({ category: 'network' });
  assert.equal(category.query, 'category=network');
  assert.equal(category.accepts({ category: v('network', 'Network') }), true);
  assert.equal(category.accepts({ category: v('email', 'Email') }), false);
  for (const bad of ['net^work', 'javascript:alert(1)', '', ' ', 'a'.repeat(90), 'x\ny']) assert.equal(scopeCondition({ category: bad }).ok, false, JSON.stringify(bad));
  assert.equal(cleanCategory('Hardware & Peripherals'), 'Hardware & Peripherals');
  assert.equal(scopeCondition(null).query, '');
});

test('the radar reads only the tickets of the scope, checks every row against it, and counts the window', async () => {
  const deps = gapDeps();
  const mine = await readResolvedTickets({ days: 60, tables: ['incident'], scope: { groups: [NET] } }, deps, { now: NOW });
  assert.ok(mine.tickets.length > 0);
  assert.ok(deps.callsTo('incident')[0].query.includes(`^assignment_groupIN${NET}^ORDERBYDESC`));
  assert.deepEqual(deps.callsTo('incident')[0].fields, [...GAP_FIELDS.incident]);
  const all = await readResolvedTickets({ days: 60, tables: ['incident'] }, gapDeps(), { now: NOW });
  assert.ok(mine.tickets.length < all.tickets.length);
  assert.equal(all.total, all.tickets.length, 'not cut short: the total is what was read');
  const cat = await readResolvedTickets({ days: 60, tables: ['incident'], scope: { category: 'hardware' } }, gapDeps(), { now: NOW });
  assert.deepEqual(cat.tickets.map((t) => t.category), ['Hardware', 'Hardware']);
  // An instance that ignores the scope answers with every ticket: none of them is used.
  const ignoring = gapDeps();
  const queryTable = ignoring.queryTable;
  ignoring.queryTable = (table, query, fields, options) => queryTable(table, table === 'incident' ? query.replace(/\^assignment_groupIN[^^]+/, '') : query, fields, options);
  const out = await readResolvedTickets({ days: 60, tables: ['incident'], scope: { groups: [NET] } }, ignoring, { now: NOW });
  assert.deepEqual(out.tickets, []);
  assert.match(out.access[0].note, /did not narrow the results as asked/);
  assert.equal(out.total, null);
});

test('"500 of 12,400": when the read is cut short, the window\'s total is counted', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ sys_id: v(incidentId(40 + i)), number: v(`INC9${i}`), short_description: v(`VPN problem ${i}`), resolved_at: v('2026-10-20 09:00:00'), assignment_group: v(NET) }));
  const deps = fakeDeps({ incident: rows, ...linkTables() });
  const out = await readResolvedTickets({ days: 60, tables: ['incident'] }, deps, { now: NOW, max: 5 });
  assert.equal(out.tickets.length, 5);
  assert.equal(out.truncated, true);
  assert.equal(out.total, 12);
  assert.ok(deps.callsTo('incident').some((c) => c.options.limit === 100000), 'the window was counted (the fake counts by reading every row)');
});

test('my groups: one read of my own memberships through the "Me" filter; rows of several people are not believed', async () => {
  const deps = withMemberships(fakeDeps({}));
  assert.deepEqual(await readMyGroups(deps), { groups: [{ id: NET, name: 'Network Support' }], access: [{ source: 'sys_user_grmember', status: 'ok', note: '' }] });
  assert.equal(deps.callsTo('sys_user_grmember')[0].query, 'userDYNAMIC90d1921e5f510100a9ad2572f2b477fe');
  const ignored = await readMyGroups(withMemberships(fakeDeps({}), { ignore: true }));
  assert.deepEqual(ignored.groups, []);
  assert.match(ignored.access[0].note, /Could not tell which groups are yours/);
  const none = await readMyGroups(withMemberships(fakeDeps({}), { rows: [] }));
  assert.equal(none.access[0].status, 'empty');
  const denied = await readMyGroups(fakeDeps({}, { denied: ['sys_user_grmember'] }));
  assert.equal(denied.access[0].status, 'denied');
});

test('the scope picker\'s categories and total come from one count per table, merged across incidents and cases', async () => {
  const deps = fakeDeps({});
  const asked = [];
  deps.countByColumn = async (table, query, column) => {
    asked.push([table, query, column]);
    return table === 'incident'
      ? [{ stats: { count: '30' }, groupby_fields: [{ field: 'category', value: 'network', display_value: 'Network' }] }, { stats: { count: '5' }, groupby_fields: [{ field: 'category', value: '', display_value: '' }] }, { stats: { count: '2' }, groupby_fields: [{ field: 'category', value: 'bad^value', display_value: 'Bad' }] }]
      : [{ stats: { count: '10' }, groupby_fields: [{ field: 'category', value: 'network', display_value: 'Network' }] }];
  };
  const out = await readGapCategories({ days: 30, tables: ['incident', 'sn_customerservice_case'] }, deps, { now: NOW });
  assert.deepEqual(out, { total: 47, categories: [{ value: 'network', name: 'Network', count: 40 }], access: [] });
  assert.deepEqual(asked.map((a) => a[2]), ['category', 'category']);
  assert.match(asked[0][1], /^resolved_atISNOTEMPTY\^resolved_at>=2026-09-26 12:00:00$/);
  const failing = fakeDeps({});
  failing.countByColumn = async () => {
    throw new Error('403 forbidden');
  };
  const denied = await readGapCategories({ tables: ['incident'] }, failing, { now: NOW });
  assert.deepEqual([denied.total, denied.categories, denied.access[0].status], [null, [], 'denied']);
});

test('the kbGaps op: "my groups" reads my memberships first; a category is checked; nonsense is refused', async () => {
  const deps = withMemberships(gapDeps());
  const mine = await knowledgeOps.kbGaps({ days: 60, scope: 'mine' }, { deps });
  assert.deepEqual(mine.scope, { kind: 'mine', groups: 1 });
  assert.ok(mine.scanned > 0);
  assert.ok(Number.isFinite(mine.total));
  const noGroups = await knowledgeOps.kbGaps({ scope: 'mine' }, { deps: withMemberships(gapDeps(), { rows: [] }) });
  assert.deepEqual([noGroups.scanned, noGroups.clusters], [0, []]);
  assert.match(noGroups.access[0].note, /not a member of any group/);
  const cat = await knowledgeOps.kbGaps({ scope: 'category', category: 'network' }, { deps: gapDeps() });
  assert.deepEqual(cat.scope, { kind: 'category', category: 'network' });
  await assert.rejects(() => knowledgeOps.kbGaps({ scope: 'category', category: 'x^y' }, { deps: gapDeps() }), /not a category/);
  await assert.rejects(() => knowledgeOps.kbGaps({ scope: 'everyone' }, { deps: gapDeps() }), /not a scope/);
  const all = await knowledgeOps.kbGaps({}, { deps: gapDeps() });
  assert.deepEqual(all.scope, { kind: 'all' });
  const scopesDeps = withMemberships(gapDeps());
  const scopes = await knowledgeOps.kbGapScopes({ days: 999, tables: ['incident'] }, { deps: scopesDeps });
  assert.equal(scopes.days, 90, 'the window is clamped');
  assert.equal(scopesDeps.callsTo('sys_user_grmember').length, 0, 'the groups are read only when "My groups" is used');
  await assert.rejects(() => knowledgeOps.kbGapScopes({ tables: ['sn_hr_core_case'] }, { deps: gapDeps() }), /incidents or cases/);
});

test('the gap radar\'s reads stay inside the ceilings, assignment group included', () => {
  for (const [table, kind] of [['incident', 'incident'], ['sn_customerservice_case', 'case']]) {
    assert.ok(GAP_FIELDS[table].includes('assignment_group'));
    for (const name of GAP_FIELDS[table].filter((n) => n !== 'sys_id')) {
      assert.ok(FIELDS_BY_KIND[kind].includes(name), `${table}: ${name}`);
      assert.ok(FEATURE_FIELDS['kb-gap-outline'][kind].includes(name), `kb-gap-outline spec ${kind}: ${name}`);
    }
  }
});

test('the duplicate finder pages through titles: an offset, "more follow" from the count, and the panel compares all pages', async () => {
  const many = Array.from({ length: 7 }, (_, i) => articleRow({ n: 20 + i, title: `Reset VPN password variant ${i}`, updated: `2026-09-${String(10 + i).padStart(2, '0')} 08:00:00` }));
  const deps = fakeDeps({ kb_knowledge: many });
  const first = await readKnowledgeList({ knowledgeBase: KB_IT }, deps, { max: 3 });
  assert.deepEqual([first.articles.length, first.total, first.truncated, first.offset], [3, 7, true, 0]);
  const second = await readKnowledgeList({ knowledgeBase: KB_IT, offset: 3 }, deps, { max: 3 });
  assert.equal(deps.callsTo('kb_knowledge').filter((c) => c.fn === 'queryTable' && c.options.limit === 3)[1].options.offset, 3);
  assert.deepEqual(second.articles.map((a) => a.number), ['KB0000023', 'KB0000022', 'KB0000021']);
  const last = await readKnowledgeList({ knowledgeBase: KB_IT, offset: 6 }, deps, { max: 3 });
  assert.deepEqual([last.articles.length, last.truncated], [1, false]);
  const past = await readKnowledgeList({ knowledgeBase: KB_IT, offset: 9 }, deps, { max: 3 });
  assert.deepEqual([past.articles, past.truncated, past.access[0].status], [[], false, 'ok']);
  const clamped = await readKnowledgeList({ knowledgeBase: KB_IT, offset: 999999 }, fakeDeps({ kb_knowledge: many }));
  assert.equal(clamped.offset, 1200);
  const merged = mergePages([first.articles, second.articles, first.articles]);
  assert.equal(merged.length, 6, 'an article read twice counts once');
  const op = await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, offset: 3 }, { deps: fakeDeps({ kb_knowledge: many }) });
  assert.equal(op.offset, 3);
  assert.ok(Array.isArray(op.articles) && op.articles.every((a) => !('text' in a)), 'titles only');
});

// (Wave 6, knowledge manager: the "Compared N of M titles." line is now "Compared N of M articles in {scope}." with a verdict that is only
// "No duplicates found." when everything was compared; those lines are tested in tests/km-coverage.test.js.)
test('the summary line of the radar: how many tickets of how many in which scope', () => {
  assert.equal(lookedAtText({ scanned: 500, total: 12400, days: 60 }, 'in your 3 groups'), 'Looked at 500 of 12,400 tickets resolved in the last 60 days in your 3 groups.');
  assert.equal(lookedAtText({ scanned: 4, total: 4, days: 30 }), 'Looked at 4 tickets resolved in the last 30 days.');
  assert.equal(scopeWords({ kind: 'mine', groups: 1 }), 'in your group');
  assert.equal(scopeWords({ kind: 'category', category: 'network' }, [{ value: 'network', name: 'Network' }]), 'in category Network');
  assert.equal(scopeWords({ kind: 'all' }), '');
});

test('exports: duplicate groups one row per article, topics one row each with ticket numbers only; CSV is formula-safe', () => {
  const clusters = [{ keep: { sysId: 'a' }, articles: [{ sysId: 'a', number: 'KB1', title: '=cmd|calc', knowledgeBase: 'IT', category: 'VPN', views: 5, updated: '2026-10-01' }, { sysId: 'b', number: 'KB2', title: 'Reset, VPN', views: 1 }] }];
  const rows = duplicateRows(clusters);
  assert.deepEqual(rows.map((r) => [r.Group, r.Number, r['Suggested to keep']]), [['1', 'KB1', 'yes'], ['1', 'KB2', '']]);
  const csv = toCsv(rows, DUPLICATE_COLUMNS);
  assert.ok(csv.startsWith('Group,Number,Title,Knowledge base,Category,Views,Last changed,Suggested to keep'));
  assert.ok(csv.includes("'=cmd|calc"), 'a title that looks like a formula is defused');
  assert.ok(csv.includes('"Reset, VPN"'));
  const topics = topicRows([{ label: 'VPN + disconnect', count: 3, withFix: 2, category: 'Network', ci: 'VPN GW', examples: [{ number: 'INC1', title: 'Abel Tuter cannot connect' }, { number: 'INC2', title: 'x' }] }]);
  assert.deepEqual(topics, [{ Topic: 'VPN + disconnect', Tickets: '3', 'With a written fix': '2', Category: 'Network', 'Configuration item': 'VPN GW', 'Example tickets': 'INC1 INC2' }]);
  assert.ok(!toCsv(topics, TOPIC_COLUMNS).includes('Abel'), 'ticket titles (which can name a person) are not exported');
  assert.equal(exportFileName('knowledge-gaps', Date.UTC(2026, 9, 30)), 'knowledge-gaps-2026-10-30.csv');
  assert.deepEqual(duplicateRows(null), []);
});
