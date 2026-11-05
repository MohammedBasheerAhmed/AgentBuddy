// Which ServiceNow columns a part of the outgoing request carries.
//
// A part is { label, field, text }. For a column of the record, `field` IS the column ('short_description', 'comments'). Many
// parts are DERIVED: `linked_incidents` is a list of other incidents, `sla` is a table of SLA rows, `reference_ticket` is another
// ticket's wording. Their `field` is a handle, not a column, and the columns inside them (short_description, close_notes, the
// assignee...) were invisible to the policy key `blockedFields`: "block short_description" did not stop the short descriptions of
// every linked incident from going out. This file lists, for every derived `field` used anywhere in src/, the columns it carries.
//
// The firewall (src/pii/firewall.js, checkParts) refuses a part when `blockedFields` holds its `field` OR any column listed
// here for it. tests/policy-hardening-partcolumns.test.js fails when a part field exists in src/ that is neither a column nor in
// this map, so a new derived part cannot be added without saying what it carries.
//
// Pure data. Lower-case names. A field that is not listed is treated as the column it names.

const TASK_ROW = ['number', 'short_description', 'state', 'assigned_to', 'assignment_group', 'active'];
const SLA_ROW = ['sla', 'stage', 'has_breached', 'percentage', 'business_percentage', 'planned_end_time'];
const CHANGE_ROW = ['number', 'short_description', 'state', 'type', 'risk', 'start_date', 'end_date', 'cmdb_ci', 'business_service'];
const APPROVAL_ROW = ['approver', 'group', 'state', 'sys_updated_on'];

export const DERIVED_PART_COLUMNS = Object.freeze({
  // ---- Notes: real columns of the record (listed so that every part field the code can produce is in this file) ----
  comments: ['comments'],
  work_notes: ['work_notes'],

  // ---- Related lists of the record (src/itsm/parts.js, src/domain/parts.js, src/checks/requestView.js) ----
  sla: SLA_ROW,
  slas: SLA_ROW,
  approvals: APPROVAL_ROW,
  child_tasks: [...TASK_ROW, 'sys_class_name'],
  change_tasks: [...TASK_ROW, 'change_task_type'],
  catalog_tasks: TASK_ROW,
  requested_items: ['number', 'short_description', 'state', 'stage', 'cat_item', 'approval', 'assigned_to', 'assignment_group', 'due_date'],
  // The answers to the request form: values the requester typed, each with its question.
  variables: ['variables', 'value', 'question_text', 'sc_item_option', 'sc_item_option_mtom'],
  // Other incidents linked to a problem (their wording and fixes), other changes, the account's other cases, the caller's other tickets.
  linked_incidents: ['number', 'short_description', 'state', 'opened_at', 'resolved_at', 'cmdb_ci', 'close_notes', 'problem_id'],
  schedule_conflicts: CHANGE_ROW,
  recent_changes: CHANGE_ROW,
  account_cases: ['number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'account'],
  // The caller's other tickets (src/domain/callerTickets.js): what they raised, its state, when, and the fix written down (resolved_at
  // or closed_at, close_code or resolution_code). The list is chosen by the caller's column on each table, named like `account` above
  // (no value of it is in the text: the caller is said by role).
  caller_tickets: [
    'number', 'short_description', 'state', 'opened_at', 'resolved_at', 'closed_at', 'close_code', 'resolution_code', 'close_notes',
    'caller_id', 'requested_for', 'contact', 'consumer', 'opened_for',
  ],
  // The Request tab's status message (checks): the item, its approvals and tasks.
  items: ['number', 'short_description', 'cat_item', 'state', 'assigned_to', 'due_date'],
  tasks: ['number', 'short_description', 'state', 'assigned_to', 'due_date'],

  // ---- Computed by Agent Buddy from the record ----
  // Counts and a sentence from the wording of the notes, the SLAs, the priority and the reopen / reassignment counts.
  signals: ['short_description', 'description', 'comments', 'work_notes', 'priority', 'state', 'reopen_count', 'reassignment_count', 'has_breached'],
  // "The ticket is on hold", "an approval was rejected", due date: worked out from these. The request's status line also names who has
  // it and the task or item it waits on ("Waiting on SCTASK0010002 (Order the laptop), with Beth Anglin": src/checks/requestStatus.js).
  status: [
    'state', 'request_state', 'stage', 'hold_reason', 'approval', 'due_date', 'opened_at', 'resolved_at', 'closed_at', ...SLA_ROW, ...APPROVAL_ROW,
    'number', 'short_description', 'cat_item', 'assigned_to', 'assignment_group',
  ],
  // Names the columns that have no value ("Back-out plan"): says nothing about their content.
  not_recorded: ['implementation_plan', 'backout_plan', 'test_plan', 'risk_impact_analysis', 'justification'],
  // Which reads could not be made: fixed wording, no record content.
  data_not_available: [],
  // How many look-alike tickets / articles were found, and the number of a strong match.
  reference_status: ['number'],

  // ---- Reference material: other tickets and articles (src/itsm/parts.js, src/features/packs/knowledge.js) ----
  reference_ticket: ['number', 'short_description', 'category', 'subcategory', 'cmdb_ci', 'assignment_group', 'priority', 'close_code', 'close_notes'],
  // The routing hint needs no resolution text from other tickets: group, priority and category only.
  reference_ticket_routing: ['number', 'short_description', 'category', 'subcategory', 'cmdb_ci', 'assignment_group', 'priority'],
  kb_article: ['number', 'short_description', 'text', 'kb_knowledge_base', 'author'],

  // ---- Knowledge tools: counts and topic words from many tickets (src/knowledge/parts.js) ----
  volume: [],

  // ---- Reports (src/reports/ai/*) ----
  // The builders of these packs leave out a column that `blockedFields` names (handover.js, insights.js, coaching.js), so the
  // part is not refused by the name of what it carries; blocking a column removes it from the text instead.
  coaching_scope: [],
  handover_figures: [],
  handover_tickets: [],
  insights_scope: [],
  insights_overview: [],
  insights_handover: [],
  insights_workload: [],
  insights_sla: [],
  insights_quality: [],
  insights_requests: [],
});

/** The lower-case names a part with this `field` (or, with none, this label) stands for: itself and every column it carries. */
export function columnsForPart(field) {
  const name = String(field ?? '').trim().toLowerCase();
  if (!name) return [];
  const carried = Object.prototype.hasOwnProperty.call(DERIVED_PART_COLUMNS, name) ? DERIVED_PART_COLUMNS[name] : [];
  return [...new Set([name, ...carried])];
}

/** Is this `field` a handle for something other than one column (so it needs an entry above)? */
export const isDerivedField = (field) => Object.prototype.hasOwnProperty.call(DERIVED_PART_COLUMNS, String(field ?? '').trim().toLowerCase());
