import { useEffect, useId, useRef, useState } from 'react';
import { FOCUSABLE, dialogKeyAction, focusToRestore, inertOutside, outsideKeyAction, selectedTextIn } from './dialogKeys.js';
import { maskMessage, splitPreview } from './runLogic.js';
import { t, tn, isolate } from '../i18n/index.js';

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

// How many of each kind: "1 email address", "3 email addresses" (a language with more plural forms says its own).
const KIND_SAY = {
  PERSON: (n) => tn(n, '{n} name', '{n} names'),
  EMAIL: (n) => tn(n, '{n} email address', '{n} email addresses'),
  PHONE: (n) => tn(n, '{n} phone number', '{n} phone numbers'),
  CARD: (n) => tn(n, '{n} card number', '{n} card numbers'),
  ID: (n) => tn(n, '{n} ID number', '{n} ID numbers'),
  NATIONAL_ID: (n) => tn(n, '{n} ID number', '{n} ID numbers'),
  SECRET: (n) => tn(n, '{n} secret', '{n} secrets'),
  ADDRESS: (n) => tn(n, '{n} address', '{n} addresses'),
  IP: (n) => tn(n, '{n} IP address', '{n} IP addresses'),
  IBAN: (n) => tn(n, '{n} bank account', '{n} bank accounts'),
  DOB: (n) => tn(n, '{n} birth date', '{n} birth dates'),
  EMPLOYEE_ID: (n) => tn(n, '{n} employee ID', '{n} employee IDs'),
  MANUAL: (n) => tn(n, '{n} added by you', '{n} added by you'),
};

/** What was masked, as the dialog says it: "12 names, 1 email address, 1 added by you". */
export function maskSummary(stats) {
  const parts = Object.entries(stats?.counts || {}).map(([kind, n]) => (KIND_SAY[kind] ? KIND_SAY[kind](n) : `${n} ${kind.toLowerCase()}`));
  return parts.length ? parts.join(t(', ')) : t('nothing needed masking');
}

// One key per prepared run, for the dialog's `key`. A new run (another ticket's preview waiting there, Try again) gets a new dialog,
// so the view, the "Mask this too" text and what it said never carry over to another run or ticket. "Mask this too" seals the same
// run again with the same firewall (src/lib/pipeline.js maskMore): the key stays, and so does what the dialog says about it.
const runKeys = new WeakMap();
let runCount = 0;

/** The dialog's key for a prepared run (prepareRun's result, or maskMore's for the same run). */
export function previewKey(prepared) {
  const run = prepared?.firewall || prepared?.input || prepared;
  if (!run || typeof run !== 'object') return 'preview';
  if (!runKeys.has(run)) runKeys.set(run, `run-${(runCount += 1)}`);
  return runKeys.get(run);
}

/**
 * The check before anything is sent (AI0.2).
 *
 * Full: what was masked, then the ticket data as it will be sent (what the person should read), the fixed rules folded under "Rules
 * sent with it", "Show the exact text" for the whole request exactly as it leaves (the system and user messages, character for
 * character), and "Mask this too" for anything the person still sees. The pieces are cut from the sealed request's own messages and
 * shown only when they add up to exactly the text that is sent (runLogic splitPreview); otherwise the exact text is shown alone.
 *
 * Short (`short`): for a feature that uses other records (look-alike tickets, articles) and was checked in full before, one line
 * says which other records it uses ("Uses 3 solved tickets and 2 articles from other records") with Send, Cancel and "Show what is
 * sent", which opens the full check in place. onSend gets { shown: false } when the full text was not opened (audited so).
 *
 * props: feature, prepared (from prepareRun or maskMore), config, canSkipNext, onSend({ shown }), onCancel,
 * onMask? (text) => { ok, masked } | { ok: false, problem } (useRun's maskMore; without it the box is not shown),
 * short?, others? (the other records, counted: runLogic otherRecordsSummary)
 *
 * Render it with key={previewKey(prepared)}: its state belongs to one run.
 */
export default function PreviewDialog({ feature, prepared, config, canSkipNext, onSend, onCancel, onMask, short = false, others = '' }) {
  const backdropRef = useRef(null);
  const sendRef = useRef(null);
  const previewRef = useRef(null);
  // This dialog's own ids: two previews can be in the panel at once (one waiting on a screen that is hidden), and an id must not
  // repeat or a label and a description would point into the other one. (useId's colons go: the ids stay usable in a selector.)
  const uid = useId().replace(/:/g, '');
  const ids = { title: `ab-prev-title-${uid}`, short: `ab-prev-short-${uid}`, mask: `ab-mask-text-${uid}`, hint: `ab-mask-hint-${uid}`, status: `ab-mask-status-${uid}` };
  const [maskText, setMaskText] = useState('');
  const [maskStatus, setMaskStatus] = useState('');
  // 'short' (the one-line check), 'data' (ticket data first, rules folded) or 'exact' (the whole request as it is sent)
  const [view, setView] = useState(short && others ? 'short' : 'data');
  // "Show what is sent" from the short check: the button goes away, so the focus moves to the text it opened.
  const opened = useRef(false);
  useEffect(() => {
    if (view === 'short') return;
    if (opened.current) previewRef.current?.querySelector('pre')?.focus();
    opened.current = false;
  }, [view]);
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
  // What is shown is the sealed request's own preview: exactly what Send will send (split into data and rules only when the two
  // pieces are exactly that text again).
  const split = splitPreview(prepared);
  // The one-line check only while the caller still asks for it: props that want the full check (the settings changed meanwhile) get it.
  const wanted = view === 'short' && !(short && others) ? 'data' : view;
  const shownView = wanted === 'data' && !split.ok ? 'exact' : wanted;
  const destination = `${config.provider}${config.baseUrl ? ` (${new URL(config.baseUrl).host})` : ''}`;
  // "Summarise this ticket · to anthropic · masked: 3 names" (the title is the feature's, the destination an address)
  const subLine = t('{title} · to {destination} · masked: {summary}', { title: feature.title, destination: isolate(destination), summary: maskSummary(prepared.stats) });

  if (shownView === 'short') {
    return (
      <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="ab-dialog ab-dialog-short" role="dialog" aria-modal="true" aria-labelledby={ids.title} aria-describedby={ids.short}>
          <div className="ab-dialog-head">
            <h2 className="ab-h" id={ids.title}>{t('Send to the AI?')}</h2>
            <p className="ab-sub">
              {subLine}
            </p>
          </div>
          <div className="ab-dialog-body">
            <p className="ab-confirm-short" id={ids.short}>{t('Uses {others} from other records. You checked the rest of what this action sends before.', { others })}</p>
          </div>
          <div className="ab-dialog-foot" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ab-btn ab-btn-quiet"
              style={{ marginInlineEnd: 'auto' }}
              onClick={() => {
                opened.current = true;
                setView('data');
              }}
            >
              {t('Show what is sent')}
            </button>
            <button type="button" className="ab-btn" onClick={onCancel}>{t('Cancel')}</button>
            <button type="button" className="ab-btn ab-btn-primary" ref={sendRef} onClick={() => onSend({ shown: false })}>{t('Send to AI')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ab-dialog" role="dialog" aria-modal="true" aria-labelledby={ids.title}>
        <div className="ab-dialog-head">
          <h2 className="ab-h" id={ids.title}>{t('Check what will be sent')}</h2>
          <p className="ab-sub">
            {subLine}
          </p>
        </div>
        <div className="ab-dialog-body">
          <p className="ab-note">
            {onMask
              ? t('Highlighted placeholders replace personal details. The AI never sees the real values; your screen puts them back. A name or detail can still be missed, so read the text below before you send, and mask anything you still see.')
              : t('Highlighted placeholders replace personal details. The AI never sees the real values; your screen puts them back. A name or detail can still be missed, so read the text below before you send.')}
          </p>
          <div ref={previewRef} onMouseUp={pickSelection} onKeyUp={pickSelection}>
            {shownView === 'data' ? (
              <>
                <h3 className="ab-preview-h">{t('Ticket data')}</h3>
                <pre className="ab-preview ab-preview-data" tabIndex={0} aria-label={t('Ticket data that will be sent')}>
                  <Highlighted text={split.data} />
                </pre>
                <details className="ab-preview-rules">
                  <summary>{t('Rules sent with it')}</summary>
                  <pre className="ab-preview-rules-text" tabIndex={0} aria-label={t('Fixed rules that are sent with it')}>
                    <Highlighted text={split.rules} />
                  </pre>
                </details>
              </>
            ) : (
              <pre className="ab-preview ab-preview-exact" tabIndex={0} aria-label={t('Exact text that will be sent')}>
                <Highlighted text={split.exact} />
              </pre>
            )}
          </div>
          {split.ok && (
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-preview-switch" aria-pressed={shownView === 'exact'} onClick={() => setView(shownView === 'exact' ? 'data' : 'exact')}>
              {shownView === 'exact' ? t('Show the ticket data first') : t('Show the exact text')}
            </button>
          )}
          {typeof onMask === 'function' && (
            <div className="ab-field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label className="ab-label" htmlFor={ids.mask}>{t('Mask this too')}</label>
              <span className="ab-hint" id={ids.hint}>{t('Select words above, or type them here. Every place they appear is masked.')}</span>
              <div className="ab-row">
                <input
                  id={ids.mask}
                  className="ab-input"
                  type="text"
                  value={maskText}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${ids.hint} ${ids.status}`}
                  style={{ flex: '1 1 140px', width: 'auto', minWidth: 0 }}
                  onChange={(e) => setMaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    mask();
                  }}
                />
                <button type="button" className="ab-btn" onClick={mask} disabled={!maskText.trim()}>{t('Mask')}</button>
              </div>
              <span className="ab-hint" id={ids.status} role="status">{maskStatus}</span>
            </div>
          )}
        </div>
        <div className="ab-dialog-foot" style={{ flexWrap: 'wrap' }}>
          {canSkipNext && !always && <span className="ab-hint" style={{ marginInlineEnd: 'auto' }}>{t('You will not be asked again for this action.')}</span>}
          {always && <span className="ab-hint" style={{ marginInlineEnd: 'auto' }}>{t('This one includes other tickets, so you are always asked.')}</span>}
          <button type="button" className="ab-btn" onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="ab-btn ab-btn-primary" ref={sendRef} onClick={() => onSend({ shown: true })}>{t('Send to AI')}</button>
        </div>
      </div>
    </div>
  );
}
