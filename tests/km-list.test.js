import test from 'node:test';
import assert from 'node:assert/strict';
import knowledgeOps from '../src/content/ops/knowledge.js';
import { KB_MAX_OFFSET, readKnowledgeList, readKnowledgeScopes, readResolvedTickets } from '../src/context/knowledge.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { KB_IT, NOW, id, incidentId, incidentRows } from './knowledge-fixtures.js';
import { CAT_MAIL, kbBase } from './km-fixtures.js';

// Wave 6, knowledge manager: the duplicate finder on a knowledge base of a real size. The list says how many articles the scope holds
// (ONE count, read on the first page and handed back after), whether more follow, and where to go on; a page that comes back short
// (a row rule hides some of its rows) does not end the scan; the cap says so; a count that cannot be read is "unknown", never zero.

const CAT_B = CAT_MAIL;

const base = kbBase;

/** The reads of a scan, page by page, the way the panel makes them: each later page is told the count of the first. */
async function scan(deps, args = {}) {
  const pages = [];
  let offset = 0;
  let total;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, ...args, offset, ...(total === undefined ? {} : { total }) }, { deps });
    pages.push(page);
    if (page.next === null) break;
    ({ next: offset, total } = page);
  }
  return pages;
}

const counts = (deps) => deps.calls.filter((c) => c.options.limit === 100000).length;

test('a base of 700: three pages (300, 300, 100), the scope counted once, each page says where the next starts', async () => {
  const deps = fakeDeps({ kb_knowledge: base(700) });
  const pages = await scan(deps);
  assert.deepEqual(pages.map((p) => p.scanned), [300, 300, 100]);
  assert.deepEqual(pages.map((p) => p.total), [700, 700, 700]);
  assert.deepEqual(pages.map((p) => p.truncated), [true, true, false]);
  assert.deepEqual(pages.map((p) => p.next), [300, 600, null]);
  assert.equal(counts(deps), 1, 'ONE count for the whole scan: the later pages were told the number');
  const seen = pages.flatMap((p) => p.articles.map((a) => a.sysId));
  assert.equal(new Set(seen).size, 700, 'no article twice, none skipped');
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'), 'reads only');
});

test('the count is read on the first page and not again when the page is told the total', async () => {
  const deps = fakeDeps({ kb_knowledge: base(700) });
  await readKnowledgeList({ knowledgeBase: KB_IT }, deps, {});
  assert.equal(counts(deps), 1);
  await readKnowledgeList({ knowledgeBase: KB_IT, offset: 300, total: 700 }, deps, {});
  assert.equal(counts(deps), 1, 'a known total is not counted again');
  const small = fakeDeps({ kb_knowledge: base(5) });
  const out = await readKnowledgeList({ knowledgeBase: KB_IT }, small, {});
  assert.deepEqual([out.total, out.truncated, out.next], [5, false, null], 'a scope that fits in one page is counted too: "5 of 5", not a guess');
  assert.equal(counts(small), 1);
});

test('a page that comes back short (a row rule hides some of its rows) does not end the scan: the window moves on, the count decides', async () => {
  const rows = base(1000);
  // The instance returns only two of every three rows of a window (the others are hidden from this person) but counts all 1,000.
  const hiding = fakeDeps({ kb_knowledge: rows });
  const inner = hiding.queryTable;
  hiding.queryTable = async (table, query, fields, options) => {
    const out = await inner(table, query, fields, options);
    return options.limit === 100000 ? out : out.filter((_, i) => i % 3 !== 2);
  };
  const pages = await scan(hiding);
  assert.deepEqual(pages.map((p) => p.scanned), [200, 200, 200, 67], 'two thirds of each window of 300 (and of the last 100)');
  assert.deepEqual(pages.map((p) => p.next), [300, 600, 900, null], 'the next window starts after the last one, not after the rows that were seen');
  assert.ok(pages.every((p) => p.total === 1000), 'the count is the instance\'s: it still says 1,000');
  const seen = pages.flatMap((p) => p.articles.map((a) => a.sysId));
  assert.equal(new Set(seen).size, 667, 'what was read (667) is less than the count (1,000): the panel says so');
});

test('one scan stops at 1,500 titles: truncated, and no next', async () => {
  const deps = fakeDeps({ kb_knowledge: base(1700) });
  const pages = await scan(deps);
  assert.equal(pages.length, 5);
  assert.deepEqual(pages.map((p) => p.offset), [0, 300, 600, 900, 1200]);
  const last = pages[4];
  assert.deepEqual([last.truncated, last.next, last.total], [true, null, 1700], 'more exist, but one scan cannot go further');
  assert.equal(KB_MAX_OFFSET, 1200);
  // a request past the cap is held at it
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT, offset: 5000 }, fakeDeps({ kb_knowledge: base(1700) }), {})).offset, 1200);
});

test('a category is a scan of its own: its articles only, its own count', async () => {
  const deps = fakeDeps({ kb_knowledge: base(900) });
  const pages = await scan(deps, { category: CAT_B });
  assert.deepEqual(pages.map((p) => p.total), [300, 300].slice(0, pages.length).map(() => 300));
  assert.equal(pages.length, 1, 'a third of 900 fits in one page');
  assert.equal(pages[0].scanned, 300);
  assert.ok(pages[0].articles.every((a) => a.category === 'Email'));
});

test('a count that cannot be read is unknown, never zero: a full page still says more follow, a short one does not', async () => {
  const failing = (n) => {
    const deps = fakeDeps({ kb_knowledge: base(n) });
    deps.countRecords = async () => {
      throw Object.assign(new Error('refused'), { code: 'ACCESS_DENIED' });
    };
    return deps;
  };
  const full = await readKnowledgeList({ knowledgeBase: KB_IT }, failing(700), {});
  assert.deepEqual([full.total, full.truncated, full.next, full.articles.length], [null, true, 300, 300]);
  const short = await readKnowledgeList({ knowledgeBase: KB_IT }, failing(40), {});
  assert.deepEqual([short.total, short.truncated, short.next, short.articles.length], [null, false, null, 40]);
  // the organisation's policy closing the count is the same: no total
  const blocked = fakeDeps({ kb_knowledge: base(40) });
  blocked.countRecords = async () => {
    throw Object.assign(new Error('blocked'), { code: 'BLOCKED_TABLE' });
  };
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT }, blocked, {})).total, null);
  // a lost sign-in is not "unknown": it is thrown, so the panel says to sign in
  const expired = fakeDeps({ kb_knowledge: base(40) });
  expired.countRecords = async () => {
    throw Object.assign(new Error('signed out'), { code: 'SESSION_EXPIRED' });
  };
  await assert.rejects(readKnowledgeList({ knowledgeBase: KB_IT }, expired, {}), (err) => err.code === 'SESSION_EXPIRED');
});

test('the count never claims fewer than was read; a total handed back is only a number', async () => {
  const deps = fakeDeps({ kb_knowledge: base(40) });
  deps.countRecords = async () => 10; // stale
  assert.equal((await readKnowledgeList({ knowledgeBase: KB_IT }, deps, {})).total, 40);
  const op = (total) => knowledgeOps.kbDuplicates({ knowledgeBase: KB_IT, offset: 0, total }, { deps: fakeDeps({ kb_knowledge: base(40) }) });
  for (const bad of ['700', -3, 2.5, null, NaN, {}, [5]]) {
    const out = await op(bad);
    assert.equal(out.total, 40, `not used: ${JSON.stringify(bad)}`);
  }
  assert.equal((await op(700)).total, 700, 'a whole number is used');
  assert.equal((await op(10 ** 12)).total, 10000000, 'and bounded');
});

test('past the last article the person can read: the end, whatever the count says', async () => {
  const deps = fakeDeps({ kb_knowledge: base(350) });
  const end = await readKnowledgeList({ knowledgeBase: KB_IT, offset: 900, total: 1000 }, deps, {});
  assert.deepEqual([end.articles, end.truncated, end.next, end.total, end.access[0].status], [[], false, null, 1000, 'ok']);
  assert.equal(end.access[0].note, 'There are no more articles to compare.');
});

test('articles changed in the same second page without overlap or gap (the tie-break)', async () => {
  const deps = fakeDeps({ kb_knowledge: base(700, { same: true }) });
  const pages = await scan(deps);
  const seen = pages.flatMap((p) => p.articles.map((a) => a.sysId));
  assert.equal(seen.length, 700);
  assert.equal(new Set(seen).size, 700);
  assert.ok(deps.callsTo('kb_knowledge').filter((c) => c.options.limit === 300).every((c) => c.query.endsWith('^ORDERBYDESCsys_updated_on^ORDERBYDESCsys_id')));
});

test('the list stays inside its columns and asks for no text', async () => {
  const deps = fakeDeps({ kb_knowledge: base(5) });
  await scan(deps);
  const asked = deps.callsTo('kb_knowledge').filter((c) => c.options.limit === 300);
  assert.ok(asked.length >= 1);
  for (const call of asked) assert.ok(!call.fields.includes('text') && !call.fields.includes('author'));
});

// ---- the scopes to choose from --------------------------------------------------------------------------------------------------

test('the knowledge bases and categories to choose from: the biggest are listed, and how many were left out is said', async () => {
  const group = (field, n, count) => ({ stats: { count: String(count) }, groupby_fields: [{ field, value: id(0x7000 + n), display_value: `Name ${n}` }] });
  const many = (field, total) => Array.from({ length: total }, (_, n) => group(field, n, 1 + (n % 50)));
  const withGroups = (groups) => Object.assign(fakeDeps({ kb_knowledge: base(3) }), { countByColumn: async () => groups });

  const bases = await readKnowledgeScopes({}, withGroups(many('kb_knowledge_base', 130)), {});
  assert.equal(bases.items.length, 100);
  assert.equal(bases.hidden, 30);
  assert.ok(bases.items[0].count >= bases.items[99].count, 'biggest first');

  const cats = await readKnowledgeScopes({ knowledgeBase: KB_IT }, withGroups(many('kb_category', 340)), {});
  assert.equal(cats.items.length, 300);
  assert.equal(cats.hidden, 40);

  const few = await readKnowledgeScopes({ knowledgeBase: KB_IT }, withGroups(many('kb_category', 12)), {});
  assert.deepEqual([few.items.length, few.hidden], [12, 0]);
});

// ---- the gap radar's counts -----------------------------------------------------------------------------------------------------

function windowRows(n, { olderThanWindow = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const resolved = i < olderThanWindow ? '2026-01-05 09:00:00' : '2026-10-20 09:00:00';
    rows.push({ ...incidentRows()[0], sys_id: v(incidentId(0x100 + i)), number: v(`INC${1000000 + i}`), resolved_at: v(resolved, resolved) });
  }
  return rows;
}

test('resolved tickets: a full read says how many the window holds (one count) and that it was cut', async () => {
  const deps = fakeDeps({ incident: windowRows(40) });
  const out = await readResolvedTickets({ days: 60, tables: ['incident'] }, deps, { now: NOW, max: 25 });
  assert.deepEqual([out.tickets.length, out.total, out.truncated], [25, 40, true]);
  const lost = fakeDeps({ incident: windowRows(40) });
  lost.countRecords = async () => {
    throw new Error('refused');
  };
  const unknown = await readResolvedTickets({ days: 60, tables: ['incident'] }, lost, { now: NOW, max: 25 });
  assert.deepEqual([unknown.tickets.length, unknown.total, unknown.truncated], [25, null, true], 'cut, and the count is unknown: not a number that looks complete');
  const expired = fakeDeps({ incident: windowRows(40) });
  expired.countRecords = async () => {
    throw Object.assign(new Error('signed out'), { code: 'SESSION_EXPIRED' });
  };
  await assert.rejects(readResolvedTickets({ days: 60, tables: ['incident'] }, expired, { now: NOW, max: 25 }), (err) => err.code === 'SESSION_EXPIRED');
});

test('resolved tickets: when the instance ignored the date range, the window ends inside the read, so it is complete and the inflated count is not asked for', async () => {
  // 40 rows: the 15 newest are in the window, the next 25 are months older (an instance that dropped the date condition)
  const rows = windowRows(40).map((row, i) => (i < 15 ? { ...row, resolved_at: v('2026-10-20 09:00:00') } : { ...row, resolved_at: v('2026-01-05 09:00:00') }));
  const deps = fakeDeps({ incident: rows }, { ignoreUnknownColumns: true });
  // the fake applies the condition; make it ignore the date by answering the rows as they are
  const ignoring = { ...deps, queryTable: async (table, query, fields, options) => (await deps.queryTable(table, '', fields, options)).slice(0, options.limit), countRecords: async () => 4000 };
  const out = await readResolvedTickets({ days: 60, tables: ['incident'] }, ignoring, { now: NOW, max: 30 });
  assert.equal(out.tickets.length, 15, 'only the tickets inside the window');
  assert.equal(out.total, 15, 'and that is the whole window, not 4,000');
  assert.equal(out.truncated, false);
  assert.match(out.access[0].note, /did not apply the date range as asked/);
});
