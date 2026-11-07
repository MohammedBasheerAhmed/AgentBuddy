import { ShowMore } from '../../ui/primitives.jsx';
import { outageSignal } from '../../../insights/outage.js';
import { relatedSummary } from '../../../insights/related.js';
import { firstSentences } from '../../../insights/steps.js';
import { useLookalikes, useTicketFacts } from './data.js';
import { readFully, useReport } from './useInsight.js';
import { Group, ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t, isolate } from '../../../i18n/index.js';

// N2, related tickets: solved look-alikes and other open tickets on the same item. Folded groups with counts, three items each, then
// "Show all". Every ticket opens in a new tab next to this one, so the ticket being worked on stays where it is. The caller's earlier
// tickets have their own card since the focus layout ("Caller's other tickets", CallerCard.jsx): nothing is shown twice.

const list = (v) => (Array.isArray(v) ? v : []);

// What the card says when no solved look-alike is listed: "found" is about what the search saw (only the newest matches are read, and a
// row rule can hide tickets), and a search that could not see everything says so instead of "none".
function noLookalikes(seen, truncated) {
  if (!seen) return t('No similar solved tickets found, but some could not be checked.');
  return truncated ? t('No similar solved ticket found among the newest matches.') : t('No similar solved tickets found.');
}

export default function RelatedCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const look = useLookalikes({ page, record, eff, active });

  const pack = ticket.data?.pack || null;
  const outage = pack && ticket.data?.outage ? outageSignal(ticket.data.outage, pack) : null;
  const hits = list(look.data?.hits);
  const lookRead = Boolean(look.data && !look.error);
  // A search that could not see everything (denied, failed, blocked, or hidden rows) is not "none" (R-03, R-09).
  const lookSeen = lookRead && readFully(look.data?.access);
  const sum = relatedSummary({ lookalikes: lookRead ? hits : null, open: outage?.readable ? outage.hits : null, lookalikesSeen: lookSeen });
  useReport(setSummary, sum.line);
  // No solved look-alike and nothing else open on the item: nothing to report. Only when the look-alikes came back whole, and the
  // check of the item (when it could be made) did not fail either.
  const none = lookSeen && sum.solved === 0 && (!outage || outage.checked || !outage.failed) && (!outage?.readable || !outage.hits.length);
  useReport(setAttention, none ? 'clear' : '');

  const refresh = () => {
    ticket.reload();
    look.reload();
  };

  return (
    <>
      <Group title={t('Solved look-alikes')} count={look.data && (hits.length > 0 || lookSeen) ? hits.length : undefined}>
        <ReadState state={look} what={t('solved tickets like this one')} onRetry={look.reload} />
        {hits.length > 0 && (
          <ShowMore
            items={hits}
            render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={list(h.why).slice(0, 2).join('; ')} extra={h.close_notes ? t('Fix: {text}', { text: isolate(firstSentences(h.close_notes, 160)) }) : ''} />}
          />
        )}
        {lookRead && !hits.length && <p className="ab-hint">{noLookalikes(lookSeen, look.data?.truncated)}</p>}
        <Notes access={look.data?.access} />
      </Group>

      {outage && outage.hits.length > 0 && (
        <Group title={t('Open on the same item')} count={outage.hits.length}>
          <ShowMore
            items={outage.hits}
            render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={[h.state, Number.isFinite(h.hoursAgo) ? t('{hours} h ago', { hours: h.hoursAgo }) : '', h.assignment_group].filter(Boolean).join(' · ')} />}
          />
        </Group>
      )}

      <div className="ab-ins-foot">
        <QuietButton onClick={refresh} disabled={look.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}
