// The small pieces every section of the Settings page is built from: a section's title and one-line explanation, a switch, the note
// that a setting is locked, a field's error, a section's status line, a text box that saves a moment after typing, and
// useSaveSetting(), the one way a section saves a choice. Kept here so a section file holds only what that section says and does.
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveSettings } from '../lib/storage.js';
import { t } from '../i18n/index.js';

/**
 * A section's title and its one-line explanation. The title's id is what the section's aria-labelledby and the menu beside the page
 * point at; the menu moves the focus to it (tabIndex -1), so reading goes on from the section that was chosen.
 *   descId   an id for the explanation, when a field names it in its aria-describedby
 */
export function SectionHead({ id, title, descId, children }) {
  return (
    <div className="ab-set-head">
      <h2 className="ab-h ab-set-title" id={id} tabIndex={-1}>{title}</h2>
      {children ? <p className="ab-sub ab-set-desc" id={descId}>{children}</p> : null}
    </div>
  );
}

/**
 * A choice that turns something on or off: a real check box with its label (so it is found, said and pressed like one), shown as a
 * switch. role="switch" lets a screen reader say "on" and "off" instead of "ticked".
 *   onChange(checked)
 */
export function Switch({ id, checked, disabled = false, onChange, describedBy, children }) {
  return (
    <label className="ab-set-switch" htmlFor={id}>
      <span className="ab-set-switch-text">{children}</span>
      <input id={id} type="checkbox" role="switch" className="ab-set-switch-input" checked={checked} disabled={disabled} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Why a setting cannot be changed (the organisation set it), or nothing. */
export function Locked({ why }) {
  return why ? <span className="ab-locked">{why}</span> : null;
}

/** A problem with one field, shown right under it and announced. */
export function FieldError({ id, text }) {
  return text ? (
    <span id={id} className="ab-note ab-note-danger" role="alert">
      {text}
    </span>
  ) : null;
}

/** The result of the last action of a section, under its buttons. Errors are announced at once. */
export function Status({ status }) {
  if (!status) return null;
  return (
    <p className={`ab-note ab-note-${status.kind}`} role={status.kind === 'danger' ? 'alert' : 'status'} style={{ marginTop: 8 }}>
      {status.text}
    </p>
  );
}

/** aria-describedby from the ids that apply now; undefined when none does. */
export const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;

/** A key handler that runs fn on Enter (not while an input method is still composing a character). */
export const onEnter = (fn) => (e) => {
  if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
    e.preventDefault();
    fn();
  }
};

/**
 * A text box that keeps what is typed in the box itself and saves a moment later (and on leaving it, or on Enter). Saving on every
 * keystroke and drawing the box again from storage loses characters whenever typing is faster than the save, which corrupts an address.
 */
export function DraftInput({ value, onSave, delay = 300, ...rest }) {
  const [draft, setDraft] = useState(value);
  const pending = useRef(null); // the text waiting to be saved, or null
  const timer = useRef(0);
  const save = useRef(onSave);
  save.current = onSave;

  // A change from outside (another provider chosen, a policy applied) shows up unless the person is mid-edit.
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    save.current(text);
  }, []);
  useEffect(() => flush, [flush]); // leaving the page saves what was typed

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        pending.current = e.target.value;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, delay);
      }}
      onBlur={flush}
      onKeyDown={onEnter(flush)}
    />
  );
}

/**
 * A section's status line and the save its choices go through: the patch is saved to the settings, then the page reads them again
 * (reload, from Options). Two ways to save:
 *   save(patch)         -> true when saved; when the browser did not save, the status line says so and it gives false
 *   saveOrThrow(patch)  rejects when the browser did not save, for a caller that says so itself (the profile boxes go back to what is
 *                       saved and never show "Saved." for a change that was lost)
 * A save clears the status line, unless keepStatus: the AI provider section keeps the result of a test or a key move in view while a
 * field saves on leaving its box.
 */
export function useSaveSetting(reload, { keepStatus = false } = {}) {
  const [status, setStatus] = useState(null);
  async function saveOrThrow(patch) {
    await saveSettings(patch);
    if (!keepStatus) setStatus(null);
    reload();
  }
  async function save(patch) {
    try {
      await saveOrThrow(patch);
      return true;
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
      return false;
    }
  }
  return { status, setStatus, save, saveOrThrow };
}
