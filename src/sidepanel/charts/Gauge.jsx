import React from 'react';
import ChartFrame from './ChartFrame.jsx';
import { clipLabel, formatNumber, gaugeArc, gaugeTone, niceMax, num, summarizeGauge, toneClass, withUnit } from './geometry.js';
import { t } from '../../i18n/index.js';

const statusOf = (tone) => ({ good: t('Good'), warn: t('Warning'), bad: t('Bad') })[tone];

const text = (n) => formatNumber(n, { decimals: Number.isInteger(n) ? 0 : 1 });

/**
 * A semicircle gauge: the number in the middle, the scale ends under the arc, a tick for each threshold. The state is also
 * written out ("Warning, from 70"), so it never depends on colour.
 *
 *   value, max, unit      max defaults to 100 for a %, else a round number above the value
 *   thresholds            { warn, bad }
 *   higherIsWorse         true (default): a backlog or an age is bad when high. false: a compliance rate is bad when low.
 */
export default function Gauge({ title, label = '', value, max, unit = '', thresholds, higherIsWorse = true, emptyText = t('Nothing to show.'), defaultTable = false }) {
  const v = num(value);
  const top = num(max) || (unit === '%' ? 100 : niceMax(v, { integer: false }));
  const tone = gaugeTone(v, thresholds, higherIsWorse);
  const g = gaugeArc(v, top, { radius: 80, thickness: 16, thresholds });
  const name = label || title || '';
  const summary = `${title && label && title !== label ? `${title}. ` : ''}${summarizeGauge({ label: name, value: v, max: top, unit, tone })}`;
  const valueText = withUnit(text(v), unit);

  const bits = [];
  if (statusOf(tone)) {
    const when = (n) => (higherIsWorse ? t('at {value} or above', { value: text(n) }) : t('at {value} or below', { value: text(n) }));
    const line = [];
    if (Number.isFinite(thresholds?.warn)) line.push(t('warning {when}', { when: when(thresholds.warn) }));
    if (Number.isFinite(thresholds?.bad)) line.push(t('bad {when}', { when: when(thresholds.bad) }));
    bits.push(line.length ? t('Status: {status} ({details}).', { status: statusOf(tone), details: line.join(t(', ')) }) : t('Status: {status}.', { status: statusOf(tone) }));
  }

  return (
    <ChartFrame
      title={title}
      summary={summary}
      defaultTable={defaultTable}
      emptyText={emptyText}
      note={bits.join(' ')}
      table={{
        caption: title || name,
        columns: [
          { key: 'label', label: t('Measure') },
          { key: 'value', label: t('Value'), align: 'right' },
          { key: 'max', label: t('Scale'), align: 'right' },
          { key: 'status', label: t('Status') },
        ],
        rows: [{ key: 'gauge', label: name || t('Value'), value: valueText, max: withUnit(text(top), unit), status: statusOf(tone) || '-' }],
      }}
    >
      <div className="ab-gauge">
        <svg className="ab-gauge-svg" viewBox={`0 0 ${g.width} ${g.height}`} width="100%" aria-hidden="true" focusable="false">
          <path className="ab-gauge-track" d={g.track} />
          {g.fill ? (
            <g className={toneClass(tone)}>
              <path className="ab-gauge-fill" d={g.fill} />
            </g>
          ) : null}
          {g.ticks.map((tick) => (
            <g key={tick.name}>
              <line className="ab-gauge-tick" x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
              <text className="ab-gauge-end" x={tick.lx} y={tick.ly} textAnchor="middle" dy="0.35em">
                {text(tick.value)}
              </text>
            </g>
          ))}
          <text className="ab-gauge-end" x={g.left.x} y={g.cy + 14} textAnchor="middle">
            0
          </text>
          <text className="ab-gauge-end" x={g.right.x} y={g.cy + 14} textAnchor="middle">
            {withUnit(text(top), unit)}
          </text>
          <text className="ab-gauge-value" x={g.cx} y={g.cy - 14} textAnchor="middle">
            {valueText}
          </text>
          {name ? (
            <text className="ab-gauge-label" x={g.cx} y={g.cy + 4} textAnchor="middle">
              {clipLabel(name, 20)}
            </text>
          ) : null}
        </svg>
      </div>
    </ChartFrame>
  );
}
