import { useEffect } from 'react';
import { Tile, HorizontalBar, Donut, TrendChart, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useReport } from './useReport.js';
import { t, tn } from '../../i18n/index.js';
import { placeholderName, shown, shownList } from '../../reports/shown.js';

/**
 * The request that reads a custom report: the same for the widget and for the editor's Preview, so a Preview of an HR table reads it
 * as the saved widget will (allowSensitive), with the dashboard's "as of" instant (and so from the same cache).
 */
export const builderRequest = (config, env) => ({ kind: 'builder', config, blocked: env.blocked, params: env.widgetParams ? env.widgetParams({}) : {}, ...(env.allowSensitive ? { allowSensitive: true } : {}) });

// A bar's name: the engine's own words ("Others (3)", "(empty)") in the language of the panel, a value from the instance as it is.
const labelOf = (item) => (item.others ? shown(item.label) : placeholderName(item.label));

/** The picture for a builder result, in the chart type the person chose. */
export function BuilderChart({ data, env }) {
  const { config, items, unit } = data;
  const drill = (item) => item?.query && env.openList(data.table, item.query);
  const hasDrill = items.some((i) => i.query);
  const hrefFor = env.listHref ? (item) => (item?.query ? env.listHref(data.table, item.query) : '') : undefined;
  const label = shown(data.groupLabel);
  const table = shown(data.tableLabel);
  const unitText = shown(unit);
  // Averages are not parts of a whole: no shares, no total, no donut.
  const counts = data.metric === 'count';

  if (data.groupBy === 'none') {
    // An average with no ticket to average has no value (0 would be a made-up number).
    if (!items.length) return <p className="ab-hint">{t('No ticket matches this filter, so there is nothing to average.')}</p>;
    const query = items[0]?.query || data.query;
    return <Tile label={table} value={items[0]?.value ?? 0} hint={shownList(data.filter)} onOpen={() => env.openList(data.table, query)} href={env.listHref ? env.listHref(data.table, query) || '' : ''} />;
  }
  if (data.series) {
    const weekly = data.timeUnit === 'week';
    const partialCount = (data.series.partial || []).filter(Boolean).length;
    return (
      <TrendChart
        title={weekly ? t('{table} per week', { table }) : t('{table} per day', { table })}
        series={[{ key: 'v', label: table, tone: 'c1', points: data.series.labels.map((l, i) => ({ label: l, value: data.series.values[i] })) }]}
        area={config.chart !== 'table'}
        unit={unitText}
        labelHeader={label}
        defaultTable={config.chart === 'table'}
        note={partialCount ? (weekly ? tn(partialCount, 'The oldest {n} week are only partly counted (the read stopped early).', 'The oldest {n} weeks are only partly counted (the read stopped early).') : tn(partialCount, 'The oldest {n} day are only partly counted (the read stopped early).', 'The oldest {n} days are only partly counted (the read stopped early).')) : ''}
      />
    );
  }
  const list = items.map((i) => ({ key: i.key || i.label, label: labelOf(i), value: i.value, hint: counts ? undefined : tn(i.n, '{n} ticket', '{n} tickets'), query: i.query }));
  const heading = t('{table} by {groupBy}', { table, groupBy: label.toLowerCase() });
  if (config.chart === 'donut' && counts) {
    return <Donut title={heading} items={list} centerLabel={unitText} onDrill={hasDrill ? drill : undefined} hrefFor={hasDrill ? hrefFor : undefined} labelHeader={label} />;
  }
  if (config.chart === 'table') {
    return (
      <DataTable
        caption={heading}
        columns={[{ key: 'label', label }, { key: 'value', label: counts ? t('Tickets') : t('Days'), align: 'right' }, ...(counts ? [] : [{ key: 'n', label: t('Tickets counted'), align: 'right' }])]}
        rows={items.map((i) => ({ ...i, label: labelOf(i) }))}
      />
    );
  }
  return <HorizontalBar title={heading} items={list} unit={unitText} shares={counts} onDrill={hasDrill ? drill : undefined} hrefFor={hasDrill ? hrefFor : undefined} labelHeader={label} maxItems={12} />;
}

// A custom report on a dashboard: whatever the report builder put together, drawn the way the person chose.
export default function BuilderView({ widget, env, actions }) {
  const request = builderRequest(widget.builder, env);
  const state = useReport({ tabId: env.page.tabId, request, refreshKey: env.refreshKey, limiter: env.limiter });
  const d = state.result?.data;
  const ok = d && d.available !== false;
  // In memory only, next to the sections' results, so "Download all as CSV" includes custom reports ("Explain this dashboard" leaves them out).
  const loaded = env.loaded;
  const wid = widget?.id;
  const result = state.result;
  useEffect(() => {
    if (!loaded || !wid) return undefined;
    if (result) loaded.set(wid, 'builder', result);
    else loaded.remove(wid);
    return undefined;
  }, [loaded, wid, result]);
  useEffect(() => () => loaded?.remove(wid), [loaded, wid]);
  return (
    <SectionShell
      title={shown(state.result?.title) || widget.builder.title || t('Custom report')}
      help={ok ? t('Filter: {filter}.', { filter: shownList(d.filter) }) : ''}
      state={state}
      env={env}
      widgetId={widget.id}
      facts={ok ? [d.basedOn ? shown(d.basedOn) : t('{n} in total', { n: d.total })] : []}
      actions={actions}
    >
      {ok && <BuilderChart data={d} env={env} />}
    </SectionShell>
  );
}
