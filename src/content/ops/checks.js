// READ operations for the record checks area (see src/content/ops/index.js):
//
//   resolutionFacts  what the form holds right now for a few fields (unsaved), and whether the ticket is linked to a problem
//                    or a knowledge article. Powers the "Check" tab.
//   requestTarget    which record the "Request" and "Checklist" tabs read the request chain from: a catalog task points at
//                    its requested item; a requested item or a request is its own target.
//
// Both are GET-only (the context deps) plus the page bridge's read of form values. Arguments are validated; whatever the page
// world answers is treated as untrusted data and cut down to the fixed list below.
import { STATUS, confirmEmptyIsReallyEmpty, softRead } from '../../context/access.js';
import { SYS_ID_RE, raw } from '../../context/util.js';
import { tryCallPage } from '../pageBridge.js';

/** The only form fields ever read. */
export const FORM_FIELDS = Object.freeze(['close_notes', 'close_code', 'resolution_code', 'state', 'hold_reason', 'comments', 'work_notes']);
const MAX_FORM_TEXT = 20000;

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * The unsaved values of FORM_FIELDS, or null when the page has no form we can read (a portal, a Workspace) or the form on the
 * page is not this record. Values that are not text, and fields that were not asked for, are dropped.
 */
export async function readFormValues({ table, sysId }, callPage = tryCallPage) {
  let meta = null;
  try {
    meta = await callPage('getFormMeta');
  } catch {
    meta = null;
  }
  // The bridge answers for whatever form is open now: make sure it is the record the panel is showing.
  if (!meta || typeof meta !== 'object' || meta.table !== table || !sameId(meta.sysId, sysId)) return null;
  let values = null;
  try {
    values = await callPage('getFormValues', [[...FORM_FIELDS]]);
  } catch {
    values = null;
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const out = {};
  for (const name of FORM_FIELDS) {
    const value = values[name];
    if (typeof value === 'string') out[name] = value.slice(0, MAX_FORM_TEXT);
  }
  return out;
}

// ---- links ---------------------------------------------------------------------------------------------------------

const link = (status, note = '') => ({ status, note });

// A linked problem: only an incident has `problem_id`. 'yes' | 'no' | 'unknown' | 'na'.
async function problemLink({ table, sysId }, deps) {
  if (table !== 'incident') return link('na');
  const { rows, failure } = await softRead(deps, 'incident', `sys_id=${sysId}`, ['sys_id', 'problem_id'], { limit: 1, displayValue: false });
  if (failure) return link('unknown', failure.status === STATUS.DENIED ? 'You cannot read the problem link on this incident.' : 'The problem link could not be read.');
  const row = rows.find((r) => sameId(raw(r.sys_id), sysId));
  if (!row) return link('unknown', 'The incident could not be read again to check its problem link.');
  return SYS_ID_RE.test(raw(row.problem_id)) ? link('yes') : link('no');
}

// The places a ticket can be tied to an article. Every row is checked against the record again: ServiceNow ignores a condition
// on a column the table does not have and then returns every row, which must never pass for "linked".
const KB_SOURCES = [
  { table: 'm2m_kb_task', query: (id) => `task=${id}`, fields: ['task', 'kb_knowledge'], column: 'task' },
  { table: 'kb_use', query: (id) => `task_id=${id}`, fields: ['task_id', 'article'], column: 'task_id' },
];

async function knowledgeLink({ sysId }, deps) {
  const memo = new Map();
  const unsure = [];
  let sawTable = false;
  for (const source of KB_SOURCES) {
    // eslint-disable-next-line no-await-in-loop -- two small reads, kept in order.
    const { rows, failure } = await softRead(deps, source.table, source.query(sysId), source.fields, { limit: 5, displayValue: false });
    if (failure) {
      unsure.push(failure.status === STATUS.DENIED ? `You cannot read ${source.table}.` : failure.note);
      continue;
    }
    if (rows.length) {
      if (rows.some((r) => !sameId(raw(r[source.column]), sysId))) {
        unsure.push(`${source.table} did not apply the filter on this ticket, so it was not used.`);
        continue;
      }
      return link('yes');
    }
    // Nothing found: only a fact when the user can see rows of the table at all.
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

/** { form, links } for the Check tab. */
async function resolutionFacts(args, { deps, checkRecord }, callPage) {
  checkRecord(args);
  const record = { table: args.table, sysId: args.sysId.toLowerCase() };
  const [form, problem, knowledge] = await Promise.all([
    settle(readFormValues(record, callPage), null),
    settle(problemLink(record, deps), link('unknown', 'The problem link could not be checked.')),
    settle(knowledgeLink(record, deps), link('unknown', 'The article link could not be checked.')),
  ]);
  return { form, links: { problem, knowledge } };
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
