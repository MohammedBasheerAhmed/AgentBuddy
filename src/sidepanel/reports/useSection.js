import { useReport } from './useReport.js';

/** Read one ready-made section for a dashboard widget. `env` comes from the dashboard (see ReportsDashboard.jsx). */
export function useSection(sectionId, widget, env) {
  const request = env.tables.length ? { kind: 'section', section: sectionId, scope: env.scope, tables: env.tables, params: widget?.params || {}, blocked: env.blocked } : null;
  return useReport({ tabId: env.page.tabId, request, refreshKey: env.refreshKey });
}

/**
 * A click on something with possibly several tables behind it (a tile that counts incidents and requested items):
 * the table with the most rows opens. `drills` is [{ table, label, count, query }], biggest first.
 */
export function biggestDrill(drills) {
  return (drills || []).filter((d) => d && d.query).sort((a, b) => (b.count || 0) - (a.count || 0))[0] || null;
}
