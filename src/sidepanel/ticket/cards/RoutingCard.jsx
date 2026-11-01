import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { routingVote } from '../../../insights/routing.js';
import { useLookalikes, useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ItemLink, Notes, ReadState } from './bits.jsx';

// N10, where similar tickets went: a count over the solved look-alikes' own assignment groups and categories. A hint for routing, not
// a rule; the AI version (with reasons) is in AI Assist.

export default function RoutingCard({ page, eff, record, active, setSummary }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const look = useLookalikes({ page, record, eff, active });
  const fields = ticket.data?.pack?.fields || {};
  const hits = Array.isArray(look.data?.hits) ? look.data.hits : [];
  const vote = routingVote(hits, { group: fields.assignment_group, category: fields.category });
  useReport(setSummary, look.data && !look.error ? (vote.enough ? vote.line : 'Too few solved look-alikes to tell') : '');

  if (!look.data || look.error) return <ReadState state={look} what="solved tickets like this one" onRetry={look.reload} />;
  if (!vote.enough) {
    return (
      <>
        <p className="ab-hint">{hits.length ? 'The solved look-alikes found do not say which group solved them.' : 'No solved look-alikes were found, so there is nothing to count.'}</p>
        <Notes access={look.data.access} />
      </>
    );
  }
  const examples = hits.filter((h) => vote.group && String(h.assignment_group || '').trim().toLowerCase() === vote.group.name.toLowerCase());
  const others = vote.groups.slice(1);
  return (
    <>
      <p className={`ab-ins-line${vote.strong ? '' : ' ab-ins-soft'}`}>{vote.line}.</p>
      {vote.detail && <p className="ab-hint">{vote.detail}</p>}
      {!vote.strong && <p className="ab-hint">The look-alikes do not agree much: treat this as a weak hint.</p>}
      {examples.length > 0 && <ShowMore items={examples} render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={[h.category, h.subcategory].filter(Boolean).join(' / ')} />} />}
      {others.length > 0 && <p className="ab-hint">Also: {others.map((g) => `${g.name} (${g.count})`).join(', ')}.</p>}
      <Notes access={look.data.access} />
    </>
  );
}
