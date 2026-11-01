// Where a snippet can go: the form fields the Insert mechanics allow (FILLABLE_FIELDS in src/lib/fillable.js, owned by the Actions
// agent; read-only here) that make sense for canned text on the page that is open. Pure.
//
// A snippet is text to add, so every target here is a multi-line field and the snippet is added below what is there (append); the
// one-line fields (a title, a choice) and the article body (HTML, and an article is not answered with canned replies) are left out.

import { FILLABLE_FIELDS, emailClientTarget, isCustomerVisible, isSingleLineField } from '../lib/fillable.js';

// label: what the panel calls it; fieldLabel: how a Workspace or portal page names the box (the page bridge's fallback).
const TARGETS = Object.freeze({
  comments: { label: 'Customer comment', fieldLabel: 'Additional comments' },
  work_notes: { label: 'Work note', fieldLabel: 'Work notes' },
  close_notes: { label: 'Resolution notes', fieldLabel: 'Resolution notes' },
  description: { label: 'Description', fieldLabel: 'Description' },
  cause_notes: { label: 'Cause notes', fieldLabel: 'Cause notes' },
  workaround: { label: 'Workaround', fieldLabel: 'Workaround' },
  body: { label: 'Email body', fieldLabel: 'Body' },
});

// Which fields each kind of record has. A kind not listed gets the journal fields only.
const BY_KIND = {
  incident: ['comments', 'work_notes', 'close_notes', 'description'],
  case: ['comments', 'work_notes', 'close_notes', 'description'],
  problem: ['work_notes', 'comments', 'description', 'cause_notes', 'workaround', 'close_notes'],
  change: ['work_notes', 'comments', 'description', 'close_notes'],
  requested_item: ['comments', 'work_notes', 'close_notes'],
  catalog_task: ['work_notes', 'comments', 'close_notes', 'description'],
  hr_case: ['comments', 'work_notes', 'close_notes'],
};
const JOURNAL = ['comments', 'work_notes'];

const target = (field) => ({
  field,
  label: TARGETS[field].label,
  fieldLabel: TARGETS[field].fieldLabel,
  customerVisible: isCustomerVisible(field),
  mode: 'append',
});

/**
 * The fields a snippet can be inserted into on this page, the most used first ("Customer comment" on most tickets).
 * @param {{ href?: string, record?: { kind?: string } | null, newRecord?: { kind?: string } | null }} page
 * @returns {{ field: string, label: string, fieldLabel: string, customerVisible: boolean, mode: 'append' }[]}
 */
export function snippetTargets(page) {
  if (emailClientTarget(page?.href || '')) return [target('body')];
  const kind = page?.record?.kind || page?.newRecord?.kind || '';
  const fields = BY_KIND[kind] || JOURNAL;
  // Only what FILL_FIELD may write, and never a one-line field (checked here too, so a change in fillable.js cannot slip one in).
  return fields.filter((f) => Object.prototype.hasOwnProperty.call(FILLABLE_FIELDS, f) && !isSingleLineField(f) && TARGETS[f]).map(target);
}

/** One target by field name, among those offered for the page; null when that field is not offered here. */
export const snippetTargetFor = (page, field) => snippetTargets(page).find((t) => t.field === field) || null;
