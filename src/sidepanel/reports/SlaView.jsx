import { Tile, StackedBar } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import Foldable from './Foldable.jsx';
import TicketList from './TicketList.jsx';
import { useSection } from './useSection.js';
import { useMinuteClock } from './hooks.js';
import { shownElsewhere } from './onDashboard.js';
import { dueText } from './format.js';
import { showsPersonRows } from '../../reports/engine/common.js';
import { t } from '../../i18n/index.js';
import { placeholderName } from '../../reports/shown.js';

const slaSeries = () => [
  { key: 'breached', label: t('Breached'), tone: 'bad' },
  { key: 'atRisk', label: t('At risk'), tone: 'warn' },
];
// Only owners and groups that hold something breached or at risk (a ticket that is merely due soon has no bar).
const rows = (list) => list.filter((r) => r.breached + r.atRisk > 0).map((r) => ({ key: r.id || r.name, label: placeholderName(r.name), parts: [{ key: 'breached', value: r.breached }, { key: 'atRisk', value: r.atRisk }] }));

/** The facts on a ticket's second line: when its SLA ends (relative), how much is used, who holds it, its priority. */
export const slaFacts = (item, now) => [
  dueText({ endMs: item.endMs, breached: item.breached, paused: item.sla?.paused, plannedEnd: item.sla?.plannedEnd }, now),
  item.breached ? '' : t('{percent}% used', { percent: item.sla?.percentage ?? 0 }),
  placeholderName(item.owner) || t('Unassigned'),
  item.priority,
];

/**
 * The radar for one SLA result (`d` is result.data, with d.available true). `now` is for tests; the panel uses a minute clock. When
 * the dashboard also draws Overview (env.sections), its Breached and Due soon tiles (the same SLA read) are not drawn again here.
 */
export function SlaBody({ d, env, now }) {
  const clock = useMinuteClock();
  const at = Number.isFinite(now) ? now : clock;
  // (one row per person: whether they are shown is decided in one place, showsPersonRows)
  const owners = showsPersonRows({ kind: env.scopeKind }) ? rows(d.byOwner) : [];
  const groups = env.scopeKind !== 'mine' ? rows(d.byGroup) : [];
  const inOverview = shownElsewhere(env, 'overview');
  // A count from an SLA read that stopped early is "at least": 12+ (the sentence under the dashboard says why).
  const count = (n) => (d.atLeast ? `${n}+` : n);
  return (
    <>
      <Foldable id="closest" title={t('Closest to breaking')}>
        <div className="ab-tiles">
          {!inOverview && <Tile label={t('Breached')} value={count(d.counts.breached)} tone={d.counts.breached > 0 ? 'bad' : 'neutral'} hint={t('SLA already breached')} />}
          <Tile label={t('At risk')} value={count(d.counts.atRisk)} tone={d.counts.atRisk > 0 ? 'warn' : 'neutral'} hint={t('{percent}% or more of the time used', { percent: d.atRiskPercent })} />
          {!inOverview && <Tile label={t('Due soon')} value={count(d.counts.dueSoon)} tone={d.counts.dueSoon > 0 ? 'warn' : 'neutral'} hint={t('Ends within {hours} hours', { hours: d.dueSoonHours })} />}
        </div>

        <TicketList
          caption={t('Closest to breaking')}
          items={d.top}
          env={env}
          meta={(item) => slaFacts(item, at)}
          empty={d.ticketsAtIssue ? t('The tickets at issue are listed by number only when ticket details can be read.') : t('No SLA is at risk right now.')}
        />
      </Foldable>

      {(owners.length > 0 || groups.length > 1) && (
        <Foldable id="sla-who" title={t('Who holds the risk')}>
          {owners.length > 0 && <StackedBar title={t('SLA risk by owner')} rows={owners} series={slaSeries()} labelHeader={t('Owner')} />}
          {groups.length > 1 && <StackedBar title={t('SLA risk by group')} rows={groups} series={slaSeries()} labelHeader={t('Group')} />}
        </Foldable>
      )}
    </>
  );
}

// F3. Which tickets are about to break or have broken their SLA, and who holds them.
export default function SlaView({ widget, env, tools }) {
  const state = useSection('sla', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;
  return (
    <SectionShell
      title={t('SLA risk radar')}
      help={t('SLAs that are breached, nearly used up, or due soon.')}
      state={state}
      env={env}
      widgetId={widget?.id}
      tools={tools}
      facts={ok ? [t('{n} tickets at issue out of {total} active SLAs', { n: d.ticketsAtIssue, total: d.activeSlas })] : []}
    >
      {ok && <SlaBody d={d} env={env} />}
    </SectionShell>
  );
}
