import React, { useMemo } from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { outageSignal } from '../../../insights/outage.js';
import { riskSignals } from '../../../insights/risk.js';
import { Tag } from '../../checks/Bits.jsx';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ReadState } from './bits.jsx';

// N9, risk signals without AI: angry or urgent wording, capitals, chasers, reopen and reassignment counts, time waiting, the VIP flag,
// the SLA, and a priority that looks too low for what the ticket shows. Each signal says why. From the `glance` read: no read of its own.

const LEVEL = { high: ['High', 'danger'], medium: ['Watch', 'warn'], low: ['Note', ''] };

export default function RiskCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const answer = ticket.data;
  const risk = useMemo(() => {
    if (!answer?.pack) return null;
    const slasRead = (answer.slas?.access || []).every((a) => a?.status === 'ok' || a?.status === 'empty');
    const outage = answer.outage ? outageSignal(answer.outage, answer.pack) : null;
    return riskSignals({ pack: answer.pack, slas: slasRead ? answer.slas?.items || [] : null, vip: answer.vip?.status === 'yes', outageCount: outage?.count || 0, now: Date.now() });
  }, [answer]);
  useReport(setSummary, risk ? risk.summary : '');
  useReport(setAttention, risk ? risk.attention : '');

  if (!risk) return <ReadState state={ticket} what="this ticket" onRetry={ticket.reload} />;
  return (
    <>
      <p className="ab-hint">Counted with word and count rules, not a judgement: they miss sarcasm and other languages.</p>
      {!risk.signals.length && <p className="ab-hint">Nothing in the wording, the counts or the SLA points to a risk.</p>}
      {risk.signals.length > 0 && (
        <ShowMore
          items={risk.signals}
          className="ab-chk-list"
          render={(s) => {
            const [word, tone] = LEVEL[s.level] || LEVEL.low;
            return (
              <div key={s.id} className="ab-chk-item" data-status={s.level === 'high' ? 'warn' : ''}>
                <span className="ab-chk-head">
                  <Tag tone={tone}>{word}</Tag> <span className="ab-chk-item-main">{s.title}</span>
                </span>
                <span className="ab-hint">{s.why}</span>
              </div>
            );
          }}
        />
      )}
      {!risk.customerKnown && risk.commentsRead > 0 && <p className="ab-hint">The customer could not be told apart from the agents, so the wording counts include everyone.</p>}
    </>
  );
}
