// The Ticket screen's AI Assist actions (owner: Actions agent, docs/round3.md).
//
// ActionGroups props: { page, eff, record, header, busy, aiReady, quiet, onRun(feature, options) }   (both parts together)
//   or, with something between them (the AI Assist half puts its answers there): plan = useActionPlan({ page, eff, record, header,
//   aiReady }), then <SuggestedActions plan eff busy aiReady quiet onRun /> and <MoreActions plan eff busy aiReady onRun />
// The side rail lists every action of the same plan (plan.items; src/sidepanel/ticket/ticketRail.js assistRail).
//
// For the answer card (Answers agent): the Insert API (targets, modes, where the text lands, the check before the click, insertText,
// primaryOf, choicesOf for the three chat replies) is in src/sidepanel/insertFlow.js.
export { default as ActionGroups, MoreActions, SuggestedActions, useActionPlan } from './ActionGroups.jsx';
export { actionPlan, featureBlock, offeredFeatures, recordBlock } from './plan.js';
