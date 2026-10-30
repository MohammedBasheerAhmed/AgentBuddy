import { useEffect, useRef, useState } from 'react';
import { FOCUSABLE, dialogKeyAction, focusToRestore, inertOutside, outsideKeyAction, selectedTextIn } from './dialogKeys.js';
import { maskMessage } from './runLogic.js';

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

// [one, several]: "1 email address", "3 email addresses".
const KIND_LABEL = {
  PERSON: ['name', 'names'],
  EMAIL: ['email address', 'email addresses'],
  PHONE: ['phone number', 'phone numbers'],
  CARD: ['card number', 'card numbers'],
  ID: ['ID number', 'ID numbers'],
  NATIONAL_ID: ['ID number', 'ID numbers'],
  SECRET: ['secret', 'secrets'],
  ADDRESS: ['address', 'addresses'],
  IP: ['IP address', 'IP addresses'],
  IBAN: ['bank account', 'bank accounts'],
  DOB: ['birth date', 'birth dates'],
  EMPLOYEE_ID: ['employee ID', 'employee IDs'],
  MANUAL: ['added by you', 'added by you'],
};

/** What was masked, as the dialog says it: "12 names, 1 email address, 1 added by you". */
export function maskSummary(stats) {
  const parts = Object.entries(stats?.counts || {}).map(([kind, n]) => {
    const [one, several] = KIND_LABEL[kind] || [kind.toLowerCase(), kind.toLowerCase()];
    return `${n} ${n === 1 ? one : several}`;
  });
  return parts.length ? parts.join(', ') : 'nothing needed masking';
}

/**
 * The check before anything is sent: the exact outgoing text, what was masked, and "Mask this too" for anything the person
 * still sees. props: feature, prepared (from prepareRun or maskMore), config, canSkipNext, onSend, onCancel,
 * onMask? (text) => { ok, masked } | { ok: false, problem } (useRun's maskMore; without it the box is not shown).
 */
export default function PreviewDialog({ feature, prepared, config, canSkipNext, onSend, onCancel, onMask }) {
  const backdropRef = useRef(null);
  const sendRef = useRef(null);
  const previewRef = useRef(null);
  const [maskText, setMaskText] = useState('');
  const [maskStatus, setMaskStatus] = useState('');
  // The parent makes a new onCancel on every render; keep the latest in a ref so nothing below has to re-run (and take the focus
  // back to "Send to AI") each time it renders.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    // While the preview is on screen the rest of the panel can neither be clicked nor tabbed into. A preview that is waiting in a
    // part of the panel that is hidden at the moment (another section is showing) takes nothing over: it does so when it is shown.
    const node = backdropRef.current;
    // The control that had the focus before the dialog (usually the action button): it gets the focus back when the dialog closes.
    const opener = typeof document !== 'undefined' && document.activeElement && !node.contains(document.activeElement) ? document.activeElement : null;
    let restore = null;
    let held = false;
    const hold = () => {
      if (restore) return;
      restore = inertOutside(node);
      held = true;
      sendRef.current?.focus();
    };
    const release = () => {
      restore?.();
      restore = null;
    };
    // Escape (and Tab) also work before the dialog has taken the focus, or after the focus was lost: a listener on the document
    // that acts only while this dialog is visible and the key did not come from inside it (that one is handled below).
    const onDocumentKey = (e) => {
      const nodes = Array.from(node.querySelectorAll(FOCUSABLE));
      const action = outsideKeyAction(e, { visible: node.getClientRects().length > 0, inside: node.contains(document.activeElement), count: nodes.length });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'cancel') cancelRef.current();
      else nodes[action.index]?.focus();
    };
    document.addEventListener('keydown', onDocumentKey);
    const finish = () => {
      document.removeEventListener('keydown', onDocumentKey);
      release();
      if (held) focusToRestore(opener, document.activeElement, document.body)?.focus();
    };
    if (typeof IntersectionObserver !== 'function') {
      if (node.getClientRects().length) hold();
      return finish;
    }
    const observer = new IntersectionObserver((entries) => (entries[entries.length - 1].isIntersecting ? hold() : release()));
    observer.observe(node);
    return () => {
      observer.disconnect();
      finish();
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

  // "Mask this too": text selected in the preview fills the box; the box can also be typed in (keyboard users).
  const pickSelection = () => {
    const picked = selectedTextIn(previewRef.current, typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null);
    if (picked) {
      setMaskText(picked);
      setMaskStatus('');
    }
  };
  const mask = () => {
    if (typeof onMask !== 'function') return;
    const out = onMask(maskText);
    setMaskStatus(maskMessage(out));
    if (out?.ok) setMaskText('');
  };

  // A reference to other people's tickets changes from run to run, so having seen the preview once does not cover it.
  const always = prepared.pack?.requirePreview === true;
  // What is shown is the sealed request's own preview: exactly what Send will send.
  const text = prepared.request?.preview ?? prepared.preview;

  return (
    <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ab-dialog" role="dialog" aria-modal="true" aria-labelledby="ab-prev-title">
        <div className="ab-dialog-head">
          <h2 className="ab-h" id="ab-prev-title">Check what will be sent</h2>
          <p className="ab-sub">
            {feature.title} · to {config.provider}
            {config.baseUrl ? ` (${new URL(config.baseUrl).host})` : ''} · masked: {maskSummary(prepared.stats)}
          </p>
        </div>
        <div className="ab-dialog-body">
          <p className="ab-note">
            Highlighted placeholders replace personal details. The AI never sees the real values; your screen puts them back. A name or detail
            can still be missed, so read the text below before you send{onMask ? ', and mask anything you still see' : ''}.
          </p>
          <pre className="ab-preview" tabIndex={0} aria-label="Exact text that will be sent" ref={previewRef} onMouseUp={pickSelection} onKeyUp={pickSelection}>
            <Highlighted text={text} />
          </pre>
          {typeof onMask === 'function' && (
            <div className="ab-field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label className="ab-label" htmlFor="ab-mask-text">Mask this too</label>
              <span className="ab-hint" id="ab-mask-hint">Select words above, or type them here. Every place they appear is masked.</span>
              <div className="ab-row">
                <input
                  id="ab-mask-text"
                  className="ab-input"
                  type="text"
                  value={maskText}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="ab-mask-hint ab-mask-status"
                  style={{ flex: '1 1 140px', width: 'auto', minWidth: 0 }}
                  onChange={(e) => setMaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    mask();
                  }}
                />
                <button type="button" className="ab-btn" onClick={mask} disabled={!maskText.trim()}>Mask</button>
              </div>
              <span className="ab-hint" id="ab-mask-status" role="status">{maskStatus}</span>
            </div>
          )}
        </div>
        <div className="ab-dialog-foot" style={{ flexWrap: 'wrap' }}>
          {canSkipNext && !always && <span className="ab-hint" style={{ marginRight: 'auto' }}>You will not be asked again for this action.</span>}
          {always && <span className="ab-hint" style={{ marginRight: 'auto' }}>This one includes other tickets, so you are always asked.</span>}
          <button type="button" className="ab-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="ab-btn ab-btn-primary" ref={sendRef} onClick={onSend}>Send to AI</button>
        </div>
      </div>
    </div>
  );
}
