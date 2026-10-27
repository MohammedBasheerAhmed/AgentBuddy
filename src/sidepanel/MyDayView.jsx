import { useCallback, useEffect, useState } from 'react';
import { MSG } from '../lib/messages.js';
import { openRecord } from './openRecord.js';

const RISK_LABEL = { breached: 'SLA breached', 'at-risk': 'SLA at risk' };

// F1. The agent's own open tickets, most urgent first. No AI: just reads with the person's own session.
export default function MyDayView({ page }) {
  const [state, setState] = useState({ phase: 'loading', items: [], access: [], error: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'loading', error: '' }));
    try {
      const answer = await chrome.tabs.sendMessage(page.tabId, { type: MSG.READ, op: 'myday', args: {} });
      if (answer?.error) throw new Error(answer.error.message);
      setState({ phase: 'ready', items: answer.items || [], access: answer.access || [], error: '' });
    } catch (err) {
      setState({ phase: 'error', items: [], access: [], error: err.message });
    }
  }, [page.tabId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="ab-card" aria-label="My day">
      <div className="ab-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="ab-h" style={{ margin: 0 }}>My day</h2>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={state.phase === 'loading'}>Refresh</button>
      </div>
      <p className="ab-sub">Your open tickets, most urgent first.</p>

      {state.phase === 'loading' && <p className="ab-note" role="status">Reading your queue…</p>}
      {state.phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{state.error}</p>}
      {state.phase === 'ready' && state.items.length === 0 && <p className="ab-note ab-note-ok">Nothing is assigned to you right now.</p>}

      {state.items.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {state.items.map((item) => (
            <li key={item.sysId}>
              <button type="button" className="ab-feature" onClick={() => openRecord(page, item)}>
                <span className="ab-row">
                  <span className="ab-record-number">{item.number}</span>
                  {RISK_LABEL[item.risk] && <span className={`ab-tag ab-risk-${item.risk}`}>{RISK_LABEL[item.risk]}{item.sla ? ` ${item.sla.percentage}%` : ''}</span>}
                </span>
                <span className="ab-feature-title">{item.short_description}</span>
                <span className="ab-feature-desc">
                  {item.priority} · {item.state} · updated {item.idleHours < 1 ? 'just now' : item.idleHours < 48 ? `${item.idleHours}h ago` : `${Math.round(item.idleHours / 24)}d ago`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.access.length > 0 && (
        <p className="ab-hint" style={{ marginTop: 8 }}>
          {/* A denied queue gets a short line; a denied SLA table keeps its own note, which says why the order changed. */}
          {state.access.map((a) => (a.status === 'denied' && a.source !== 'task_sla' ? `${a.source}: you cannot read this.` : a.note)).join(' ')}
        </p>
      )}
    </section>
  );
}
