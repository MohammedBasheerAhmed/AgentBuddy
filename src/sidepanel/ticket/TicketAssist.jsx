import React from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiSkippedNote } from '../shell/shellParts.jsx';
import { ActionGroups } from './assist/actions/index.js';
import { AnswerArea, AskBox } from './assist/answers/index.js';
import { t } from '../../i18n/index.js';

/**
 * The Ticket screen's AI Assist half: the answers first (where the person looks), then a question box, then the actions grouped by
 * what the agent is doing. Every AI call goes through `assist.run` (useRun inside: permission, masking, preview, policy).
 *
 * props: page, eff, record, header, assist (useAnswers), ready (AI can be used now), active, onRun(feature, options)
 */
export default function TicketAssist({ page, eff, record, header, assist, ready, active, onRun }) {
  const key = `${record.table}:${record.sysId}`;
  if (eff.values?.aiSkipped) return <AiSkippedNote />;
  return (
    <>
      <AiKeyNote eff={eff} what="AI Assist" also={t('Insights works without a key.')} />
      <ErrorBoundary resetKey={key}>
        <AnswerArea assist={assist} page={page} eff={eff} record={record} active={active} />
      </ErrorBoundary>
      {ready && (
        <ErrorBoundary resetKey={`${key}:ask`}>
          <AskBox assist={assist} page={page} eff={eff} record={record} />
        </ErrorBoundary>
      )}
      <ErrorBoundary resetKey={`${key}:actions`}>
        {/* quiet: an answer is on screen with its own main button, so the actions draw no second filled button (one primary per screen). */}
        <ActionGroups page={page} eff={eff} record={record} header={header} busy={assist.busy} aiReady={ready} quiet={Array.isArray(assist.answers) && assist.answers.length > 0} onRun={onRun} />
      </ErrorBoundary>
    </>
  );
}
