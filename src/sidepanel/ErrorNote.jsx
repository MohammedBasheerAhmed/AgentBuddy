import { plainError } from './ask.js';
import { READ_REASON, readReasonOf } from '../context/access.js';
import { t } from '../i18n/index.js';

// The instance is limiting requests, busy, under maintenance or answered with a page: not the person's mistake and nothing is lost,
// so it is said calmly (a warning, read out politely) rather than as an alarm. "Try again" stays.
const CALM = new Set([READ_REASON.RATE_LIMITED, READ_REASON.UNAVAILABLE, READ_REASON.NOT_DATA, READ_REASON.TIMEOUT]);

/**
 * A read or an action that failed, in plain words, with the next step next to it: "Try again" (when the view can read again).
 * The browser's own wording for a lost page connection becomes one plain sentence (plainError in ask.js).
 *
 * props: error (an Error or a message), onRetry? (shows the button), retryLabel?,
 *   tone? 'danger' (the default) | 'calm'. Without one, a read the instance limited or answered with a page (src/context/access.js,
 *   readReasonOf) is calm on its own.
 */
export default function ErrorNote({ error, onRetry, retryLabel = t('Try again'), tone }) {
  const text = plainError(error, t('Something went wrong. Try again; if it keeps happening, tell your administrator.'));
  const calm = tone ? tone === 'calm' : CALM.has(readReasonOf(error));
  return (
    <div className={calm ? 'ab-note ab-note-warn ab-errnote ab-reads-calm' : 'ab-note ab-note-danger ab-errnote'} role={calm ? 'status' : 'alert'}>
      <p className="ab-errnote-text">{text}</p>
      {onRetry && (
        <button type="button" className="ab-btn ab-btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
