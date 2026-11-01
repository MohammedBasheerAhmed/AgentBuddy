import React, { useEffect, useState } from 'react';
import { STEP_WORD, firstRunSteps } from './firstRun.js';
import { TurnOnSite } from './SetupView.jsx';
import { useActiveInstances } from './usePage.js';
import { aiNeeds } from './aiReady.js';
import { read } from './ask.js';
import { KeyUnlock, openSettings } from './AiKeyNote.jsx';
import ProfilePicker from '../options/ProfilePicker.jsx';
import { saveSettings } from '../lib/storage.js';

// "What do you work on?" with the suggestion from the person's roles and work. The two counts behind it (do they manage a group, is
// catalog work assigned to them) are read once from the page when it is turned on; until then the roles alone suggest.
function ProfilesStep({ page, eff, primary }) {
  const enabled = page?.status === 'record' || page?.status === 'no-record';
  const [hints, setHints] = useState({});
  useEffect(() => {
    if (!enabled || !page.tabId) return undefined;
    let live = true;
    read(page.tabId, 'profileHints', {})
      .then((h) => live && setHints({ managesGroup: h?.managesGroup === true, hasCatalogWork: h?.hasCatalogWork === true }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, page?.tabId]);
  return <ProfilePicker eff={eff} roles={Array.isArray(page?.user?.roles) ? page.user.roles : []} hints={hints} onSave={saveSettings} primary={primary} idBase="ab-firstrun-prof" />;
}

// Set up AI, or skip it: Agent Buddy is useful without AI (every Insights half), so the panel does not insist.
function AiStep({ eff }) {
  const [error, setError] = useState('');
  const locked = aiNeeds(eff) === 'unlock';
  async function skip() {
    setError('');
    try {
      await saveSettings({ aiSkipped: true });
    } catch {
      setError('The browser did not save that. Try again.');
    }
  }
  return (
    <div className="ab-firstrun-act">
      {/* A key that is saved and locked is unlocked right here; there is nothing to set up. */}
      {locked && <KeyUnlock eff={eff} primary />}
      <div className="ab-row">
        {!locked && (
          <button type="button" className="ab-btn ab-btn-primary" onClick={() => openSettings('ai')}>
            Set up AI
          </button>
        )}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={skip}>
          Skip AI for now
        </button>
      </div>
      {error && (
        <p className="ab-note ab-note-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Getting started": the first run as one card. Each step says Done, Next or Later in words (colour only backs it up), and the step
 * that is next carries its own action: turn the site on, choose what you work on, set up AI or skip it. Nothing else on the screen
 * repeats them (SetupView.jsx leaves out what this card offers). Renders nothing once the setup is done.
 *
 * props: page, lastSeen, aiReady, eff, onChanged (look at the page again after the site was turned on)
 */
export default function FirstRun({ page, lastSeen = null, aiReady, eff = null, onChanged = () => {} }) {
  const activeInstances = useActiveInstances(eff);
  const { show, next, steps } = firstRunSteps({ page, lastSeen, aiReady, eff, activeInstances });
  if (!show) return null;
  const at = steps.findIndex((s) => s.state === 'next');

  const action = (id) => {
    if (id === 'site') return page?.status === 'not-enabled' && page.origin ? <TurnOnSite page={page} eff={eff} onChanged={onChanged} primary /> : null;
    if (id === 'profiles') return eff ? <ProfilesStep page={page} eff={eff} primary /> : null;
    if (id === 'ai') return eff ? <AiStep eff={eff} /> : null;
    return null;
  };

  return (
    <section className="ab-card ab-firstrun" aria-labelledby="ab-firstrun-title">
      <h2 className="ab-h" id="ab-firstrun-title">Getting started</h2>
      {at >= 0 && (
        <p className="ab-sub">
          Step {at + 1} of {steps.length}
        </p>
      )}
      <ol className="ab-firstrun-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`ab-firstrun-step ab-firstrun-${s.state}`} aria-current={s.state === 'next' ? 'step' : undefined}>
            <span className="ab-firstrun-num" aria-hidden="true">{i + 1}</span>
            <span className="ab-firstrun-body">
              <span className="ab-firstrun-label">
                {s.label} <span className={`ab-tag ab-firstrun-tag-${s.state}`}>{STEP_WORD[s.state]}</span>
              </span>
              {s.state === 'next' && s.hint && <span className="ab-hint">{s.hint}</span>}
              {s.id === next && action(s.id)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
