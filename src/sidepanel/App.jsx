import { useState } from 'react';
import { useEffective } from './useEffective.js';
import { usePage } from './usePage.js';
import SetupView from './SetupView.jsx';
import RecordView from './RecordView.jsx';
import MyDayView from './MyDayView.jsx';
import PendingDraft from './PendingDraft.jsx';
import ReportsView from './tabs/ReportsView.jsx';
import ComposeView from './tabs/ComposeView.jsx';
import KnowledgeToolsView from './tabs/KnowledgeToolsView.jsx';
import { PROVIDERS } from '../providers/config.js';

// The panel's sections. "This page" is the record that is open (or the setup / open-a-ticket help); the others work from any
// page of an enabled ServiceNow site.
const SECTIONS = [
  { id: 'page', label: 'This page' },
  { id: 'myday', label: 'My day', View: MyDayView },
  { id: 'team', label: 'Team', View: ReportsView },
  { id: 'write', label: 'Write', View: ComposeView },
  { id: 'kb', label: 'Knowledge', View: KnowledgeToolsView },
];

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
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>
        Settings
      </button>
    </header>
  );
}

function rememberedSection() {
  try {
    const saved = sessionStorage.getItem('ab-section');
    return SECTIONS.some((s) => s.id === saved) ? saved : 'page';
  } catch {
    return 'page';
  }
}

export default function App() {
  const eff = useEffective();
  const { page, refresh } = usePage();
  const [section, setSection] = useState(rememberedSection);

  const choose = (id) => {
    setSection(id);
    try {
      sessionStorage.setItem('ab-section', id);
    } catch {
      /* a per-tab convenience only */
    }
  };

  if (!eff.ready) {
    return (
      <div className="ab-app">
        <main className="ab-main"><p className="ab-sub">Loading…</p></main>
      </div>
    );
  }

  // Everything but the setup help needs the site to be turned on (the content script does the reading).
  const enabled = page.status === 'record' || page.status === 'no-record';
  const current = SECTIONS.find((s) => s.id === section);
  const Other = enabled && current?.View;

  return (
    <div className="ab-app">
      <Header eff={eff} />
      {enabled && (
        <nav className="ab-row ab-nav" role="tablist" aria-label="Agent Buddy sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={`ab-btn ab-btn-sm${section === s.id ? ' ab-btn-primary' : ''}`} onClick={() => choose(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      )}
      <main className="ab-main">
        {enabled && <PendingDraft page={page} />}
        {Other ? (
          <Other page={page} eff={eff} />
        ) : page.status === 'record' ? (
          <RecordView page={page} eff={eff} />
        ) : (
          <SetupView page={page} eff={eff} onChanged={refresh} />
        )}
      </main>
      <footer className="ab-footer">
        Reads with your own ServiceNow session. Personal data is masked before any AI call. Nothing is written to ServiceNow.
      </footer>
    </div>
  );
}
