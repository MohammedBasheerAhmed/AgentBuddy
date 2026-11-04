import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiSkippedNote } from '../shell/shellParts.jsx';
import { MoreActions, SuggestedActions, useActionPlan } from './assist/actions/index.js';
import { AnswerArea, AskBox } from './assist/answers/index.js';
import { t } from '../../i18n/index.js';

/**
 * The Ticket screen's AI Assist half, from the top: "Ask about this ticket", the actions suggested for the ticket's state, the answers
 * (with the run going on, its check before sending and its errors), then "More actions". Every AI call goes through `assist.run` (useRun
 * inside: permission, masking, preview, policy).
 *
 * props: page, eff, record, header, assist (useAnswers), ready (AI can be used now), active, onRun(feature, options)
 */
export default function TicketAssist({ page, eff, record, header, assist, ready, active, onRun }) {
  const key = `${record.table}:${record.sysId}`;
  if (eff.values?.aiSkipped) return <AiSkippedNote />;
  return <AssistBody page={page} eff={eff} record={record} header={header} assist={assist} ready={ready} active={active} onRun={onRun} recordKey={key} />;
}

// (A component of its own, so the plan's hooks run only where the half is drawn: never next to "AI Assist is off".)
function AssistBody({ page, eff, record, header, assist, ready, active, onRun, recordKey: key }) {
  const plan = useActionPlan({ page, eff, record, header, aiReady: ready });
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
