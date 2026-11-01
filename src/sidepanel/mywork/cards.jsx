import React, { useId, useMemo, useState } from 'react';
import RecordLink from '../RecordLink.jsx';
import { CardFrame, ShowMore, EmptyNote } from '../ui/primitives.jsx';
import { groupQueue, filterChips, passes } from '../../mywork/rank.js';
import { followUps, followUpReason, followUpText, followUpAction, FOLLOW_UP_DAY_CHOICES } from '../../mywork/followups.js';
import { fullListUrl } from '../../mywork/links.js';
import { agoText, spanText, dueToday } from '../../mywork/time.js';
import { TicketRow, Fold, FilterChips, copyText } from './parts.jsx';

// The four cards of the My work screen (N13 My queue, approvals waiting on me, N27 Follow-ups due, N14 Unassigned in my groups).
// Every one is Insights: facts read with the person's own session, nothing sent anywhere, no AI.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The queue card's one-line summary: "12 open · 2 SLA breached · 3 replied". Pure. */
export function queueSummary(queue, items) {
  const total = Number.isFinite(queue?.total) && queue.total > items.length ? queue.total : items.length;
  if (!total) return '';
  const breached = items.filter((i) => i.sla?.risk === 'breached' && i.work !== 'resolved').length;
  const replied = items.filter((i) => i.marker?.replied && i.work !== 'resolved').length;
  return [`${total} open`, breached ? `${breached} SLA breached` : '', replied ? `${replied} replied` : ''].filter(Boolean).join(' · ');
}

/** What an empty "waiting on you" list says, with what the group queue adds ("3 tickets in your groups are due today"). Pure. */
export function emptyQueueText({ empty, waiting = 0, groupItems = [], groupTotal = 0, now }) {
  if (empty === 'unread') return 'None of your ticket queues could be read.';
  if (empty === 'unseen') return 'Agent Buddy can see no tickets at all with your access, so it cannot tell whether anything is assigned to you.';
  const head = waiting ? `Nothing needs you right now. ${plural(waiting, 'ticket')} ${waiting === 1 ? 'waits' : 'wait'} on the customer or others.` : 'Nothing is waiting on you.';
  const due = groupItems.filter((i) => i.sla && !i.sla.paused && (i.sla.breached || dueToday(i.sla.dueAt, now))).length;
  if (due) return `${head} ${plural(due, 'ticket')} in your groups ${due === 1 ? 'is' : 'are'} due today.`;
  if (groupTotal) return `${head} Your groups have ${plural(groupTotal, 'unassigned ticket')}.`;
  return head;
}

function FullList({ page, table, query, children = 'Open the full list' }) {
  const url = fullListUrl(page, table, query);
  if (!url) return null;
  return (
    <RecordLink page={page} url={url} className="ab-mw-more-link" title="Opens the list in ServiceNow, in this tab. Ctrl+click for a new tab.">
      {children}
    </RecordLink>
  );
}

// ---- N13 My queue ------------------------------------------------------------------------------------------------------------

export function QueueCard({ page, data, now, filter, setFilter, onOpen }) {
  const { queue, groups } = data;
  const items = queue.items || [];
  const shown = useMemo(() => items.filter((i) => passes(i, filter)), [items, filter]);
  const g = useMemo(() => groupQueue(shown, now), [shown, now]);
  const chips = useMemo(() => {
    const list = filterChips(items, { classNames: queue.names || {} });
    // A filter set from the outage note (one CI) shows as a chip of its own while it is on.
    if (filter.startsWith('ci:') && !list.some((c) => c.id === filter)) {
      const ci = items.find((i) => i.ci && `ci:${i.ci.id}` === filter)?.ci;
      if (ci) list.unshift({ id: filter, label: `On ${ci.name}`, count: items.filter((i) => passes(i, filter)).length });
    }
    return list;
  }, [items, filter, queue.names]);
  const breached = items.some((i) => i.sla?.risk === 'breached' && i.work !== 'resolved');
  const atRisk = items.some((i) => i.sla?.risk === 'at-risk' && i.work !== 'resolved');
  const row = (item) => <TicketRow key={item.sysId} page={page} item={item} now={now} onOpen={onOpen} />;

  return (
    <CardFrame id="mywork-queue" title="My queue" summary={queueSummary(queue, items)} attention={breached ? 'danger' : atRisk ? 'warn' : ''}>
      {chips.length > 0 && <FilterChips chips={chips} value={filter} onChange={setFilter} />}
      {g.now.length > 0 ? (
        <ShowMore items={g.now} limit={5} render={row} className="ab-list ab-mw-list" />
      ) : filter ? (
        <EmptyNote
          action={
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setFilter('')}>
              Clear the filter
            </button>
          }
        >
          {shown.length ? 'Nothing that matches needs you right now.' : 'No ticket matches this filter.'}
        </EmptyNote>
      ) : (
        <EmptyNote>{emptyQueueText({ empty: items.length ? null : queue.empty, waiting: g.waiting.length, groupItems: groups.items, groupTotal: groups.total, now })}</EmptyNote>
      )}
      {queue.more && (
        <p className="ab-hint ab-mw-cap">
          Showing {items.length} of {queue.total > items.length ? queue.total : `${items.length} or more`}.{' '}
          <FullList page={page} table="task" query={queue.listQuery} />
        </p>
      )}
      {g.waiting.length > 0 && (
        <Fold title="Waiting on the customer or others" count={g.waiting.length}>
          <ShowMore items={g.waiting} limit={5} render={row} className="ab-list ab-mw-list" />
        </Fold>
      )}
      {g.resolved.length > 0 && (
        <Fold title="Resolved, awaiting closure" count={g.resolved.length}>
          <ShowMore items={g.resolved} limit={5} render={row} className="ab-list ab-mw-list" />
        </Fold>
      )}
    </CardFrame>
  );
}

// ---- approvals waiting on me ---------------------------------------------------------------------------------------------------

export function ApprovalsCard({ page, approvals, now }) {
  const items = approvals.items || [];
  if (!items.length) return null;
  const overdue = items.some((a) => a.dueAt && a.dueAt < now);
  const row = (a) => (
    <div className="ab-mw-row" key={a.sysId}>
      <RecordLink page={page} item={{ table: 'sysapproval_approver', sysId: a.sysId }} className="ab-mw-link">
        <span className="ab-mw-line">
          <span className="ab-record-number">{a.number || 'Approval'}</span>
          {a.title && <span className="ab-mw-title">{a.title}</span>}
        </span>
        <span className="ab-mw-line ab-mw-sub">
          <span className="ab-mw-meta">{[a.requestedAt ? `asked ${agoText(a.requestedAt, now)}` : '', a.dueAt ? (a.dueAt < now ? `due ${agoText(a.dueAt, now)}` : `due in ${spanText(a.dueAt - now)}`) : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </RecordLink>
    </div>
  );
  return (
    <CardFrame id="mywork-approvals" title="Approvals waiting on you" summary={String(approvals.total || items.length)} attention={overdue ? 'warn' : ''}>
      <ShowMore items={items} limit={3} render={row} className="ab-list ab-mw-list" />
      {approvals.total > items.length && (
        <p className="ab-hint ab-mw-cap">
          Showing {items.length} of {approvals.total}. <FullList page={page} table="sysapproval_approver" query={approvals.listQuery} />
        </p>
      )}
    </CardFrame>
  );
}

// ---- N27 Follow-ups due -------------------------------------------------------------------------------------------------------

function FollowUpRow({ page, entry, now, onOpen }) {
  const [note, setNote] = useState('');
  const action = followUpAction(entry);
  const copy = async () => {
    const ok = await copyText(followUpText(entry));
    setNote(ok ? 'Copied. Paste it into the customer comment of the ticket.' : 'Could not copy. Your browser did not allow it.');
  };
  return (
    <div className="ab-mw-row ab-mw-follow">
      <RecordLink page={page} item={entry.item} onOpen={() => onOpen(entry.item)} className="ab-mw-link">
        <span className="ab-mw-line">
          <span className="ab-record-number">{entry.item.number}</span>
          <span className="ab-mw-title">{entry.item.title || 'No title'}</span>
        </span>
        <span className="ab-mw-line ab-mw-sub">
          <span className={`ab-mw-chip ab-mw-chip-${entry.kind === 'replied' ? 'reply' : 'quiet'}`}>{followUpReason(entry)}</span>
        </span>
      </RecordLink>
      {action && (
        <div className="ab-mw-follow-act">
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={copy} title="Copies a short text with the ticket number and title. Nothing is sent.">
            {action}
          </button>
          <span className="ab-hint" role="status">
            {note}
          </span>
        </div>
      )}
    </div>
  );
}

export function FollowUpsCard({ page, data, now, days, setDays, onOpen }) {
  const list = useMemo(() => followUps(data.queue.items, { now, days }), [data.queue.items, now, days]);
  const selectId = useId();
  const known = (data.queue.items || []).some((i) => i.marker?.known);
  const replied = list.filter((f) => f.kind === 'replied').length;
  const due = list.length - replied;
  const summary = [due ? `${due} due` : '', replied ? `${replied} replied` : ''].filter(Boolean).join(' · ');
  return (
    <CardFrame
      id="mywork-followups"
      title="Follow-ups due"
      summary={summary}
      actions={
        <>
          <label className="ab-mw-sr" htmlFor={selectId}>
            Follow up after
          </label>
          <select id={selectId} className="ab-select ab-select-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} title="How long a customer may wait for a word">
            {FOLLOW_UP_DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                after {d} days
              </option>
            ))}
          </select>
        </>
      }
    >
      {list.length > 0 ? (
        <ShowMore items={list} limit={3} render={(entry) => <FollowUpRow key={`${entry.kind}:${entry.item.sysId}`} page={page} entry={entry} now={now} onOpen={onOpen} />} className="ab-list ab-mw-list" />
      ) : (
        <EmptyNote>{known || !data.queue.items.length ? `No customer has waited ${days} days for a word from you.` : 'Follow-ups need the comments on your tickets, which are not visible to you.'}</EmptyNote>
      )}
    </CardFrame>
  );
}

// ---- N14 Unassigned in my groups -----------------------------------------------------------------------------------------------

export function GroupsCard({ page, groups, now, onOpen }) {
  const items = groups.items || [];
  const oldest = items[0]?.openedAt;
  const summary = items.length ? [`${groups.total > items.length ? groups.total : items.length} waiting`, oldest ? `oldest ${spanText(now - oldest)}` : ''].filter(Boolean).join(' · ') : '';
  return (
    <CardFrame id="mywork-groups" title="Unassigned in my groups" summary={summary}>
      {items.length > 0 ? (
        <ShowMore items={items} limit={3} render={(item) => <TicketRow key={item.sysId} page={page} item={item} now={now} onOpen={onOpen} where="group" />} className="ab-list ab-mw-list" />
      ) : (
        <EmptyNote>{groups.groups.length ? 'Nothing is waiting unassigned in your groups.' : 'Agent Buddy can see no group you belong to.'}</EmptyNote>
      )}
      {(groups.more || groups.total > items.length) && items.length > 0 && (
        <p className="ab-hint ab-mw-cap">
          Showing {items.length} of {groups.total > items.length ? groups.total : `${items.length} or more`}. <FullList page={page} table="task" query={groups.listQuery} />
        </p>
      )}
      {groups.note && <p className="ab-hint">{groups.note}</p>}
    </CardFrame>
  );
}
