// Context specs for the Write section (see docs/contracts.md, "Context specs").
//
// 'email-compose'  what the six email drafts, and the email suggestions, may read. The columns are the ones the rules and the
//                  prompts use: what the ticket is about, its state and hold reason, the resolution, the dates the data states
//                  (due date, change window), who it is for (to greet them, and to tell the customer's comments from the
//                  agent's), and the notes and comments (10 are used). SLAs and approvals come as extras. The assignee and the
//                  person who opened it are read for their names only (see OTHERS). Nothing about priority or categories:
//                  an email to the customer has no use for them.
// 'compose-people' only the people on a record, so a rewrite or notes run can mask their names precisely. No notes, no extras.
// 'snippet-fill'   what the Snippets panel fills a snippet's {{variables}} from (no AI is involved).
// 'send-check'     what "Check my comment" reads about the open record: its people and its notes (no AI is involved).
// Notes to ticket's suggestions (src/compose/notesHints.js) read look-alike tickets' title, category and group, and active users by
// exact name, directly through the guarded deps: HINT_TICKET_FIELDS stay inside the incident and case ceilings (tested).

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
    // What a snippet's built-in variables are filled from (src/snippets/render.js buildVariables): the number, title, state and
    // priority, the person it is for and the assignee, and the SLAs for {{sla.due}}. Nothing is sent to an AI: the values go
    // into the snippet the agent inserts. No notes, no description. (The panel used to read the 'reply-draft' spec, which has
    // no priority, so {{priority}} could never be filled, and which read ten notes no snippet uses.)
    'snippet-fill': {
      common: ['number', 'short_description', 'state', 'priority', 'assigned_to', ...WHO],
      by: {
        hr_case: ['opened_for', 'subject_person'],
      },
    },
    // "Check my comment" (N22, no AI): the people on the record, so their own email addresses are not flagged and a name that is not
    // theirs is, and the notes, so words copied from an internal work note are found (src/safeSend/review.js). Nothing is sent
    // anywhere: the check runs in the panel and keeps nothing.
    'send-check': {
      common: ['number', 'assigned_to', 'opened_by', ...WHO],
      by: {
        hr_case: ['opened_for', 'subject_person'],
      },
    },
  },
  journal: { 'email-compose': true, 'compose-people': false, 'snippet-fill': false, 'send-check': true },
  related: { 'email-compose': ['slas', 'approvals'], 'compose-people': [], 'snippet-fill': ['slas'], 'send-check': [] },
  // The email suggestion compares when the ticket was opened and resolved with when the last note was written (stored UTC)
  // and with the clock; the display values are in the reader's time zone, hours off. Their stored values ride along.
  times: { 'email-compose': ['opened_at', 'resolved_at', 'closed_at'] },
  fieldsByKind: {},
  extendFields: {},
};
