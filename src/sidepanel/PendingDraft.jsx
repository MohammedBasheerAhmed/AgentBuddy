import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePending, clearPending, pendingFits, afterInsert, emailExpect, emailInserts } from './pendingDraft.js';
import ResultView from './ResultView.jsx';
import ReviewHints from './ReviewHints.jsx';
import InsertEditor from './ticket/assist/answers/InsertEditor.jsx';
import { AiBadge } from './ui/primitives.jsx';
import { SafeText } from '../render/SafeText.jsx';
import { read } from './ask.js';
import { applyFieldStates, createGuard, insertTargets, insertText, readFieldStates, reviewInsert } from './insertFlow.js';
import { auditInsert } from '../lib/storage.js';
import { EMAIL_NEXT, insertedNote, isCustomerVisible } from '../lib/fillable.js';
import { t, isolate, t as tr } from '../i18n/index.js';

const NO_TEXTS = [];
const sendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

/**
 * The draft the agent carried to another form: "Open a new article form" (a blank form of the table the feature names) or, for an
 * AI email draft on the Ticket screen, "Open the email form" (the email form of the ticket it was written for, AI9). Shown only
 * there, only on the ServiceNow site it was written on, and only for 15 minutes (src/sidepanel/pendingDraft.js). Insert / Copy work
 * as on the answer it came from. Once every insert it offers went in the draft is dropped; closing it drops it too.
 *
 * props: page, eff? (for the privacy mode in the audit entry and the organisation's internal phrases)
 */
export default function PendingDraft({ page, eff }) {
  const draft = usePending();
  const [inserted, setInserted] = useState(null); // { table } or { email, origin } after it was used up: one line until it is closed
  const [doneFields, setDoneFields] = useState([]); // the inserts of this draft that went in (an article has a title and a body)
  useEffect(() => {
    if (draft) {
      setInserted(null);
      setDoneFields([]);
    }
  }, [draft]);

  if (!draft) {
    if (inserted?.email) {
      return pendingFits(inserted, page) ? (
        <p className="ab-note ab-note-ok" role="status">
          {t('The draft is in the email form. Review it.')} {tr(EMAIL_NEXT)}{' '}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setInserted(null)}>{t('Close')}</button>
        </p>
      ) : null;
    }
    return inserted && page.newRecord?.table === inserted.table ? (
      <p className="ab-note ab-note-ok" role="status">
        {insertedNote({ ok: true }, { field: 'text', table: inserted.table })}{' '}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setInserted(null)}>{t('Close')}</button>
      </p>
    ) : null;
  }
  if (!pendingFits(draft, page)) return null;
  if (draft.email) {
    return (
      <EmailDraftCard
        // (a new draft is a new card: nothing of the last one's inserts or notes carries over)
        key={draft.id}
        draft={draft}
        page={page}
        eff={eff}
        onUsedUp={() => {
          setInserted({ email: draft.email, origin: draft.origin });
          clearPending();
        }}
      />
    );
  }
  const table = draft.feature.open.table;
  return (
    <ResultView
      feature={draft.feature}
      text={draft.text}
      page={page}
      people={draft.people}
      scan={draft.scan}
      internalTexts={draft.internalTexts}
      // The organisation's own internal phrases (policy) are checked in what is inserted, as everywhere.
      internalPhrases={eff?.policy?.internalPhrases || []}
      // The draft goes into a blank form of the table the feature names, nowhere else.
      target={{ table, newRecord: true }}
      // It appears because the page changed (the blank form opened), not because the person asked for something in the panel.
      focusOnShow={false}
      onInserted={(spec) => {
        // The draft is used up when EVERY insert it offers went in (title and body), not after the first one.
        const next = afterInsert(doneFields, spec, draft.feature);
        setDoneFields(next.done);
        if (next.complete) {
          setInserted({ table });
          clearPending();
        }
      }}
      onClose={clearPending}
      audit={(outcome) => auditInsert({ feature: draft.feature.id, table, sysId: '', mode: eff?.values?.piiMode, outcome })}
    />
  );
}

/**
 * An AI email draft waiting on the email form of its ticket (AI9). "Insert subject" replaces the form's subject, "Insert body" goes
 * below what the form has in its body; both go through the one insert path (src/sidepanel/insertFlow.js insertText) with the email
 * form of THAT ticket as the only place they may land (`{ email: true, table, sysId }`: the content script refuses any other page),
 * one whitelisted box each, the safe-to-send review first, never a save and never a send. Used up when both went in.
 */
function EmailDraftCard({ draft, page, eff, onUsedUp }) {
  const headId = `ab-pending${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const expect = emailExpect(draft);
  const source = { expect, number: draft.number };
  const feature = useMemo(() => ({ id: draft.feature?.id || '', insert: emailInserts(draft) }), [draft]);
  const review = useMemo(
    () => ({
      people: draft.people || [],
      scan: draft.scan || null,
      internalTexts: draft.internalTexts || NO_TEXTS,
      // The organisation's internal-only phrases, as they are now (policy), else the ones the answer was checked with.
      internalPhrases: eff?.policy?.internalPhrases || draft.internalPhrases || NO_TEXTS,
    }),
    [draft, eff?.policy?.internalPhrases]
  );
  const [states, setStates] = useState(null); // are the subject and body boxes on this form (insertFlow readFieldStates)
  const [note, setNote] = useState(null);
  const [findings, setFindings] = useState(null); // { items, target, text, mode }: an insert the review stopped
  const [editing, setEditing] = useState(null); // { key, text } while the edit box is open
  const [done, setDone] = useState({}); // target keys that went in
  const [doneFields, setDoneFields] = useState([]);
  const [busy, setBusy] = useState(false);
  const guard = useRef(null);
  if (!guard.current) guard.current = createGuard();

  const baseTargets = useMemo(() => insertTargets(feature, { page }), [feature, page.surface]); // eslint-disable-line react-hooks/exhaustive-deps
  const targets = useMemo(() => applyFieldStates(baseTargets, states), [baseTargets, states]);
  useEffect(() => {
    let cancelled = false;
    readFieldStates(page, baseTargets, read, expect).then((s) => !cancelled && setStates(s));
    return () => {
      cancelled = true;
    };
    // (asked again when the page changes; expect follows the draft, which keys this card)
  }, [baseTargets, page.tabId, page.href]); // eslint-disable-line react-hooks/exhaustive-deps

  // Low findings (another person's name, an IP address) are shown, never hidden; they block nothing.
  const hints = useMemo(() => reviewInsert('body', [draft.subject, draft.body].filter(Boolean).join('\n\n'), review).hints, [draft, review]);
  const textFor = (target) => {
    try {
      return String(target?.spec?.pick?.() || '').trim();
    } catch {
      return '';
    }
  };
  const audit = (outcome) =>
    auditInsert({ feature: draft.feature?.id || '', table: expect.table, sysId: expect.sysId, provider: draft.provider, model: draft.model, mode: eff?.values?.piiMode, outcome });

  async function copy(why = '', value = draft.body) {
    try {
      await navigator.clipboard.writeText(value);
      setNote({ kind: 'ok', text: why ? t('{why} Copied to the clipboard instead.', { why }) : t('Copied to the clipboard.') });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: t('The browser blocked copying. Select the text and copy it by hand.') });
    }
  }

  async function insert(target, text, mode, force = false) {
    if (guard.current.busy) return null;
    setNote(null);
    setBusy(true);
    let outcome;
    try {
      outcome = await guard.current.run(null, () => insertText({ page, target, text, mode, source, pinned: expect, review, force, send: sendToTab }));
    } finally {
      setBusy(false);
    }
    if (!outcome) return null;
    if (outcome.status === 'findings') {
      if (!editing) setFindings({ items: outcome.items, target, text, mode });
      return outcome;
    }
    setFindings(null);
    if (outcome.status === 'inserted') {
      setNote({ kind: 'ok', text: outcome.note });
      setDone((d) => ({ ...d, [target.key]: true }));
      setEditing(null);
      audit('inserted');
      // Used up when the subject AND the body went in, not after the first one.
      const next = afterInsert(doneFields, target.spec, feature);
      setDoneFields(next.done);
      if (next.complete) onUsedUp();
    } else if (outcome.status === 'blocked') {
      setNote({ kind: 'warn', text: outcome.why });
    } else if (outcome.status === 'empty') {
      setNote({ kind: 'danger', text: t('That part is not in the draft, so there is nothing to insert. Use Copy instead.') });
    } else {
      await copy(outcome.why, text);
    }
    return outcome;
  }

  const insertNow = (target) => {
    const text = textFor(target);
    if (!text) {
      setNote({ kind: 'danger', text: t('That part is not in the draft, so there is nothing to insert. Use Copy instead.') });
      return;
    }
    insert(target, text, target.mode, false);
  };

  const subject = targets.find((item) => item.field === 'subject') || null;
  const body = targets.find((item) => item.field === 'body') || null;
  const blocked = targets.map((item) => item.blocked).find(Boolean) || '';
  // One line before the click: where each part lands, and that nothing is sent from here.
  const hint = blocked || `${subject ? t('The subject replaces the one on the form; the body goes below what is in it.') : t('The draft goes below what is in the email body.')} ${tr(EMAIL_NEXT)}`;
  const button = (target, main) =>
    target && (
      <button
        type="button"
        className={`ab-btn ab-btn-sm${main ? ' ab-btn-ai' : ''}`}
        disabled={busy || Boolean(done[target.key]) || Boolean(target.blocked)}
        title={target.blocked || target.where || ''}
        onClick={() => insertNow(target)}
      >
        {done[target.key] ? t('{field} inserted', { field: tr(target.fieldLabel) }) : target.label}
      </button>
    );

  return (
    <section className="ab-card ab-pending-email" aria-labelledby={headId}>
      <div className="ab-pending-email-head">
        <AiBadge title={t('Written by AI. It can be wrong: check it before you send it.')} />
        <h2 className="ab-h ab-pending-email-title" id={headId}>
          {t('Email draft for {number}', { number: draft.number ? isolate(draft.number) : t('this ticket') })}
        </h2>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={clearPending}>{t('Close')}</button>
      </div>
      <div className="ab-output">
        <SafeText text={draft.text} />
      </div>
      {findings && (
        <div className="ab-note ab-note-warn" role="alert">
          <strong>{isCustomerVisible(findings.target.field) ? t('Check before sending to the customer:') : t('Check before inserting:')}</strong>
          <ul className="ab-findings">
            {findings.items.map((f, i) => (
              <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => insert(findings.target, findings.text, findings.mode, true)}>{t('Insert anyway')}</button>
            <button
              type="button"
              className="ab-btn ab-btn-sm"
              disabled={busy}
              onClick={() => {
                const { target, text } = findings;
                setFindings(null);
                setNote(null);
                setEditing({ key: target.key, text });
              }}
            >
              {t('Edit first')}
            </button>
          </div>
        </div>
      )}
      {!findings && !editing && <ReviewHints hints={hints} />}
      {note && <p className={`ab-note ab-note-${note.kind}`} role="status">{note.text}</p>}
      {editing ? (
        <InsertEditor
          targets={[...targets.filter((item) => item.key === editing.key), ...targets.filter((item) => item.key !== editing.key)]}
          initial={editing.text}
          textFor={textFor}
          review={review}
          page={page}
          record={null}
          busy={busy}
          onInsert={(target, text, mode, force) => insert(target, text, mode, force)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="ab-row ab-pending-email-actions">
            {button(subject, true)}
            {button(body, !subject)}
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => copy()}>{t('Copy body')}</button>
          </div>
          <p className="ab-hint">{hint}</p>
        </>
      )}
    </section>
  );
}
