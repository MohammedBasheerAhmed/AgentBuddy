import { isCustomerVisible } from '../lib/fillable.js';
import { Icon } from './ui/icons.jsx';
import { t } from '../i18n/index.js';

/**
 * What the safe-to-send review found in a text that was about to go into a box (insertFlow reviewInsert: a serious finding stops the
 * insert), with "Insert anyway" and "Edit first". The same block wherever an AI text is inserted: ResultView, the Ticket screen's
 * answers (AnswerCard) and the email draft waiting on the email form (PendingDraft). A quiet warning surface with a small warning
 * mark, not a loud box: it is announced (role="alert") and it stops the insert, so it does not need to shout as well.
 *
 * props: field (the box it was going into), items ({ advice, excerpt }[]), busy (an insert is in flight), onInsertAnyway,
 * onEditFirst, style?
 */
export default function InsertFindings({ field, items, busy, onInsertAnyway, onEditFirst, style }) {
  return (
    <div className="ab-note ab-note-warn ab-findings-box" role="alert" style={style}>
      <p className="ab-findings-head">
        <Icon name="alert" className="ab-findings-icon" />
        <strong>{isCustomerVisible(field) ? t('Check before sending to the customer:') : t('Check before inserting:')}</strong>
      </p>
      <ul className="ab-findings">
        {items.map((f, i) => (
          <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
        ))}
      </ul>
      <div className="ab-row ab-findings-actions">
        <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={onInsertAnyway}>{t('Insert anyway')}</button>
        <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={onEditFirst}>{t('Edit first')}</button>
      </div>
    </div>
  );
}

/**
 * The line after an insert or a copy, and Undo while the last Insert can be taken back (round 4, docs/round4.md: Undo after every
 * Insert). Undo puts the boxes back as they were before the insert, on the open form, without saving; it is offered while the same
 * record is open and has not been saved since (useInsertActions `undo`). For every place an AI text is inserted: the Ticket screen's
 * answers (AnswerCard), and the others when they take it up (ResultView, PendingDraft).
 *
 * props: note ({ kind, text } or null), undo (offer Undo now), busy (an insert or an Undo is in flight), onUndo
 */
export function InsertNote({ note, undo = false, busy = false, onUndo }) {
  if (!note && !undo) return null;
  return (
    <div className="ab-insert-note">
      {note && <p className={`ab-note ab-note-${note.kind}`} role="status">{note.text}</p>}
      {undo && (
        <button type="button" className="ab-btn ab-btn-sm ab-insert-undo" disabled={busy} onClick={onUndo} title={t('Put back what was in the form before this insert. Nothing is saved.')}>
          {t('Undo')}
        </button>
      )}
    </div>
  );
}
