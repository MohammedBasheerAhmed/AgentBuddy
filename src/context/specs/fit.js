// Context spec of the "kind fit" pass (audit of 2026-11-07, root cause 6: "the panel is incident-first"). Same shape as the other
// files here (docs/contracts.md, 'Context specs'). Owned by the kind-fit workstream.
//
// A catalog task is one step of a requested item. Who it is for and what was ordered live on the ITEM, not on the task: the task's own
// columns name neither (F1, F2, F18). They are read by dot-walking from the task's own `request_item` column, in the SAME read as the
// task, exactly as My work already reads the customer of a catalog task (src/mywork/tables.js: `request_item.requested_for`). The
// policy guard checks each step of a dot-walk against the blocked tables (DOT_WALK_TABLES: `request_item` leads to sc_req_item).
//
//   request_item.requested_for  the requester, who becomes a person on the pack under the role `requested_for` (so the caller card, the
//                               greeting, the customer check and the masking of the name all work), and the pack's `requested_for` field
//   request_item.cat_item       what was ordered, as the pack's `cat_item` field (look-alikes, articles, the summary)
//   request_item                the link itself: the item whose answers the pack also carries (src/context/related.js `variables`)
//
// A feature that lists `requested_for` / `cat_item` for a catalog task gets the walked column under that name (allowlists.js
// buildFeatureFields); the walked requester is read for masking by every feature that sends text, like any person column.

/** Dot-walked column -> the name it has on the pack, by kind. */
export const PARENT_WALK = Object.freeze({
  catalog_task: Object.freeze({ 'request_item.requested_for': 'requested_for', 'request_item.cat_item': 'cat_item' }),
});

/** The column that points at the parent, by kind: its stored value is the parent's id. */
export const PARENT_LINK = Object.freeze({ catalog_task: 'request_item' });

/** The table the parent is in, by kind. */
export const PARENT_TABLE = Object.freeze({ catalog_task: 'sc_req_item' });

// ---- The person of a task comes from its PARENT (audit of 2026-11-07, F15) -----------------------------------------------------------
//
// A task that is part of an incident, a change or a case has no caller of its own: the opener (an agent, or a workflow) is not the person it is
// for, and until now the panel took the opener for the caller. The person is the parent's, by the class of the task. The parent is found by
// the task's own parent column (every task has it, and the panel already shows "Part of CS0001234"), and its table is read by that id: ONE
// small read of the parent, in the same pack read (src/context/related.js readParentPerson). A dot-walk through parent is not used: parent is
// a reference to the base class task, whose fields are the only ones a walk through it can reach, and the person columns below are the
// subclasses'. (The catalog task, whose request_item IS a reference to the subclass, is walked above, in the same read as the task.)
//
//   table       the parent's table, read for the person (the policy guard refuses a blocked one: the walk is left out and the pack says so)
//   columns     what is read from it, each with its reason:
//                 caller_id        an incident task is for the caller of the incident
//                 requested_by     a change task is for the person who asked for the change
//                 contact          a customer service task is for the case's contact
//                 consumer         ... or, in a business-to-consumer case, its consumer (a case names the one or the other)
//                 account          the case's account: the priority-account mark of the glance (N28) is the account's, not the task's
//                 subject_person   an HR task is for the employee the HR case is about
//   sensitive   the parent is an HR record: its identities are read only when the organisation allows sensitive content (allowSensitive)
// A problem task and any other task (a plain task, a custom class) have no person: the problem is internal work, and nothing says whose a
// custom task is. Each person becomes a person of the pack under the role of the column (people.js PERSON_FIELDS), exactly as the requester
// of a catalog task does, so the caller card, the greeting, the caller briefing and the masking of the name all follow.
export const PARENT_PERSON = Object.freeze({
  incident_task: Object.freeze({ table: 'incident', sensitive: false, columns: Object.freeze(['caller_id']) }),
  change_task: Object.freeze({ table: 'change_request', sensitive: false, columns: Object.freeze(['requested_by']) }),
  sn_customerservice_task: Object.freeze({ table: 'sn_customerservice_case', sensitive: false, columns: Object.freeze(['contact', 'consumer', 'account']) }),
  sn_hr_core_task: Object.freeze({ table: 'sn_hr_core_case', sensitive: true, columns: Object.freeze(['subject_person']) }),
});

/** The column of a task that points at its parent: every task table has it. */
export const PARENT_PERSON_LINK = 'parent';

/**
 * The features that find the person on the pack's people list without naming a person column of their own (the caller briefing reads this
 * ticket's short fields; who the caller is comes from the people). Every other feature that names a person gets the parent's with the rest.
 */
export const PARENT_PERSON_FEATURES = Object.freeze(['caller-briefing']);

export default {
  spec: {},
  journal: {},
  related: {},
  fieldsByKind: {},
  // Additive: the walked columns are on the catalog task's display ceiling (so a feature can only ever get them through its own spec).
  //   close_notes on a request (F19): "Ready to resolve?" applies to a request, whose notes check could only ever say "No notes yet" because
  //   the column was not read. It is a column of every task table; a request that lacks it simply does not return it.
  extendFields: { catalog_task: ['request_item.requested_for', 'request_item.cat_item'], request: ['close_notes'] },
  limits: {},
};
