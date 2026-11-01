// The Team screen's two halves (owner: Team agent, docs/round3.md). Props: { page, eff, active }. The shell shows the screen for the
// team-lead profile (or "Show everything").
//   TeamInsights  no AI: dashboards, shift hand-over tables, report builder, saved dashboards, export, full page (N15-N17)
//   TeamAssist    AI: the hand-over note, "Explain this dashboard", the coaching snapshot (AI28-AI30), from the numbers Insights read
export { default as TeamInsights } from './TeamInsights.jsx';
export { default as TeamAssist } from './TeamAssist.jsx';
