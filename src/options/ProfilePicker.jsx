import { useEffect, useState } from 'react';
import { confirmedProfiles, profileChoices } from '../sidepanel/firstRun.js';
import { profileById } from '../profiles/profiles.js';

/**
 * "What do you work on?": the work profiles as tick boxes, the main ones first and the add-ons below (TRACKER.md 2.5). Used by the
 * first-run card in the side panel (one Confirm button) and by Settings (each tick is saved at once). What can be chosen follows the
 * organisation's policy: only `allowedProfiles`, HR only where it approved HR work, nothing at all when it set `lockedProfiles`.
 *
 * props:
 *   eff         the effective settings
 *   roles       the person's ServiceNow roles (from the page), for the suggestion
 *   hints       { managesGroup, hasCatalogWork } (the profileHints read), for the suggestion
 *   onSave(patch) -> Promise   saves { profiles, profilesConfirmed: true }
 *   instant     true: a tick saves at once (Settings); false: one Confirm button (first run)
 *   primary     the Confirm button is the screen's one filled button
 *   idBase      a prefix for the boxes' ids (two pickers can be on one page)
 */
export default function ProfilePicker({ eff, roles = [], hints = {}, onSave, instant = false, primary = true, idBase = 'ab-prof' }) {
  const choices = profileChoices({ eff, roles, hints });
  const [ticked, setTicked] = useState(choices.ticked);
  const [status, setStatus] = useState('');
  const suggestionKey = choices.ticked.join(',');
  // A suggestion that arrives later (the hints read answered) is shown, unless the person already changed a box.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setTicked(choices.ticked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the suggestion itself changes
  }, [suggestionKey]);

  if (choices.locked) {
    const names = (eff?.values?.profiles || []).map((id) => profileById(id)?.label).filter(Boolean);
    return <p className="ab-sub">Set by your organisation{names.length ? `: ${names.join(', ')}` : ''}.</p>;
  }

  async function save(list) {
    setStatus('');
    try {
      await onSave(confirmedProfiles(list, choices));
      if (instant) setStatus('Saved.');
    } catch {
      setStatus('The browser did not save that. Try again.');
    }
  }

  function toggle(id, on) {
    const next = on ? [...new Set([...ticked, id])] : ticked.filter((x) => x !== id);
    setTouched(true);
    setTicked(next);
    if (instant && next.length) save(next);
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
        <legend className="ab-label">I work on</legend>
        {choices.main.map(box)}
      </fieldset>
      {choices.addOns.length > 0 && (
        <fieldset className="ab-fieldset">
          <legend className="ab-label">Also</legend>
          {choices.addOns.map(box)}
        </fieldset>
      )}
      {!instant && (
        <div className="ab-row">
          <button type="button" className={`ab-btn${primary ? ' ab-btn-primary' : ''}`} onClick={() => save(ticked)}>
            Confirm
          </button>
        </div>
      )}
      {status && (
        <p className={`ab-note${status === 'Saved.' ? '' : ' ab-note-danger'}`} role="status">
          {status}
        </p>
      )}
    </div>
  );
}
