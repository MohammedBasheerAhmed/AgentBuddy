import ChartFrame from './ChartFrame.jsx';
import { markerIsLine, markerPath, seriesToTable, summarizeSeries, toneClass, toneForIndex, trendLayout } from './geometry.js';
import { useWidth } from './useWidth.js';
import { t } from '../../i18n/index.js';

const HEIGHT = 170;

// A series is told apart by its marker shape and its dash style as well as its colour.
const dashClass = (index) => `ab-line-s${index % 3}`;

function Marker({ shape, x, y, r }) {
  return <path className={`ab-marker${markerIsLine(shape) ? ' ab-marker-line' : ''}`} d={markerPath(shape, x, y, r)} />;
}

function LineSample({ index, shape }) {
  return (
    <svg className="ab-line-sample" width="30" height="14" viewBox="0 0 30 14" aria-hidden="true" focusable="false">
      <path className={`ab-line ${dashClass(index)}`} d="M2 7H28" />
      <Marker shape={shape} x={15} y={7} r={3.5} />
    </svg>
  );
}

/**
 * Lines (or areas) over time. The y axis starts at 0 and has three ticks. Each series gets its own marker shape and dash style,
 * and its first, last and highest values are written on the chart. The layout is built for the measured width, so text keeps
 * its real size at 320px.
 *
 *   series  [{ key, label, tone, points: [{ label, value }] }]
 *   area    fill under the lines
 */
export default function TrendChart({ title, series, area = false, unit = '', emptyText = t('Nothing to show.'), labelHeader, defaultTable = false, note = '' }) {
  const [ref, width] = useWidth();
  const list = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object').map((s, i) => ({ ...s, tone: s.tone || toneForIndex(i) }));
  const L = trendLayout(list, { width, height: HEIGHT, area });
  const { x0, x1, y0, y1 } = L.plot;
  const summary = `${title ? `${title}. ` : ''}${summarizeSeries(list, { unit })}`;

  const legend = (
    <ul className="ab-legend">
      {L.series.map((s) => (
        <li key={s.key} className={toneClass(s.tone)}>
          <LineSample index={s.seriesIndex} shape={s.marker} />
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <ChartFrame title={title} summary={summary} note={note} defaultTable={defaultTable} empty={L.length === 0} emptyText={emptyText} legend={legend} table={{ ...seriesToTable(list, { labelHeader }), caption: title }}>
      <div ref={ref} className="ab-trend">
        <svg className="ab-trend-svg" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} aria-hidden="true" focusable="false">
          {L.ticks.map((tick) => (
            <g key={tick.value}>
              <line className="ab-chart-gridline" x1={x0} x2={x1} y1={tick.y} y2={tick.y} />
              <text className="ab-chart-tick" x={x0 - 6} y={tick.y} dy="0.35em" textAnchor="end">
                {tick.label}
              </text>
            </g>
          ))}
          <line className="ab-chart-axisline" x1={x0} x2={x1} y1={y1} y2={y1} />
          <line className="ab-chart-axisline" x1={x0} x2={x0} y1={y0} y2={y1} />
          {L.xLabels.map((l) => (
            <text key={l.index} className="ab-chart-tick" x={l.x} y={y1 + 16} textAnchor={l.anchor}>
              {l.label}
            </text>
          ))}
          {L.series.map((s) => (
            <g key={s.key} className={toneClass(s.tone)}>
              {s.area ? <path className="ab-area" d={s.area} /> : null}
              {s.line ? <path className={`ab-line ${dashClass(s.seriesIndex)}`} d={s.line} /> : null}
              {/* Few points: every one gets its marker. Many points: only the labelled ones, so the line stays readable. */}
              {(s.points.length <= 14 ? s.points : s.marks.map((m) => s.points[m.index])).map((p) => (
                <Marker key={p.index} shape={s.marker} x={p.x} y={p.y} r={3.5} />
              ))}
              {s.marks.map((m) => (
                <text key={m.index} className="ab-point-label" x={m.x} y={m.above ? m.y - 8 : m.y + 15} textAnchor={m.anchor}>
                  {m.text}
                </text>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </ChartFrame>
  );
}
