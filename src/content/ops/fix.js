// READ operations of round 4 (docs/round4.md), owned by the Find the fix agent. GET-only; see the top of ./index.js.
//
//   fixCodeSearch  { table, sysId, codes: string[] (1 to 3) }  -> { codes, articles, tickets, access }
//     The error codes a ticket quotes (src/insights/errorCodes.js, found in the panel from what the glance read), looked up in
//     published knowledge articles and in the solved tickets of the record's own table: up to 5 of each, newest first, never the
//     record itself. Asked for by the agent with one click ("Search articles and solved tickets" in "Steps that worked before").
//
// Every read is a GET through the context engine's deps (the person's own session; the policy guard refuses blocked tables). The codes
// are the only thing from the panel that goes into a query, and each must be letters, digits, dot, underscore or dash (2 to 40
// characters) or the whole request is refused: nothing in them can end a condition or start another. The instance's LIKE finds the
// characters anywhere, so every row is checked again here (mentionsCode) before it is returned; the text read to check it (an
// article's body, a ticket's description) is dropped at once and never returned.

import { KB_TABLE, excerptAround } from '../../context/knowledge.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from '../../context/access.js';
import { isSensitiveTable, kindForTable } from '../../context/kinds.js';
import { LIMITS } from '../../context/allowlists.js';
import { SYS_ID_RE, cleanText, disp, oneLine, raw, stripHtml } from '../../context/util.js';
import { isCodeTerm, mentionsCode } from '../../insights/errorCodes.js';
import { firstSentences } from '../../insights/steps.js';

export const MAX_CODES = 3;
export const CODE_HITS = 5; // articles, and solved tickets, shown at most
const READ_ROWS = 20; // rows read per table: the check below drops the ones that only contain the characters

const SENSITIVE_NOTE = 'This record is in a sensitive table, so other records are not searched unless sensitive data is allowed.';
const NOT_A_TICKET_NOTE = 'Solved tickets are looked up for tickets only.';
// The record kinds whose own table holds tickets that can be solved (src/context/kinds.js). Anything else: articles only.
const TICKET_KINDS = new Set(['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task']);
// A table that holds the rows of many classes (a record opened through /task.do): each row's class is checked, as for look-alikes.
const BASE_TABLES = new Set(['task']);

const nowOf = (deps) => (typeof deps.now === 'function' ? Number(deps.now()) : Date.now());

/**
 * The codes the panel asked for: 1 to 3 search terms (isCodeTerm), duplicates dropped. Anything else refuses the whole request.
 * @returns {string[]}
 */
export function checkCodes(value) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length || list.length > MAX_CODES || !list.every(isCodeTerm)) throw new Error('That is not an error code Agent Buddy can search for.');
  const seen = new Set();
  return list.filter((code) => {
    const k = code.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// `col1LIKEa^ORcol2LIKEa^ORcol1LIKEb...`: one OR group (in an encoded query ^OR joins the condition before it). Terms are checked again.
const likeAny = (codes, columns) =>
  codes
    .filter(isCodeTerm)
    .flatMap((code) => columns.map((column) => `${column}LIKE${code}`))
    .join('^OR');

/** Published articles whose title or text contains one of the codes, newest change first. '' when no code is usable. */
export function articleCodeQuery(codes) {
  const like = likeAny(codes, ['short_description', 'text']);
  return like ? `workflow_state=published^${like}^ORDERBYDESCsys_updated_on` : '';
}

/**
 * Tickets with close notes (a documented fix) whose title, description or close notes contain one of the codes, not this record,
 * newest change first. Whether each was really resolved or closed is checked on the rows (a table's state values differ).
 */
export function ticketCodeQuery(codes, excludeSysId) {
  const like = likeAny(codes, ['short_description', 'description', 'close_notes']);
  if (!like || !SYS_ID_RE.test(String(excludeSysId || ''))) return '';
  return `close_notesISNOTEMPTY^sys_id!=${String(excludeSysId).toLowerCase()}^${like}^ORDERBYDESCsys_updated_on`;
}

const codesIn = (text, codes) => codes.filter((code) => mentionsCode(text, code));

const ARTICLE_FIELDS = ['sys_id', 'number', 'short_description', 'text', 'workflow_state', 'kb_knowledge_base', 'sys_updated_on', 'valid_to'];

/**
 * @returns {Promise<{ items: { sysId, number, short_description, knowledgeBase, excerpt, codes }[], access: object[] }>}
 */
export async function searchArticlesByCode(codes, deps, { now = Date.now(), memo, limit = CODE_HITS } = {}) {
  const query = articleCodeQuery(codes);
  if (!query) return { items: [], access: [accessEntry(KB_TABLE, STATUS.SKIPPED, 'There is no error code to search for.')] };
  const { rows, failure } = await softRead(deps, KB_TABLE, query, ARTICLE_FIELDS, { limit: READ_ROWS, displayValue: true });
  if (failure) return { items: [], access: [accessEntry(KB_TABLE, failure.status, failure.note)] };
  const today = new Date(now).toISOString().slice(0, 10);
  const items = [];
  for (const row of rows) {
    const sysId = raw(row.sys_id).toLowerCase();
    // Published and still valid only (an instance that ignored a condition would answer with drafts), and a real mention.
    if (!SYS_ID_RE.test(sysId) || ('workflow_state' in row && raw(row.workflow_state) !== 'published')) continue;
    if (raw(row.valid_to) && raw(row.valid_to).slice(0, 10) < today) continue;
    const title = cleanText(disp(row.short_description), LIMITS.shortDescription);
    const body = stripHtml(disp(row.text));
    const found = codesIn(`${title}\n${body}`, codes);
    if (!found.length) continue;
    items.push({
      sysId,
      number: oneLine(disp(row.number), 40),
      short_description: title,
      knowledgeBase: oneLine(disp(row.kb_knowledge_base), 100),
      excerpt: cleanText(excerptAround(body, found, 160), 200, { html: false }),
      codes: found,
    });
    if (items.length >= limit) break;
  }
  if (!rows.length) {
    // Zero rows from knowledge proves nothing until the user is known to see any article at all.
    const seen = await confirmEmptyIsReallyEmpty(KB_TABLE, deps, memo);
    return { items, access: [accessEntry(KB_TABLE, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)] };
  }
  return { items, access: [accessEntry(KB_TABLE, items.length ? STATUS.OK : STATUS.EMPTY)] };
}

const TICKET_FIELDS = ['sys_id', 'number', 'short_description', 'description', 'close_notes', 'state', 'resolved_at', 'closed_at', 'sys_updated_on'];

/**
 * Solved tickets of the record's own table that mention one of the codes. "Solved": close notes written and a resolved or closed
 * time set (docs/live-questions/fix.md, question 3).
 * @returns {Promise<{ items: { table, sysId, number, short_description, state, solvedUtc, fix, codes }[], access: object[] }>}
 */
export async function searchSolvedByCode({ table, sysId }, codes, deps, { allowSensitive = false, limit = CODE_HITS } = {}) {
  if (!TICKET_KINDS.has(kindForTable(table))) return { items: [], access: [accessEntry(table, STATUS.SKIPPED, NOT_A_TICKET_NOTE)] };
  if (isSensitiveTable(table, deps.sensitivePrefixes) && !allowSensitive) return { items: [], access: [accessEntry(table, STATUS.SKIPPED, SENSITIVE_NOTE)] };
  const own = String(sysId || '').toLowerCase();
  const query = ticketCodeQuery(codes, own);
  if (!query) return { items: [], access: [accessEntry(table, STATUS.SKIPPED, 'There is no error code to search for.')] };
  const fields = BASE_TABLES.has(table) ? [...TICKET_FIELDS, 'sys_class_name'] : TICKET_FIELDS;
  const { rows, failure } = await softRead(deps, table, query, fields, { limit: READ_ROWS, displayValue: true });
  if (failure) return { items: [], access: [accessEntry(table, failure.status, failure.note)] };
  const items = [];
  for (const row of rows) {
    const id = raw(row.sys_id).toLowerCase();
    if (!SYS_ID_RE.test(id) || id === own) continue;
    // A row of a general task table is used only when its class can be read and is not sensitive (or sensitive data is allowed).
    if (BASE_TABLES.has(table) && !allowSensitive) {
      const cls = raw(row.sys_class_name).trim().toLowerCase();
      if (!cls || isSensitiveTable(cls, deps.sensitivePrefixes)) continue;
    }
    const notes = cleanText(disp(row.close_notes), LIMITS.similarCloseNotes);
    if (!notes || !(raw(row.resolved_at) || raw(row.closed_at))) continue;
    const title = cleanText(disp(row.short_description), LIMITS.shortDescription);
    const found = codesIn(`${title}\n${stripHtml(disp(row.description))}\n${notes}`, codes);
    if (!found.length) continue;
    items.push({
      table,
      sysId: id,
      number: oneLine(disp(row.number), 40),
      short_description: title,
      state: oneLine(disp(row.state), 40),
      // the stored (UTC) time it was resolved or closed, for "3 d ago" in the panel
      solvedUtc: oneLine(raw(row.resolved_at) || raw(row.closed_at), 40),
      fix: firstSentences(notes, 160),
      codes: found,
    });
    if (items.length >= limit) break;
  }
  // The record's own table is one the user can read, so "none" is a fact, not a hidden table.
  return { items, access: [accessEntry(table, items.length ? STATUS.OK : STATUS.EMPTY)] };
}

export default {
  async fixCodeSearch(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const codes = checkCodes(args?.codes);
    const record = { table: String(args.table), sysId: String(args.sysId).toLowerCase() };
    const memo = new Map();
    const [articles, tickets] = await Promise.all([
      searchArticlesByCode(codes, deps, { now: nowOf(deps), memo }),
      searchSolvedByCode(record, codes, deps, { allowSensitive }),
    ]);
    return { codes, articles: articles.items, tickets: tickets.items, access: [...articles.access, ...tickets.access] };
  },
};
