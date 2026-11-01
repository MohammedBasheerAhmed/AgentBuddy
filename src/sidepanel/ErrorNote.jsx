import React from 'react';
import { plainError } from './ask.js';
import { t } from '../i18n/index.js';

/**
 * A read or an action that failed, in plain words, with the next step next to it: "Try again" (when the view can read again).
 * The browser's own wording for a lost page connection becomes one plain sentence (plainError in ask.js).
 *
 * props: error (an Error or a message), onRetry? (shows the button), retryLabel?
 */
export default function ErrorNote({ error, onRetry, retryLabel = t('Try again') }) {
  const text = plainError(error, t('Something went wrong.'));
  return (
    <div className="ab-note ab-note-danger ab-errnote" role="alert">
      <p className="ab-errnote-text">{text}</p>
      {onRetry && (
        <button type="button" className="ab-btn ab-btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
