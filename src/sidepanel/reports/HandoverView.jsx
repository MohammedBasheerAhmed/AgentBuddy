import React, { useState } from 'react';
import { Tile, DataTable } from '../charts/index.js';
import { useRun } from '../useRun.js';
import { HANDOVER_HOURS, HANDOVER_DEFAULT_HOURS } from '../../reports/engine/handover.js';
import { HANDOVER_MAX_WORDS, NOTABLE_MAX, buildHandoverPack, checkHandoverNote } from '../../reports/ai/handover.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';
import { AiBlocked, AiResult, RunProgress, aiNotReadyText, featureState, isAiReady } from './aiShared.jsx';
import { plural } from './format.js';

const FEATURE_ID = 'shift-handover';

const TICKET_COLUMNS = [
  { key: 'number', label: 'Ticket' },
  { key: 'title', label: 'Short description' },
  { key: 'priority', label: 'Priority' },
  { key: 'state', label: 'State' },
  { key: 'owner', label: 'Owner', format: (v) => v || '(unassigned)' },
  { key: 'group', label: 'Group' },
];

function Block({ title, children }) {
  return (
    <div className="ab-handover-block">
      <h3 className="ab-h ab-handover-h">{title}</h3>
      {children}
    </div>
  );
}

/** A short list of tickets that opens the ticket on click. */
function Tickets({ caption, items, extra = [], env }) {
  return <DataTable caption={caption} columns={[...TICKET_COLUMNS, ...extra]} rows={items} onRowOpen={(row) => row.table && env.openTicket({ table: row.table, sysId: row.sysId })} />;
}

// One kind of event in the period: how many, the first few, and an honest line when it could not be counted.
function Events({ title, list, hours, extra = [], env }) {
  if (!list.available) {
    return (
      <Block title={title}>
        <p className="ab-note">Not available to you, so nothing is shown here.</p>
      </Block>
    );
  }
  const total = list.total;
  return (
    <Block title={`${title}${total === null ? '' : `: ${total}`}`}>
      {list.items.length === 0 ? (
        <p className="ab-note ab-note-ok">{total === null ? 'None could be listed.' : `None in the last ${hours} hours.`}</p>
      ) : (
        <Tickets caption={title} items={list.items} extra={extra} env={env} />
      )}
      {(list.capped || list.partial) && (
        <p className="ab-hint">
          {list.partial ? 'Some tables could not be read, so this may be incomplete. ' : ''}
          {list.capped ? `Showing the first ${list.items.length}${total === null ? '' : ` of ${total}`}.` : ''}
        </p>
      )}
    </Block>
  );
}

/** The deterministic hand-over page for one result (`d` is result.data with d.available true). No AI is involved. */
export function HandoverBody({ d, env }) {
  const s = d.snapshot;
  const w = d.waiting;
  const tone = (n, kind) => (n > 0 ? kind : 'neutral');
  return (
    <>
      <div className="ab-tiles">
        <Tile label="Open" value={s.open} unavailable={s.open === null} hint="Tickets that are still active" />
        <Tile label="Breached" value={s.breached} unavailable={s.breached === null} tone={tone(s.breached, 'bad')} hint="SLA already breached" />
        <Tile label="At risk" value={s.atRisk} unavailable={s.atRisk === null} tone={tone(s.atRisk, 'warn')} hint="Most of the SLA time used" />
        <Tile label="Due soon" value={s.dueSoon} unavailable={s.dueSoon === null} tone={tone(s.dueSoon, 'warn')} hint={`Ends within ${s.dueSoonHours} hours`} />
        {s.unassigned !== undefined && <Tile label="Unassigned" value={s.unassigned} unavailable={s.unassigned === null} tone={tone(s.unassigned, 'warn')} hint="Open with nobody assigned" />}
        <Tile label={`No update in ${s.staleDays}+ days`} value={s.stale} unavailable={s.stale === null} tone={tone(s.stale, 'warn')} hint="Open and untouched" />
      </div>

      <Block title="Needs attention now">
        {!d.sla.available ? (
          <p className="ab-note">{d.sla.reason || 'SLA information is not available to you.'}</p>
        ) : d.sla.top.length ? (
          <Tickets caption="SLAs closest to breaking" items={d.sla.top} extra={[{ key: 'risk', label: 'SLA', format: (v, r) => `${v} ${r.percent}%` }, { key: 'plannedEnd', label: 'Due' }]} env={env} />
        ) : (
          <p className="ab-note ab-note-ok">{d.sla.ticketsAtIssue ? 'The tickets at issue are listed when ticket details can be read.' : 'No SLA is breached or at risk right now.'}</p>
        )}
      </Block>

      <Block title="Waiting on others">
        <div className="ab-tiles">
          <Tile label="On the customer" value={w.customer} unavailable={w.customer === null} hint="Awaiting the caller or more information" />
          <Tile label="On an approval" value={w.approval} unavailable={w.approval === null} hint="Awaiting approval" />
          <Tile label="On hold or pending" value={w.other} unavailable={w.other === null} hint="Other waiting states" />
          <Tile label="Waiting for you to approve" value={w.approvals.mine} unavailable={w.approvals.mine === null} hint="Approvals assigned to you" />
          {w.approvals.team !== undefined && <Tile label="Approvals holding up requests" value={w.approvals.team} unavailable={w.approvals.team === null} hint="On requested items in this scope" />}
        </div>
        {w.partial && <p className="ab-hint">Some tables could not be counted, so these numbers may be low.</p>}
        {w.byState.length > 0 && (
          <DataTable
            caption="Waiting by state"
            columns={[{ key: 'label', label: 'State' }, { key: 'kind', label: 'Waiting for', format: (v) => ({ customer: 'The customer', approval: 'An approval', other: 'Other' })[v] || v }, { key: 'count', label: 'Tickets', align: 'right' }]}
            rows={w.byState}
          />
        )}
        {w.oldest.length > 0 && <Tickets caption="Waiting the longest" items={w.oldest} extra={[{ key: 'ageDays', label: 'Age (days)', align: 'right' }]} env={env} />}
      </Block>

      <Events title="Priority 1-2 opened" list={d.events.opened} hours={d.hours} extra={[{ key: 'openedAt', label: 'Opened' }]} env={env} />
      <Events title="Priority 1-2 resolved" list={d.events.resolved} hours={d.hours} env={env} />
      <Events title="SLAs breached" list={d.events.breaches} hours={d.hours} extra={[{ key: 'plannedEnd', label: 'Due' }]} env={env} />
      <Events title="Handed over 3+ times and touched" list={d.events.reassigned} hours={d.hours} extra={[{ key: 'reassignments', label: 'Reassignments', align: 'right' }]} env={env} />

      <Block title="Oldest open">
        {d.oldest.length ? <Tickets caption="Oldest open tickets" items={d.oldest} extra={[{ key: 'ageDays', label: 'Age (days)', align: 'right' }]} env={env} /> : <p className="ab-note">Nothing to show.</p>}
      </Block>
    </>
  );
}

/** The note's own checks, as short sentences (word count over the aim, headings that did not come back). */
export function noteChecks(text) {
  const c = checkHandoverNote(text);
  const out = [];
  if (c.tooLong) out.push(`The note is ${c.words} words; the aim was ${HANDOVER_MAX_WORDS}. Trim it before you share it.`);
  if (c.missing.length) out.push(`The AI left out ${plural(c.missing.length, 'heading')}: ${c.missing.join(' ')}. Add ${c.missing.length === 1 ? 'it' : 'them'} before you share the note.`);
  return out;
}

/** The "Write the hand-over note" block. `result` is the engine result on screen: it is the note's only input. */
export function HandoverAi({ result, page, eff, hours }) {
  const run = useRun({ page, eff, record: null });
  const [usedAt, setUsedAt] = useState(null);
  const { feature, available } = featureState(FEATURE_ID, eff.policy);
  const aiReady = isAiReady(eff);
  const blockedFields = eff.policy?.blockedFields || [];
  const shown = run.phase === 'done' && run.active?.id === FEATURE_ID;
  const stale = shown && usedAt !== null && result.readAt > usedAt;

  function go() {
    if (!feature || !available) return;
    setUsedAt(result.readAt);
    run.run(feature, {
      getPack: async () => {
        const pack = buildHandoverPack(result, { blockedFields });
        if (!pack) throw new Error('There is nothing to hand over yet. Wait for the numbers to load.');
        return pack;
      },
    });
  }

  return (
    <div className="ab-handover-ai">
      <h3 className="ab-h ab-handover-h">Write the hand-over note</h3>
      {!available ? (
        <AiBlocked>The hand-over note is switched off by your organisation. The page above still works.</AiBlocked>
      ) : (
        <>
          <p className="ab-hint">
            The note is written from the figures above and up to {NOTABLE_MAX} notable tickets (number, type, priority, state, group, assignee and short description). The names of those assignees and of the people who raised those tickets are masked. A person named only inside a ticket title is not masked, so read the preview: it shows exactly what will be sent.
          </p>
          {!aiReady && <p className="ab-note ab-note-warn">{aiNotReadyText(eff)}</p>}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={!aiReady || run.busy} onClick={go}>Write the hand-over note</button>
          </div>
        </>
      )}
      <RunProgress run={run} eff={eff} page={page} readingText="Getting the numbers ready…" />
      <AiResult
        run={run}
        eff={eff}
        featureId={FEATURE_ID}
        heading={`Hand-over note, last ${hours} hours`}
        notice={[...(stale ? ['The numbers on the page have been refreshed since this note was written.'] : []), ...(shown ? noteChecks(run.result) : [])]}
      />
    </div>
  );
}

// F4. What a lead hands to the next shift: where the queue stands, what is at risk, what waits on others, what happened lately.
export default function HandoverView({ widget, env, eff }) {
  // The period is a convenience for this view only; the saved dashboard keeps no numbers and no period.
  const [hours, setHours] = useState(HANDOVER_DEFAULT_HOURS);
  const state = useSection('handover', { ...widget, params: { ...(widget?.params || {}), hours } }, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;

  const picker = (
    <div className="ab-seg" role="group" aria-label="Period">
      {HANDOVER_HOURS.map((h) => (
        <button key={h} type="button" className={`ab-btn ab-btn-sm${hours === h ? ' ab-btn-primary' : ''}`} aria-pressed={hours === h} onClick={() => setHours(h)}>
          {h} hours
        </button>
      ))}
    </div>
  );

  return (
    <SectionShell
      title="Shift handover"
      help="Where the queue stands, what is at risk, what waits on others and what happened lately. Works without AI."
      state={state}
      env={env}
      widgetId={widget?.id}
      actions={picker}
      facts={ok ? [`Last ${d.hours} hours`] : []}
    >
      {ok && (
        <>
          <HandoverBody d={d} env={env} />
          <HandoverAi result={state.result} page={env.page} eff={eff} hours={d.hours} />
        </>
      )}
    </SectionShell>
  );
}
