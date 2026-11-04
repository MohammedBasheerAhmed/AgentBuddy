import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { ChartTables } from '../charts/ChartFrame.jsx';
import MoreMenu from './MoreMenu.jsx';
import { t } from '../../i18n/index.js';
import { shown } from '../../reports/shown.js';

// The frame every report widget sits in: a section of the dashboard (no box: space and one divider part it from the next), its title,
// one line of help, a calm loading line, the picture, and the few facts that belong to this section only (denominators). Kept quiet
// on purpose (TRACKER.md 2.4, the 2026 redesign):
//   - what could not be read (a table, the scope, a cap) is the same for every widget, so the DASHBOARD says it once
//     (ReportsDashboard.jsx collects the notes of every loaded result); a widget repeats none of it;
//   - an ended ServiceNow session is one banner for the whole dashboard with "Try again" (env.onSessionLost), not a red box per widget;
//   - export lives in the dashboard's one export menu, not under every widget;
//   - what a section offers besides its numbers sits in one quiet "⋯" menu by its title: "Show as tables" (every chart of the section
//     as a table at once, instead of a toggle on each chart) and, while customizing, Move up / Move down / Edit / Remove (`tools`).
// `data-state` ('loading' | 'ready' | 'error' | 'unavailable' | 'session') says where the widget is, for tests and for print.
//
// Props: title, state (from useReport), env (from the dashboard), widgetId, facts (short lines such as denominators), children (the
// picture, drawn only when the section has data), help (one sentence under the title), actions (small controls by the title, such as
// the period), tools (menu items from the dashboard while customizing: [{ id, label, onSelect, disabled }]).
export default function SectionShell({ title, help, state, env, widgetId, facts = [], children, actions, tools = [] }) {
  const { phase, result, error, busy, code } = state;
  const readAt = result?.readAt;
  const data = result?.data;
  const sessionLost = phase === 'error' && code === 'SESSION_EXPIRED';

  useEffect(() => {
    env.noteRead?.(widgetId, readAt);
  }, [env, widgetId, readAt]);
  // Only when this widget NEWLY loses the session: "Try again" gives the dashboard a new env while the widget still shows the old
  // error for one render, and that must not raise the banner again.
  const report = useRef(env.onSessionLost);
  report.current = env.onSessionLost;
  useEffect(() => {
    if (sessionLost) report.current?.();
  }, [sessionLost]);

  const unavailable = data && data.available === false;
  const where = sessionLost ? 'session' : phase === 'error' && !result ? 'error' : !result ? 'loading' : unavailable ? 'unavailable' : 'ready';

  return (
    <section className="ab-widget" aria-label={title} aria-busy={busy} data-state={where}>
      <WidgetHead title={title} actions={actions} tools={tools}>
        {(tables) => (
          <>
            {help && <p className="ab-widget-help">{help}</p>}

            {phase === 'loading' && !result && <p className="ab-widget-loading" role="status">{t('Reading the numbers…')}</p>}
            {phase === 'error' && !sessionLost && (
              <div className="ab-widget-error">
                <ErrorNote error={`${shown(error)}${result ? ` ${t('The numbers below are from the last read that worked.')}` : ''}`} onRetry={state.reload} />
              </div>
            )}

            {unavailable && <p className="ab-note ab-widget-note">{shown(data.reason) || t('Nothing to show here.')}</p>}
            {result && !unavailable && (
              <ChartTables.Provider value={tables}>
                <div className={busy ? 'ab-widget-body ab-is-busy' : 'ab-widget-body'}>{children}</div>
              </ChartTables.Provider>
            )}

            {result && facts.filter(Boolean).length > 0 && <p className="ab-widget-foot">{facts.filter(Boolean).join(' · ')}</p>}
          </>
        )}
      </WidgetHead>
    </section>
  );
}

/**
 * A section's title row, with its controls and its quiet "⋯" menu, and what is under it. The menu has "Show as tables" while the
 * section draws at least one chart that can be a table (each chart says so through ChartTables), and the dashboard's `tools`.
 * `children(tables)` draws the rest of the section; `tables` is what the charts read ({ on, register }).
 */
export function WidgetHead({ title, actions, tools = [], children }) {
  const [on, setOn] = useState(false);
  const [charts, setCharts] = useState(0);
  const register = useCallback(() => {
    setCharts((n) => n + 1);
    return () => setCharts((n) => n - 1);
  }, []);
  const tables = useMemo(() => ({ on, register }), [on, register]);
  const items = [charts > 0 && { id: 'tables', label: t('Show as tables'), checked: on, onSelect: () => setOn((v) => !v) }, ...(Array.isArray(tools) ? tools : [])].filter(Boolean);
  return (
    <>
      <div className="ab-widget-head">
        <h2 className="ab-widget-title">{title}</h2>
        {actions ? <div className="ab-widget-actions">{actions}</div> : null}
        {items.length > 0 && <MoreMenu label={t('Options for {name}', { name: title })} items={items} className="ab-widget-more" />}
      </div>
      {children(tables)}
    </>
  );
}

/** Every note the loaded results carry (scope, tables, access, caps, notes), once each, in the order the widgets are on screen. Pure. */
export function dashboardNotes(entries, order = null) {
  const at = order ? new Map(order.map((id, i) => [id, i])) : null;
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e?.result && (!at || at.has(e.id)));
  if (at) list.sort((a, b) => at.get(a.id) - at.get(b.id));
  const out = [];
  for (const { result: r } of list) {
    const notes = [
      r.scope?.note,
      ...(r.tables || []).filter((x) => x.status !== 'ok' && x.note).map((x) => x.note),
      ...(r.access || []).map((a) => a.note),
      ...(r.caps || []).map((c) => c.note),
      ...(r.notes || []),
    ];
    notes.forEach((n) => n && !out.includes(n) && out.push(n));
  }
  return out;
}
