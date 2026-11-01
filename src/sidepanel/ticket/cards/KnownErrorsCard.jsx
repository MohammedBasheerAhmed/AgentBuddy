import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { arrangeProblems } from '../../../insights/changes.js';
import { useRecordRead } from './data.js';
import { useReport } from './useInsight.js';
import { CopyButton, ItemLink, Notes, ReadState } from './bits.jsx';

// N26, known errors and open problems for this configuration item or service, workaround first: a fix may already exist.

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || '');

export default function KnownErrorsCard({ page, eff, record, active, setSummary, setAttention }) {
  const state = useRecordRead({ page, record, eff, active, op: 'knownErrors' });
  const data = state.data;
  const status = data?.access?.[0]?.status || '';
  const known = Boolean(data) && (status === 'ok' || status === 'empty');
  const items = arrangeProblems(data?.items);
  const withWorkaround = items.filter((p) => p.workaround).length;
  const knownErrors = items.filter((p) => p.knownError).length;
  useReport(
    setSummary,
    data
      ? items.length
        ? [knownErrors && `${knownErrors} known error${knownErrors === 1 ? '' : 's'}`, `${items.length - knownErrors} open problem${items.length - knownErrors === 1 ? '' : 's'}`, withWorkaround && `${withWorkaround} with a workaround`].filter((x) => x && !/^0 /.test(x)).join(' · ')
        : known
          ? 'None on this item'
          : status === 'skipped'
            ? 'No CI or service on this ticket'
            : ''
      : ''
  );
  useReport(setAttention, withWorkaround ? 'warn' : '');

  if (!data) return <ReadState state={state} what="problems" onRetry={state.reload} />;
  return (
    <>
      {status === 'skipped' && <p className="ab-hint">{data.access[0].note}</p>}
      {known && !items.length && <p className="ab-hint">No open problem or known error on this ticket's configuration item or service.</p>}
      {items.length > 0 && (
        <ShowMore
          items={items}
          render={(p) => (
            <div key={p.sysId} className="ab-ins-row">
              <ItemLink page={page} item={p} line={[p.knownError ? 'Known error' : 'Problem', p.state, p.priority].filter(Boolean).join(' · ')} extra={p.workaround ? `Workaround: ${clip(p.workaround, 220)}` : ''} />
              {p.workaround && <CopyButton value={p.workaround} label="Copy workaround" />}
            </div>
          )}
        />
      )}
      <Notes access={data.access} />
    </>
  );
}
