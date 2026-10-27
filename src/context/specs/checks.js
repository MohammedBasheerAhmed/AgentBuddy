// Context specs for the record checks area (see docs/contracts.md, "Context specs"): the request explainer (A9), the
// resolution check (C2) and the fulfilment checklist (G6). One spec per thing a view or an AI feature reads.
//
//   request-status        the "Request" tab (local only, nothing is sent): the item, its answers, approvals and tasks
//   request-explain       the plain-words status message (AI): the same, WITHOUT the answers to the request questions
//   resolution-check      the "Check" tab (local only): saved notes, code, hold reason, who wrote what, open child work
//   resolution-improve    "Improve my resolution notes" (AI): what 'resolution-notes' reads, plus the people columns
//   fulfilment-checklist  the "Checklist" tab and its AI proposal: the written instructions and the answers
//
// The three AI specs read the PERSON columns (who it is for, who opened it, who it is assigned to) even where the parts that
// go out leave those fields off (see src/checks/*Parts.js). The firewall masks exactly the people the pack knows: without
// them a name written inside a title, a comment or an answer would go out unmasked.

const WHO = ['caller_id', 'requested_for', 'contact', 'consumer'];
const PEOPLE = [...WHO, 'opened_by', 'assigned_to'];

export default {
  spec: {
    'request-status': {
      common: ['number', 'short_description', 'state', 'hold_reason', 'assignment_group', 'assigned_to', 'requested_for', 'opened_at', 'due_date', 'closed_at'],
      by: {
        request: ['request_state', 'stage', 'approval'],
        requested_item: ['stage', 'approval', 'cat_item', 'request'],
        catalog_task: ['request_item'],
      },
    },
    // The customer-facing message needs the state and the due date. It does not need the answers or the team names; the
    // people are read only so they can be masked, and the parts leave the assignee and opener out.
    'request-explain': {
      common: ['number', 'short_description', 'state', 'hold_reason', 'due_date', ...PEOPLE],
      by: {
        request: ['request_state', 'stage', 'approval'],
        requested_item: ['stage', 'approval', 'cat_item'],
      },
    },
    // Who the customer is (WHO) lets the check tell the customer's messages from the agents'. The code columns are the
    // ones the check looks at; nothing else of the ticket is read.
    'resolution-check': {
      common: ['number', 'state', 'hold_reason', 'close_code', 'close_notes', ...WHO],
      by: {
        problem: ['resolution_code'],
        case: ['resolution_code'],
      },
    },
    // The same fields 'resolution-notes' reads (so nothing new about the ticket is read) plus the people, so a name inside the
    // typed notes or the description is masked. No related lists: this feature's parts do not use them.
    'resolution-improve': {
      common: [
        'number', 'short_description', 'description', 'state', 'category', 'subcategory', 'cmdb_ci', 'business_service', 'opened_at',
        'resolved_at', 'close_code', 'close_notes', 'hold_reason', ...PEOPLE,
      ],
      by: {
        problem: ['known_error', 'cause_notes', 'workaround', 'fix_notes', 'resolution_code'],
        change: ['type', 'risk'],
        requested_item: ['cat_item', 'stage'],
        catalog_task: ['request_item'],
        case: ['product', 'account', 'resolution_code'],
      },
    },
    'fulfilment-checklist': {
      // The people: the instructions and answers often name the requester or a colleague; knowing who they are lets the
      // firewall mask them. The parts leave the assignee and the opener off.
      common: ['number', 'short_description', 'description', 'state', 'special_instructions', ...PEOPLE],
      by: {
        requested_item: ['cat_item', 'stage', 'due_date'],
        catalog_task: ['request_item', 'due_date'],
      },
    },
  },
  // Notes and comments (the journal) are read only where the feature needs the conversation.
  journal: {
    'request-status': false,
    'request-explain': true, // the latest customer-visible comments, so the message does not contradict what was said
    'resolution-check': true, // who wrote last, and whether the customer answered
    'resolution-improve': true, // the facts the notes are rewritten from
    'fulfilment-checklist': false,
  },
  related: {
    'request-status': ['variables', 'approvals', 'catalogTasks', 'items', 'slas'],
    'request-explain': ['approvals', 'catalogTasks', 'items', 'slas'],
    'resolution-check': ['childTasks', 'catalogTasks', 'items'],
    'resolution-improve': [],
    'fulfilment-checklist': ['variables'],
  },
  fieldsByKind: {},
  // Extra columns on kinds that already exist. Each one has a reason; a column a table does not have is simply not
  // returned by the Table API, so asking for it is harmless.
  //   special_instructions  the written steps of a catalog task / requested item (the checklist reads them)
  //   hold_reason           "on hold: <reason>" in the request status line, and "hold reason still set" in the check
  extendFields: {
    requested_item: ['special_instructions', 'hold_reason'],
    catalog_task: ['special_instructions', 'hold_reason'],
    request: ['hold_reason'],
    case: ['hold_reason'],
  },
};
