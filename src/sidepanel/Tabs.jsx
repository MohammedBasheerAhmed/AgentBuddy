import { useRef } from 'react';
import { nextTabIndex, panelId, tabId } from './tabKeys.js';

/**
 * A tab list (the Settings pages): one tab stop (roving tabindex), Left/Right/Home/End move between tabs, every tab names the panel
 * it controls. Each panel is the caller's own element and names its tab with the same ids (src/sidepanel/tabKeys.js):
 *
 *   <Tabs idBase="ab-settings" label="Settings pages" tabs={[{ id, label }]} value={id} onChange={setId} />
 *   <div id={panelId('ab-settings', 'ai')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'ai')} hidden={id !== 'ai'}>...</div>
 */
export default function Tabs({ idBase, label, tabs, value, onChange, className = 'ab-row' }) {
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
          aria-controls={panelId(idBase, t.id)}
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
