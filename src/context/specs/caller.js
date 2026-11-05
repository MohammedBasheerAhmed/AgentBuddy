// Context spec for the caller briefing (docs/focus-layout.md, part B; the feature is src/features/packs/caller.js). See
// docs/contracts.md, "Context specs".
//
// The briefing compares THIS ticket with the caller's other tickets, so it reads this ticket's short fields only: what it is about
// (short description, category, item, product), where it stands (state, priority) and when it was opened. No description, no notes, no
// related lists: the caller's other tickets come from the `history` read in the feature's enrich(). Every person column of the kind is
// read as well (src/context/allowlists.js adds them to every feature that sends text): that is how the caller is found on the pack's
// people list, and how their name is masked wherever a ticket mentions it. Those columns are not fields of the pack.
//
// `common` only: a column a kind does not have is dropped by the kind's ceiling (a request has no category, a chat no priority).

export default {
  spec: {
    'caller-briefing': {
      common: ['number', 'short_description', 'state', 'priority', 'category', 'subcategory', 'cmdb_ci', 'cat_item', 'product', 'opened_at'],
      by: {},
    },
  },
  journal: { 'caller-briefing': false },
  related: { 'caller-briefing': [] },
  fieldsByKind: {},
  extendFields: {},
  limits: {},
};
