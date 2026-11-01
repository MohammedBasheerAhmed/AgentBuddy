import React, { useState } from 'react';
import { Tile, DataTable } from '../charts/index.js';
import TicketList from './TicketList.jsx';
import { useMinuteClock } from './hooks.js';
import { ageText, dueText } from './format.js';
import { useRun } from '../useRun.js';
import { HANDOVER_HOURS, HANDOVER_DEFAULT_HOURS } from '../../reports/engine/handover.js';
import { HANDOVER_MAX_WORDS, NOTABLE_MAX, buildHandoverPack, checkHandoverNote } from '../../reports/ai/handover.js';
import SectionShell from './SectionShell.jsx';
import { useSection } from './useSection.js';
import { AiBlocked, AiButton, AiResult, RunProgress, AiKeyLine, featureState, isAiReady } from './aiShared.jsx';
import { plural } from './format.js';
import { t } from '../../i18n/index.js';

const FEATURE_ID = 'shift-handover';

function Block({ title, children }) {
  return (
    <div className="ab-handover-block">
      <h3 className="ab-h ab-handover-h">{title}</h3>
      {children}
    </div>
  );
}

// The facts on a ticket's second line in the hand-over lists.
const who = (t) => t.owner || 'Unassigned';
const slaLine = (now) => (t) => [dueText({ endMs: t.endMs, breached: t.risk === 'Breached', paused: t.paused, plannedEnd: t.plannedEnd }, now), t.risk === 'Breached' ? '' : `${t.percent}% used`, who(t), t.priority];
const stateLine = (t) => [t.state, ageText(t.ageDays), who(t)];
const eventLine = (t) => [t.priority, t.state, who(t), t.group];

// One kind of event in the period: how many, the first few, and an honest line when it could not be counted.
function Events({ title, list, hours, meta, env }) {
  if (!list.available) {
    return (
      <Block title={title}>
        <p className="ab-note">{t('Not available to you, so nothing is shown here.')}</p>
      </Block>
    );
  }
  const total = list.total;
  return (
    <Block title={`${title}${total === null ? '' : `: ${total}`}`}>
      <TicketList items={list.items} env={env} meta={meta} empty={total === null ? 'None could be listed.' : `None in the last ${hours} hours.`} />
      {(list.capped || list.partial) && (
        <p className="ab-hint">
          {list.partial ? 'Some tables could not be read, so this may be incomplete. ' : ''}
          {list.capped ? `Listing the first ${list.items.length}${total === null ? '' : ` of ${total}`}.` : ''}
        </p>
      )}
    </Block>
  );
}

/**
 * The deterministic hand-over page for one result (`d` is result.data with d.available true). No AI is involved: this is the
 * complete hand-over (N16). The note written from it lives in the Team screen's AI Assist half (TeamAssist, AI28).
 * `now` is for tests; the panel uses a minute clock so "due in 1 h 20 min" stays right.
 */
export function HandoverBody({ d, env, now }) {
  const clock = useMinuteClock();
  const at = Number.isFinite(now) ? now : clock;
  const s = d.snapshot;
  const w = d.waiting;
  const tone = (n, kind) => (n > 0 ? kind : 'neutral');
  return (
    <>
      <div className="ab-tiles">
        <Tile label={t('Open')} value={s.open} unavailable={s.open === null} hint={t('Tickets that are still active')} />
        <Tile label={t('Breached')} value={s.breached} unavailable={s.breached === null} tone={tone(s.breached, 'bad')} hint={t('SLA already breached')} />
        <Tile label={t('At risk')} value={s.atRisk} unavailable={s.atRisk === null} tone={tone(s.atRisk, 'warn')} hint={t('Most of the SLA time used')} />
        <Tile label={t('Due soon')} value={s.dueSoon} unavailable={s.dueSoon === null} tone={tone(s.dueSoon, 'warn')} hint={`Ends within ${s.dueSoonHours} hours`} />
        {s.unassigned !== undefined && <Tile label={t('Unassigned')} value={s.unassigned} unavailable={s.unassigned === null} tone={tone(s.unassigned, 'warn')} hint={t('Open with nobody assigned')} />}
        <Tile label={`No update in ${s.staleDays}+ days`} value={s.stale} unavailable={s.stale === null} tone={tone(s.stale, 'warn')} hint={t('Open and untouched')} />
      </div>

      <Block title={t('Needs attention now')}>
        {!d.sla.available ? (
          <p className="ab-note">{d.sla.reason || 'SLA information is not available to you.'}</p>
        ) : (
          <TicketList
            items={d.sla.top}
            env={env}
            meta={slaLine(at)}
            empty={d.sla.ticketsAtIssue ? 'The tickets at issue are listed when ticket details can be read.' : 'No SLA is breached or at risk right now.'}
          />
        )}
      </Block>

      <Block title={t('Waiting on others')}>
        <div className="ab-tiles">
          <Tile label={t('On the customer')} value={w.customer} unavailable={w.customer === null} hint={t('Awaiting the caller or more information')} />
          <Tile label={t('On an approval')} value={w.approval} unavailable={w.approval === null} hint={t('Awaiting approval')} />
          <Tile label={t('On hold or pending')} value={w.other} unavailable={w.other === null} hint={t('Other waiting states')} />
          <Tile label={t('Waiting for you to approve')} value={w.approvals.mine} unavailable={w.approvals.mine === null} hint={t('Approvals assigned to you')} />
          {w.approvals.team !== undefined && <Tile label={t('Approvals holding up requests')} value={w.approvals.team} unavailable={w.approvals.team === null} hint={t('On requested items in this scope')} />}
        </div>
        {w.partial && <p className="ab-hint">{t('Some tables could not be counted, so these numbers may be low.')}</p>}
        {w.oldest.length > 0 && <TicketList caption={t('Waiting the longest')} items={w.oldest} env={env} meta={stateLine} />}
        {w.byState.length > 0 && (
          <details className="ab-details">
            <summary>{t('Waiting by state')}</summary>
            <DataTable
              caption={t('Waiting by state')}
              columns={[{ key: 'label', label: 'State' }, { key: 'kind', label: 'Waiting for', format: (v) => ({ customer: 'The customer', approval: 'An approval', other: 'Other' })[v] || v }, { key: 'count', label: 'Tickets', align: 'right' }]}
              rows={w.byState}
            />
          </details>
        )}
      </Block>

      <Events title={t('Priority 1-2 opened')} list={d.events.opened} hours={d.hours} meta={eventLine} env={env} />
      <Events title={t('Priority 1-2 resolved')} list={d.events.resolved} hours={d.hours} meta={eventLine} env={env} />
      <Events title={t('SLAs breached')} list={d.events.breaches} hours={d.hours} meta={slaLine(at)} env={env} />
      <Events title={t('Handed over 3+ times and touched')} list={d.events.reassigned} hours={d.hours} meta={(t) => [`${t.reassignments} moves`, who(t), t.group]} env={env} />

      <Block title={t('Oldest open')}>
        <TicketList items={d.oldest} env={env} meta={stateLine} empty={t('Nothing to show.')} />
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

/**
 * AI28, "Write the hand-over note", in the Team screen's AI Assist half. `result` is the hand-over section's engine result (the
 * tables the Insights half shows, N16): it is the note's only input; null while it is being read. `primary` makes the button the
 * screen's one filled button.
 */
export function HandoverAi({ result, page, eff, hours, primary = true }) {
  const run = useRun({ page, eff, record: null });
  const [usedAt, setUsedAt] = useState(null);
  const { feature, available } = featureState(FEATURE_ID, eff.policy);
  const aiReady = isAiReady(eff);
  const blockedFields = eff.policy?.blockedFields || [];
  const sensitivePrefixes = eff.policy?.sensitiveTablePrefixes || [];
  const shown = run.phase === 'done' && run.active?.id === FEATURE_ID;
  const stale = shown && usedAt !== null && Number(result?.readAt) > usedAt;
  const ready = Boolean(result?.data && result.data.available !== false);

  function go() {
    if (!feature || !available || !ready) return;
    setUsedAt(result.readAt);
    run.run(feature, {
      getPack: async () => {
        const pack = buildHandoverPack(result, { blockedFields, sensitivePrefixes });
        if (!pack) throw new Error('There is nothing to hand over yet. Wait for the numbers to load.');
        return pack;
      },
    });
  }

  return (
    <div className="ab-handover-ai">
      {!available ? (
        <AiBlocked>{t('The hand-over note is switched off by your organisation. The hand-over tables under Insights still work.')}</AiBlocked>
      ) : (
        <>
          <p className="ab-hint">
            {t('Written from the hand-over figures and up to {NOTABLE_MAX} notable tickets. Assignees and requesters are masked; a person named only inside a ticket title is not, so read the preview: it shows exactly what will be sent.', { NOTABLE_MAX })}
          </p>
          {!aiReady && <AiKeyLine eff={eff} />}
          <div className="ab-row">
            <AiButton eff={eff} primary={primary} disabled={!aiReady || run.busy || !ready} onClick={go}>
              {t('Write the hand-over note')}
            </AiButton>
          </div>
        </>
      )}
      <RunProgress run={run} eff={eff} page={page} readingText="Getting the numbers ready…" />
      <AiResult
        run={run}
        eff={eff}
        featureId={FEATURE_ID}
        heading={`Hand-over note, last ${hours} hours`}
        notice={[...(stale ? ['The hand-over numbers have been read again since this note was written.'] : []), ...(shown ? noteChecks(run.result) : [])]}
      />
    </div>
  );
}

/** The period picker (8, 12 or 24 hours). */
export function HoursPicker({ hours, onChange, label = 'Period' }) {
  return (
    <div className="ab-seg" role="group" aria-label={label}>
      {HANDOVER_HOURS.map((h) => (
        <button key={h} type="button" className="ab-btn ab-btn-sm ab-seg-btn" aria-pressed={hours === h} onClick={() => onChange(h)}>
          {t('{h} hours', { h })}
        </button>
      ))}
    </div>
  );
}

// F4 / N16. What a lead hands to the next shift: where the queue stands, what is at risk, what waits on others, what happened lately.
// Insights only: no AI here. The period is a convenience of this view (the saved dashboard keeps no numbers and no period); the
// result goes into env.loaded like every widget's, which is where the AI Assist half's hand-over note takes its figures from.
export default function HandoverView({ widget, env }) {
  const [hours, setHours] = useState(HANDOVER_DEFAULT_HOURS);
  const state = useSection('handover', { ...widget, params: { ...(widget?.params || {}), hours } }, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;

  return (
    <SectionShell
      title={t('Shift handover')}
      help={t('Where the queue stands, what is at risk, what waits on others and what happened lately.')}
      state={state}
      env={env}
      widgetId={widget?.id}
      actions={<HoursPicker hours={hours} onChange={setHours} />}
      facts={ok ? [`Last ${d.hours} hours`] : []}
    >
      {ok && <HandoverBody d={d} env={env} />}
    </SectionShell>
  );
}
