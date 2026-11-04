import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SafeText } from '../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../render/safeText.js';
import { reviewForCustomer } from '../safeSend/review.js';
import { insertsFor } from '../features/registry.js';
import { currentFromPage, expectForInsert, fillModeFor, isCustomerVisible, matchesExpect, wrongRecordText } from '../lib/fillable.js';
import { openNewRecord } from './openRecord.js';
import { originOf, setPending } from './pendingDraft.js';
import { choicesOf, createGuard, insertTargets, insertText, insertsForKind, performInsert, primaryOf } from './insertFlow.js';
import ReviewHints from './ReviewHints.jsx';
import InsertFindings from './InsertFindings.jsx';
import InsertEditor from './ticket/assist/answers/InsertEditor.jsx';
import { t, isolate } from '../i18n/index.js';

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
 *   madeWithout              the line "Made without: ..." (what the request could not include), '' for none
 *   focusOnShow              move the focus to the answer when it appears (default). A draft that waits on a blank form does not:
 *                            it shows up because the page changed, not because the person asked for something here.
 *
 * The card is not one big live region (a screen reader would read the whole answer, then read it again with every note): the focus
 * moves to its heading when it appears, and the short notes under it (inserted, copied, could not insert) are announced as status.
 */
export default function ResultView({ feature, text, page, people, scan, onAgain, onClose, audit, source = null, internalTexts = NO_TEXTS, target, onInserted, focusOnShow = true, madeWithout = '', internalPhrases = NO_TEXTS }) {
  const [note, setNote] = useState(null);
  const headingId = useId();
  const heading = useRef(null);
  useEffect(() => {
    if (focusOnShow) heading.current?.focus();
    // Once, when the answer appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [findings, setFindings] = useState(null);
  const [busy, setBusy] = useState(false); // a FILL_FIELD call is in flight: every insert button is off
  const [done, setDone] = useState({}); // buttons that inserted: they say "Inserted" until Try again or Close
  const guard = useRef(null); // one insert at a time, decided at once: a second click before the next render does nothing
  if (!guard.current) guard.current = createGuard();
  const plain = toPlainText(parseSafeText(text));

  // The boxes this kind of record has (an insert may name its kinds: the problem form has no resolution-notes box).
  const kind = page.record?.kind;
  const inserts = kind ? insertsForKind(feature, kind) : insertsFor(feature);
  // A note to self (a summary) leads with Copy; text that belongs on the form leads with its first Insert.
  const copyFirst = primaryOf(feature, kind) === 'copy';
  const [editing, setEditing] = useState(null); // { key, text }: "Edit first" opened the text in a box before it goes in

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
    () => (insertsFor(feature).some((s) => isCustomerVisible(s.field)) ? reviewForCustomer(plain, { people, scan, internalTexts, internalPhrases }).hints : []),
    [feature, plain, people, scan, internalTexts, internalPhrases]
  );

  // The record this answer was written for must be the one that is open. (An insert that names its own form, such as an
  // article's title, goes to whatever form of that kind is open instead.)
  const bound = target === undefined ? source?.expect || null : null;
  const wrongRecord = Boolean(bound) && !matchesExpect(bound, currentFromPage(page));

  async function copy(why = '', value = plain) {
    try {
      await navigator.clipboard.writeText(value);
      setNote({ kind: 'ok', text: why ? t('{why} Copied to the clipboard instead.', { why }) : t('Copied to the clipboard.') });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: t('The browser blocked copying. Select the text and copy it by hand.') });
    }
  }

  async function insert(spec, key, force = false) {
    if (guard.current.busy) return;
    setNote(null);
    // An insert that belongs on another kind of form (an article's title and body) is refused anywhere else: "short_description"
    // exists on the incident too, and filling that by mistake would be easy to miss.
    const here = page.record?.table || page.newRecord?.table || '';
    if (spec.table && here !== spec.table) {
      const form = spec.table === 'kb_knowledge' ? t('knowledge article') : spec.table;
      setNote({
        kind: 'warn',
        text: feature.open?.table === spec.table
          ? t('This goes into a {form} form. Open that form first (use the button below), then insert. Copy works now.', { form })
          : t('This goes into a {form} form. Open that form first, then insert. Copy works now.', { form }),
      });
      return;
    }
    const value = textFor(spec);
    if (!value) {
      setNote({ kind: 'danger', text: t('That part is not in the text, so there is nothing to insert. Use Copy instead.') });
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
          review: { people, scan, internalTexts, internalPhrases },
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

  // Edit before Insert: the edited text goes in through the same insert path (insertFlow insertText: the record it was written
  // for, one field, the review again on the edited text, never a save). The editor shows the review's findings itself.
  async function insertEdited(item, value, mode, force) {
    if (guard.current.busy) return null;
    setNote(null);
    setBusy(true);
    let outcome;
    try {
      outcome = await guard.current.run(null, () =>
        insertText({ page, target: item, text: value, mode, source, pinned: target, review: { people, scan, internalTexts, internalPhrases }, force, send: (tabId, message) => chrome.tabs.sendMessage(tabId, message) })
      );
    } finally {
      setBusy(false);
    }
    if (!outcome || outcome.status === 'findings') return outcome;
    if (outcome.status === 'inserted') {
      setNote({ kind: 'ok', text: outcome.note });
      setDone((prev) => ({ ...prev, [item.key]: true }));
      setEditing(null);
      audit('inserted');
      if (onInserted) onInserted(item.spec);
    } else if (outcome.status === 'blocked') {
      setNote({ kind: 'warn', text: outcome.why });
    } else if (outcome.status !== 'empty') {
      await copy(outcome.why, value);
    }
    return outcome;
  }
  const targets = editing ? insertTargets(feature, { record: page.record, page }) : [];
  const choices = choicesOf(feature, plain);

  const replacing = inserts.some((spec) => fillModeFor(spec.field, spec.mode) === 'replace');
  // Which ticket this answer belongs to, said on the card itself where it can be inserted: an answer must never be taken for another
  // ticket's. (A Copy-only answer, such as a rewrite of pasted text, is not bound to a record, so it names none.)
  const writtenFor = !inserts.length ? '' : target?.newRecord ? t('For a new {form} form', { form: target.table === 'kb_knowledge' ? t('knowledge article') : target.table }) : source?.number ? t('Written for {number}', { number: isolate(source.number) }) : '';

  return (
    <section className="ab-card ab-result" aria-labelledby={headingId}>
      <h2 className="ab-h" id={headingId} ref={heading} tabIndex={-1}>{feature.title}</h2>
      {writtenFor && <p className="ab-sub ab-result-for">{writtenFor}</p>}
      <div className="ab-output">
        {choices.length ? (
          // A set of choices (the chat replies): each with its own Copy, since only one of them is sent.
          <ol className="ab-answer-choices">
            {choices.map((c, i) => (
              <li key={i}>
                <SafeText text={c} />
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => copy('', c)} aria-label={t('Copy reply {n}', { n: i + 1 })}>{t('Copy this')}</button>
              </li>
            ))}
          </ol>
        ) : (
          <SafeText text={text} />
        )}
      </div>
      {madeWithout && <p className="ab-hint ab-answer-gaps" style={{ marginTop: 8 }}>{madeWithout}</p>}
      {findings && (
        <InsertFindings
          field={findings.spec.field}
          items={findings.items}
          busy={busy}
          style={{ marginTop: 8 }}
          onInsertAnyway={() => insert(findings.spec, findings.key, true)}
          // The part that was about to be inserted, not the whole answer, in a box to change before it goes in.
          onEditFirst={() => {
            const { key, value } = findings;
            setFindings(null);
            setNote(null);
            setEditing({ key, text: value });
          }}
        />
      )}
      {!findings && !editing && <ReviewHints hints={hints} />}
      {editing && (
        <InsertEditor
          targets={[...targets.filter((item) => item.key === editing.key), ...targets.filter((item) => item.key !== editing.key)]}
          initial={editing.text}
          textFor={(item) => textFor(item.spec)}
          review={{ people, scan, internalTexts, internalPhrases }}
          page={page}
          record={page.record}
          busy={busy}
          onInsert={insertEdited}
          onCancel={() => setEditing(null)}
        />
      )}
      {wrongRecord && <p className="ab-note ab-note-warn" role="status" style={{ marginTop: 8 }}>{wrongRecordText(source)}</p>}
      {note && <p className={`ab-note ab-note-${note.kind}`} role="status" style={{ marginTop: 8 }}>{note.text}</p>}
      <div className="ab-row" style={{ marginTop: 8 }}>
        {inserts.map((spec, i) => {
          const key = `${spec.field}:${i}`;
          const inserted = Boolean(done[key]);
          return (
            <button
              key={key}
              type="button"
              className={`ab-btn ab-btn-sm${i === 0 && !copyFirst ? ' ab-btn-primary' : ''}`}
              disabled={busy || inserted || (wrongRecord && !spec.table)}
              onClick={() => insert(spec, key, false)}
            >
              {inserted ? t('Inserted') : spec.label}
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
                setNote({ kind: 'warn', text: t('Agent Buddy could not keep the draft for the new form. Copy it first.') });
                return;
              }
              if (!openNewRecord(page, feature.open.table)) {
                setNote({ kind: 'warn', text: t('Agent Buddy could not open that form. Copy the text instead.') });
              }
            }}
          >
            {feature.open.label || t('Open a new form')}
          </button>
        )}
        <button type="button" className={`ab-btn ab-btn-sm${copyFirst ? ' ab-btn-primary' : ''}`} onClick={() => copy()}>{t('Copy')}</button>
        {onAgain && <button type="button" className="ab-btn ab-btn-sm" onClick={onAgain}>{t('Try again')}</button>}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onClose}>{t('Close')}</button>
      </div>
      {replacing && <p className="ab-hint" style={{ marginTop: 8 }}>{t('A one-line field such as a title is replaced, not added to.')}</p>}
      <p className="ab-hint" style={{ marginTop: 8 }}>{t('AI can be wrong. Check the text before you use it.')}</p>
    </section>
  );
}
