import { ShowMore } from '../../ui/primitives.jsx';
import { callerSummary, historyLine } from '../../../insights/related.js';
import { firstSentences } from '../../../insights/steps.js';
import { useHistory } from './data.js';
import { readFully, useReport } from './useInsight.js';
import { ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t, isolate } from '../../../i18n/index.js';

// Caller's other tickets (the "Same caller" row of the focus layout, docs/focus-layout.md): the caller's earlier tickets, with the
// repeat flag and the last fix that worked. It used to be the first group of "Related tickets" (N2); that card keeps the look-alikes
// and what is open on the same item, so nothing is shown twice. One read (the history, with the person's own session, the same one
// the caller briefing uses), only while the Insights half is on screen; every ticket opens in a new tab next to this one.

const list = (v) => (Array.isArray(v) ? v : []);

export default function CallerCard({ page, eff, record, active, setSummary, setAttention }) {
  const history = useHistory({ page, record, eff, active });
  const read = history.data && !history.error ? history.data : null;
  const sum = callerSummary({ history: read });
  // (The list keeps the last good answer while a new read fails, as every card does; the line and the status wait for a whole one.)
  const earlier = list(history.data?.items);
  useReport(setSummary, sum.line);
  // A repeat needs a look. Nothing earlier (or nobody named as the caller) is nothing to report, but only when the read saw everything:
  // a history that could not be read in full is not "no earlier tickets".
  const none = Boolean(read) && readFully(read.access) && (sum.noCaller || (sum.earlier === 0 && !sum.repeat));
  useReport(setAttention, sum.repeat ? 'warn' : none ? 'clear' : '');

  const sig = history.data?.signals;
  const name = history.data?.callerName;
  return (
    <>
      {sum.repeat && <p className="ab-note ab-note-warn">{sum.repeat}</p>}
      <p className="ab-ins-line ab-ins-caller-head">
        {name ? t('Earlier tickets from {name}', { name: isolate(name) }) : t('Earlier tickets from this person')}
        {history.data && !history.data.noCaller && <span className="ab-chip ab-chip-neutral ab-ins-count">{earlier.length}</span>}
      </p>
      <ReadState state={history} what={t('earlier tickets')} onRetry={history.reload} />
      {sig?.lastResolved && (
        <p className="ab-ins-fix">
          <strong>{t('Last fix that worked ({number}):', { number: sig.lastResolved.number })}</strong> {firstSentences(sig.lastResolved.close_notes, 220)}
        </p>
      )}
      {earlier.length > 0 && <ShowMore items={[...earlier].reverse()} render={(item) => <ItemLink key={item.sysId} page={page} item={item} line={historyLine(item)} />} />}
      {history.data && !earlier.length && <p className="ab-hint">{history.data.noCaller ? t('Nobody is named as the caller on this ticket.') : t('No earlier tickets from this person.')}</p>}
      <Notes access={history.data?.access} />
      <div className="ab-ins-foot">
        <QuietButton onClick={history.reload} disabled={history.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}
