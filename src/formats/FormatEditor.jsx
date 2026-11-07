import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FORMAT_LIMITS, STANDARD_CHOICE, isStandardChoice, normalizeFormat, policyEntry, settledFormat, specOf, systemFor } from './formats.js';
import { t, t as tr } from '../i18n/index.js';

// The editor for how one AI action writes its answer (TRACKER R11). Used on the Settings page (every action in a list) and in the side
// panel (under an action, "Change format"). It edits a draft; "Save format" hands the clean format to onSave, or STANDARD_CHOICE when the
// draft is the action's standard format (stored as a choice, so an organisation's standard format does not come back in its place);
// "Use the standard format" hands STANDARD_CHOICE too, and "Use my organisation's format" hands null (the person's own entry is removed).
// Nothing is sent anywhere from here.
//
// A sectioned action (summary, hand-off brief, discussion catch-up) shows the list of sections, the style and the length. Every action
// shows the extra instructions. The instructions that will be sent can be read in full under "Show the instructions this sends", so
// nobody has to guess what a choice does. An organisation's locked format is shown and can not be edited.
//
// props: feature (the registry action), saved (the person's own entry: a format, the standard choice, or null), source
//   ('default'|'mine'|'org'|'locked'|'standard', from resolveFormat), inherited (the organisation's format for this action or null; the
//   Settings page passes it whatever is in force, so it can be offered back), onSave(format|STANDARD_CHOICE|null) => Promise, idBase,
//   inPanel (under an action in the side panel: the screen's one filled button is its main step, so "Save format" is outlined there)

let rowCounter = 0;
const newRow = (s = {}) => ({ key: `r${++rowCounter}`, name: s.name || '', hint: s.hint || '' });

/** The draft a format starts from: its sections, style, length and extra instructions, all filled in from the action's defaults. */
function draftOf(id, format) {
  const s = settledFormat(id, format);
  const f = format || {};
  return s
    ? { rows: s.sections.map(newRow), style: s.style, words: String(s.words), extra: f.extra || '' }
    : { rows: [], style: 'lines', words: '', extra: f.extra || '' };
}

const sameFormat = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

export default function FormatEditor({ feature, saved = null, source = 'default', inherited = null, onSave, idBase, inPanel = false }) {
  const spec = specOf(feature.id);
  const sectioned = spec.kind === 'sections';
  const locked = source === 'locked';
  // What is in force now: the organisation's (locked, or the standard one the person has not replaced), the person's own, or nothing
  // (the action's standard format, also when the person chose it over the organisation's).
  const own = isStandardChoice(saved) ? null : saved;
  const inForce = locked || source === 'org' ? inherited : own;
  // The organisation publishes a standard format for this action that the person may replace (as far as this editor is told).
  const orgStandard = !locked && (source === 'org' || source === 'standard' || Boolean(inherited));
  const [draft, setDraft] = useState(() => draftOf(feature.id, inForce));
  const [status, setStatus] = useState(null); // { kind, text }
  const [busy, setBusy] = useState(false);
  const focusNext = useRef(null);
  const root = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name) => `${idBase}-${uid}-${name}`;

  // The format as it would be saved (null: the action's standard), and what is wrong with the draft.
  const candidate = useMemo(
    () => normalizeFormat({ sections: draft.rows, style: draft.style, words: draft.words === '' ? undefined : Number(draft.words), extra: draft.extra }, feature.id),
    [draft, feature.id]
  );
  const problems = useMemo(() => {
    const out = [];
    if (sectioned) {
      const names = draft.rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean);
      if (!names.length) out.push(t('Add at least one section, or use the standard format.'));
      if (new Set(names).size !== names.length) out.push(t('Two sections have the same name. Each name can be used once.'));
      const words = Number(draft.words);
      if (draft.words !== '' && !(Number.isFinite(words) && words >= FORMAT_LIMITS.wordsMin && words <= FORMAT_LIMITS.wordsMax)) {
        out.push(t('The length must be between {min} and {max} words.', { min: FORMAT_LIMITS.wordsMin, max: FORMAT_LIMITS.wordsMax }));
      }
    }
    return out;
  }, [draft, sectioned]);
  const dirty = !sameFormat(candidate, inForce);
  const text = useMemo(() => systemFor(feature, candidate || null), [feature, candidate]);

  // What is in force changed (a save here or in the other window, a new policy): the draft starts again from it, so it never shows one
  // format while another is used.
  const inForceKey = JSON.stringify(inForce || null);
  const shownKey = useRef(inForceKey);
  useEffect(() => {
    if (shownKey.current === inForceKey) return;
    shownKey.current = inForceKey;
    setDraft(draftOf(feature.id, inForce));
    // (inForce is read through its key: a new object with the same content is not a change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inForceKey, feature.id]);

  // Put the focus where the person is working after a row is added, moved or removed.
  useEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (!want || !root.current) return;
    const row = want.key ? root.current.querySelector(`[data-row="${want.key}"]`) : null;
    const target = (row && (want.pick ? row.querySelector(want.pick) : row.querySelector('input'))) || (want.fallback ? root.current.querySelector(want.fallback) : null);
    if (target && !target.disabled) target.focus();
    else if (want.fallback) root.current.querySelector(want.fallback)?.focus();
  });

  const set = (patch) => {
    setStatus(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setRow = (key, patch) => set({ rows: draft.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const add = () => {
    const row = newRow();
    focusNext.current = { key: row.key };
    set({ rows: [...draft.rows, row] });
  };
  const remove = (key) => {
    focusNext.current = { fallback: '[data-add]' };
    set({ rows: draft.rows.filter((r) => r.key !== key) });
  };
  const move = (key, by, which) => {
    const at = draft.rows.findIndex((r) => r.key === key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= draft.rows.length) return;
    const rows = [...draft.rows];
    [rows[at], rows[to]] = [rows[to], rows[at]];
    focusNext.current = { key, pick: `[data-move="${which}"]`, fallback: '[data-add]' };
    set({ rows });
  };
  const preset = (value) => {
    if (!value) return;
    const choice = value === 'standard' ? { sections: spec.defaults.sections, style: spec.defaults.style, words: spec.defaults.words } : spec.presets.find((p) => p.id === value);
    if (!choice) return;
    set({ rows: choice.sections.map(newRow), style: choice.style || spec.defaults.style, words: String(choice.words || spec.defaults.words) });
  };

  const run = async (format, done) => {
    setBusy(true);
    try {
      await onSave(format);
      setStatus({ kind: 'ok', text: done });
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    candidate
      ? run(candidate, t('Saved. The next answer uses this format.'))
      : run(STANDARD_CHOICE, orgStandard ? t("Saved. This action uses its standard format, not your organisation's.") : t('Saved. This action uses its standard format again.'));
  // The second button goes back to the organisation's format where there is one to go back to, else to the action's standard format.
  const reset = async () => {
    if (orgStandard) {
      setDraft(draftOf(feature.id, inherited));
      if (saved) await run(null, t("Back to your organisation's format."));
      else setStatus(null);
    } else {
      setDraft(draftOf(feature.id, null));
      if (own) await run(STANDARD_CHOICE, t('This action uses its standard format again.'));
      else setStatus(null);
    }
  };
  const resetOff = busy || (!(orgStandard ? saved : own) && !dirty);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(policyEntry(feature.id, candidate || {}), null, 2));
      setStatus({ kind: 'ok', text: t("Copied. Send it to your administrator: they can add it to your organisation's settings, so the whole team gets it.") });
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not copy that. Select the text under "Show the instructions this sends" instead.') });
    }
  };

  const noteFor = { 'reads-back': t('The panel reads this answer back, so its headings stay as they are. Extra instructions can still change the tone and the length.'), customer: t("The customer reads this text. Agent Buddy's rules about internal notes, names and gaps to fill in stay on, whatever you add.") }[spec.note] || '';

  return (
    <div className={`ab-fmt${inPanel ? ' ab-fmt-inpanel' : ''}`} ref={root}>
      {locked && <p className="ab-note ab-note-warn">{t('Set by your organisation. You can read this format, but not change it.')}</p>}
      {source === 'org' && <p className="ab-note">{t("This is your organisation's format. Save your own to use it instead.")}</p>}
      {source === 'standard' && <p className="ab-note">{t("You chose the standard format over your organisation's.")}</p>}
      {noteFor && <p className="ab-hint">{noteFor}</p>}

      {sectioned && (
        <>
          <div className="ab-field">
            <label className="ab-label" htmlFor={id('preset')}>{t('Start from a layout')}</label>
            <select id={id('preset')} className="ab-select" value="" disabled={locked} onChange={(e) => preset(e.target.value)}>
              <option value="">{t('Choose a layout…')}</option>
              <option value="standard">{t('The standard layout')}</option>
              {spec.presets.map((p) => (
                <option key={p.id} value={p.id}>{tr(p.name)}</option>
              ))}
            </select>
          </div>

          <fieldset className="ab-fieldset">
            <legend className="ab-label">{t('Sections, in the order they are written')}</legend>
            <ol className="ab-fmt-rows">
              {draft.rows.map((r, i) => (
                <li key={r.key} className="ab-fmt-row" data-row={r.key}>
                  <input className="ab-input" type="text" dir="auto" maxLength={FORMAT_LIMITS.name} value={r.name} disabled={locked} aria-label={t('Section {n}: heading', { n: i + 1 })} placeholder={t('Heading, for example Key actions performed')} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                  <input className="ab-input" type="text" dir="auto" maxLength={FORMAT_LIMITS.hint} value={r.hint} disabled={locked} aria-label={t('Section {n}: what goes in it (optional)', { n: i + 1 })} placeholder={t('What goes in it (optional)')} onChange={(e) => setRow(r.key, { hint: e.target.value })} />
                  {!locked && (
                    <span className="ab-fmt-btns">
                      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fmt-btn" data-move="up" disabled={i === 0} aria-label={t('Move section {n} up', { n: i + 1 })} onClick={() => move(r.key, -1, 'up')}>↑</button>
                      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fmt-btn" data-move="down" disabled={i === draft.rows.length - 1} aria-label={t('Move section {n} down', { n: i + 1 })} onClick={() => move(r.key, 1, 'down')}>↓</button>
                      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fmt-btn" aria-label={t('Remove section {n}', { n: i + 1 })} onClick={() => remove(r.key)}>×</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {!locked && (
              <button type="button" className="ab-btn ab-btn-sm" data-add disabled={draft.rows.length >= FORMAT_LIMITS.sections} onClick={add}>
                {t('Add a section')}
              </button>
            )}
          </fieldset>

          <div className="ab-fmt-pair">
            <div className="ab-field">
              <label className="ab-label" htmlFor={id('style')}>{t('Each section is')}</label>
              <select id={id('style')} className="ab-select" value={draft.style} disabled={locked} onChange={(e) => set({ style: e.target.value })}>
                <option value="lines">{t('A line or two of text')}</option>
                <option value="bullets">{t('Short bullet points')}</option>
              </select>
            </div>
            <div className="ab-field">
              <label className="ab-label" htmlFor={id('words')}>{t('At most this many words')}</label>
              <input id={id('words')} className="ab-input ab-fmt-words" type="number" inputMode="numeric" min={FORMAT_LIMITS.wordsMin} max={FORMAT_LIMITS.wordsMax} value={draft.words} disabled={locked} aria-describedby={id('words-hint')} onChange={(e) => set({ words: e.target.value })} />
              <span className="ab-hint" id={id('words-hint')}>{t('{min} to {max}. The standard is {n}.', { min: FORMAT_LIMITS.wordsMin, max: FORMAT_LIMITS.wordsMax, n: spec.defaults.words })}</span>
            </div>
          </div>
        </>
      )}

      <div className="ab-field">
        <label className="ab-label" htmlFor={id('extra')}>{t('Extra instructions (optional)')}</label>
        <textarea id={id('extra')} className="ab-textarea ab-fmt-extra" dir="auto" rows={3} maxLength={FORMAT_LIMITS.extra} value={draft.extra} disabled={locked} aria-describedby={id('extra-hint')} onChange={(e) => set({ extra: e.target.value })} />
        <span className="ab-hint" id={id('extra-hint')}>
          {t('Tone, length or wording, for example "Use plain words" or "Put the SLA date last". They never remove a rule: facts only, no guessing, no internal names for a customer.')}{' '}
          {t('{n} of {max} characters', { n: draft.extra.length, max: FORMAT_LIMITS.extra })}
        </span>
      </div>

      <details className="ab-more">
        <summary>{t('Show the instructions this sends')}</summary>
        <pre className="ab-fmt-preview ab-mono" tabIndex={0} aria-label={t('The instructions this format sends')}>{text}</pre>
        <p className="ab-hint">{t('The ticket itself is added after these, masked, and you still see the whole request before it is sent.')}</p>
      </details>

      {problems.map((p) => (
        <p key={p} className="ab-note ab-note-warn" role="note">{p}</p>
      ))}

      {!locked && (
        <div className="ab-row ab-fmt-actions">
          <button type="button" className={`ab-btn ab-fmt-save${inPanel ? '' : ' ab-btn-primary'}`} disabled={busy || !dirty || problems.length > 0} onClick={save}>{t('Save format')}</button>
          <button type="button" className="ab-btn" disabled={resetOff} onClick={reset}>{orgStandard ? t("Use my organisation's format") : t('Use the standard format')}</button>
          <button type="button" className="ab-btn ab-btn-quiet" disabled={!candidate || problems.length > 0} onClick={copy}>{t('Copy for your administrator')}</button>
        </div>
      )}
      <p className={`ab-note${status ? (status.kind === 'ok' ? ' ab-note-ok' : ' ab-note-danger') : ''}`} role="status" hidden={!status}>{status ? status.text : ''}</p>
    </div>
  );
}
