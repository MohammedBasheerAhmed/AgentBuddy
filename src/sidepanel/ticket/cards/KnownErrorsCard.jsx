import { ShowMore } from '../../ui/primitives.jsx';
import { arrangeProblems } from '../../../insights/changes.js';
import { useRecordRead } from './data.js';
import { useReport } from './useInsight.js';
import { CopyButton, ItemLink, Notes, ReadState } from './bits.jsx';
import { t, tn, isolate } from '../../../i18n/index.js';

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
  const openProblems = items.length - knownErrors;
  useReport(
    setSummary,
    data
      ? items.length
        ? [
            knownErrors > 0 && tn(knownErrors, '{n} known error', '{n} known errors'),
            openProblems > 0 && tn(openProblems, '{n} open problem', '{n} open problems'),
            withWorkaround > 0 && t('{n} with a workaround', { n: withWorkaround }),
          ]
            .filter(Boolean)
            .join(' · ')
        : known
          ? t('None on this item')
          : status === 'skipped'
            ? t('No CI or service on this ticket')
            : ''
      : ''
  );
  useReport(setAttention, withWorkaround ? 'warn' : '');

  if (!data) return <ReadState state={state} what={t('problems')} onRetry={state.reload} />;
  return (
    <>
      {status === 'skipped' && <p className="ab-hint">{data.access[0].note}</p>}
      {known && !items.length && <p className="ab-hint">{t("No open problem or known error on this ticket's configuration item or service.")}</p>}
      {items.length > 0 && (
        <ShowMore
          items={items}
          render={(p) => (
            <div key={p.sysId} className="ab-ins-row">
              <ItemLink page={page} item={p} line={[p.knownError ? t('Known error') : t('Problem'), p.state, p.priority].filter(Boolean).join(' · ')} extra={p.workaround ? t('Workaround: {text}', { text: isolate(clip(p.workaround, 220)) }) : ''} />
              {p.workaround && <CopyButton value={p.workaround} label={t('Copy workaround')} />}
            </div>
          )}
        />
      )}
      <Notes access={data.access} />
    </>
  );
}
