import { t } from '../i18n/index.js';

/**
 * Low-severity findings of the review (src/safeSend/review.js) as a short list that never blocks anything: another person's name,
 * an IP address, "escalated to". Renders nothing when there are none. The text is plain (React escapes it).
 */
export default function ReviewHints({ hints }) {
  if (!Array.isArray(hints) || !hints.length) return null;
  return (
    <div className="ab-note" role="note" style={{ marginTop: 8 }}>
      <strong>{t('Worth a look:')}</strong>
      <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
        {hints.map((f, i) => (
          <li key={i}>
            {f.advice} <span className="ab-mono">{f.excerpt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
