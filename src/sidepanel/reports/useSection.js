import { useEffect } from 'react';
import { useReport } from './useReport.js';

/**
 * Read one ready-made section for a dashboard widget. `env` comes from the dashboard (see ReportsDashboard.jsx).
 *
 * The result the widget shows is also put, in memory only, into `env.loaded` (src/reports/ai/loaded.js) so "Explain this
 * dashboard" can explain exactly the numbers on screen without reading them again. It is taken out when the widget goes away.
 */
export function useSection(sectionId, widget, env) {
  // The params are the widget's own plus the dashboard's "as of" instant for this load (env.widgetParams), so all widgets of one
  // load ask identical questions and the second one is answered from the cache.
  const params = env.widgetParams ? env.widgetParams(widget) : widget?.params || {};
  // allowSensitive: HR tables may be among env.tables (the HR profile, and the organisation allows HR content; the page checks too).
  const request = env.tables.length ? { kind: 'section', section: sectionId, scope: env.scope, tables: env.tables, params, blocked: env.blocked, ...(env.allowSensitive ? { allowSensitive: true } : {}) } : null;
  const state = useReport({ tabId: env.page.tabId, request, refreshKey: env.refreshKey, limiter: env.limiter });
  useLoadedResult(env.loaded, widget?.id, sectionId, state.result);
  return state;
}

/**
 * Keep a widget's result in the dashboard's in-memory store of what is on screen (`env.loaded`, src/reports/ai/loaded.js) under the
 * widget's id, with its `section` (a section id, or 'builder' for a custom report); take it out when there is none and when the widget
 * goes away.
 */
export function useLoadedResult(loaded, id, section, result) {
  useEffect(() => {
    if (!loaded || !id) return;
    if (result) loaded.set(id, section, result);
    else loaded.remove(id);
  }, [loaded, id, section, result]);
  useEffect(
    () => () => {
      if (loaded && id) loaded.remove(id);
    },
    [loaded, id]
  );
}
