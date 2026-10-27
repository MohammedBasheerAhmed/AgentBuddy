import { useMemo, useState } from 'react';
import { resultTables } from '../../reports/engine/index.js';
import { exportFileName, maskTables, tablesToCsv, tablesToTsv } from '../../reports/exportTables.js';
import { copyText, downloadText } from './download.js';

// F7. CSV of whatever the widget shows, copy as a table, and the "mask names and emails" switch. Files are made here, in the
// browser, from the numbers already on screen: nothing is read again and nothing is sent anywhere.
export default function ExportBar({ title, result, env }) {
  const [note, setNote] = useState('');
  const tables = useMemo(() => {
    const all = resultTables(result).filter((t) => t.rows.length);
    return env.mask ? maskTables(all) : all;
  }, [result, env.mask]);
  if (!tables.length) return null;

  const say = (text) => {
    setNote(text);
    setTimeout(() => setNote(''), 4000);
  };

  return (
    <div className="ab-export" role="group" aria-label={`Export ${title}`}>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => { downloadText(exportFileName(title), tablesToCsv(tables)); say('CSV saved to your downloads.'); }}>
        Download CSV
      </button>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={async () => say((await copyText(tablesToTsv(tables))) ? 'Copied. Paste it into a spreadsheet or a mail.' : 'Could not copy. Use Download CSV instead.')}>
        Copy as table
      </button>
      <label className="ab-check ab-export-mask">
        <input type="checkbox" checked={env.mask} onChange={(e) => env.setMask(e.target.checked)} />
        <span>Mask names and emails</span>
      </label>
      {env.mask && <span className="ab-hint">People become Person 1, Person 2... Names that appear only inside a ticket title and nowhere else in the table are not found.</span>}
      <span className="ab-hint" role="status">{note}</span>
    </div>
  );
}
