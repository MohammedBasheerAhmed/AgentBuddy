// Context specs for the Write section (see docs/contracts.md, "Context specs").
//
// 'email-compose'  what the six email drafts, and the email suggestions, may read. The columns are the ones the rules and the
//                  prompts use: what the ticket is about, its state and hold reason, the resolution, the dates the data states
//                  (due date, change window), who it is for (to greet them, and to tell the customer's comments from the
//                  agent's), and the notes and comments (10 are used). SLAs and approvals come as extras. The assignee and the
//                  person who opened it are read for their names only (see OTHERS). Nothing about priority or categories:
//                  an email to the customer has no use for them.
// 'compose-people' only the people on a record, so a rewrite or notes run can mask their names precisely. No notes, no extras.

const WHO = ['caller_id', 'requested_for', 'contact', 'consumer'];
// Read only so the firewall knows these people by name (a name can appear inside a description or a comment). The draft's parts
// leave these columns out (src/features/packs/compose.js, PEOPLE_COLUMNS).
const OTHERS = ['assigned_to', 'opened_by'];

export default {
  spec: {
    'email-compose': {
      common: [
        'number', 'short_description', 'description', 'state', 'hold_reason', 'opened_at', 'resolved_at', 'closed_at',
        'close_code', 'close_notes', 'approval', 'due_date', ...WHO, ...OTHERS,
      ],
      by: {
        problem: ['known_error', 'workaround', 'resolution_code'],
        change: ['type', 'start_date', 'end_date', 'requested_by'],
        request: ['request_state', 'stage'],
        requested_item: ['cat_item', 'stage'],
        catalog_task: ['request_item'],
        case: ['product', 'resolution_code'],
        hr_case: ['hr_service', 'opened_for', 'subject_person'],
      },
    },
    'compose-people': {
      common: ['number', 'assigned_to', 'opened_by', 'requested_by', ...WHO],
      by: {
        hr_case: ['opened_for', 'subject_person'],
      },
    },
  },
  journal: { 'email-compose': true, 'compose-people': false },
  related: { 'email-compose': ['slas', 'approvals'], 'compose-people': [] },
  fieldsByKind: {},
  extendFields: {},
};
