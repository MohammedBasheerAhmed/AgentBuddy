import { useEffective } from './useEffective.js';
import { usePage } from './usePage.js';
import SetupView from './SetupView.jsx';
import RecordView from './RecordView.jsx';
import { PROVIDERS } from '../providers/config.js';

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

export default function App() {
  const eff = useEffective();
  const { page, refresh } = usePage();

  if (!eff.ready) {
    return (
      <div className="ab-app">
        <main className="ab-main"><p className="ab-sub">Loading…</p></main>
      </div>
    );
  }

  return (
    <div className="ab-app">
      <Header eff={eff} />
      <main className="ab-main">
        {page.status === 'record' ? (
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
