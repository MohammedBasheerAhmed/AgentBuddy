import { formatNumber } from './geometry.js';
import { isPlainClick, NEW_TAB_HINT } from '../linkClick.js';
import { t } from '../../i18n/index.js';

const cellText = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  // A number that is not a number is a missing value, shown as a dash: never a made-up zero.
  if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value) : '-';
  return String(value);
};

/**
 * A small accessible table: caption, column headers with scope, the first column as the row header.
 * columns: [{ key, label, align: 'left'|'right'|'center', format(value, row) }]. Text is always rendered as text (React escapes it).
 * With onRowOpen the first cell of each row is a button that opens that row. With rowHref(row) as well (the address of the row, or '')
 * it is a real link instead: a click calls onRowOpen, Ctrl+click and the right-click menu open the address in a new tab.
 */
export default function DataTable({ caption, columns, rows, onRowOpen, rowHref, maxRows = 100, emptyText = t('Nothing to show.') }) {
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
                    {onRowOpen && rowHref?.(row) ? (
                      // A real link: a click opens the row in the page's tab (onRowOpen), Ctrl+click and the right-click menu use a new tab.
                      <a
                        className="ab-chart-link"
                        href={rowHref(row)}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-ab-link="record"
                        title={t(NEW_TAB_HINT)}
                        onClick={(event) => {
                          if (!isPlainClick(event)) return;
                          event.preventDefault();
                          onRowOpen(row);
                        }}
                      >
                        {text(c, row)}
                      </a>
                    ) : onRowOpen ? (
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
          {t('Showing the first {shown} of {total} rows.', { shown: formatNumber(shown.length), total: formatNumber(list.length) })}
        </p>
      ) : null}
    </div>
  );
}
