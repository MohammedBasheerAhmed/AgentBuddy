// Pure decisions the Team dashboard makes (src/sidepanel/reports/ReportsDashboard.jsx), kept here so they are tested without a browser
// (tests/reports-dashboard-env.test.js).
import { sectionById } from './sections.js';
import { shown } from '../../reports/shown.js';

/**
 * What about the ServiceNow page the widgets depend on: the tab, the instance, and the kind of page links are built for. NOT the
 * address of the page itself: while the Team tab is on screen the person keeps working in ServiceNow, and every move of that tab
 * (a list, a record, a search) used to hand the dashboard a new `page`, new widget props, and work for every widget. Widgets read
 * again only when this key, the scope, the tables, the filters or "Refresh" change.
 */
export function pageIdentity(page) {
  let origin;
  try {
    origin = new URL(page?.href).origin;
  } catch {
    origin = '';
  }
  const portal = page?.surface === 'portal' ? String(page?.portal?.base || '') : '';
  return [page?.tabId ?? '', origin, page?.surface || '', portal, page?.windowId ?? ''].join('|');
}

/**
 * The widgets the Insights dashboard draws. An AI section (Explain this dashboard, the coaching snapshot) is never drawn here: no AI
 * element on Insights (TRACKER.md 2.3); they are under AI Assist. A dashboard saved earlier may hold one: it is left out, with one line
 * naming it; in Customize it stays, so it can be removed. Returns { shown: widget[], hidden: string[] (labels) }. `policy` is kept for
 * callers.
 */
// eslint-disable-next-line no-unused-vars
export function visibleWidgets(widgets, { policy, customize = false } = {}) {
  const drawn = [];
  const hidden = [];
  for (const w of Array.isArray(widgets) ? widgets : []) {
    const section = w?.type === 'section' ? sectionById(w.section) : null;
    if (section?.ai && !customize) hidden.push(section.label);
    else drawn.push(w);
  }
  return { shown: drawn, hidden: [...new Set(hidden)] };
}

/**
 * Every table the dashboard shows, in the order of its widgets, for "Download all as CSV": the results the widgets have already
 * loaded (env.loaded, memory only), so nothing is read again. Each table's title says which section it comes from. Pure.
 * `entries` is [{ id, section, result }]; `order` the widget ids as they are on screen; `tablesOf(result)` the engine's resultTables.
 */
export function dashboardTables(entries, order, tablesOf) {
  const at = new Map((Array.isArray(order) ? order : []).map((wid, i) => [wid, i]));
  return (Array.isArray(entries) ? entries : [])
    .filter((e) => e?.result && at.has(e.id))
    .sort((a, b) => at.get(a.id) - at.get(b.id))
    .flatMap((e) =>
      tablesOf(e.result)
        .filter((t) => t.rows.length)
        .map((t) => {
          const from = shown(String(e.result.title || ''));
          return { ...t, title: !from || String(t.title).startsWith(from) ? t.title : `${from}: ${t.title}` };
        })
    );
}

/** The params one widget sends: its own saved ones, plus the dashboard's "as of" instant for this load (see asOfFor in the engine). */
export const widgetParams = (widget, asOf) => ({ ...(widget?.params || {}), ...(Number.isFinite(asOf) ? { asOf } : {}) });
