import React, { useState } from 'react';
import { Tile, DataTable } from '../charts/index.js';
import DrillLink from '../charts/DrillLink.jsx';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';

// Tiles that mean "look at this" when they are not zero.
const TONE = { breached: 'bad', dueSoon: 'warn', stale: 'warn', unassigned: 'warn' };

/** The tiles for one Overview result (`d` is result.data). Drawn from data only, so it is tested without a browser. */
export function OverviewBody({ d, env }) {
  const [picked, setPicked] = useState(null); // a tile with several tables behind it
  const tiles = d.tiles || [];

  const open = (tile) => {
    const drills = tile.drills || [];
    if (drills.length === 1) env.openList(drills[0].table, drills[0].query);
    else if (drills.length > 1) setPicked(picked?.key === tile.key ? null : tile);
  };
  // A tile with ONE list behind it is a link to that list; one with several tables opens a choice (a button), whose entries are links.
  const hrefOf = (dr) => (env.listHref ? env.listHref(dr.table, dr.query) || '' : '');

  return (
    <>
      <div className="ab-tiles">
        {tiles.map((t) => (
          <Tile
            key={t.key}
            label={t.label}
            value={t.value}
            hint={t.unavailable && t.note ? t.note : t.hint}
            unavailable={t.unavailable}
            tone={t.value > 0 && TONE[t.key] ? TONE[t.key] : 'neutral'}
            onOpen={t.drills?.length ? () => open(t) : undefined}
            href={t.drills?.length === 1 ? hrefOf(t.drills[0]) : ''}
            expanded={t.drills?.length > 1 ? picked?.key === t.key : undefined}
          />
        ))}
      </div>
      {picked && (
        <div className="ab-pick" role="group" aria-label={`Open ${picked.label} in ServiceNow`}>
          <span className="ab-hint">Open in ServiceNow:</span>
          {picked.drills.map((dr) =>
            hrefOf(dr) ? (
              <DrillLink key={dr.table} className="ab-btn ab-btn-sm ab-pick-link" href={hrefOf(dr)} onOpen={() => env.openList(dr.table, dr.query)} label={`${dr.label}: ${dr.count}. Open the list.`}>
                {dr.label} ({dr.count})
              </DrillLink>
            ) : (
              <button key={dr.table} type="button" className="ab-btn ab-btn-sm" onClick={() => env.openList(dr.table, dr.query)}>
                {dr.label} ({dr.count})
              </button>
            )
          )}
        </div>
      )}
      {d.perTable?.length > 1 && (
        <details className="ab-details">
          <summary>By table</summary>
          <DataTable
            caption="Overview by table"
            columns={[
              { key: 'label', label: 'Table' },
              { key: 'open', label: 'Open', align: 'right' },
              ...(env.scopeKind === 'mine' ? [] : [{ key: 'unassigned', label: 'Unassigned', align: 'right' }]),
              { key: 'stale', label: 'Stale', align: 'right' },
              { key: 'waiting', label: 'Waiting', align: 'right' },
              { key: 'openedToday', label: 'Opened today', align: 'right' },
              { key: 'resolvedToday', label: 'Resolved today', align: 'right' },
            ]}
            rows={d.perTable}
          />
        </details>
      )}
    </>
  );
}

// F2/F3/F5 start here: one look at how the queue stands. A click on a tile opens the matching list in ServiceNow.
export default function OverviewView({ widget, env }) {
  const state = useSection('overview', widget, env);
  const d = state.result?.data;
  return (
    <SectionShell
      title="Overview"
      help="Where the queue stands right now."
      state={state}
      env={env}
      widgetId={widget?.id}
      facts={d?.sla && !d.sla.unavailable ? [`SLA counts cover ${d.sla.activeSlas} active SLAs`] : []}
    >
      {d && <OverviewBody d={d} env={env} />}
    </SectionShell>
  );
}
