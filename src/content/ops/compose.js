// READ operations for the Write section (see src/content/ops/index.js).
//
//   formValues { names: ['comments', ...] }  ->  { available: boolean, values: { comments: 'text typed in the form', ... } }
//
// Reads what the person has typed into a few text fields of the open form (it may not be saved yet), so Rewrite can start from
// it. No network call: the page bridge answers from the form's own state. Only the five names in src/compose/formFields.js can be
// asked for; anything else is refused before the page is contacted. The page's answer is treated as untrusted data: only those
// names, only strings, each cut to the longest length the tools handle. `available: false` means there is no readable form
// (a Workspace or portal page has no g_form to ask), which the panel shows as "paste the text instead".
import { tryCallPage } from '../pageBridge.js';
import { FORM_FIELD_NAMES, MAX_FORM_TEXT } from '../../compose/formFields.js';

const MAX_NAMES = 20;

/** The operation itself; `call` is the page-bridge caller (replaced in tests). */
export async function readFormValues(args, call = tryCallPage) {
  const asked = args && Array.isArray(args.names) ? args.names : null;
  if (!asked || !asked.length || asked.length > MAX_NAMES) throw new Error('Say which form fields to read.');
  const names = [...new Set(asked)];
  for (const name of names) {
    if (typeof name !== 'string' || !FORM_FIELD_NAMES.includes(name)) throw new Error('That field cannot be read.');
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

export default {
  formValues: (args) => readFormValues(args),
};
