import React from 'react';
import { Tile, StackedBar, HeatStrip } from '../charts/index.js';
import TicketList from './TicketList.jsx';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';
import { t } from '../../i18n/index.js';

// Tones for the state classes (colour is never the only cue: the legend and every value are written out).
const CLASS_TONE = { new: 'c1', working: 'c2', waiting: 'c3', resolved: 'c4', other: 'neutral' };

const rowsOf = (list) => list.map((r) => ({ key: r.key, label: r.name, parts: Object.entries(r.classes).map(([key, value]) => ({ key, value })) }));

/** The table that holds most of a row's tickets, and the query for that row there: what a click on the row opens. */
function biggest(byTable, queries) {
  const table = Object.entries(byTable || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  return table && queries?.[table] ? { table, query: queries[table] } : null;
}

/** Open the list of the table that holds most of a row's tickets. */
function openBiggest(env, byTable, queries) {
  const target = biggest(byTable, queries);
  if (target) env.openList(target.table, target.query);
}

// The address a row or cell opens, when the dashboard can build one (env.listHref); '' otherwise.
const hrefTo = (env, target) => (target && env.listHref ? env.listHref(target.table, target.query) || '' : '');

/** The board for one Workload result (`d` is result.data). */
export function WorkloadBody({ d, env }) {
  const series = (d.classes || []).map((c) => ({ key: c.key, label: c.label, tone: CLASS_TONE[c.key] }));
  const find = (list, key) => (list || []).find((r) => r.key === key);
  const age = d.ageing;
  const ageTarget = (cell) => {
    const best = age.byTable.map((t) => ({ table: t.table, count: t.buckets.find((b) => b.key === cell.key)?.count || 0 })).sort((a, b) => b.count - a.count)[0];
    // Each table leaves out its own resolved-but-active states, so the query of the table that holds most of the cell is used.
    const query = age.queriesByTable?.[best?.table]?.[cell.key] || age.queries?.[cell.key];
    return best?.count && query ? { table: best.table, query } : null;
  };
  const ageDrill = (cell) => {
    const target = ageTarget(cell);
    if (target) env.openList(target.table, target.query);
  };
  const rowTarget = (list, rowKey) => {
    const row = find(list, rowKey);
    return row && !row.others ? biggest(row.byTable, row.queries) : null;
  };
  const links = Boolean(env.listHref);

  return (
    <>
      <div className="ab-tiles">
        <Tile label={t('Open')} value={d.totals.open} unavailable={d.totals.open === null} hint={d.totals.openPartial ? 'Some tables could not be counted' : 'Active tickets'} />
        {d.totals.unassigned !== null && <Tile label={t('Unassigned')} value={d.totals.unassigned} tone={d.totals.unassigned > 0 ? 'warn' : 'neutral'} hint={t('Nobody owns them')} />}
        <Tile label={`No update in ${d.staleDays}+ days`} value={d.totals.stale} unavailable={d.totals.stale === null} tone={d.totals.stale > 0 ? 'warn' : 'neutral'} hint={t('Open and untouched')} />
        {d.pingPong.available && <Tile label={`Reassigned ${d.pingPong.threshold}+ times`} value={d.pingPong.count} tone={d.pingPong.count > 0 ? 'warn' : 'neutral'} hint={t('Handed from group to group')} />}
        {d.totals.resolvedActive > 0 && <Tile label={t('Resolved, not closed')} value={d.totals.resolvedActive} hint={t('Waiting to close. Not counted as open.')} />}
      </div>

      {age.open > 0 ? (
        <HeatStrip title={t('How long tickets have been open')} cells={age.buckets.map((b) => ({ key: b.key, label: b.label, value: b.count }))} total={age.open} unit="tickets" onDrill={ageDrill} hrefFor={links ? (cell) => hrefTo(env, ageTarget(cell)) : undefined} labelHeader="Age" valueHeader="Open tickets" />
      ) : (
        <p className="ab-hint">{t('No open tickets to age.')}</p>
      )}

      {d.byAssignee.length > 0 && (
        <StackedBar
          title={`Open work by person${d.assigneeCount > d.byAssignee.length ? ` (top ${d.byAssignee.length} of ${d.assigneeCount})` : ''}`}
          rows={rowsOf(d.byAssignee)}
          series={series}
          labelHeader="Person"
          hrefFor={links ? (rowKey) => hrefTo(env, rowTarget(d.byAssignee, rowKey)) : undefined}
          onDrill={(rowKey) => {
            const row = find(d.byAssignee, rowKey);
            if (row && !row.others) openBiggest(env, row.byTable, row.queries);
          }}
        />
      )}
      {d.byGroup.length > 0 && (
        <StackedBar
          title={t('Open work by group')}
          rows={rowsOf(d.byGroup)}
          series={series}
          labelHeader="Group"
          hrefFor={links ? (rowKey) => hrefTo(env, rowTarget(d.byGroup, rowKey)) : undefined}
          onDrill={(rowKey) => {
            const row = find(d.byGroup, rowKey);
            if (row && !row.others) openBiggest(env, row.byTable, row.queries);
          }}
        />
      )}

      {d.pingPong.items.length > 0 && <TicketList caption={`Tickets reassigned ${d.pingPong.threshold}+ times`} items={d.pingPong.items} env={env} meta={(t) => [`${t.reassignments} moves`, t.owner || 'Unassigned', t.group]} />}
    </>
  );
}

// F2. Who has how much, in which state, how old it is, what nobody owns, what nobody touched, what keeps being handed over.
export default function WorkloadView({ widget, env }) {
  const state = useSection('workload', widget, env);
  const d = state.result?.data;
  return (
    <SectionShell title={t('Workload and ageing')} help={t('Open work by person and group, how old it is, and where it is stuck.')} state={state} env={env} widgetId={widget?.id}>
      {d && <WorkloadBody d={d} env={env} />}
    </SectionShell>
  );
}
