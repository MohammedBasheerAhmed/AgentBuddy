// The Settings page (options.html): reads the settings, the policy and the saved key's state (reload), reads them again when another
// page changes them, and lays the sections out in two pages, Basics and AI Assist. Each section is a file of its own:
//   fields.jsx    the shared pieces (status line, field error, text box that saves a moment later) and useSaveSetting()
//   basics/       the choices on Basics: appearance, language, instances, profiles, follow-ups, shortcuts, quick bar, privacy, policy
//   data/         what Agent Buddy keeps: the activity log, stored data and "Clear everything", diagnostics for support
//   provider/     AI Assist: the provider, its key and model, the connection check, the usage and limits
//   FormatsSection.jsx, ProfilePicker.jsx, policyNotes.js (pure notes about the policy), diagnostics.js (pure diagnostics text)
// The sections are exported from here too, under the names the tests have always imported.
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEffective, loadSettings, keyStore } from '../lib/storage.js';
import { settingsChangeMatters } from '../lib/settingsChanges.js';
import { FormatsSection } from './FormatsSection.jsx';
import { ProviderSection } from './provider/ProviderSection.jsx';
import { UsageSection } from './provider/UsageSection.jsx';
import { AppearanceSection } from './basics/AppearanceSection.jsx';
import { LanguageSection } from './basics/LanguageSection.jsx';
import { InstancesSection } from './basics/InstancesSection.jsx';
import { ProfilesSection } from './basics/ProfilesSection.jsx';
import { FollowUpSection } from './basics/FollowUpSection.jsx';
import { ShortcutsSection } from './basics/ShortcutsSection.jsx';
import { QuickBarSection } from './basics/QuickBarSection.jsx';
import { PrivacySection } from './basics/PrivacySection.jsx';
import { PolicySection } from './basics/PolicySection.jsx';
import { AuditSection } from './data/AuditSection.jsx';
import { StoredDataSection } from './data/StoredDataSection.jsx';
import { DiagnosticsSection } from './data/DiagnosticsSection.jsx';
import Tabs from '../sidepanel/Tabs.jsx';
import { panelId, tabId } from '../sidepanel/tabKeys.js';
import { t } from '../i18n/index.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { useTheme } from '../ui/useTheme.js';

export { ProviderSection, UsageSection, AppearanceSection, LanguageSection, InstancesSection, ProfilesSection, FollowUpSection, ShortcutsSection, PrivacySection, PolicySection, DiagnosticsSection };
export { SITE_REFUSED_TEXT } from './basics/InstancesSection.jsx';
export { FOLLOW_UP_DAY_CHOICES as FOLLOW_UP_CHOICES } from '../mywork/followups.js';

/** Which page of Settings the address asks for: '#ai' is AI Assist, anything else Basics. */
export const settingsPageFromHash = (hash) => (String(hash || '').replace(/^#/, '').toLowerCase() === 'ai' ? 'ai' : 'basics');

// (made when the page is drawn, so the labels follow the language)
const pages = () => [
  { id: 'basics', label: t('Basics') },
  { id: 'ai', label: t('AI Assist') },
];

/** The AI Assist page: the provider, its key, the model and the limits; when the organisation switched AI off, only that. */
export function AiAssistPage({ eff, reload, epoch }) {
  if (eff.policy?.aiEnabled === false) {
    return (
      <section className="ab-section" aria-labelledby="h-ai-off">
        <h2 className="ab-h" id="h-ai-off">{t('AI is switched off')}</h2>
        <p className="ab-sub">
          {t('Your organisation has switched off AI in Agent Buddy. Everything under Insights still works: facts, lists, checks and templates, read from ServiceNow with your own session. Nothing is sent anywhere.')}
        </p>
      </section>
    );
  }
  return (
    <>
      <p className="ab-sub ab-page-intro">
        {t('AI Assist writes summaries, replies and notes with the AI provider you choose. Personal data is masked first, and you can see what is sent.')}
        {eff.values.aiSkipped ? ` ${t('You chose to skip AI for now: untick it under Basics, "What you work on", to use it.')}` : ''}
      </p>
      <ProviderSection eff={eff} reload={reload} />
      <FormatsSection eff={eff} reload={reload} />
      <UsageSection key={`usage-${epoch}`} eff={eff} />
    </>
  );
}

export default function Options() {
  const [eff, setEff] = useState(null);
  const lang = useLanguage(eff?.values?.language); // before anything below draws a text
  useTheme(eff?.values?.theme);
  useEffect(() => {
    document.title = t('Agent Buddy settings'); // the tab's name, in the language of the page
  }, [lang]);
  const [failed, setFailed] = useState('');
  const [epoch, setEpoch] = useState(0); // bumped after "clear everything" so every section shows what is left
  // Reads overlap (a save, its storage event and a key move each ask for one) and can finish in any order: only the newest is shown.
  const newest = useRef(0);
  const reload = useCallback(async () => {
    newest.current += 1;
    const mine = newest.current;
    try {
      const [e, raw] = await Promise.all([loadEffective(), loadSettings()]);
      const store = keyStore();
      const provider = e.values.provider;
      const provided = e.values.providedApiKey;
      const apiKey = provided || (await store.load(provider));
      const keyLocked = !apiKey && (await store.isLocked(provider));
      // Where the saved key is kept, read with the key itself: the line under the key box follows every save, move, unlock and
      // removal, here or in another page. (A key the organisation supplies has no key box.)
      const keyMode = provided ? 'none' : await store.mode(provider);
      const needsEncryption = !provided && (await store.needsEncryption(provider));
      if (mine !== newest.current) return; // a newer read started meanwhile: what it finds is the one to show
      setFailed('');
      // floors: the policy's minimum for a setting the person may still raise; savedProvider: the person's own choice, before policy.
      setEff({ values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey, keyLocked, keyMode, needsEncryption, savedProvider: String(raw?.provider || '') });
    } catch (err) {
      if (mine !== newest.current) return;
      setFailed(err?.message || t('The settings could not be read.'));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Another page (the side panel, a second settings tab) changed the settings, the policy or the key: show it. Only those
  // (src/lib/settingsChanges.js): the logs written on every AI call change nothing here.
  useEffect(() => {
    const onChange = (changes, areaName) => {
      if (settingsChangeMatters(changes, areaName)) reload();
    };
    try {
      chrome.storage.onChanged.addListener(onChange);
      return () => chrome.storage.onChanged.removeListener(onChange);
    } catch {
      return undefined;
    }
  }, [reload]);

  if (failed) return <div className="ab-page"><p className="ab-note ab-note-danger" role="alert">{t('{failed} Close this tab and open Settings again.', { failed })}</p></div>;
  if (!eff) return <div className="ab-page"><p className="ab-sub">{t('Loading…')}</p></div>;
  return (
    <main className="ab-page" key={lang}>
      <h1 className="ab-h ab-page-title">{t('Agent Buddy settings')}</h1>
      <SettingsPages eff={eff} reload={reload} epoch={epoch} onCleared={() => { setEpoch((n) => n + 1); reload(); }} />
    </main>
  );
}

/**
 * Settings in two pages (TRACKER.md F2): Basics (where it works, what you work on, privacy in plain words, what it keeps) and AI Assist
 * (the provider, key, model and limits). The page is part of the address (options.html#ai), so the side panel can open the AI page
 * straight away and a reload stays where it was.
 */
export function SettingsPages({ eff, reload, epoch = 0, onCleared = () => {}, initial }) {
  const [page, setPage] = useState(() => initial || settingsPageFromHash(typeof location !== 'undefined' ? location.hash : ''));
  useEffect(() => {
    const onHash = () => setPage(settingsPageFromHash(location.hash));
    try {
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    } catch {
      return undefined;
    }
  }, []);
  const choose = (id) => {
    setPage(id);
    try {
      history.replaceState(null, '', id === 'ai' ? '#ai' : `${location.pathname}${location.search}`);
    } catch {
      /* the address stays as it was; the page still changes */
    }
  };
  const managedNote = Object.keys(eff.locked).some((k) => !eff.floors?.[k]);
  return (
    <>
      <Tabs idBase="ab-settings" label={t('Settings pages')} className="ab-row ab-settings-tabs" tabs={pages()} value={page} onChange={choose} />
      {managedNote && <p className="ab-note ab-note-warn">{t('Some settings are managed by your organisation and cannot be changed.')}</p>}
      <div id={panelId('ab-settings', 'basics')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'basics')} hidden={page !== 'basics'}>
        <p className="ab-sub ab-page-intro">{t('Where Agent Buddy works, what you work on, how personal data is protected, and what it keeps on this computer.')}</p>
        <AppearanceSection eff={eff} reload={reload} />
        <LanguageSection eff={eff} reload={reload} />
        <InstancesSection eff={eff} reload={reload} />
        <ProfilesSection eff={eff} reload={reload} />
        <FollowUpSection eff={eff} reload={reload} />
        <ShortcutsSection />
        <QuickBarSection eff={eff} reload={reload} />
        {Object.keys(eff.floors || {}).length > 0 && <p className="ab-note">{t('Your organisation sets a minimum for some privacy settings. You can always choose a stricter one.')}</p>}
        <PrivacySection eff={eff} reload={reload} />
        <PolicySection eff={eff} />
        <AuditSection key={`audit-${epoch}`} eff={eff} />
        {/* Not keyed by epoch like its neighbours: it reads what is left itself after clearing, and a new one would lose the outcome. */}
        <StoredDataSection eff={eff} onCleared={onCleared} />
        <DiagnosticsSection eff={eff} />
        <section className="ab-section" aria-labelledby="h-leaves">
          <h2 className="ab-h" id="h-leaves">{t('What leaves your computer')}</h2>
          <p className="ab-sub">
            {t('Only two things: reads from your own ServiceNow instance, and the masked text sent to the AI address you chose. Agent Buddy has no server, no analytics and no tracking. It never saves or changes a ServiceNow record by itself: when you choose Insert it fills the field on the open form and you press Save.')}
          </p>
        </section>
      </div>
      <div id={panelId('ab-settings', 'ai')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'ai')} hidden={page !== 'ai'}>
        <AiAssistPage eff={eff} reload={reload} epoch={epoch} />
      </div>
    </>
  );
}
