import { useState } from 'react';
import { SafeText } from '../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../render/safeText.js';
import { checkOutgoing, maskExcerpt } from '../safeSend/index.js';
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

// Kinds the firewall masks on the way out and that must never come back into a message the customer reads.
const NEVER_BACK = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const NEVER_BACK_ADVICE = 'This is a password, key, card number or ID that was hidden from the AI, and it is back in the draft. Remove it before it reaches the customer.';

/**
 * checkOutgoing() plus the firewall's own memory. The firewall learns every secret it masks, so a password the model repeats
 * bare ("your sign-in value is Winter2026...", no "password:" in front) is still recognised. Findings come back masked.
 */
function seriousFindings(plain, people, scan) {
  const found = checkOutgoing(plain, { people }).findings.filter((f) => f.severity !== 'low');
  let remembered = [];
  try {
    remembered = (scan ? scan(plain) : []).filter((f) => NEVER_BACK.has(f.kind));
  } catch {
    /* the text check above still applies */
  }
  const extra = remembered
    .filter((f) => !found.some((g) => g.start < f.end && f.start < g.end))
    .map((f) => ({ kind: f.kind, severity: 'high', start: f.start, end: f.end, excerpt: maskExcerpt(f.value), advice: NEVER_BACK_ADVICE }));
  return [...found, ...extra];
}

export default function ResultView({ feature, text, page, people, scan, onAgain, onClose, audit }) {
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
      const serious = seriousFindings(plain, people, scan);
      if (serious.length) {
        setFindings(serious);
        return;
      }
    }
    setFindings(null);
    let answer;
    try {
      // `label` is how the control is named on a Workspace page (its aria-label), not the button text.
      answer = await chrome.tabs.sendMessage(page.tabId, { type: MSG.FILL_FIELD, field, value: plain, label: feature.insert.fieldLabel || feature.insert.label, mode: 'append' });
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
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => { setFindings(null); copy('Not inserted.'); }}>Edit first (copy instead)</button>
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
