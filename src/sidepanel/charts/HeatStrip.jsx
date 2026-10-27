import React from 'react';
import ChartFrame from './ChartFrame.jsx';
import { clipLabel, formatNumber, heatLayout, itemsToTable, summarizeItems } from './geometry.js';

/**
 * A row of cells shaded on a five-step scale (for example the ageing buckets 0-1d ... 15+d). The shade is never the only cue:
 * every cell prints its label, its count and its share. With onDrill each cell is a button.
 *
 *   cells  [{ key, label, value }]
 *   total  the denominator for the shares (default: the sum of the cells)
 */
export default function HeatStrip({ title, cells, onDrill, total, unit = '', emptyText = 'Nothing to show.', labelHeader, valueHeader, defaultTable = false }) {
  const list = Array.isArray(cells) ? cells.filter((c) => c && typeof c === 'object') : [];
  const layout = heatLayout(list, { total });
  const summary = `${title ? `${title}. ` : ''}${summarizeItems(list, { unit, total, max: 8 })}`;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      interactive={Boolean(onDrill)}
      defaultTable={defaultTable}
      empty={list.length === 0}
      emptyText={emptyText}
      table={{ ...itemsToTable(list, { unit, total, labelHeader, valueHeader }), caption: title }}
    >
      <ul className="ab-heat">
        {layout.cells.map((cell, i) => {
          const inner = (
            <>
              <span className="ab-heat-label" title={cell.label}>
                {clipLabel(cell.label, 12)}
              </span>
              <span className="ab-heat-value">{formatNumber(cell.value)}</span>
              <span className="ab-heat-share">{layout.total > 0 ? `${cell.share}%` : '-'}</span>
            </>
          );
          return (
            <li key={cell.key}>
              {onDrill ? (
                <button type="button" className={`ab-heat-cell ab-heat-${cell.level}`} aria-label={`${cell.label}: ${formatNumber(cell.value)}${layout.total > 0 ? `, ${cell.share}%` : ''}. Open the list.`} onClick={() => onDrill(list[i])}>
                  {inner}
                </button>
              ) : (
                <div className={`ab-heat-cell ab-heat-${cell.level}`}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}
