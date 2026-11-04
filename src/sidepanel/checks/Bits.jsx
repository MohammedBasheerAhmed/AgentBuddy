// Small presentational pieces shared by the Ticket screen's cards (src/sidepanel/ticket/cards). No state, no reads: they draw what
// they are given (React escapes every string, so ticket text is never markup).
import React from 'react';

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

/** A short coloured word: the state is always written out, colour only backs it up. */
export function Tag({ tone, children }) {
  return <span className={`ab-tag${tone ? ` ab-chk-tag-${tone}` : ''}`}>{children}</span>;
}
