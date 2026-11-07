import { useMemo } from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { outageSignal } from '../../../insights/outage.js';
import { riskSignals } from '../../../insights/risk.js';
import { Tag } from '../../checks/Bits.jsx';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N9, risk signals without AI: angry or urgent wording, capitals, chasers, reopen and reassignment counts, time waiting, the VIP flag,
// the SLA, and a priority that looks too low for what the ticket shows. Each signal says why. From the `glance` read: no read of its own.

const levelFor = (level) => {
  const levels = { high: [t('High'), 'danger'], medium: [t('Watch'), 'warn'], low: [t('Note'), ''] };
  return levels[level] || levels.low;
};

// The facts the signals need that the read could not see (R-20): "no warning signs" is said of what was read, and the rest is named.
export function factsNotRead(answer, outage) {
  const out = [];
  const pack = answer?.pack || {};
  const unreadable = Array.isArray(pack.unreadable) ? pack.unreadable : [];
  if (!(answer?.slas?.access || []).every((a) => a?.status === 'ok' || a?.status === 'empty')) out.push('sla');
  if ((answer?.vip?.access || []).length) out.push('vip');
  if (outage?.failed) out.push('outage');
  // (the customer's comments are what the wording counts read: a journal that came back without them is not a quiet one)
  if ((Array.isArray(pack.access) ? pack.access : []).some((a) => a?.source === 'journal' && (['denied', 'empty-or-hidden', 'error', 'blocked'].includes(a.status) || a.commentsHidden === true))) out.push('notes');
  if (unreadable.includes('reopen_count') || unreadable.includes('reassignment_count')) out.push('counts');
  return out;
}

export default function RiskCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const answer = ticket.data;
  const risk = useMemo(() => {
    if (!answer?.pack) return null;
    const slasRead = (answer.slas?.access || []).every((a) => a?.status === 'ok' || a?.status === 'empty');
    const outage = answer.outage ? outageSignal(answer.outage, answer.pack) : null;
    return riskSignals({ pack: answer.pack, slas: slasRead ? answer.slas?.items || [] : null, vip: answer.vip?.status === 'yes', outageCount: outage?.count || 0, now: Date.now(), notChecked: factsNotRead(answer, outage) });
  }, [answer]);
  useReport(setSummary, risk ? risk.summary : '');
  useReport(setAttention, risk ? risk.attention || (risk.signals.length || risk.notChecked.length ? '' : 'clear') : '');

  if (!risk) return <ReadState state={ticket} what={t('this ticket')} onRetry={ticket.reload} />;
  return (
    <>
      <p className="ab-hint">{t('Counted with word and count rules, not a judgement: they miss sarcasm and other languages.')}</p>
      {!risk.signals.length && !risk.notChecked.length && <p className="ab-hint">{t('Nothing in the wording, the counts or the SLA points to a risk.')}</p>}
      {risk.notChecked.length > 0 && <p className="ab-hint">{t('Could not check {list}, so a risk there would not show.', { list: risk.couldNot })}</p>}
      {risk.signals.length > 0 && (
        <ShowMore
          items={risk.signals}
          className="ab-chk-list"
          render={(s) => {
            const [word, tone] = levelFor(s.level);
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
      {!risk.customerKnown && risk.commentsRead > 0 && <p className="ab-hint">{t('The customer could not be told apart from the agents, so the wording counts include everyone.')}</p>}
    </>
  );
}
