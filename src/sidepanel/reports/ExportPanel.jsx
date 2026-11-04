import { useState } from 'react';
import { resultTables } from '../../reports/engine/index.js';
import { exportFileName, maskTables, tablesToCsv, tablesToTsv } from '../../reports/exportTables.js';
import { copyText, downloadText } from './download.js';
import { dashboardTables } from './dashboardEnv.js';
import Summary from './Summary.jsx';
import { t } from '../../i18n/index.js';
import { shown } from '../../reports/shown.js';

// F7, once per dashboard: everything on screen as one CSV or one table to paste, a single section when that is what is wanted, and
// the "mask names and emails" switch. Files are made here, in the browser, from the results already loaded (memory only): nothing is
// read again and nothing is sent anywhere. Replaces the three controls every widget used to carry (TRACKER.md 2.4).
//
// Props: name (the dashboard's), entries (loaded results [{ id, section, result }]), order (widget ids as on screen), mask, setMask,
// maskMode (the person's privacy mode: Strict also masks capitalised full names in titles), onClose.
export default function ExportPanel({ name, entries, order, mask, setMask, maskMode, onClose }) {
  const [note, setNote] = useState('');
  const say = (text) => {
    setNote(text);
    setTimeout(() => setNote(''), 4000);
  };
  const masked = (tables) => (mask ? maskTables(tables, { mode: maskMode }) : tables);
  const all = dashboardTables(entries, order, resultTables);
  const at = new Map((order || []).map((id, i) => [id, i]));
  const sections = (entries || [])
    .filter((e) => e?.result && at.has(e.id))
    .sort((a, b) => at.get(a.id) - at.get(b.id))
    // `title` is what the list shows; `fileTitle` (English) makes the file's name.
    .map((e) => ({ id: e.id, title: shown(String(e.result.title || t('Section'))), fileTitle: String(e.result.title || 'Section'), tables: resultTables(e.result).filter((x) => x.rows.length) }))
    .filter((s) => s.tables.length);
  const saved = mask ? t('CSV saved to your downloads, with names masked.') : t('CSV saved to your downloads.');
  const copied = (ok) => say(ok ? t('Copied. Paste it into a spreadsheet or a mail.') : t('Could not copy. Use Download instead.'));

  return (
    <section className="ab-surface ab-export-panel" aria-label={t('Export')}>
      <div className="ab-widget-head">
        <h2 className="ab-widget-title">{t('Export')}</h2>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onClose}>{t('Close')}</button>
      </div>
      <p className="ab-widget-help">{t('Made in your browser from the numbers on screen. Nothing is read again or sent anywhere.')}</p>
      {!all.length ? (
        <p className="ab-note">{t('Nothing to export yet: wait for the numbers to load.')}</p>
      ) : (
        <>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => { downloadText(exportFileName(name), tablesToCsv(masked(all))); say(saved); }}>
              {t('Download all as CSV')}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={async () => copied(await copyText(tablesToTsv(masked(all))))}>
              {t('Copy all as a table')}
            </button>
          </div>
          <label className="ab-check ab-export-mask">
            <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
            <span>{t('Mask names and emails')}</span>
          </label>
          {mask && <p className="ab-hint">{t('People become Person 1, Person 2... A name in a title is found when the words around it mark it as one ("for Anna Schmidt", "spoke with Tom"). Check the file before you share it.')}</p>}
          {sections.length > 1 && (
            <details className="ab-details">
              <Summary>{t('One section')}</Summary>
              <ul className="ab-export-list">
                {sections.map((s) => (
                  <li key={s.id} className="ab-export-item">
                    <span className="ab-export-name">{s.title}</span>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-label={t('Download {title} as CSV', { title: s.title })} onClick={() => { downloadText(exportFileName(s.fileTitle), tablesToCsv(masked(s.tables))); say(saved); }}>
                      {t('Download CSV')}
                    </button>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-label={t('Copy {title} as a table', { title: s.title })} onClick={async () => copied(await copyText(tablesToTsv(masked(s.tables))))}>
                      {t('Copy')}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="ab-hint" role="status">{note}</p>
    </section>
  );
}
