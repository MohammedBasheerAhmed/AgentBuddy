// Context specs for knowledge articles and chat conversations (see docs/contracts.md, "Context specs").
export default {
  spec: {},
  journal: {},
  related: {},
  // A starting ceiling for the two new kinds so every feature has an entry for them; widen it only with a reason.
  fieldsByKind: {
    knowledge: Object.freeze(['number', 'short_description', 'sys_updated_on']),
    chat: Object.freeze(['number', 'state', 'opened_at', 'assigned_to']),
  },
};
