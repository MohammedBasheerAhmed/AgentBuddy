// Context specs for the ITSM record features (see docs/contracts.md, "Context specs"): what each feature may READ.
// Each list is intersected with the kind's ceiling (src/context/allowlists.js), so a column the kind does not have is
// simply not read. Every feature includes `number`. None of these features lists hr_case: HR records are handled by the
// domain pack, in strict mode.

// Every feature reads the columns that name people (the person the work is for, who opened it, who owns it), even when it
// does not show them to the model. People who are not on the pack are not known to the firewall, and a name written in the
// short description or a note ("VPN fails for Abel Tuter") is only masked exactly when the pack lists that person. The
// features that do not need the names leave these columns out of their parts (src/features/packs/itsm.js).
const PEOPLE = ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'requested_by', 'assigned_to'];

export default {
  spec: {
    // A5. Who the customer is (caller_id and the like) and who answers (assigned_to) tell the customer's lines from support's.
    // Counts that feed the signals: reopen_count and reassignment_count (extendFields below).
    'sentiment-risk': {
      common: ['number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'impact', 'urgency', ...PEOPLE, 'opened_at', 'sys_updated_on'],
      by: { incident: ['reopen_count', 'reassignment_count'] },
    },
    // A7. The searches for look-alike tickets and articles use the short description, the description, the CI, the category
    // and the catalog item or product, so those are read. The people are read only to be masked, not shown.
    'next-best-action': {
      common: ['number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'category', 'subcategory', 'cmdb_ci', 'business_service', ...PEOPLE],
      by: { requested_item: ['cat_item'], case: ['product'] },
    },
    // A8. Owners of the work (assignee, group) and the person it is for, so "who owns what" can be answered.
    'thread-summary': {
      common: ['number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'assignment_group', ...PEOPLE, 'opened_at', 'sys_updated_on'],
      by: {},
    },
    // E1. What routing looks at: the wording, the classification now, the impact and urgency. People are read only to be masked.
    'routing-hint': {
      common: [
        'number', 'short_description', 'description', 'state', 'priority', 'impact', 'urgency', 'category', 'subcategory',
        'assignment_group', 'cmdb_ci', 'business_service', 'contact_type', ...PEOPLE,
      ],
      by: { requested_item: ['cat_item'], case: ['product'] },
    },
    // C3. The article is published for others, so no people and no ticket number reach the prompt (the feature leaves the
    // number and the people out of its parts; the people are read only so their names are masked wherever the text mentions
    // them). The resolution and the cause are what an article is made of.
    'kb-article-draft': {
      common: ['number', 'short_description', 'description', 'state', 'category', 'subcategory', 'business_service', 'close_code', 'close_notes', 'resolved_at', ...PEOPLE],
      by: {
        problem: ['known_error', 'cause_notes', 'workaround', 'fix_notes', 'resolution_code'],
        case: ['product', 'resolution_code'],
        requested_item: ['cat_item'],
      },
    },
    // B7. Status, impact, who owns it and what is being tried; the extras (SLAs, approvals, tasks) come through `related`.
    // Callers are read only to be masked; the update does not show them.
    'major-incident-comms': {
      common: [
        'number', 'short_description', 'description', 'state', 'hold_reason', 'priority', 'impact', 'urgency', 'category', 'subcategory',
        'assignment_group', 'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on', 'resolved_at', 'close_code', 'close_notes', 'parent', ...PEOPLE,
      ],
      by: {
        problem: ['known_error', 'cause_notes', 'workaround', 'fix_notes'],
        change: ['type', 'risk', 'start_date', 'end_date', 'approval', 'conflict_status'],
      },
    },
  },

  // Which features read the notes and comments.
  journal: {
    'sentiment-risk': true,
    'next-best-action': true,
    'thread-summary': true,
    'routing-hint': false, // routing works from the wording and the classification; the notes add risk, not signal
    'kb-article-draft': true,
    'major-incident-comms': true,
  },

  // Extras of the record (src/context/related.js). Only keys that file already reads, named for the kinds that have them.
  related: {
    'sentiment-risk': ['slas'], // a breached SLA is part of the escalation picture
    'next-best-action': ['variables'], // what a requested item asked for
    'thread-summary': [],
    'routing-hint': [],
    'kb-article-draft': [],
    'major-incident-comms': ['slas', 'approvals', 'childTasks', 'changeTasks'],
  },

  fieldsByKind: {},

  // Incident columns the base list does not have. Additive; each is read only by the feature that names it above.
  //   reopen_count: how often the customer's problem came back (a known escalation predictor).
  //   reassignment_count: how often it was passed between groups (a known source of customer frustration).
  extendFields: { incident: ['reopen_count', 'reassignment_count'] },
};
