// Settings, Basics: the activity log (src/audit/auditLog.js), the last entries, with "Export CSV" (which the organisation can switch off,
// `auditExport`) and "Clear log". The log holds no ticket text, names or AI answers.
import { useCallback, useEffect, useState } from 'react';
import { readAudit, clearAudit } from '../../lib/storage.js';
import { auditToCsv } from '../../audit/auditLog.js';
import { downloadText } from '../../sidepanel/reports/download.js';
import { SectionHead, Status } from '../fields.jsx';
import { t, tm } from '../../i18n/index.js';

// What the activity log says happened to a run (src/audit/auditLog.js OUTCOMES); the action and the table are codes, shown as they are.
const OUTCOME_WORDS = { sent: tm('sent'), blocked: tm('blocked'), error: tm('error'), cancelled: tm('cancelled'), inserted: tm('inserted'), copied: tm('copied') };

export function AuditSection({ eff }) {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState(null);
  const load = useCallback(() => readAudit().then((l) => setLog(l.slice().reverse())).catch(() => setLog([])), []);
  useEffect(() => { load(); }, [load]);
  const canExport = eff.policy?.auditExport !== false;

  // The shared download (it keeps the file's address alive until the browser has taken it, and marks the CSV as UTF-8 for Excel).
  function exportCsv() {
    downloadText(`agent-buddy-audit-${new Date().toISOString().slice(0, 10)}.csv`, auditToCsv(log.slice().reverse()));
  }

  async function clear() {
    try {
      await clearAudit();
      setStatus({ kind: 'ok', text: t('The activity log was cleared.') });
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not let Agent Buddy clear the log. Try again.') });
    }
    load();
  }

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-audit">
      <SectionHead id="h-audit" title={t('Activity log')}>
        {t("A local record of what Agent Buddy did: which action, which table, how many items were masked, tokens and outcome. It never stores ticket text, names or the AI's answers.")}
      </SectionHead>
      <div className="ab-set-actions">
        <button type="button" className="ab-btn ab-btn-sm" onClick={exportCsv} disabled={!canExport || !log.length}>{t('Export CSV')}</button>
        <button type="button" className="ab-btn ab-btn-sm ab-set-danger" onClick={clear} disabled={!log.length}>{t('Clear log')}</button>
        {!canExport && <span className="ab-locked">{t('Export is switched off by your organisation.')}</span>}
      </div>
      <Status status={status} />
      {log.length === 0 ? <p className="ab-note ab-set-empty">{t('Nothing yet.')}</p> : (
        <table className="ab-table ab-set-table">
          <thead><tr><th scope="col">{t('Time')}</th><th scope="col">{t('Action')}</th><th scope="col">{t('Table')}</th><th scope="col">{t('Masked')}</th><th scope="col">{t('Outcome')}</th></tr></thead>
          <tbody>
            {log.slice(0, 40).map((e, i) => (
              <tr key={i}><td>{String(e.time || '').replace('T', ' ').slice(0, 16)}</td><td><code data-ltr>{e.feature}</code></td><td><code data-ltr>{e.table}</code></td><td>{e.masked}</td><td>{OUTCOME_WORDS[e.outcome] ? t(OUTCOME_WORDS[e.outcome]) : e.outcome}{e.reason ? <> (<code data-ltr>{e.reason}</code>)</> : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
