import { useEffect, useRef, useState } from 'react';
import { useEffective } from './useEffective.js';
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
import { ShieldMark } from './ui/primitives.jsx';
import { SettingsButton } from './shell/shellParts.jsx';
import ScreenView from './shell/ScreenView.jsx';
import TicketView from './ticket/TicketView.jsx';
import MyWorkView from './mywork/index.js';
import { TeamInsights, TeamAssist } from './team/index.js';
import { WriteInsights, WriteAssist } from './write/index.js';
import { KnowledgeInsights, KnowledgeAssist } from './knowledgeScreen/index.js';
import { t } from '../i18n/index.js';
import { useLanguage } from '../i18n/useLanguage.js';

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

function Header({ base }) {
  const instance = base ? instanceOf(base) : null;
  return (
    <header className="ab-header">
      <span className="ab-brand">{t('Agent Buddy')}</span>
      {instance && (
        <span className="ab-instance" title={`Reading ${instance.host} with your own session`}>
          {instance.short}
        </span>
      )}
      <span className="ab-spacer" />
      <ShieldMark />
      <SettingsButton />
    </header>
  );
}

/** The row of screens: plain tabs with an underline (one tab stop, arrow keys move). */
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
          onClick={() => onChange(s.id)}
        >
          {s.label}
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
 */
export function AppView({ eff, page, lastGood = null, lastSeen = null, section, visited, onChoose = () => {}, onChanged = () => {}, Pending = PendingDraft, launch = null, onLaunchDone = () => {} }) {
  const screens = screensFor(eff);
  const ids = screens.map((s) => s.id);
  const chosen = ids.includes(section) ? section : 'ticket';
  const plan = planPanel({ ids, active: chosen, visited, page, lastGood, lastSeen });

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
      <Header base={plan.base || lastSeen} />
      {plan.showNav && <ScreenTabs screens={screens} value={plan.visible} onChange={onChoose} />}
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
    </div>
  );
}

function Panel() {
  const eff = useEffective();
  const lang = useLanguage(eff.values?.language); // before anything below draws a text
  const { page, lastGood, lastSeen, refresh } = usePage();
  const { launch, clear: clearLaunch } = useLaunch();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  if (!eff.ready) {
    return (
      <div className="ab-app">
        <main className="ab-main"><p className="ab-sub">{t('Loading…')}</p></main>
      </div>
    );
  }

  return <AppView key={lang} eff={eff} page={page} lastGood={lastGood} lastSeen={lastSeen} section={nav.section} visited={nav.visited} onChoose={choose} onChanged={refresh} launch={launch} onLaunchDone={clearLaunch} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Panel />
    </ErrorBoundary>
  );
}
