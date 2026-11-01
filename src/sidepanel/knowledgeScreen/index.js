// The Knowledge screen's two halves (owner: Write and Knowledge agent, docs/round3.md). Props: { page, eff, active }.
//   KnowledgeInsights  no AI: knowledge search for everyone (N23); duplicate finder (N18) and gap radar (N19) for knowledge managers
//   KnowledgeAssist    AI, knowledge managers only: merge duplicate articles (AI26), outline a missing article (AI27)
// KnowledgeAssist.shownFor(eff) says whether this person has the AI half at all (the `km` profile, or "Show everything"); without
// it the Knowledge screen is just search and needs no Insights / AI Assist switch (the shell asks it, see shell/ScreenView.jsx).
export { default as KnowledgeInsights } from './KnowledgeInsights.jsx';
export { default as KnowledgeAssist } from './KnowledgeAssist.jsx';
