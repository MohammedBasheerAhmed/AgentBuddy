// The list of report sections the Team dashboard can show. One entry per section:
//   { id, label, description, View, feature?, hideWhenOff? }
// `id` is the engine's section id (src/reports/engine/index.js, SECTIONS) for the ready-made ones, and is what a saved
// dashboard stores. `View` is a React component with props { widget, env, eff }: it reads its own data (useSection) and draws
// it. `env` is built by the dashboard: { page, scope, scopeKind, tables, blocked, refreshKey, mask, setMask, openList(table, query),
// openTicket({table, sysId}), canEdit, setWidgetParams(widget, params), noteRead(widgetId, readAt), loaded (the widgets' results,
// memory only), myGroups, groupsNote }. `eff` is the effective settings and policy (the AI sections need them).
//
// To add a section: add an entry below, give the engine a section with the same id (or have the View call its own reader), and add
// the id to SECTION_IDS in src/reports/engine/constants.js so a saved dashboard can hold it. Nothing else in the dashboard changes.
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import OverviewView from './OverviewView.jsx';
import WorkloadView from './WorkloadView.jsx';
import SlaView from './SlaView.jsx';
import QualityView from './QualityView.jsx';
import FulfilmentView from './FulfilmentView.jsx';
import HandoverView from './HandoverView.jsx';
import CoachingView from './CoachingView.jsx';
import InsightsView from './InsightsView.jsx';

export const REPORT_SECTIONS = [
  { id: 'overview', label: 'Overview tiles', description: 'Open, due soon, breached, unassigned, stale, waiting, opened and resolved today.', View: OverviewView },
  { id: 'workload', label: 'Workload and ageing', description: 'Open work by person and group, ageing, stale and reassigned tickets.', View: WorkloadView },
  { id: 'sla', label: 'SLA risk radar', description: 'Breached and at-risk SLAs by owner and group, the ten closest to breaking.', View: SlaView },
  { id: 'quality', label: 'Quality and trend', description: 'Opened against resolved, time to resolve, reopen rate, top categories, repeat callers.', View: QualityView },
  { id: 'fulfilment', label: 'Request fulfilment', description: 'Requested items and catalog tasks by state, approvals, oldest open items.', View: FulfilmentView },
  // The AI sections. 'handover' works without AI (the note is an extra button); 'insights' and 'coaching' are AI only, so they
  // are not offered in Customize when the organisation's policy leaves their feature off (hideWhenOff). A saved one still shows
  // a calm line instead of failing. They take (widget, env, eff): the AI needs the settings and policy.
  { id: 'handover', label: 'Shift handover', description: 'Open, at risk, waiting on others and recent events for the next shift, with an optional AI-written note.', View: HandoverView, feature: 'shift-handover' },
  { id: 'insights', label: 'Explain this dashboard', description: 'AI: what stands out in the numbers on this dashboard, likely reasons as hypotheses, and three actions.', View: InsightsView, feature: 'dashboard-insights', hideWhenOff: true },
  { id: 'coaching', label: 'Coaching snapshot (opt-in)', description: 'AI, for one group: a rubric review of a sample of resolved tickets. Off unless your organisation switches coaching on.', View: CoachingView, feature: 'coaching-snapshot', hideWhenOff: true },
];

export const sectionById = (id) => REPORT_SECTIONS.find((s) => s.id === id) || null;

/** The sections Customize offers under this policy: an AI-only section whose feature the organisation leaves off is not listed. */
export const addableSections = (policy) => REPORT_SECTIONS.filter((s) => !s.hideWhenOff || isFeatureAvailable(featureById(s.feature), policy));
