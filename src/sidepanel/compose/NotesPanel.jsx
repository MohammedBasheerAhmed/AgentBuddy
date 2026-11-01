import React, { useEffect, useRef, useState } from 'react';
import AiKeyNote from '../AiKeyNote.jsx';
import { read } from '../ask.js';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { MAX_FORM_TEXT } from '../../compose/formFields.js';
import { CONTACT_TYPES, LEVELS, parseTicketProposal, planFill } from '../../compose/notesToTicket.js';
import { buildComposePack, pageTable, peopleFromNames } from '../../compose/rewrite.js';
import { reviewForCustomer } from '../../safeSend/review.js';
import { expectFromPage } from '../../lib/fillable.js';
import { ReviewHints, featureState, fillField, fillReason, isAiReady, useFill } from './shared.js';
import { openNewRecord } from '../openRecord.js';
import { AiBadge } from '../ui/primitives.jsx';
import { shownFor } from '../../profiles/profiles.js';
import NotesHints from './NotesHints.jsx';
import { t } from '../../i18n/index.js';

const FEATURE_ID = 'notes-to-ticket';
const FIELD_NAMES = { short_description: 'Short description', description: 'Description', impact: 'Impact', urgency: 'Urgency', contact_type: 'Contact type' };
const CASE_TABLE = 'sn_customerservice_case';

/** The blank forms this person may want to open: an incident (IT), a case (customer service). Both when neither profile is on. */
export function blankFormsFor(eff) {
  const incident = shownFor(['it'], eff);
  const csCase = shownFor(['csm'], eff);
  const out = [];
  if (incident || !csCase) out.push({ table: 'incident', label: 'Open a blank incident' });
  if (csCase) out.push({ table: CASE_TABLE, label: 'Open a blank case' });
  return out;
}

// AI24 Notes to ticket, on the Write screen's AI Assist half: rough notes become a proposal for a NEW ticket's fields, reviewed by the
// person and filled into a blank incident or case form they opened (a button opens one in this tab). Caller, category and group are
// suggested without AI (NotesHints) and never filled: the person picks them on the form.
export default function NotesPanel({ page, eff, showKeyNote = true }) {
  const run = useRun({ page, eff, record: page.record });
  const fill = useFill({ page, eff, run });
  const [notes, setNotes] = useState('');
  const [names, setNames] = useState('');
  const [values, setValues] = useState(null); // the proposal as editable values
  const [proposal, setProposal] = useState(null); // the parsed answer (what is only shown, never filled)
  const [warnings, setWarnings] = useState(null); // things to confirm before filling
  const [outcome, setOutcome] = useState(null); // { kind, text } after a fill
  const [filling, setFilling] = useState(false);
  const [filled, setFilled] = useState(false); // the form was filled: the button says so until the values change or a new answer comes
  const fillingNow = useRef(false); // set at once, so a second click before the next render cannot start a second fill
  const parsed = useRef(null); // the answer already turned into editable values
  const [proposalNo, setProposalNo] = useState(0); // a new proposal reads its suggestions again
  const aiReady = isAiReady(eff);
  const { feature, available } = featureState(FEATURE_ID, eff.policy);

  // A new answer becomes editable values; the person's edits stay until the next answer.
  useEffect(() => {
    if (run.phase !== 'done' || run.active?.id !== FEATURE_ID || run.result === parsed.current) return;
    parsed.current = run.result;
    const p = parseTicketProposal(toPlainText(parseSafeText(run.result || '')));
    setProposal(p);
    setProposalNo((n) => n + 1);
    setValues({ shortDescription: p.shortDescription, description: p.description, impact: p.impact, urgency: p.urgency, contactType: p.contactType });
    setWarnings(null);
    setOutcome(null);
    setFilled(false);
    fill.clear();
    // fill.clear is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.result, run.active]);

  function write() {
    if (!feature || !available || !notes.trim()) return;
    parsed.current = null;
    setValues(null);
    setProposal(null);
    setOutcome(null);
    setWarnings(null);
    setFilled(false);
    fill.clear();
    // The notes are the only data. Names the agent lists are masked precisely; the preview shows what is sent.
    // The pack carries the real table of the page (the blank form), so the table policy and the HR gate apply to the notes.
    run.run(feature, { getPack: async () => buildComposePack({ text: notes, people: peopleFromNames(names), label: 'Call notes', field: 'notes', table: pageTable(page) }) });
  }

  const set = (key) => (e) => {
    setFilled(false);
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };
  const plan = values ? planFill(values, page.newRecord) : null;

  async function fillForm(force = false) {
    if (!plan?.canFill || fillingNow.current) return;
    // Held from the first moment (the check below reads the form), so a second click cannot start a second fill.
    fillingNow.current = true;
    setFilling(true);
    try {
      await fillFormNow(force);
    } finally {
      fillingNow.current = false;
      setFilling(false);
    }
  }

  async function fillFormNow(force) {
    setOutcome(null);
    if (!force) {
      const found = [];
      // The description and short description are read by the customer on a portal: same check as a customer comment.
      const text = `${values.shortDescription}\n${values.description}`.trim();
      for (const f of reviewForCustomer(text, { people: run.people, scan: run.scan }).serious) found.push(`${f.advice} ${f.excerpt}`);
      // Do not silently replace what the agent already typed.
      try {
        const textFields = plan.fields.map((f) => f.field).filter((n) => n === 'short_description' || n === 'description');
        const current = textFields.length ? await read(page.tabId, 'formValues', { names: textFields }) : null;
        if (current?.available) {
          for (const n of textFields) if ((current.values[n] || '').trim()) found.push(`The ${FIELD_NAMES[n].toLowerCase()} field already has text. Filling replaces it.`);
        }
      } catch {
        /* the fill below reports what it could not do */
      }
      if (found.length) {
        setWarnings(found);
        return;
      }
    }
    setWarnings(null);
    // Every field goes to the blank form that is open now, and only to it: if another form comes up halfway, the rest are refused.
    const expect = expectFromPage(page);
    const done = [];
    const failed = [];
    for (const f of plan.fields) {
      // eslint-disable-next-line no-await-in-loop -- one field at a time, in a fixed order
      const answer = await fillField(page, { field: f.field, value: f.value, label: f.label, mode: 'replace', expect });
      if (answer.ok) done.push(FIELD_NAMES[f.field]);
      else failed.push(`${FIELD_NAMES[f.field]} (${fillReason(answer.reason).replace(/\.$/, '').toLowerCase()})`);
    }
    if (done.length && !failed.length) setFilled(true);
    if (done.length) fill.audit('inserted');
    if (done.length && !failed.length) setOutcome({ kind: 'ok', text: `Filled: ${done.join(', ')}. Review the form, then save the record yourself.` });
    else if (done.length) setOutcome({ kind: 'warn', text: `Filled: ${done.join(', ')}. Not filled: ${failed.join('; ')}. Copy those values instead.` });
    else setOutcome({ kind: 'danger', text: `Nothing was filled: ${failed.join('; ')}. Use Copy instead.` });
  }

  const showReview = run.phase === 'done' && run.active?.id === FEATURE_ID && values && proposal;
  const allText = values
    ? [
        `Short description: ${values.shortDescription}`,
        `Description: ${values.description}`,
        values.impact && `Impact: ${values.impact}`,
        values.urgency && `Urgency: ${values.urgency}`,
        values.contactType && `Contact type: ${CONTACT_TYPES.find((c) => c.value === values.contactType)?.label || ''}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return (
    <div className="ab-compose-stack">
      {showKeyNote && <AiKeyNote eff={eff} what="this" />}

      <section className="ab-compose-input" aria-label={t('Rough notes')}>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-notes-text">{t('Rough notes from the call, chat or visit')}</label>
          <textarea
            id="ab-notes-text"
            className="ab-textarea ab-compose-text"
            value={notes}
            maxLength={MAX_FORM_TEXT}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('vpn down since this morning, error 809, tried restart, urgent for sales team...')}
          />
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-notes-names">{t('Names to hide from the AI (optional)')}</label>
          <input id="ab-notes-names" className="ab-input" value={names} onChange={(e) => setNames(e.target.value)} placeholder={t('Abel Tuter, Priya Raman')} autoComplete="off" />
          <span className="ab-hint">{t('Emails, phone numbers and card numbers are hidden automatically. A name written only in the notes cannot be found by pattern, so list it here. Check the preview before sending.')}</span>
        </div>
        <div className="ab-row">
          {/* filled only while it is the next step (notes typed, no proposal yet): one filled button on the screen at a time */}
          <button type="button" className={notes.trim() && !values ? 'ab-btn ab-wk-aibtn' : 'ab-btn ab-wk-aibtn-quiet'} disabled={!aiReady || !available || !notes.trim() || run.busy} onClick={write} title={available ? 'Sends the masked notes to the AI you chose, after a preview.' : 'Switched off by your organisation.'}>
            <AiBadge label="" title="" /> Write the ticket
          </button>
        </div>
        <BlankForms page={page} eff={eff} />
      </section>

      <RunPanel run={run} eff={eff} page={page} readingText="Getting ready…" />

      {showReview && (
        <section className="ab-card ab-compose-actions" aria-label={t('Review before filling the form')}>
          <h3 className="ab-h">{t('Review, then fill the form')}</h3>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-notes-short">{t('Short description')}</label>
            <input id="ab-notes-short" className="ab-input" maxLength={160} value={values.shortDescription} onChange={set('shortDescription')} />
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-notes-desc">{t('Description')}</label>
            <textarea id="ab-notes-desc" className="ab-textarea ab-compose-text" value={values.description} onChange={set('description')} />
          </div>
          <div className="ab-compose-grid">
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-impact">{t('Impact')}</label>
              <select id="ab-notes-impact" className="ab-select" value={values.impact} onChange={set('impact')}>
                <option value="">{t('Leave as is')}</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.label}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-urgency">{t('Urgency')}</label>
              <select id="ab-notes-urgency" className="ab-select" value={values.urgency} onChange={set('urgency')}>
                <option value="">{t('Leave as is')}</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.label}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-contact">{t('Contact type')}</label>
              <select id="ab-notes-contact" className="ab-select" value={values.contactType} onChange={set('contactType')}>
                <option value="">{t('Leave as is')}</option>
                {CONTACT_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          {(proposal.impactText && !proposal.impact) || (proposal.urgencyText && !proposal.urgency) || (proposal.contactTypeText && !proposal.contactType) ? (
            <p className="ab-hint">
              Not filled, because Agent Buddy does not recognise the value:
              {proposal.impactText && !proposal.impact ? ` Impact "${proposal.impactText}".` : ''}
              {proposal.urgencyText && !proposal.urgency ? ` Urgency "${proposal.urgencyText}".` : ''}
              {proposal.contactTypeText && !proposal.contactType ? ` Contact type "${proposal.contactTypeText}".` : ''}
            </p>
          ) : null}
          {proposal.categoryHint && (
            <p className="ab-sub">
              Category hint: <strong>{proposal.categoryHint}</strong> (shown only; pick the category on the form yourself)
            </p>
          )}
          <NotesHints key={proposalNo} page={page} text={values.shortDescription} names={names} />
          {proposal.questions.length > 0 && (
            <>
              <h4 className="ab-compose-sub">{t('Questions still to ask')}</h4>
              <ol className="ab-compose-list">
                {proposal.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </>
          )}

          {plan && !plan.canFill && (
            <div className="ab-note" role="status">
              <p className="ab-write-reason">{plan.reason}</p>
              {!page.newRecord && <BlankForms page={page} eff={eff} quiet={false} />}
            </div>
          )}
          <ReviewHints hints={reviewForCustomer(`${values.shortDescription}
${values.description}`.trim(), { people: run.people, scan: run.scan }).hints} />

          {warnings && (
            <div className="ab-note ab-note-warn" role="alert">
              <strong>{t('Check before filling:')}</strong>
              <ul className="ab-compose-list">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => fillForm(true)}>{t('Fill anyway')}</button>
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => setWarnings(null)}>{t('Cancel')}</button>
              </div>
            </div>
          )}

          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={!plan?.canFill || filling || filled} onClick={() => fillForm(false)}>
              {filled ? 'Filled' : 'Fill the form'}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={!values.shortDescription.trim()} onClick={() => fill.copy(values.shortDescription)}>
              {t('Copy short description')}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={!values.description.trim()} onClick={() => fill.copy(values.description)}>
              {t('Copy description')}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => fill.copy(allText)}>{t('Copy all')}</button>
          </div>
          {outcome && <p className={`ab-note ab-note-${outcome.kind}`} role="status">{outcome.text}</p>}
          {fill.note && <p className={`ab-note ab-note-${fill.note.kind}`} role="status">{fill.note.text}</p>}
          <p className="ab-hint">{t('Nothing is saved or sent. You press Save in the form yourself.')}</p>
        </section>
      )}
    </div>
  );
}

/**
 * "Open a blank incident" (and/or case): the form opens in this tab, on the classic UI, and the proposal stays here to fill it. Shown
 * while no blank form is open. Nothing is created: the form is empty until the person fills and saves it.
 */
function BlankForms({ page, eff, quiet = true }) {
  const [note, setNote] = useState('');
  if (page.newRecord) return null;
  const forms = blankFormsFor(eff);
  return (
    <>
      <div className="ab-row ab-write-blank">
        {forms.map((f) => (
          <button
            key={f.table}
            type="button"
            className={quiet ? 'ab-btn ab-btn-sm ab-btn-quiet' : 'ab-btn ab-btn-sm'}
            onClick={() => setNote(openNewRecord(page, f.table) ? 'The blank form opens in this tab. Your notes and the proposal stay here.' : 'The blank form could not be opened from here. Open it in ServiceNow yourself.')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {note && <p className="ab-hint" role="status">{note}</p>}
    </>
  );
}
