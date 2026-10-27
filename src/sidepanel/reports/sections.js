// The list of report sections the Team dashboard can show. One entry per section:
//   { id, label, description, View }
// `id` is the engine's section id (src/reports/engine/index.js, SECTIONS) for the ready-made ones, and is what a saved
// dashboard stores. `View` is a React component with props { widget, env }: it reads its own data (useSection) and draws
// it. `env` is built by the dashboard: { page, scope, scopeKind, tables, blocked, refreshKey, mask, setMask, openList(table, query),
// openTicket({table, sysId}), canEdit, setWidgetParams(widget, params), noteRead(widgetId, readAt) }.
//
// To add a section later (for example an AI hand-over summary that takes the same JSON the engine returns): add an entry
// below, give the engine a section with the same id (or have the View call its own reader), and add the id to SECTION_IDS in
// src/reports/engine/constants.js so a saved dashboard can hold it. Nothing else in the dashboard changes.
import OverviewView from './OverviewView.jsx';
import WorkloadView from './WorkloadView.jsx';
import SlaView from './SlaView.jsx';
import QualityView from './QualityView.jsx';
import FulfilmentView from './FulfilmentView.jsx';

export const REPORT_SECTIONS = [
  { id: 'overview', label: 'Overview tiles', description: 'Open, due soon, breached, unassigned, stale, waiting, opened and resolved today.', View: OverviewView },
  { id: 'workload', label: 'Workload and ageing', description: 'Open work by person and group, ageing, stale and reassigned tickets.', View: WorkloadView },
  { id: 'sla', label: 'SLA risk radar', description: 'Breached and at-risk SLAs by owner and group, the ten closest to breaking.', View: SlaView },
  { id: 'quality', label: 'Quality and trend', description: 'Opened against resolved, time to resolve, reopen rate, top categories, repeat callers.', View: QualityView },
  { id: 'fulfilment', label: 'Request fulfilment', description: 'Requested items and catalog tasks by state, approvals, oldest open items.', View: FulfilmentView },
];

export const sectionById = (id) => REPORT_SECTIONS.find((s) => s.id === id) || null;
