// READ operations for the record checks area (see src/content/ops/index.js):
//
//   resolutionFacts  what the form holds right now for a few fields (unsaved; on a Workspace page only the notes boxes), and
//                    whether the ticket is linked to a problem or a knowledge article. Powers the "Check" tab and "Ready to resolve?".
//   requestTarget    which record the "Request" and "Checklist" tabs read the request chain from: a catalog task points at
//                    its requested item; a requested item or a request is its own target.
//
// Both are GET-only (the context deps) plus the page bridge's reads of what is typed on the page (getFormValues on a form with
// g_form, getBoxValues on a Workspace page). Arguments are validated; whatever the page world answers is treated as untrusted
// data and cut down to the fixed lists below.
import { STATUS, confirmEmptyIsReallyEmpty, softRead } from '../../context/access.js';
import { LINK_SOURCES, detectLinkColumn } from '../../context/knowledge.js';
import { kindForTable } from '../../context/kinds.js';
import { SYS_ID_RE, raw } from '../../context/util.js';
import { tryCallPage } from '../pageBridge.js';
import { formShowsRecord } from '../formRecord.js';

/** The only form fields ever read. */
export const FORM_FIELDS = Object.freeze(['close_notes', 'close_code', 'resolution_code', 'state', 'hold_reason', 'comments', 'work_notes']);
const MAX_FORM_TEXT = 20000;

/**
 * On a Workspace page (no g_form) only these text boxes are read, never a choice such as the close code or the state: a choice
 * shows its label, not the value the checks compare, and a wrong guess there would be worse than none.
 */
export const BOX_FIELDS = Object.freeze(['close_notes', 'work_notes', 'comments']);

// The label each box is looked for by when its column name is not on it: the same words the inserts use (the fieldLabel of the
// feature packs' inserts, src/features/packs/*.js), so the box that is read is the box an insert would fill. An incident and a
// case call close_notes "Resolution notes"; the other kinds keep the task's own "Close notes".
const RESOLUTION_NOTES_KINDS = new Set(['incident', 'case']);
const BOX_LABELS = Object.freeze({ work_notes: 'Work notes', comments: 'Additional comments' });

/** The labels for BOX_FIELDS on a record of `table`, in the same order. */
export function boxLabelsFor(table) {
  const closeNotes = RESOLUTION_NOTES_KINDS.has(kindForTable(table)) ? 'Resolution notes' : 'Close notes';
  return BOX_FIELDS.map((name) => (name === 'close_notes' ? closeNotes : BOX_LABELS[name]));
}

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// Only the names asked for, only text, each cut to length.
function keepText(values, names) {
  const out = {};
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = values[name];
    if (typeof value === 'string') out[name] = value.slice(0, MAX_FORM_TEXT);
  }
  return out;
}

/**
 * What is typed on the page for this record and not saved yet:
 *   { source: 'form', values }   a form with g_form that shows this record: every field of FORM_FIELDS it has
 *   { source: 'boxes', values }  a Workspace page (no g_form) whose address is this record: the BOX_FIELDS boxes that were found
 *   null                         no form or box can be read (a portal, nothing found), or the page shows another record
 * Values that are not text, and fields that were not asked for, are dropped.
 * @param {{ table: string, sysId: string }} record the record the panel is showing (validated by the caller)
 * @param {(action: string, args?: any[]) => Promise<any>} [callPage]
 * @param {{ currentRecord?: () => Promise<{table: string, sysId: string}|null> }} [options] the record the content script finds on the
 *   page (its form, else its address). Without it a page with no g_form gives null, and a form opened through task.do is not used.
 */
export async function readFormValues({ table, sysId }, callPage = tryCallPage, { currentRecord = null } = {}) {
  let meta;
  try {
    meta = await callPage('getFormMeta');
  } catch {
    meta = null;
  }
  // No form at all (a Workspace): the boxes, but only when the page's address is this record.
  if (meta === null || meta === undefined) return readBoxValues({ table, sysId }, callPage, currentRecord);
  // The bridge answers for whatever form is open now: make sure it is the record the panel is showing (a form opened through task.do
  // says 'task': src/content/formRecord.js).
  if (!(await formShowsRecord(meta, { table, sysId }, currentRecord))) return null;
  let values;
  try {
    values = await callPage('getFormValues', [[...FORM_FIELDS]]);
  } catch {
    values = null;
  }
  if (!isPlainObject(values)) return null;
  return { source: 'form', values: keepText(values, FORM_FIELDS) };
}

// A Workspace keeps no g_form, so nothing on the page says which record its boxes belong to: the address does. The content script's
// own reading of it (the same one the panel's header comes from) must be this record before a box is read; another record, or no
// record, reads nothing. The bridge itself refuses on a page with g_form and on a portal page.
async function readBoxValues({ table, sysId }, callPage, currentRecord) {
  if (typeof currentRecord !== 'function') return null;
  let open;
  try {
    open = await currentRecord();
  } catch {
    open = null;
  }
  if (!isPlainObject(open) || open.table !== table || !sameId(open.sysId, sysId)) return null;
  let values;
  try {
    values = await callPage('getBoxValues', [[...BOX_FIELDS], boxLabelsFor(table)]);
  } catch {
    values = null;
  }
  if (!isPlainObject(values)) return null;
  const out = keepText(values, BOX_FIELDS);
  // No box found at all is the same as no form: the saved ticket is all there is to check.
  return Object.keys(out).length ? { source: 'boxes', values: out } : null;
}

// ---- links ---------------------------------------------------------------------------------------------------------

const link = (status, note = '') => ({ status, note });

// A linked problem: only an incident has `problem_id`. 'yes' | 'no' | 'unknown' | 'na'.
async function problemLink({ table, sysId }, deps) {
  if (table !== 'incident') return link('na');
  const { rows, failure } = await softRead(deps, 'incident', `sys_id=${sysId}`, ['sys_id', 'problem_id'], { limit: 1, displayValue: false });
  if (failure) {
    const why = failure.status === STATUS.DENIED ? 'You cannot read the problem link on this incident.' : failure.status === STATUS.BLOCKED ? failure.note : 'The problem link could not be read.';
    return link('unknown', why);
  }
  const row = rows.find((r) => sameId(raw(r.sys_id), sysId));
  if (!row) return link('unknown', 'The incident could not be read again to check its problem link.');
  return SYS_ID_RE.test(raw(row.problem_id)) ? link('yes') : link('no');
}

// The places a ticket can be tied to an article, and the column that points at the ticket: the same list the knowledge-gap
// radar reads (src/context/knowledge.js LINK_SOURCES). Every row is checked against the record again: ServiceNow ignores a
// condition on a column the table does not have and then returns every row, which must never pass for "linked". Which column
// kb_use has (`task_id` or `task`) is found out first with one row (detectLinkColumn), never by a query on a guess.
const KB_ARTICLE_COLUMN = { m2m_kb_task: 'kb_knowledge', kb_use: 'article' };

async function knowledgeLink({ sysId }, deps) {
  const memo = new Map();
  const unsure = [];
  let sawTable = false;
  for (const source of LINK_SOURCES) {
    // eslint-disable-next-line no-await-in-loop -- two or three small reads, kept in order.
    const detected = await detectLinkColumn(source.table, source.columns, deps, memo);
    if (detected.failure) {
      const f = detected.failure;
      unsure.push(f.status === STATUS.DENIED ? `You cannot read ${source.table}.` : f.status === STATUS.EMPTY_OR_HIDDEN ? `Your user sees no rows of ${source.table}, so "none" cannot be confirmed.` : f.note);
      continue;
    }
    const column = detected.column;
    // eslint-disable-next-line no-await-in-loop
    const { rows, failure } = await softRead(deps, source.table, `${column}=${sysId}`, [column, KB_ARTICLE_COLUMN[source.table]], { limit: 5, displayValue: false });
    if (failure) {
      unsure.push(failure.status === STATUS.DENIED ? `You cannot read ${source.table}.` : failure.note);
      continue;
    }
    if (rows.length) {
      if (rows.some((r) => !sameId(raw(r[column]), sysId))) {
        unsure.push(`${source.table} did not apply the filter on this ticket, so it was not used.`);
        continue;
      }
      return link('yes');
    }
    // Nothing found: only a fact when the user can see rows of the table at all (the column probe may already have seen one).
    if (detected.visible) {
      sawTable = true;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const seen = await confirmEmptyIsReallyEmpty(source.table, deps, memo);
    if (seen.status === STATUS.EMPTY) sawTable = true;
    else unsure.push(seen.status === STATUS.EMPTY_OR_HIDDEN ? `Your user sees no rows of ${source.table}, so "none" cannot be confirmed.` : seen.note || `${source.table} could not be checked.`);
  }
  return sawTable ? link('no') : link('unknown', unsure.join(' ').slice(0, 300));
}

// The form and the links do not depend on each other, and neither may fail the whole answer. A lost session (or a cancelled
// request) is the one thing the panel must hear about; everything else becomes "could not check".
const settle = (promise, fallback) =>
  promise.catch((err) => {
    if (err?.code === 'SESSION_EXPIRED' || err?.name === 'AbortError') throw err;
    return fallback;
  });

/**
 * { form, formSource, links } for the Check tab and the Ready-to-resolve card.
 *   form        what is typed and not saved (see readFormValues), or null
 *   formSource  'form' (every field of FORM_FIELDS the form has) | 'boxes' (a Workspace: only the BOX_FIELDS notes boxes that were
 *               found, never the close code, the state or the hold reason) | null (no form)
 * `currentRecord` (from the content script, src/content/reads.js) is the record the page's address shows.
 */
async function resolutionFacts(args, { deps, checkRecord, currentRecord = null }, callPage) {
  checkRecord(args);
  const record = { table: args.table, sysId: args.sysId.toLowerCase() };
  const [typed, problem, knowledge] = await Promise.all([
    settle(readFormValues(record, callPage, { currentRecord }), null),
    settle(problemLink(record, deps), link('unknown', 'The problem link could not be checked.')),
    settle(knowledgeLink(record, deps), link('unknown', 'The article link could not be checked.')),
  ]);
  return { form: typed ? typed.values : null, formSource: typed ? typed.source : null, links: { problem, knowledge } };
}

// ---- the record the request chain is read from --------------------------------------------------------------------

async function requestTarget(args, { deps, checkRecord }) {
  checkRecord(args);
  const { table, sysId } = args;
  if (table === 'sc_req_item' || table === 'sc_request') return { table, sysId: sysId.toLowerCase(), note: '' };
  if (table !== 'sc_task') throw new Error('This record is not part of a catalog request.');
  const { rows, failure } = await softRead(deps, 'sc_task', `sys_id=${sysId}`, ['sys_id', 'request_item'], { limit: 1, displayValue: false });
  const found = rows.find((r) => sameId(raw(r.sys_id), sysId));
  const itemId = found ? raw(found.request_item) : '';
  if (SYS_ID_RE.test(itemId)) return { table: 'sc_req_item', sysId: itemId.toLowerCase(), note: '' };
  const why = failure ? failure.note : 'This task has no requested item you can see.';
  return { table: 'sc_task', sysId: sysId.toLowerCase(), note: `${why} Showing the task on its own.` };
}

/** The operations, with the page bridge swappable (tests pass a fake). */
export function makeChecksOps({ callPage = tryCallPage } = {}) {
  return {
    resolutionFacts: (args, ctx) => resolutionFacts(args || {}, ctx, callPage),
    requestTarget: (args, ctx) => requestTarget(args || {}, ctx),
  };
}

export default makeChecksOps();
