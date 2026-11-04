// Settings, Basics: what you work on (the work profiles, ../ProfilePicker.jsx), "Show everything" and "Skip AI for now".
import ProfilePicker from '../ProfilePicker.jsx';
import { Status, useSaveSetting } from '../fields.jsx';
import { t } from '../../i18n/index.js';

/**
 * What you work on (work profiles), "Show everything" and "Skip AI for now". Profiles decide which cards and actions the panel shows
 * first; the organisation can limit or lock them (allowedProfiles, lockedProfiles) and approves HR work.
 */
export function ProfilesSection({ eff, reload }) {
  const v = eff.values;
  // The profile boxes get saveOrThrow: it rejects when the browser did not save, and the boxes say so themselves (and go back to what
  // is saved), so they never show "Saved." for a change that was lost. The two tick boxes below use save, which says it on this section.
  const { status, save: change, saveOrThrow } = useSaveSetting(reload);
  const aiOffByOrg = eff.policy?.aiEnabled === false;
  return (
    <section className="ab-section" aria-labelledby="h-profiles">
      <h2 className="ab-h" id="h-profiles">{t('What you work on')}</h2>
      <p className="ab-sub">{t('Agent Buddy shows the tools for this work first. Tick everything that applies.')}</p>
      <ProfilePicker eff={eff} onSave={saveOrThrow} instant idBase="profile" />
      <label className="ab-check" htmlFor="show-everything">
        <input id="show-everything" type="checkbox" checked={v.showEverything === true} onChange={(e) => change({ showEverything: e.target.checked })} />
        <span>{t('Show everything: every card and action, whatever you work on.')}</span>
      </label>
      {!aiOffByOrg && (
        <label className="ab-check" htmlFor="ai-skipped">
          <input id="ai-skipped" type="checkbox" checked={v.aiSkipped === true} onChange={(e) => change({ aiSkipped: e.target.checked })} />
          <span>{t('Skip AI for now: use Agent Buddy without AI. Everything under Insights still works.')}</span>
        </label>
      )}
      <Status status={status} />
    </section>
  );
}
