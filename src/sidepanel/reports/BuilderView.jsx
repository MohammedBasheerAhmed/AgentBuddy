import React, { useEffect } from 'react';
import { Tile, HorizontalBar, Donut, TrendChart, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useReport } from './useReport.js';

/** The picture for a builder result, in the chart type the person chose. */
export function BuilderChart({ data, env }) {
  const { config, items, unit } = data;
  const drill = (item) => item?.query && env.openList(data.table, item.query);
  const hasDrill = items.some((i) => i.query);
  const hrefFor = env.listHref ? (item) => (item?.query ? env.listHref(data.table, item.query) : '') : undefined;
  const label = data.groupLabel;

  if (data.groupBy === 'none') {
    const query = items[0]?.query || data.query;
    return <Tile label={data.tableLabel} value={items[0]?.value ?? 0} hint={data.filter} onOpen={() => env.openList(data.table, query)} href={env.listHref ? env.listHref(data.table, query) || '' : ''} />;
  }
  if (data.series) {
    return (
      <TrendChart
        title={`${data.tableLabel} per ${data.timeUnit}`}
        series={[{ key: 'v', label: data.tableLabel, tone: 'c1', points: data.series.labels.map((l, i) => ({ label: l, value: data.series.values[i] })) }]}
        area={config.chart !== 'table'}
        unit={unit}
        labelHeader={label}
        defaultTable={config.chart === 'table'}
      />
    );
  }
  const list = items.map((i) => ({ key: i.key || i.label, label: i.label, value: i.value, hint: data.metric !== 'count' ? `${i.n} tickets` : undefined, query: i.query }));
  if (config.chart === 'donut') {
    return <Donut title={`${data.tableLabel} by ${label.toLowerCase()}`} items={list} centerLabel={unit} onDrill={hasDrill ? drill : undefined} hrefFor={hasDrill ? hrefFor : undefined} labelHeader={label} />;
  }
  if (config.chart === 'table') {
    return (
      <DataTable
        caption={`${data.tableLabel} by ${label.toLowerCase()}`}
        columns={[{ key: 'label', label }, { key: 'value', label: data.metric === 'count' ? 'Tickets' : 'Days', align: 'right' }, ...(data.metric === 'count' ? [] : [{ key: 'n', label: 'Tickets counted', align: 'right' }])]}
        rows={items}
      />
    );
  }
  return <HorizontalBar title={`${data.tableLabel} by ${label.toLowerCase()}`} items={list} unit={unit} onDrill={hasDrill ? drill : undefined} hrefFor={hasDrill ? hrefFor : undefined} labelHeader={label} maxItems={12} />;
}

// A custom report on a dashboard: whatever the report builder put together, drawn the way the person chose.
export default function BuilderView({ widget, env, actions }) {
  const request = { kind: 'builder', config: widget.builder, blocked: env.blocked, params: env.widgetParams ? env.widgetParams({}) : {} };
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
      title={state.result?.title || widget.builder.title || 'Custom report'}
      help={ok ? `Filter: ${d.filter}.` : ''}
      state={state}
      env={env}
      widgetId={widget.id}
      facts={ok ? [d.basedOn || `${d.total} in total`] : []}
      actions={actions}
    >
      {ok && <BuilderChart data={d} env={env} />}
    </SectionShell>
  );
}
