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
// instead". With `expect: { table, sysId }` the form must be that record first (the bridge answers for whatever form is open now);
// another one answers `wrongForm: true` and nothing is read.
//
// notesHints is GET-only through the guarded deps (the person's session, the organisation's blocked tables).
import { tryCallPage } from '../pageBridge.js';
import { FORM_FIELD_NAMES, MAX_FORM_TEXT } from '../../compose/formFields.js';
import { readNotesHints } from '../../compose/notesHints.js';

const MAX_NAMES = 20;
const SYS_ID = /^[0-9a-f]{32}$/i;
const TABLE = /^[a-z][a-z0-9_]{0,79}$/;

const sameRecord = (meta, expect) =>
  Boolean(meta) && typeof meta === 'object' && meta.table === expect.table && String(meta.sysId || '').toLowerCase() === expect.sysId.toLowerCase();

/** The operation itself; `call` is the page-bridge caller (replaced in tests). */
export async function readFormValues(args, call = tryCallPage) {
  const asked = args && Array.isArray(args.names) ? args.names : null;
  if (!asked || !asked.length || asked.length > MAX_NAMES) throw new Error('Say which form fields to read.');
  const names = [...new Set(asked)];
  for (const name of names) {
    if (typeof name !== 'string' || !FORM_FIELD_NAMES.includes(name)) throw new Error('That field cannot be read.');
  }
  const expect = args.expect;
  if (expect !== undefined && expect !== null) {
    if (typeof expect !== 'object' || !TABLE.test(String(expect.table || '')) || !SYS_ID.test(String(expect.sysId || ''))) throw new Error('That is not a valid record.');
    let meta = null;
    try {
      meta = await call('getFormMeta');
    } catch {
      meta = null;
    }
    // No classic form at all (a Workspace or portal page): say so the same way as without `expect`.
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { available: false, values: {} };
    if (!sameRecord(meta, expect)) return { available: false, values: {}, wrongForm: true };
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
  const table = typeof args?.table === 'string' ? args.table : '';
  const text = typeof args?.text === 'string' ? args.text.slice(0, 300) : '';
  if (!text.trim()) throw new Error('There is no short description to compare yet.');
  const names = Array.isArray(args?.names) ? args.names.filter((n) => typeof n === 'string').slice(0, 10).map((n) => n.slice(0, 60)) : [];
  return { table, text, names };
}

export default {
  formValues: (args) => readFormValues(args),
  notesHints: (args, { deps }) => readNotesHints(notesHintsArgs(args), deps),
};
