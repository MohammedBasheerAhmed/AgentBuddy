import { useEffect, useMemo, useRef, useState } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { Icon } from '../ui/icons.jsx';
import { HalfRule } from '../ui/primitives.jsx';
import { openRecord } from '../openRecord.js';
import { sharedCis } from '../../mywork/rank.js';
import { readText, readWhen } from '../../mywork/time.js';
import { noteText } from './accessNotes.js';
import { cleanDays, DEFAULT_FOLLOW_UP_DAYS } from '../../mywork/followups.js';
import { saveSettings } from '../../lib/storage.js';
import { useMyWork } from './useMyWork.js';
import { QueueCard, ApprovalsCard, FollowUpsCard, GroupsCard, emptyQueueText } from './cards.jsx';
import { RowList, TicketRow } from './parts.jsx';
import { BackButton, FiveRow, QuietRow } from './FiveRow.jsx';
import { myWorkRows, myWorkSummary } from './rows.js';
import MyWeek from './MyWeek.jsx';
import { isolate, t, t as tr, tn } from '../../i18n/index.js';

// The My work screen (TRACKER.md 3.6: N13 My queue, N14 Unassigned in my groups, N27 Follow-ups due). Insights only: it reads with
// the person's own session (src/content/ops/mywork.js), nothing is sent anywhere and there is no AI half.
//
// Round 5 (docs/round5.md, board A): the first screen is FIVE rows, like the Ticket screen: Needs you now, At risk today, Replied to
// you, Waiting on others, Same cause? (rows.js works each out from the one read). One finding on each row; a click opens it in place
// with its first tickets. Under them, two quiet rows: "All N open tickets, with filters" (today's screen, unchanged: the queue with its
// filters, the approvals, the follow-ups, the unassigned tickets of my groups, and the read every 5 minutes) and "My week" (a view of
// its own, MyWeek.jsx).
//
// props: { page, eff, active, onOpenTicket() }. A plain click on a ticket opens it in this tab and calls onOpenTicket, so the shell
// switches to the Ticket screen.
//
// The follow-up period has one home, the setting `followUpDays` (Settings > My work): the period chosen on the full list saves that
// setting, and the screen always shows what the setting says, also after it is changed in Settings while the panel is open.

/** The access notes as one short line, each said once. Pure. */
export function accessLine(access) {
  // (the notes are written in English by the page script; noteText() puts each in the language of the panel)
  return [...new Set((access || []).map((a) => String(a?.note || '').trim()).filter(Boolean))].map(noteText).join(' ');
}

// The five rows: their ids (data-row, the side rail) and icons. The titles are written out where they are drawn.
const RAIL = {
  needs: { id: 'mywork-row-needs', icon: 'alert' },
  risk: { id: 'mywork-row-risk', icon: 'flag' },
  replied: { id: 'mywork-row-replied', icon: 'reply' },
  waiting: { id: 'mywork-row-waiting', icon: 'clock' },
  cause: { id: 'mywork-row-cause', icon: 'refresh' },
};

export default function MyWorkView({ page, eff, active, onOpenTicket }) {
  const shown = active !== false; // (a host that does not say is showing it)
  const work = useMyWork({ page, eff, active: shown });
  const [filter, setFilter] = useState('');
  const [view, setView] = useState('rows'); // 'rows' | 'all' | 'week'
  const [open, setOpen] = useState({}); // row id -> true / false (unset: the first row opens when it has tickets)
  const days = cleanDays(eff?.values?.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS);
  const { data, now } = work;
  const busy = work.phase === 'loading';
  const policy = eff?.policy;
  const model = useMemo(() => (data ? myWorkRows(data, { now, policy }) : null), [data, now, policy]);

  // The new period shows when the saved setting comes back (useEffective follows the storage); if the browser does not save it,
  // the period stays what the setting says.
  const setDays = (d) => saveSettings({ followUpDays: cleanDays(d) }).catch(() => {});

  // A ticket opens in this tab and the panel follows it to the Ticket screen.
  const openTicket = (item) => {
    if (openRecord(page, { table: item.table, sysId: item.sysId })) onOpenTicket?.();
  };

  // Going to another view and back: the focus goes to the first control of the view that opened, and back to the row that opened it.
  const back = useRef(null);
  const allRow = useRef(null);
  const weekRow = useRef(null);
  const went = useRef('');
  useEffect(() => {
    if (went.current === view) return;
    const from = went.current;
    went.current = view;
    if (!from && view === 'rows') return; // the first draw
    if (view === 'rows') (from === 'week' ? weekRow : allRow).current?.focus?.({ preventScroll: true });
    else back.current?.focus?.({ preventScroll: true });
  }, [view]);

  const goAll = (nextFilter = '') => {
    setFilter(nextFilter);
    setView('all');
  };

  const outage = data ? sharedCis(data.queue.items)[0] : null;
  const hint = data ? accessLine(data.access) : '';

  // ---- what is shown above every view: the slow note, an error, a stopped read
  const notes = (
    <>
      {busy && work.slow && (
        <p className="ab-note" role="status">
          {t('Waiting for ServiceNow to answer: your tickets, their SLAs and the latest comments.')}
        </p>
      )}
      {work.phase === 'error' && <ErrorNote error={work.error} onRetry={work.load} />}
      {work.stopped && (
        <div className="ab-note ab-mw-stopped">
          <span>{data ? t('Stopped. What you see was read {when}.', { when: readWhen(work.readAt, now) }) : t('Stopped before anything was read.')}</span>
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={work.load}>
            {t('Try again')}
          </button>
        </div>
      )}
    </>
  );
  const readButton = busy ? (
    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={work.stop}>
      {t('Stop')}
    </button>
  ) : (
    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={work.load}>
      {t('Refresh')}
    </button>
  );
  const readText_ = busy ? t('Reading your work…') : data ? readText(work.readAt, now) : '';

  if (view === 'week') {
    return (
      <div className="ab-mywork" data-view="week">
        <MyWeek page={page} eff={eff} onBack={() => setView('rows')} />
      </div>
    );
  }

  // ---- today's screen, unchanged: the full list with its filters, approvals, follow-ups, my groups
  if (view === 'all') {
    return (
      <div className="ab-mywork" aria-busy={busy} data-view="all">
        <BackButton onBack={() => setView('rows')} innerRef={back} />
        <div className="ab-mw-bar">
          <span className="ab-mw-read" role="status">
            {readText_}
          </span>
          <label className="ab-mw-auto" title={t('Read again every 5 minutes while this screen is open')}>
            <input type="checkbox" checked={work.auto} onChange={(e) => work.setAuto(e.target.checked)} /> {t('Every 5 min')}
          </label>
          {readButton}
        </div>
        {notes}
        {data && (
          <>
            {outage && (
              <div className="ab-mw-attn">
                <span className="ab-mw-attn-icon" aria-hidden="true">
                  <Icon name="alert" size={14} />
                </span>
                <span className="ab-mw-attn-body">
                  <span className="ab-mw-attn-text">
                    {t('{count} of your tickets are on {name}. One cause?', { count: outage.count, name: isolate(tr(outage.name)) })}
                  </span>
                  <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-mw-attn-act" onClick={() => setFilter(`ci:${outage.id}`)}>
                    {t('Show them')}
                  </button>
                </span>
              </div>
            )}
            <QueueCard page={page} data={data} now={now} policy={policy} filter={filter} setFilter={setFilter} onOpen={openTicket} />
            <ApprovalsCard page={page} approvals={data.approvals} now={now} />
            <FollowUpsCard page={page} data={data} now={now} days={days} setDays={setDays} onOpen={openTicket} />
            <GroupsCard page={page} groups={data.groups} now={now} onOpen={openTicket} />
            {hint && <p className="ab-hint ab-mw-access">{hint}</p>}
          </>
        )}
      </div>
    );
  }

  // ---- the first screen: five rows
  const row = (id) => model.rows[id];
  const isOpen = (id) => open[id] ?? (id === 'needs' && row('needs').items.length > 0);
  const toggle = (id) => (v) => setOpen((o) => ({ ...o, [id]: v }));
  const tickets = (list, limit = 3) => (
    <RowList items={list} limit={limit} render={(item) => <TicketRow key={item.sysId} page={page} item={item} now={now} onOpen={openTicket} />} />
  );
  const calm = (text) => <p className="ab-fr-empty">{text}</p>;

  return (
    <div className="ab-mywork ab-fr-screen" aria-busy={busy} data-view="rows">
      <div className="ab-fr-top">
        <h2 className="ab-fr-title">{t('My work')}</h2>
        <span className="ab-fr-read">
          <span role="status">{readText_}</span>
          {readText_ ? <span aria-hidden="true"> · </span> : null}
          {readButton}
        </span>
      </div>
      {model && !model.unread && <p className="ab-fr-sub">{myWorkSummary(model)}</p>}
      {model?.unread && <p className="ab-fr-sub">{emptyQueueText({ empty: data.queue.empty, now })}</p>}
      {notes}

      {model && (
        <>
          <ul className="ab-rows ab-fr-rows" aria-label={t('My work')}>
            <FiveRow rowId="needs" rail={RAIL.needs} icon="alert" title={t('Needs you now')} line={row('needs').line} count={row('needs').count} level={row('needs').level} open={isOpen('needs')} onToggle={toggle('needs')}>
              {row('needs').items.length ? tickets(row('needs').items, 2) : calm(row('needs').line)}
            </FiveRow>
            <FiveRow rowId="risk" rail={RAIL.risk} icon="flag" title={t('At risk today')} line={row('risk').line} count={row('risk').count} level={row('risk').level} open={isOpen('risk')} onToggle={toggle('risk')}>
              {row('risk').items.length ? tickets(row('risk').items) : calm(row('risk').line)}
              {model.unreadFacts > 0 && (
                <p className="ab-hint ab-fr-hint">
                  {tn(model.unreadFacts, '{n} ticket has facts that could not be read, so At risk may be incomplete.', '{n} tickets have facts that could not be read, so At risk may be incomplete.')}
                </p>
              )}
            </FiveRow>
            <FiveRow rowId="replied" rail={RAIL.replied} icon="reply" title={t('Replied to you')} line={row('replied').line} count={row('replied').count} level={row('replied').level} open={isOpen('replied')} onToggle={toggle('replied')}>
              {row('replied').items.length ? tickets(row('replied').items) : calm(row('replied').line)}
            </FiveRow>
            <FiveRow rowId="waiting" rail={RAIL.waiting} icon="clock" title={t('Waiting on others')} line={row('waiting').line} count={row('waiting').count} level={row('waiting').level} open={isOpen('waiting')} onToggle={toggle('waiting')}>
              {row('waiting').items.length ? tickets(row('waiting').items) : calm(row('waiting').line)}
            </FiveRow>
            <FiveRow rowId="cause" rail={RAIL.cause} icon="refresh" title={t('Same cause?')} line={row('cause').line} count={row('cause').count} level={row('cause').level} open={isOpen('cause')} onToggle={toggle('cause')}>
              {row('cause').clusters?.length ? (
                row('cause').clusters.slice(0, 3).map((c) => (
                  <div key={c.id} className="ab-fr-cluster">
                    <p className="ab-fr-cluster-head">{t('{count} of your tickets are on {name}. One cause?', { count: c.count, name: isolate(tr(c.name)) })}</p>
                    {tickets(model.items.filter((i) => i.work !== 'resolved' && i.ci?.id === c.id))}
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fr-more" onClick={() => goAll(`ci:${c.id}`)}>
                      {t('Show them')}
                    </button>
                  </div>
                ))
              ) : (
                calm(row('cause').line)
              )}
            </FiveRow>
          </ul>
          <ul className="ab-rows ab-fr-quiet-rows">
            <QuietRow
              icon="list"
              label={model.capped ? t('All {n} or more open tickets, with filters', { n: model.open }) : tn(model.open, 'All {n} open ticket, with filters', 'All {n} open tickets, with filters')}
              onClick={() => goAll('')}
              innerRef={allRow}
            />
            <QuietRow icon="clipboard" label={t('My week')} detail={t('Where your week went')} onClick={() => setView('week')} innerRef={weekRow} />
          </ul>
        </>
      )}
      <HalfRule half="insights" />
    </div>
  );
}
