// The Ticket screen's AI Assist actions and the quick-actions bar (owner: Actions agent, docs/round3.md).
//
// ActionGroups props: { page, eff, record, header, busy, aiReady, onRun(feature, options) }
// QuickBar props:     { page, eff, record, header, busy, aiReady, onRun(feature), onShowCard(cardId) }
//
// For the answer card (Answers agent): the Insert API (targets, modes, where the text lands, the check before the click, insertText,
// primaryOf, choicesOf for the three chat replies) is in src/sidepanel/insertFlow.js.
export { default as ActionGroups } from './ActionGroups.jsx';
export { default as QuickBar } from './TicketQuickBar.jsx';
export { actionPlan, featureBlock, offeredFeatures, recordBlock } from './plan.js';
