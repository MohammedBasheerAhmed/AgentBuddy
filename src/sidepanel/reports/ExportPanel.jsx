import React, { useState } from 'react';
import { resultTables } from '../../reports/engine/index.js';
import { exportFileName, maskTables, tablesToCsv, tablesToTsv } from '../../reports/exportTables.js';
import { copyText, downloadText } from './download.js';
import { dashboardTables } from './dashboardEnv.js';

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
    .map((e) => ({ id: e.id, title: String(e.result.title || 'Section'), tables: resultTables(e.result).filter((t) => t.rows.length) }))
    .filter((s) => s.tables.length);
  const saved = mask ? 'CSV saved to your downloads, with names masked.' : 'CSV saved to your downloads.';
  const copied = (ok) => say(ok ? 'Copied. Paste it into a spreadsheet or a mail.' : 'Could not copy. Use Download instead.');

  return (
    <section className="ab-card ab-export-panel" aria-label="Export">
      <div className="ab-widget-head">
        <h2 className="ab-h">Export</h2>
        <span className="ab-spacer" />
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onClose}>Close</button>
      </div>
      <p className="ab-sub">Made in your browser from the numbers on screen. Nothing is read again or sent anywhere.</p>
      {!all.length ? (
        <p className="ab-note">Nothing to export yet: wait for the numbers to load.</p>
      ) : (
        <>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => { downloadText(exportFileName(name), tablesToCsv(masked(all))); say(saved); }}>
              Download all as CSV
            </button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={async () => copied(await copyText(tablesToTsv(masked(all))))}>
              Copy all as a table
            </button>
          </div>
          <label className="ab-check ab-export-mask">
            <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
            <span>Mask names and emails</span>
          </label>
          {mask && <p className="ab-hint">People become Person 1, Person 2... A name in a title is found when the words around it mark it as one ("for Anna Schmidt", "spoke with Tom"). Check the file before you share it.</p>}
          {sections.length > 1 && (
            <details className="ab-details">
              <summary>One section</summary>
              <ul className="ab-export-list">
                {sections.map((s) => (
                  <li key={s.id} className="ab-export-item">
                    <span className="ab-export-name">{s.title}</span>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-label={`Download ${s.title} as CSV`} onClick={() => { downloadText(exportFileName(s.title), tablesToCsv(masked(s.tables))); say(saved); }}>
                      Download CSV
                    </button>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-label={`Copy ${s.title} as a table`} onClick={async () => copied(await copyText(tablesToTsv(masked(s.tables))))}>
                      Copy
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
