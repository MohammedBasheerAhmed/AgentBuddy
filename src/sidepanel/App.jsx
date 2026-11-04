import { useEffect, useRef, useState } from 'react';
import { useEffective } from './useEffective.js';
import { useForgetOnClear } from './forgetOnClear.js';
import { usePage } from './usePage.js';
import { useLaunch } from './useLaunch.js';
import SetupView from './SetupView.jsx';
import PendingDraft from './PendingDraft.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import FirstRun from './FirstRun.jsx';
import { isAiReady } from './aiReady.js';
import { planPanel, withVisited } from './sections.js';
import { nextTabIndex, panelId, tabId } from './tabKeys.js';
import { screensFor } from '../profiles/profiles.js';
import { BrandMark, Icon, screenIcon } from './ui/icons.jsx';
import { SettingsButton } from './shell/shellParts.jsx';
import CommandPalette, { isPaletteKey, modalOnScreen, paletteShortcut } from './palette/CommandPalette.jsx';
import { buildCommands } from './palette/commands.js';
import { LAUNCH_TTL_MS, makeLaunch } from '../lib/launch.js';
import { saveSettings } from '../lib/storage.js';
import { nextTheme, systemIsDark, themeAttribute } from '../ui/useTheme.js';
import ScreenView from './shell/ScreenView.jsx';
import TicketView from './ticket/TicketView.jsx';
import MyWorkView from './mywork/index.js';
import { TeamInsights, TeamAssist } from './team/index.js';
import { WriteInsights, WriteAssist } from './write/index.js';
import { KnowledgeInsights, KnowledgeAssist } from './knowledgeScreen/index.js';
import { t, isolate } from '../i18n/index.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { useTheme } from '../ui/useTheme.js';

// The panel's screens (TRACKER.md 2.1): Ticket is the record that is open (or the setup / open-a-ticket help); the others work from any
// page of an enabled ServiceNow site. Which screens a person sees comes from their work profiles and the organisation's policy
// (screensFor, src/profiles/profiles.js). Every screen with both halves splits into Insights and AI Assist (ScreenView, TicketView).
//
// A screen the person has opened stays mounted (hidden when another one shows), so what they typed or found survives a trip to
// another browser tab, a page that is reloading, or a look at another screen. What exists and what each part is given is decided by
// planPanel() in sections.js; this file only draws it.
const VIEWS = {
  mywork: { Insights: MyWorkView, Assist: null },
  team: { Insights: TeamInsights, Assist: TeamAssist },
  write: { Insights: WriteInsights, Assist: WriteAssist },
  knowledge: { Insights: KnowledgeInsights, Assist: KnowledgeAssist },
};
const NAV = 'ab-sec';

/** The host of the instance the panel reads, for the header ("dev364920.service-now.com" shows as "dev364920"). */
function instanceOf(page) {
  try {
    const host = new URL(page?.href || page?.origin || '').hostname;
    return { host, short: host.replace(/\.(service-now|servicenow)\.com$/i, '') };
  } catch {
    return null;
  }
}

/** The sun or moon in the header: one click to the other colours (the Settings page has the full choice, including "same as the computer"). */
function ThemeButton({ eff }) {
  const setting = eff.values?.theme || 'system';
  const dark = (themeAttribute(setting) || (systemIsDark() ? 'dark' : 'light')) === 'dark';
  const label = dark ? t('Switch to light colours') : t('Switch to dark colours');
  return (
    <button type="button" className="ab-iconbtn" aria-label={label} title={label} onClick={() => saveSettings({ theme: nextTheme(setting, systemIsDark()) }).catch(() => {})}>
      <Icon name={dark ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

/**
 * The header: the mark, the name and the instance the panel reads, then three quiet icon buttons (the palette, the colours, Settings).
 * The privacy promise that a shield used to carry here is said by the name block: on hover (its title) and to a screen reader (the
 * same words, not drawn); the Insights and AI Assist halves say it again under their switch (HalfRule).
 */
function Header({ base, eff, onPalette }) {
  const instance = base ? instanceOf(base) : null;
  const search = t('Search commands');
  const promise = t('Reads with your own ServiceNow session. Personal data is masked before any AI call. Nothing is written to ServiceNow.');
  return (
    <header className="ab-header">
      <BrandMark size={28} />
      <div className="ab-brandtext" title={promise}>
        <span className="ab-brand">{t('Agent Buddy')}</span>
        {instance && (
          <span className="ab-instance" title={t('Reading {host} with your own session', { host: isolate(instance.host) })}>
            {instance.short}
          </span>
        )}
        <span className="ab-sr ab-promise">{promise}</span>
      </div>
      <span className="ab-spacer" />
      <div className="ab-headtools">
        <button type="button" className="ab-iconbtn" aria-label={search} title={`${search} (${paletteShortcut()})`} aria-keyshortcuts="Control+K Meta+K" aria-haspopup="dialog" onClick={onPalette}>
          <Icon name="search" size={18} />
        </button>
        <ThemeButton eff={eff} />
        <SettingsButton />
      </div>
    </header>
  );
}

/**
 * The screens, as a floating icon dock at the bottom centre of the panel: one round icon per screen, the one on show filled. The name of
 * an icon shows above it on hover and on the keyboard (CSS, shell.css); the name is also the button's text for a screen reader (one
 * tab stop, arrow keys move). It comes after the screens in the page, as it does on the screen.
 */
function ScreenTabs({ screens, value, onChange }) {
  const buttons = useRef({});
  const at = screens.findIndex((s) => s.id === value);
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = nextTabIndex(e.key, at, screens.length);
    if (next < 0) return;
    e.preventDefault();
    onChange(screens[next].id);
    buttons.current[screens[next].id]?.focus();
  };
  return (
    <nav className="ab-screens" role="tablist" aria-label={t('Agent Buddy screens')} onKeyDown={onKeyDown}>
      {screens.map((s) => (
        <button
          key={s.id}
          ref={(el) => {
            buttons.current[s.id] = el;
          }}
          id={tabId(NAV, s.id)}
          type="button"
          role="tab"
          aria-selected={s.id === value}
          aria-controls={panelId(NAV, s.id)}
          tabIndex={s.id === value ? 0 : -1}
          className="ab-screen-tab"
          data-name={s.label}
          onClick={() => onChange(s.id)}
        >
          <Icon name={screenIcon(s.id)} size={18} />
          <span className="ab-sr">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}

const REMEMBER = 'ab-screen';
function rememberedScreen(ids) {
  try {
    const saved = sessionStorage.getItem(REMEMBER);
    return ids.includes(saved) ? saved : 'ticket';
  } catch {
    return 'ticket';
  }
}

/**
 * The whole panel for a given state (everything it needs comes in as props, so it can be drawn without a browser).
 * page: the current page (a held answer counts); lastGood / lastSeen: see usePage.js; section: the chosen screen; visited: Set of ids.
 * Pending: the card for a draft carried to a blank form (a prop so a test can leave it out).
 * launch / onLaunchDone: an action the bar on the ServiceNow page asked for; it goes to the record on screen (see TicketView).
 * paletteOpen / onPalette / onPaletteClose / onOwnLaunch: the command palette (Panel holds its state; onOwnLaunch gets an action the
 * palette chose for the record on screen, as a launch).
 */
export function AppView({ eff, page, lastGood = null, lastSeen = null, section, visited, onChoose = () => {}, onChanged = () => {}, Pending = PendingDraft, launch = null, onLaunchDone = () => {}, paletteOpen = false, onPalette = () => {}, onPaletteClose = () => {}, onOwnLaunch = () => {} }) {
  const screens = screensFor(eff);
  const ids = screens.map((s) => s.id);
  const chosen = ids.includes(section) ? section : 'ticket';
  const plan = planPanel({ ids, active: chosen, visited, page, lastGood, lastSeen });

  // The command palette (open and closed by Panel: Ctrl+K, or Cmd+K on a Mac, or the button in the header). A command that runs an action
  // on the record is handed to the Ticket screen as a launch, exactly like the keyboard shortcuts and the bar on the ServiceNow page do.
  // Only while the Ticket screen can show that record: with the setup help in its place (this tab is not an enabled ServiceNow page) the
  // record view is hidden, and an action launched there would run, preview and all, where nobody can see it.
  const paletteRecord = plan.showSetup ? null : plan.recordPage;
  const commands = paletteOpen ? buildCommands({ eff, screens, active: plan.visible, recordPage: paletteRecord }) : [];
  const runCommand = ({ action }) => {
    if (action.type === 'screen') onChoose(action.id);
    else if (action.type === 'half') saveSettings({ halves: { ...(eff.values?.halves || {}), [action.screen]: action.half } }).catch(() => {});
    else if (action.type === 'settings') chrome.runtime.openOptionsPage();
    else if (action.type === 'theme') saveSettings({ theme: action.value }).catch(() => {});
    else if (action.type === 'language') saveSettings({ language: action.value }).catch(() => {});
    else if (action.type === 'run' && paletteRecord?.record) {
      const { record, tabId: recordTabId } = paletteRecord;
      const request = makeLaunch({ tabId: recordTabId, table: record.table, sysId: record.sysId, featureId: action.featureId, now: Date.now() });
      if (!request) return;
      onChoose('ticket');
      onOwnLaunch(request);
    }
  };

  // A screen that is not on show keeps the page it last had: it neither follows the person from record to record nor reads anything
  // in the background. It gets the current page the moment it is shown again.
  const given = useRef({});
  const pageFor = (id, live, selected) => {
    if (selected || !given.current[id]) given.current[id] = live;
    return given.current[id];
  };

  const content = (s, pane) => {
    if (s.id === 'ticket') {
      const recordPage = plan.recordPage ? pageFor('ticket', plan.recordPage, pane.selected) : null;
      const recordKey = recordPage?.record ? `${recordPage.record.table}:${recordPage.record.sysId}` : '';
      return (
        <>
          {recordPage && (
            <div className="ab-pane" hidden={plan.showSetup}>
              {/* A person who turned the site on from a ticket still has the profile and AI steps to do: the card stays above it
                  until they are done (it draws nothing once they are). */}
              {pane.selected && !plan.showSetup && (
                <ErrorBoundary resetKey={`firstrun:${recordKey}`}>
                  <FirstRun page={page} lastSeen={lastSeen} aiReady={isAiReady(eff)} eff={eff} onChanged={onChanged} />
                </ErrorBoundary>
              )}
              <ErrorBoundary resetKey={recordKey}>
                <TicketView page={recordPage} eff={eff} active={pane.selected && !plan.showSetup} launch={launch} onLaunchDone={onLaunchDone} />
              </ErrorBoundary>
            </div>
          )}
          {plan.showSetup && pane.selected && (
            <ErrorBoundary resetKey={page.status}>
              <FirstRun page={page} lastSeen={lastSeen} aiReady={isAiReady(eff)} eff={eff} onChanged={onChanged} />
              <SetupView page={page} eff={eff} lastSeen={lastSeen} onChanged={onChanged} onOpenScreen={onChoose} />
            </ErrorBoundary>
          )}
        </>
      );
    }
    const { Insights, Assist } = VIEWS[s.id];
    const extra = s.id === 'mywork' ? { onOpenTicket: () => onChoose('ticket') } : {};
    return (
      <ErrorBoundary resetKey={pane.selected}>
        <ScreenView screen={s.id} Insights={Insights} Assist={Assist} page={pageFor(s.id, plan.mountPage, pane.selected)} eff={eff} active={pane.selected} extra={extra} />
      </ErrorBoundary>
    );
  };

  return (
    <div className="ab-app">
      <Header base={plan.base || lastSeen} eff={eff} onPalette={onPalette} />
      <main className="ab-main">
        {plan.enabled && (
          <ErrorBoundary resetKey={page.href}>
            <Pending page={page} eff={eff} />
          </ErrorBoundary>
        )}
        {plan.banner && (
          <p className="ab-note ab-note-warn" role="status">
            {plan.banner}
          </p>
        )}
        {screens.map((s) => {
          const pane = plan.panes.find((p) => p.id === s.id);
          return (
            <div
              key={s.id}
              id={panelId(NAV, s.id)}
              role={plan.showNav ? 'tabpanel' : undefined}
              aria-labelledby={plan.showNav ? tabId(NAV, s.id) : undefined}
              className="ab-pane"
              hidden={!pane.selected}
            >
              {pane.mounted && content(s, pane)}
            </div>
          );
        })}
      </main>
      {plan.showNav && <ScreenTabs screens={screens} value={plan.visible} onChange={onChoose} />}
      <CommandPalette open={paletteOpen} onClose={onPaletteClose} commands={commands} onRun={runCommand} />
    </div>
  );
}

/**
 * Whether the command palette is open, and Ctrl+K (Cmd+K on a Mac) anywhere in the panel to open or close it. While a preview is on
 * screen the key does nothing: the preview holds the keyboard and the rest of the panel, and the palette must not open over it.
 */
export function usePaletteToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (!isPaletteKey(e) || modalOnScreen(document)) return;
      e.preventDefault();
      setOpen((was) => !was);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

/**
 * An action the palette chose for the record on screen (src/sidepanel/palette), handled like the bar's request (useLaunch.js): used
 * once, and gone after the same LAUNCH_TTL_MS, so one the Ticket screen did not take (it named a record that is no longer on screen)
 * cannot start an AI action minutes later, when that record comes back. `ttl` is for tests.
 */
export function useOwnLaunch(ttl = LAUNCH_TTL_MS) {
  const [own, setOwn] = useState(null);
  useEffect(() => {
    if (!own) return undefined;
    const timer = setTimeout(() => setOwn(null), Math.max(0, own.at + ttl - Date.now()));
    return () => clearTimeout(timer);
  }, [own, ttl]);
  return [own, setOwn];
}

function Panel() {
  const eff = useEffective();
  // Settings "Clear everything" or a site turned off: the answers, card reads, inserts and carried drafts held in memory go
  // (forgetOnClear.js).
  useForgetOnClear();
  const lang = useLanguage(eff.values?.language); // before anything below draws a text
  useTheme(eff.values?.theme);
  const { page, lastGood, lastSeen, refresh } = usePage(eff.policy);
  const { launch, clear: clearLaunch } = useLaunch();
  const [paletteOpen, setPaletteOpen] = usePaletteToggle();
  const [ownLaunch, setOwnLaunch] = useOwnLaunch(); // an action the palette chose: handled like `launch`
  const [nav, setNav] = useState(() => {
    const section = rememberedScreen(['ticket', 'mywork', 'team', 'write', 'knowledge']);
    return { section, visited: new Set([section]) };
  });

  const choose = (id) => {
    setNav((n) => ({ section: id, visited: withVisited(n.visited, id) }));
    try {
      sessionStorage.setItem(REMEMBER, id);
    } catch {
      /* a per-tab convenience only */
    }
  };

  // An action asked for from the page belongs to the record, which is on the Ticket screen: bring that screen forward.
  useEffect(() => {
    if (launch) choose('ticket');
    // choose only sets state and a per-tab convenience; it does not need to be a dependency
  }, [launch]);

  if (!eff.ready) {
    return (
      <div className="ab-app">
        <main className="ab-main"><p className="ab-sub">{t('Loading…')}</p></main>
      </div>
    );
  }

  return (
    <AppView
      key={lang}
      eff={eff}
      page={page}
      lastGood={lastGood}
      lastSeen={lastSeen}
      section={nav.section}
      visited={nav.visited}
      onChoose={choose}
      onChanged={refresh}
      launch={launch || ownLaunch}
      onLaunchDone={() => {
        setOwnLaunch(null);
        clearLaunch();
      }}
      paletteOpen={paletteOpen}
      onPalette={() => setPaletteOpen(true)}
      onPaletteClose={() => setPaletteOpen(false)}
      onOwnLaunch={setOwnLaunch}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Panel />
    </ErrorBoundary>
  );
}
