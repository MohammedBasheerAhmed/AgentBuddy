// Settings, Basics: what you work on (the work profiles, ../ProfilePicker.jsx), "Show everything" and "Skip AI for now".
import ProfilePicker from '../ProfilePicker.jsx';
import { SectionHead, Status, Switch, useSaveSetting } from '../fields.jsx';
import { t } from '../../i18n/index.js';

/**
 * What you work on (work profiles), "Show everything" and "Skip AI for now". Profiles decide which cards and actions the panel shows
 * first; the organisation can limit or lock them (allowedProfiles, lockedProfiles) and approves HR work.
 */
export function ProfilesSection({ eff, reload }) {
  const v = eff.values;
  // The profile boxes get saveOrThrow: it rejects when the browser did not save, and the boxes say so themselves (and go back to what
  // is saved), so they never show "Saved." for a change that was lost. The two switches below use save, which says it on this section.
  const { status, save: change, saveOrThrow } = useSaveSetting(reload);
  const aiOffByOrg = eff.policy?.aiEnabled === false;
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-profiles">
      <SectionHead id="h-profiles" title={t('What you work on')}>{t('Agent Buddy shows the tools for this work first. Tick everything that applies.')}</SectionHead>
      <ProfilePicker eff={eff} onSave={saveOrThrow} instant idBase="profile" />
      <div className="ab-set-switches">
        <Switch id="show-everything" checked={v.showEverything === true} onChange={(on) => change({ showEverything: on })}>
          {t('Show everything: every card and action, whatever you work on.')}
        </Switch>
        {!aiOffByOrg && (
          <Switch id="ai-skipped" checked={v.aiSkipped === true} onChange={(on) => change({ aiSkipped: on })}>
            {t('Skip AI for now: use Agent Buddy without AI. Everything under Insights still works.')}
          </Switch>
        )}
      </div>
      <Status status={status} />
    </section>
  );
}
