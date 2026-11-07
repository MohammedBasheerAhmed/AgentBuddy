// Context specs of round 4 (docs/round4.md), owned by the Find the fix agent. Same shape as the other files here (docs/contracts.md, 'Context specs').
//
// Wave 6 (catalog fulfiller, docs/live-questions/audit-1107-catalog.md): "Fulfilled before", the last completed tasks for the same catalog
// item, one card inside the "Find the fix" row (src/sidepanel/ticket/cards/FulfilledCard.jsx). No AI: the read is shown to the agent only,
// so it is a search-only feature (allowlists.js SEARCH_ONLY_FEATURES) and reads no person column beyond the one it lists.
export default {
  spec: {
    'fulfilled-before': {
      common: ['number'], // (every feature reads the record number, which names the task in the answer)
      by: {
        // The open requested item: what was ordered. The earlier tasks are found by this catalog item.
        requested_item: ['cat_item'],
        // The open catalog task: the item it is a step of (`request_item`, whose own id is left out of the answer: the other tasks of this
        // very item are current work, not "before") and what was ordered (`request_item.cat_item`, walked from the item in the same read,
        // as the pack reads it: specs/fit.js). The rest are the columns of each EARLIER task, one reason each:
        //   number, short_description  which task it was, and the link that opens it
        //   state                      only Closed Complete counts (checked again on every row)
        //   assigned_to                who did it (shown only when the name can be read)
        //   opened_at, closed_at       how long it took, in words
        //   close_notes                how it was done, cut to its first sentences
        catalog_task: ['number', 'short_description', 'state', 'assigned_to', 'opened_at', 'closed_at', 'close_notes', 'request_item', 'request_item.cat_item'],
      },
    },
  },
  // No notes and no extras: the card is about other tasks, not this record's conversation.
  journal: { 'fulfilled-before': false },
  related: { 'fulfilled-before': [] },
  fieldsByKind: {},
  extendFields: {},
  limits: {},
};
