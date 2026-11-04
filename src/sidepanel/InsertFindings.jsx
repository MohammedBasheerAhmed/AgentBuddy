import { isCustomerVisible } from '../lib/fillable.js';
import { t } from '../i18n/index.js';

/**
 * What the safe-to-send review found in a text that was about to go into a box (insertFlow reviewInsert: a serious finding stops the
 * insert), with "Insert anyway" and "Edit first". The same box wherever an AI text is inserted: ResultView, the Ticket screen's
 * answers (AnswerCard) and the email draft waiting on the email form (PendingDraft).
 *
 * props: field (the box it was going into), items ({ advice, excerpt }[]), busy (an insert is in flight), onInsertAnyway,
 * onEditFirst, style?
 */
export default function InsertFindings({ field, items, busy, onInsertAnyway, onEditFirst, style }) {
  return (
    <div className="ab-note ab-note-warn" role="alert" style={style}>
      <strong>{isCustomerVisible(field) ? t('Check before sending to the customer:') : t('Check before inserting:')}</strong>
      <ul className="ab-findings">
        {items.map((f, i) => (
          <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
        ))}
      </ul>
      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={onInsertAnyway}>{t('Insert anyway')}</button>
        <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={onEditFirst}>{t('Edit first')}</button>
      </div>
    </div>
  );
}
