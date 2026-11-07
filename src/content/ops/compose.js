// READ operations for the Write section (see src/content/ops/index.js).
//
//   formValues { names: ['comments', ...], expect? }  ->  { available: boolean, values: { comments: 'text typed in the form', ... },
//                                                          wrongForm?: true }
//   notesHints { table, text, names }                 ->  suggestions for caller, category and assignment group (src/compose/notesHints.js)
//
// formValues reads what the person has typed into a few text fields of the open form (it may not be saved yet), so Rewrite can start
// from it and "Check my comment" can check it. No network call: the page bridge answers from the form's own state. Only the five
// names in src/compose/formFields.js can be asked for; anything else is refused before the page is contacted. The page's answer is
// treated as untrusted data: only those names, only strings, each cut to the longest length the tools handle. `available: false`
// means there is no readable form (a Workspace or portal page has no g_form to ask), which the panel shows as "paste the text
// instead". On a Workspace page (no g_form) the boxes are read when the record is named in `expect` and the page's address is that record
// (audit of 2026-11-07, S16): each box is found the way an insert finds it (page bridge getBoxValues: by its exact label, visible, never one
// of two look-alikes; nothing is focused, typed or fired), and a box that is not found is "not available", never an empty text. With `expect: { table, sysId }` the form must be that record first (the bridge answers for whatever form is open now; a
// form opened through task.do says 'task', and counts when the content script finds that record on the page: src/content/formRecord.js);
// another one answers `wrongForm: true` and nothing is read.
//
// notesHints is GET-only through the guarded deps (the person's session, the organisation's blocked tables).
import { tryCallPage } from '../pageBridge.js';
import { formShowsRecord } from '../formRecord.js';
import { FORM_FIELD_NAMES, MAX_FORM_TEXT, formFieldByName } from '../../compose/formFields.js';
import { HINT_TABLES, readNotesHints } from '../../compose/notesHints.js';
import { SYS_ID_RE, TABLE_RE, sameId } from '../../context/util.js';

const MAX_NAMES = 20;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// A Workspace page: the text typed in the boxes of `names`, for the record `expect` names, or { available: false } (with wrongForm when the
// address is another record). Only the names asked for, only text, each cut to length; a box the page could not show is left out, and when
// none of them was found nothing is available.
async function readBoxes(names, expect, call, currentRecord) {
  if (typeof currentRecord !== 'function') return { available: false, values: {} };
  let open;
  try {
    open = await currentRecord();
  } catch {
    open = null;
  }
  if (!isPlainObject(open)) return { available: false, values: {} };
  if (open.table !== expect.table || !sameId(open.sysId, expect.sysId)) return { available: false, values: {}, wrongForm: true };
  let answer;
  try {
    answer = await call('getBoxValues', [names, names.map((name) => formFieldByName(name)?.fieldLabel || '')]);
  } catch {
    answer = null;
  }
  if (!isPlainObject(answer)) return { available: false, values: {} };
  const values = {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(answer, name) && typeof answer[name] === 'string') values[name] = answer[name].slice(0, MAX_FORM_TEXT);
  }
  return Object.keys(values).length ? { available: true, values } : { available: false, values: {} };
}
/**
 * The operation itself; `call` is the page-bridge caller (replaced in tests), `currentRecord` the record the content script finds on
 * the page (src/content/reads.js), which settles a form of `task`.
 */
export async function readFormValues(args, call = tryCallPage, { currentRecord = null } = {}) {
  const asked = args && Array.isArray(args.names) ? args.names : null;
  if (!asked || !asked.length || asked.length > MAX_NAMES) throw new Error('Say which form fields to read.');
  const names = [...new Set(asked)];
  for (const name of names) {
    if (typeof name !== 'string' || !FORM_FIELD_NAMES.includes(name)) throw new Error('That field cannot be read.');
  }
  const expect = args.expect;
  if (expect !== undefined && expect !== null) {
    if (typeof expect !== 'object' || !TABLE_RE.test(String(expect.table || '')) || !SYS_ID_RE.test(String(expect.sysId || ''))) throw new Error('That is not a valid record.');
    let meta;
    try {
      meta = await call('getFormMeta');
    } catch {
      meta = null;
    }
    // No classic form at all (a Workspace or portal page): the Workspace's boxes when the page is this record, else "not available" the
    // same way as without `expect`.
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return readBoxes(names, expect, call, currentRecord);
    if (!(await formShowsRecord(meta, { table: expect.table, sysId: expect.sysId }, currentRecord))) return { available: false, values: {}, wrongForm: true };
  }
  const answer = await call('getFormValues', [names]);
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { available: false, values: {} };
  const values = {};
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(answer, name)) continue;
    const value = answer[name];
    if (typeof value === 'string') values[name] = value.slice(0, MAX_FORM_TEXT);
  }
  return { available: true, values };
}

/** Checked arguments for notesHints: a known table, a short text, up to ten names of plain text. */
export function notesHintsArgs(args) {
  // (Object.hasOwn: a table named after something every object has, such as 'constructor', is not a known table)
  const table = typeof args?.table === 'string' && Object.hasOwn(HINT_TABLES, args.table) ? args.table : '';
  const text = typeof args?.text === 'string' ? args.text.slice(0, 300) : '';
  if (!text.trim()) throw new Error('There is no short description to compare yet.');
  const names = Array.isArray(args?.names) ? args.names.filter((n) => typeof n === 'string').slice(0, 10).map((n) => n.slice(0, 60)) : [];
  return { table, text, names };
}

export default {
  formValues: (args, ctx) => readFormValues(args, tryCallPage, { currentRecord: ctx?.currentRecord }),
  notesHints: (args, { deps }) => readNotesHints(notesHintsArgs(args), deps),
};
