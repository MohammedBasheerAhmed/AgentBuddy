import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { OUTAGE_RULE, outageSignal } from '../../../insights/outage.js';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ItemLink, Notes, ReadState } from './bits.jsx';

// N29, the outage spotter: other open tickets on the same configuration item or service. When at least three arrived in the last two
// hours the card turns red and the Glance shows a banner. From the `glance` read: no read of its own.

export default function OutageCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const pack = ticket.data?.pack || null;
  const sig = pack && ticket.data?.outage ? outageSignal(ticket.data.outage, pack) : null;
  useReport(setSummary, sig ? sig.line || sig.note : '');
  useReport(setAttention, sig?.over ? 'danger' : '');

  if (!sig) return <ReadState state={ticket} what="this ticket" onRetry={ticket.reload} />;
  const recentFirst = [...sig.hits].sort((a, b) => (a.hoursAgo ?? 1e9) - (b.hoursAgo ?? 1e9));
  return (
    <>
      {sig.over && (
        <p className="ab-note ab-note-danger" role="status">
          {sig.line}. This may be one outage: check for a parent incident before working it alone.
        </p>
      )}
      {!sig.over && sig.readable && <p className="ab-hint">{OUTAGE_RULE.threshold} or more in {OUTAGE_RULE.hours} hours counts as a possible outage.</p>}
      {sig.note && <p className="ab-hint">{sig.note}</p>}
      {recentFirst.length > 0 && (
        <ShowMore
          items={recentFirst}
          render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={[h.state, Number.isFinite(h.hoursAgo) ? `${h.hoursAgo} h ago` : '', h.assignment_group].filter(Boolean).join(' · ')} />}
        />
      )}
      <Notes access={ticket.data?.outage?.access} />
    </>
  );
}
