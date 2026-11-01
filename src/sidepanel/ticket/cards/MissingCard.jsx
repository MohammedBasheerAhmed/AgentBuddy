import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { missingDetails } from '../../../insights/missing.js';
import { stateBucket } from '../../../insights/order.js';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N11, missing details: key facts that are empty or vague (configuration item, who else is affected, the error text, a way to reach
// the caller, steps to reproduce), each with why it matters. Plain rules on the `glance` read. The AI "questions to ask" is in AI Assist.

export default function MissingCard({ page, eff, record, header, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const pack = ticket.data?.pack;
  const result = pack ? missingDetails(pack) : null;
  const n = result?.items.length || 0;
  useReport(setSummary, result ? (n ? t('{n} to ask about: {list}', { n, list: `${result.items.slice(0, 2).map((i) => i.short).join(t(', '))}${n > 2 ? '…' : ''}` }) : t('Nothing obvious missing')) : '');
  useReport(setAttention, n >= 2 && stateBucket(header?.state) === 'new' ? 'warn' : '');

  if (!result) return <ReadState state={ticket} what={t('this ticket')} onRetry={ticket.reload} />;
  return (
    <>
      {!result.textRead && <p className="ab-hint">{t('The text of this record is not read (a sensitive record), so only the fields are checked.')}</p>}
      {!n && <p className="ab-hint">{t('The key details are there: a configuration item, a description with the error, who is affected and how to reach them.')}</p>}
      {n > 0 && (
        <ShowMore
          items={result.items}
          className="ab-chk-list"
          render={(i) => (
            <div key={i.id} className="ab-chk-item">
              <span className="ab-chk-item-main">{i.title}</span>
              <span className="ab-hint">{i.why}</span>
            </div>
          )}
        />
      )}
    </>
  );
}
