import React, { useId, useMemo, useRef, useEffect, useState } from 'react';
import { describeTarget, reviewInsert } from '../../../insertFlow.js';
import { isCustomerVisible } from '../../../../lib/fillable.js';
import ReviewHints from '../../../ReviewHints.jsx';
import { t } from '../../../../i18n/index.js';

const MAX_EDIT = 8000;

/**
 * Edit before Insert (AI0.4, F5): the part of the answer that would go into the form, in a plain-text box the person can change, with
 * the safe-to-send review run again on every change (the same review the insert runs: src/sidepanel/insertFlow.js reviewInsert),
 * the Replace / Add below choice where the box allows both, and Insert / Cancel. Nothing is written until Insert, and Insert goes
 * through the same insert path as every other (the record the answer was written for, one field, never a save).
 *
 * props:
 *   targets         the boxes it can go into (insertFlow insertTargets, with field states applied); the first is chosen first
 *   initial         the text to start from (the part of the answer the target's pick chose)
 *   textFor(target) the starting text for another target (its own pick)
 *   review          { people, scan, internalTexts }
 *   page, record    for the where-it-lands sentence
 *   busy            an insert is in flight
 *   onInsert(target, text, mode, force) -> Promise<outcome>   the card runs the insert and returns its outcome
 *   onCancel
 */
export default function InsertEditor({ targets, initial, textFor, review, page, record, busy = false, onInsert, onCancel }) {
  const usable = (Array.isArray(targets) ? targets : []).filter((x) => !x.blocked);
  const [key, setKey] = useState(usable[0]?.key || '');
  const target = usable.find((x) => x.key === key) || usable[0] || null;
  const [text, setText] = useState(String(initial ?? '').slice(0, MAX_EDIT));
  const [mode, setMode] = useState(target?.mode || 'append');
  const [findings, setFindings] = useState(null); // serious findings the last Insert stopped at
  const ids = `ab-edit${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // (no colons: the ids must work in a CSS selector)
  const box = useRef(null);
  useEffect(() => {
    box.current?.focus();
  }, []);

  // The review of what is in the box now: serious findings are said before the click, low ones as "Worth a look".
  const live = useMemo(() => (target && text.trim() ? reviewInsert(target.field, text, review || {}) : { serious: [], hints: [] }), [target, text, review]);
  if (!target) {
    return (
      <div className="ab-insert-editor">
        <p className="ab-note ab-note-warn" role="status">{t('There is no box on this form this text can go into. Use Copy.')}</p>
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-sm" onClick={onCancel}>{t('Close')}</button>
        </div>
      </div>
    );
  }
  const modes = Array.isArray(target.modes) && target.modes.length ? target.modes : [target.mode || 'append'];
  const chosen = modes.includes(mode) ? mode : modes[0];
  const told = describeTarget(target, chosen, { page, record });
  const name = t(target.fieldLabel || target.label); // (the field's label as the page names it stays English in the target: the page is matched by it)

  const go = async (force = false) => {
    const outcome = await onInsert(target, text, chosen, force);
    if (outcome?.status === 'findings') setFindings(outcome.items);
    else setFindings(null);
  };

  return (
    <div className="ab-insert-editor" role="group" aria-labelledby={`${ids}-label`}>
      {usable.length > 1 && (
        <div className="ab-field">
          <label className="ab-label" htmlFor={`${ids}-target`}>{t('Goes into')}</label>
          <select
            id={`${ids}-target`}
            className="ab-select"
            value={target.key}
            onChange={(e) => {
              const next = usable.find((x) => x.key === e.target.value);
              if (!next) return;
              setKey(next.key);
              setMode(next.mode);
              setFindings(null);
              if (typeof textFor === 'function') setText(String(textFor(next) ?? '').slice(0, MAX_EDIT));
            }}
          >
            {usable.map((x) => (
              <option key={x.key} value={x.key}>{t(x.fieldLabel || x.label)}</option>
            ))}
          </select>
        </div>
      )}
      <div className="ab-field">
        <label className="ab-label" id={`${ids}-label`} htmlFor={`${ids}-text`}>
          {isCustomerVisible(target.field) && target.field === 'comments' ? t('Text for {name} (the customer sees it)', { name }) : t('Text for {name}', { name })}
        </label>
        <textarea
          id={`${ids}-text`}
          ref={box}
          className="ab-textarea ab-insert-text"
          value={text}
          maxLength={MAX_EDIT}
          spellCheck
          aria-describedby={`${ids}-where`}
          onChange={(e) => {
            setText(e.target.value);
            setFindings(null);
          }}
        />
      </div>
      {modes.length > 1 && (
        <fieldset className="ab-insert-modes">
          <legend className="ab-sub">{t('What is already in {name}', { name })}</legend>
          <label className="ab-radio">
            <input type="radio" name={`${ids}-mode`} value="append" checked={chosen === 'append'} onChange={() => setMode('append')} />
            {t('Keep it, add this below')}
          </label>
          <label className="ab-radio">
            <input type="radio" name={`${ids}-mode`} value="replace" checked={chosen === 'replace'} onChange={() => setMode('replace')} />
            {t('Replace it with this')}
          </label>
        </fieldset>
      )}
      <p className="ab-hint" id={`${ids}-where`}>{told.where} {told.next}</p>
      {findings ? (
        <div className="ab-note ab-note-warn" role="alert">
          <strong>{isCustomerVisible(target.field) ? t('Check before sending to the customer:') : t('Check before inserting:')}</strong>
          <ul className="ab-findings">
            {findings.map((f, i) => (
              <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => go(true)}>{t('Insert anyway')}</button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={busy} onClick={() => { setFindings(null); box.current?.focus(); }}>{t('Keep editing')}</button>
          </div>
        </div>
      ) : (
        <>
          {live.serious.length > 0 && (
            <div className="ab-note ab-note-warn" role="status">
              <strong>{t('Check this before you insert:')}</strong>
              <ul className="ab-findings">
                {live.serious.map((f, i) => (
                  <li key={i}>{f.advice} <span className="ab-mono">{f.excerpt}</span></li>
                ))}
              </ul>
            </div>
          )}
          <ReviewHints hints={live.hints} />
        </>
      )}
      <div className="ab-row ab-insert-actions">
        <button type="button" className="ab-btn ab-btn-sm ab-btn-ai" disabled={busy || !text.trim()} onClick={() => go(false)}>
          {chosen === 'replace' ? t('Replace {name}', { name }) : t('Insert into {name}', { name })}
        </button>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={busy} onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </div>
  );
}
