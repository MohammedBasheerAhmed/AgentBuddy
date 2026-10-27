import React, { useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { MAX_FORM_TEXT } from '../../compose/formFields.js';
import { CONTACT_TYPES, LEVELS, parseTicketProposal, planFill } from '../../compose/notesToTicket.js';
import { buildComposePack, pageTable, peopleFromNames } from '../../compose/rewrite.js';
import { reviewForCustomer } from '../../safeSend/review.js';
import { expectFromPage } from '../../lib/fillable.js';
import { ReviewHints, aiNotReadyText, featureState, fillField, fillReason, isAiReady, useFill } from './shared.js';

const FEATURE_ID = 'notes-to-ticket';
const FIELD_NAMES = { short_description: 'Short description', description: 'Description', impact: 'Impact', urgency: 'Urgency', contact_type: 'Contact type' };

export default function NotesPanel({ page, eff }) {
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
  const aiReady = isAiReady(eff);
  const { feature, available } = featureState(FEATURE_ID, eff.policy);

  // A new answer becomes editable values; the person's edits stay until the next answer.
  useEffect(() => {
    if (run.phase !== 'done' || run.active?.id !== FEATURE_ID || run.result === parsed.current) return;
    parsed.current = run.result;
    const p = parseTicketProposal(toPlainText(parseSafeText(run.result || '')));
    setProposal(p);
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
      {!aiReady && <p className="ab-note ab-note-warn">{aiNotReadyText(eff)}</p>}

      <section className="ab-card" aria-label="Rough notes">
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-notes-text">Rough notes from the call, chat or visit</label>
          <textarea
            id="ab-notes-text"
            className="ab-textarea ab-compose-text"
            value={notes}
            maxLength={MAX_FORM_TEXT}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="vpn down since this morning, error 809, tried restart, urgent for sales team..."
          />
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-notes-names">Names to hide from the AI (optional)</label>
          <input id="ab-notes-names" className="ab-input" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Abel Tuter, Priya Raman" autoComplete="off" />
          <span className="ab-hint">Emails, phone numbers and card numbers are hidden automatically. A name written only in the notes cannot be found by pattern, so list it here. Check the preview before sending.</span>
        </div>
        <button type="button" className="ab-btn ab-btn-primary" disabled={!aiReady || !available || !notes.trim() || run.busy} onClick={write} title={available ? '' : 'Switched off by your organisation.'}>
          Write the ticket
        </button>
      </section>

      <RunPanel run={run} eff={eff} page={page} readingText="Getting ready…" />

      {showReview && (
        <section className="ab-card ab-compose-actions" aria-label="Review before filling the form">
          <h3 className="ab-h">Review, then fill the form</h3>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-notes-short">Short description</label>
            <input id="ab-notes-short" className="ab-input" maxLength={160} value={values.shortDescription} onChange={set('shortDescription')} />
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-notes-desc">Description</label>
            <textarea id="ab-notes-desc" className="ab-textarea ab-compose-text" value={values.description} onChange={set('description')} />
          </div>
          <div className="ab-compose-grid">
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-impact">Impact</label>
              <select id="ab-notes-impact" className="ab-select" value={values.impact} onChange={set('impact')}>
                <option value="">Leave as is</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.label}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-urgency">Urgency</label>
              <select id="ab-notes-urgency" className="ab-select" value={values.urgency} onChange={set('urgency')}>
                <option value="">Leave as is</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.label}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-notes-contact">Contact type</label>
              <select id="ab-notes-contact" className="ab-select" value={values.contactType} onChange={set('contactType')}>
                <option value="">Leave as is</option>
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
          {proposal.questions.length > 0 && (
            <>
              <h4 className="ab-compose-sub">Questions still to ask</h4>
              <ol className="ab-compose-list">
                {proposal.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </>
          )}

          {plan && !plan.canFill && <p className="ab-note" role="status">{plan.reason}</p>}
          <ReviewHints hints={reviewForCustomer(`${values.shortDescription}
${values.description}`.trim(), { people: run.people, scan: run.scan }).hints} />

          {warnings && (
            <div className="ab-note ab-note-warn" role="alert">
              <strong>Check before filling:</strong>
              <ul className="ab-compose-list">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => fillForm(true)}>Fill anyway</button>
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => setWarnings(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={!plan?.canFill || filling || filled} onClick={() => fillForm(false)}>
              {filled ? 'Filled' : 'Fill the form'}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={!values.shortDescription.trim()} onClick={() => fill.copy(values.shortDescription)}>
              Copy short description
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={!values.description.trim()} onClick={() => fill.copy(values.description)}>
              Copy description
            </button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => fill.copy(allText)}>Copy all</button>
          </div>
          {outcome && <p className={`ab-note ab-note-${outcome.kind}`} role="status">{outcome.text}</p>}
          {fill.note && <p className={`ab-note ab-note-${fill.note.kind}`} role="status">{fill.note.text}</p>}
          <p className="ab-hint">Nothing is saved or sent. You press Save in the form yourself.</p>
        </section>
      )}
    </div>
  );
}
