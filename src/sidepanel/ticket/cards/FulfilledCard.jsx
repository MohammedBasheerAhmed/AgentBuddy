import { useMemo } from 'react';
import { fulfilledView } from '../../../insights/fulfilledBefore.js';
import { plainNote } from '../../plainAccess.js';
import { useRecordRead } from './data.js';
import { useReport } from './useInsight.js';
import { ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// Fulfilled before (wave 6, the catalog fulfiller), a card in the "Find the fix" row: the last completed tasks for the same catalog item,
// newest first, at most five. Each row opens the task in a new tab next to the ticket and says who did it (when the name can be read), how
// long it took and what its close notes say. ServiceNow cannot show this on the task; the fulfiller about to do the same work learns how it
// went last time and whom to ask. No AI and nothing sent anywhere: one limited read with the agent's own session, kept in panel memory.
//
// Honest: "none" is said only when the read completed ("No earlier tasks for this item that you can see"); a refusal, a hidden column or
// a read the instance did not apply is "Could not check", never "none"; the organisation blocking the table gives no line of its own, only
// the usual note under the card. src/insights/fulfilledBefore.js has the words, src/content/ops/fix.js the read.

export default function FulfilledCard({ page, eff, record, active, setSummary, setAttention }) {
  const state = useRecordRead({ page, record, eff, active, op: 'fulfilledBefore', name: 'fulfilled' });
  const view = useMemo(() => (state.data && !state.error ? fulfilledView(state.data) : null), [state.data, state.error]);
  useReport(setSummary, view ? view.summary : '');
  useReport(setAttention, view ? view.attention : '');

  if (!view) return <ReadState state={state} what={t('earlier tasks for this item')} onRetry={state.reload} />;
  return (
    <>
      {view.items.length > 0 && (
        <div className="ab-list" data-fact="fulfilled">
          {view.items.map((x) => (
            <div key={x.key} className="ab-ins-step" data-fulfilled="row">
              <ItemLink page={page} item={{ table: x.table, sysId: x.sysId, number: x.number, short_description: x.short_description }} line={x.line} extra={x.extra} />
            </div>
          ))}
        </div>
      )}
      {view.state === 'none' && <p className="ab-hint">{view.summary}</p>}
      {view.state === 'skipped' && view.note && <p className="ab-hint">{plainNote(view.note)}</p>}
      {/* what could not be read, in plain words (a refusal, a hidden part, the organisation's rule); nothing when all was seen */}
      <Notes access={state.data.access} />
      <div className="ab-ins-foot">
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}
