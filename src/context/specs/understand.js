// Context specs of round 4 (docs/round4.md), owned by the Understand agent. Same shape as the other files here (docs/contracts.md, 'Context specs').
//
// 'translate-message' (src/features/packs/translate.js): the caller's newest customer-visible comments and the short description,
// translated into the agent's language. It reads the record number (every spec does; it is not sent), the short description and the
// notes and comments (the newest LIMITS.journalEntries; the feature's parts keep only the caller's newest 1 to 3 comments: no work
// note is ever sent). Every person column of the kind is
// read as well (src/context/allowlists.js adds them to every feature that sends text): that is how the caller is told apart from the
// agents, and how their names are masked wherever the words mention them. Those columns are not fields of the pack. No related list,
// no ceiling widened.
//
// "Since you last looked" needs no spec of its own: it works from the `glance` read ('insights-ticket', specs/insights.js) and the
// journey's field history (the `journey` read), which the Ticket screen makes anyway.

export default {
  spec: {
    'translate-message': { common: ['number', 'short_description'], by: {} },
  },
  journal: { 'translate-message': true },
  related: { 'translate-message': [] },
  fieldsByKind: {},
  extendFields: {},
  limits: {},
};
