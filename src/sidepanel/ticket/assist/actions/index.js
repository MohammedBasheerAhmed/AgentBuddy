// The Ticket screen's AI Assist actions and the quick-actions bar (owner: Actions agent, docs/round3.md).
//
// ActionGroups props: { page, eff, record, header, busy, aiReady, quiet, onRun(feature, options) }   (both parts together)
//   or, with something between them (the AI Assist half puts its answers there): plan = useActionPlan({ page, eff, record, header,
//   aiReady }), then <SuggestedActions plan eff busy aiReady quiet onRun /> and <MoreActions plan eff busy aiReady onRun />
// QuickBar props:     { page, eff, record, header, busy, aiReady, exclude, onRun(feature), onShowCard(cardId) }
// nextStep({ record, header, eff }): the action the state suggests first (the Ticket screen's main button)
//
// For the answer card (Answers agent): the Insert API (targets, modes, where the text lands, the check before the click, insertText,
// primaryOf, choicesOf for the three chat replies) is in src/sidepanel/insertFlow.js.
export { default as ActionGroups, MoreActions, SuggestedActions, useActionPlan } from './ActionGroups.jsx';
export { default as QuickBar } from './TicketQuickBar.jsx';
export { actionPlan, featureBlock, nextStep, offeredFeatures, recordBlock } from './plan.js';
