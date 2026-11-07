import { ShowMore } from '../../ui/primitives.jsx';
import { arrangeChanges } from '../../../insights/changes.js';
import { useRecordRead } from './data.js';
import { readFully, useReport } from './useInsight.js';
import { ItemLink, Notes, ReadState } from './bits.jsx';
import { plainNote } from '../../plainAccess.js';
import { t, isolate } from '../../../i18n/index.js';

// N25, recent changes on this configuration item or service: changes whose window touched the last 7 days or touches the next 3.
// "What changed?" is the first question on an infrastructure incident. Read by the ticket's own CI and service ids.

export default function ChangesCard({ page, eff, record, active, setSummary, setAttention }) {
  const state = useRecordRead({ page, record, eff, active, op: 'ciChanges' });
  const data = state.data;
  const status = data?.access?.[0]?.status || '';
  const known = Boolean(data) && (status === 'ok' || status === 'empty');
  // "No CI or service on this ticket" is a fact only when the read says the ticket has none (noTarget); a skip for another reason (a
  // sensitive ticket) and a column that could not be read are not, and a read that could not see everything is not "none" (R-04, R-14).
  const noTarget = Boolean(data?.noTarget);
  const failed = Boolean(data) && !readFully(data.access);
  const { items, recent, summary } = arrangeChanges(data?.items, Date.now());
  useReport(setSummary, data ? (items.length ? summary : known ? t('None in the last 7 days') : noTarget ? t('No CI or service on this ticket') : failed ? t('Could not check changes') : '') : '');
  useReport(setAttention, recent > 0 ? 'warn' : data && !items.length && (known || noTarget) ? 'clear' : '');

  if (!data) return <ReadState state={state} what={t('changes')} onRetry={state.reload} />;
  return (
    <>
      {status === 'skipped' && !items.length && <p className="ab-hint">{plainNote(data.access[0].note)}</p>}
      {known && !items.length && <p className="ab-hint">{t("No change on this ticket's configuration item or service in the last 7 days or the next 3.")}</p>}
      {items.length > 0 && (
        <ShowMore
          items={items}
          render={(c) => (
            <ItemLink
              key={c.sysId}
              page={page}
              item={c}
              line={[c.timing.line, c.state, c.type && (c.risk ? t('{type}, risk {risk}', { type: isolate(c.type), risk: isolate(c.risk) }) : c.type)].filter(Boolean).join(' · ')}
              extra={c.start || c.end ? t('Window: {start} to {end}', { start: isolate(c.start || '?'), end: isolate(c.end || '?') }) : ''}
            />
          )}
        />
      )}
      <Notes access={data.access} />
    </>
  );
}
