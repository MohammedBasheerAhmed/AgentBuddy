import React, { useState } from 'react';
import { read } from '../ask.js';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { FORM_FIELDS, MAX_FORM_TEXT, formFieldByName } from '../../compose/formFields.js';
import { LANGUAGES, REWRITE_PRESETS, buildComposePack, mergePeople, peopleFromNames, withLanguage } from '../../compose/rewrite.js';
import { FillFeedback, aiNotReadyText, featureState, isAiReady, readRecordPeople, useFill } from './shared.js';

const isRewriteFeature = (feature) => Boolean(feature?.id) && REWRITE_PRESETS.some((p) => p.featureId === feature.id);
const SIMPLE = REWRITE_PRESETS.filter((p) => !p.needsLanguage);
const WITH_LANGUAGE = REWRITE_PRESETS.filter((p) => p.needsLanguage);

export default function RewritePanel({ page, eff }) {
  const run = useRun({ page, eff, record: page.record });
  const fill = useFill({ page, eff, run });
  const [text, setText] = useState('');
  const [target, setTarget] = useState('comments'); // the form field the text is read from and put back into
  const [language, setLanguage] = useState('es');
  const [names, setNames] = useState('');
  const [status, setStatus] = useState(null); // { kind, text } about reading the form
  const [reading, setReading] = useState(false);
  const aiReady = isAiReady(eff);
  const hasText = text.trim().length > 0;
  const field = formFieldByName(target);

  async function useForm() {
    setStatus(null);
    setReading(true);
    try {
      const answer = await read(page.tabId, 'formValues', { names: [target] });
      const value = answer?.values?.[target] || '';
      if (!answer?.available) setStatus({ kind: 'warn', text: 'Agent Buddy cannot read the form on this page (Workspace and portal pages keep it out of reach). Paste the text here instead.' });
      else if (!value.trim()) setStatus({ kind: 'warn', text: `The ${field.label.toLowerCase()} field is empty. Type something in the form first, or paste the text here.` });
      else {
        setText(value);
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
    const chosen = preset.needsLanguage ? withLanguage(feature, language) : feature;
    if (!chosen) return;
    fill.clear();
    run.run(chosen, {
      // The only data is the text. The open record's people (when there is one) and any names the agent listed are added so
      // their names are masked precisely; the text itself is never in a prompt.
      getPack: async () => {
        const known = await readRecordPeople(page, eff);
        if (!known.ok) setStatus({ kind: 'warn', text: "The ticket's people could not be read, so only the names you list are hidden. Check the preview." });
        return buildComposePack({ text, people: mergePeople(known.people, peopleFromNames(names)) });
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
  const put = (mode) => fill.insert({ field: target, value: plain, label: field.fieldLabel, mode, check: field.customerVisible });

  return (
    <div className="ab-compose-stack">
      {!aiReady && <p className="ab-note ab-note-warn">{aiNotReadyText(eff)}</p>}

      <section className="ab-card" aria-label="Text to rewrite">
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-text">Text to rewrite</label>
          <textarea
            id="ab-rewrite-text"
            className="ab-textarea ab-compose-text"
            value={text}
            maxLength={MAX_FORM_TEXT}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste or type the text here"
          />
          <span className="ab-hint">{text.length.toLocaleString()} of {MAX_FORM_TEXT.toLocaleString()} characters</span>
        </div>

        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-field">Form field</label>
          <div className="ab-row">
            <select id="ab-rewrite-field" className="ab-select ab-compose-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {FORM_FIELDS.map((f) => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
            </select>
            <button type="button" className="ab-btn ab-btn-sm" disabled={reading} onClick={useForm}>
              Use what I typed in the form
            </button>
          </div>
          <span className="ab-hint">The rewritten text can go back into this field.</span>
          {status && <p className={`ab-note ab-note-${status.kind}`} role="status">{status.text}</p>}
        </div>

        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-rewrite-names">Names to hide from the AI (optional)</label>
          <input id="ab-rewrite-names" className="ab-input" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Abel Tuter, Priya Raman" autoComplete="off" />
          <span className="ab-hint">
            The people on the open ticket are hidden automatically. Names only written in the text cannot be found by pattern, so list them here. Check the preview before sending.
          </span>
        </div>

        <div className="ab-label">Rewrite it</div>
        <div className="ab-row ab-compose-presets" role="group" aria-label="Rewrite presets">
          {SIMPLE.map((p) => button(p))}
        </div>
        <div className="ab-row ab-compose-presets" role="group" aria-label="Translate">
          <label className="ab-sub" htmlFor="ab-rewrite-language">Language</label>
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
        <section className="ab-card ab-compose-actions" aria-label="Use the rewrite">
          <h3 className="ab-h">Use it in the form</h3>
          <p className="ab-hint">Goes into: {field.label}. Change the field above if you need another one.</p>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" onClick={() => put('replace')}>
              Replace what is in the form
            </button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => put('append')}>
              Add below
            </button>
            <button
              type="button"
              className="ab-btn ab-btn-sm ab-btn-quiet"
              onClick={() => {
                setText(plain.slice(0, MAX_FORM_TEXT));
                run.reset();
                fill.clear();
              }}
            >
              Use as my text
            </button>
          </div>
          <FillFeedback fill={fill} />
          <p className="ab-hint">Nothing is saved or sent. You press Save in the form yourself.</p>
        </section>
      )}
    </div>
  );
}
