import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from './ask.js';
import RecordLink from './RecordLink.jsx';
import ErrorNote from './ErrorNote.jsx';
import { plainNote, plainSource } from './plainAccess.js';
import { retryDelay } from './reports/useReport.js';
import { t, t as tr, tm, tn } from '../i18n/index.js';

const RISK_LABEL = { breached: tm('SLA breached'), 'at-risk': tm('SLA at risk') };

/** "updated 3h ago" for a number of hours. Pure. */
export function idleText(hours) {
  if (!Number.isFinite(hours) || hours < 1) return t('updated just now');
  if (hours < 48) return t('updated {n}h ago', { n: hours });
  return t('updated {n}d ago', { n: Math.round(hours / 24) });
}

/** One line on top of the list: how many, and how many need attention first. Pure. */
export function summaryText(items) {
  const n = items.length;
  if (!n) return '';
  const breached = items.filter((i) => i.risk === 'breached').length;
  const atRisk = items.filter((i) => i.risk === 'at-risk').length;
  const urgent = [breached ? tn(breached, '{n} with a breached SLA', '{n} with a breached SLA') : '', atRisk ? tn(atRisk, '{n} with an SLA at risk', '{n} with an SLA at risk') : ''].filter(Boolean).join(t(' and '));
  if (!urgent) return tn(n, '{n} open ticket.', '{n} open tickets.');
  return tn(n, '{n} open ticket: {urgent}, listed first.', '{n} open tickets: {urgent}, listed first.', { urgent });
}

/** The words for an empty list: only "nothing is assigned to you" when that is what the reads prove. Pure. */
export function emptyText(empty) {
  if (empty === 'unread') return t('None of your ticket queues could be read.');
  if (empty === 'unseen') return t('Agent Buddy can see no tickets at all in these tables with your access, so it cannot tell whether anything is assigned to you.');
  return t('Nothing is assigned to you right now.');
}

/** The access notes as one short paragraph: a denied queue gets a short line; the SLA table keeps its own note (why the order changed). */
export function accessText(access) {
  return access.map((a) => (a.status === 'denied' && a.source !== 'task_sla' ? t('{source}: you cannot read this.', { source: plainSource(a.source) }) : plainNote(a.note))).filter(Boolean).join(' ');
}

// F1. The agent's own open tickets, most urgent first. No AI: just reads with the person's own session.
// Round 3: replaced by the My work screen (src/sidepanel/mywork). Kept until the old 'myday' READ and the tests that import the helpers
// above (tests/reports-links-ui.test.js) are moved; no screen draws this view any more.
export default function MyDayView({ page }) {
  const [state, setState] = useState({ phase: 'loading', items: [], access: [], empty: null, error: '' });
  const run = useRef(0);

  const load = useCallback(async () => {
    run.current += 1;
    const mine = run.current;
    setState((s) => ({ ...s, phase: 'loading', error: '' }));
    for (let attempt = 0; ; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one try at a time
        const answer = await read(page.tabId, 'myday', {});
        if (mine === run.current) setState({ phase: 'ready', items: answer.items || [], access: answer.access || [], empty: answer.empty || null, error: '' });
        return;
      } catch (err) {
        if (mine !== run.current) return;
        // The ServiceNow page was being replaced while it read: wait for the new page and ask again (twice at most).
        const wait = retryDelay(err, attempt);
        if (wait !== null) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (mine !== run.current) return;
          continue;
        }
        setState({ phase: 'error', items: [], access: [], empty: null, error: err.message });
        return;
      }
    }
  }, [page.tabId]);

  useEffect(() => {
    load();
    return () => {
      run.current += 1; // a late answer for a closed view is dropped
    };
  }, [load]);

  const busy = state.phase === 'loading';
  const hint = accessText(state.access);

  return (
    <section className="ab-card" aria-label={t('My day')} aria-busy={busy}>
      <div className="ab-row ab-myday-head">
        <h2 className="ab-h">{t('My day')}</h2>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={busy}>{busy ? t('Reading…') : t('Refresh')}</button>
      </div>
      <p className="ab-sub">{t('Your open tickets, most urgent first. A click opens one in this tab; Ctrl+click or right-click opens a new tab.')}</p>

      {busy && !state.items.length && <p className="ab-note" role="status">{t('Reading your queue…')}</p>}
      {state.phase === 'error' && <ErrorNote error={state.error} onRetry={load} />}
      {state.phase === 'ready' && state.items.length === 0 && (
        <p className={`ab-note ${state.empty === 'unseen' || state.empty === 'unread' ? 'ab-note-warn' : 'ab-note-ok'}`}>{emptyText(state.empty)}</p>
      )}

      {hint && <p className="ab-hint ab-myday-access">{hint}</p>}

      {state.items.length > 0 && (
        <>
          <p className="ab-myday-summary" role="status">{summaryText(state.items)}</p>
          <ul className={`ab-myday-list${busy ? ' ab-is-busy' : ''}`}>
            {state.items.map((item) => (
              <li key={item.sysId}>
                <RecordLink page={page} item={item} className="ab-feature">
                  <span className="ab-row">
                    <span className="ab-record-number">{item.number}</span>
                    {RISK_LABEL[item.risk] && <span className={`ab-tag ab-risk-${item.risk}`}>{tr(RISK_LABEL[item.risk])}{item.sla ? ` ${item.sla.percentage}%` : ''}</span>}
                  </span>
                  <span className="ab-feature-title">{item.short_description}</span>
                  <span className="ab-feature-desc">
                    {[item.priority, item.state, idleText(item.idleHours)].filter(Boolean).join(' · ')}
                  </span>
                </RecordLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
