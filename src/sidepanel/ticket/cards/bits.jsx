// Small pieces every Insights card uses. No reads here. React escapes every string, so ticket text is never markup.
import { useEffect, useId, useState } from 'react';
import RecordLink from '../../RecordLink.jsx';
import ErrorNote from '../../ErrorNote.jsx';
import { plainError } from '../../ask.js';
import { describeAccess, plainSource } from '../../plainAccess.js';
import { READ_REASON, readFailureText, readReasonOf } from '../../../context/access.js';
import { EmptyNote } from '../../ui/primitives.jsx';
import { Icon } from '../../ui/icons.jsx';
import { copyText } from '../../reports/download.js';
import { t } from '../../../i18n/index.js';

export { EmptyNote };

const SLOW_MS = 3000;

// How a failed read is shown (the reasons: src/context/access.js READ_REASON).
// A refusal: an access rule, the organisation's restriction of this kind of read, its block in Agent Buddy, a record that is not there
// for this person, a table this instance does not have. A plain line, no "Try again": trying again cannot change it (build rule 9).
const REFUSED = new Set([READ_REASON.ACL, READ_REASON.POLICY, READ_REASON.BLOCKED, READ_REASON.NOT_FOUND, READ_REASON.MISSING]);
// The instance limited the read or did not answer with data: said calmly, with "Try again".
const INSTANCE = new Set([READ_REASON.RATE_LIMITED, READ_REASON.UNAVAILABLE, READ_REASON.NOT_DATA, READ_REASON.TIMEOUT]);

/**
 * The lines under a card's results for the reads that could not see everything (access entries), so a missing list is never taken for
 * "nothing there". Each line in plain words (src/sidepanel/plainAccess.js), except the reasons that are about the instance or the
 * organisation rather than one table: those say what happened and what to do (readFailureText), once for all the reads they stopped.
 */
export function accessLines(access) {
  const lines = [];
  const policy = []; // the things the organisation's restriction stopped: one line names them all
  let policyAt = -1;
  for (const entry of Array.isArray(access) ? access : []) {
    const [plain] = describeAccess([entry]);
    if (!plain) continue; // read, empty, or left out on purpose: nothing to say
    const reason = readReasonOf(entry);
    if (reason === READ_REASON.POLICY) {
      if (policyAt < 0) policyAt = lines.push('') - 1;
      const thing = plainSource(entry.source);
      if (!policy.includes(thing)) policy.push(thing);
      continue;
    }
    const line = INSTANCE.has(reason) ? readFailureText(entry, { translate: t }) : plain;
    if (!lines.includes(line)) lines.push(line);
  }
  if (policyAt >= 0) lines[policyAt] = readFailureText({ reason: READ_REASON.POLICY }, { thing: policy.join(t(', ')), translate: t });
  return lines;
}

/** What could not be read, in plain words, never a table name (accessLines). */
export function Notes({ access }) {
  const lines = accessLines(access);
  if (!lines.length) return null;
  return <p className="ab-hint ab-kb-notes">{lines.join(' ')}</p>;
}

/**
 * The state of a read when there is nothing to draw yet: "Looking…", after 3 seconds what it is waiting for, a refusal as a plain
 * line ("not available to you with your role"), the instance limiting or not answering with data as a calm note with "Try again", any
 * other failure as an error with "Try again". Draws nothing once data is there.
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
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [waiting, state.data]);
  if (state.data && state.phase !== 'error') return null;
  if (waiting) return <p className="ab-hint" role="status">{slow ? t('Still waiting for {what} from ServiceNow…', { what }) : t('Looking…')}</p>;
  if (state.phase === 'error') {
    const thing = what.charAt(0).toUpperCase() + what.slice(1);
    const reason = readReasonOf(state.error);
    if (REFUSED.has(reason)) return <p className="ab-hint ab-reads-refused">{readFailureText(state.error, { thing, translate: t })}</p>;
    if (INSTANCE.has(reason)) return <ErrorNote error={readFailureText(state.error, { translate: t })} onRetry={onRetry} tone="calm" />;
    // A lost session and every other failure: in plain words, with "Try again".
    return <ErrorNote error={plainError(state.error, t('{thing} could not be read.', { thing }))} onRetry={onRetry} tone="danger" />;
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
        <span className="ab-ins-group-title">{title}</span>
        {count !== undefined && count !== null && <span className="ab-chip ab-chip-neutral ab-ins-count">{count}</span>}
        <Icon name="chevronDown" size={16} className="ab-chevron" />
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

/** A Copy button that says "Copied" for a moment. */
export function CopyButton({ value, label = t('Copy'), title }) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(''), 2500);
    return () => clearTimeout(timer);
  }, [note]);
  return (
    <QuietButton
      title={title}
      onClick={async () => {
        const ok = await copyText(typeof value === 'function' ? value() : value);
        setNote(ok ? t('Copied') : t('Copy failed'));
      }}
    >
      <span aria-live="polite">{note || label}</span>
    </QuietButton>
  );
}

/**
 * Bring another Insights card into view and open it. The shell's own way (onShowCard) when the card was given one; otherwise the
 * card's row on the page (data-card) is opened and scrolled to.
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
    // The card is inside one of the five rows (TicketInsights): open that row first.
    const row = frame.closest('[data-group]')?.querySelector('.ab-ins-group-row');
    if (row && row.getAttribute('aria-expanded') === 'false') row.click();
    const toggle = frame.querySelector('.ab-ins-card-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    frame.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    toggle?.focus?.();
  };
  // The card is in the Insights half while AI Assist is on show: switch halves first (the shell's own switch).
  if (frame.parentElement?.closest('[hidden]')) {
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
