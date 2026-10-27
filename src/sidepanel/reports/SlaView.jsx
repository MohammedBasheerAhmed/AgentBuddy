import React from 'react';
import { Tile, StackedBar, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';

const SERIES = [
  { key: 'breached', label: 'Breached', tone: 'bad' },
  { key: 'atRisk', label: 'At risk', tone: 'warn' },
];
// Only owners and groups that hold something breached or at risk (a ticket that is merely due soon has no bar).
const rows = (list) => list.filter((r) => r.breached + r.atRisk > 0).map((r) => ({ key: r.id || r.name, label: r.name, parts: [{ key: 'breached', value: r.breached }, { key: 'atRisk', value: r.atRisk }] }));

/** The radar for one SLA result (`d` is result.data, with d.available true). */
export function SlaBody({ d, env }) {
  return (
    <>
      <div className="ab-tiles">
        <Tile label="Breached" value={d.counts.breached} tone={d.counts.breached > 0 ? 'bad' : 'neutral'} hint="SLA already breached" />
        <Tile label="At risk" value={d.counts.atRisk} tone={d.counts.atRisk > 0 ? 'warn' : 'neutral'} hint={`${d.atRiskPercent}% or more of the time used`} />
        <Tile label="Due soon" value={d.counts.dueSoon} tone={d.counts.dueSoon > 0 ? 'warn' : 'neutral'} hint={`Ends within ${d.dueSoonHours} hours`} />
      </div>

      {d.top.length > 0 ? (
        <DataTable
          caption="Closest to breaking"
          columns={[
            { key: 'number', label: 'Ticket' },
            { key: 'title', label: 'Short description' },
            { key: 'risk', label: 'SLA', format: (_, r) => (r.breached ? 'Breached' : `At risk ${r.sla.percentage}%`) },
            { key: 'due', label: 'Due', format: (_, r) => r.sla.plannedEnd || '' },
            { key: 'owner', label: 'Owner', format: (v) => v || '(unassigned)' },
          ]}
          rows={d.top}
          onRowOpen={(row) => row.table && env.openTicket({ table: row.table, sysId: row.sysId })}
        />
      ) : (
        <p className="ab-note ab-note-ok">{d.ticketsAtIssue ? 'The tickets at issue are listed by number only when ticket details can be read.' : 'No SLA is at risk right now.'}</p>
      )}

      {env.scopeKind !== 'mine' && rows(d.byOwner).length > 0 && <StackedBar title="SLA risk by owner" rows={rows(d.byOwner)} series={SERIES} labelHeader="Owner" />}
      {env.scopeKind !== 'mine' && rows(d.byGroup).length > 1 && <StackedBar title="SLA risk by group" rows={rows(d.byGroup)} series={SERIES} labelHeader="Group" />}
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
      help="Tickets whose SLA is breached, nearly used up, or due soon."
      state={state}
      env={env}
      widgetId={widget?.id}
      facts={ok ? [`${d.ticketsAtIssue} tickets at issue out of ${d.activeSlas} active SLAs`] : []}
    >
      {ok && <SlaBody d={d} env={env} />}
    </SectionShell>
  );
}
