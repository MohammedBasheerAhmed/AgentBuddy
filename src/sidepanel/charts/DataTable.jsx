import React from 'react';
import { formatNumber } from './geometry.js';

const cellText = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  // A number that is not a number is a missing value, shown as a dash: never a made-up zero.
  if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value) : '-';
  return String(value);
};

/**
 * A small accessible table: caption, column headers with scope, the first column as the row header.
 * columns: [{ key, label, align: 'left'|'right'|'center', format(value, row) }]. Text is always rendered as text (React escapes it).
 * With onRowOpen the first cell of each row is a button that opens that row.
 */
export default function DataTable({ caption, columns, rows, onRowOpen, maxRows = 100, emptyText = 'Nothing to show.' }) {
  const cols = (Array.isArray(columns) ? columns : []).filter((c) => c && c.key !== undefined);
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  if (!cols.length || !list.length) return <p className="ab-chart-empty">{emptyText}</p>;
  const cap = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 100;
  const shown = list.slice(0, cap);
  const alignClass = (c) => (c.align === 'right' || c.align === 'center' ? `ab-chart-align-${c.align}` : undefined);
  const text = (c, row) => {
    const value = row[c.key];
    return typeof c.format === 'function' ? String(c.format(value, row) ?? '') || '-' : cellText(value);
  };

  return (
    <div className="ab-chart-table-wrap">
      <table className="ab-table ab-chart-table" role="table">
        {caption ? <caption>{caption}</caption> : null}
        <thead role="rowgroup">
          <tr role="row">
            {cols.map((c) => (
              <th key={c.key} scope="col" role="columnheader" className={alignClass(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {shown.map((row, ri) => (
            <tr role="row" key={typeof row.key === 'string' || typeof row.key === 'number' ? row.key : ri}>
              {cols.map((c, ci) =>
                ci === 0 ? (
                  <th key={c.key} scope="row" role="rowheader" data-label={c.label} className={alignClass(c)}>
                    {onRowOpen ? (
                      <button type="button" className="ab-chart-link" onClick={() => onRowOpen(row)}>
                        {text(c, row)}
                      </button>
                    ) : (
                      text(c, row)
                    )}
                  </th>
                ) : (
                  <td key={c.key} role="cell" data-label={c.label} className={alignClass(c)}>
                    {text(c, row)}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > shown.length ? (
        <p className="ab-chart-note">
          Showing the first {formatNumber(shown.length)} of {formatNumber(list.length)} rows.
        </p>
      ) : null}
    </div>
  );
}
