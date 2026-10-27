// The "Request" tab, drawn from the view model that src/checks/requestView.js builds. Pure drawing: no reads, no state.
import React from 'react';
import { Facts, Hints, Section, Tag } from './Bits.jsx';

const HEADLINE = {
  done: ['Finished', 'ok'],
  ended: ['Closed', 'warn'],
  rejected: ['Rejected', 'danger'],
  approval: ['Waiting for approval', 'warn'],
  hold: ['On hold', 'warn'],
  task: ['Waiting on work', ''],
  progress: ['In progress', 'ok'],
};

export function StatusCard({ status }) {
  const [label, tone] = HEADLINE[status.state] || ['Status', ''];
  return (
    <section className="ab-card ab-chk-status" aria-label="What it is waiting for">
      <div className="ab-row">
        <Tag tone={tone}>{label}</Tag>
        <span className="ab-sub">What it is waiting for, and who owns it</span>
      </div>
      <p className="ab-chk-line">{status.line}</p>
      <Facts
        rows={[
          status.owner && { label: 'Who to ask', value: status.owner },
          status.due && { label: 'Due', value: status.due.overdue ? `${status.due.text} (past due)` : status.due.text },
          status.sla && { label: 'SLA', value: status.sla.text },
        ].filter(Boolean)}
        tight
      />
      {status.caveats.length > 0 && (
        <p className="ab-note ab-note-warn" role="note">{status.caveats.join(' ')}</p>
      )}
    </section>
  );
}

export function RequestBody({ view }) {
  const { status, facts, answers, approvals, chain } = view;
  return (
    <>
      <StatusCard status={status} />

      {facts.length > 0 && (
        <Section title="At a glance" defaultOpen>
          <Facts rows={facts.map(([label, value]) => ({ label, value }))} tight />
        </Section>
      )}

      {answers.applicable && (
        <Section title="Answers to the request questions" count={answers.available ? answers.rows.length : undefined}>
          {!answers.available && <p className="ab-note ab-note-warn">{answers.note}</p>}
          {answers.available && answers.rows.length === 0 && <p className="ab-hint">No answers are recorded for this item.</p>}
          {answers.rows.length > 0 && <Facts rows={answers.rows.map((r) => ({ label: r.question, value: r.value, hidden: r.hidden }))} />}
          <Hints lines={[answers.available ? answers.note : '']} />
        </Section>
      )}

      {approvals.applicable && (
        <Section title="Approvals" count={approvals.available ? approvals.rows.length : undefined}>
          {!approvals.available && <p className="ab-note ab-note-warn">The approvals could not be read, so they are not shown.</p>}
          {approvals.available && approvals.rows.length === 0 && <p className="ab-hint">No approvals are recorded.</p>}
          {approvals.rows.length > 0 && (
            <ul className="ab-chk-list">
              {approvals.rows.map((a, i) => (
                <li key={i} className="ab-chk-item">
                  <span className="ab-chk-item-main">{a.who}</span>
                  <span className="ab-row">
                    <Tag tone={a.tone}>{a.state}</Tag>
                    {a.when && <span className="ab-sub">{a.when}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {chain.applicable && (
        <Section title={chain.title} count={chain.available ? chain.rows.length : undefined}>
          {!chain.available && <p className="ab-note ab-note-warn">{chain.title} could not be read, so they are not shown.</p>}
          {chain.available && chain.rows.length === 0 && <p className="ab-hint">None recorded.</p>}
          {chain.rows.length > 0 && (
            <ul className="ab-chk-list">
              {chain.rows.map((r, i) => (
                <li key={`${r.number}:${i}`} className={`ab-chk-item${r.current ? ' ab-chk-current' : ''}`}>
                  <span className="ab-chk-item-main">
                    <span className="ab-record-number">{r.number}</span> {r.label}
                    {r.current && <span className="ab-sub"> (this one)</span>}
                  </span>
                  <span className="ab-row">
                    <Tag tone={r.done ? 'ok' : r.open ? '' : 'warn'}>{r.state}</Tag>
                    <span className="ab-sub">{r.owner || 'not assigned'}</span>
                    {r.due && <span className="ab-sub">due {r.due}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
