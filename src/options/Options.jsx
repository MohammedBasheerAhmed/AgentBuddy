// The Settings page (options.html): reads the settings, the policy and the saved key's state (reload), reads them again when another
// page changes them, and lays the sections out in two pages, Basics and AI Assist, with a menu beside them: the two pages, and the
// sections of the page on show (it stacks above the sections on a narrow window). Each section is a file of its own:
//   fields.jsx    the shared pieces (section title, switch, status line, field error, text box that saves a moment later) and
//                 useSaveSetting()
//   basics/       the choices on Basics: appearance, language, instances, profiles, follow-ups, shortcuts, side rail, privacy, policy
//   data/         what Agent Buddy keeps: the activity log, stored data and "Clear everything", diagnostics for support
//   provider/     AI Assist: the provider, its key and model, the connection check, the usage and limits
//   FormatsSection.jsx, ProfilePicker.jsx, policyNotes.js (pure notes about the policy), diagnostics.js (pure diagnostics text),
//   railOptions.js (pure: the AI actions the small bar on the ServiceNow page can hold per kind of record, and the changes Side rail
//   saves for it)
// The sections are exported from here too, under the names the tests have always imported. The page's styles are in
// src/ui/areas/options.css.
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEffective, loadSettings, keyStore } from '../lib/storage.js';
import { settingsChangeMatters } from '../lib/settingsChanges.js';
import { FormatsSection, formatItems } from './FormatsSection.jsx';
import { ProviderSection } from './provider/ProviderSection.jsx';
import { UsageSection } from './provider/UsageSection.jsx';
import { AppearanceSection } from './basics/AppearanceSection.jsx';
import { LanguageSection } from './basics/LanguageSection.jsx';
import { InstancesSection } from './basics/InstancesSection.jsx';
import { ProfilesSection } from './basics/ProfilesSection.jsx';
import { FollowUpSection } from './basics/FollowUpSection.jsx';
import { ShortcutsSection } from './basics/ShortcutsSection.jsx';
import { RailSection } from './basics/RailSection.jsx';
import { PrivacySection } from './basics/PrivacySection.jsx';
import { PolicySection, policySectionShown } from './basics/PolicySection.jsx';
import { AuditSection } from './data/AuditSection.jsx';
import { StoredDataSection } from './data/StoredDataSection.jsx';
import { DiagnosticsSection } from './data/DiagnosticsSection.jsx';
import { SectionHead } from './fields.jsx';
import { nextTabIndex, panelId, tabId } from '../sidepanel/tabKeys.js';
import { BrandMark, Icon } from '../sidepanel/ui/icons.jsx';
import { t } from '../i18n/index.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { useTheme } from '../ui/useTheme.js';

export { ProviderSection, UsageSection, AppearanceSection, LanguageSection, InstancesSection, ProfilesSection, FollowUpSection, ShortcutsSection, RailSection, PrivacySection, PolicySection, DiagnosticsSection };
export { SITE_REFUSED_TEXT } from './basics/InstancesSection.jsx';
export { FOLLOW_UP_DAY_CHOICES as FOLLOW_UP_CHOICES } from '../mywork/followups.js';

// The ids of the section titles on AI Assist: an address that names one of them (options.html#h-usage, a menu link opened in a new
// tab) opens that page.
const AI_SECTION_IDS = ['h-ai-off', 'h-provider', 'h-key', 'h-formats', 'h-usage'];

/** Which page of Settings the address asks for: '#ai', or a section of AI Assist, is AI Assist; anything else Basics. */
export const settingsPageFromHash = (hash) => {
  const id = String(hash || '').replace(/^#/, '').toLowerCase();
  return id === 'ai' || AI_SECTION_IDS.includes(id) ? 'ai' : 'basics';
};

// (made when the page is drawn, so the labels follow the language)
const pages = () => [
  { id: 'basics', label: t('Basics') },
  { id: 'ai', label: t('AI Assist') },
];

/**
 * The sections of a page as the menu beside it lists them, in the order they are drawn: the id of each section's title, its name and
 * an icon (src/sidepanel/ui/icons.jsx). Only the sections that are on the page: the policy's only when it switches something off, the
 * formats only when an action can be laid out, and on AI Assist only the note when the organisation switched AI off.
 */
export function settingsMenu(page, eff) {
  if (page === 'ai') {
    if (eff.policy?.aiEnabled === false) return [{ id: 'h-ai-off', label: t('AI is switched off'), icon: 'spark' }];
    return [
      { id: 'h-provider', label: t('AI provider'), icon: 'spark' },
      { id: 'h-key', label: t('Key and connection'), icon: 'link' },
      formatItems(eff).length > 0 && { id: 'h-formats', label: t('How AI answers are written'), icon: 'pen' },
      { id: 'h-usage', label: t('Usage and limits'), icon: 'clock' },
    ].filter(Boolean);
  }
  return [
    { id: 'h-appearance', label: t('Appearance'), icon: 'sun' },
    { id: 'h-language', label: t('Language'), icon: 'globe' },
    { id: 'h-instances', label: t('ServiceNow sites'), icon: 'monitor' },
    { id: 'h-profiles', label: t('What you work on'), icon: 'ticket' },
    { id: 'h-followup', label: t('My work'), icon: 'inbox' },
    { id: 'h-shortcuts', label: t('Keyboard shortcuts'), icon: 'keyboard' },
    { id: 'h-rail', label: t('Side rail'), icon: 'command' },
    { id: 'h-privacy', label: t('Privacy'), icon: 'shield' },
    policySectionShown(eff) && { id: 'h-policy', label: t("Your organisation's policy"), icon: 'flag' },
    { id: 'h-audit', label: t('Activity log'), icon: 'clipboard' },
    { id: 'h-stored', label: t('Stored data'), icon: 'file' },
    { id: 'h-diagnostics', label: t('Help from support'), icon: 'help' },
    { id: 'h-leaves', label: t('What leaves your computer'), icon: 'navigation' },
  ].filter(Boolean);
}

/** The AI Assist page: the provider, its key, the model and the limits; when the organisation switched AI off, only that. */
export function AiAssistPage({ eff, reload, epoch }) {
  if (eff.policy?.aiEnabled === false) {
    return (
      <section className="ab-section ab-set-section" aria-labelledby="h-ai-off">
        <SectionHead id="h-ai-off" title={t('AI is switched off')}>
          {t('Your organisation has switched off AI in Agent Buddy. Everything under Insights still works: facts, lists, checks and templates, read from ServiceNow as you. Nothing is sent anywhere.')}
        </SectionHead>
      </section>
    );
  }
  return (
    <>
      <p className="ab-sub ab-page-intro">
        {t('AI Assist writes summaries, replies and notes with the AI service you choose. Personal data is masked first, and you can see what is sent.')}
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

  if (failed) return <div className="ab-page ab-set"><p className="ab-note ab-note-danger" role="alert">{t('{failed} Close this tab and open Settings again.', { failed })}</p></div>;
  if (!eff) return <div className="ab-page ab-set"><p className="ab-sub">{t('Loading…')}</p></div>;
  return (
    <main className="ab-page ab-set" key={lang}>
      <header className="ab-set-top">
        <BrandMark size={28} />
        <h1 className="ab-h ab-page-title">{t('Agent Buddy settings')}</h1>
      </header>
      <SettingsPages eff={eff} reload={reload} epoch={epoch} onCleared={() => { setEpoch((n) => n + 1); reload(); }} />
    </main>
  );
}

/**
 * Bring a section into view and give its title the focus, so reading and the keyboard go on from there. A section not drawn yet (an
 * address that names one, read while the page is still being put together) is waited for, a second at most.
 */
function showSection(id, frames = 60) {
  try {
    const title = document.getElementById(id);
    if (!title) {
      if (frames > 0) requestAnimationFrame(() => showSection(id, frames - 1));
      return;
    }
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    title.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    title.focus({ preventScroll: true });
  } catch {
    /* an old browser without these options: the menu link still points at the section */
  }
}

/**
 * Which section of the page on show is being read, for the menu to mark: the last one whose title has reached the top of the window
 * (at the very end of the page, the last one). Measured on scroll, once a frame; ids is the menu's list, in the order drawn.
 * pin(id) marks a section chosen in the menu: it stays marked while the page scrolls to it and while it is in view, even when it is
 * too near the end of the page for its title to reach the top.
 *   -> [the id marked, pin]
 */
function useSectionInView(ids) {
  const [current, setCurrent] = useState(ids[0] || '');
  const pinned = useRef(null); // { id, seen }: seen once the chosen section came into view
  const key = ids.join(' ');
  useEffect(() => {
    const list = key.split(' ').filter(Boolean);
    pinned.current = list.includes(pinned.current?.id) ? pinned.current : null; // another page is on show: its choice is gone
    let frame = 0;
    const measure = () => {
      frame = 0;
      const pin = pinned.current;
      const chosen = pin && document.getElementById(pin.id);
      if (chosen && chosen.getClientRects().length > 0) {
        const r = chosen.getBoundingClientRect();
        const inView = r.bottom > 0 && r.top < window.innerHeight;
        if (inView || !pin.seen) {
          pin.seen = pin.seen || inView;
          return;
        }
      }
      pinned.current = null;
      const shown = list.map((id) => document.getElementById(id)).filter((el) => el && el.getClientRects().length > 0);
      if (!shown.length) return;
      let at = shown[0].id;
      for (const el of shown) if (el.getBoundingClientRect().top <= 96) at = el.id;
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) at = shown[shown.length - 1].id;
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    try {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      onScroll();
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      };
    } catch {
      return undefined; // no window to listen to (a test): the first section stays marked
    }
  }, [key]);
  const pin = useCallback((id) => {
    pinned.current = { id, seen: false };
    setCurrent(id);
  }, []);
  // The section marked is one of this page's (after a switch of page, its first until the page is scrolled).
  return [ids.includes(current) ? current : ids[0] || '', pin];
}

/**
 * The two pages as a tab list (one tab stop; Left/Right, Home and End move between them, src/sidepanel/tabKeys.js). Each tab names the
 * panel it controls, and each panel its tab.
 */
function PageTabs({ value, onChange }) {
  const buttons = useRef({});
  const list = pages();
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = nextTabIndex(e.key, list.findIndex((p) => p.id === value), list.length);
    if (next < 0) return;
    e.preventDefault();
    onChange(list[next].id);
    buttons.current[list[next].id]?.focus();
  };
  return (
    <div className="ab-set-pages" role="tablist" aria-label={t('Settings pages')} onKeyDown={onKeyDown}>
      {list.map((p) => (
        <button
          key={p.id}
          id={tabId('ab-settings', p.id)}
          ref={(el) => {
            buttons.current[p.id] = el;
          }}
          type="button"
          role="tab"
          aria-selected={value === p.id}
          aria-controls={panelId('ab-settings', p.id)}
          tabIndex={value === p.id ? 0 : -1}
          className="ab-set-page"
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings in two pages (TRACKER.md F2): Basics (where it works, what you work on, privacy in plain words, what it keeps) and AI Assist
 * (the provider, key, model and limits). The page is part of the address (options.html#ai), so the side panel can open the AI page
 * straight away and a reload stays where it was. Beside the pages, a menu of the sections of the page on show; on a narrow window it
 * stacks above them, folded under "Go to a section".
 */
export function SettingsPages({ eff, reload, epoch = 0, onCleared = () => {}, initial }) {
  const [page, setPage] = useState(() => initial || settingsPageFromHash(typeof location !== 'undefined' ? location.hash : ''));
  const [menuOpen, setMenuOpen] = useState(false); // the menu on a narrow window (on a wide one it is always shown)
  const menu = settingsMenu(page, eff);
  const [current, pin] = useSectionInView(menu.map((m) => m.id));
  useEffect(() => {
    // An address that names a section (a menu link opened in a new tab, or typed) shows its page, marks the section in the menu and
    // brings it into view.
    const toSection = () => {
      const id = location.hash.replace(/^#/, '').toLowerCase();
      if (!/^h-[a-z-]+$/.test(id)) return;
      pin(id);
      requestAnimationFrame(() => showSection(id));
    };
    const follow = () => {
      setPage(settingsPageFromHash(location.hash));
      toSection();
    };
    try {
      toSection();
      window.addEventListener('hashchange', follow);
      return () => window.removeEventListener('hashchange', follow);
    } catch {
      return undefined; // no address to read (a test): the page given is shown
    }
  }, [pin]);
  const choose = (id) => {
    setPage(id);
    try {
      history.replaceState(null, '', id === 'ai' ? '#ai' : `${location.pathname}${location.search}`);
    } catch {
      /* the address stays as it was; the page still changes */
    }
  };
  const go = (e, id) => {
    // An ordinary click stays on this page and keeps its address (#ai); a click that opens a new tab follows the link as it is.
    if (e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    pin(id);
    setMenuOpen(false);
    // After the folded menu (narrow window) has closed, so the section is measured where it ends up.
    requestAnimationFrame(() => showSection(id));
  };
  const managedNote = Object.keys(eff.locked).some((k) => !eff.floors?.[k]);
  return (
    <div className="ab-set-layout">
      <nav className="ab-set-nav" aria-label={t('Settings')}>
        <PageTabs value={page} onChange={choose} />
        <button type="button" className="ab-btn ab-btn-quiet ab-set-menu-toggle" aria-expanded={menuOpen} aria-controls="ab-set-menu" onClick={() => setMenuOpen((o) => !o)}>
          {t('Go to a section')}
          <Icon name="chevronDown" className="ab-chevron" />
        </button>
        <ul className="ab-set-menu" id="ab-set-menu" data-open={menuOpen ? 'true' : 'false'}>
          {menu.map((m) => (
            <li key={m.id}>
              <a href={`#${m.id}`} className="ab-set-menu-link" aria-current={current === m.id ? 'location' : undefined} onClick={(e) => go(e, m.id)}>
                <Icon name={m.icon} />
                <span>{m.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ab-set-main">
        {managedNote && <p className="ab-note ab-note-warn">{t('Some settings are managed by your organisation and cannot be changed.')}</p>}
        <div id={panelId('ab-settings', 'basics')} className="ab-set-panel" role="tabpanel" aria-labelledby={tabId('ab-settings', 'basics')} hidden={page !== 'basics'}>
          <p className="ab-sub ab-page-intro">{t('Where Agent Buddy works, what you work on, how personal data is protected, and what it keeps on this computer.')}</p>
          <AppearanceSection eff={eff} reload={reload} />
          <LanguageSection eff={eff} reload={reload} />
          <InstancesSection eff={eff} reload={reload} />
          <ProfilesSection eff={eff} reload={reload} />
          <FollowUpSection eff={eff} reload={reload} />
          <ShortcutsSection />
          <RailSection eff={eff} reload={reload} />
          <PrivacySection eff={eff} reload={reload} />
          <PolicySection eff={eff} />
          <AuditSection key={`audit-${epoch}`} eff={eff} />
          {/* Not keyed by epoch like its neighbours: it reads what is left itself after clearing, and a new one would lose the outcome. */}
          <StoredDataSection eff={eff} onCleared={onCleared} />
          <DiagnosticsSection eff={eff} />
          <section className="ab-section ab-set-section" aria-labelledby="h-leaves">
            <SectionHead id="h-leaves" title={t('What leaves your computer')}>
              {t('Only two things: reads from your own ServiceNow site, and the masked text sent to the AI address you chose. Agent Buddy has no server, no analytics and no tracking. It never saves or changes a ticket by itself: when you choose Insert it fills the field on the open form and you press Save.')}
            </SectionHead>
          </section>
        </div>
        <div id={panelId('ab-settings', 'ai')} className="ab-set-panel" role="tabpanel" aria-labelledby={tabId('ab-settings', 'ai')} hidden={page !== 'ai'}>
          <AiAssistPage eff={eff} reload={reload} epoch={epoch} />
        </div>
      </div>
    </div>
  );
}
