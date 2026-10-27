import { useRef } from 'react';
import PreviewDialog from './PreviewDialog.jsx';
import ResultView from './ResultView.jsx';
import { resolveProviderConfig } from '../providers/config.js';
import { auditInsert } from '../lib/storage.js';
import { auditRefFromPage, expectFromPage, sourceFromPack } from '../lib/fillable.js';

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
 * props: run (from useRun), eff, page, readingText? (what to say while the data is being read)
 */
export default function RunPanel({ run, eff, page, readingText = 'Reading the ticket with your session…' }) {
  const { phase, prepared, active, result, error, people, scan, lastPack } = run;
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  // The record that was open when the run started (its number is for the message when another one is open later).
  const startedOn = useRef(null);
  if (phase === 'reading') startedOn.current = { expect: expectFromPage(page), number: page.record?.number || '' };
  const source = startedOn.current && startedOn.current.expect ? startedOn.current : null;
  // The audit entry names the record the pack was about; a pasted text (Rewrite, Notes) is audited against the page it was used on.
  const ref = sourceFromPack(lastPack) ? lastPack : auditRefFromPage(page);
  return (
    <>
      {(phase === 'reading' || phase === 'sending') && (
        <p className="ab-note" role="status">
          {phase === 'reading' ? readingText : 'Waiting for the AI…'}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={run.reset} style={{ marginLeft: 8 }}>Stop waiting</button>
        </p>
      )}

      {phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{error}</p>}

      {phase === 'preview' && prepared && (
        <PreviewDialog
          feature={prepared.p.feature}
          prepared={prepared.p}
          config={prepared.cfg}
          canSkipNext={eff.values.previewMode === 'first'}
          onSend={run.confirmPreview}
          onCancel={run.cancelPreview}
        />
      )}

      {phase === 'done' && result !== null && active && (
        <ResultView
          feature={active}
          text={result}
          page={page}
          people={people}
          scan={scan}
          source={source}
          internalTexts={Array.isArray(lastPack?.internalTexts) ? lastPack.internalTexts : NO_TEXTS}
          onAgain={run.again}
          onClose={run.reset}
          audit={(outcome) => auditInsert({ feature: active.id, table: ref.table, sysId: ref.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome })}
        />
      )}
    </>
  );
}
