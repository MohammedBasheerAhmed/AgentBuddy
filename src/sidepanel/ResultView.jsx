import { useState } from 'react';
import { SafeText } from '../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../render/safeText.js';
import { checkOutgoing } from '../safeSend/index.js';
import { MSG } from '../lib/messages.js';

const REASONS = {
  'no-form': 'Agent Buddy could not reach a form field on this page.',
  'no-such-field': 'That field is not on this form.',
  'read-only': 'That field is read-only on this form.',
  'too-long': 'The text is too long to insert.',
  'set-failed': 'The form did not accept the text.',
  'bad-field': 'That field cannot be filled.',
};

// Fields whose content the customer can read: checked for personal data and secrets before insert.
const CUSTOMER_VISIBLE = new Set(['comments', 'close_notes']);

export default function ResultView({ feature, text, page, people, onAgain, onClose, audit }) {
  const [note, setNote] = useState(null);
  const [findings, setFindings] = useState(null);
  const plain = toPlainText(parseSafeText(text));

  async function copy(why = '') {
    try {
      await navigator.clipboard.writeText(plain);
      setNote({ kind: 'ok', text: why ? `${why} Copied to the clipboard instead.` : 'Copied to the clipboard.' });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: 'The browser blocked copying. Select the text and copy it by hand.' });
    }
  }

  async function insert(force = false) {
    setNote(null);
    const field = feature.insert.field;
    if (!force && CUSTOMER_VISIBLE.has(field)) {
      const check = checkOutgoing(plain, { people });
      const serious = check.findings.filter((f) => f.severity !== 'low');
      if (serious.length) {
        setFindings(serious);
        return;
      }
    }
    setFindings(null);
    let answer;
    try {
      answer = await chrome.tabs.sendMessage(page.tabId, { type: MSG.FILL_FIELD, field, value: plain, label: feature.insert.label, mode: 'append' });
    } catch {
      answer = { ok: false, reason: 'no-form' };
    }
    if (answer?.ok) {
      setNote({ kind: 'ok', text: 'Inserted into the form. Review it, then save the record yourself.' });
      audit('inserted');
    } else {
      await copy(REASONS[answer?.reason] || 'Could not insert it.');
    }
  }

  return (
    <section className="ab-card" aria-live="polite">
      <h2 className="ab-h">{feature.title}</h2>
      <div className="ab-output">
        <SafeText text={text} />
      </div>
      {findings && (
        <div className="ab-note ab-note-warn" role="alert" style={{ marginTop: 8 }}>
          <strong>Check before sending to the customer:</strong>
          <ul style={{ margin: '4px 0 6px', paddingLeft: 18 }}>
            {findings.map((f, i) => (
              <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => insert(true)}>Insert anyway</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setFindings(null)}>Edit first (copy instead)</button>
          </div>
        </div>
      )}
      {note && <p className={`ab-note ab-note-${note.kind}`} style={{ marginTop: 8 }}>{note.text}</p>}
      <div className="ab-row" style={{ marginTop: 8 }}>
        <button type="button" className="ab-btn ab-btn-primary ab-btn-sm" onClick={() => insert(false)}>{feature.insert.label}</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => copy()}>Copy</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={onAgain}>Try again</button>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onClose}>Close</button>
      </div>
      <p className="ab-hint" style={{ marginTop: 8 }}>AI can be wrong. Check the text before you use it.</p>
    </section>
  );
}
