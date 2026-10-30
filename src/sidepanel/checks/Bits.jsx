// Small presentational pieces shared by the three record tabs of the checks area. No state, no reads: they draw what they
// are given (React escapes every string, so ticket text is never markup).
import React from 'react';
import ErrorNote from '../ErrorNote.jsx';

/** A collapsible card with a title and an optional count. */
export function Section({ title, count, children, defaultOpen = true }) {
  return (
    <details className="ab-card ab-chk-section" open={defaultOpen}>
      <summary className="ab-chk-summary">
        {title} {count !== undefined && count !== null && <span className="ab-tag">{count}</span>}
      </summary>
      <div className="ab-chk-body">{children}</div>
    </details>
  );
}

/** Label and value pairs (question and answer, field and value). A long value wraps; nothing scrolls sideways. */
export function Facts({ rows, tight = false }) {
  return (
    <dl className={`ab-chk-facts${tight ? ' ab-chk-facts-tight' : ''}`}>
      {rows.map((row, i) => (
        <div className="ab-chk-fact" key={`${row.label}:${i}`}>
          <dt>{row.label}</dt>
          <dd className={row.hidden ? 'ab-chk-hidden' : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One or more plain hint lines. */
export function Hints({ lines }) {
  const shown = (lines || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="ab-chk-hints">
      {shown.map((line, i) => (
        <p className="ab-hint" key={i}>{line}</p>
      ))}
    </div>
  );
}

/** The state of a read: a quiet "looking" line and a red error with "Try again" (onRetry). Renders nothing once the data is there. */
export function LoadNotes({ state, onRetry }) {
  return (
    <>
      {state.phase === 'loading' && !state.data && <p className="ab-note" role="status">Looking…</p>}
      {state.phase === 'error' && <ErrorNote error={state.error} onRetry={onRetry} />}
    </>
  );
}

/** A short coloured word: the state is always written out, colour only backs it up. */
export function Tag({ tone, children }) {
  return <span className={`ab-tag${tone ? ` ab-chk-tag-${tone}` : ''}`}>{children}</span>;
}
