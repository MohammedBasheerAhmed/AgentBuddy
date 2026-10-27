import React from 'react';
import ChartFrame, { PatternDefs, Swatch, patternId, useUid } from './ChartFrame.jsx';
import { clipLabel, formatNumber, stackedLayout, stackedToTable, summarizeStacked, toneClass, toneForIndex } from './geometry.js';
import { useWidth } from './useWidth.js';

const BAR_HEIGHT = 22;

/**
 * One stacked horizontal bar per row (for example one per person, split by state). All bars share one scale, so they can be
 * compared. Series differ by pattern as well as colour; the value is printed in a segment when it fits, and is always in the
 * tooltip, the accessible name and the table view.
 *
 *   rows     [{ key, label, parts: [{ key, value }] }]
 *   series   [{ key, label, tone }]   (tone defaults to the next categorical colour)
 *   onDrill(rowKey, partKey)  makes every segment a button (Enter or Space)
 */
export default function StackedBar({ title, rows, series, onDrill, emptyText = 'Nothing to show.', labelHeader, maxRows = 12, defaultTable = false }) {
  const uid = useUid();
  const [ref, width] = useWidth();
  const defs = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object').map((s, i) => ({ ...s, tone: s.tone || toneForIndex(i) }));
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  const layout = stackedLayout(list, defs, { width: 100, rowHeight: BAR_HEIGHT, maxRows });
  const summary = `${title ? `${title}. ` : ''}${summarizeStacked(list, defs)}`;

  const legend = (
    <ul className="ab-legend">
      {defs.map((s, i) => (
        <li key={String(s.key ?? i)}>
          <Swatch uid={uid} index={i} tone={s.tone} />
          <span>{s.label ?? s.key}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <ChartFrame
      title={title}
      summary={summary}
      interactive={Boolean(onDrill)}
      defaultTable={defaultTable}
      empty={layout.rows.length === 0}
      emptyText={emptyText}
      legend={legend}
      table={{ ...stackedToTable(list, defs, { labelHeader }), caption: title }}
      note={layout.hidden > 0 ? `and ${layout.hidden} more. Show as table for all rows.` : ''}
    >
      <div ref={ref} className="ab-stack">
        <PatternDefs uid={uid} tones={defs.map((s) => s.tone)} />
        {layout.rows.map((row) => (
          <div className="ab-stack-row" key={row.key}>
            <div className="ab-stack-head">
              <span className="ab-stack-label" title={row.label}>
                {clipLabel(row.label, 60)}
              </span>
              <span className="ab-stack-total">{formatNumber(row.total)}</span>
            </div>
            <svg className="ab-stack-svg" width="100%" height={BAR_HEIGHT} aria-hidden={onDrill ? undefined : 'true'} focusable="false">
              <rect className="ab-bar-track" x="0" y="0" width="100%" height={BAR_HEIGHT} rx="3" />
              {row.segments.map((seg) => {
                const text = formatNumber(seg.value);
                const fits = (seg.width / 100) * width >= text.length * 7 + 10;
                const name = `${row.label}, ${seg.seriesLabel}: ${text}`;
                const shape = (
                  <>
                    <title>{name}</title>
                    <rect className="ab-seg-shape" x={`${seg.x}%`} y="0" width={`${seg.width}%`} height={BAR_HEIGHT} fill={`url(#${patternId(uid, seg.seriesIndex)})`} />
                    {fits ? (
                      <text className="ab-seg-text" x={`${seg.x + seg.width / 2}%`} y={BAR_HEIGHT / 2} dy="0.35em">
                        {text}
                      </text>
                    ) : null}
                    <rect className="ab-ring-a" x={`${seg.x}%`} y="0" width={`${seg.width}%`} height={BAR_HEIGHT} />
                    <rect className="ab-ring-b" x={`${seg.x}%`} y="0" width={`${seg.width}%`} height={BAR_HEIGHT} />
                  </>
                );
                return onDrill ? (
                  <g
                    key={seg.key}
                    className={`ab-seg ${toneClass(seg.tone)}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${name}. Open the list.`}
                    onClick={() => onDrill(row.key, seg.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onDrill(row.key, seg.key);
                      }
                    }}
                  >
                    {shape}
                  </g>
                ) : (
                  <g key={seg.key} className={toneClass(seg.tone)}>
                    {shape}
                  </g>
                );
              })}
            </svg>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}
