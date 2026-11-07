// "Seen this before?": similar tickets, other open tickets on the same CI or service, and knowledge articles that match.
// Plain keyword matching on the short description (src/lib/similar.js), boosted by a shared CI or category. No AI tokens.
// Results are for local display: they carry sysId/table so the panel can link them, and are not ContextPack data.

import { matchKey, rankSimilar, similarKeywords, similarQuery, textHas, withoutArabicArticle } from '../lib/similar.js';
import { FIELDS_BY_KIND, LIMITS } from './allowlists.js';
import { NOTE_TEXT, STATUS, absentColumns, confirmEmptyIsReallyEmpty, entry as accessEntry, hiddenFieldEntry, softRead, tm } from './access.js';
import { isSensitiveTable, kindForTable } from './kinds.js';
import { SYS_ID_RE, cleanText, disp, oneLine, parseSnTime, raw, stripHtml } from './util.js';

const HOUR = 3600000;
// How many of the newest keyword matches are read and ranked, for look-alikes and for articles (a full page means older matches were not seen).
const SIMILAR_READ = 30;
const ARTICLE_READ = 15;
const DUPLICATE_READ = 50;
const SENSITIVE_NOTE = NOTE_TEXT.sensitiveOthers;

// The columns of a candidate that name a person. They are read (display names only, no other table) so the people a look-alike
// ticket is about are masked exactly wherever its wording or close notes mention them (src/itsm/reference.js puts them on the pack).
export const HIT_PERSON_COLUMNS = ['caller_id', 'opened_for', 'contact', 'consumer', 'requested_for', 'opened_by', 'assigned_to'];

// Columns asked of the candidates; a column the table does not have is simply not returned.
const TICKET_FIELDS = [
  'sys_id', 'number', 'short_description', 'state', 'close_notes', 'close_code', 'resolution_code', 'resolved_at', 'closed_at',
  'category', 'cmdb_ci', 'cat_item', 'product', 'sys_updated_on', ...HIT_PERSON_COLUMNS,
];

// A table that holds the rows of many classes. A search on it (a record opened through /task.do whose class could not be told)
// finds HR cases too, so each candidate's class (sys_class_name, asked for on these tables) is checked; one whose class cannot be read
// is not used.
const BASE_TABLES = new Set(['task']);

/** May this candidate be used: its class (or, when the row does not say, the table searched) is not sensitive, or sensitive data is allowed. */
function classAllowed(row, table, { allowSensitive, sensitivePrefixes }) {
  if (allowSensitive) return true;
  const cls = raw(row.sys_class_name).trim().toLowerCase() || (BASE_TABLES.has(table) ? '' : table);
  return Boolean(cls) && !isSensitiveTable(cls, sensitivePrefixes);
}

// The display names on a row's person columns: strings only, never a bare id.
const namesOn = (row, columns = HIT_PERSON_COLUMNS) => [...new Set(columns.map((c) => oneLine(disp(row?.[c]), 100)).filter((n) => n && !SYS_ID_RE.test(n)))];

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Words worth searching for in a ticket: no email addresses, links or phone numbers, and not the names of the people
// on the record (a caller's name says nothing about the problem). Same extraction as src/lib/similar.js otherwise.
// Names are compared in the match form, with and without the Arabic article, so "أحمد" also takes out "احمد" and "العتيبي"
// takes out "عتيبي"; their words are taken out of the text before the keywords are picked.
export function searchKeywords(pack, { extra = '', max = 4 } = {}) {
  const names = new Set(
    (pack.people || [])
      .flatMap((p) => [p.name, p.firstName, p.lastName])
      .flatMap((n) => String(n || '').split(/[^\p{L}\p{M}]+/u))
      .filter(Boolean)
      .flatMap((w) => [matchKey(w), matchKey(withoutArabicArticle(w))])
  );
  const isName = (word) => names.has(matchKey(word)) || names.has(matchKey(withoutArabicArticle(word)));
  const text = `${pack.fields?.short_description || ''} ${extra}`
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
    .replace(/\p{L}[\p{L}\p{M}\p{N}_-]*/gu, (word) => (names.size && isName(word) ? ' ' : word));
  return similarKeywords(text, max);
}

// ---- Similar tickets -----------------------------------------------------------------------------------

/**
 * Score one candidate against the ticket on screen. Pure. `shared` is how many of the ticket's keywords it contains.
 * 60 points for keyword overlap, 20 for the same CI, 10 for the same category (or catalog item / product), 5 when the
 * hit documents how it was fixed.
 */
export function scoreHit({ item, shared, total, words }, pack) {
  const why = [];
  let score = Math.round((60 * shared) / Math.max(1, total));
  if (words.length) why.push(`shares ${words.join(', ')}`);
  const f = pack.fields || {};
  if (same(f.cmdb_ci, item.cmdb_ci)) {
    score += 20;
    why.push(`same CI (${item.cmdb_ci})`);
  }
  if (same(f.category, item.category)) {
    score += 10;
    why.push(`same category (${item.category})`);
  } else if (same(f.cat_item, item.cat_item)) {
    score += 10;
    why.push(`same catalog item (${item.cat_item})`);
  } else if (same(f.product, item.product)) {
    score += 10;
    why.push(`same product (${item.product})`);
  }
  if (item.close_notes) {
    score += 5;
    why.push('has resolution notes');
  }
  return { score: Math.min(100, score), why };
}

// Asked only with { routing: true }: where a look-alike went and how urgent it was (the "where similar tickets went" vote).
//   assignment_group.active  W-15: a group that has been retired still wins a vote of old tickets, and a tip to send a ticket there is a wrong tip.
//                            Walked from the group (a reference to sys_user_group; the policy guard checks that step: DOT_WALK_TABLES) in the SAME
//                            read, so there is no new request. A key that does not come back (a column the user may not read arrives as a missing
//                            key) is 'unknown', which is not 'inactive': the group stays in the vote, as it was.
const ROUTING_FIELDS = ['assignment_group', 'assignment_group.active', 'subcategory', 'priority'];

// 'true' | 'false' | '' (not told) for a walked flag.
const flagOf = (row, column) => (raw(row?.[column]) === 'true' || raw(row?.[column]) === 'false' ? raw(row[column]) : '');

function toHit(row, table, routing = false) {
  const extra = routing
    ? { assignment_group: oneLine(disp(row.assignment_group), 100), assignment_group_active: flagOf(row, 'assignment_group.active'), subcategory: oneLine(disp(row.subcategory), 100), priority: oneLine(disp(row.priority), 40) }
    : {};
  return {
    ...extra,
    table,
    sysId: raw(row.sys_id).toLowerCase(),
    number: oneLine(disp(row.number), 40),
    short_description: cleanText(disp(row.short_description), LIMITS.shortDescription),
    state: oneLine(disp(row.state), 40),
    close_notes: cleanText(disp(row.close_notes), LIMITS.similarCloseNotes),
    close_code: oneLine(disp(row.close_code) || disp(row.resolution_code), 60),
    // The stored value of the same choice (a form's choice field is filled by value, src/insights/closeCode.js) and who solved it
    // (the "solved before by" line). Both columns were read already; nothing new is asked of the instance.
    close_code_value: oneLine(raw(row.close_code) || raw(row.resolution_code), 60),
    assigned_to: oneLine(disp(row.assigned_to), 100),
    resolved_at: oneLine(disp(row.resolved_at) || disp(row.closed_at), 40),
    category: oneLine(disp(row.category), 100),
    cmdb_ci: oneLine(disp(row.cmdb_ci), 100),
    cat_item: oneLine(disp(row.cat_item), 100),
    product: oneLine(disp(row.product), 100),
    people: namesOn(row),
  };
}

/**
 * Earlier tickets on the same table that read like this one, best first.
 * @param {object} pack a ContextPack (uses table, sysId and the short description, CI and category in fields)
 * @param {{ queryTable: Function }} deps
 * @param {{ resolvedOnly?: boolean, limit?: number, allowSensitive?: boolean, routing?: boolean }} [options]
 *   resolvedOnly: only tickets that have close notes (a documented fix). routing: also read each hit's assignment group,
 *   subcategory and priority (in the same read), for the Insights routing vote.
 * @returns {Promise<{ hits: object[], keywords: string[], access: object[] }>}
 *   hit: { table, sysId, number, short_description, state, close_notes, close_code, resolved_at, category, cmdb_ci,
 *   score, why: string[] }
 */
export async function findSimilarTickets(pack, deps, { resolvedOnly = false, limit = 8, allowSensitive = false, routing = false } = {}) {
  const table = pack.table;
  if (isSensitiveTable(table, deps.sensitivePrefixes) && !allowSensitive) return { hits: [], keywords: [], access: [accessEntry(table, STATUS.SKIPPED, SENSITIVE_NOTE)] };
  const keywords = searchKeywords(pack);
  if (!keywords.length) return { hits: [], keywords, access: [accessEntry(table, STATUS.SKIPPED, tm('The short description has no words worth searching for.'))] };

  let query = similarQuery(keywords, { excludeSysId: pack.sysId });
  if (resolvedOnly) {
    const [conditions, order] = query.split('^ORDERBY');
    query = `${conditions}^close_notesISNOTEMPTY^ORDERBY${order}`;
  }
  const fields = [...TICKET_FIELDS, ...(routing ? ROUTING_FIELDS : []), ...(BASE_TABLES.has(table) ? ['sys_class_name'] : [])];
  const { rows, failure } = await softRead(deps, table, query, fields, { limit: SIMILAR_READ, displayValue: true });
  if (failure) return { hits: [], keywords, access: [accessEntry(table, failure.status, failure.note)] };

  const own = String(pack.sysId).toLowerCase();
  const gate = { allowSensitive, sensitivePrefixes: deps.sensitivePrefixes };
  const flat = rows.filter((row) => raw(row.sys_id).toLowerCase() !== own && classAllowed(row, table, gate));
  const ranked = rankSimilar(flat.map((row) => ({ ...row, short_description: disp(row.short_description), sys_updated_on: raw(row.sys_updated_on) })), keywords);
  const byId = new Map(flat.map((row) => [raw(row.sys_id), row]));
  const hits = ranked
    .map(({ row, shared, total }) => {
      const item = toHit(byId.get(raw(row.sys_id)) || row, table, routing);
      const { score, why } = scoreHit({ item, shared, total, words: keywords.filter((w) => textHas(item.short_description, w)) }, pack);
      return { ...item, score, why };
    })
    .filter((hit) => !resolvedOnly || hit.close_notes)
    .map((hit, order) => ({ hit, order }))
    .sort((a, b) => b.hit.score - a.hit.score || a.order - b.order) // equal scores keep rankSimilar's newest-first order
    .slice(0, limit)
    .map((x) => x.hit);

  // The ticket's own table is one the user can read, so "nothing similar" is not a hidden table. It is still only "found among what was read":
  // truncated: the search stopped at the newest SIMILAR_READ matches (R-03, R-21), and a row rule may hide tickets the user cannot see.
  return { hits, keywords, truncated: rows.length >= SIMILAR_READ, access: [accessEntry(table, hits.length ? STATUS.OK : STATUS.EMPTY)] };
}

// ---- Open duplicates -----------------------------------------------------------------------------------

const DUPLICATE_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'active', 'opened_at', 'assignment_group', 'cmdb_ci', 'business_service'];
// What "the same thing" means for an outage, in the order they are checked.
const DUPLICATE_KEYS = ['cmdb_ci', 'business_service'];
const NO_KEYS_NOTE = tm('This ticket has no configuration item or business service to compare.');

/** The look-back window in hours: 1 hour to 7 days, 24 when the value is not a number. */
export function duplicateWindowHours(value) {
  const n = Number(value ?? 24);
  return Number.isFinite(n) ? Math.min(168, Math.max(1, n)) : 24;
}

/**
 * Other open tickets on the same CI or business service opened within the window: the "is this part of a wider outage?"
 * check. The window is applied here against the stored UTC time, so no server-side date expression is needed.
 *
 * The CI and the service are compared by their sys_ids, read from the record itself (one small read of two columns). A name is
 * neither unique (a CMDB holds many "Email" or same-hostname CIs, and those tickets are not one outage) nor always what the
 * display value shows, and a sys_id needs no escaping: no text from the record ever goes into these queries.
 * @param {{ windowHours?: number, limit?: number, now?: number, allowSensitive?: boolean }} [options] now: milliseconds
 * @returns {Promise<{ hits: object[], windowHours: number, access: object[] }>}
 *   hit: { table, sysId, number, short_description, state, opened_at, assignment_group, same: ('cmdb_ci'|'business_service')[], hoursAgo }
 */
export async function findOpenDuplicates(pack, deps, { windowHours = 24, limit = 10, now = Date.now(), allowSensitive = false } = {}) {
  const table = pack.table;
  const hours = duplicateWindowHours(windowHours);
  const result = (hits, access, truncated = false) => ({ hits, windowHours: hours, truncated, access });
  if (isSensitiveTable(table, deps.sensitivePrefixes) && !allowSensitive) return result([], [accessEntry(table, STATUS.SKIPPED, SENSITIVE_NOTE)]);
  const sysId = String(pack.sysId || '').toLowerCase();
  // Only the columns this kind of record has (its ceiling): a request has neither, a case has a CI but no service.
  const ceiling = FIELDS_BY_KIND[kindForTable(table)] || [];
  const columns = DUPLICATE_KEYS.filter((c) => ceiling.includes(c));
  if (!SYS_ID_RE.test(sysId) || !columns.length) return result([], [accessEntry(table, STATUS.SKIPPED, NO_KEYS_NOTE)]);

  const ownRead = await softRead(deps, table, `sys_id=${sysId}`, ['sys_id', ...columns], { limit: 1, displayValue: false });
  if (ownRead.failure) return result([], [accessEntry(table, ownRead.failure.status, ownRead.failure.note)]);
  const record = ownRead.rows.find((row) => raw(row.sys_id).toLowerCase() === sysId);
  if (!record) return result([], [accessEntry(table, STATUS.ERROR, NOTE_TEXT.error)]);
  // The item or the service did not come back at all: the user may not read it, so "no other ticket on it" cannot be said (R-14).
  if (absentColumns(record, columns).length) return result([], [hiddenFieldEntry(table)]);
  // Stored values only, and only when they ARE sys_ids: anything else stays out of the query.
  const keys = columns.map((c) => [c, raw(record[c]).trim().toLowerCase()]).filter(([, id]) => SYS_ID_RE.test(id));
  if (!keys.length) return result([], [accessEntry(table, STATUS.SKIPPED, NO_KEYS_NOTE)]);

  const cutoff = now - hours * HOUR;
  const found = new Map();
  const failures = [];
  let read = false;
  let truncated = false; // a full page: there may be more open tickets on the item than were read (a lower bound, said as "at least")
  for (const [field, id] of keys) {
    const query = `${field}=${id}^active=true^sys_id!=${sysId}^ORDERBYDESCopened_at`;
    // eslint-disable-next-line no-await-in-loop -- two small reads at most, kept sequential.
    const { rows, failure } = await softRead(deps, table, query, DUPLICATE_FIELDS, { limit: DUPLICATE_READ, displayValue: true });
    if (failure) {
      failures.push(accessEntry(table, failure.status, failure.note));
      continue;
    }
    // A condition the instance ignored returns rows of other CIs; they are not duplicates of anything.
    const matching = rows.filter((row) => raw(row[field]).trim().toLowerCase() === id);
    if (matching.length < rows.length) {
      failures.push(accessEntry(table, STATUS.ERROR, NOTE_TEXT.ignoredFilter));
      continue;
    }
    read = true;
    if (rows.length >= DUPLICATE_READ) truncated = true;
    for (const row of matching) {
      const rowId = raw(row.sys_id).toLowerCase();
      const opened = parseSnTime(raw(row.opened_at));
      if (!SYS_ID_RE.test(rowId) || rowId === sysId || !Number.isFinite(opened) || opened < cutoff) continue;
      const hit = found.get(rowId) || {
        table,
        sysId: rowId,
        number: oneLine(disp(row.number), 40),
        short_description: cleanText(disp(row.short_description), LIMITS.shortDescription),
        state: oneLine(disp(row.state), 40),
        opened_at: oneLine(disp(row.opened_at), 40),
        assignment_group: oneLine(disp(row.assignment_group), 100),
        same: [],
        hoursAgo: Math.round(((now - opened) / HOUR) * 10) / 10,
        openedMs: opened,
      };
      hit.same.push(field);
      found.set(rowId, hit);
    }
  }
  const hits = [...found.values()]
    .sort((a, b) => b.same.length - a.same.length || b.openedMs - a.openedMs)
    .slice(0, limit)
    .map(({ openedMs, ...hit }) => hit);
  // A read that worked is a fact (the record's own table is readable); otherwise say why not.
  return result(hits, read ? [accessEntry(table, hits.length ? STATUS.OK : STATUS.EMPTY)] : failures, truncated);
}

// ---- Knowledge -----------------------------------------------------------------------------------------

/** Rank articles by keyword overlap: a keyword in the title counts double a keyword in the text. Pure. */
export function scoreArticle({ title, body }, keywords) {
  const inTitle = keywords.filter((w) => textHas(title, w));
  const inBody = keywords.filter((w) => !inTitle.includes(w) && textHas(body, w));
  const points = inTitle.length * 2 + inBody.length;
  const why = [];
  if (inTitle.length) why.push(`title mentions ${inTitle.join(', ')}`);
  if (inBody.length) why.push(`text mentions ${inBody.join(', ')}`);
  return { score: Math.min(100, Math.round((100 * points) / Math.max(1, keywords.length * 2))), why };
}

/**
 * Published knowledge articles that match the ticket, best first. Expired articles (valid_to in the past) are dropped
 * when the date can be read.
 * @returns {Promise<{ hits: object[], keywords: string[], access: object[] }>}
 *   hit: { sysId, number, short_description, excerpt (<= 600 chars of text), knowledgeBase, viewCount, updated, score, why }
 */
export async function searchKnowledge(pack, deps, { limit = 5, now = Date.now(), memo } = {}) {
  const source = 'kb_knowledge';
  const keywords = searchKeywords(pack, { extra: String(pack.fields?.description || '').slice(0, 300), max: 5 });
  if (!keywords.length) return { hits: [], keywords, access: [accessEntry(source, STATUS.SKIPPED, tm('This ticket has no words worth searching for.'))] };

  const like = keywords.flatMap((w) => [`short_descriptionLIKE${w}`, `textLIKE${w}`]).join('^OR');
  const query = `workflow_state=published^${like}^ORDERBYDESCsys_updated_on`;
  // (`active` is read with the rest so a retired article is dropped here too; it adds no read: R-10)
  const fields = ['sys_id', 'number', 'short_description', 'text', 'sys_updated_on', 'kb_knowledge_base', 'view_count', 'sys_view_count', 'valid_to', 'author', 'active'];
  const { rows, failure } = await softRead(deps, source, query, fields, { limit: ARTICLE_READ, displayValue: true });
  if (failure) return { hits: [], keywords, access: [accessEntry(source, failure.status, failure.note)] };

  const today = new Date(now).toISOString().slice(0, 10);
  const hits = rows
    .filter((row) => !raw(row.valid_to) || raw(row.valid_to).slice(0, 10) >= today)
    .filter((row) => raw(row.active) !== 'false')
    .map((row) => {
      const body = stripHtml(disp(row.text));
      const title = cleanText(disp(row.short_description), LIMITS.shortDescription);
      const { score, why } = scoreArticle({ title, body }, keywords);
      return {
        sysId: raw(row.sys_id).toLowerCase(),
        number: oneLine(disp(row.number), 40),
        short_description: title,
        excerpt: cleanText(body, LIMITS.kbExcerpt, { html: false }), // (the body is plain text already: "<String>" in it is a word)
        knowledgeBase: oneLine(disp(row.kb_knowledge_base), 100),
        viewCount: Number.parseInt(raw(row.view_count) || raw(row.sys_view_count), 10) || 0,
        updated: oneLine(disp(row.sys_updated_on), 40),
        people: namesOn(row, ['author']),
        score,
        why,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.viewCount - a.viewCount || b.updated.localeCompare(a.updated))
    .slice(0, limit);

  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
    return { hits, keywords, access: [accessEntry(source, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)] };
  }
  // (`truncated`: only the newest ARTICLE_READ matches were ranked, so "none matches" is "none among the newest": R-21)
  return { hits, keywords, truncated: rows.length >= ARTICLE_READ, access: [accessEntry(source, hits.length ? STATUS.OK : STATUS.EMPTY)] };
}
