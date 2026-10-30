import React, { useState } from 'react';
import Tabs, { TabPanel } from '../Tabs.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import EmailPanel from '../compose/EmailPanel.jsx';
import RewritePanel from '../compose/RewritePanel.jsx';
import NotesPanel from '../compose/NotesPanel.jsx';
import SnippetsPanel from '../compose/SnippetsPanel.jsx';

// The Write section: four small tools that work from any page of an enabled ServiceNow site. Each uses the open record when
// there is one (page.record). Props (top-level tab): { page, eff }.
//
// All four panels stay mounted while another is shown (hidden, not removed), so a draft, a pasted text or a half-written snippet
// survives a look at another tab. The tab list is the panel's one tab component (Tabs.jsx: arrow keys, Home, End, one tab stop), and
// each tool has its own error boundary, so one that breaks leaves the other three and what was typed in them.
const TABS = [
  { id: 'email', label: 'Email', Panel: EmailPanel },
  { id: 'rewrite', label: 'Rewrite', Panel: RewritePanel },
  { id: 'notes', label: 'Notes to ticket', Panel: NotesPanel },
  { id: 'snippets', label: 'Snippets', Panel: SnippetsPanel },
];

const STORAGE_KEY = 'ab-compose-tab';
const ID_BASE = 'ab-compose';

function remembered() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return TABS.some((t) => t.id === saved) ? saved : TABS[0].id;
  } catch {
    return TABS[0].id;
  }
}

export default function ComposeView({ page, eff }) {
  const [tab, setTab] = useState(remembered);

  const choose = (id) => {
    setTab(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* a per-tab convenience only */
    }
  };

  return (
    <div className="ab-compose">
      <Tabs idBase={ID_BASE} label="Write tools" tabs={TABS} value={tab} onChange={choose} className="ab-row ab-compose-tabs" />
      {TABS.map(({ id, Panel }) => (
        <TabPanel key={id} idBase={ID_BASE} id={id} className="ab-compose-panel" hidden={tab !== id}>
          <ErrorBoundary resetKey={id}>
            <Panel page={page} eff={eff} active={tab === id} />
          </ErrorBoundary>
        </TabPanel>
      ))}
    </div>
  );
}
