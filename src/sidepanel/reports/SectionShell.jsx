import React, { useEffect, useRef } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { t } from '../../i18n/index.js';

// The frame every report widget sits in: title, one line of help, a calm loading line, the picture, and the few facts that belong
// to this section only (denominators). Kept quiet on purpose (TRACKER.md 2.4):
//   - what could not be read (a table, the scope, a cap) is the same for every widget, so the DASHBOARD says it once
//     (ReportsDashboard.jsx collects the notes of every loaded result); a widget repeats none of it;
//   - an ended ServiceNow session is one banner for the whole dashboard with "Try again" (env.onSessionLost), not a red box per widget;
//   - export lives in the dashboard's one export menu, not under every widget.
// `data-state` ('loading' | 'ready' | 'error' | 'unavailable' | 'session') says where the widget is, for tests and for print.
//
// Props: title, state (from useReport), env (from the dashboard), widgetId, facts (short lines such as denominators), children (the
// picture, drawn only when the section has data), help (one sentence under the title), actions (small controls by the title).
export default function SectionShell({ title, help, state, env, widgetId, facts = [], children, actions }) {
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
    <section className="ab-card ab-widget" aria-label={title} aria-busy={busy} data-state={where}>
      <div className="ab-widget-head">
        <h2 className="ab-h">{title}</h2>
        <span className="ab-spacer" />
        {actions}
      </div>
      {help && <p className="ab-sub ab-widget-help">{help}</p>}

      {phase === 'loading' && !result && <p className="ab-note" role="status">{t('Reading the numbers…')}</p>}
      {phase === 'error' && !sessionLost && (
        <div className="ab-widget-error">
          <ErrorNote error={`${error}${result ? ' The numbers below are from the last read that worked.' : ''}`} onRetry={state.reload} />
        </div>
      )}

      {unavailable && <p className="ab-note ab-widget-note">{data.reason || 'Nothing to show here.'}</p>}
      {result && !unavailable && <div className={busy ? 'ab-widget-body ab-is-busy' : 'ab-widget-body'}>{children}</div>}

      {result && facts.filter(Boolean).length > 0 && <p className="ab-widget-foot">{facts.filter(Boolean).join(' · ')}</p>}
    </section>
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
      ...(r.tables || []).filter((t) => t.status !== 'ok' && t.note).map((t) => t.note),
      ...(r.access || []).map((a) => a.note),
      ...(r.caps || []).map((c) => c.note),
      ...(r.notes || []),
    ];
    notes.forEach((n) => n && !out.includes(n) && out.push(n));
  }
  return out;
}
