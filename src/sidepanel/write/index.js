// The Write screen's two halves (owner: Write and Knowledge agent, docs/round3.md). Props: { page, eff, active }.
//   WriteInsights  no AI: the safe-to-send check on what the agent typed (N22) and the snippets (N21)
//   WriteAssist    AI: Rewrite (AI23) and Notes to ticket (AI24)
// "Which email fits", the email templates and the AI email drafts moved to the Ticket screen (N20, AI9).
export { default as WriteInsights } from './WriteInsights.jsx';
export { default as WriteAssist } from './WriteAssist.jsx';
