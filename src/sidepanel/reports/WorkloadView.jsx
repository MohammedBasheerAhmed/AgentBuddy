import { Tile, StackedBar, HeatStrip, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';

// Tones for the state classes (colour is never the only cue: the legend and every value are written out).
const CLASS_TONE = { new: 'c1', working: 'c2', waiting: 'c3', other: 'neutral' };

const rowsOf = (list) => list.map((r) => ({ key: r.key, label: r.name, parts: Object.entries(r.classes).map(([key, value]) => ({ key, value })) }));

/** Open the list of the table that holds most of a row's tickets. */
function openBiggest(env, byTable, queries) {
  const table = Object.entries(byTable || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (table && queries?.[table]) env.openList(table, queries[table]);
}

// F2. Who has how much, in which state, how old it is, what nobody owns, what nobody touched, what keeps being handed over.
export default function WorkloadView({ widget, env }) {
  const state = useSection('workload', widget, env);
  const d = state.result?.data;
  const series = (d?.classes || []).map((c) => ({ key: c.key, label: c.label, tone: CLASS_TONE[c.key] }));
  const find = (list, key) => (list || []).find((r) => r.key === key);

  const age = d?.ageing;
  const ageDrill = (cell) => {
    const bucket = age.byTable.map((t) => ({ table: t.table, count: t.buckets.find((b) => b.key === cell.key)?.count || 0 })).sort((a, b) => b.count - a.count)[0];
    if (bucket?.count && age.queries?.[cell.key]) env.openList(bucket.table, age.queries[cell.key]);
  };

  return (
    <SectionShell title="Workload and ageing" help="Open work by person and group, how old it is, and where it is stuck." state={state} env={env} widgetId={widget?.id}>
      {d && (
        <>
          <div className="ab-tiles">
            <Tile label="Open" value={d.totals.open} unavailable={d.totals.open === null} hint={d.totals.openPartial ? 'Some tables could not be counted' : 'Active tickets'} />
            {d.totals.unassigned !== null && <Tile label="Unassigned" value={d.totals.unassigned} tone={d.totals.unassigned > 0 ? 'warn' : 'neutral'} hint="Nobody owns them" />}
            <Tile label={`No update in ${d.staleDays}+ days`} value={d.totals.stale} unavailable={d.totals.stale === null} tone={d.totals.stale > 0 ? 'warn' : 'neutral'} hint="Open and untouched" />
            {d.pingPong.available && <Tile label={`Reassigned ${d.pingPong.threshold}+ times`} value={d.pingPong.count} tone={d.pingPong.count > 0 ? 'warn' : 'neutral'} hint="Handed from group to group" />}
          </div>

          {age.open > 0 ? (
            <HeatStrip title="How long tickets have been open" cells={age.buckets.map((b) => ({ key: b.key, label: b.label, value: b.count }))} total={age.open} unit="tickets" onDrill={ageDrill} labelHeader="Age" valueHeader="Open tickets" />
          ) : (
            <p className="ab-hint">No open tickets to age.</p>
          )}

          {d.byAssignee.length > 0 && (
            <StackedBar
              title={`Open work by person${d.assigneeCount > d.byAssignee.length ? ` (top ${d.byAssignee.length} of ${d.assigneeCount})` : ''}`}
              rows={rowsOf(d.byAssignee)}
              series={series}
              labelHeader="Person"
              onDrill={(rowKey) => {
                const row = find(d.byAssignee, rowKey);
                if (row && !row.others) openBiggest(env, row.byTable, row.queries);
              }}
            />
          )}
          {d.byGroup.length > 0 && (
            <StackedBar
              title="Open work by group"
              rows={rowsOf(d.byGroup)}
              series={series}
              labelHeader="Group"
              onDrill={(rowKey) => {
                const row = find(d.byGroup, rowKey);
                if (row && !row.others) openBiggest(env, row.byTable, row.queries);
              }}
            />
          )}

          {d.pingPong.items.length > 0 && (
            <DataTable
              caption={`Tickets reassigned ${d.pingPong.threshold}+ times`}
              columns={[
                { key: 'number', label: 'Ticket' },
                { key: 'title', label: 'Short description' },
                { key: 'reassignments', label: 'Moves', align: 'right' },
                { key: 'group', label: 'Group' },
              ]}
              rows={d.pingPong.items}
              onRowOpen={(row) => env.openTicket({ table: row.table, sysId: row.sysId })}
            />
          )}
        </>
      )}
    </SectionShell>
  );
}
