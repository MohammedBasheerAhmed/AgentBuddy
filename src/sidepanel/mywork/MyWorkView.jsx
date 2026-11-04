import { useState } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { Icon } from '../ui/icons.jsx';
import { openRecord } from '../openRecord.js';
import { sharedCis } from '../../mywork/rank.js';
import { readText, readWhen } from '../../mywork/time.js';
import { noteText } from './accessNotes.js';
import { cleanDays, DEFAULT_FOLLOW_UP_DAYS } from '../../mywork/followups.js';
import { saveSettings } from '../../lib/storage.js';
import { useMyWork } from './useMyWork.js';
import { QueueCard, ApprovalsCard, FollowUpsCard, GroupsCard } from './cards.jsx';
import { isolate, t, t as tr } from '../../i18n/index.js';

// The My work screen (TRACKER.md 3.6: N13 My queue, N14 Unassigned in my groups, N27 Follow-ups due). Insights only: it reads with
// the person's own session (src/content/ops/mywork.js), nothing is sent anywhere and there is no AI half.
//
// Calm by design (TRACKER.md 2.4, the 2026 redesign): one status line on top (when it was read, Refresh), a quiet attention line when
// several of my tickets share one configuration item, then sections parted by dividers: the queue, most urgent first, with the
// waiting and the resolved tickets folded; the approvals only when there are some; follow-ups; the unassigned tickets of my groups;
// one line at the bottom for anything that could not be read. Every ticket is a row (status dot, number, title, chips).
//
// props: { page, eff, active, onOpenTicket() }. A plain click on a ticket opens it in this tab and calls onOpenTicket, so the shell
// switches to the Ticket screen.
//
// The follow-up period has one home, the setting `followUpDays` (Settings > My work): the period chosen on this screen saves that
// setting, and the screen always shows what the setting says, also after it is changed in Settings while the panel is open.

/** The access notes as one short line, each said once. Pure. */
export function accessLine(access) {
  // (the notes are written in English by the page script; noteText() puts each in the language of the panel)
  return [...new Set((access || []).map((a) => String(a?.note || '').trim()).filter(Boolean))].map(noteText).join(' ');
}

export default function MyWorkView({ page, eff, active, onOpenTicket }) {
  const shown = active !== false; // (a host that does not say is showing it)
  const work = useMyWork({ page, eff, active: shown });
  const [filter, setFilter] = useState('');
  const days = cleanDays(eff?.values?.followUpDays ?? DEFAULT_FOLLOW_UP_DAYS);
  const { data, now } = work;
  const busy = work.phase === 'loading';

  // The new period shows when the saved setting comes back (useEffective follows the storage); if the browser does not save it,
  // the period stays what the setting says.
  const setDays = (d) => saveSettings({ followUpDays: cleanDays(d) }).catch(() => {});

  // A ticket opens in this tab and the panel follows it to the Ticket screen.
  const openTicket = (item) => {
    if (openRecord(page, { table: item.table, sysId: item.sysId })) onOpenTicket?.();
  };

  const outage = data ? sharedCis(data.queue.items)[0] : null;
  const hint = data ? accessLine(data.access) : '';

  return (
    <div className="ab-mywork" aria-busy={busy}>
      <div className="ab-mw-bar">
        <span className="ab-mw-read" role="status">
          {busy ? t('Reading your work…') : data ? readText(work.readAt, now) : ''}
        </span>
        <label className="ab-mw-auto" title={t('Read again every 5 minutes while this screen is open')}>
          <input type="checkbox" checked={work.auto} onChange={(e) => work.setAuto(e.target.checked)} /> {t('Every 5 min')}
        </label>
        {busy ? (
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={work.stop}>
            {t('Stop')}
          </button>
        ) : (
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={work.load}>
            {t('Refresh')}
          </button>
        )}
      </div>

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
          <QueueCard page={page} data={data} now={now} filter={filter} setFilter={setFilter} onOpen={openTicket} />
          <ApprovalsCard page={page} approvals={data.approvals} now={now} />
          <FollowUpsCard page={page} data={data} now={now} days={days} setDays={setDays} onOpen={openTicket} />
          <GroupsCard page={page} groups={data.groups} now={now} onOpen={openTicket} />
          {hint && <p className="ab-hint ab-mw-access">{hint}</p>}
        </>
      )}
    </div>
  );
}
