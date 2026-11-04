import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n/index.js';

/**
 * The one "⋯" menu of the Team dashboard's quiet top row: everything that is not a number (refresh, auto-refresh, customize, export,
 * print, full page) lives here, so the first thing on screen is the numbers (TRACKER.md 2.4).
 *
 *   label  the menu button's accessible name
 *   items  [{ id, label, onSelect(), checked?: boolean (a tick item), disabled?: boolean }]
 *
 * Keyboard: Enter/Space/ArrowDown open it and focus the first item; ArrowUp/ArrowDown/Home/End move; Escape closes and gives the focus
 * back to the button; Tab closes. A click outside closes it.
 */
export default function MoreMenu({ label = t('More'), items }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef(null);
  const menu = useRef(null);
  const list = (Array.isArray(items) ? items : []).filter(Boolean);

  const entries = () => (menu.current ? [...menu.current.querySelectorAll('[role^="menuitem"]:not([disabled])')] : []);
  const close = (refocus) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    entries()[0]?.focus();
    const away = (event) => {
      if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onMenuKey = (event) => {
    const all = entries();
    const at = all.indexOf(document.activeElement);
    const go = (i) => all[(i + all.length) % all.length]?.focus();
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') {
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
  };

  return (
    <div className="ab-more">
      <button
        ref={button}
        type="button"
        className="ab-iconbtn ab-more-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className="ab-menu" onKeyDown={onMenuKey}>
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              role={typeof item.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={typeof item.checked === 'boolean' ? item.checked : undefined}
              className="ab-menu-item"
              tabIndex={-1}
              disabled={item.disabled || undefined}
              onClick={() => {
                close(true); // the focus goes back to the menu button, not to the top of the page
                item.onSelect?.();
              }}
            >
              {typeof item.checked === 'boolean' && <span className="ab-menu-tick" aria-hidden="true">{item.checked ? '✓' : ''}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
