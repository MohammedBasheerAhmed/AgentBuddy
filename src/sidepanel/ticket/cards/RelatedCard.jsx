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

export default function RelatedCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const look = useLookalikes({ page, record, eff, active });

  const pack = ticket.data?.pack || null;
  const outage = pack && ticket.data?.outage ? outageSignal(ticket.data.outage, pack) : null;
  const hits = list(look.data?.hits);
  const sum = relatedSummary({ lookalikes: look.data && !look.error ? hits : null, open: outage?.readable ? outage.hits : null });
  useReport(setSummary, sum.line);
  // No solved look-alike and nothing else open on the item: nothing to report. Only when the look-alikes came back whole: a search
  // that could not see everything is not "none".
  const none = Boolean(look.data && !look.error) && readFully(look.data?.access) && sum.solved === 0 && (!outage?.readable || !outage.hits.length);
  useReport(setAttention, none ? 'clear' : '');

  const refresh = () => {
    ticket.reload();
    look.reload();
  };

  return (
    <>
      <Group title={t('Solved look-alikes')} count={look.data ? hits.length : undefined}>
        <ReadState state={look} what={t('solved tickets like this one')} onRetry={look.reload} />
        {hits.length > 0 && (
          <ShowMore
            items={hits}
            render={(h) => <ItemLink key={h.sysId} page={page} item={h} line={list(h.why).slice(0, 2).join('; ')} extra={h.close_notes ? t('Fix: {text}', { text: isolate(firstSentences(h.close_notes, 160)) }) : ''} />}
          />
        )}
        {look.data && !hits.length && <p className="ab-hint">{t('No similar solved tickets found.')}</p>}
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
