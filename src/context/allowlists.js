// The data-minimisation contract: which columns of a record are ever read, per kind of ticket and per feature.
// A column that is not listed here is never asked for (sysparm_fields) and, if an instance returns it anyway, never
// copied into a pack. Keep the lists short: add a field only when a feature gives a reason for it.
//
// FIELDS_BY_KIND is the ceiling for display. FEATURE_FIELDS[feature][kind] is what one feature may read and is always
// a subset of it (checked when this file loads and again in tests/context-allowlists.test.js).
// Tables in the HR family drop free text and identities unless the caller passes { allowSensitive: true }.

import { isSensitiveTable, kindForTable } from './kinds.js';

export const FEATURES = ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'missing-info', 'caller-history', 'similar', 'kb-recs'];

// ---- Limits ---------------------------------------------------------------------------------------

export const LIMITS = {
  shortDescription: 300,
  description: 4000,
  closeNotes: 2000,
  longNotes: 2000, // cause_notes, fix_notes, workaround, special_instructions
  field: 300, // any other text column
  journalEntry: 1500,
  journalEntries: 30, // the newest 30, shown oldest to newest
  variableQuestion: 200,
  variableValue: 500,
  variables: 40,
  relatedRows: 20,
  relatedText: 200,
  people: 30,
  historyRows: 10,
  historyCloseNotes: 400,
  similarCloseNotes: 600,
  kbExcerpt: 600,
};

const TEXT_LIMIT = {
  short_description: LIMITS.shortDescription,
  description: LIMITS.description,
  close_notes: LIMITS.closeNotes,
  cause_notes: LIMITS.longNotes,
  fix_notes: LIMITS.longNotes,
  workaround: LIMITS.longNotes,
  special_instructions: LIMITS.longNotes,
};

/** Maximum characters kept for a column. */
export function fieldLimit(name) {
  return TEXT_LIMIT[name] ?? LIMITS.field;
}

// ---- What may be read, per kind -------------------------------------------------------------------

const list = (...names) => Object.freeze(names);

export const FIELDS_BY_KIND = Object.freeze({
  incident: list(
    'number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'impact', 'urgency',
    'category', 'subcategory', 'assignment_group', 'assigned_to', 'caller_id', 'opened_by', 'cmdb_ci',
    'business_service', 'opened_at', 'sys_updated_on', 'resolved_at', 'close_code', 'close_notes', 'contact_type', 'parent'
  ),
  problem: list(
    'number', 'short_description', 'description', 'state', 'priority', 'impact', 'urgency', 'category', 'subcategory',
    'assignment_group', 'assigned_to', 'opened_by', 'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on',
    'resolved_at', 'known_error', 'cause_notes', 'workaround', 'fix_notes', 'resolution_code', 'close_notes'
  ),
  change: list(
    'number', 'short_description', 'description', 'state', 'priority', 'impact', 'type', 'risk', 'category',
    'assignment_group', 'assigned_to', 'requested_by', 'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on',
    'start_date', 'end_date', 'approval', 'conflict_status', 'close_code', 'close_notes'
  ),
  request: list(
    'number', 'short_description', 'description', 'state', 'request_state', 'stage', 'approval', 'priority',
    'requested_for', 'opened_by', 'opened_at', 'sys_updated_on', 'closed_at', 'due_date', 'special_instructions'
  ),
  requested_item: list(
    'number', 'short_description', 'description', 'state', 'stage', 'approval', 'priority', 'cat_item', 'request',
    'requested_for', 'opened_by', 'assignment_group', 'assigned_to', 'cmdb_ci', 'opened_at', 'sys_updated_on',
    'closed_at', 'due_date', 'quantity', 'close_notes'
  ),
  catalog_task: list(
    'number', 'short_description', 'description', 'state', 'priority', 'request_item', 'assignment_group',
    'assigned_to', 'opened_by', 'opened_at', 'sys_updated_on', 'closed_at', 'due_date', 'close_notes'
  ),
  case: list(
    'number', 'short_description', 'description', 'state', 'priority', 'category', 'subcategory', 'account', 'contact',
    'consumer', 'product', 'asset', 'entitlement', 'cmdb_ci', 'assignment_group', 'assigned_to', 'opened_by',
    'opened_at', 'sys_updated_on', 'resolved_at', 'resolution_code', 'close_notes', 'contact_type', 'parent'
  ),
  // The columns marked in HR_HIDDEN are only read with { allowSensitive: true }.
  hr_case: list(
    'number', 'state', 'priority', 'assignment_group', 'assigned_to', 'opened_at', 'sys_updated_on', 'resolved_at',
    'short_description', 'description', 'close_notes', 'hr_service', 'subject_person', 'opened_for', 'opened_by'
  ),
  task: list(
    'number', 'short_description', 'description', 'state', 'priority', 'assignment_group', 'assigned_to', 'opened_by',
    'opened_at', 'sys_updated_on', 'closed_at', 'close_notes', 'contact_type', 'parent'
  ),
  other: list(
    'number', 'short_description', 'description', 'state', 'priority', 'assignment_group', 'assigned_to', 'opened_by',
    'opened_at', 'sys_updated_on', 'closed_at', 'close_notes', 'parent'
  ),
});

// Free text, and the columns that say WHO a sensitive record is about. On an HR-family table these stay unread
// unless the caller allows sensitive data. (Non-HR tables are not affected.)
export const FREE_TEXT_FIELDS = Object.freeze(
  new Set(['short_description', 'description', 'close_notes', 'cause_notes', 'fix_notes', 'workaround', 'special_instructions', 'comments', 'work_notes'])
);
export const IDENTITY_FIELDS = Object.freeze(
  new Set(['caller_id', 'opened_by', 'requested_for', 'requested_by', 'contact', 'consumer', 'opened_for', 'subject_person', 'hr_service', 'account'])
);
export const HR_HIDDEN = Object.freeze(new Set([...FREE_TEXT_FIELDS, ...IDENTITY_FIELDS]));

// ---- What each feature may read -------------------------------------------------------------------
// `common` applies to every kind that has the column; `by` adds columns for one kind. The result is intersected with
// FIELDS_BY_KIND, so a feature can never reach past the display ceiling.

const WHO = ['caller_id', 'requested_for', 'contact', 'consumer'];

const FEATURE_SPEC = {
  'record-summary': {
    common: [
      'number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'category', 'assignment_group',
      'assigned_to', ...WHO, 'opened_by', 'cmdb_ci', 'opened_at', 'sys_updated_on', 'resolved_at', 'closed_at',
      'close_code', 'close_notes',
    ],
    by: {
      incident: ['impact', 'urgency', 'subcategory', 'business_service'],
      problem: ['impact', 'urgency', 'known_error', 'cause_notes', 'workaround', 'fix_notes'],
      change: ['type', 'risk', 'start_date', 'end_date', 'approval', 'conflict_status', 'requested_by'],
      request: ['request_state', 'stage', 'approval', 'due_date', 'special_instructions'],
      requested_item: ['stage', 'approval', 'cat_item', 'request', 'due_date'],
      catalog_task: ['request_item', 'due_date'],
      case: ['account', 'product', 'entitlement', 'subcategory'],
      hr_case: ['hr_service', 'subject_person', 'opened_for'],
      task: ['parent'],
      other: ['parent'],
    },
  },
  'reply-draft': {
    common: ['number', 'short_description', 'description', 'state', 'hold_reason', ...WHO, 'assigned_to', 'contact_type', 'close_notes'],
    by: {
      change: ['type', 'start_date', 'end_date', 'approval'],
      request: ['request_state', 'approval', 'due_date'],
      requested_item: ['cat_item', 'stage', 'approval', 'due_date'],
      catalog_task: ['request_item'],
      case: ['account', 'product'],
      hr_case: ['opened_for'],
    },
  },
  'resolution-notes': {
    common: [
      'number', 'short_description', 'description', 'state', 'category', 'subcategory', 'cmdb_ci', 'business_service',
      'assigned_to', 'opened_at', 'resolved_at', 'close_code', 'close_notes', 'hold_reason',
    ],
    by: {
      problem: ['known_error', 'cause_notes', 'workaround', 'fix_notes', 'resolution_code'],
      change: ['type', 'risk'],
      requested_item: ['cat_item', 'stage'],
      catalog_task: ['request_item'],
      case: ['product', 'account', 'resolution_code'],
    },
  },
  'handoff-brief': {
    common: [
      'number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'impact', 'urgency', 'category',
      'assignment_group', 'assigned_to', ...WHO, 'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on', 'parent',
    ],
    by: {
      problem: ['known_error', 'workaround', 'cause_notes'],
      change: ['type', 'risk', 'start_date', 'end_date', 'approval', 'conflict_status', 'requested_by'],
      request: ['request_state', 'stage', 'approval', 'due_date'],
      requested_item: ['cat_item', 'request', 'stage', 'approval', 'due_date'],
      catalog_task: ['request_item', 'due_date'],
      case: ['account', 'product', 'entitlement'],
      hr_case: ['hr_service', 'opened_for'],
    },
  },
  'missing-info': {
    common: [
      'number', 'short_description', 'description', 'category', 'subcategory', 'cmdb_ci', 'business_service', 'contact_type',
      'impact', 'urgency', 'priority', 'state', 'hold_reason', ...WHO,
    ],
    by: {
      change: ['type', 'risk', 'start_date', 'end_date'],
      requested_item: ['cat_item', 'request'],
      catalog_task: ['request_item'],
      case: ['product', 'account', 'entitlement'],
    },
  },
  'caller-history': {
    common: ['number', 'short_description', 'category', 'cmdb_ci', ...WHO],
    by: {
      requested_item: ['cat_item'],
      hr_case: ['opened_for'],
    },
  },
  similar: {
    common: ['number', 'short_description', 'state', 'category', 'subcategory', 'cmdb_ci', 'business_service'],
    by: {
      change: ['type'],
      requested_item: ['cat_item'],
      case: ['product'],
      hr_case: ['hr_service'],
    },
  },
  'kb-recs': {
    common: ['number', 'short_description', 'description', 'category', 'subcategory', 'cmdb_ci', 'business_service'],
    by: {
      requested_item: ['cat_item'],
      case: ['product'],
    },
  },
};

// Which features read notes and comments, and which extras (SLAs, approvals, ...) of a record they may include.
export const FEATURE_JOURNAL = Object.freeze({
  'record-summary': true,
  'reply-draft': true,
  'resolution-notes': true,
  'handoff-brief': true,
  'missing-info': true,
  'caller-history': false,
  similar: false,
  'kb-recs': false,
});

export const FEATURE_RELATED = Object.freeze({
  'record-summary': ['slas', 'approvals', 'childTasks', 'variables', 'items', 'catalogTasks', 'changeTasks'],
  'reply-draft': ['slas', 'approvals', 'variables'],
  'resolution-notes': ['variables', 'childTasks', 'catalogTasks', 'changeTasks'],
  'handoff-brief': ['slas', 'approvals', 'childTasks', 'variables', 'items', 'catalogTasks', 'changeTasks'],
  'missing-info': ['variables'],
  'caller-history': [],
  similar: [],
  'kb-recs': [],
});

function buildFeatureFields() {
  const out = {};
  for (const feature of FEATURES) {
    const { common, by } = FEATURE_SPEC[feature];
    out[feature] = {};
    for (const kind of Object.keys(FIELDS_BY_KIND)) {
      const ceiling = FIELDS_BY_KIND[kind];
      const wanted = new Set([...common, ...(by[kind] || [])]);
      // Ceiling order, so the list reads the same everywhere and nothing outside the ceiling can slip in.
      out[feature][kind] = Object.freeze(ceiling.filter((name) => wanted.has(name)));
    }
    Object.freeze(out[feature]);
  }
  return Object.freeze(out);
}

/** FEATURE_FIELDS[feature][kind] -> the columns that feature may read for that kind. */
export const FEATURE_FIELDS = buildFeatureFields();

/** The columns to read for `table` and `feature`. Throws for a feature that is not on the list (fail closed). */
export function allowedFields(table, feature, { allowSensitive = false } = {}) {
  const forFeature = FEATURE_FIELDS[feature];
  if (!forFeature) throw new Error(`Unknown feature "${feature}". Known: ${FEATURES.join(', ')}.`);
  const fields = forFeature[kindForTable(table)] || forFeature.other;
  return isSensitiveTable(table) && !allowSensitive ? fields.filter((name) => !HR_HIDDEN.has(name)) : [...fields];
}

/** Columns that stayed unread because the table is sensitive and the caller did not allow it. */
export function withheldFields(table, feature, options = {}) {
  if (!isSensitiveTable(table) || options.allowSensitive) return [];
  const all = allowedFields(table, feature, { allowSensitive: true });
  const kept = new Set(allowedFields(table, feature, options));
  return all.filter((name) => !kept.has(name));
}
