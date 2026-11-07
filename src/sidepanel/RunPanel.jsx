import PreviewDialog, { previewKey } from './PreviewDialog.jsx';
import ResultView from './ResultView.jsx';
import { resolveProviderConfig } from '../providers/config.js';
import { auditInsert } from '../lib/storage.js';
import { auditRefFromPage, sourceFromPack } from '../lib/fillable.js';
import { madeWithoutLine, previewCheck } from './runLogic.js';
import { madeWithoutText } from '../features/parts.js';
import { RunError, RunProgress } from './ticket/assist/answers/RunStatus.jsx';
import { t } from '../i18n/index.js';

const NO_TEXTS = [];

/**
 * Shows the state of a run from useRun(): progress, the error, the preview of exactly what will be sent, and the result
 * with Insert / Copy. Put it anywhere in a view; it renders nothing while the run is idle.
 *
 * The result knows which record it was written for: the record that was open when the run started (so a message explained for a
 * requested item but written from its task still goes into the task's form, and into no other). Insert is offered only while that
 * record is the one that is open. A draft that copies words from an internal work note is flagged before it goes into a field the
 * customer can read: those notes come from `run.lastPack.internalTexts` when the run provides them.
 *
 * Round 3: while the AI is asked it shows the seconds and the try after a busy answer (RunProgress); an error offers the step that
 * can fix it (RunError: Try again, Open Settings); the check before sending is the short one for look-alike tickets after the first
 * time (runLogic previewStyle); and the answer says what it was made without.
 *
 * props: run (from useRun), eff, page, readingText? (what to say while the data is being read)
 */
export default function RunPanel({ run, eff, page, readingText = t('Reading the ticket as you…') }) {
  const { phase, prepared, active, result, error, people, scan, lastPack } = run;
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  // The record that was open when the run started (its number is for the message when another one is open later): the run takes it
  // once, as it starts, and keeps it while it reads and after (src/sidepanel/useRun.js `source`).
  const source = run.source && run.source.expect ? run.source : null;
  // The audit entry names the record the pack was about; a pasted text (Rewrite, Notes) is audited against the page it was used on.
  const ref = sourceFromPack(lastPack) ? lastPack : auditRefFromPage(page);
  // The short check for an action that uses other records and was checked in full before (runLogic previewCheck).
  const { others, short } = previewCheck(phase === 'preview' ? prepared : null, eff.values);
  return (
    <>
      <RunProgress run={run} onStop={run.reset} readingText={readingText} />

      {phase === 'error' && <RunError error={error} code={run.errorCode} onRetry={run.again} />}

      {phase === 'preview' && prepared && (
        <PreviewDialog
          key={previewKey(prepared.p)}
          feature={prepared.p.feature}
          prepared={prepared.p}
          config={prepared.cfg}
          canSkipNext={eff.values.previewMode === 'first'}
          short={short}
          others={others}
          onSend={run.confirmPreview}
          onCancel={run.cancelPreview}
          onMask={run.maskMore}
        />
      )}

      {phase === 'done' && result !== null && active && run.notice && (
        <p className="ab-note ab-note-warn" role="status">{run.notice}</p>
      )}

      {phase === 'done' && result !== null && active && (
        <ResultView
          internalPhrases={eff.policy?.internalPhrases || NO_TEXTS}
          feature={active}
          text={result}
          page={page}
          people={people}
          scan={scan}
          source={source}
          internalTexts={Array.isArray(lastPack?.internalTexts) ? lastPack.internalTexts : NO_TEXTS}
          madeWithout={Array.isArray(lastPack?.madeWithout) ? madeWithoutText(lastPack.madeWithout) : madeWithoutLine(lastPack?.gaps)}
          onAgain={run.again}
          onClose={run.reset}
          audit={(outcome) => auditInsert({ feature: active.id, table: ref.table, sysId: ref.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome })}
        />
      )}
    </>
  );
}
