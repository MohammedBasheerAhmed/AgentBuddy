import { useMemo } from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { buildJourney, journeySummary } from '../../../insights/journey.js';
import { relativeText } from '../../../insights/time.js';
import { useRecordRead, useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ReadState } from './bits.jsx';
import { plainNote } from '../../plainAccess.js';
import { getLanguage, t, tn, isolate } from '../../../i18n/index.js';

// N24, the ticket journey: opened, assigned and passed between groups, state changes, the conversation's key moments, SLA events,
// resolved. Newest first, three then "Show all". The path between groups needs the field history, which many users may not read;
// then the card says so and shows the counts.

export default function JourneyCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  // (the labels of the states and priorities come in the panel's language where the instance has them; the key follows the language)
  const language = getLanguage();
  const audit = useRecordRead({ page, record, eff, active, op: 'journey', args: { language }, name: `journey:${language}` });
  const answer = ticket.data;
  const journey = useMemo(() => {
    if (!answer?.pack) return null;
    const slasRead = (answer.slas?.access || []).every((a) => a?.status === 'ok' || a?.status === 'empty');
    return buildJourney({ pack: answer.pack, slas: slasRead ? answer.slas?.items || [] : null, audit: audit.data || null, now: Date.now() });
  }, [answer, audit.data]);
  useReport(setSummary, journey ? journeySummary(journey) : '');
  useReport(setAttention, journey && journey.reassignments !== null && journey.reassignments >= 3 ? 'warn' : '');

  if (!journey) return <ReadState state={ticket} what={t('this ticket')} onRetry={ticket.reload} />;
  const now = Date.now();
  const newestFirst = [...journey.events].reverse();
  return (
    <>
      {journey.path.length > 1 && (
        <p className="ab-ins-line">
          {t('Path: {path}', { path: isolate(journey.path.join(' > ')) })}
        </p>
      )}
      {(journey.reassignments !== null || journey.reopens) && (
        <p className="ab-hint">
          {[
            journey.reassignments !== null && tn(journey.reassignments, 'Reassigned {n} time', 'Reassigned {n} times'),
            journey.reopens ? tn(journey.reopens, 'reopened {n} time', 'reopened {n} times') : '',
            journey.now.group && (journey.now.owner ? t('now with {group} ({owner})', { group: isolate(journey.now.group), owner: isolate(journey.now.owner) }) : t('now with {group}', { group: isolate(journey.now.group) })),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {newestFirst.length > 0 ? (
        <ShowMore
          items={newestFirst}
          className="ab-ins-timeline"
          render={(e, i) => (
            <div key={`${e.kind}:${e.at}:${i}`} className="ab-ins-event">
              <span className="ab-ins-when">{e.approx ? t('about {when}', { when: relativeText(e.at, now) }) : relativeText(e.at, now)}</span>
              <span className="ab-ins-what">
                {e.label}
                {e.detail && <span className="ab-ins-detail"> {e.detail}</span>}
              </span>
            </div>
          )}
        />
      ) : (
        <p className="ab-hint">{t('No dated events could be read for this ticket.')}</p>
      )}
      {audit.phase === 'loading' && !audit.data && <p className="ab-hint" role="status">{t('Reading the ticket history…')}</p>}
      {journey.note && audit.data && <p className="ab-hint">{plainNote(journey.note)}</p>}
    </>
  );
}
