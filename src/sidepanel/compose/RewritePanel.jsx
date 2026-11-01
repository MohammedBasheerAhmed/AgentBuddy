import React, { useRef, useState } from 'react';
import AiKeyNote from '../AiKeyNote.jsx';
import { read } from '../ask.js';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { FORM_FIELDS, MAX_FORM_TEXT, formFieldByName } from '../../compose/formFields.js';
import { LANGUAGES, REWRITE_PRESETS, buildComposePack, formReadRefusal, mergePeople, pageTable, peopleFromNames, withLanguage } from '../../compose/rewrite.js';
import { currentFromPage, expectFromPage, matchesExpect, wrongRecordText } from '../../lib/fillable.js';
import { FillFeedback, ReviewHints, featureState, hintsFor, isAiReady, readRecordPeople, useFill } from './shared.js';
import { AiBadge } from '../ui/primitives.jsx';
import { t } from '../../i18n/index.js';

const isRewriteFeature = (feature) => Boolean(feature?.id) && REWRITE_PRESETS.some((p) => p.featureId === feature.id);
const SIMPLE = REWRITE_PRESETS.filter((p) => !p.needsLanguage);
const WITH_LANGUAGE = REWRITE_PRESETS.filter((p) => p.needsLanguage);

// AI23 Rewrite (7 modes), on the Write screen's AI Assist half. The text the agent pasted or typed in the form is the only data sent;
// the result goes back into the field it came from (Add below or Replace), on the ticket it was made for.
export default function RewritePanel({ page, eff, showKeyNote = true }) {
  const run = useRun({ page, eff, record: page.record });
  const fill = useFill({ page, eff, run });
  const [text, setText] = useState('');
  const textBox = useRef(null); // "Use as my text" puts the focus back in the box the text went into
  const [target, setTarget] = useState('comments'); // the form field the text is read from and put back into
  const [language, setLanguage] = useState('es');
  const [names, setNames] = useState('');
  const [status, setStatus] = useState(null); // { kind, text } about reading the form
  const [reading, setReading] = useState(false);
  // Where the text in the box came from, when it was read from the open form: { field, expect, number }. Pasted text has none.
  const [provenance, setProvenance] = useState(null);
  // The record that was open when the rewrite was made: Replace / Add below only work while it is the one open ({ expect, number }).
  const [made, setMade] = useState(null);
  const aiReady = isAiReady(eff);
  const hasText = text.trim().length > 0;
  const field = formFieldByName(target);

  async function useForm() {
    setStatus(null);
    // An HR case, a table the organisation blocks, or a blocked field: the text is not read at all (the run would be refused anyway).
    const refusal = formReadRefusal(pageTable(page), target, eff.policy);
    if (refusal) {
      setStatus({ kind: 'warn', text: refusal });
      return;
    }
    setReading(true);
    try {
      const answer = await read(page.tabId, 'formValues', { names: [target] });
      const value = answer?.values?.[target] || '';
      if (!answer?.available) setStatus({ kind: 'warn', text: 'Agent Buddy cannot read the form on this page (Workspace and portal pages keep it out of reach). Paste the text here instead.' });
      else if (!value.trim()) setStatus({ kind: 'warn', text: `The ${field.label.toLowerCase()} field is empty. Type something in the form first, or paste the text here.` });
      else {
        setText(value);
        setProvenance({ field: target, expect: expectFromPage(page), number: page.record?.number || '' });
        setStatus({ kind: 'ok', text: `Took the ${field.label.toLowerCase()} from the form.` });
      }
    } catch (err) {
      setStatus({ kind: 'danger', text: err?.message || 'The form could not be read. Paste the text here instead.' });
    } finally {
      setReading(false);
    }
  }

  function go(preset) {
    const { feature, available } = featureState(preset.featureId, eff.policy);
    if (!feature || !available || !hasText) return;
    // Text read from a form belongs to that record: another record's policy (or HR gate) would not have applied to it.
    if (provenance && !matchesExpect(provenance.expect, currentFromPage(page))) {
      setStatus({ kind: 'warn', text: `This text was read from ${provenance.number || 'another record'}. Open that ticket again, or paste the text here.` });
      return;
    }
    setMade({ expect: expectFromPage(page), number: page.record?.number || '' });
    const chosen = preset.needsLanguage ? withLanguage(feature, language) : feature;
    if (!chosen) return;
    fill.clear();
    run.run(chosen, {
      // The only data is the text. The open record's people (when there is one) and any names the agent listed are added so
      // their names are masked precisely; the text itself is never in a prompt.
      getPack: async () => {
        const known = await readRecordPeople(page, eff);
        if (!known.ok) setStatus({ kind: 'warn', text: "The ticket's people could not be read, so only the names you list are hidden. Check the preview." });
        // The pack carries the real table of this page and the form field the text came from, so the table policy, the HR gate
        // and blockedFields apply to it like to any action on this record.
        return buildComposePack({ text, people: mergePeople(known.people, peopleFromNames(names)), table: pageTable(page), field: provenance?.field || 'text' });
      },
    });
  }

  const button = (preset, label) => {
    const { available } = featureState(preset.featureId, eff.policy);
    return (
      <button
        key={preset.id}
        type="button"
        className="ab-btn ab-btn-sm"
        disabled={!aiReady || !hasText || !available || run.busy}
        title={available ? '' : 'Switched off by your organisation.'}
        onClick={() => go(preset)}
      >
        {label || preset.label}
      </button>
    );
  };

  const showResult = run.phase === 'done' && isRewriteFeature(run.active);
  const plain = showResult ? toPlainText(parseSafeText(run.result || '')) : '';
  const wrongRecord = Boolean(made?.expect) && !matchesExpect(made.expect, currentFromPage(page));
  const put = (mode) => fill.insert({ field: target, value: plain, label: field.fieldLabel, mode, key: `${target}:${mode}`, expect: made ? made.expect : undefined, number: made?.number });

  return (
    <div className="ab-compose-stack">
      {showKeyNote && <AiKeyNote eff={eff} what="this" />}

      <section className="ab-compose-input" aria-label={t('Text to rewrite')}>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-text">{t('Text to rewrite')}</label>
          <textarea
            id="ab-rewrite-text"
            ref={textBox}
            className="ab-textarea ab-compose-text"
            value={text}
            maxLength={MAX_FORM_TEXT}
            onChange={(e) => {
              setText(e.target.value);
              if (!e.target.value.trim()) setProvenance(null);
            }}
            placeholder={t('Paste or type the text here')}
          />
          <span className="ab-hint">{text.length.toLocaleString()} of {MAX_FORM_TEXT.toLocaleString()} characters</span>
        </div>

        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-field">{t('Form field')}</label>
          <div className="ab-row">
            <select id="ab-rewrite-field" className="ab-select ab-compose-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {FORM_FIELDS.map((f) => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
            </select>
            <button type="button" className="ab-btn ab-btn-sm" disabled={reading} onClick={useForm}>
              {t('Use what I typed in the form')}
            </button>
          </div>
          <span className="ab-hint">{t('The rewritten text can go back into this field.')}</span>
          {status && <p className={`ab-note ab-note-${status.kind}`} role="status">{status.text}</p>}
        </div>

        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-names">{t('Names to hide from the AI (optional)')}</label>
          <input id="ab-rewrite-names" className="ab-input" value={names} onChange={(e) => setNames(e.target.value)} placeholder={t('Abel Tuter, Priya Raman')} autoComplete="off" />
          <span className="ab-hint">
            {t('The people on the open ticket are hidden automatically. Names only written in the text cannot be found by pattern, so list them here. Check the preview before sending.')}
          </span>
        </div>

        <div className="ab-label ab-write-ailabel">
          Rewrite it <AiBadge title={'Sends the masked text to the AI you chose, after a preview.'} />
        </div>
        <div className="ab-row ab-compose-presets" role="group" aria-label={t('Rewrite presets')}>
          {SIMPLE.map((p) => button(p))}
        </div>
        <div className="ab-row ab-compose-presets" role="group" aria-label={t('Translate')}>
          <label className="ab-sub" htmlFor="ab-rewrite-language">{t('Language')}</label>
          <select id="ab-rewrite-language" className="ab-select ab-compose-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          {WITH_LANGUAGE.map((p) => button(p, p.id === 'translate' ? 'Translate' : 'Bilingual'))}
        </div>
      </section>

      <RunPanel run={run} eff={eff} page={page} readingText="Getting ready…" />

      {showResult && (
        <RewriteResultActions
          field={field}
          fill={fill}
          made={made}
          wrongRecord={wrongRecord}
          hints={hintsFor(target, plain, { people: run.people, scan: run.scan, internalTexts: run.lastPack?.internalTexts, internalPhrases: eff.policy?.internalPhrases })}
          onPut={put}
          onUseAsText={() => {
            setText(plain.slice(0, MAX_FORM_TEXT));
            textBox.current?.focus();
            run.reset();
            fill.clear();
          }}
        />
      )}
    </div>
  );
}

/**
 * "Use it in the form" under a rewrite. "Add below" is the main button: it keeps what is in the form. "Replace" overwrites it, so it is
 * never the main button and says so. A one-line field (a short description) has no "below", so only Replace is offered.
 * Every button is off while an insert is in flight, after it worked into this field ("Inserted"), and when another record is open
 * than the one the rewrite was made on.
 */
export function RewriteResultActions({ field, fill, made, wrongRecord, hints, onPut, onUseAsText }) {
  return (
    <section className="ab-card ab-compose-actions" aria-label={t('Use the rewrite')}>
      <h3 className="ab-h">{t('Use it in the form')}</h3>
      <p className="ab-hint">
        Goes into: {field.label}
        {made?.number ? ` of ${made.number}` : ''}. Change the field above if you need another one.
      </p>
      <ReviewHints hints={hints} />
      {wrongRecord && <p className="ab-note ab-note-warn" role="status">{wrongRecordText(made)}</p>}
      <div className="ab-row">
        {!field.singleLine && (
          <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={fill.busy || wrongRecord || Boolean(fill.inserted[`${field.name}:append`])} onClick={() => onPut('append')}>
            {fill.inserted[`${field.name}:append`] ? 'Inserted' : 'Add below'}
          </button>
        )}
        <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy || wrongRecord || Boolean(fill.inserted[`${field.name}:replace`])} onClick={() => onPut('replace')}>
          {fill.inserted[`${field.name}:replace`] ? 'Inserted' : 'Replace what is in the form'}
        </button>
        <button type="button" className="ab-btn ab-btn-sm ab-btn-quiet" disabled={fill.busy} onClick={onUseAsText}>
          {t('Use as my text')}
        </button>
      </div>
      <p className="ab-hint">{field.singleLine ? 'This replaces what is in the form: it is a one-line field.' : 'This replaces what is in the form if you choose Replace. Add below keeps it.'}</p>
      <FillFeedback fill={fill} />
      <p className="ab-hint">{t('Nothing is saved or sent. You press Save in the form yourself.')}</p>
    </section>
  );
}
