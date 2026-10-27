import { useEffect, useState } from 'react';
import { usePending, clearPending, pendingFits } from './pendingDraft.js';
import ResultView from './ResultView.jsx';
import { auditInsert } from '../lib/storage.js';

/**
 * The draft the agent carried to a blank form ("Open a new article form"). Shown only on a blank form of the table the feature
 * names, only on the ServiceNow site it was written on, and only for 15 minutes (src/sidepanel/pendingDraft.js). Insert / Copy work
 * as on the result it came from. After a successful insert the draft is dropped; closing it drops it too.
 *
 * props: page, eff? (for the privacy mode in the audit entry)
 */
export default function PendingDraft({ page, eff }) {
  const draft = usePending();
  const [inserted, setInserted] = useState(null); // { table } after a successful insert: one line of confirmation until it is closed
  useEffect(() => {
    if (draft) setInserted(null);
  }, [draft]);

  if (!draft) {
    return inserted && page.newRecord?.table === inserted.table ? (
      <p className="ab-note ab-note-ok" role="status">
        Inserted into the form. Review it, then save the record yourself.{' '}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setInserted(null)}>Close</button>
      </p>
    ) : null;
  }
  if (!pendingFits(draft, page)) return null;
  const table = draft.feature.open.table;
  return (
    <ResultView
      feature={draft.feature}
      text={draft.text}
      page={page}
      people={draft.people}
      scan={draft.scan}
      internalTexts={draft.internalTexts}
      // The draft goes into a blank form of the table the feature names, nowhere else.
      target={{ table, newRecord: true }}
      onInserted={() => {
        setInserted({ table });
        clearPending();
      }}
      onClose={clearPending}
      audit={(outcome) => auditInsert({ feature: draft.feature.id, table, sysId: '', mode: eff?.values?.piiMode, outcome })}
    />
  );
}
