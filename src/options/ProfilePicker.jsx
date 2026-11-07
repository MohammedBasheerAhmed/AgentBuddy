import { useEffect, useState } from 'react';
import { confirmedProfiles, profileChoices } from '../sidepanel/firstRun.js';
import { profileById } from '../profiles/profiles.js';
import { t } from '../i18n/index.js';

/**
 * "What do you work on?": the work profiles as tick boxes, the main ones first and the add-ons below (TRACKER.md 2.5). Used by the
 * first-run card in the side panel (one Confirm button) and by Settings (each tick is saved at once). What can be chosen follows the
 * organisation's policy: only `allowedProfiles`, HR only where it approved HR work, nothing at all when it set `lockedProfiles`.
 *
 * props:
 *   eff         the effective settings (in the panel: withProfiles' result, which carries who is signed in)
 *   roles       the person's ServiceNow roles (from the page), for the suggestion
 *   hints       { managesGroup, hasCatalogWork } (the profileHints read), for the suggestion
 *   onSave(patch) -> Promise   saves { profiles, profilesConfirmed: true } and, in the panel, profilesFor (who confirmed them: eff.signedIn,
 *               src/profiles/profiles.js); rejects when it was not saved
 *   instant     true: a tick saves at once and the boxes then show what was saved; the last one cannot be unticked (Settings).
 *               false: one Confirm button (first run)
 *   primary     the Confirm button is the screen's one filled button
 *   idBase      a prefix for the boxes' ids (two pickers can be on one page)
 */
export default function ProfilePicker({ eff, roles = [], hints = {}, onSave, instant = false, primary = true, idBase = 'ab-prof' }) {
  const choices = profileChoices({ eff, roles, hints });
  const [ticked, setTicked] = useState(choices.ticked);
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'warn' | 'danger', text } after a save, or a change that was refused
  const suggestionKey = choices.ticked.join(',');
  // A suggestion that arrives later (the hints read answered) is shown, unless the person already changed a box.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setTicked(choices.ticked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the suggestion itself changes
  }, [suggestionKey]);

  if (choices.locked) {
    const names = (eff?.values?.profiles || []).map((id) => profileById(id)?.label).filter(Boolean);
    return <p className="ab-sub">{names.length ? t('Set by your organisation: {names}.', { names: names.join(t(', ')) }) : t('Set by your organisation.')}</p>;
  }

  // `before`: what the boxes showed before this change (instant mode), shown again when the browser does not save it.
  async function save(list, before) {
    setStatus(null);
    const patch = confirmedProfiles(list, choices, eff);
    try {
      await onSave(patch);
      if (!instant) return;
      // The boxes show what was saved. An add-on alone is saved with a main profile (confirmedProfiles): that box is ticked too, and
      // the note says why.
      setTicked(patch.profiles);
      const added = choices.main.find((p) => patch.profiles.includes(p.id) && !list.includes(p.id));
      setStatus({ kind: 'ok', text: added ? t('Saved. {name} was ticked too, because at least one choice under "I work on" is needed.', { name: added.label }) : t('Saved.') });
    } catch {
      if (instant) setTicked(before);
      setStatus({ kind: 'danger', text: t('The browser did not save that. Try again.') });
    }
  }

  function toggle(id, on) {
    const next = on ? [...new Set([...ticked, id])] : ticked.filter((x) => x !== id);
    setTouched(true);
    // Each tick is saved at once, and no profile at all cannot be saved: the last box stays ticked, and the note says so.
    if (instant && !next.length) {
      setStatus({ kind: 'warn', text: t('Keep at least one ticked.') });
      return;
    }
    setTicked(next);
    if (instant) save(next, ticked);
  }

  const box = (p) => (
    <label key={p.id} className="ab-check ab-profile" htmlFor={`${idBase}-${p.id}`}>
      <input id={`${idBase}-${p.id}`} type="checkbox" checked={ticked.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
      <span>
        <span className="ab-profile-name">{p.label}</span>
        <span className="ab-hint ab-profile-desc">{p.description}</span>
      </span>
    </label>
  );

  return (
    <div className="ab-profiles">
      <fieldset className="ab-fieldset">
        <legend className="ab-label">{t('I work on')}</legend>
        {choices.main.map(box)}
      </fieldset>
      {choices.addOns.length > 0 && (
        <fieldset className="ab-fieldset">
          <legend className="ab-label">{t('Also')}</legend>
          {choices.addOns.map(box)}
        </fieldset>
      )}
      {!instant && (
        <div className="ab-row">
          <button type="button" className={`ab-btn${primary ? ' ab-btn-primary' : ''}`} onClick={() => save(ticked)}>
            {t('Confirm')}
          </button>
        </div>
      )}
      {status && (
        <p className={`ab-note${status.kind === 'ok' ? '' : ` ab-note-${status.kind}`}`} role="status">
          {status.text}
        </p>
      )}
    </div>
  );
}
