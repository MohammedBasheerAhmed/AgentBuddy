import { ShowMore } from '../../ui/primitives.jsx';
import { routingVote } from '../../../insights/routing.js';
import { useLookalikes, useTicketFacts } from './data.js';
import { readFully, useReport } from './useInsight.js';
import { ItemLink, Notes, ReadState } from './bits.jsx';
import { t, isolate } from '../../../i18n/index.js';

// N10, where similar tickets went: a count over the solved look-alikes' own assignment groups and categories. A hint for routing, not
// a rule; the AI version (with reasons) is in AI Assist.

export default function RoutingCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const look = useLookalikes({ page, record, eff, active });
  const fields = ticket.data?.pack?.fields || {};
  const hits = Array.isArray(look.data?.hits) ? look.data.hits : [];
  const unreadable = Array.isArray(ticket.data?.pack?.unreadable) ? ticket.data.pack.unreadable : [];
  const vote = routingVote(hits, { group: fields.assignment_group, category: fields.category, groupUnreadable: unreadable.includes('assignment_group') });
  useReport(setSummary, look.data && !look.error ? (vote.enough ? vote.line : t('Too few solved look-alikes to tell')) : '');
  useReport(setAttention, look.data && !look.error && !vote.enough && readFully(look.data.access) ? 'clear' : '');

  if (!look.data || look.error) return <ReadState state={look} what={t('solved tickets like this one')} onRetry={look.reload} />;
  if (!vote.enough) {
    return (
      <>
        <p className="ab-hint">{hits.length ? (vote.inactive ? t('Groups that are no longer in use were left out, and too few look-alikes are left to tell.') : t('The solved look-alikes found do not say which group solved them.')) : readFully(look.data.access) ? t('No solved look-alikes were found, so there is nothing to count.') : t('No solved look-alikes were found, but some could not be checked.')}</p>
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
      {!vote.strong && <p className="ab-hint">{t('The look-alikes do not agree much: treat this as a weak hint.')}</p>}
      {examples.length > 0 && <ShowMore items={examples} render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={[h.category, h.subcategory].filter(Boolean).join(' / ')} />} />}
      {others.length > 0 && <p className="ab-hint">{t('Also: {groups}.', { groups: others.map((g) => `${isolate(g.name)} (${g.count})`).join(t(', ')) })}</p>}
      <Notes access={look.data.access} />
    </>
  );
}
