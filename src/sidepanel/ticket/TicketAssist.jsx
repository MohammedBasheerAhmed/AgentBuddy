import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiSkippedNote } from '../shell/shellParts.jsx';
import { MoreActions, SuggestedActions } from './assist/actions/index.js';
import { AnswerArea, AskBox } from './assist/answers/index.js';
import { t } from '../../i18n/index.js';

/**
 * The Ticket screen's AI Assist half, from the top: "Ask about this ticket", the actions suggested for the ticket's state, the answers
 * (with the run going on, its check before sending and its errors), then "More actions". Every AI call goes through `assist.run` (useRun
 * inside: permission, masking, preview, policy).
 *
 * props: page, eff, record, header, assist (useAnswers), plan (useActionPlan: the screen works it out once, for this half and for the
 *        side rail, which lists every action of it), ready (AI can be used now), active, onRun(feature, options)
 */
export default function TicketAssist({ page, eff, record, assist, plan, ready, active, onRun }) {
  const key = `${record.table}:${record.sysId}`;
  if (eff.values?.aiSkipped) return <AiSkippedNote />;
  // An answer is on screen with its own main button: the first suggestion is not filled then (one filled button per screen).
  const quiet = Array.isArray(assist.answers) && assist.answers.length > 0;
  return (
    <>
      <AiKeyNote eff={eff} what="AI Assist" also={t('Insights works without a key.')} />
      {ready && (
        <ErrorBoundary resetKey={`${key}:ask`}>
          <AskBox assist={assist} page={page} eff={eff} record={record} />
        </ErrorBoundary>
      )}
      <ErrorBoundary resetKey={`${key}:actions`}>
        <SuggestedActions plan={plan} eff={eff} busy={assist.busy} aiReady={ready} quiet={quiet} onRun={onRun} />
      </ErrorBoundary>
      <ErrorBoundary resetKey={key}>
        <AnswerArea assist={assist} page={page} eff={eff} record={record} active={active} />
      </ErrorBoundary>
      <ErrorBoundary resetKey={`${key}:more`}>
        <MoreActions plan={plan} eff={eff} busy={assist.busy} aiReady={ready} onRun={onRun} />
      </ErrorBoundary>
    </>
  );
}
