import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiSkippedNote } from '../shell/shellParts.jsx';
import { useAllTools } from '../palette/allToolsContext.js';
import { FocusActions } from './assist/actions/index.js';
import { AnswerArea, AskBox } from './assist/answers/index.js';
import MoreTools from './MoreTools.jsx';
import { t, tn } from '../../i18n/index.js';

/**
 * The Ticket screen's AI Assist half (docs/focus-layout.md, A), from the top: "Ask about this ticket" when it was asked for (All tools),
 * the five actions (one per pain point; the one that fits the ticket's state best carries "Start"), the answers (with the run going
 * on, its check before sending and its errors), then a quiet way to the record's other actions in All tools. Every AI call goes
 * through `assist.run` (useRun inside: permission, masking, preview, policy).
 *
 * props: page, eff, record, header, assist (useAnswers), plan (useActionPlan: the screen works it out once, for this half and for the
 *        side rail, which lists the same five), ready (AI can be used now), active, onRun(feature, options),
 *        ask ({ at } once "Ask about this ticket" was asked for on this record, else null: then the box is not drawn)
 */
export default function TicketAssist({ page, eff, record, assist, plan, ready, active, onRun, ask = null }) {
  const key = `${record.table}:${record.sysId}`;
  const openAllTools = useAllTools();
  if (eff.values?.aiSkipped) return <AiSkippedNote />;
  // An answer is on screen with its own main button: no row is filled then (one filled button per screen).
  const quiet = Array.isArray(assist.answers) && assist.answers.length > 0;
  const more = plan.rest?.length || 0;
  return (
    <>
      <AiKeyNote eff={eff} what="AI Assist" also={t('Insights works without a key.')} />
      {ready && ask && (
        <ErrorBoundary resetKey={`${key}:ask`}>
          <AskBox assist={assist} page={page} eff={eff} record={record} focusAt={ask.at} />
        </ErrorBoundary>
      )}
      <ErrorBoundary resetKey={`${key}:actions`}>
        <FocusActions plan={plan} eff={eff} busy={assist.busy} aiReady={ready} quiet={quiet} onRun={onRun} />
      </ErrorBoundary>
      <ErrorBoundary resetKey={key}>
        <AnswerArea assist={assist} page={page} eff={eff} record={record} active={active} />
      </ErrorBoundary>
      {more > 0 && <MoreTools label={tn(more, 'More for this ticket: {n} AI action', 'More for this ticket: {n} AI actions')} onOpen={() => openAllTools('ticket-assist')} />}
    </>
  );
}
