import PreviewDialog from './PreviewDialog.jsx';
import ResultView from './ResultView.jsx';
import { resolveProviderConfig } from '../providers/config.js';
import { logAudit } from '../lib/storage.js';

/**
 * Shows the state of a run from useRun(): progress, the error, the preview of exactly what will be sent, and the result
 * with Insert / Copy. Put it anywhere in a view; it renders nothing while the run is idle.
 *
 * props: run (from useRun), eff, page, readingText? (what to say while the data is being read)
 */
export default function RunPanel({ run, eff, page, readingText = 'Reading the ticket with your session…' }) {
  const { phase, prepared, active, result, error, people, scan, lastPack } = run;
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  return (
    <>
      {(phase === 'reading' || phase === 'sending') && (
        <p className="ab-note" role="status">
          {phase === 'reading' ? readingText : 'Waiting for the AI…'}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={run.reset} style={{ marginLeft: 8 }}>Cancel</button>
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
          onAgain={run.again}
          onClose={run.reset}
          audit={(outcome) => logAudit({ feature: active.id, table: lastPack?.table, sysId: lastPack?.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome })}
        />
      )}
    </>
  );
}
