// Context specs for the Ticket screen's Insights cards (owner: Insights agent, docs/round3.md). See src/context/specs/index.js.
//
// 'insights-ticket' is read ONCE per record by the `glance` read (src/content/ops/insights.js) and shared, in panel memory only, by
// the ticket at a glance (N1), risk signals (N9), missing details (N11), which email fits (N20) and the ticket journey (N24). Nothing
// read with it is sent anywhere: the Insights half has no AI. The person columns are read like on every non-search spec (the names
// are shown to the agent, who can see them on the form anyway).

// (requested_by: the person who asked for a change is its "caller", F6)
const PEOPLE = ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'requested_by', 'assigned_to'];

export default {
  spec: {
    'insights-ticket': {
      common: [
        // N1: number, title, state, priority, owner, last update
        'number', 'short_description', 'state', 'priority', 'assignment_group', 'opened_at', 'sys_updated_on', ...PEOPLE,
        // N11: what the ticket says and what it is about (CI, service, category, impact, how it came in)
        'description', 'impact', 'urgency', 'category', 'subcategory', 'cmdb_ci', 'business_service', 'contact_type',
        // N20: which email fits looks at the hold reason, the approval, the dates and the close code
        'hold_reason', 'approval', 'due_date', 'resolved_at', 'closed_at', 'close_code',
        // N9 and N24: how often it came back and changed hands (added to the ceilings below where the base list lacks them)
        'reopen_count', 'reassignment_count',
      ],
      by: {
        request: ['request_state', 'stage'],
        requested_item: ['stage', 'cat_item'],
        // (what a catalog task is for: its requested item's, walked in the same read, src/context/specs/fit.js)
        catalog_task: ['request_item.cat_item'],
        // N28: the account, its entitlement, product and asset are part of the case at a glance
        case: ['account', 'product', 'asset', 'entitlement'],
        // (the change line of the Glance: type, risk, window and approval, F6, src/insights/changeLine.js; approval is read above for the emails)
        change: ['type', 'risk', 'start_date', 'end_date'],
        // F14: the workaround and the known-error mark of a problem, in "Steps that worked before". (The count of its linked incidents, "3 linked
        // incidents that you can see" in the glance, reads incident.problem_id and sys_id, two columns already on the incident ceiling
        // (specs/checks.js), in one limited read: readLinkedIncidentCount in src/content/ops/insights.js. Nothing of those incidents is kept.)
        problem: ['known_error', 'workaround'],
        // F15: what a task is a part of ("Part of CS0001234", with a link)
        task: ['parent'],
        other: ['parent'],
        hr_case: ['hr_service', 'opened_for', 'subject_person'],
      },
    },
  },
  // The notes: who wrote last and when (customer waiting, N1), the customer's wording (N9), the conversation steps (N24).
  journal: { 'insights-ticket': true },
  // Approvals: "an approval is waiting" decides the approval reminder email (N20).
  related: { 'insights-ticket': ['approvals'] },
  // Stored UTC values of these dates: "updated 3 h ago" and the journey need the real instant, and the pair (stored, display) tells
  // the reader's offset for notes read in local time (src/insights/time.js).
  times: { 'insights-ticket': ['opened_at', 'sys_updated_on', 'resolved_at', 'closed_at'] },
  fieldsByKind: {},
  // reassignment_count is a task column (every ticket table has it); the incident ceiling has it already (specs/itsm.js). It is read
  // only by 'insights-ticket': the journey says "reassigned 3 times" for cases, problems, requests and tasks too.
  extendFields: {
    problem: ['reassignment_count'],
    requested_item: ['reassignment_count'],
    catalog_task: ['reassignment_count'],
    case: ['reassignment_count'],
    task: ['reassignment_count'],
  },
};
