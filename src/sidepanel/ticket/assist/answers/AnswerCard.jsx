import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SafeText } from '../../../../render/SafeText.jsx';
import { AiBadge } from '../../../ui/primitives.jsx';
import { applyFieldStates, choicesOf, createGuard, insertTargets, insertText, readFieldStates, reviewInsert } from '../../../insertFlow.js';
import { auditRefFromPage, currentFromPage, isCustomerVisible, matchesExpect, sourceFromPack, wrongRecordText } from '../../../../lib/fillable.js';
import { auditInsert } from '../../../../lib/storage.js';
import { resolveProviderConfig } from '../../../../providers/config.js';
import { featureById } from '../../../../features/registry.js';
import { read } from '../../../ask.js';
import { openInNewTab, openNewRecord } from '../../../openRecord.js';
import { clearPending, emailDraft, isEmailFeature, originOf, setPending } from '../../../pendingDraft.js';
import { emailFormUrl, parseEmailDraft } from '../../../../compose/emailRecommend.js';
import { madeWithoutLine } from '../../../runLogic.js';
import { madeWithoutText } from '../../../../features/parts.js';
import ReviewHints from '../../../ReviewHints.jsx';
import InsertEditor from './InsertEditor.jsx';
import { LANGUAGES, ago, answerPrimary, baseFeatureOf, plainOf, refineChoices, titleOf } from './logic.js';

const NO_TEXTS = [];
const sendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

/**
 * One answer on the Ticket screen (AI0.4). Folded, it is one line ("Earlier: Summary · 2 min ago"); open, it is the answer with at
 * most four buttons in a row: the main one (Insert, or Copy for a note to self), the other of the two, Refine and More. The AI mark
 * is on its title. Close sits in the title row.
 *
 * Insert takes the part of the answer the feature's insert chooses and goes through the Actions agent's insert path
 * (src/sidepanel/insertFlow.js insertText): the record the answer was written for only, one whitelisted field, the safe-to-send
 * review first, never a save. "Edit before inserting" opens the text in a plain box first (InsertEditor), with the review re-run
 * on the edited text and Replace / Add below where the box allows both.
 *
 * An AI email draft (AI9) goes into the email form of its ticket, not into a box of the ticket: "Open the email form" opens it in a
 * new tab and carries the draft there (src/sidepanel/pendingDraft.js, shown by PendingDraft.jsx, where Insert subject / Insert body
 * are); "Copy body" is next to it, "Copy subject" and "Copy all" under More.
 *
 * props: answer (from the store), open, onToggle(open), page, eff, record, busy (a run is going on for this ticket: Refine and Try
 * again wait), onRefine(answer, preset, choice), onAgain(answer), onClose(answer)
 */
export default function AnswerCard({ answer, open, onToggle, page, eff, record, busy = false, onRefine, onAgain, onClose, now = Date.now() }) {
  const headId = `ab-answer${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // (no colons: the ids must work in a CSS selector)
  const base = baseFeatureOf(answer);
  const title = titleOf(answer);
  const when = ago(answer.at, now);
  const plain = useMemo(() => plainOf(answer.text), [answer.text]);
  const review = useMemo(
    // The organisation's internal-only phrases (policy internalPhrases) count for AI inserts as they do for typed comments.
    () => ({ people: answer.people || [], scan: answer.scan || null, internalTexts: Array.isArray(answer.lastPack?.internalTexts) ? answer.lastPack.internalTexts : NO_TEXTS, internalPhrases: eff?.policy?.internalPhrases || [] }),
    [answer.people, answer.scan, answer.lastPack, eff?.policy?.internalPhrases]
  );
  const [states, setStates] = useState(null); // which of the boxes the open form has (insertFlow readFieldStates)
  const [note, setNote] = useState(null); // { kind, text } about the last insert or copy
  const [findings, setFindings] = useState(null); // { items, target, text, mode }: an insert the review stopped
  const [editing, setEditing] = useState(null); // { text, key } while the edit box is open
  const [menu, setMenu] = useState(''); // '' | 'refine' | 'more'
  const [done, setDone] = useState({}); // target keys that were inserted
  const [inserting, setInserting] = useState(false);
  const guard = useRef(null);
  if (!guard.current) guard.current = createGuard();

  const wrongRecord = Boolean(answer.source?.expect) && !matchesExpect(answer.source.expect, currentFromPage(page));
  // (keyed on what the targets depend on, not on the page object, so the form is not asked again on every render)
  const baseTargets = useMemo(() => insertTargets(base, { record, page }), [base, record?.kind, page.surface, page.record?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const targets = useMemo(() => applyFieldStates(baseTargets, states), [baseTargets, states]);
  const primary = answerPrimary(answer, record?.kind);
  const choices = useMemo(() => choicesOf(base, plain), [base, plain]);
  // An AI email draft (AI9): its subject and body, and the email form of the ticket it was written for, where it is inserted.
  const email = useMemo(() => (isEmailFeature(base) ? parseEmailDraft(plain) : null), [base, plain]);
  const emailTicket = email ? answer.source?.expect || (record?.table && record?.sysId ? { table: record.table, sysId: record.sysId } : null) : null;
  const emailUrl = emailTicket ? emailFormUrl(page.href, emailTicket) : '';

  // Before the click: is each box on this form, and can it be typed into? Asked again when the page changes. Fail-soft (insertFlow).
  useEffect(() => {
    if (!open || wrongRecord || !baseTargets.length) return undefined;
    let cancelled = false;
    readFieldStates(page, baseTargets, read, answer.source?.expect || null).then((s) => !cancelled && setStates(s));
    return () => {
      cancelled = true;
    };
  }, [open, wrongRecord, baseTargets, page.tabId, page.href, answer.source]);

  const config = resolveProviderConfig(eff.values, eff.apiKey);
  const ref = sourceFromPack(answer.lastPack) ? answer.lastPack : auditRefFromPage(page);
  const audit = (outcome) => auditInsert({ feature: base?.id || '', table: ref.table, sysId: ref.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome });

  // The part of the answer one box takes (`pick`: the questions for the customer, not the agent's "Missing:" line).
  const textFor = (target) => {
    if (typeof target?.spec?.pick !== 'function') return plain;
    try {
      return String(target.spec.pick(plain) || '').trim();
    } catch {
      return '';
    }
  };

  // Low findings (another person's name, an IP address) are shown, never hidden; they block nothing.
  // The same review the insert runs (reviewInsert): in resolution notes, words shared with the work notes are a hint, not a stop.
  const hints = useMemo(() => {
    const visible = targets.find((t) => isCustomerVisible(t.field));
    return visible ? reviewInsert(visible.field, plain, review).hints : [];
  }, [targets, plain, review]);

  async function copy(why = '', value = plain) {
    try {
      await navigator.clipboard.writeText(value);
      setNote({ kind: 'ok', text: why ? `${why} Copied to the clipboard instead.` : 'Copied to the clipboard.' });
      audit('copied');
    } catch {
      setNote({ kind: 'danger', text: 'The browser blocked copying. Select the text and copy it by hand.' });
    }
  }

  async function insert(target, text, mode, force = false) {
    if (guard.current.busy) return null;
    setNote(null);
    setInserting(true);
    let outcome;
    try {
      outcome = await guard.current.run(null, () => insertText({ page, target, text, mode, source: answer.source, review, force, send: sendToTab }));
    } finally {
      setInserting(false);
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
    } else if (outcome.status === 'blocked') {
      setNote({ kind: 'warn', text: outcome.why });
    } else if (outcome.status === 'empty') {
      setNote({ kind: 'danger', text: 'That part is not in the text, so there is nothing to insert. Use Copy instead.' });
    } else {
      await copy(outcome.why, text);
    }
    return outcome;
  }

  const insertNow = (target) => {
    const text = textFor(target);
    if (!text) {
      setNote({ kind: 'danger', text: 'That part is not in the text, so there is nothing to insert. Use Copy instead.' });
      return;
    }
    insert(target, text, target.mode, false);
  };

  // "Open the email form": the email form is not a ticket, so neither the Ticket screen nor this answer is on show there. The draft
  // goes with it (src/sidepanel/pendingDraft.js: memory only, this site only, the email form of THIS ticket only, 15 minutes), and the
  // card at the top of the panel offers Insert subject / Insert body there.
  const openEmailForm = () => {
    setMenu('');
    const draft = emailDraft({
      feature: base,
      text: answer.text,
      people: answer.people,
      scan: answer.scan,
      internalTexts: review.internalTexts,
      internalPhrases: review.internalPhrases,
      href: page.href,
      ticket: emailTicket,
      number: answer.source?.number || record?.number || '',
      provider: config.provider,
      model: config.model,
    });
    if (!draft || !setPending(draft)) {
      setNote({ kind: 'warn', text: 'Agent Buddy could not keep the draft for the email form. Copy the body instead.' });
      return;
    }
    // A NEW tab, as the Insights email card does: the ticket stays open as it is (with anything typed on it and not saved), its
    // answers stay on the Ticket screen for when the agent comes back after sending, and the email client does not replace the ticket
    // in the tab's history. The side panel follows the tab in front, so it shows the email form, where the draft is waiting.
    if (!openInNewTab(page, emailUrl)) {
      clearPending();
      setNote({ kind: 'warn', text: 'Agent Buddy could not open the email form. Copy the body instead.' });
      return;
    }
    setNote({ kind: 'ok', text: 'The email form opened in a new tab. The draft waits there, at the top of this panel, for 15 minutes.' });
  };
  const startEdit = (target, text) => {
    setMenu('');
    setFindings(null);
    setNote(null);
    setEditing({ key: target?.key || '', text: text ?? textFor(target) });
  };

  if (!open) {
    return (
      <section className="ab-answer is-folded" data-answer={answer.id} aria-label={title}>
        <button type="button" className="ab-answer-fold" aria-expanded="false" onClick={() => onToggle(true)}>
          <span className="ab-cardx-chevron" aria-hidden="true" />
          <span className="ab-answer-fold-text">Earlier: {title}</span>
          <span className="ab-answer-when">· {when}{answer.unseen ? ' · new' : ''}</span>
        </button>
      </section>
    );
  }

  const first = targets[0] || null;
  const insertButton = (target, main) => {
    const inserted = Boolean(done[target.key]);
    return (
      <button
        type="button"
        className={`ab-btn ab-btn-sm${main ? ' ab-btn-ai' : ''}`}
        disabled={inserting || inserted || Boolean(target.blocked) || (wrongRecord && !target.table)}
        title={target.blocked || target.where || ''}
        onClick={() => insertNow(target)}
      >
        {inserted ? 'Inserted' : target.label}
      </button>
    );
  };
  const copyButton = (main) => (
    <button type="button" className={`ab-btn ab-btn-sm${main ? ' ab-btn-ai' : ''}`} onClick={() => copy()}>
      Copy
    </button>
  );
  // What else the card offers, under More: the other boxes, the edit box, a blank form to open, Try again.
  // (the first box has its own button in the row, as the main button or next to Copy)
  const otherTargets = targets.slice(1);
  const canOpen = Boolean(base?.open?.table) && page.newRecord?.table !== base.open.table;
  const hint = wrongRecord
    ? ''
    : email && emailUrl
      ? 'Open the email form to insert the subject and body there. Nothing is sent until you press Send.'
      : primary === 'insert' && first
        ? first.blocked || `${first.where} ${first.next}`
        : 'AI can be wrong: check it before you use it.';
  const question = answer.meta?.question || '';
  // What the request was made without (the pipeline's list, src/features/parts.js; else the pack's own access entries).
  const gapsLine = Array.isArray(answer.lastPack?.madeWithout) ? madeWithoutText(answer.lastPack.madeWithout) : madeWithoutLine(answer.lastPack?.gaps);

  return (
    <section className="ab-answer" data-answer={answer.id} aria-labelledby={headId}>
      <div className="ab-answer-head">
        <button type="button" id={headId} className="ab-answer-toggle" aria-expanded="true" onClick={() => onToggle(false)}>
          <span className="ab-cardx-chevron" aria-hidden="true" />
          <AiBadge title="Written by AI. It can be wrong: check it before you use it." />
          <span className="ab-answer-title">{title}</span>
          <span className="ab-answer-when">{when}</span>
        </button>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-answer-close" onClick={() => onClose(answer)}>
          Close
        </button>
      </div>
      {question && <p className="ab-answer-q">You asked: {question}</p>}
      {answer.notice && <p className="ab-note ab-note-warn" role="status">{answer.notice}</p>}
      <div className="ab-output">
        {choices.length ? (
          <ol className="ab-answer-choices">
            {choices.map((c, i) => (
              <li key={i}>
                <SafeText text={c} />
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => copy('', c)} aria-label={`Copy reply ${i + 1}`}>
                  Copy this
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <SafeText text={answer.text} />
        )}
      </div>
      {gapsLine && <p className="ab-hint ab-answer-gaps">{gapsLine}</p>}
      {wrongRecord && <p className="ab-note ab-note-warn" role="status">{wrongRecordText(answer.source)}</p>}
      {first?.caution && !wrongRecord && <p className="ab-note ab-note-warn ab-answer-caution">{first.caution}</p>}

      {findings && (
        <div className="ab-note ab-note-warn" role="alert">
          <strong>{isCustomerVisible(findings.target.field) ? 'Check before sending to the customer:' : 'Check before inserting:'}</strong>
          <ul className="ab-findings">
            {findings.items.map((f, i) => (
              <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={inserting} onClick={() => insert(findings.target, findings.text, findings.mode, true)}>Insert anyway</button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={inserting} onClick={() => startEdit(findings.target, findings.text)}>Edit first</button>
          </div>
        </div>
      )}
      {!findings && !editing && <ReviewHints hints={hints} />}
      {note && <p className={`ab-note ab-note-${note.kind}`} role="status">{note.text}</p>}

      {editing ? (
        <InsertEditor
          targets={[...targets.filter((t) => t.key === editing.key), ...targets.filter((t) => t.key !== editing.key)]}
          initial={editing.text}
          textFor={textFor}
          review={review}
          page={page}
          record={record}
          busy={inserting}
          onInsert={(target, text, mode, force) => insert(target, text, mode, force)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="ab-row ab-answer-actions">
            {email ? (
              // An email draft goes into the email form, not into a box of the ticket: open it (the draft goes along), or copy the body.
              <>
                {emailUrl && (
                  <button type="button" className="ab-btn ab-btn-sm ab-btn-ai" onClick={openEmailForm}>
                    Open the email form
                  </button>
                )}
                <button type="button" className={`ab-btn ab-btn-sm${emailUrl ? '' : ' ab-btn-ai'}`} disabled={!email.body} onClick={() => copy('', email.body)}>
                  Copy body
                </button>
              </>
            ) : (
              <>
                {primary === 'insert' && first ? insertButton(first, true) : copyButton(true)}
                {primary === 'insert' ? copyButton(false) : first ? insertButton(first, false) : null}
              </>
            )}
            <MenuButton id={`${headId}-refine`} label="Refine" open={menu === 'refine'} onToggle={() => setMenu(menu === 'refine' ? '' : 'refine')} />
            <MenuButton id={`${headId}-more`} label="More" open={menu === 'more'} onToggle={() => setMenu(menu === 'more' ? '' : 'more')} />
          </div>
          {menu === 'refine' && (
            <RefineMenu
              id={`${headId}-refine`}
              eff={eff}
              busy={busy}
              onClose={() => setMenu('')}
              onPick={(preset, choice) => {
                setMenu('');
                onRefine(answer, preset, choice);
              }}
            />
          )}
          {menu === 'more' && (
            <MenuPanel id={`${headId}-more`} label="More for this answer" onClose={() => setMenu('')}>
              {email && (
                <>
                  <button
                    type="button"
                    className="ab-menu-item"
                    disabled={!email.subject}
                    title={email.subject ? '' : 'The draft has no subject line.'}
                    onClick={() => {
                      setMenu('');
                      copy('', email.subject);
                    }}
                  >
                    Copy subject
                  </button>
                  <button
                    type="button"
                    className="ab-menu-item"
                    onClick={() => {
                      setMenu('');
                      copy();
                    }}
                  >
                    Copy all
                  </button>
                </>
              )}
              {targets.length > 0 && (
                <button type="button" className="ab-menu-item" disabled={inserting || wrongRecord} onClick={() => startEdit(first)}>
                  Edit before inserting
                </button>
              )}
              {otherTargets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="ab-menu-item"
                  disabled={inserting || Boolean(done[t.key]) || Boolean(t.blocked) || (wrongRecord && !t.table)}
                  title={t.blocked || t.where || ''}
                  onClick={() => {
                    setMenu('');
                    insertNow(t);
                  }}
                >
                  {done[t.key] ? `${t.label}: inserted` : t.label}
                </button>
              ))}
              {canOpen && (
                <button
                  type="button"
                  className="ab-menu-item"
                  onClick={() => {
                    setMenu('');
                    // The tab is about to leave this record: the draft waits (in memory, this site only, 15 minutes) for the blank form.
                    if (!setPending({ feature: base, text: answer.text, people: answer.people, scan: answer.scan, internalTexts: review.internalTexts, origin: originOf(page.href) })) {
                      setNote({ kind: 'warn', text: 'Agent Buddy could not keep the draft for the new form. Copy it first.' });
                      return;
                    }
                    if (!openNewRecord(page, base.open.table)) setNote({ kind: 'warn', text: 'Agent Buddy could not open that form. Copy the text instead.' });
                  }}
                >
                  {base.open.label || 'Open a new form'}
                </button>
              )}
              <button
                type="button"
                className="ab-menu-item"
                disabled={busy}
                onClick={() => {
                  setMenu('');
                  onAgain(answer);
                }}
              >
                Try again
              </button>
            </MenuPanel>
          )}
          {hint && <p className="ab-hint ab-answer-hint">{hint}</p>}
        </>
      )}
    </section>
  );
}

/** A button that opens a small panel of choices under the card's buttons (a disclosure, not a menu widget). */
function MenuButton({ id, label, open, onToggle }) {
  return (
    <button type="button" className="ab-btn ab-btn-sm ab-menu-toggle" aria-expanded={open} aria-controls={id} data-menu={id} onClick={onToggle}>
      {label}
      <span className="ab-menu-caret" aria-hidden="true" />
    </button>
  );
}

/** The panel a MenuButton opens: its first choice takes the focus; Escape closes it and puts the focus back on its button. */
function MenuPanel({ id, label, onClose, children }) {
  const box = useRef(null);
  useEffect(() => {
    box.current?.querySelector('button:not([disabled]), select, input')?.focus();
  }, []);
  return (
    <div
      id={id}
      ref={box}
      className="ab-menu"
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        const toggle = typeof document !== 'undefined' ? document.querySelector(`[data-menu="${id}"]`) : null;
        toggle?.focus();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Refine an answer (AI23 on an answer): Shorter, More formal, Friendlier, Translate (a language from the fixed list) and "Your own
 * instruction". Each runs a rewrite on the answer's text through the same run as everything else; the result is a new answer.
 */
function RefineMenu({ id, eff, busy, onPick, onClose }) {
  const ids = `ab-refine${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [language, setLanguage] = useState('es');
  const [instruction, setInstruction] = useState('');
  const choices = refineChoices(eff.policy, featureById);
  const simple = choices.filter((p) => !p.needsLanguage && !p.needsText);
  const translate = choices.find((p) => p.needsLanguage);
  const own = choices.find((p) => p.needsText);
  if (!choices.length) {
    return (
      <MenuPanel id={id} label="Refine this answer" onClose={onClose}>
        <p className="ab-hint">Your organisation has switched the rewrite tools off.</p>
      </MenuPanel>
    );
  }
  return (
    <MenuPanel id={id} label="Refine this answer" onClose={onClose}>
      <div className="ab-menu-row">
        {simple.map((p) => (
          <button key={p.id} type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => onPick(p)}>
            {p.label}
          </button>
        ))}
      </div>
      {translate && (
        <div className="ab-menu-row">
          <label className="ab-sub" htmlFor={`${ids}-lang`}>Translate to</label>
          <select id={`${ids}-lang`} className="ab-select ab-refine-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => onPick(translate, { language })}>
            Translate
          </button>
        </div>
      )}
      {own && (
        <form
          className="ab-menu-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!instruction.trim()) return;
            onPick(own, { instruction });
          }}
        >
          <label className="ab-sub" htmlFor={`${ids}-own`}>Your own instruction</label>
          <input
            id={`${ids}-own`}
            className="ab-input ab-refine-own"
            type="text"
            value={instruction}
            maxLength={500}
            autoComplete="off"
            placeholder="Two sentences, and mention the reboot"
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button type="submit" className="ab-btn ab-btn-sm" disabled={busy || instruction.trim().length < 5}>
            Rewrite
          </button>
        </form>
      )}
    </MenuPanel>
  );
}
