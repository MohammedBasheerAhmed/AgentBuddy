import { useReport } from './useReport.js';

/** Read one ready-made section for a dashboard widget. `env` comes from the dashboard (see ReportsDashboard.jsx). */
export function useSection(sectionId, widget, env) {
  const request = env.tables.length ? { kind: 'section', section: sectionId, scope: env.scope, tables: env.tables, params: widget?.params || {}, blocked: env.blocked } : null;
  return useReport({ tabId: env.page.tabId, request, refreshKey: env.refreshKey, limiter: env.limiter });
}
