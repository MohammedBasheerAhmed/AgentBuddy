import { ShowMore } from '../../ui/primitives.jsx';
import { outageSignal } from '../../../insights/outage.js';
import { historyLine, relatedSummary } from '../../../insights/related.js';
import { firstSentences } from '../../../insights/steps.js';
import { useHistory, useLookalikes, useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { Group, ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t, isolate } from '../../../i18n/index.js';

// N2, related tickets: the caller's earlier tickets (with the repeat flag and the last fix that worked), solved look-alikes, and other
// open tickets on the same item. Folded groups with counts, three items each, then "Show all". Every ticket opens in a new tab next to
// this one, so the ticket being worked on stays where it is.

const list = (v) => (Array.isArray(v) ? v : []);

export default function RelatedCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const history = useHistory({ page, record, eff, active });
  const look = useLookalikes({ page, record, eff, active });

  const pack = ticket.data?.pack || null;
  const outage = pack && ticket.data?.outage ? outageSignal(ticket.data.outage, pack) : null;
  const earlier = list(history.data?.items);
  const hits = list(look.data?.hits);
  const sum = relatedSummary({ history: history.data && !history.error ? history.data : null, lookalikes: look.data && !look.error ? hits : null, open: outage?.readable ? outage.hits : null });
  useReport(setSummary, sum.line);
  useReport(setAttention, sum.repeat ? 'warn' : '');

  const sig = history.data?.signals;
  const name = history.data?.callerName;
  const refresh = () => {
    ticket.reload();
    history.reload();
    look.reload();
  };

  return (
    <>
      {sum.repeat && <p className="ab-note ab-note-warn">{sum.repeat}</p>}

      <Group title={name ? t('Earlier tickets from {name}', { name: isolate(name) }) : t('Earlier tickets from this person')} count={history.data ? earlier.length : undefined}>
        <ReadState state={history} what={t('earlier tickets')} onRetry={history.reload} />
        {sig?.lastResolved && (
          <p className="ab-ins-fix">
            <strong>{t('Last fix that worked ({number}):', { number: sig.lastResolved.number })}</strong> {firstSentences(sig.lastResolved.close_notes, 220)}
          </p>
        )}
        {earlier.length > 0 && <ShowMore items={[...earlier].reverse()} render={(item) => <ItemLink key={item.sysId} page={page} item={item} line={historyLine(item)} />} />}
        {history.data && !earlier.length && <p className="ab-hint">{history.data.noCaller ? t('Nobody is named as the caller on this ticket.') : t('No earlier tickets from this person.')}</p>}
        <Notes access={history.data?.access} />
      </Group>

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
        <QuietButton onClick={refresh} disabled={history.phase === 'loading' || look.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}
