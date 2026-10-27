import React, { useEffect } from 'react';
import ExportBar from './ExportBar.jsx';
import { andList, readLabel } from './format.js';

// The frame every report widget sits in: title, a calm loading line, plain explanations of anything that could not be read,
// the numbers' age and denominators, and the export bar. A table the person cannot read is said so here, once, in words; a
// section's own picture is only drawn for what could be read.
//
// Props: title, state (from useReport), env (from the dashboard), widgetId, facts (extra short lines such as denominators),
// children (the picture, rendered only when the section has data), help (one sentence under the title).
export default function SectionShell({ title, help, state, env, widgetId, facts = [], children, actions }) {
  const { phase, result, error, busy } = state;
  const readAt = result?.readAt;
  const data = result?.data;

  useEffect(() => {
    env.noteRead?.(widgetId, readAt);
  }, [env, widgetId, readAt]);

  const tableNotes = (result?.tables || []).filter((t) => t.status !== 'ok' && t.note).map((t) => t.note);
  const accessNotes = (result?.access || []).map((a) => a.note).filter((n) => n && !tableNotes.includes(n));
  const notes = [...new Set([...(result?.scope?.note ? [result.scope.note] : []), ...tableNotes, ...accessNotes, ...(result?.notes || [])])];
  const caps = result?.caps || [];
  const unavailable = data && data.available === false;
  const used = (result?.tables || []).filter((t) => t.status === 'ok').map((t) => t.label);

  return (
    <section className="ab-card ab-widget" aria-label={title} aria-busy={busy}>
      <div className="ab-widget-head">
        <h2 className="ab-h">{title}</h2>
        <span className="ab-spacer" />
        {actions}
      </div>
      {help && <p className="ab-sub ab-widget-help">{help}</p>}

      {phase === 'loading' && !result && <p className="ab-note" role="status">Reading the numbers…</p>}
      {phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{error}</p>}

      {notes.map((n) => (
        <p key={n} className="ab-note ab-note-warn ab-widget-note">{n}</p>
      ))}
      {caps.map((c) => (
        <p key={`${c.source}-${c.note}`} className="ab-note ab-note-warn ab-widget-note">{c.note}</p>
      ))}

      {unavailable && <p className="ab-note ab-widget-note">{data.reason || 'Nothing to show here.'}</p>}
      {result && !unavailable && <div className={busy ? 'ab-widget-body ab-is-busy' : 'ab-widget-body'}>{children}</div>}

      {result && (
        <>
          <p className="ab-widget-foot">
            {[
              `Read at ${readLabel(readAt)}`,
              result.scope?.label,
              used.length ? andList(used) : '',
              ...facts,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {!unavailable && <ExportBar title={title} result={result} env={env} />}
        </>
      )}
    </section>
  );
}
