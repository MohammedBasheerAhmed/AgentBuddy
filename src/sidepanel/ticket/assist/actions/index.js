// The Ticket screen's AI Assist actions (owner: Actions agent, docs/round3.md; the five since docs/focus-layout.md).
//
// ActionGroups props: { page, eff, record, header, busy, aiReady, quiet, onRun(feature, options) }   (the five rows with their own plan)
//   or, with the plan worked out once for several parts (the AI Assist half and the side rail): plan = useActionPlan({ page, eff,
//   record, header, aiReady }), then <FocusActions plan eff busy aiReady quiet onRun />
// The side rail lists the same five (plan.five; src/sidepanel/ticket/ticketRail.js assistRail); the rest (plan.rest) are in All tools.
//
// For the answer card (Answers agent): the Insert API (targets, modes, where the text lands, the check before the click, insertText,
// primaryOf, choicesOf for the three chat replies) is in src/sidepanel/insertFlow.js.
export { default as ActionGroups, FocusActions, useActionPlan } from './ActionGroups.jsx';
export { actionPlan, featureBlock, offeredFeatures, primaryAction, recordBlock } from './plan.js';
