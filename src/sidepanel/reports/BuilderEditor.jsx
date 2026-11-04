import React, { useState } from 'react';
import { FILTER_PRESETS } from '../../reports/engine/queryBuilder.js';
import { GROUP_BY, METRICS, CHARTS, normalizeBuilderConfig } from '../../reports/engine/builder.js';
import { REPORT_TABLES } from '../../reports/engine/constants.js';
import { BuilderChart, builderRequest } from './BuilderView.jsx';
import { useReport } from './useReport.js';
import ErrorNote from '../ErrorNote.jsx';
import { t } from '../../i18n/index.js';
import { shown, shownList } from '../../reports/shown.js';

const WINDOW = ['last_7', 'last_30', 'last_90'];

// The same request the saved widget will send: an HR table previews as it will show (allowSensitive), with the dashboard's params.
function Preview({ config, env }) {
  const state = useReport({ tabId: env.page.tabId, request: builderRequest(config, env), refreshKey: env.refreshKey });
  const d = state.result?.data;
  if (state.phase === 'error') return <ErrorNote error={shown(state.error)} onRetry={state.reload} />;
  if (!d) return <p className="ab-note" role="status">{t('Reading the numbers…')}</p>;
  if (d.available === false) return <p className="ab-note ab-note-warn">{shown(d.reason)}</p>;
  return (
    <div aria-busy={state.busy}>
      <BuilderChart data={d} env={env} />
      <p className="ab-widget-foot">{[shownList(d.filter), d.basedOn ? shown(d.basedOn) : t('{n} in total', { n: d.total })].join(' · ')}</p>
    </div>
  );
}

// The report builder: a table, a few filters from a fixed list, one grouping, one measure and a chart type. There is no free
// text query; every choice is a name from a list, turned into a safe query by the engine.
export default function BuilderEditor({ initial, env, usableTables, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => normalizeBuilderConfig(initial || { table: usableTables[0] || 'incident' }));
  // The configuration the Preview reads (named apart from shown(), the panel's words, which this view also draws with).
  const [previewed, setPreviewed] = useState(null);
  const group = GROUP_BY.find((g) => g.id === draft.groupBy);
  const timeGroup = Boolean(group?.time);

  const change = (patch) => setDraft((d) => normalizeBuilderConfig({ ...d, ...patch }));
  const togglePreset = (id) => {
    const has = draft.presets.includes(id);
    change({ presets: has ? draft.presets.filter((p) => p !== id) : [...draft.presets, id] });
  };
  const windowValue = WINDOW.find((w) => draft.presets.includes(w)) || '';
  const setWindow = (value) => change({ presets: [...draft.presets.filter((p) => !WINDOW.includes(p)), ...(value ? [value] : [])] });

  const tableChoices = usableTables.length ? usableTables : [draft.table];

  return (
    <section className="ab-card ab-widget ab-builder" aria-label={t('Report builder')}>
      <div className="ab-widget-head">
        <h2 className="ab-h">{initial ? t('Edit custom report') : t('New custom report')}</h2>
      </div>
      <p className="ab-sub">{t('Pick a table, filter it, group it and choose how to draw it. Nothing is typed into a query.')}</p>

      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-b-title">{t('Title (optional)')}</label>
        <input id="ab-b-title" className="ab-input" maxLength={60} value={draft.title} onChange={(e) => change({ title: e.target.value })} placeholder={t('For example: Open by priority')} />
      </div>

      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-b-table">{t('Table')}</label>
        <select id="ab-b-table" className="ab-select" value={draft.table} onChange={(e) => change({ table: e.target.value })}>
          {tableChoices.map((id) => (
            <option key={id} value={id}>{REPORT_TABLES[id] ? shown(REPORT_TABLES[id].label) : id}</option>
          ))}
        </select>
        {!usableTables.length && <span className="ab-hint">{t('No ticket table is available to you.')}</span>}
      </div>

      <fieldset className="ab-field ab-fieldset">
        <legend className="ab-label">{t('Filter')}</legend>
        {FILTER_PRESETS.filter((p) => !p.exclusive).map((p) => (
          <label key={p.id} className="ab-check">
            <input type="checkbox" checked={draft.presets.includes(p.id)} onChange={() => togglePreset(p.id)} />
            <span>{shown(p.label)}</span>
          </label>
        ))}
        <label className="ab-label" htmlFor="ab-b-window">{t('Opened')}</label>
        <select id="ab-b-window" className="ab-select" value={windowValue} onChange={(e) => setWindow(e.target.value)}>
          <option value="">{t('At any time')}</option>
          {FILTER_PRESETS.filter((p) => p.exclusive).map((p) => (
            <option key={p.id} value={p.id}>{t('In the last {days} days', { days: Number(p.id.split('_')[1]) })}</option>
          ))}
        </select>
      </fieldset>

      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-b-group">{t('Group by')}</label>
        <select id="ab-b-group" className="ab-select" value={draft.groupBy} onChange={(e) => change({ groupBy: e.target.value })}>
          {GROUP_BY.map((g) => (
            <option key={g.id} value={g.id}>{shown(g.label)}</option>
          ))}
        </select>
      </div>

      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-b-metric">{t('Measure')}</label>
        <select id="ab-b-metric" className="ab-select" value={draft.metric} onChange={(e) => change({ metric: e.target.value })}>
          {METRICS.map((m) => (
            <option key={m.id} value={m.id} disabled={timeGroup && m.id !== 'count'}>{shown(m.label)}</option>
          ))}
        </select>
        {draft.metric !== 'count' && <span className="ab-hint">{t('Averages are worked out from up to 3000 tickets read here; the report says how many.')}</span>}
      </div>

      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-b-chart">{t('Chart')}</label>
        <select id="ab-b-chart" className="ab-select" value={draft.chart} onChange={(e) => change({ chart: e.target.value })}>
          {CHARTS.map((c) => (
            <option key={c.id} value={c.id} disabled={(c.id === 'line' && !timeGroup) || (c.id === 'donut' && (timeGroup || draft.metric !== 'count'))}>{shown(c.label)}</option>
          ))}
        </select>
      </div>

      <div className="ab-row">
        <button type="button" className="ab-btn" onClick={() => setPreviewed(draft)}>{t('Preview')}</button>
        <button type="button" className="ab-btn ab-btn-primary" onClick={() => onSave(draft)}>{initial ? t('Save changes') : t('Add to dashboard')}</button>
        <button type="button" className="ab-btn ab-btn-quiet" onClick={onCancel}>{t('Cancel')}</button>
      </div>

      {previewed && <Preview config={previewed} env={env} />}
    </section>
  );
}
