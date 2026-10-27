import React, { useRef, useState } from 'react';
import EmailPanel from '../compose/EmailPanel.jsx';
import RewritePanel from '../compose/RewritePanel.jsx';
import NotesPanel from '../compose/NotesPanel.jsx';
import SnippetsPanel from '../compose/SnippetsPanel.jsx';

// The Write section: four small tools that work from any page of an enabled ServiceNow site. Each uses the open record when
// there is one (page.record). Props (top-level tab): { page, eff }.
//
// All four panels stay mounted while another is shown (hidden, not removed), so a draft, a pasted text or a half-written snippet
// survives a look at another tab.
const TABS = [
  { id: 'email', label: 'Email', Panel: EmailPanel },
  { id: 'rewrite', label: 'Rewrite', Panel: RewritePanel },
  { id: 'notes', label: 'Notes to ticket', Panel: NotesPanel },
  { id: 'snippets', label: 'Snippets', Panel: SnippetsPanel },
];

const STORAGE_KEY = 'ab-compose-tab';

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
  const buttons = useRef({});

  const choose = (id, focus = false) => {
    setTab(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* a per-tab convenience only */
    }
    if (focus) buttons.current[id]?.focus();
  };

  // Arrow keys, Home and End move between the tabs (the standard tab pattern).
  const onKeyDown = (e) => {
    const at = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    choose(TABS[next].id, true);
  };

  return (
    <div className="ab-compose">
      <div className="ab-row ab-compose-tabs" role="tablist" aria-label="Write tools" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`ab-compose-tab-${t.id}`}
            ref={(el) => {
              buttons.current[t.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`ab-compose-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`ab-btn ab-btn-sm${tab === t.id ? ' ab-btn-primary' : ''}`}
            onClick={() => choose(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map(({ id, Panel }) => (
        <div key={id} id={`ab-compose-panel-${id}`} role="tabpanel" aria-labelledby={`ab-compose-tab-${id}`} className="ab-compose-panel" hidden={tab !== id}>
          <Panel page={page} eff={eff} active={tab === id} />
        </div>
      ))}
    </div>
  );
}
