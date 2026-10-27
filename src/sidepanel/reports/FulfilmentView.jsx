import { Tile, HorizontalBar, DataTable } from '../charts/index.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';

const CLASS_TONE = { new: 'c1', working: 'c2', waiting: 'c3', other: 'neutral' };

// Requested items and catalog tasks: where they stand, what waits for approval, what has been open longest.
export default function FulfilmentView({ widget, env }) {
  const state = useSection('fulfilment', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;

  return (
    <SectionShell title="Request fulfilment" help="Requested items and catalog tasks by state, approvals, and the oldest open items." state={state} env={env} widgetId={widget?.id}>
      {ok && (
        <>
          <div className="ab-tiles">
            <Tile label="Open items and tasks" value={d.open} unavailable={d.open === null} />
            <Tile label="Waiting for your approval" value={d.approvals.mine} unavailable={d.approvals.mine === null} hint={d.approvals.mineNote || ''} tone={d.approvals.mine > 0 ? 'warn' : 'neutral'} />
            {d.approvals.team !== undefined && <Tile label="Approvals holding up the team" value={d.approvals.team} unavailable={d.approvals.team === null} hint={d.approvals.teamNote || 'On requested items in this scope'} tone={d.approvals.team > 0 ? 'warn' : 'neutral'} />}
          </div>

          {d.byTable.map((t) =>
            t.states ? (
              <HorizontalBar
                key={t.table}
                title={`${t.label} by state`}
                items={t.states.map((s) => ({ key: s.key || s.name, label: s.name, value: s.count, tone: CLASS_TONE[s.cls] }))}
                unit={t.label.toLowerCase()}
                labelHeader="State"
                onDrill={(item) => t.stateQuery?.[item.key] && env.openList(t.table, t.stateQuery[item.key])}
              />
            ) : (
              <p key={t.table} className="ab-hint">{t.label}: the states could not be read.</p>
            )
          )}

          {d.oldest.length > 0 && (
            <DataTable
              caption="Oldest open items"
              columns={[
                { key: 'number', label: 'Item' },
                { key: 'title', label: 'Short description' },
                { key: 'state', label: 'State' },
                { key: 'ageDays', label: 'Days open', align: 'right' },
                { key: 'owner', label: 'Assigned to', format: (v) => v || '(unassigned)' },
              ]}
              rows={d.oldest}
              onRowOpen={(row) => env.openTicket({ table: row.table, sysId: row.sysId })}
            />
          )}
        </>
      )}
    </SectionShell>
  );
}
