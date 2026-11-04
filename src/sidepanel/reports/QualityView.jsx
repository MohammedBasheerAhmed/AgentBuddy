import { Tile, TrendChart, HorizontalBar, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';
import { TREND_CHOICES } from '../../reports/engine/quality.js';
import { hours } from './format.js';
import { t, tn } from '../../i18n/index.js';
import { placeholderName, shown } from '../../reports/shown.js';

const pct = (n) => `${Math.round(n * 10) / 10}%`;

/** The quality report for one result (`d` is result.data). */
export function QualityBody({ d }) {
  const trend = d.trend;
  const weekly = trend.unit === 'week';
  const partialCount = trend.partial.filter(Boolean).length;
  const series = [
    { key: 'opened', label: t('Opened'), tone: 'c1', points: trend.labels.map((label, i) => ({ label, value: trend.opened[i] })) },
    ...(trend.resolved ? [{ key: 'resolved', label: t('Resolved'), tone: 'c2', points: trend.labels.map((label, i) => ({ label, value: trend.resolved[i] })) }] : []),
  ];

  return (
    <>
      <div className="ab-tiles">
        {d.opened && <Tile label={t('Opened')} value={d.opened.value} hint={d.opened.partial ? t('Some tables could not be counted') : t('In the last {days} days', { days: d.windowDays })} />}
        {d.resolved && <Tile label={t('Resolved')} value={d.resolved.value} hint={d.resolved.capped ? t('First rows read only') : t('In the last {days} days', { days: d.windowDays })} />}
        {d.mttr && <Tile label={t('Time to resolve')} value={hours(d.mttr.meanHours)} hint={t('Mean. Median {median}, from {tickets}', { median: hours(d.mttr.medianHours), tickets: tn(d.mttr.sample, '{n} ticket', '{n} tickets') })} />}
        {d.reopen && <Tile label={t('Reopen rate')} value={pct(d.reopen.percent)} hint={t('{reopened} of {total} opened', { reopened: d.reopen.reopened, total: d.reopen.of })} tone={d.reopen.percent >= 10 ? 'warn' : 'neutral'} />}
        {d.reassign && <Tile label={t('Reassignments')} value={Math.round(d.reassign.average * 10) / 10} hint={t('Average per ticket. {percent} moved {n}+ times', { percent: pct(d.reassign.multiPercent), n: d.reassign.threshold })} />}
      </div>

      <TrendChart
        title={weekly ? t('Opened and resolved per week') : t('Opened and resolved per day')}
        series={series}
        unit={t('tickets')}
        labelHeader={weekly ? t('Week starting') : t('Day')}
        note={partialCount ? (weekly ? tn(partialCount, 'The oldest {n} week are only partly counted (the read stopped early).', 'The oldest {n} weeks are only partly counted (the read stopped early).') : tn(partialCount, 'The oldest {n} day are only partly counted (the read stopped early).', 'The oldest {n} days are only partly counted (the read stopped early).')) : ''}
      />
      {trend.backlog ? (
        <TrendChart title={t('Open tickets at the end of each period (estimate)')} series={[{ key: 'backlog', label: shown('Open'), tone: 'c3', points: trend.labels.map((label, i) => ({ label, value: trend.backlog[i] })) }]} area unit={t('tickets')} labelHeader={weekly ? t('Week starting') : t('Day')} />
      ) : (
        <p className="ab-hint">{t('The backlog trend needs complete date reads for every table, so it is not shown here.')}</p>
      )}

      {d.categories.length > 0 && <HorizontalBar title={t('Top categories')} items={d.categories.map((c) => ({ key: c.name, label: placeholderName(c.name), value: c.count }))} unit={t('tickets')} labelHeader={t('Category')} maxItems={8} />}
      {d.cis.length > 0 && <HorizontalBar title={t('Top configuration items')} items={d.cis.map((c) => ({ key: c.name, label: placeholderName(c.name), value: c.count, tone: 'c4' }))} unit={t('tickets')} labelHeader={t('Configuration item')} maxItems={8} />}

      {d.repeatCallers &&
        (d.repeatCallers.items.length > 0 ? (
          <DataTable
            caption={t('{table}: callers with {min}+ tickets in {days} days ({total})', { table: shown(d.repeatCallers.table), min: d.repeatCallers.min, days: d.repeatCallers.days, total: d.repeatCallers.total })}
            columns={[{ key: 'name', label: t('Caller') }, { key: 'count', label: t('Tickets'), align: 'right' }]}
            rows={d.repeatCallers.items.map((c) => ({ ...c, name: placeholderName(c.name) }))}
          />
        ) : (
          <p className="ab-hint">{t('No caller has {min} or more tickets in {days} days.', { min: d.repeatCallers.min, days: d.repeatCallers.days })}</p>
        ))}
    </>
  );
}

// F5. How work is going over the last weeks: volume, speed, repeat work and where the work comes from.
export default function QualityView({ widget, env }) {
  const state = useSection('quality', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;
  return (
    <SectionShell
      title={t('Quality and trend')}
      help={t('Opened against resolved, how fast tickets are solved, and what comes back.')}
      state={state}
      env={env}
      widgetId={widget?.id}
      facts={ok ? [shown(d.trend.label)] : []}
      actions={
        <label className="ab-widget-select">
          <span className="ab-chart-sr">{t('Period')}</span>
          <select className="ab-select" value={widget?.params?.trend || 'day-30'} onChange={(e) => env.setWidgetParams(widget, { trend: e.target.value })} disabled={!widget || !env.canEdit}>
            {TREND_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>{shown(c.label)}</option>
            ))}
          </select>
        </label>
      }
    >
      {ok && <QualityBody d={d} env={env} />}
    </SectionShell>
  );
}
