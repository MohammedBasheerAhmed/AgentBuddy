// READ operations of round 4 (docs/round4.md), owned by the Find the fix agent. GET-only; see the top of ./index.js.
//
//   fixCodeSearch  { table, sysId, codes: string[] (1 to 3) }  -> { codes, articles, tickets, access }
//     The error codes a ticket quotes (src/insights/errorCodes.js, found in the panel from what the glance read), looked up in
//     published knowledge articles and in the solved tickets of the record's own table: up to 5 of each, newest first, never the
//     record itself. Asked for by the agent with one click ("Search articles and solved tickets" in "Steps that worked before").
//
//   fulfilledBefore  { table, sysId } (a requested item or a catalog task) -> { items, access }   (wave 6, "Fulfilled before")
//     The last completed tasks (Closed Complete) of the SAME catalog item, newest first, at most 5: who did each (when the name can be
//     read), when it was opened and closed, and its close notes, cut to their first sentences in the panel. The tasks of the open item itself
//     are current work and are left out. ONE limited read of the catalog task table, after one small read of the open record for its catalog
//     item. Nothing is sent anywhere; the panel shows it in the "Find the fix" row.
//
// Every read is a GET through the context engine's deps (the person's own session; the policy guard refuses blocked tables). The codes
// are the only thing from the panel that goes into a query, and each must be letters, digits, dot, underscore or dash (2 to 40
// characters) or the whole request is refused: nothing in them can end a condition or start another. The instance's LIKE finds the
// characters anywhere, so every row is checked again here (mentionsCode) before it is returned; the text read to check it (an
// article's body, a ticket's description) is dropped at once and never returned.

import { KB_TABLE, excerptAround } from '../../context/knowledge.js';
import { NOTE_TEXT, STATUS, absentColumns, confirmEmptyIsReallyEmpty, entry as accessEntry, hiddenFieldEntry, softRead, tm } from '../../context/access.js';
import { isSensitiveTable, kindForTable } from '../../context/kinds.js';
import { LIMITS, allowedFields } from '../../context/allowlists.js';
import { SYS_ID_RE, cleanText, disp, oneLine, parseSnTime, raw, sameId, stripHtml } from '../../context/util.js';
import { finishedKind } from '../../domain/states.js';
import { isCodeTerm, mentionsCode } from '../../insights/errorCodes.js';
import { firstSentences } from '../../insights/steps.js';

export const MAX_CODES = 3;
export const CODE_HITS = 5; // articles, and solved tickets, shown at most
const READ_ROWS = 20; // rows read per table: the check below drops the ones that only contain the characters

const SENSITIVE_NOTE = NOTE_TEXT.sensitiveOthers;
const NOT_A_TICKET_NOTE = tm('Solved tickets are looked up for tickets only.');
const NO_CODE_NOTE = tm('There is no error code to search for.');
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
  if (!query) return { items: [], access: [accessEntry(KB_TABLE, STATUS.SKIPPED, NO_CODE_NOTE)] };
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
  if (!query) return { items: [], access: [accessEntry(table, STATUS.SKIPPED, NO_CODE_NOTE)] };
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
  // The record's own table is one the user can read, so this is not a hidden table. It is still only "none found that you can see": a row
  // rule can hide solved tickets from this user, and the card words it so (R-08).
  return { items, access: [accessEntry(table, items.length ? STATUS.OK : STATUS.EMPTY)] };
}

// ---- Fulfilled before (wave 6) ----------------------------------------------------------------------------------------------------
//
// "The last tasks of this kind that were done": for a requested item or a catalog task, the newest Closed Complete catalog tasks of the same
// catalog item. ServiceNow cannot show it on the task. Two reads, both through the guarded deps (a blocked table, or a dot-walk through one,
// is refused before a request is made and shows as the organisation's rule):
//   1. the open record, for its catalog item: `cat_item` on a requested item, `request_item` and `request_item.cat_item` on a catalog task
//      (the column the pack reads the same way, specs/fit.js). Ids only: nothing the panel sends goes into a query but the checked table name
//      and sys_id, and the item's id is read here from the record itself.
//   2. the catalog task table, ONE limited read: tasks of that item (walked from their requested item) that are Closed Complete (the stored
//      value 3 on every task table, docs/states.md) and do not belong to the open item, newest closed first.
// Every row is checked again here, because the instance ignores a condition on a column it cannot use and then answers with other rows:
// its catalog item must be this one, it must not be the open task or a task of the open item, and its state must mean "done".
export const FULFILLED_SHOWN = 5;
const FULFILLED_READ = 15; // a few more than shown: the checks below drop rows that do not belong
const FULFILLED = 'fulfilled-before'; // the feature whose spec (src/context/specs/fix.js) lists every column read here
const TASK_TABLE = 'sc_task';
const OWN_COLUMNS = ['cat_item', 'request_item', 'request_item.cat_item']; // what the open record is asked for, out of the spec
const NOT_CATALOG_NOTE = tm('Earlier tasks are looked up for requested items and catalog tasks only.');
const NO_ITEM_NOTE = tm('This ticket has no catalog item, so earlier tasks for it were not looked up.');

const closedAt = (item) => parseSnTime(item.closedUtc);
// Newest closed first; a task whose closing time cannot be read goes after the ones that have one.
const newestFirst = (a, b) => {
  const x = closedAt(a);
  const y = closedAt(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return y - x;
  if (Number.isFinite(x)) return -1;
  return Number.isFinite(y) ? 1 : 0;
};

/**
 * @param {{ table: string, sysId: string }} record  a requested item or a catalog task
 * @param {object} deps  the guarded reads
 * @param {{ allowSensitive?: boolean, memo?: Map }} [options]
 * @returns {Promise<{ items: { table, sysId, number, short_description, who, notes, notesUnread, openedUtc, closedUtc, people }[], access: object[] }>}
 *   `items` is empty with an access entry that says why (hidden, refused, blocked, not looked up), or with 'empty' when the table is readable and
 *   no earlier task of this item is visible to this person. `who` is '' when the name cannot be read; `notesUnread`: the close notes column did
 *   not come back for that task (a field this person may not read), which is not "no notes".
 */
export async function readFulfilledBefore({ table, sysId }, deps, { allowSensitive = false, memo = new Map() } = {}) {
  const own = String(sysId || '').toLowerCase();
  const done = (items, entry) => ({ items, access: [entry] });
  const kind = kindForTable(table);
  if (kind !== 'requested_item' && kind !== 'catalog_task') return done([], accessEntry(table, STATUS.SKIPPED, NOT_CATALOG_NOTE));
  if (isSensitiveTable(TASK_TABLE, deps.sensitivePrefixes) && !allowSensitive) return done([], accessEntry(TASK_TABLE, STATUS.SKIPPED, SENSITIVE_NOTE));

  // 1. Which catalog item is this?
  const wanted = allowedFields(table, FULFILLED, { allowSensitive, sensitivePrefixes: deps.sensitivePrefixes }).filter((name) => OWN_COLUMNS.includes(name));
  const ownRead = await softRead(deps, table, `sys_id=${own}`, ['sys_id', ...wanted], { limit: 1, displayValue: true });
  if (ownRead.failure) return done([], accessEntry(table, ownRead.failure.status, ownRead.failure.note));
  const record = ownRead.rows.find((row) => sameId(raw(row.sys_id), own));
  if (!record) return done([], accessEntry(table, STATUS.ERROR, NOTE_TEXT.error));
  // A column that did not come back at all is one this person may not read: "no earlier tasks" cannot be said (R-14).
  if (absentColumns(record, wanted).length) return done([], hiddenFieldEntry(table));
  const itemId = raw(kind === 'catalog_task' ? record['request_item.cat_item'] : record.cat_item).trim().toLowerCase();
  const ritm = kind === 'catalog_task' ? raw(record.request_item).trim().toLowerCase() : own;
  if (!SYS_ID_RE.test(itemId) || !SYS_ID_RE.test(ritm)) {
    // The task names its requested item but the item came back empty: that item is hidden from this person, which is not "no item".
    if (kind === 'catalog_task' && SYS_ID_RE.test(ritm)) return done([], hiddenFieldEntry(table));
    return done([], accessEntry(table, STATUS.SKIPPED, NO_ITEM_NOTE));
  }

  // 2. The earlier tasks of that item.
  const fields = allowedFields(TASK_TABLE, FULFILLED, { allowSensitive, sensitivePrefixes: deps.sensitivePrefixes });
  const query = `request_item.cat_item=${itemId}^state=3^request_item!=${ritm}^ORDERBYDESCclosed_at`;
  const { rows, failure } = await softRead(deps, TASK_TABLE, query, ['sys_id', ...fields], { limit: FULFILLED_READ, displayValue: true });
  if (failure) return done([], accessEntry(TASK_TABLE, failure.status, failure.note));
  if (!rows.length) {
    // Zero rows prove nothing until this person is known to see tasks at all; even then it is "none that you can see" (R-02).
    const seen = await confirmEmptyIsReallyEmpty(TASK_TABLE, deps, memo);
    return done([], accessEntry(TASK_TABLE, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note));
  }
  // The instance ignored the condition on the item: these are other items' tasks, and none of them is used.
  if (rows.some((row) => !sameId(raw(row['request_item.cat_item']), itemId))) return done([], accessEntry(TASK_TABLE, STATUS.ERROR, NOTE_TEXT.ignoredFilter));

  const items = [];
  for (const row of rows) {
    const id = raw(row.sys_id).toLowerCase();
    if (!SYS_ID_RE.test(id) || id === own || sameId(raw(row.request_item), ritm)) continue;
    // Closed Complete only (a site may have other values; the one reader of states says what a value means).
    if (finishedKind({ table: TASK_TABLE, value: raw(row.state), label: disp(row.state) }) !== 'done') continue;
    const who = oneLine(disp(row.assigned_to), 100);
    items.push({
      table: TASK_TABLE,
      sysId: id,
      number: oneLine(disp(row.number), 40),
      short_description: cleanText(disp(row.short_description), LIMITS.shortDescription),
      who,
      notes: cleanText(disp(row.close_notes), LIMITS.historyCloseNotes),
      notesUnread: !Object.hasOwn(row, 'close_notes'),
      // the stored (UTC) times: how long it took, and when, are worked out in the panel
      openedUtc: oneLine(raw(row.opened_at), 40),
      closedUtc: oneLine(raw(row.closed_at), 40),
      people: who ? [who] : [],
    });
  }
  // Rows came back but none of them is a done task of another request of this item: the conditions were not applied, which is not "none".
  if (!items.length) return done([], accessEntry(TASK_TABLE, STATUS.ERROR, NOTE_TEXT.ignoredFilter));
  return done(items.sort(newestFirst).slice(0, FULFILLED_SHOWN), accessEntry(TASK_TABLE, STATUS.OK));
}

export default {
  async fulfilledBefore(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    return readFulfilledBefore({ table: String(args.table), sysId: String(args.sysId).toLowerCase() }, deps, { allowSensitive });
  },

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
