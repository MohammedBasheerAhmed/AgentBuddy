// "Seen this before?": similar tickets, other open tickets on the same CI or service, and knowledge articles that match.
// Plain keyword matching on the short description (src/lib/similar.js), boosted by a shared CI or category. No AI tokens.
// Results are for local display: they carry sysId/table so the panel can link them, and are not ContextPack data.

import { rankSimilar, similarKeywords, similarQuery } from '../lib/similar.js';
import { LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { isSensitiveTable } from './kinds.js';
import { cleanText, disp, oneLine, parseSnTime, queryValue, raw, stripHtml } from './util.js';

const HOUR = 3600000;
const SENSITIVE_NOTE = 'This record is in a sensitive table, so other records are not searched unless sensitive data is allowed.';

// Columns asked of the candidates; a column the table does not have is simply not returned.
const TICKET_FIELDS = [
  'sys_id', 'number', 'short_description', 'state', 'close_notes', 'close_code', 'resolution_code', 'resolved_at', 'closed_at',
  'category', 'cmdb_ci', 'cat_item', 'product', 'sys_updated_on',
];

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Words worth searching for in a ticket: no email addresses, links or phone numbers, and not the names of the people
// on the record (a caller's name says nothing about the problem). Same extraction as src/lib/similar.js otherwise.
export function searchKeywords(pack, { extra = '', max = 4 } = {}) {
  const text = `${pack.fields?.short_description || ''} ${extra}`
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ');
  const names = new Set(
    (pack.people || [])
      .flatMap((p) => [p.name, p.firstName, p.lastName])
      .flatMap((n) => String(n || '').toLowerCase().split(/[^\p{L}]+/u))
      .filter(Boolean)
  );
  return similarKeywords(text, max + names.size + 2).filter((w) => !names.has(w)).slice(0, max);
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

function toHit(row, table) {
  return {
    table,
    sysId: raw(row.sys_id).toLowerCase(),
    number: oneLine(disp(row.number), 40),
    short_description: cleanText(disp(row.short_description), LIMITS.shortDescription),
    state: oneLine(disp(row.state), 40),
    close_notes: cleanText(disp(row.close_notes), LIMITS.similarCloseNotes),
    close_code: oneLine(disp(row.close_code) || disp(row.resolution_code), 60),
    resolved_at: oneLine(disp(row.resolved_at) || disp(row.closed_at), 40),
    category: oneLine(disp(row.category), 100),
    cmdb_ci: oneLine(disp(row.cmdb_ci), 100),
    cat_item: oneLine(disp(row.cat_item), 100),
    product: oneLine(disp(row.product), 100),
  };
}

/**
 * Earlier tickets on the same table that read like this one, best first.
 * @param {object} pack a ContextPack (uses table, sysId and the short description, CI and category in fields)
 * @param {{ queryTable: Function }} deps
 * @param {{ resolvedOnly?: boolean, limit?: number, allowSensitive?: boolean }} [options]
 *   resolvedOnly: only tickets that have close notes (a documented fix).
 * @returns {Promise<{ hits: object[], keywords: string[], access: object[] }>}
 *   hit: { table, sysId, number, short_description, state, close_notes, close_code, resolved_at, category, cmdb_ci,
 *   score, why: string[] }
 */
export async function findSimilarTickets(pack, deps, { resolvedOnly = false, limit = 8, allowSensitive = false } = {}) {
  const table = pack.table;
  if (isSensitiveTable(table) && !allowSensitive) return { hits: [], keywords: [], access: [accessEntry(table, STATUS.SKIPPED, SENSITIVE_NOTE)] };
  const keywords = searchKeywords(pack);
  if (!keywords.length) return { hits: [], keywords, access: [accessEntry(table, STATUS.SKIPPED, 'The short description has no words worth searching for.')] };

  let query = similarQuery(keywords, { excludeSysId: pack.sysId });
  if (resolvedOnly) {
    const [conditions, order] = query.split('^ORDERBY');
    query = `${conditions}^close_notesISNOTEMPTY^ORDERBY${order}`;
  }
  const { rows, failure } = await softRead(deps, table, query, TICKET_FIELDS, { limit: 30, displayValue: true });
  if (failure) return { hits: [], keywords, access: [accessEntry(table, failure.status, failure.note)] };

  const flat = rows.filter((row) => raw(row.sys_id).toLowerCase() !== String(pack.sysId).toLowerCase());
  const ranked = rankSimilar(flat.map((row) => ({ ...row, short_description: disp(row.short_description), sys_updated_on: raw(row.sys_updated_on) })), keywords);
  const byId = new Map(flat.map((row) => [raw(row.sys_id), row]));
  const hits = ranked
    .map(({ row, shared, total }) => {
      const item = toHit(byId.get(raw(row.sys_id)) || row, table);
      const text = item.short_description.toLowerCase();
      const { score, why } = scoreHit({ item, shared, total, words: keywords.filter((w) => text.includes(w)) }, pack);
      return { ...item, score, why };
    })
    .filter((hit) => !resolvedOnly || hit.close_notes)
    .map((hit, order) => ({ hit, order }))
    .sort((a, b) => b.hit.score - a.hit.score || a.order - b.order) // equal scores keep rankSimilar's newest-first order
    .slice(0, limit)
    .map((x) => x.hit);

  // The ticket's own table is one the user can read, so "nothing similar" is a fact, not a hidden table.
  return { hits, keywords, access: [accessEntry(table, hits.length ? STATUS.OK : STATUS.EMPTY)] };
}

// ---- Open duplicates -----------------------------------------------------------------------------------

const DUPLICATE_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'active', 'opened_at', 'assignment_group', 'cmdb_ci', 'business_service'];

/**
 * Other open tickets on the same CI or business service opened within the window: the "is this part of a wider outage?"
 * check. The window is applied here against the stored UTC time, so no server-side date expression is needed.
 * @param {{ windowHours?: number, limit?: number, now?: number, allowSensitive?: boolean }} [options] now: milliseconds
 * @returns {Promise<{ hits: object[], windowHours: number, access: object[] }>}
 *   hit: { table, sysId, number, short_description, state, opened_at, assignment_group, same: ('cmdb_ci'|'business_service')[], hoursAgo }
 */
export async function findOpenDuplicates(pack, deps, { windowHours = 24, limit = 10, now = Date.now(), allowSensitive = false } = {}) {
  const table = pack.table;
  if (isSensitiveTable(table) && !allowSensitive) return { hits: [], windowHours, access: [accessEntry(table, STATUS.SKIPPED, SENSITIVE_NOTE)] };
  const keys = [
    ['cmdb_ci', queryValue(pack.fields?.cmdb_ci)],
    ['business_service', queryValue(pack.fields?.business_service)],
  ].filter(([, name]) => name);
  if (!keys.length) return { hits: [], windowHours, access: [accessEntry(table, STATUS.SKIPPED, 'The ticket has no configuration item or business service to compare.')] };

  const cutoff = now - windowHours * HOUR;
  const found = new Map();
  const failures = [];
  let read = false;
  for (const [field, name] of keys) {
    const query = `${field}.name=${name}^active=true^sys_id!=${pack.sysId}^ORDERBYDESCopened_at`;
    // eslint-disable-next-line no-await-in-loop -- two small reads at most, kept sequential.
    const { rows, failure } = await softRead(deps, table, query, DUPLICATE_FIELDS, { limit: 50, displayValue: true });
    if (failure) {
      failures.push(accessEntry(table, failure.status, failure.note));
      continue;
    }
    // A condition the instance ignored returns rows of other CIs; they are not duplicates of anything.
    const own = rows.filter((row) => same(disp(row[field]), name));
    if (own.length < rows.length) {
      failures.push(accessEntry(table, STATUS.ERROR, `Could not check ${table} by ${field}: the instance did not apply the filter, so its rows were not used.`));
      continue;
    }
    read = true;
    for (const row of own) {
      const opened = parseSnTime(raw(row.opened_at));
      if (!Number.isFinite(opened) || opened < cutoff) continue;
      const id = raw(row.sys_id).toLowerCase();
      const hit = found.get(id) || {
        table,
        sysId: id,
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
      found.set(id, hit);
    }
  }
  const hits = [...found.values()]
    .sort((a, b) => b.same.length - a.same.length || b.openedMs - a.openedMs)
    .slice(0, limit)
    .map(({ openedMs, ...hit }) => hit);
  // A read that worked is a fact (the record's own table is readable); otherwise say why not.
  return { hits, windowHours, access: read ? [accessEntry(table, hits.length ? STATUS.OK : STATUS.EMPTY)] : failures };
}

// ---- Knowledge -----------------------------------------------------------------------------------------

/** Rank articles by keyword overlap: a keyword in the title counts double a keyword in the text. Pure. */
export function scoreArticle({ title, body }, keywords) {
  const inTitle = keywords.filter((w) => title.toLowerCase().includes(w));
  const inBody = keywords.filter((w) => !inTitle.includes(w) && body.toLowerCase().includes(w));
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
  if (!keywords.length) return { hits: [], keywords, access: [accessEntry(source, STATUS.SKIPPED, 'The ticket has no words worth searching for.')] };

  const like = keywords.flatMap((w) => [`short_descriptionLIKE${w}`, `textLIKE${w}`]).join('^OR');
  const query = `workflow_state=published^${like}^ORDERBYDESCsys_updated_on`;
  const fields = ['sys_id', 'number', 'short_description', 'text', 'sys_updated_on', 'kb_knowledge_base', 'view_count', 'sys_view_count', 'valid_to'];
  const { rows, failure } = await softRead(deps, source, query, fields, { limit: 15, displayValue: true });
  if (failure) return { hits: [], keywords, access: [accessEntry(source, failure.status, failure.note)] };

  const today = new Date(now).toISOString().slice(0, 10);
  const hits = rows
    .filter((row) => !raw(row.valid_to) || raw(row.valid_to).slice(0, 10) >= today)
    .map((row) => {
      const body = stripHtml(disp(row.text));
      const title = cleanText(disp(row.short_description), LIMITS.shortDescription);
      const { score, why } = scoreArticle({ title, body }, keywords);
      return {
        sysId: raw(row.sys_id).toLowerCase(),
        number: oneLine(disp(row.number), 40),
        short_description: title,
        excerpt: cleanText(body, LIMITS.kbExcerpt),
        knowledgeBase: oneLine(disp(row.kb_knowledge_base), 100),
        viewCount: Number.parseInt(raw(row.view_count) || raw(row.sys_view_count), 10) || 0,
        updated: oneLine(disp(row.sys_updated_on), 40),
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
  return { hits, keywords, access: [accessEntry(source, hits.length ? STATUS.OK : STATUS.EMPTY)] };
}
