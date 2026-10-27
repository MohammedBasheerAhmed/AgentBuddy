import React, { useRef } from 'react';
import { nextTabIndex, panelId, sharedPanelId, tabId } from './tabKeys.js';

/**
 * The one tab list of the side panel (the same pattern the Write section uses): one tab stop (roving tabindex), Left/Right/Home/End
 * move between tabs, every tab names the panel it controls and every panel names its tab.
 *
 *   <Tabs idBase="ab-sec" label="Agent Buddy sections" tabs={[{ id, label }]} value={id} onChange={setId} />
 *   <TabPanel idBase="ab-sec" id="write" hidden={value !== 'write'}>...</TabPanel>
 *
 * With `shared`, all tabs control ONE panel whose content changes (a record's tabs, the Knowledge tools):
 *   <Tabs shared .../>  <TabPanel idBase shared value={id}>...</TabPanel>
 */
export default function Tabs({ idBase, label, tabs, value, onChange, className = 'ab-row', shared = false }) {
  const buttons = useRef({});
  const selected = tabs.some((t) => t.id === value) ? value : tabs[0]?.id;

  const choose = (id, focus = false) => {
    onChange(id);
    if (focus) buttons.current[id]?.focus();
  };

  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = nextTabIndex(e.key, tabs.findIndex((t) => t.id === selected), tabs.length);
    if (next < 0) return;
    e.preventDefault();
    choose(tabs[next].id, true);
  };

  return (
    <div className={className} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={tabId(idBase, t.id)}
          ref={(el) => {
            buttons.current[t.id] = el;
          }}
          type="button"
          role="tab"
          aria-selected={selected === t.id}
          aria-controls={shared ? sharedPanelId(idBase) : panelId(idBase, t.id)}
          tabIndex={selected === t.id ? 0 : -1}
          className={`ab-btn ab-btn-sm${selected === t.id ? ' ab-btn-primary' : ''}`}
          onClick={() => choose(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The panel a tab controls. `shared`: the one panel of a shared tab list, labelled by the selected tab (`value`). */
export function TabPanel({ idBase, id, value, shared = false, hidden = false, className = '', children }) {
  return (
    <div
      id={shared ? sharedPanelId(idBase) : panelId(idBase, id)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, shared ? value : id)}
      className={className || undefined}
      hidden={hidden || undefined}
    >
      {children}
    </div>
  );
}
