import { useEffect, useId, useRef, useState } from 'react';
import { FOCUSABLE, dialogKeyAction, focusToRestore, inertOutside, outsideKeyAction, selectedTextIn } from './dialogKeys.js';
import { maskMessage, splitPreview } from './runLogic.js';
import { destinationOf, hiddenCounts, maskedPieces, parseSent, selectionTouches } from './previewView.js';
import { Icon } from './ui/icons.jsx';
import { AiBadge } from './ui/primitives.jsx';
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
  SECRET: (n) => tn(n, '{n} password or key', '{n} passwords or keys'),
  ADDRESS: (n) => tn(n, '{n} address', '{n} addresses'),
  IP: (n) => tn(n, '{n} IP address', '{n} IP addresses'),
  MAC: (n) => tn(n, '{n} device address', '{n} device addresses'),
  IBAN: (n) => tn(n, '{n} bank account', '{n} bank accounts'),
  DOB: (n) => tn(n, '{n} birth date', '{n} birth dates'),
  EMPLOYEE_ID: (n) => tn(n, '{n} employee ID', '{n} employee IDs'),
  MANUAL: (n) => tn(n, '{n} added by you', '{n} added by you'),
};

/** What was hidden, one phrase per kind, for the chips of the check: ["12 names", "1 email address", "1 added by you"]. */
export function hiddenWords(stats) {
  return hiddenCounts(stats).map(({ kind, n }) => (KIND_SAY[kind] ? KIND_SAY[kind](n) : `${n} ${kind.toLowerCase()}`));
}

// A hidden value as the person reads it in the check: "Person 1" where "[PERSON_1]" is sent. The exact text keeps the placeholder.
const CHIP_SAY = {
  PERSON: (n) => t('Person {n}', { n }),
  EMAIL: (n) => t('Email {n}', { n }),
  PHONE: (n) => t('Phone {n}', { n }),
  CARD: (n) => t('Card {n}', { n }),
  IBAN: (n) => t('Bank account {n}', { n }),
  ID: (n) => t('ID {n}', { n }),
  IP: (n) => t('IP address {n}', { n }),
  MAC: (n) => t('Device address {n}', { n }),
  DOB: (n) => t('Birth date {n}', { n }),
  ADDRESS: (n) => t('Address {n}', { n }),
  SECRET: (n) => t('Secret {n}', { n }),
  MASKED: (n) => t('Hidden {n}', { n }),
};

// Text of the request with every placeholder drawn as a chip (its title is the placeholder that is sent). Text nodes only, never HTML.
function Masked({ text }) {
  return maskedPieces(text).map((piece, i) =>
    piece.token ? (
      <span key={i} className="ab-mask-chip" title={piece.token}>
        {CHIP_SAY[piece.label] ? CHIP_SAY[piece.label](piece.n) : piece.token}
      </span>
    ) : (
      piece.text
    )
  );
}

// The kind of a note in the check: the words of the panel for the two the record has, the block's own label for anything else.
function noteKind(item) {
  if (item.field === 'work_notes') return t('Work note');
  if (item.label === 'Customer-visible comment') return t('Customer-visible comment');
  return item.label;
}

function SentSection({ section }) {
  if (section.kind === 'fields') {
    return (
      <section className="ab-sent-section">
        <h4 className="ab-sent-title">{t('Ticket')}</h4>
        <dl className="ab-sent-fields">
          {section.rows.map((row, i) => (
            <div key={i} className="ab-sent-field">
              <dt><Masked text={row.label} /></dt>
              <dd><Masked text={row.value} /></dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (section.kind === 'notes') {
    return (
      <section className="ab-sent-section">
        <h4 className="ab-sent-title">{t('Notes and comments')}</h4>
        <ol className="ab-sent-notes">
          {section.items.map((item, i) => (
            <li key={i} className="ab-sent-note">
              <p className="ab-sent-meta">
                {item.by && <span className="ab-sent-by"><Masked text={item.by} /></span>}
                {item.when && <span>{item.when}</span>}
                {noteKind(item) && <span>{noteKind(item)}</span>}
              </p>
              <p className="ab-sent-text"><Masked text={item.text} /></p>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  const title = section.kind === 'block' ? section.label || section.field : section.kind === 'task' ? t('The task') : '';
  return (
    <section className="ab-sent-section">
      {title && <h4 className="ab-sent-title"><Masked text={title} /></h4>}
      <p className="ab-sent-text"><Masked text={section.text} /></p>
    </section>
  );
}

// The ticket data as a person reads it: the record's fields, its text, the notes, the task. The same text as the exact view, nothing
// added or left out (src/sidepanel/previewView.js parseSent); only the wrappers and the placeholders are drawn differently.
function SentView({ data }) {
  const { sections } = parseSent(data);
  return (
    <div className="ab-sent" role="region" aria-label={t('What will be sent')} tabIndex={0}>
      {sections.map((section, i) => (
        <SentSection key={i} section={section} />
      ))}
    </div>
  );
}

// The strip at the top of the check: what was hidden, by kind, as chips (numbers only, never the values).
function HiddenSummary({ stats }) {
  const words = hiddenWords(stats);
  return (
    <section className="ab-surface ab-check-summary" aria-label={t('What is hidden')}>
      <p className="ab-check-summary-line">
        <Icon name="shield" className="ab-check-shield" />
        <span>{words.length ? t('Personal details are hidden before anything leaves:') : t('No personal details were found to hide.')}</span>
      </p>
      {words.length > 0 && (
        <ul className="ab-chips ab-check-counts">
          {words.map((word) => (
            <li key={word} className="ab-chip ab-check-count">{word}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Something that opens in place below its button (the rules, the exact text): a quiet row with a chevron that points down.
function Disclosure({ label, open, onToggle, children }) {
  return (
    <div className="ab-disclosure">
      <button type="button" className="ab-disclosure-toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name="chevronDown" className="ab-chevron" />
        {label}
      </button>
      {open && children}
    </div>
  );
}

// One key per prepared run, for the dialog's `key`. A new run (another ticket's preview waiting there, Try again) gets a new dialog,
// so the view, the "Hide something else" text and what it said never carry over to another run or ticket. Hiding something else
// seals the same run again with the same firewall (src/lib/pipeline.js maskMore): the key stays, and so does what the dialog says.
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
 * The check before anything is sent (AI0.2), a sheet over the dimmed panel.
 *
 * Full: where it goes ("Summarise this ticket · to DeepSeek (deepseek-chat)"), what was hidden (chips by kind), then what will be sent
 * in a readable view: the record's fields, its texts under their labels, the notes as messages, the task, with every hidden value a
 * chip ("Person 1"). Under it, two quiet disclosures: "The rules sent with it" and "Show the exact text" (the whole request exactly as
 * it leaves, the system and user messages, character for character), then "Hide something else" for anything the person still sees.
 * The readable view and the rules are cut from the sealed request's own messages and shown only when they add up to exactly the text
 * that is sent (runLogic splitPreview); otherwise the exact text is shown alone. The readable view only draws that text: what is sent
 * is the sealed request and nothing else.
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
  // 'short' (the one-line check) or 'full' (the readable view, the rules and the exact text folded)
  const [view, setView] = useState(short && others ? 'short' : 'full');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exactOpen, setExactOpen] = useState(false);
  // "Show what is sent" from the short check: the button goes away, so the focus moves to the text it opened.
  const opened = useRef(false);
  useEffect(() => {
    if (view === 'short') return;
    if (opened.current) previewRef.current?.querySelector('.ab-sent, pre.ab-preview')?.focus();
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

  // "Hide something else": text selected in the preview fills the box; the box can also be typed in (keyboard users). A chip shows
  // "Person 1" where "[PERSON_1]" is sent, so a selection across one is not text that can be hidden: the dialog says so at once.
  const pickSelection = () => {
    const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
    const picked = selectedTextIn(previewRef.current, selection);
    if (!picked) return;
    if (selectionTouches(selection, previewRef.current?.querySelectorAll('.ab-mask-chip'))) {
      if (typeof onMask === 'function') setMaskStatus(maskMessage({ ok: false, problem: 'PLACEHOLDER' }));
      return;
    }
    setMaskText(picked);
    setMaskStatus('');
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
  const shownView = view === 'short' && short && others ? 'short' : 'full';
  const { name, model } = destinationOf(config);
  // "Summarise this ticket · to DeepSeek (deepseek-chat)": the action, then where it goes (a gateway or a local server by its address)
  const subLine = t('{title} · to {destination}', { title: feature.title, destination: isolate(model ? `${name} (${model})` : name) });

  const actions = (shown) => (
    <div className="ab-sheet-actions">
      <button type="button" className="ab-btn ab-btn-lg ab-sheet-cancel" onClick={onCancel}>{t('Cancel')}</button>
      <button type="button" className="ab-btn ab-btn-primary ab-btn-lg ab-sheet-send" ref={sendRef} onClick={() => onSend({ shown })}>
        {/* the panel's AI mark, in the button's own colour; no "AI" for screen readers here: the button already says it */}
        <AiBadge label="" title="" />
        {t('Send to AI')}
      </button>
    </div>
  );

  if (shownView === 'short') {
    return (
      <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="ab-dialog ab-dialog-short" role="dialog" aria-modal="true" aria-labelledby={ids.title} aria-describedby={ids.short}>
          <span className="ab-sheet-grip" aria-hidden="true" />
          <div className="ab-dialog-head">
            <h2 className="ab-sheet-title" id={ids.title}>{t('Send to the AI?')}</h2>
            <p className="ab-sheet-sub">{subLine}</p>
          </div>
          <div className="ab-dialog-body">
            <p className="ab-confirm-short" id={ids.short}>{t('Uses {others} from other records. You checked the rest of what this action sends before.', { others })}</p>
            <HiddenSummary stats={prepared.stats} />
            <div className="ab-disclosure">
              <button
                type="button"
                className="ab-disclosure-toggle"
                aria-expanded={false}
                onClick={() => {
                  opened.current = true;
                  setView('full');
                }}
              >
                <Icon name="chevronDown" className="ab-chevron" />
                {t('Show what is sent')}
              </button>
            </div>
          </div>
          <div className="ab-dialog-foot">{actions(false)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ab-backdrop" role="presentation" ref={backdropRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ab-dialog" role="dialog" aria-modal="true" aria-labelledby={ids.title}>
        <span className="ab-sheet-grip" aria-hidden="true" />
        <div className="ab-dialog-head">
          <h2 className="ab-sheet-title" id={ids.title}>{t('Check before sending')}</h2>
          <p className="ab-sheet-sub">{subLine}</p>
        </div>
        <div className="ab-dialog-body">
          <HiddenSummary stats={prepared.stats} />
          <h3 className="ab-check-h">{t('What will be sent')}</h3>
          <p className="ab-check-hint">
            {onMask
              ? t('Read it before you send: a name or detail can still be missed. Hide anything you still see.')
              : t('Read it before you send: a name or detail can still be missed.')}
          </p>
          <div className="ab-check-sent" ref={previewRef} onMouseUp={pickSelection} onKeyUp={pickSelection}>
            {split.ok ? (
              <>
                <SentView data={split.data} />
                <Disclosure label={t('The rules sent with it')} open={rulesOpen} onToggle={() => setRulesOpen(!rulesOpen)}>
                  <pre className="ab-preview-rules-text" tabIndex={0} aria-label={t('Fixed rules that are sent with it')}>
                    <Highlighted text={split.rules} />
                  </pre>
                </Disclosure>
                <Disclosure label={t('Show the exact text')} open={exactOpen} onToggle={() => setExactOpen(!exactOpen)}>
                  <pre className="ab-preview ab-preview-exact" tabIndex={0} aria-label={t('Exact text that will be sent')}>
                    <Highlighted text={split.exact} />
                  </pre>
                </Disclosure>
              </>
            ) : (
              <pre className="ab-preview ab-preview-exact" tabIndex={0} aria-label={t('Exact text that will be sent')}>
                <Highlighted text={split.exact} />
              </pre>
            )}
          </div>
          {typeof onMask === 'function' && (
            <div className="ab-field ab-check-hide">
              <label className="ab-label" htmlFor={ids.mask}>{t('Hide something else')}</label>
              <div className="ab-check-hide-row">
                <input
                  id={ids.mask}
                  className="ab-input"
                  type="text"
                  value={maskText}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('A name or detail to hide')}
                  aria-describedby={`${ids.hint} ${ids.status}`}
                  onChange={(e) => setMaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    mask();
                  }}
                />
                <button type="button" className="ab-btn ab-check-hide-btn" onClick={mask} disabled={!maskText.trim()}>{t('Hide')}</button>
              </div>
              <span className="ab-hint" id={ids.hint}>{t('Select words above, or type them here. Every place they appear is hidden too.')}</span>
              <span className="ab-hint ab-check-hide-status" id={ids.status} role="status">{maskStatus}</span>
            </div>
          )}
        </div>
        <div className="ab-dialog-foot">
          {canSkipNext && !always && <p className="ab-hint ab-sheet-note">{t('You will not be asked again for this action.')}</p>}
          {always && <p className="ab-hint ab-sheet-note">{t('This one includes other tickets, so you are always asked.')}</p>}
          {actions(true)}
        </div>
      </div>
    </div>
  );
}
