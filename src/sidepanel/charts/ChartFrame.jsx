import { createContext, useContext, useEffect, useId, useState } from 'react';
import DataTable from './DataTable.jsx';
import { fillPatterns, toneClass } from './geometry.js';
import { t } from '../../i18n/index.js';

/** An id that is safe inside url(#...) and unique per chart instance (React's useId has colons in it). */
export function useUid(prefix = 'abc-') {
  return `${prefix}${String(useId()).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export const patternId = (uid, index) => `${uid}-p${index}`;

/**
 * "Show as tables" for every chart of one dashboard section at once (src/sidepanel/reports/SectionShell.jsx provides it, from the
 * section's "⋯" menu): { on, register() -> unregister }. Inside it a chart draws no toggle of its own; on its own (no provider) a
 * chart keeps its "Show as table" button.
 */
export const ChartTables = createContext(null);

/**
 * The fill patterns for a chart's series, defined once and referenced as fill="url(#...)". A series is solid unless another series
 * of the same chart could be mistaken for it by colour (fillPatterns in geometry.js); then it has a texture as well, so the series
 * differ by more than colour. Rendered in a 0 x 0 SVG (not display:none, which some browsers treat as "no pattern").
 * tones: one tone per series, in order.
 */
export function PatternDefs({ uid, tones }) {
  const fills = fillPatterns(tones);
  return (
    <svg className="ab-chart-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {tones.map((tone, i) => {
          const p = fills[i];
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
  const shared = useContext(ChartTables);
  const canTable = Boolean(table && Array.isArray(table.rows) && table.rows.length && !empty);
  const register = shared?.register;
  // A chart that can be a table tells its section, which then offers "Show as tables" in its menu.
  useEffect(() => (canTable && register ? register() : undefined), [canTable, register]);
  const tableOn = canTable && (shared ? Boolean(defaultTable) || Boolean(shared.on) : showTable);
  const ownToggle = canTable && !shared;
  const label = String(summary || title || t('Chart'));

  return (
    <div className="ab-chart">
      {title || ownToggle || actions ? (
        <div className="ab-chart-head">
          {title ? <h3 className="ab-chart-title">{title}</h3> : <span />}
          <div className="ab-chart-actions">
            {actions}
            {ownToggle ? (
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
