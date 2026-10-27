// Reads for the Knowledge tools: the structure of one article, the published articles of one scope, and the resolved
// tickets (with the knowledge articles linked to them) behind the "articles to write" radar.
//
// GET-only through deps, bounded, ACL-aware. Every list is read with a condition and every row is checked against it again:
// ServiceNow ignores a condition on a column that does not exist and then answers with unrelated rows, and those must never
// pass for "the articles of this knowledge base" or "the tickets that have an article".

import { LIMITS } from './allowlists.js';
import { STATUS, classifyReadError, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { SYS_ID_RE, cleanText, disp, formatSnTime, mapLimit, oneLine, parseSnTime, raw, stripHtml } from './util.js';

export const KB_TABLE = 'kb_knowledge';
const DAY = 86400000;

// ---- Structure of one article ---------------------------------------------------------------------------

/**
 * What the HTML of an article is made of, counted before it is turned into plain text (the plain text has lost its
 * headings and its numbered lists). `textLength` is the full plain length, not the capped one that goes into a pack.
 */
export function articleHtmlStats(html) {
  const source = String(html ?? '');
  const plain = stripHtml(source);
  const count = (re) => (source.match(re) || []).length;
  return {
    textLength: plain.length,
    words: plain ? plain.split(/\s+/).length : 0,
    headings: count(/<h[1-6]\b/gi),
    orderedLists: count(/<ol\b/gi),
    bulletLists: count(/<ul\b/gi),
    listItems: count(/<li\b/gi),
    tables: count(/<table\b/gi),
    images: count(/<img\b/gi),
    links: count(/<a\s[^>]*href/gi),
    codeBlocks: count(/<(?:pre|code)\b/gi),
  };
}

/** Pack values are strings (docs/contracts.md): the same numbers, written as text. */
export const statsToStrings = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, String(value)]));

// ---- The scope to compare: knowledge bases and categories ---------------------------------------------------------------

const idOf = (value) => (SYS_ID_RE.test(String(value || '')) ? String(value).toLowerCase() : '');

/**
 * The knowledge bases (or, with `knowledgeBase`, the categories of that base) that hold published articles this user can
 * read, with how many. One Aggregate read; nothing but counts and names is transferred.
 * @returns {Promise<{ items: { id: string, name: string, count: number }[], access: object[] }>}
 */
export async function readKnowledgeScopes({ knowledgeBase = '' } = {}, deps, { memo } = {}) {
  const kb = idOf(knowledgeBase);
  const query = kb ? `workflow_state=published^kb_knowledge_base=${kb}` : 'workflow_state=published';
  const column = kb ? 'kb_category' : 'kb_knowledge_base';
  let groups;
  try {
    groups = await deps.countByColumn(KB_TABLE, query, column);
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED' || err?.name === 'AbortError') throw err;
    const failure = classifyReadError(err, KB_TABLE);
    return { items: [], access: [accessEntry(KB_TABLE, failure.status, failure.note)] };
  }
  const items = (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const field = (group?.groupby_fields || []).find((g) => g.field === column) || group?.groupby_fields?.[0] || {};
      return { id: idOf(field.value), name: oneLine(field.display_value || '', 100), count: Number.parseInt(group?.stats?.count, 10) || 0 };
    })
    .filter((item) => item.id && item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 100)
    .map((item) => ({ ...item, name: item.name || '(unnamed)' }));
  if (items.length) return { items, access: [accessEntry(KB_TABLE, STATUS.OK)] };
  const seen = await confirmEmptyIsReallyEmpty(KB_TABLE, deps, memo);
  return { items, access: [accessEntry(KB_TABLE, seen.status, seen.status === STATUS.EMPTY ? 'No published articles here.' : seen.note)] };
}

// ---- The articles of one scope (bounded) ---------------------------------------------------------------------------

// What the duplicate finder reads about each article. Titles and counts only: the text comes later, for the few articles of
// one cluster the person picks. All of these are in the knowledge ceiling (tests/knowledge-context.test.js proves it).
export const KB_LIST_FIELDS = Object.freeze(['sys_id', 'number', 'short_description', 'kb_knowledge_base', 'kb_category', 'sys_updated_on', 'sys_view_count', 'view_count']);
export const KB_MAX_ARTICLES = 300;

const toListItem = (row) => ({
  sysId: raw(row.sys_id).toLowerCase(),
  number: oneLine(disp(row.number), 40),
  title: cleanText(disp(row.short_description), LIMITS.shortDescription),
  knowledgeBase: oneLine(disp(row.kb_knowledge_base), 100),
  category: oneLine(disp(row.kb_category), 100),
  updated: oneLine(disp(row.sys_updated_on), 40),
  views: Number.parseInt(raw(row.sys_view_count) || raw(row.view_count), 10) || 0,
});

/**
 * Published articles of one knowledge base and/or one category, newest change first, at most `max` (300).
 * @returns {Promise<{ articles: object[], total: number|null, truncated: boolean, access: object[] }>}
 *   article: { sysId, number, title, knowledgeBase, category, updated, views }
 */
export async function readKnowledgeList({ knowledgeBase = '', category = '' } = {}, deps, { max = KB_MAX_ARTICLES, memo } = {}) {
  const kb = idOf(knowledgeBase);
  const cat = idOf(category);
  if (!kb && !cat) return { articles: [], total: 0, truncated: false, access: [accessEntry(KB_TABLE, STATUS.SKIPPED, 'Choose a knowledge base or a category first.')] };

  const conditions = ['workflow_state=published', kb && `kb_knowledge_base=${kb}`, cat && `kb_category=${cat}`].filter(Boolean).join('^');
  const limit = Math.max(1, Math.min(max, KB_MAX_ARTICLES));
  const { rows, failure } = await softRead(deps, KB_TABLE, `${conditions}^ORDERBYDESCsys_updated_on`, KB_LIST_FIELDS, { limit, displayValue: true });
  if (failure) return { articles: [], total: null, truncated: false, access: [accessEntry(KB_TABLE, failure.status, failure.note)] };

  const wrong = rows.some((row) => (kb && raw(row.kb_knowledge_base).toLowerCase() !== kb) || (cat && raw(row.kb_category).toLowerCase() !== cat));
  if (wrong) {
    return { articles: [], total: null, truncated: false, access: [accessEntry(KB_TABLE, STATUS.ERROR, 'The instance did not apply the knowledge base or category filter, so its articles were not used.')] };
  }
  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty(KB_TABLE, deps, memo);
    return { articles: [], total: 0, truncated: false, access: [accessEntry(KB_TABLE, seen.status, seen.status === STATUS.EMPTY ? 'No published articles in this scope.' : seen.note)] };
  }

  const articles = rows.map(toListItem).filter((a) => SYS_ID_RE.test(a.sysId));
  const truncated = rows.length >= limit;
  let total = rows.length;
  if (truncated) {
    total = await deps.countRecords(KB_TABLE, conditions).catch(() => null);
    if (!Number.isFinite(total)) total = null;
  }
  const note = truncated ? `Only the ${articles.length} most recently changed articles were compared${total ? ` (of ${total})` : ''}. Choose a category to narrow it.` : '';
  return { articles, total, truncated, access: [accessEntry(KB_TABLE, STATUS.OK, note)] };
}

// ---- Resolved tickets (bounded) -----------------------------------------------------------------------------------------

// Tickets worth a knowledge article. HR cases are deliberately not here: their content is sensitive.
export const GAP_TABLES = Object.freeze({ incident: 'incident', sn_customerservice_case: 'case' });
// Each table also names who raised the ticket (caller_id; contact and consumer on a case). They are read so the privacy filter
// knows those people, and so their names can be kept out of the topic words; they are never shown or sent as such.
export const GAP_FIELDS = Object.freeze({
  incident: Object.freeze(['sys_id', 'number', 'short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'caller_id']),
  sn_customerservice_case: Object.freeze(['sys_id', 'number', 'short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'contact', 'consumer']),
});
const WHO_COLUMNS = ['caller_id', 'contact', 'consumer'];
export const GAP_MAX_TICKETS = 500;
export const GAP_MAX_DAYS = 90;

/**
 * Tickets resolved in the last `days` days (at most 500 in all). Only short description, category, CI, the names of who raised
 * the ticket and the LENGTH of the resolution notes are kept: the notes themselves are dropped as soon as their length is known.
 * @returns {Promise<{ tickets: object[], truncated: boolean, days: number, access: object[] }>}
 *   ticket: { table, kind, sysId, number, title, category, ci, who: string[], fixLength, resolvedUtc }
 */
export async function readResolvedTickets({ days = 60, tables = ['incident'] } = {}, deps, { now = Date.now(), max = GAP_MAX_TICKETS, memo } = {}) {
  const span = Math.max(1, Math.min(GAP_MAX_DAYS, Math.floor(Number(days)) || 60));
  const cutoffMs = now - span * DAY;
  const cutoff = formatSnTime(cutoffMs);
  const wanted = [...new Set((Array.isArray(tables) ? tables : []).filter((t) => Object.hasOwn(GAP_TABLES, t)))];
  const tickets = [];
  const access = [];
  let truncated = false;
  if (!wanted.length) return { tickets, truncated, days: span, access: [accessEntry('tickets', STATUS.SKIPPED, 'Choose incidents or cases.')] };

  const perTable = Math.max(1, Math.floor(Math.min(max, GAP_MAX_TICKETS) / wanted.length));
  for (const table of wanted) {
    // eslint-disable-next-line no-await-in-loop -- at most two reads.
    const { rows, failure } = await softRead(deps, table, `resolved_atISNOTEMPTY^resolved_at>=${cutoff}^ORDERBYDESCresolved_at`, GAP_FIELDS[table], { limit: perTable, displayValue: true });
    if (failure) {
      access.push(accessEntry(table, failure.status, failure.note));
      continue;
    }
    const inWindow = rows.filter((row) => parseSnTime(raw(row.resolved_at)) >= cutoffMs);
    if (!rows.length) {
      // eslint-disable-next-line no-await-in-loop
      const seen = await confirmEmptyIsReallyEmpty(table, deps, memo);
      access.push(accessEntry(table, seen.status, seen.status === STATUS.EMPTY ? `No ${table} tickets were resolved in the last ${span} days.` : seen.note));
      continue;
    }
    // A date condition the instance ignored brings older rows; only the ones inside the window count.
    const note = inWindow.length < rows.length ? 'The instance did not apply the date filter, so only tickets inside the window were used.' : rows.length >= perTable ? `Only the newest ${perTable} were read.` : '';
    truncated = truncated || rows.length >= perTable;
    access.push(accessEntry(table, STATUS.OK, note));
    for (const row of inWindow) {
      const sysId = raw(row.sys_id).toLowerCase();
      if (!SYS_ID_RE.test(sysId)) continue;
      tickets.push({
        table,
        kind: GAP_TABLES[table],
        sysId,
        number: oneLine(disp(row.number), 40),
        title: cleanText(disp(row.short_description), LIMITS.shortDescription),
        category: oneLine(disp(row.category), 100),
        ci: oneLine(disp(row.cmdb_ci), 100),
        who: [...new Set(WHO_COLUMNS.map((column) => oneLine(disp(row[column]), 100)).filter((name) => name && !SYS_ID_RE.test(name)))],
        fixLength: Math.min(2000, stripHtml(disp(row.close_notes)).length),
        resolvedUtc: raw(row.resolved_at),
      });
    }
  }
  return { tickets, truncated, days: span, access };
}

// ---- Which of those tickets have a knowledge article -------------------------------------------------------------------

// Where the link between a ticket and an article is kept (the "Attached Knowledge" list and the knowledge-use log).
// Neither could be verified on a real instance (docs/live-questions/knowledge.md), so each is tried and checked.
export const LINK_SOURCES = Object.freeze([
  { table: 'm2m_kb_task', task: 'task' },
  { table: 'kb_use', task: 'task' },
]);
const LINK_CHUNK = 40;

async function readLinkSource({ table, task }, ids, deps, memo) {
  const linked = new Set();
  const chunks = [];
  for (let i = 0; i < ids.length; i += LINK_CHUNK) chunks.push(ids.slice(i, i + LINK_CHUNK));
  let usable = true;
  let problem = null;
  const results = await mapLimit(chunks, 2, async (group, index) => {
    if (!usable) return null;
    const asked = new Set(group);
    const { rows, failure } = await softRead(deps, table, `${task}IN${group.join(',')}`, ['sys_id', task], { limit: 1000, displayValue: false });
    if (failure) {
      usable = false;
      problem = failure;
      return null;
    }
    if (rows.some((row) => !asked.has(raw(row[task]).toLowerCase()))) {
      usable = false;
      problem = { status: STATUS.ERROR, note: `The instance did not apply the ${task} filter on ${table}, so its rows were not used.` };
      return null;
    }
    return { index, rows };
  });
  if (usable) {
    for (const result of results) for (const row of result?.rows || []) linked.add(raw(row[task]).toLowerCase());
    // Nothing found for any ticket: either no ticket has an article, or this user cannot see the table. Tell them apart.
    if (!linked.size) {
      const seen = await confirmEmptyIsReallyEmpty(table, deps, memo);
      if (seen.status !== STATUS.EMPTY) {
        usable = false;
        problem = seen;
      }
    }
  }
  return usable
    ? { table, usable: true, linked, status: STATUS.OK, note: '' }
    : { table, usable: false, linked: new Set(), status: problem.status, note: problem.note };
}

/**
 * Which of `ids` (ticket sys_ids) have a knowledge article attached or used. `known` is true only when at least one link
 * table could really be read; otherwise nothing is excluded and the caller must say "could not tell which tickets had an article".
 * @returns {Promise<{ linked: Set<string>, known: boolean, sources: object[], access: object[] }>}
 */
export async function readArticleLinks(ids, deps, { memo } = {}) {
  const asked = [...new Set((ids || []).map((id) => String(id).toLowerCase()).filter((id) => SYS_ID_RE.test(id)))];
  if (!asked.length) return { linked: new Set(), known: false, sources: [], access: [] };
  const sources = [];
  for (const source of LINK_SOURCES) {
    // eslint-disable-next-line no-await-in-loop -- one table at a time.
    sources.push(await readLinkSource(source, asked, deps, memo));
  }
  const linked = new Set(sources.flatMap((s) => [...s.linked]));
  return {
    linked,
    known: sources.some((s) => s.usable),
    sources: sources.map(({ table, usable, status, note }) => ({ table, usable, status, note })),
    access: sources.map((s) => accessEntry(s.table, s.status, s.note)),
  };
}
