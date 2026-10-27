import { useMemo, useRef, useState } from 'react';
import { SafeText } from '../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../render/safeText.js';
import { reviewForCustomer } from '../safeSend/review.js';
import { insertsFor } from '../features/registry.js';
import { currentFromPage, expectForInsert, fillModeFor, isCustomerVisible, matchesExpect, wrongRecordText } from '../lib/fillable.js';
import { openNewRecord } from './openRecord.js';
import { originOf, setPending } from './pendingDraft.js';
import { createGuard, performInsert } from './insertFlow.js';
import ReviewHints from './ReviewHints.jsx';

const NO_TEXTS = []; // (one array, so the memoised review below is not redone on every render)

/**
 * A finished answer with its Insert and Copy buttons.
 *
 * props:
 *   feature, text            the feature and the answer (real names back in, locally)
 *   page                     the page state (tabId, record, newRecord, href)
 *   people, scan             the run's people and the firewall's scan(), for the review of what is inserted
 *   internalTexts            the record's work notes: words copied from them into a customer-visible field are flagged
 *   source                   { expect, number }: the record the answer was written for (see RunPanel). When another record is
 *                            open, the Insert buttons are off and the card says so; Copy still works
 *   target                   an expectation that replaces `source` for every insert (a draft waiting on a blank form: { table, newRecord: true })
 *   onAgain, onClose, audit  Try again, Close, and audit(outcome) for 'inserted' / 'copied'
 *   onInserted               called after a successful insert (a draft carried to a blank form is dropped then)
 */
export default function ResultView({ feature, text, page, people, scan, onAgain, onClose, audit, source = null, internalTexts = NO_TEXTS, target, onInserted }) {
  const [note, setNote] = useState(null);
  const [findings, setFindings] = useState(null);
  const [busy, setBusy] = useState(false); // a FILL_FIELD call is in flight: every insert button is off
  const [done, setDone] = useState({}); // buttons that inserted: they say "Inserted" until Try again or Close
  const guard = useRef(null); // one insert at a time, decided at once: a second click before the next render does nothing
  if (!guard.current) guard.current = createGuard();
  const plain = toPlainText(parseSafeText(text));

  const inserts = insertsFor(feature);

  // A feature may offer several inserts (title and body of an article, say). `pick(text)` chooses the part for one of them.
  const textFor = (spec) => {
    if (typeof spec?.pick !== 'function') return plain;
    try {
      return String(spec.pick(plain) || '').trim();
    } catch {
      return '';
    }
  };

  // Low-severity findings (another person's name, an IP address...) are shown, never hidden: they do not block anything.
  const hints = useMemo(
    () => (insertsFor(feature).some((s) => isCustomerVisible(s.field)) ? reviewForCustomer(plain, { people, scan, internalTexts }).hints : []),
    [feature, plain, people, scan, internalTexts]
  );

  // The record this answer was written for must be the one that is open. (An insert that names its own form, such as an
  // article's title, goes to whatever form of that kind is open instead.)
  const bound = target === undefined ? source?.expect || null : null;
  const wrongRecord = Boolean(bound) && !matchesExpect(bound, currentFromPage(page));

  async function copy(why = '', value = plain) {
    try {
      await navigator.clipboard.writeText(value);
      setNote({ kind: 'ok', text: why ? `${why} Copied to the clipboard instead.` : 'Copied to the clipboard.' });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: 'The browser blocked copying. Select the text and copy it by hand.' });
    }
  }

  async function insert(spec, key, force = false) {
    if (guard.current.busy) return;
    setNote(null);
    // An insert that belongs on another kind of form (an article's title and body) is refused anywhere else: "short_description"
    // exists on the incident too, and filling that by mistake would be easy to miss.
    const here = page.record?.table || page.newRecord?.table || '';
    if (spec.table && here !== spec.table) {
      setNote({ kind: 'warn', text: `This goes into a ${spec.table === 'kb_knowledge' ? 'knowledge article' : spec.table} form. Open that form first${feature.open?.table === spec.table ? ' (use the button below)' : ''}, then insert. Copy works now.` });
      return;
    }
    const value = textFor(spec);
    if (!value) {
      setNote({ kind: 'danger', text: 'That part is not in the text, so there is nothing to insert. Use Copy instead.' });
      return;
    }
    // Where the text goes: a draft on a blank form says so; an insert for another kind of form goes to the form that is open;
    // everything else goes to the record the answer was written for.
    const expect = expectForInsert({ spec, source, target, page });
    const outcome = await guard.current.run(key, async () => {
      setBusy(true);
      try {
        return await performInsert({
          page,
          spec,
          value,
          force,
          expect,
          number: source?.number,
          review: { people, scan, internalTexts },
          send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
        });
      } finally {
        setBusy(false);
      }
    });
    if (!outcome) return;
    if (outcome.status === 'findings') {
      setFindings({ items: outcome.items, spec, key, value });
      return;
    }
    setFindings(null);
    if (outcome.status === 'inserted') {
      setNote({ kind: 'ok', text: outcome.note });
      setDone((prev) => ({ ...prev, [key]: true }));
      audit('inserted');
      if (onInserted) onInserted(spec);
    } else {
      await copy(outcome.why, value);
    }
  }

  const replacing = inserts.some((spec) => fillModeFor(spec.field, spec.mode) === 'replace');

  return (
    <section className="ab-card" aria-live="polite">
      <h2 className="ab-h">{feature.title}</h2>
      <div className="ab-output">
        <SafeText text={text} />
      </div>
      {findings && (
        <div className="ab-note ab-note-warn" role="alert" style={{ marginTop: 8 }}>
          <strong>{isCustomerVisible(findings.spec.field) ? 'Check before sending to the customer:' : 'Check before inserting:'}</strong>
          <ul style={{ margin: '4px 0 6px', paddingLeft: 18 }}>
            {findings.items.map((f, i) => (
              <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => insert(findings.spec, findings.key, true)}>Insert anyway</button>
            {/* The part that was about to be inserted, not the whole answer. */}
            <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => { const value = findings.value; setFindings(null); copy('Not inserted.', value); }}>Edit first (copy instead)</button>
          </div>
        </div>
      )}
      {!findings && <ReviewHints hints={hints} />}
      {wrongRecord && <p className="ab-note ab-note-warn" role="status" style={{ marginTop: 8 }}>{wrongRecordText(source)}</p>}
      {note && <p className={`ab-note ab-note-${note.kind}`} style={{ marginTop: 8 }}>{note.text}</p>}
      <div className="ab-row" style={{ marginTop: 8 }}>
        {inserts.map((spec, i) => {
          const key = `${spec.field}:${i}`;
          const inserted = Boolean(done[key]);
          return (
            <button
              key={key}
              type="button"
              className={`ab-btn ab-btn-sm${i === 0 ? ' ab-btn-primary' : ''}`}
              disabled={busy || inserted || (wrongRecord && !spec.table)}
              onClick={() => insert(spec, key, false)}
            >
              {inserted ? 'Inserted' : spec.label}
            </button>
          );
        })}
        {feature.open?.table && page.newRecord?.table !== feature.open.table && (
          <button
            type="button"
            className="ab-btn ab-btn-sm"
            onClick={() => {
              // The tab is about to leave this record, which resets the panel: keep the draft (in memory, for this site only,
              // for 15 minutes) for the blank form.
              if (!setPending({ feature, text, people, scan, internalTexts, origin: originOf(page.href) })) {
                setNote({ kind: 'warn', text: 'Agent Buddy could not keep the draft for the new form. Copy it first.' });
                return;
              }
              if (!openNewRecord(page, feature.open.table)) {
                setNote({ kind: 'warn', text: 'Agent Buddy could not open that form. Copy the text instead.' });
              }
            }}
          >
            {feature.open.label || 'Open a new form'}
          </button>
        )}
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => copy()}>Copy</button>
        {onAgain && <button type="button" className="ab-btn ab-btn-sm" onClick={onAgain}>Try again</button>}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onClose}>Close</button>
      </div>
      {replacing && <p className="ab-hint" style={{ marginTop: 8 }}>A one-line field such as a title is replaced, not added to.</p>}
      <p className="ab-hint" style={{ marginTop: 8 }}>AI can be wrong. Check the text before you use it.</p>
    </section>
  );
}
