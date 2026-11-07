import { Tile, StackedBar, HeatStrip } from '../charts/index.js';
import TicketList from './TicketList.jsx';
import SectionShell from './SectionShell.jsx';
import Foldable from './Foldable.jsx';
import { useSection } from './useSection.js';
import { shownElsewhere } from './onDashboard.js';
import { t, tn } from '../../i18n/index.js';
import { placeholderName, shown } from '../../reports/shown.js';

// Tones for the state classes (colour is never the only cue: the legend and every value are written out).
const CLASS_TONE = { new: 'c1', working: 'c2', waiting: 'c3', resolved: 'c4', other: 'neutral' };

// A row's name is a person's or a group's (data), or the engine's own word for nobody / "Other people (3)" (shown in the panel's language).
const nameOf = (r) => (r.others ? shown(r.name) : placeholderName(r.name));
// The number printed is the row's open tickets (as the Open tile counts them); the bar also draws the resolved-but-not-closed part.
const rowsOf = (list) => list.map((r) => ({ key: r.key, label: nameOf(r), total: r.count, parts: Object.entries(r.classes || {}).map(([key, value]) => ({ key, value })) }));
// The engine already keeps the busiest rows and sums the rest into one "Other people (n)" row: the bars draw all of them (the chart's
// own cap would hide that row), and "top n" counts only the named rows.
const named = (list) => list.filter((r) => !r.others).length;

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

/**
 * The board for one Workload result (`d` is result.data). When the dashboard also draws Overview (env.sections), the counts Overview
 * already shows (open, unassigned, no update, resolved but not closed) are left out here: one number is said once on a dashboard.
 * Only what is drawn changes; the result (and so the export and "Explain this dashboard") keeps every number.
 */
export function WorkloadBody({ d, env }) {
  const inOverview = shownElsewhere(env, 'overview');
  const series = (d.classes || []).map((c) => ({ key: c.key, label: shown(c.label), tone: CLASS_TONE[c.key] }));
  const find = (list, key) => (list || []).find((r) => r.key === key);
  const age = d.ageing;
  const ageTarget = (cell) => {
    const best = age.byTable.map((row) => ({ table: row.table, count: row.buckets.find((b) => b.key === cell.key)?.count || 0 })).sort((a, b) => b.count - a.count)[0];
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
  // (a ticket type that could not be counted makes the number "at least")
  const pingTile = d.pingPong.available && (
    <Tile label={t('Reassigned {n}+ times', { n: d.pingPong.threshold })} value={d.pingPong.partial ? `${d.pingPong.count}+` : d.pingPong.count} tone={d.pingPong.count > 0 ? 'warn' : 'neutral'} hint={d.pingPong.partial ? t('Some ticket types could not be counted') : t('Handed from group to group')} />
  );

  return (
    <>
      {!inOverview && (
        <div className="ab-tiles">
          <Tile label={shown('Open')} value={d.totals.open} unavailable={d.totals.open === null} hint={d.totals.openPartial ? t('Some ticket types could not be counted') : t('Active tickets')} />
          {d.totals.unassigned !== null && <Tile label={t('Unassigned')} value={d.totals.unassigned} tone={d.totals.unassigned > 0 ? 'warn' : 'neutral'} hint={t('Nobody owns them')} />}
          <Tile label={t('No update in {days}+ days', { days: d.staleDays })} value={d.totals.stale} unavailable={d.totals.stale === null} tone={d.totals.stale > 0 ? 'warn' : 'neutral'} hint={t('Open and untouched')} />
          {d.totals.resolvedActive > 0 && <Tile label={t('Resolved, not closed')} value={d.totals.resolvedActive} hint={t('Waiting to close. Not counted as open.')} />}
        </div>
      )}

      <Foldable id="workload" title={t('Open work by person and group')}>
        {d.byAssignee.length > 0 && (
          <StackedBar
            title={d.assigneeCount > named(d.byAssignee) ? t('Open work by person (top {n} of {total})', { n: named(d.byAssignee), total: d.assigneeCount }) : t('Open work by person')}
            rows={rowsOf(d.byAssignee)}
            maxRows={d.byAssignee.length}
            series={series}
            labelHeader={t('Person')}
            totalHeader={shown('Open')}
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
            maxRows={d.byGroup.length}
            series={series}
            labelHeader={t('Group')}
            totalHeader={shown('Open')}
            hrefFor={links ? (rowKey) => hrefTo(env, rowTarget(d.byGroup, rowKey)) : undefined}
            onDrill={(rowKey) => {
              const row = find(d.byGroup, rowKey);
              if (row && !row.others) openBiggest(env, row.byTable, row.queries);
            }}
          />
        )}
      </Foldable>

      <Foldable id="ageing" title={t('Ageing of open work')}>
        {age.open > 0 ? (
          <HeatStrip title={t('How long tickets have been open')} cells={age.buckets.map((b) => ({ key: b.key, label: shown(b.label), value: b.count }))} total={age.open} unit={t('tickets')} onDrill={ageDrill} hrefFor={links ? (cell) => hrefTo(env, ageTarget(cell)) : undefined} labelHeader={t('Age')} valueHeader={t('Open tickets')} />
        ) : (
          <p className="ab-hint">{t('No open tickets to age.')}</p>
        )}
        {age.left > 0 && <p className="ab-hint">{tn(age.left, '{n} ticket type could not be aged and is left out of this count.', '{n} ticket types could not be aged and are left out of this count.')}</p>}
      </Foldable>

      {(pingTile || d.pingPong.items.length > 0) && (
        <Foldable id="reassigned" title={t('Tickets reassigned {n}+ times', { n: d.pingPong.threshold })}>
          {pingTile && <div className="ab-tiles">{pingTile}</div>}
          {d.pingPong.items.length > 0 && <TicketList label={t('Tickets reassigned {n}+ times', { n: d.pingPong.threshold })} items={d.pingPong.items} env={env} meta={(item) => [tn(item.reassignments, '{n} move', '{n} moves'), placeholderName(item.owner) || t('Unassigned'), item.group]} />}
        </Foldable>
      )}
    </>
  );
}

// F2. Who has how much, in which state, how old it is, what nobody owns, what nobody touched, what keeps being handed over.
export default function WorkloadView({ widget, env, tools }) {
  const state = useSection('workload', widget, env);
  const d = state.result?.data;
  return (
    <SectionShell title={t('Workload and ageing')} help={t('Open work by person and group, how old it is, and where it is stuck.')} state={state} env={env} widgetId={widget?.id} tools={tools}>
      {d && <WorkloadBody d={d} env={env} />}
    </SectionShell>
  );
}
