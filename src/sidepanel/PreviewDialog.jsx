import { useEffect, useRef } from 'react';
import { FOCUSABLE, dialogKeyAction, inertOutside } from './dialogKeys.js';

const PLACEHOLDER = /(\[[A-Z_]{2,20}_\d+\])/;

// The exact outgoing text, with the masked values picked out. Plain React text nodes, never HTML.
// split() with one capture group puts every placeholder at an odd index.
function Highlighted({ text }) {
  return text.split(PLACEHOLDER).map((chunk, i) =>
    i % 2 === 1 ? (
      <span key={i} className="ab-ph">{chunk}</span>
    ) : (
      chunk
    )
  );
}

const KIND_LABEL = { PERSON: 'names', EMAIL: 'email addresses', PHONE: 'phone numbers', CARD: 'card numbers', ID: 'ID numbers', NATIONAL_ID: 'ID numbers', SECRET: 'secrets', ADDRESS: 'addresses', IP: 'IP addresses', IBAN: 'bank accounts', DOB: 'birth dates', EMPLOYEE_ID: 'employee IDs' };

function summary(stats) {
  const parts = Object.entries(stats?.counts || {}).map(([kind, n]) => `${n} ${KIND_LABEL[kind] || kind.toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'nothing needed masking';
}

export default function PreviewDialog({ feature, prepared, config, canSkipNext, onSend, onCancel }) {
  const backdropRef = useRef(null);
  const sendRef = useRef(null);
  // The parent makes a new onCancel on every render; keep the latest in a ref so nothing below has to re-run (and take the focus
  // back to "Send to AI") each time it renders.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    // While the preview is on screen the rest of the panel can neither be clicked nor tabbed into. A preview that is waiting in a
    // part of the panel that is hidden at the moment (another section is showing) takes nothing over: it does so when it is shown.
    const node = backdropRef.current;
    let restore = null;
    const hold = () => {
      if (restore) return;
      restore = inertOutside(node);
      sendRef.current?.focus();
    };
    const release = () => {
      restore?.();
      restore = null;
    };
    if (typeof IntersectionObserver !== 'function') {
      if (node.getClientRects().length) hold();
      return release;
    }
    const observer = new IntersectionObserver((entries) => (entries[entries.length - 1].isIntersecting ? hold() : release()));
    observer.observe(node);
    return () => {
      observer.disconnect();
      release();
    };
  }, []);

  // Escape and Tab belong to the dialog, not to the window: a preview waiting in a hidden part of the panel is not cancelled
  // by a key pressed somewhere else.
  const onKeyDown = (e) => {
    const nodes = Array.from(backdropRef.current?.querySelectorAll(FOCUSABLE) || []);
    const action = dialogKeyAction(e, nodes.length, nodes.indexOf(document.activeElement));
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action.type === 'cancel') cancelRef.current();
    else nodes[action.index]?.focus();
  };

  // A reference to other people's tickets changes from run to run, so having seen the preview once does not cover it.
  const always = prepared.pack?.requirePreview === true;

  return (
    <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ab-dialog" role="dialog" aria-modal="true" aria-labelledby="ab-prev-title">
        <div className="ab-dialog-head">
          <h2 className="ab-h" id="ab-prev-title">Check what will be sent</h2>
          <p className="ab-sub">
            {feature.title} · to {config.provider}
            {config.baseUrl ? ` (${new URL(config.baseUrl).host})` : ''} · masked: {summary(prepared.stats)}
          </p>
        </div>
        <div className="ab-dialog-body">
          <p className="ab-note">
            Highlighted placeholders replace personal details. The AI never sees the real values; your screen puts them back. Names written inside
            sentences can be missed, so read the text below before you send.
          </p>
          <pre className="ab-preview" tabIndex={0} aria-label="Exact text that will be sent">
            <Highlighted text={prepared.preview} />
          </pre>
        </div>
        <div className="ab-dialog-foot">
          {canSkipNext && !always && <span className="ab-hint" style={{ marginRight: 'auto' }}>You will not be asked again for this action.</span>}
          {always && <span className="ab-hint" style={{ marginRight: 'auto' }}>This one includes other tickets, so you are always asked.</span>}
          <button type="button" className="ab-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="ab-btn ab-btn-primary" ref={sendRef} onClick={onSend}>Send to AI</button>
        </div>
      </div>
    </div>
  );
}
