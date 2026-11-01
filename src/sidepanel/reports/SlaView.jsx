import React from 'react';
import { Tile, StackedBar } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import TicketList from './TicketList.jsx';
import { useSection } from './useSection.js';
import { useMinuteClock } from './hooks.js';
import { dueText } from './format.js';

const SERIES = [
  { key: 'breached', label: 'Breached', tone: 'bad' },
  { key: 'atRisk', label: 'At risk', tone: 'warn' },
];
// Only owners and groups that hold something breached or at risk (a ticket that is merely due soon has no bar).
const rows = (list) => list.filter((r) => r.breached + r.atRisk > 0).map((r) => ({ key: r.id || r.name, label: r.name, parts: [{ key: 'breached', value: r.breached }, { key: 'atRisk', value: r.atRisk }] }));

/** The facts on a ticket's second line: when its SLA ends (relative), how much is used, who holds it, its priority. */
export const slaFacts = (t, now) => [
  dueText({ endMs: t.endMs, breached: t.breached, paused: t.sla?.paused, plannedEnd: t.sla?.plannedEnd }, now),
  t.breached ? '' : `${t.sla?.percentage ?? 0}% used`,
  t.owner || 'Unassigned',
  t.priority,
];

/** The radar for one SLA result (`d` is result.data, with d.available true). `now` is for tests; the panel uses a minute clock. */
export function SlaBody({ d, env, now }) {
  const clock = useMinuteClock();
  const at = Number.isFinite(now) ? now : clock;
  const owners = env.scopeKind !== 'mine' ? rows(d.byOwner) : [];
  const groups = env.scopeKind !== 'mine' ? rows(d.byGroup) : [];
  return (
    <>
      <div className="ab-tiles">
        <Tile label="Breached" value={d.counts.breached} tone={d.counts.breached > 0 ? 'bad' : 'neutral'} hint="SLA already breached" />
        <Tile label="At risk" value={d.counts.atRisk} tone={d.counts.atRisk > 0 ? 'warn' : 'neutral'} hint={`${d.atRiskPercent}% or more of the time used`} />
        <Tile label="Due soon" value={d.counts.dueSoon} tone={d.counts.dueSoon > 0 ? 'warn' : 'neutral'} hint={`Ends within ${d.dueSoonHours} hours`} />
      </div>

      <TicketList
        caption="Closest to breaking"
        items={d.top}
        env={env}
        meta={(t) => slaFacts(t, at)}
        empty={d.ticketsAtIssue ? 'The tickets at issue are listed by number only when ticket details can be read.' : 'No SLA is at risk right now.'}
      />

      {(owners.length > 0 || groups.length > 1) && (
        <details className="ab-details">
          <summary>Who holds the risk</summary>
          {owners.length > 0 && <StackedBar title="SLA risk by owner" rows={owners} series={SERIES} labelHeader="Owner" />}
          {groups.length > 1 && <StackedBar title="SLA risk by group" rows={groups} series={SERIES} labelHeader="Group" />}
        </details>
      )}
    </>
  );
}

// F3. Which tickets are about to break or have broken their SLA, and who holds them.
export default function SlaView({ widget, env }) {
  const state = useSection('sla', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;
  return (
    <SectionShell
      title="SLA risk radar"
      help="SLAs that are breached, nearly used up, or due soon."
      state={state}
      env={env}
      widgetId={widget?.id}
      facts={ok ? [`${d.ticketsAtIssue} tickets at issue out of ${d.activeSlas} active SLAs`] : []}
    >
      {ok && <SlaBody d={d} env={env} />}
    </SectionShell>
  );
}
