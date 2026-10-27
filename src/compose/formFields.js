// The form fields the Write section may read from or put text into. One list, used by the READ operation that reads the
// form (src/content/ops/compose.js), by the Rewrite view and by the safe-to-send check, so they cannot drift apart.
//
// `name` is the column name, `fieldLabel` is how a Workspace control is named (its aria-label, which is how the page
// bridge finds it when there is no g_form), `customerVisible` and `singleLine` come from FILLABLE_FIELDS (src/lib/fillable.js):
// whether the person who raised the ticket can read the field, and whether it holds one line only.

import { FILLABLE_FIELDS, isCustomerVisible as fieldIsCustomerVisible } from '../lib/fillable.js';

const field = (name, label, fieldLabel) =>
  Object.freeze({ name, label, fieldLabel, customerVisible: FILLABLE_FIELDS[name].customerVisible === true, singleLine: FILLABLE_FIELDS[name].singleLine === true });

export const FORM_FIELDS = Object.freeze([
  field('comments', 'Customer comment', 'Additional comments'),
  field('work_notes', 'Work note', 'Work notes'),
  field('close_notes', 'Resolution notes', 'Resolution notes'),
  field('description', 'Description', 'Description'),
  field('short_description', 'Short description', 'Short description'),
]);

/** The only names the form-reading operation will ask the page for. */
export const FORM_FIELD_NAMES = Object.freeze(FORM_FIELDS.map((f) => f.name));

/** Longest text read from the form or sent for a rewrite (the page bridge and FILL_FIELD use the same limit). */
export const MAX_FORM_TEXT = 20000;

export const formFieldByName = (name) => FORM_FIELDS.find((f) => f.name === name) || null;

/** Can the person who raised the ticket read this field? Unknown fields count as visible (the safe side). */
export const isCustomerVisible = (name) => fieldIsCustomerVisible(name);
