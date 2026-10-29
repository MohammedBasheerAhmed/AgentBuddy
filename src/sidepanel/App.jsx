import { useEffect, useRef, useState } from 'react';
import { useEffective } from './useEffective.js';
import { usePage } from './usePage.js';
import { useLaunch } from './useLaunch.js';
import SetupView from './SetupView.jsx';
import RecordView from './RecordView.jsx';
import MyDayView from './MyDayView.jsx';
import PendingDraft from './PendingDraft.jsx';
import ReportsView from './tabs/ReportsView.jsx';
import ComposeView from './tabs/ComposeView.jsx';
import KnowledgeToolsView from './tabs/KnowledgeToolsView.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import Tabs from './Tabs.jsx';
import { SectionVisibleProvider } from './SectionVisible.js';
import { planPanel, withVisited } from './sections.js';
import { panelId, tabId } from './tabKeys.js';
import { PROVIDERS } from '../providers/config.js';
import { modelChoices } from '../lib/modelChoices.js';
import { saveSettings } from '../lib/storage.js';

// The panel's sections. "This page" is the record that is open (or the setup / open-a-ticket help); the others work from any
// page of an enabled ServiceNow site.
//
// A section the person has opened stays mounted (hidden when another one shows), so what they typed or found survives a trip to
// another browser tab, a page that is reloading, or a look at another section. What exists and what each part is given is decided
// by planPanel() in sections.js; this file only draws it.
const SECTIONS = [
  { id: 'page', label: 'This page' },
  { id: 'myday', label: 'My day', View: MyDayView },
  { id: 'team', label: 'Team', View: ReportsView },
  { id: 'write', label: 'Write', View: ComposeView },
  { id: 'kb', label: 'Knowledge', View: KnowledgeToolsView },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);
const NAV = 'ab-sec';

// The model in use, and a way to switch it without opening Settings: the ones loaded from the server (Settings, "Load models"), the
// provider's own list, and the one in use; only the ones the organisation allows when its policy lists them. Switching saves the
// choice like Settings does; a run that is already going is not affected.
function ModelSwitch({ eff }) {
  const def = PROVIDERS[eff.values?.provider];
  if (!def) return null;
  const current = eff.values.models?.[eff.values.provider] || def.defaultModel;
  const choices = modelChoices({ def, current, loaded: eff.values.modelLists?.[eff.values.provider], allowed: eff.policy?.allowedModels });
  if (!current && !choices.length) return null;
  if (eff.locked?.model || choices.length < 2) return <span className="ab-tag ab-mono" title="The AI model in use. Change it in Settings.">{current}</span>;
  return (
    <select
      className="ab-select ab-select-sm"
      aria-label="AI model"
      title="The AI model in use. Pick another to switch."
      value={current}
      onChange={(e) => saveSettings({ models: { ...eff.values.models, [eff.values.provider]: e.target.value } })}
    >
      {choices.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
    </select>
  );
}

function Header({ eff }) {
  const provider = PROVIDERS[eff.values?.provider];
  return (
    <header className="ab-header">
      <span className="ab-brand">Agent Buddy</span>
      <span className="ab-spacer" />
      {provider && (
        <span className="ab-tag" title="The AI provider in use. Change it in Settings.">
          {provider.label.split(' (')[0].split(' /')[0]}
        </span>
      )}
      <ModelSwitch eff={eff} />
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>
        Settings
      </button>
    </header>
  );
}

function rememberedSection() {
  try {
    const saved = sessionStorage.getItem('ab-section');
    return SECTION_IDS.includes(saved) ? saved : 'page';
  } catch {
    return 'page';
  }
}

/**
 * The whole panel for a given state (everything it needs comes in as props, so it can be drawn without a browser).
 * page: the current page (a held answer counts); lastGood / lastSeen: see usePage.js; section: the chosen one; visited: Set of ids.
 * Pending: the card for a draft carried to a blank form (a prop so a test can leave it out).
 * launch / onLaunchDone: an action the bar on the ServiceNow page asked for; it goes to the record on screen (see RecordView).
 */
export function AppView({ eff, page, lastGood = null, lastSeen = null, section, visited, onChoose = () => {}, onChanged = () => {}, Pending = PendingDraft, launch = null, onLaunchDone = () => {} }) {
  const plan = planPanel({ ids: SECTION_IDS, active: section, visited, page, lastGood, lastSeen });

  // A section that is not on screen keeps the page it last had on screen: it neither follows the person from record to record nor
  // reads anything in the background. It gets the current page the moment it is shown again.
  const given = useRef({});
  const pageFor = (id, live, selected) => {
    if (selected || !given.current[id]) given.current[id] = live;
    return given.current[id];
  };

  const content = (s, pane) => {
    if (s.id === 'page') {
      const recordPage = plan.recordPage ? pageFor('page', plan.recordPage, pane.selected) : null;
      const recordKey = recordPage?.record ? `${recordPage.record.table}:${recordPage.record.sysId}` : '';
      return (
        <>
          {recordPage && (
            <div className="ab-pane" hidden={plan.showSetup}>
              <ErrorBoundary resetKey={recordKey}>
                <RecordView page={recordPage} eff={eff} launch={launch} onLaunchDone={onLaunchDone} />
              </ErrorBoundary>
            </div>
          )}
          {plan.showSetup && pane.selected && (
            <ErrorBoundary resetKey={page.status}>
              <SetupView page={page} eff={eff} onChanged={onChanged} />
            </ErrorBoundary>
          )}
        </>
      );
    }
    const View = s.View;
    return (
      <ErrorBoundary resetKey={pane.selected}>
        <View page={pageFor(s.id, plan.mountPage, pane.selected)} eff={eff} />
      </ErrorBoundary>
    );
  };

  return (
    <div className="ab-app">
      <Header eff={eff} />
      {plan.showNav && <Tabs idBase={NAV} label="Agent Buddy sections" className="ab-row ab-nav" tabs={SECTIONS} value={plan.visible} onChange={onChoose} />}
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
        {SECTIONS.map((s) => {
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
              {pane.mounted && <SectionVisibleProvider value={pane.selected}>{content(s, pane)}</SectionVisibleProvider>}
            </div>
          );
        })}
      </main>
      <footer className="ab-footer">
        Reads with your own ServiceNow session. Personal data is masked before any AI call. Nothing is written to ServiceNow.
      </footer>
    </div>
  );
}

function Panel() {
  const eff = useEffective();
  const { page, lastGood, lastSeen, refresh } = usePage();
  const { launch, clear: clearLaunch } = useLaunch();
  const [nav, setNav] = useState(() => {
    const section = rememberedSection();
    return { section, visited: new Set([section]) };
  });

  const choose = (id) => {
    setNav((n) => ({ section: id, visited: withVisited(n.visited, id) }));
    try {
      sessionStorage.setItem('ab-section', id);
    } catch {
      /* a per-tab convenience only */
    }
  };

  // An action asked for from the page belongs to the record, which is in "This page": bring that section forward.
  useEffect(() => {
    if (launch) choose('page');
    // choose only sets state and a per-tab convenience; it does not need to be a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  if (!eff.ready) {
    return (
      <div className="ab-app">
        <main className="ab-main"><p className="ab-sub">Loading…</p></main>
      </div>
    );
  }

  return <AppView eff={eff} page={page} lastGood={lastGood} lastSeen={lastSeen} section={nav.section} visited={nav.visited} onChoose={choose} onChanged={refresh} launch={launch} onLaunchDone={clearLaunch} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Panel />
    </ErrorBoundary>
  );
}
