// The form fields the Write section may read from or put text into. One list, used by the READ operation that reads the
// form (src/content/ops/compose.js), by the Rewrite view and by the safe-to-send check, so they cannot drift apart.
//
// `name` is the column name, `fieldLabel` is how a Workspace control is named (its aria-label, which is how the page
// bridge finds it when there is no g_form), `customerVisible` says whether the person who raised the ticket can read it.

export const FORM_FIELDS = Object.freeze([
  Object.freeze({ name: 'comments', label: 'Customer comment', fieldLabel: 'Additional comments', customerVisible: true }),
  Object.freeze({ name: 'work_notes', label: 'Work note', fieldLabel: 'Work notes', customerVisible: false }),
  Object.freeze({ name: 'close_notes', label: 'Resolution notes', fieldLabel: 'Resolution notes', customerVisible: true }),
  Object.freeze({ name: 'description', label: 'Description', fieldLabel: 'Description', customerVisible: true }),
  Object.freeze({ name: 'short_description', label: 'Short description', fieldLabel: 'Short description', customerVisible: true }),
]);

/** The only names the form-reading operation will ask the page for. */
export const FORM_FIELD_NAMES = Object.freeze(FORM_FIELDS.map((f) => f.name));

/** Longest text read from the form or sent for a rewrite (the page bridge and FILL_FIELD use the same limit). */
export const MAX_FORM_TEXT = 20000;

export const formFieldByName = (name) => FORM_FIELDS.find((f) => f.name === name) || null;

/** Can the person who raised the ticket read this field? Unknown fields count as visible (the safe side). */
export const isCustomerVisible = (name) => formFieldByName(name)?.customerVisible !== false;
