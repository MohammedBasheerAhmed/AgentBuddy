import React from 'react';
import ChartFrame from './ChartFrame.jsx';
import { barLayout, clipLabel, formatNumber, itemsToTable, percent, summarizeItems, toneClass, withUnit } from './geometry.js';
import DrillLink, { hrefOf } from './DrillLink.jsx';

const BAR_HEIGHT = 10;

/**
 * Horizontal bars, one row per item, in the order given. The label and the value are real text above each bar (so they wrap and
 * scale with the page); the bar itself is an SVG whose length is a percentage of the width.
 *
 *   items   [{ key, label, value, tone, hint }]
 *   unit    'incidents', '%', 'h' ...
 *   total   the denominator for the percentages (default: the sum of the items)
 *   onDrill(item)  makes every row a button
 *   hrefFor(item)  with onDrill: the address of the list a row opens; the row is then a real link (see DrillLink.jsx). A row without
 *                  an address is not clickable at all, so nothing looks like it opens something it cannot.
 */
export default function HorizontalBar({ title, items, unit = '', total, onDrill, hrefFor, maxItems = 12, emptyText = 'Nothing to show.', labelHeader, valueHeader, defaultTable = false }) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const layout = barLayout(list, { width: 100, rowHeight: BAR_HEIGHT, maxItems });
  const denominator = Number(total) > 0 ? Number(total) : layout.total;
  const summary = `${title ? `${title}. ` : ''}${summarizeItems(list, { unit, total })}`;

  const rows = layout.rows.map((row, i) => {
    const item = list[i];
    const pct = denominator > 0 ? percent(row.value, denominator) : null;
    const valueText = withUnit(formatNumber(row.value), unit);
    const inner = (
      <>
        <span className="ab-hbar-text">
          <span className="ab-hbar-label" title={row.label}>
            {clipLabel(row.label, 60)}
          </span>
          <span className="ab-hbar-value">
            {valueText}
            {pct !== null ? <span className="ab-hbar-pct"> ({pct}%)</span> : null}
          </span>
        </span>
        {row.hint ? <span className="ab-hbar-hint">{row.hint}</span> : null}
        <svg className={`ab-hbar-svg ${toneClass(row.tone || 'c1')}`} width="100%" height={BAR_HEIGHT} aria-hidden="true" focusable="false">
          <rect className="ab-bar-track" x="0" y="0" width="100%" height={BAR_HEIGHT} rx="3" />
          {row.width > 0 ? <rect className="ab-bar-fill" x="0" y="0" width={`${row.width}%`} height={BAR_HEIGHT} rx="3" /> : null}
        </svg>
      </>
    );
    const name = `${row.label}: ${valueText}${pct !== null ? `, ${pct}%` : ''}. Open the list.`;
    const href = onDrill && hrefFor ? hrefOf(hrefFor, item) : '';
    return (
      <li key={row.key}>
        {href ? (
          <DrillLink className="ab-hbar-row" href={href} onOpen={() => onDrill(item)} label={name}>
            {inner}
          </DrillLink>
        ) : onDrill && !hrefFor ? (
          <button type="button" className="ab-hbar-row" aria-label={name} onClick={() => onDrill(item)}>
            {inner}
          </button>
        ) : (
          <div className="ab-hbar-row">{inner}</div>
        )}
      </li>
    );
  });

  return (
    <ChartFrame
      title={title}
      summary={summary}
      interactive={Boolean(onDrill) && (!hrefFor || list.some((it) => hrefOf(hrefFor, it)))}
      defaultTable={defaultTable}
      empty={list.length === 0}
      emptyText={emptyText}
      table={{ ...itemsToTable(list, { unit, total, labelHeader, valueHeader }), caption: title }}
      note={layout.hidden.count > 0 ? `and ${layout.hidden.count} more (${withUnit(formatNumber(layout.hidden.value), unit)}). Show as table for all rows.` : ''}
    >
      <ul className="ab-hbar">{rows}</ul>
    </ChartFrame>
  );
}
