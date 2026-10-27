import { usePending, clearPending } from './pendingDraft.js';
import ResultView from './ResultView.jsx';

/**
 * The draft the agent carried to a blank form ("Open a new article form"). Shown only on a blank form of the table the
 * feature names, with the same Insert / Copy buttons as the result it came from.
 */
export default function PendingDraft({ page }) {
  const draft = usePending();
  const table = draft?.feature?.open?.table;
  if (!draft || !table || page.newRecord?.table !== table) return null;
  return (
    <ResultView
      feature={draft.feature}
      text={draft.text}
      page={page}
      people={draft.people}
      scan={draft.scan}
      onClose={clearPending}
      audit={() => {}}
    />
  );
}
