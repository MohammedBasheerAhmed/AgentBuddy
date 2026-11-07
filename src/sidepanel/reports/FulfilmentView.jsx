import { Tile, HorizontalBar } from '../charts/index.js';
import TicketList from './TicketList.jsx';
import { ageText } from './format.js';
import SectionShell from './SectionShell.jsx';
import Foldable from './Foldable.jsx';
import { useSection } from './useSection.js';
import { t } from '../../i18n/index.js';
import { placeholderName, shown, stateShown } from '../../reports/shown.js';

const CLASS_TONE = { new: 'c1', working: 'c2', waiting: 'c3', resolved: 'c4', other: 'neutral' };

/** The fulfilment report for one result (`d` is result.data, with d.available true). */
export function FulfilmentBody({ d, env }) {
  return (
    <>
      <Foldable id="approvals" title={t('Approvals waiting')}>
        <div className="ab-tiles">
          <Tile label={t('Waiting for your approval')} value={d.approvals.mine} unavailable={d.approvals.mine === null} hint={shown(d.approvals.mineNote || '')} tone={d.approvals.mine > 0 ? 'warn' : 'neutral'} />
          {d.approvals.team !== undefined && <Tile label={t('Approvals holding up the team')} value={d.approvals.team} unavailable={d.approvals.team === null} hint={d.approvals.teamNote ? shown(d.approvals.teamNote) : t('On requested items in this scope')} tone={d.approvals.team > 0 ? 'warn' : 'neutral'} />}
        </div>
      </Foldable>

      <Foldable id="fulfilment-state" title={t('By state')}>
        <div className="ab-tiles">
          <Tile label={t('Open items and tasks')} value={d.open} unavailable={d.open === null} hint={d.openPartial ? t('Some ticket types could not be counted') : ''} />
        </div>
        {d.byTable.map((tbl) =>
          tbl.states ? (
            <HorizontalBar
              key={tbl.table}
              title={t('{table} by state', { table: shown(tbl.label) })}
              items={tbl.states.map((s) => ({ key: s.key || s.name, label: s.plain ? shown(s.name) : placeholderName(s.name), value: s.count, tone: CLASS_TONE[s.cls] }))}
              unit={shown(tbl.label.toLowerCase())}
              labelHeader={t('State')}
              onDrill={(item) => tbl.stateQuery?.[item.key] && env.openList(tbl.table, tbl.stateQuery[item.key])}
              hrefFor={env.listHref ? (item) => (tbl.stateQuery?.[item.key] ? env.listHref(tbl.table, tbl.stateQuery[item.key]) : '') : undefined}
            />
          ) : (
            <p key={tbl.table} className="ab-hint">{t('{table}: the states could not be read.', { table: shown(tbl.label) })}</p>
          )
        )}
      </Foldable>

      {d.other?.items?.length > 0 && (
        <Foldable id="fulfilment-other" title={t('Other kinds of ticket')}>
          <HorizontalBar
            title={t('Tickets by kind')}
            items={d.other.items.map((x) => ({ key: x.table, label: shown(x.label), value: x.count, tone: 'neutral' }))}
            unit={t('tickets')}
            labelHeader={t('Ticket type')}
            onDrill={(item) => env.openList(item.key, d.other.query)}
            hrefFor={env.listHref ? (item) => env.listHref(item.key, d.other.query) : undefined}
          />
        </Foldable>
      )}

      {d.oldest.length > 0 && (
        <Foldable id="fulfilment-oldest" title={t('Oldest open items')}>
          <TicketList label={t('Oldest open items')} items={d.oldest} env={env} meta={(item) => [stateShown(item), ageText(item.ageDays), placeholderName(item.owner) || t('Unassigned')]} />
        </Foldable>
      )}
    </>
  );
}

// Requested items and catalog tasks: where they stand, what waits for approval, what has been open longest.
export default function FulfilmentView({ widget, env, tools }) {
  const state = useSection('fulfilment', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;
  return (
    <SectionShell title={t('Request fulfilment')} help={t('Requested items and catalog tasks by state, approvals, and the oldest open items.')} state={state} env={env} widgetId={widget?.id} tools={tools}>
      {ok && <FulfilmentBody d={d} env={env} />}
    </SectionShell>
  );
}
