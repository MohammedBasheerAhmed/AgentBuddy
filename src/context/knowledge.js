// Reads for the Knowledge tools: the structure of one article, the published articles of one scope, and the resolved
// tickets (with the knowledge articles linked to them) behind the "articles to write" radar.
//
// GET-only through deps, bounded, ACL-aware. Every list is read with a condition and every row is checked against it again:
// ServiceNow ignores a condition on a column that does not exist and then answers with unrelated rows, and those must never
// pass for "the articles of this knowledge base" or "the tickets that have an article".

import { LIMITS } from './allowlists.js';
import { STATUS, classifyReadError, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { SYS_ID_RE, cleanText, disp, formatSnTime, mapLimit, oneLine, parseSnTime, queryValue, raw, stripHtml } from './util.js';
import { similarKeywords } from '../lib/similar.js';
// The ranking of the ticket's "Knowledge that may help" (src/context/similar.js, Insights agent), used read-only so both rank alike.
import { scoreArticle } from './similar.js';

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
  // The stored (UTC) time, so lists sort by when it was updated, not by how the date is written (src/knowledge/similarity.js).
  updatedUtc: oneLine(raw(row.sys_updated_on), 40),
  views: Number.parseInt(raw(row.sys_view_count) || raw(row.view_count), 10) || 0,
});

// Paging through a big knowledge base: the next 300 titles start where the last page ended. At most this many titles in all
// (the comparison is done in the panel, every title against every other).
export const KB_MAX_OFFSET = 1200;

/**
 * Published articles of one knowledge base and/or one category, newest change first, at most `max` (300) from `offset` on.
 * @returns {Promise<{ articles: object[], total: number|null, truncated: boolean, offset: number, access: object[] }>}
 *   article: { sysId, number, title, knowledgeBase, category, updated, views }; truncated: more articles follow this page
 */
export async function readKnowledgeList({ knowledgeBase = '', category = '', offset = 0 } = {}, deps, { max = KB_MAX_ARTICLES, memo } = {}) {
  const kb = idOf(knowledgeBase);
  const cat = idOf(category);
  const start = Math.max(0, Math.min(KB_MAX_OFFSET, Math.floor(Number(offset)) || 0));
  if (!kb && !cat) return { articles: [], total: 0, truncated: false, offset: start, access: [accessEntry(KB_TABLE, STATUS.SKIPPED, 'Choose a knowledge base or a category first.')] };

  const conditions = ['workflow_state=published', kb && `kb_knowledge_base=${kb}`, cat && `kb_category=${cat}`].filter(Boolean).join('^');
  const limit = Math.max(1, Math.min(max, KB_MAX_ARTICLES));
  const { rows, failure } = await softRead(deps, KB_TABLE, `${conditions}^ORDERBYDESCsys_updated_on`, KB_LIST_FIELDS, { limit, offset: start, displayValue: true });
  if (failure) return { articles: [], total: null, truncated: false, offset: start, access: [accessEntry(KB_TABLE, failure.status, failure.note)] };

  const wrong = rows.some((row) => (kb && raw(row.kb_knowledge_base).toLowerCase() !== kb) || (cat && raw(row.kb_category).toLowerCase() !== cat));
  if (wrong) {
    return { articles: [], total: null, truncated: false, offset: start, access: [accessEntry(KB_TABLE, STATUS.ERROR, 'The instance did not apply the knowledge base or category filter, so its articles were not used.')] };
  }
  if (!rows.length) {
    if (start > 0) return { articles: [], total: start, truncated: false, offset: start, access: [accessEntry(KB_TABLE, STATUS.OK, 'There are no more articles to compare.')] };
    const seen = await confirmEmptyIsReallyEmpty(KB_TABLE, deps, memo);
    return { articles: [], total: 0, truncated: false, offset: start, access: [accessEntry(KB_TABLE, seen.status, seen.status === STATUS.EMPTY ? 'No published articles in this scope.' : seen.note)] };
  }

  const articles = rows.map(toListItem).filter((a) => SYS_ID_RE.test(a.sysId));
  const full = rows.length >= limit;
  let total = start + rows.length;
  if (full) {
    total = await deps.countRecords(KB_TABLE, conditions).catch(() => null);
    if (!Number.isFinite(total)) total = null;
  }
  // More follow when this page was full and the count says so (or the count could not be read).
  const truncated = full && (total === null || total > start + rows.length);
  const note = truncated ? `Only the ${start + articles.length} most recently changed articles were compared${total ? ` (of ${total})` : ''}. Choose a category to narrow it.` : '';
  return { articles, total, truncated, offset: start, access: [accessEntry(KB_TABLE, STATUS.OK, note)] };
}

// ---- Knowledge search (N23): any article, typed words, the same ranking as the ticket's "Knowledge that may help" ----------

// What a search reads about each article. The text is needed to rank and for the excerpt; it is cut down at once and never kept.
export const KB_SEARCH_FIELDS = Object.freeze(['sys_id', 'number', 'short_description', 'text', 'workflow_state', 'kb_knowledge_base', 'kb_category', 'sys_updated_on', 'valid_to', 'sys_view_count', 'view_count']);
export const KB_SEARCH_LIMIT = 10;
const KB_SEARCH_READ = 25;
const KB_SEARCH_MAX_TERMS = 5;
const KB_SEARCH_MAX_CHARS = 200;
const EXCERPT_CHARS = 220;
// An article number as people type it ("KB0010001"); any prefix of letters, then digits.
const ARTICLE_NUMBER_RE = /^[A-Za-z]{2,8}\d{4,12}$/;

/**
 * The words a typed search is made of: no email addresses, links or phone numbers, no filler words, acronyms first; or the article
 * number when the person typed one. Every word is plain a-z, 0-9, dash and underscore, so it can go into a query as it is.
 * @param {string} input what the person typed
 * @returns {{ number: string, keywords: string[] }}
 */
export function searchTerms(input) {
  const text = String(input ?? '').slice(0, KB_SEARCH_MAX_CHARS).trim();
  if (ARTICLE_NUMBER_RE.test(text)) return { number: text.toUpperCase(), keywords: [] };
  const clean = text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ');
  const keywords = similarKeywords(clean, KB_SEARCH_MAX_TERMS).map((w) => w.replace(/[^a-z0-9_-]/g, '')).filter((w) => w.length >= 2);
  return { number: '', keywords: [...new Set(keywords)] };
}

/**
 * The encoded query for a search: published articles with EVERY word (in the title or the text), or with ANY word (`all: false`),
 * newest change first. An article number is looked up by itself.
 */
export function knowledgeSearchQuery({ number = '', keywords = [] } = {}, { all = true } = {}) {
  if (number) return ARTICLE_NUMBER_RE.test(number) ? `workflow_state=published^number=${number}` : '';
  const safe = keywords.map((w) => String(w).replace(/[^a-z0-9_-]/gi, '')).filter(Boolean);
  if (!safe.length) return '';
  const words = all ? safe.map((w) => `short_descriptionLIKE${w}^ORtextLIKE${w}`).join('^') : safe.flatMap((w) => [`short_descriptionLIKE${w}`, `textLIKE${w}`]).join('^OR');
  return `workflow_state=published^${words}^ORDERBYDESCsys_updated_on`;
}

/** A short piece of the text around the first search word (or its start), on word boundaries. Pure. */
export function excerptAround(body, keywords, max = EXCERPT_CHARS) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const at = (keywords || []).map((w) => lower.indexOf(String(w).toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  let start = at === undefined ? 0 : Math.max(0, at - Math.floor(max / 3));
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space >= 0 && space - start < 20 ? space + 1 : start;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    end = space > start + max / 2 ? space : end;
  }
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}

const DAY_MS = 86400000;
const daysBetween = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? Math.floor((to - from) / DAY_MS) : null);

/**
 * Published articles that match what the person typed, best first: the ticket card's ranking (a word in the title counts double a
 * word in the text), then most read, then newest. Articles past their "valid to" date are left out. GET only, with the person's
 * session: the knowledge bases they cannot read never answer.
 * @param {{ query: string }} args
 * @returns {Promise<{ hits: object[], keywords: string[], number: string, more: boolean, access: object[] }>}
 *   hit: { sysId, number, title, knowledgeBase, category, excerpt, viewCount, updated, ageDays, expiresInDays, score, why }
 *   more: there were more matching articles than are shown (type more words)
 */
export async function searchKnowledgeText({ query = '' } = {}, deps, { now = Date.now(), limit = KB_SEARCH_LIMIT, memo } = {}) {
  const terms = searchTerms(query);
  const result = (hits, more, access) => ({ hits, keywords: terms.keywords, number: terms.number, more, access });
  if (!terms.number && !terms.keywords.length) return result([], false, [accessEntry(KB_TABLE, STATUS.SKIPPED, 'Type a few words that describe the problem, or an article number.')]);

  const rows = new Map();
  const read = async (q) => {
    const { rows: found, failure } = await softRead(deps, KB_TABLE, q, KB_SEARCH_FIELDS, { limit: KB_SEARCH_READ, displayValue: true });
    if (failure) return failure;
    for (const row of found) {
      const id = raw(row.sys_id).toLowerCase();
      if (SYS_ID_RE.test(id) && !rows.has(id)) rows.set(id, row);
    }
    return null;
  };
  // Every word first; when that finds few and there are several words, any word fills up the list (ranked below the full matches).
  const failure = await read(knowledgeSearchQuery(terms, { all: true }));
  if (failure) return result([], false, [accessEntry(KB_TABLE, failure.status, failure.note)]);
  const fullMatches = rows.size;
  if (!terms.number && terms.keywords.length > 1 && fullMatches < limit) {
    const second = await read(knowledgeSearchQuery(terms, { all: false }));
    if (second && !rows.size) return result([], false, [accessEntry(KB_TABLE, second.status, second.note)]);
  }

  const today = new Date(now).toISOString().slice(0, 10);
  const words = terms.keywords.length ? terms.keywords : [terms.number.toLowerCase()];
  const ranked = [...rows.values()]
    // The instance applied the filter (a column it does not know would be ignored and answer with drafts): published only.
    .filter((row) => !('workflow_state' in row) || raw(row.workflow_state) === 'published')
    .filter((row) => !raw(row.valid_to) || raw(row.valid_to).slice(0, 10) >= today)
    .map((row) => {
      const body = stripHtml(disp(row.text));
      const title = cleanText(disp(row.short_description), LIMITS.shortDescription);
      const number = oneLine(disp(row.number), 40);
      const { score, why } = terms.number ? { score: number.toUpperCase() === terms.number ? 100 : 0, why: ['article number'] } : scoreArticle({ title, body }, words);
      const validTo = parseSnTime(raw(row.valid_to));
      return {
        sysId: raw(row.sys_id).toLowerCase(),
        number,
        title,
        knowledgeBase: oneLine(disp(row.kb_knowledge_base), 100),
        category: oneLine(disp(row.kb_category), 100),
        excerpt: excerptAround(body, words),
        viewCount: Number.parseInt(raw(row.sys_view_count) || raw(row.view_count), 10) || 0,
        updated: oneLine(disp(row.sys_updated_on), 40),
        ageDays: daysBetween(parseSnTime(raw(row.sys_updated_on)), now),
        expiresInDays: Number.isFinite(validTo) ? daysBetween(now, validTo + DAY_MS - 1) : null,
        score,
        why,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.viewCount - a.viewCount || String(b.updated).localeCompare(String(a.updated)));
  const hits = ranked.slice(0, Math.max(1, Math.min(limit, KB_SEARCH_LIMIT)));
  const more = ranked.length > hits.length || fullMatches >= KB_SEARCH_READ;

  if (!rows.size) {
    const seen = await confirmEmptyIsReallyEmpty(KB_TABLE, deps, memo);
    return result([], false, [accessEntry(KB_TABLE, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)]);
  }
  return result(hits, more, [accessEntry(KB_TABLE, hits.length ? STATUS.OK : STATUS.EMPTY)]);
}

// ---- Resolved tickets (bounded) -----------------------------------------------------------------------------------------

// Tickets worth a knowledge article. HR cases are deliberately not here: their content is sensitive.
export const GAP_TABLES = Object.freeze({ incident: 'incident', sn_customerservice_case: 'case' });
// Each table also names who raised the ticket (caller_id; contact and consumer on a case). They are read so the privacy filter
// knows those people, and so their names can be kept out of the topic words; they are never shown or sent as such.
// assignment_group is read to check, row by row, that a "my groups" scope was applied by the instance (see scopeCondition).
export const GAP_FIELDS = Object.freeze({
  incident: Object.freeze(['sys_id', 'number', 'short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'caller_id', 'assignment_group']),
  sn_customerservice_case: Object.freeze(['sys_id', 'number', 'short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'contact', 'consumer', 'assignment_group']),
});
const WHO_COLUMNS = ['caller_id', 'contact', 'consumer'];
export const GAP_MAX_TICKETS = 500;
export const GAP_MAX_DAYS = 90;

// ---- The scope of the radar: everything, my groups, or one category --------------------------------------------------------

// A category is a choice VALUE ("network", "inquiry"): letters, digits and a few separators, never a caret or a script.
const CATEGORY_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .&/-]{0,79}$/;
export const MAX_SCOPE_GROUPS = 50;

/** A category value that may go into a query ('' when it may not). */
export const cleanCategory = (value) => {
  const text = String(value ?? '').trim();
  return CATEGORY_RE.test(text) ? queryValue(text) : '';
};

/**
 * The extra condition for a scope, and the check each row must pass (ServiceNow ignores a condition on a column it does not know
 * and then answers with every row: those rows must never pass for "my groups" or "this category").
 * @param {{ groups?: string[], category?: string } | null} scope
 * @returns {{ query: string, accepts: (row: object) => boolean, ok: boolean }} ok false: the scope cannot be used (nothing to read)
 */
export function scopeCondition(scope) {
  if (!scope || typeof scope !== 'object') return { query: '', accepts: () => true, ok: true };
  if (Array.isArray(scope.groups)) {
    const ids = [...new Set(scope.groups.map((g) => String(g || '').toLowerCase()).filter((g) => SYS_ID_RE.test(g)))].slice(0, MAX_SCOPE_GROUPS);
    if (!ids.length) return { query: '', accepts: () => false, ok: false };
    const set = new Set(ids);
    return { query: `assignment_groupIN${ids.join(',')}`, accepts: (row) => set.has(raw(row.assignment_group).toLowerCase()), ok: true };
  }
  if (scope.category !== undefined) {
    const category = cleanCategory(scope.category);
    if (!category) return { query: '', accepts: () => false, ok: false };
    return { query: `category=${category}`, accepts: (row) => raw(row.category) === category, ok: true };
  }
  return { query: '', accepts: () => true, ok: true };
}

const resolvedConditions = (cutoff, scopeQuery) => ['resolved_atISNOTEMPTY', `resolved_at>=${cutoff}`, scopeQuery].filter(Boolean).join('^');

// The dynamic filter "Me" every instance ships (sys_filter_option_dynamic), resolved by the server to the signed-in user: the same
// one src/content/sessionToken.js uses. Nothing is evaluated here and no user id has to come from the page.
const ME_DYNAMIC = 'userDYNAMIC90d1921e5f510100a9ad2572f2b477fe';

/**
 * The assignment groups the signed-in person belongs to. One read of their own memberships. If the rows belong to more than one
 * user, the instance ignored the "Me" filter and nothing is used.
 * @returns {Promise<{ groups: { id: string, name: string }[], access: object[] }>}
 */
export async function readMyGroups(deps) {
  const table = 'sys_user_grmember';
  const { rows, failure } = await softRead(deps, table, ME_DYNAMIC, ['user', 'group'], { limit: MAX_SCOPE_GROUPS, displayValue: true });
  if (failure) return { groups: [], access: [accessEntry(table, failure.status, failure.note)] };
  const users = new Set(rows.map((r) => raw(r.user).toLowerCase()).filter(Boolean));
  if (users.size > 1) return { groups: [], access: [accessEntry(table, STATUS.ERROR, 'Could not tell which groups are yours, so the radar was not limited to them.')] };
  const seen = new Map();
  for (const r of rows) {
    const id = raw(r.group).toLowerCase();
    if (SYS_ID_RE.test(id) && !seen.has(id)) seen.set(id, oneLine(disp(r.group), 100) || id);
  }
  const groups = [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { groups, access: [accessEntry(table, groups.length ? STATUS.OK : STATUS.EMPTY, groups.length ? '' : 'You are not a member of any group that you can see.')] };
}

/**
 * What the scope picker offers: how many tickets were resolved in the window (per scope "everything") and in which categories, with
 * counts. One Aggregate read per table: counts and category names only, no ticket is transferred.
 * @returns {Promise<{ total: number|null, categories: { value: string, name: string, count: number }[], access: object[] }>}
 */
export async function readGapCategories({ days = 60, tables = ['incident'], groups = null } = {}, deps, { now = Date.now() } = {}) {
  const span = Math.max(1, Math.min(GAP_MAX_DAYS, Math.floor(Number(days)) || 60));
  const cutoff = formatSnTime(now - span * DAY);
  const scope = scopeCondition(Array.isArray(groups) ? { groups } : null);
  if (!scope.ok) return { total: 0, categories: [], access: [] };
  const counts = new Map();
  const access = [];
  let total = 0;
  let known = false;
  for (const table of [...new Set((Array.isArray(tables) ? tables : []).filter((t) => Object.hasOwn(GAP_TABLES, t)))]) {
    let found;
    try {
      // eslint-disable-next-line no-await-in-loop -- one Aggregate read per table, at most two.
      found = await deps.countByColumn(table, resolvedConditions(cutoff, scope.query), 'category');
    } catch (err) {
      if (err?.code === 'SESSION_EXPIRED' || err?.name === 'AbortError') throw err;
      const failure = classifyReadError(err, table);
      access.push(accessEntry(table, failure.status, failure.note));
      continue;
    }
    known = true;
    for (const group of Array.isArray(found) ? found : []) {
      const field = (group?.groupby_fields || []).find((g) => g.field === 'category') || group?.groupby_fields?.[0] || {};
      const count = Number.parseInt(group?.stats?.count, 10) || 0;
      total += count;
      const value = cleanCategory(field.value);
      if (!value || count <= 0) continue;
      const before = counts.get(value) || { value, name: oneLine(field.display_value || value, 100), count: 0 };
      before.count += count;
      counts.set(value, before);
    }
  }
  const categories = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 60);
  return { total: known ? total : null, categories, access };
}

/**
 * Tickets resolved in the last `days` days (at most 500 in all), optionally only those of `scope` (my groups, or one category).
 * Only short description, category, CI, the names of who raised the ticket and the LENGTH of the resolution notes are kept: the
 * notes themselves are dropped as soon as their length is known. `total` is how many tickets the window holds in that scope
 * (an Aggregate count), so the panel can say "500 of 12,400".
 * @returns {Promise<{ tickets: object[], truncated: boolean, days: number, total: number|null, access: object[] }>}
 *   ticket: { table, kind, sysId, number, title, category, ci, who: string[], fixLength, resolvedUtc }
 */
export async function readResolvedTickets({ days = 60, tables = ['incident'], scope = null } = {}, deps, { now = Date.now(), max = GAP_MAX_TICKETS, memo } = {}) {
  const span = Math.max(1, Math.min(GAP_MAX_DAYS, Math.floor(Number(days)) || 60));
  const cutoffMs = now - span * DAY;
  const cutoff = formatSnTime(cutoffMs);
  const wanted = [...new Set((Array.isArray(tables) ? tables : []).filter((t) => Object.hasOwn(GAP_TABLES, t)))];
  const tickets = [];
  const access = [];
  let truncated = false;
  let total = 0;
  let totalKnown = true;
  if (!wanted.length) return { tickets, truncated, days: span, total: 0, access: [accessEntry('tickets', STATUS.SKIPPED, 'Choose incidents or cases.')] };
  const limit = scopeCondition(scope);
  if (!limit.ok) return { tickets, truncated, days: span, total: 0, access: [accessEntry('tickets', STATUS.SKIPPED, 'There is nothing in that scope to look at.')] };
  const conditions = resolvedConditions(cutoff, limit.query);

  const perTable = Math.max(1, Math.floor(Math.min(max, GAP_MAX_TICKETS) / wanted.length));
  for (const table of wanted) {
    // eslint-disable-next-line no-await-in-loop -- at most two reads.
    const { rows, failure } = await softRead(deps, table, `${conditions}^ORDERBYDESCresolved_at`, GAP_FIELDS[table], { limit: perTable, displayValue: true });
    if (failure) {
      totalKnown = false;
      access.push(accessEntry(table, failure.status, failure.note));
      continue;
    }
    if (rows.length && !rows.every(limit.accepts)) {
      totalKnown = false;
      access.push(accessEntry(table, STATUS.ERROR, `The instance did not apply the ${scope?.category !== undefined ? 'category' : 'group'} filter on ${table}, so its tickets were not used.`));
      continue;
    }
    const inWindow = rows.filter((row) => parseSnTime(raw(row.resolved_at)) >= cutoffMs);
    if (!rows.length) {
      // eslint-disable-next-line no-await-in-loop
      const seen = await confirmEmptyIsReallyEmpty(table, deps, memo);
      access.push(accessEntry(table, seen.status, seen.status === STATUS.EMPTY ? `No ${table} tickets were resolved in the last ${span} days${limit.query ? ' in that scope' : ''}.` : seen.note));
      continue;
    }
    // How many the window holds, when this read did not take them all.
    if (rows.length >= perTable) {
      // eslint-disable-next-line no-await-in-loop
      const count = await deps.countRecords(table, conditions).catch(() => null);
      if (Number.isFinite(count)) total += count;
      else totalKnown = false;
    } else total += inWindow.length;
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
  return { tickets, truncated, days: span, total: totalKnown ? total : null, access };
}

// ---- Which of those tickets have a knowledge article -------------------------------------------------------------------

// Where the link between a ticket and an article is kept (the "Attached Knowledge" list and the knowledge-use log), and the
// column of each that points at the ticket. Neither could be verified on a real instance (docs/live-questions/knowledge.md,
// question 21), so each is tried and checked. For kb_use even the column is not certain (`task_id` or `task`): see
// detectLinkColumn. The Check tab (src/content/ops/checks.js) uses this same list.
export const LINK_SOURCES = Object.freeze([
  Object.freeze({ table: 'm2m_kb_task', columns: Object.freeze(['task']) }),
  Object.freeze({ table: 'kb_use', columns: Object.freeze(['task_id', 'task']) }),
]);
const LINK_CHUNK = 40;

/**
 * Which of `columns` points at the ticket in `table`. With one candidate there is nothing to find out. With several, ONE
 * unfiltered read of one row asks for all of them: the Table API leaves a column the table does not have out of its answer, so
 * the row shows which exists. A condition on the wrong column would be ignored by ServiceNow and answered with up to a
 * thousand unrelated rows; this read moves one. It is also the "can this user see any row at all?" read that an empty answer
 * needs (confirmEmptyIsReallyEmpty), so it replaces that read rather than adding one. Memoised per table in `memo`.
 * @returns {Promise<{ column: string, visible: boolean, failure: { status: string, note: string } | null }>}
 *   visible: a row was seen (an empty filtered answer is then a fact); failure: why the table cannot be used.
 */
export function detectLinkColumn(table, columns, deps, memo) {
  if (columns.length === 1) return Promise.resolve({ column: columns[0], visible: false, failure: null });
  const key = `link-column:${table}`;
  if (memo?.has(key)) return memo.get(key);
  const promise = (async () => {
    const { rows, failure } = await softRead(deps, table, '', ['sys_id', ...columns], { limit: 1, displayValue: false });
    if (failure) return { column: '', visible: false, failure };
    if (!rows.length) {
      const note = `Your user sees no rows of ${table} at all, so "none for this record" proves nothing: the instance may have none, or an access rule hides them.`;
      return { column: '', visible: false, failure: { status: STATUS.EMPTY_OR_HIDDEN, note } };
    }
    const column = columns.find((name) => Object.prototype.hasOwnProperty.call(rows[0], name)) || '';
    if (!column) {
      const names = columns.length === 2 ? `neither a ${columns[0]} nor a ${columns[1]} column` : `none of the columns ${columns.join(', ')}`;
      return { column: '', visible: true, failure: { status: STATUS.ERROR, note: `${table} has ${names}, so it says nothing about which tickets used an article.` } };
    }
    return { column, visible: true, failure: null };
  })();
  memo?.set(key, promise);
  return promise;
}

async function readLinkSource({ table, columns }, ids, deps, memo) {
  const detected = await detectLinkColumn(table, columns, deps, memo);
  if (detected.failure) return { table, usable: false, linked: new Set(), status: detected.failure.status, note: detected.failure.note };
  const task = detected.column;
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
    // Nothing found for any ticket: either no ticket has an article, or this user cannot see the table. Tell them apart
    // (unless the column probe already saw a row: then the table is visible and "none" is a fact).
    if (!linked.size && !detected.visible) {
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
