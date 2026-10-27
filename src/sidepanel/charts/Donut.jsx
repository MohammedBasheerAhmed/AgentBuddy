import React from 'react';
import ChartFrame, { PatternDefs, Swatch, patternId, useUid } from './ChartFrame.jsx';
import { donutArcs, formatNumber, itemsToTable, percent, summarizeItems, toneClass, toneForIndex } from './geometry.js';

const RADIUS = 52;

/**
 * A ring split by item, with the total in the middle and a legend that names every slice with its value and percentage (the
 * legend is the accessible, keyboard-reachable part: with onDrill each legend row is a button). Slices differ by pattern too.
 *
 *   items        [{ key, label, value, tone }]
 *   centerLabel  small text under the total, for example "open"
 *   onDrill(item)
 */
export default function Donut({ title, items, centerLabel = '', onDrill, emptyText = 'Nothing to show.', labelHeader, valueHeader, defaultTable = false }) {
  const uid = useUid();
  const list = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object').map((it, i) => ({ ...it, tone: it.tone || toneForIndex(i) }));
  const ring = donutArcs(list, { radius: RADIUS, thickness: 20 });
  const summary = `${title ? `${title}. ` : ''}${summarizeItems(list)}`;

  const legend = (
    <ul className="ab-legend-list">
      {list.map((item, i) => {
        const arc = ring.arcs[i];
        const pct = percent(arc.value, ring.total);
        const inner = (
          <>
            <Swatch uid={uid} index={i} tone={item.tone} />
            <span className="ab-legend-label" title={arc.label}>
              {arc.label}
            </span>
            <span className="ab-legend-value">{formatNumber(arc.value)}</span>
            <span className="ab-legend-pct">{ring.total > 0 ? `${pct}%` : '-'}</span>
          </>
        );
        return (
          <li key={arc.key}>
            {onDrill ? (
              <button type="button" className="ab-legend-item" aria-label={`${arc.label}: ${formatNumber(arc.value)}${ring.total > 0 ? `, ${pct}%` : ''}. Open the list.`} onClick={() => onDrill(item)}>
                {inner}
              </button>
            ) : (
              <div className="ab-legend-item">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <ChartFrame
      title={title}
      summary={summary}
      defaultTable={defaultTable}
      empty={list.length === 0 || ring.total <= 0}
      emptyText={emptyText}
      legend={legend}
      table={{ ...itemsToTable(list, { labelHeader, valueHeader }), caption: title }}
    >
      <div className="ab-donut">
        <PatternDefs uid={uid} tones={list.map((it) => it.tone)} />
        <svg className="ab-donut-svg" width={ring.size} height={ring.size} viewBox={`0 0 ${ring.size} ${ring.size}`} aria-hidden="true" focusable="false">
          {ring.arcs.map((arc, i) =>
            arc.d ? (
              <g key={arc.key} className={toneClass(list[i].tone)}>
                <title>{`${arc.label}: ${formatNumber(arc.value)}`}</title>
                <path className="ab-donut-seg" d={arc.d} fill={`url(#${patternId(uid, i)})`} />
              </g>
            ) : null
          )}
          <text className="ab-donut-total" x={ring.cx} y={ring.cy} textAnchor="middle" dy={centerLabel ? '-0.1em' : '0.35em'}>
            {formatNumber(ring.total, { compact: true })}
          </text>
          {centerLabel ? (
            <text className="ab-donut-sub" x={ring.cx} y={ring.cy} textAnchor="middle" dy="1.4em">
              {centerLabel}
            </text>
          ) : null}
        </svg>
      </div>
    </ChartFrame>
  );
}
