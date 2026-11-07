// The list of report sections the Team dashboard can show. One entry per section:
//   { id, label, description, View, feature?, hideWhenOff?, ai? }
// `id` is the engine's section id (src/reports/engine/index.js, SECTIONS) for the ready-made ones, and is what a saved
// dashboard stores. `View` is a React component with props { widget, env, eff }: it reads its own data (useSection) and draws
// it. `env` is built by the dashboard: { page, scope, scopeKind, tables, blocked, refreshKey, mask, setMask, openList(table, query),
// openTicket({table, sysId}), canEdit, setWidgetParams(widget, params), noteRead(widgetId, readAt), loaded (the widgets' results,
// memory only), myGroups, groupsNote }. `eff` is the effective settings and policy (the AI sections need them).
//
// To add a section: add an entry below, give the engine a section with the same id (or have the View call its own reader), and add
// the id to SECTION_IDS in src/reports/engine/constants.js so a saved dashboard can hold it. Nothing else in the dashboard changes.
import { tm } from '../../i18n/index.js';
import AttentionView from './AttentionView.jsx';
import OverviewView from './OverviewView.jsx';
import WorkloadView from './WorkloadView.jsx';
import SlaView from './SlaView.jsx';
import QualityView from './QualityView.jsx';
import FulfilmentView from './FulfilmentView.jsx';
import HandoverView from './HandoverView.jsx';
import CoachingView from './CoachingView.jsx';
import InsightsView from './InsightsView.jsx';

export const REPORT_SECTIONS = [
  { id: 'attention', label: tm('Needs attention now'), description: tm('The few tickets that need you most, each with one reason: breached, closest to breaking, waiting for approval, reassigned often, open longest.'), View: AttentionView },
  { id: 'overview', label: tm('Overview tiles'), description: tm('Open, due soon, breached, unassigned, stale, waiting, opened and resolved today.'), View: OverviewView },
  { id: 'workload', label: tm('Workload and ageing'), description: tm('Open work by person and group, ageing, stale and reassigned tickets.'), View: WorkloadView },
  { id: 'sla', label: tm('SLA risk radar'), description: tm('Breached and at-risk SLAs by owner and group, the ten closest to breaking.'), View: SlaView },
  { id: 'quality', label: tm('Quality and trend'), description: tm('Opened against resolved, time to resolve, reopen rate, top categories, repeat callers.'), View: QualityView },
  { id: 'fulfilment', label: tm('Request fulfilment'), description: tm('Requested items and catalog tasks by state, approvals, oldest open items.'), View: FulfilmentView },
  // 'handover' is Insights (the tables, N16); its AI note lives in the Team screen's AI Assist half (src/sidepanel/team, AI28).
  // 'insights' and 'coaching' are AI only (`ai: true`): the Insights half never draws them and Customize never offers them (no AI
  // element on Insights, TRACKER.md 2.3); they are under AI Assist. A dashboard saved earlier that holds one gets a one-line pointer.
  { id: 'handover', label: tm('Shift handover'), description: tm('Open, at risk, waiting on others and recent events for the next shift.'), View: HandoverView, feature: 'shift-handover' },
  { id: 'insights', label: tm('Explain this dashboard'), description: tm('AI: what stands out in the numbers on this dashboard, likely reasons as hypotheses, and three actions.'), View: InsightsView, feature: 'dashboard-insights', hideWhenOff: true, ai: true },
  { id: 'coaching', label: tm('Coaching snapshot (opt-in)'), description: tm('AI, for one group: a rubric review of a sample of resolved tickets. Off unless your organisation switches coaching on.'), View: CoachingView, feature: 'coaching-snapshot', hideWhenOff: true, ai: true },
];

export const sectionById = (id) => REPORT_SECTIONS.find((s) => s.id === id) || null;

/** The sections Customize offers: the Insights ones only (the AI ones are under AI Assist). `policy` is kept for callers. */
// eslint-disable-next-line no-unused-vars
export const addableSections = (policy) => REPORT_SECTIONS.filter((s) => !s.ai);
