import React, { useId, useState } from 'react';
import DataTable from './DataTable.jsx';
import { patternFor, toneClass } from './geometry.js';
import { t } from '../../i18n/index.js';

/** An id that is safe inside url(#...) and unique per chart instance (React's useId has colons in it). */
export function useUid(prefix = 'abc-') {
  return `${prefix}${String(useId()).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export const patternId = (uid, index) => `${uid}-p${index}`;

/**
 * The fill patterns for a chart's series, defined once and referenced as fill="url(#...)". Each index has its own pattern, so the
 * series differ by more than colour. Rendered in a 0 x 0 SVG (not display:none, which some browsers treat as "no pattern").
 * tones: one tone per series, in order.
 */
export function PatternDefs({ uid, tones }) {
  return (
    <svg className="ab-chart-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {tones.map((tone, i) => {
          const p = patternFor(i);
          return (
            <pattern key={patternId(uid, i)} id={patternId(uid, i)} className={toneClass(tone)} width="8" height="8" patternUnits="userSpaceOnUse">
              <rect className="ab-pat-bg" width="8" height="8" />
              {p.lines ? <path className="ab-pat-line" d={p.lines} /> : null}
              {p.dot ? <circle className="ab-pat-dot" cx="4" cy="4" r="1.4" /> : null}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

/** A small square of a series' pattern, for legends. */
export function Swatch({ uid, index, tone }) {
  return (
    <svg className={`ab-swatch ${toneClass(tone)}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect className="ab-swatch-box" x="0.5" y="0.5" width="13" height="13" rx="2" fill={`url(#${patternId(uid, index)})`} />
    </svg>
  );
}

/**
 * The wrapper every chart uses: a heading, a "Show as table" toggle, and the picture.
 *
 * The picture is exposed as one image with a text summary (role="img" + aria-label). When the chart is interactive
 * (`interactive`: it has buttons you can press to drill down) an image role would hide those buttons from assistive
 * technology, so the wrapper is a labelled group instead and the buttons carry their own names.
 *
 *   title        heading text
 *   summary      the numbers in words (build it with the summarize* helpers in geometry.js)
 *   table        { columns, rows, caption }: the same data as a table; gives the toggle
 *   legend       shown under the picture, outside the image (so it may hold buttons)
 *   actions      extra buttons next to the toggle
 *   empty        true shows emptyText instead of the picture
 */
export default function ChartFrame({ title, summary, table, children, legend, actions, note, interactive = false, defaultTable = false, empty = false, emptyText = t('Nothing to show.') }) {
  const [showTable, setShowTable] = useState(Boolean(defaultTable));
  const canTable = Boolean(table && Array.isArray(table.rows) && table.rows.length && !empty);
  const tableOn = canTable && showTable;
  const label = String(summary || title || t('Chart'));

  return (
    <div className="ab-chart">
      {title || canTable || actions ? (
        <div className="ab-chart-head">
          {title ? <h3 className="ab-chart-title">{title}</h3> : <span />}
          <div className="ab-chart-actions">
            {actions}
            {canTable ? (
              <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-chart-toggle" aria-pressed={tableOn} onClick={() => setShowTable((v) => !v)}>
                {t('Show as table')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {empty ? (
        <p className="ab-chart-empty">{emptyText}</p>
      ) : tableOn ? (
        <DataTable caption={table.caption || title} columns={table.columns} rows={table.rows} emptyText={emptyText} />
      ) : (
        <>
          <div className="ab-chart-visual" role={interactive ? 'group' : 'img'} aria-label={label}>
            {children}
          </div>
          {legend}
          {note ? <p className="ab-chart-note">{note}</p> : null}
        </>
      )}
    </div>
  );
}
