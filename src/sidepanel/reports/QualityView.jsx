import { Tile, TrendChart, HorizontalBar, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';
import { TREND_CHOICES } from '../../reports/engine/quality.js';
import { hours, plural } from './format.js';

const pct = (n) => `${Math.round(n * 10) / 10}%`;

// F5. How work is going over the last weeks: volume, speed, repeat work and where the work comes from.
export default function QualityView({ widget, env }) {
  const state = useSection('quality', widget, env);
  const d = state.result?.data;
  const trendId = d?.trend?.id;
  const t = d?.trend;
  const partialCount = t ? t.partial.filter(Boolean).length : 0;

  const series = t
    ? [
        { key: 'opened', label: 'Opened', tone: 'c1', points: t.labels.map((label, i) => ({ label, value: t.opened[i] })) },
        ...(t.resolved ? [{ key: 'resolved', label: 'Resolved', tone: 'c2', points: t.labels.map((label, i) => ({ label, value: t.resolved[i] })) }] : []),
      ]
    : [];

  return (
    <SectionShell
      title="Quality and trend"
      help="Opened against resolved, how fast tickets are solved, and what comes back."
      state={state}
      env={env}
      widgetId={widget?.id}
      facts={d ? [`${t.label}`] : []}
      actions={
        <label className="ab-widget-select">
          <span className="ab-chart-sr">Period</span>
          <select className="ab-select" value={trendId || 'day-30'} onChange={(e) => env.setWidgetParams(widget, { trend: e.target.value })} disabled={!widget || !env.canEdit}>
            {TREND_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      }
    >
      {d && (
        <>
          <div className="ab-tiles">
            {d.opened && <Tile label="Opened" value={d.opened.value} hint={`In the last ${d.windowDays} days`} />}
            {d.resolved && <Tile label="Resolved" value={d.resolved.value} hint={d.resolved.capped ? 'First rows read only' : `In the last ${d.windowDays} days`} />}
            {d.mttr && <Tile label="Time to resolve" value={hours(d.mttr.meanHours)} hint={`Mean. Median ${hours(d.mttr.medianHours)}, from ${plural(d.mttr.sample, 'ticket')}`} />}
            {d.reopen && <Tile label="Reopen rate" value={pct(d.reopen.percent)} hint={`${d.reopen.reopened} of ${d.reopen.of} opened`} tone={d.reopen.percent >= 10 ? 'warn' : 'neutral'} />}
            {d.reassign && <Tile label="Reassignments" value={Math.round(d.reassign.average * 10) / 10} hint={`Average per ticket. ${pct(d.reassign.multiPercent)} moved ${d.reassign.threshold}+ times`} />}
          </div>

          <TrendChart title={`Opened and resolved per ${t.unit}`} series={series} area={false} unit="tickets" note={partialCount ? `The oldest ${plural(partialCount, t.unit)} are only partly counted (the read stopped early).` : ''} defaultTable={false} />
          {t.backlog ? (
            <TrendChart title="Open tickets at the end of each period (estimate)" series={[{ key: 'backlog', label: 'Open', tone: 'c3', points: t.labels.map((label, i) => ({ label, value: t.backlog[i] })) }]} area unit="tickets" />
          ) : (
            <p className="ab-hint">The backlog trend needs complete date reads for every table, so it is not shown here.</p>
          )}

          {d.categories.length > 0 && <HorizontalBar title="Top categories" items={d.categories.map((c) => ({ key: c.name, label: c.name, value: c.count }))} unit="tickets" labelHeader="Category" maxItems={8} />}
          {d.cis.length > 0 && <HorizontalBar title="Top configuration items" items={d.cis.map((c) => ({ key: c.name, label: c.name, value: c.count, tone: 'c4' }))} unit="tickets" labelHeader="Configuration item" maxItems={8} />}

          {d.repeatCallers && (
            <>
              {d.repeatCallers.items.length > 0 ? (
                <DataTable
                  caption={`${d.repeatCallers.table}: callers with ${d.repeatCallers.min}+ tickets in ${d.repeatCallers.days} days (${d.repeatCallers.total} of ${d.repeatCallers.callers} callers)`}
                  columns={[{ key: 'name', label: 'Caller' }, { key: 'count', label: 'Tickets', align: 'right' }]}
                  rows={d.repeatCallers.items}
                />
              ) : (
                <p className="ab-hint">No caller has {d.repeatCallers.min} or more tickets in {d.repeatCallers.days} days ({d.repeatCallers.callers} callers).</p>
              )}
            </>
          )}
        </>
      )}
    </SectionShell>
  );
}
