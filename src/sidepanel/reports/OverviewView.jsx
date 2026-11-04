import { useState } from 'react';
import { Tile, DataTable } from '../charts/index.js';
import DrillLink from '../charts/DrillLink.jsx';
import SectionShell from './SectionShell.jsx';
import Summary from './Summary.jsx';
import { useSection } from './useSection.js';
import { t } from '../../i18n/index.js';
import { shown } from '../../reports/shown.js';

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
        {tiles.map((x) => (
          <Tile
            key={x.key}
            label={shown(x.label)}
            value={x.value}
            hint={shown(x.unavailable && x.note ? x.note : x.hint)}
            unavailable={x.unavailable}
            tone={x.value > 0 && TONE[x.key] ? TONE[x.key] : 'neutral'}
            onOpen={x.drills?.length ? () => open(x) : undefined}
            href={x.drills?.length === 1 ? hrefOf(x.drills[0]) : ''}
            expanded={x.drills?.length > 1 ? picked?.key === x.key : undefined}
          />
        ))}
      </div>
      {picked && (
        <div className="ab-pick" role="group" aria-label={t('Open {name} in ServiceNow', { name: shown(picked.label) })}>
          <span className="ab-hint">{t('Open in ServiceNow:')}</span>
          {picked.drills.map((dr) =>
            hrefOf(dr) ? (
              <DrillLink key={dr.table} className="ab-btn ab-btn-sm ab-pick-link" href={hrefOf(dr)} onOpen={() => env.openList(dr.table, dr.query)} label={t('{name}. Open the list.', { name: `${shown(dr.label)}: ${dr.count}` })}>
                {shown(dr.label)} ({dr.count})
              </DrillLink>
            ) : (
              <button key={dr.table} type="button" className="ab-btn ab-btn-sm" onClick={() => env.openList(dr.table, dr.query)}>
                {shown(dr.label)} ({dr.count})
              </button>
            )
          )}
        </div>
      )}
      {d.perTable?.length > 1 && (
        <details className="ab-details">
          <Summary>{t('By table')}</Summary>
          <DataTable
            caption={t('Overview by table')}
            columns={[
              { key: 'label', label: t('Table') },
              { key: 'open', label: shown('Open'), align: 'right' },
              ...(env.scopeKind === 'mine' ? [] : [{ key: 'unassigned', label: t('Unassigned'), align: 'right' }]),
              { key: 'stale', label: t('Stale'), align: 'right' },
              { key: 'waiting', label: t('Waiting'), align: 'right' },
              ...(d.resolvedActive > 0 ? [{ key: 'resolvedActive', label: t('Resolved, not closed'), align: 'right' }] : []),
              { key: 'openedToday', label: t('Opened today'), align: 'right' },
              { key: 'resolvedToday', label: t('Resolved today'), align: 'right' },
            ]}
            rows={d.perTable.map((r) => ({ ...r, label: shown(r.label) }))}
          />
        </details>
      )}
    </>
  );
}

// F2/F3/F5 start here: one look at how the queue stands. A click on a tile opens the matching list in ServiceNow.
export default function OverviewView({ widget, env, tools }) {
  const state = useSection('overview', widget, env);
  const d = state.result?.data;
  return (
    <SectionShell
      title={t('Overview')}
      help={t('Where the queue stands right now.')}
      state={state}
      env={env}
      widgetId={widget?.id}
      tools={tools}
      facts={d?.sla && !d.sla.unavailable ? [t('SLA counts cover {n} active SLAs', { n: d.sla.activeSlas })] : []}
    >
      {d && <OverviewBody d={d} env={env} />}
    </SectionShell>
  );
}
