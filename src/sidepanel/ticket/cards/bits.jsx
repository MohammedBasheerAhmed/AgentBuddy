// Small pieces every Insights card uses. No reads here. React escapes every string, so ticket text is never markup.
import React, { useEffect, useId, useState } from 'react';
import RecordLink from '../../RecordLink.jsx';
import ErrorNote from '../../ErrorNote.jsx';
import Notes from '../../knowledge/Notes.jsx';
import { readFailure } from '../../plainAccess.js';
import { EmptyNote } from '../../ui/primitives.jsx';

export { EmptyNote, Notes };

const SLOW_MS = 3000;

/**
 * The state of a read when there is nothing to draw yet: "Looking…", after 3 seconds what it is waiting for, a refusal as a plain
 * line ("not available to you"), any other failure as an error with "Try again". Draws nothing once data is there.
 *   state: { phase, data, error }, what: "earlier tickets", onRetry
 */
export function ReadState({ state, what = 'ServiceNow', onRetry }) {
  const waiting = state.phase === 'loading' || state.phase === 'idle';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting || state.data) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [waiting, state.data]);
  if (state.data && state.phase !== 'error') return null;
  if (waiting) return <p className="ab-hint" role="status">{slow ? `Still waiting for ${what} from ServiceNow…` : 'Looking…'}</p>;
  if (state.phase === 'error') {
    const failure = readFailure(state.error, what.charAt(0).toUpperCase() + what.slice(1));
    if (failure.kind !== 'error') return <p className="ab-hint">{failure.text}</p>;
    return <ErrorNote error={failure.text} onRetry={onRetry} />;
  }
  return null;
}

/** A record row: number, title and up to two short lines. Opens in a new tab next to the ticket (the ticket stays put). */
export function ItemLink({ page, item, line = '', extra = '' }) {
  return (
    <RecordLink page={page} item={item} newTab className="ab-ins-item">
      <span className="ab-ins-item-head">
        <span className="ab-record-number">{item.number}</span>
        <span className="ab-ins-item-title">{item.short_description || item.title || ''}</span>
      </span>
      {line && <span className="ab-ins-item-line">{line}</span>}
      {extra && <span className="ab-ins-item-line ab-ins-item-extra">{extra}</span>}
    </RecordLink>
  );
}

/** A group inside a card that folds: a title with its count, closed unless `defaultOpen`. */
export function Group({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="ab-ins-group">
      <button type="button" className="ab-ins-group-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="ab-cardx-chevron" aria-hidden="true" />
        <span className="ab-ins-group-title">{title}</span>
        {count !== undefined && count !== null && <span className="ab-tag">{count}</span>}
      </button>
      <div id={id} className="ab-ins-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** A quiet small button (Insights cards never carry the screen's one primary button). */
export function QuietButton({ children, ...props }) {
  return (
    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" {...props}>
      {children}
    </button>
  );
}

/** Copy text; true when it worked. Falls back to a hidden text area where the clipboard API is not allowed. */
export async function copyText(value) {
  const textValue = String(value ?? '');
  try {
    await navigator.clipboard.writeText(textValue);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = textValue;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}

/** A Copy button that says "Copied" for a moment. */
export function CopyButton({ value, label = 'Copy', title }) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(''), 2500);
    return () => clearTimeout(t);
  }, [note]);
  return (
    <QuietButton
      title={title}
      onClick={async () => {
        const ok = await copyText(typeof value === 'function' ? value() : value);
        setNote(ok ? 'Copied' : 'Copy failed');
      }}
    >
      <span aria-live="polite">{note || label}</span>
    </QuietButton>
  );
}

/**
 * Bring another Insights card into view and open it. The shell's own way (onShowCard) when the card was given one; otherwise the
 * card frame on the page (data-card) is opened and scrolled to.
 */
export function showCard(id, onShowCard) {
  if (typeof onShowCard === 'function') {
    onShowCard(id);
    return;
  }
  if (typeof document === 'undefined') return;
  const frame = document.querySelector(`[data-card="${id}"]`);
  if (!frame) return;
  const open = () => {
    const toggle = frame.querySelector('.ab-cardx-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    frame.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    toggle?.focus?.();
  };
  // The card is in the Insights half while AI Assist is on show: switch halves first (the shell's own switch).
  if (frame.closest('[hidden]')) {
    document.getElementById('ab-ticket-half-tab-insights')?.click();
    setTimeout(open, 0);
  } else open();
}

/** A link-styled button to another card ("See: Which email fits"). */
export function CardJump({ id, label, onShowCard }) {
  return (
    <button type="button" className="ab-linkbtn ab-ins-jump" onClick={() => showCard(id, onShowCard)}>
      {label}
    </button>
  );
}
