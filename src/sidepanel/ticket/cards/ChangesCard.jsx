import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { arrangeChanges } from '../../../insights/changes.js';
import { useRecordRead } from './data.js';
import { useReport } from './useInsight.js';
import { ItemLink, Notes, ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N25, recent changes on this configuration item or service: changes whose window touched the last 7 days or touches the next 3.
// "What changed?" is the first question on an infrastructure incident. Read by the ticket's own CI and service ids.

export default function ChangesCard({ page, eff, record, active, setSummary, setAttention }) {
  const state = useRecordRead({ page, record, eff, active, op: 'ciChanges' });
  const data = state.data;
  const status = data?.access?.[0]?.status || '';
  const known = Boolean(data) && (status === 'ok' || status === 'empty');
  const { items, recent, summary } = arrangeChanges(data?.items, Date.now());
  useReport(setSummary, data ? (items.length ? summary : known ? 'None in the last 7 days' : status === 'skipped' ? 'No CI or service on this ticket' : '') : '');
  useReport(setAttention, recent > 0 ? 'warn' : '');

  if (!data) return <ReadState state={state} what="changes" onRetry={state.reload} />;
  return (
    <>
      {status === 'skipped' && <p className="ab-hint">{data.access[0].note}</p>}
      {known && !items.length && <p className="ab-hint">{t("No change on this ticket's configuration item or service in the last 7 days or the next 3.")}</p>}
      {items.length > 0 && (
        <ShowMore
          items={items}
          render={(c) => (
            <ItemLink
              key={c.sysId}
              page={page}
              item={c}
              line={[c.timing.line, c.state, c.type && `${c.type}${c.risk ? `, risk ${c.risk}` : ''}`].filter(Boolean).join(' · ')}
              extra={c.start || c.end ? `Window: ${c.start || '?'} to ${c.end || '?'}` : ''}
            />
          )}
        />
      )}
      <Notes access={data.access} />
    </>
  );
}
