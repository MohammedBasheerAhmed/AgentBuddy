import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { focusToRestore, inertOutside } from '../dialogKeys.js';
import { Icon } from '../ui/icons.jsx';
import { groupLabel } from './commands.js';
import { rankCommands } from './search.js';
import { t } from '../../i18n/index.js';

/** The key the palette opens with, as the person reads it on their computer: "Ctrl+K", or "⌘K" on a Mac. */
export function paletteShortcut() {
  const platform = String(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl+K';
}

/** Is this key press the one that opens the palette? The physical K key, so it works on any keyboard layout (Arabic too). */
export function isPaletteKey(e) {
  return Boolean((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK');
}

/**
 * The command palette: a box over the panel where the person types what they want ("reply", "team", "dark") and presses Enter.
 * It is a combobox over a listbox: the focus stays in the box and the highlighted command is named by aria-activedescendant, so a screen
 * reader says each command as the arrow keys move over it. The rest of the panel is inert while it is open and gets the focus back after.
 *
 * props: open, onClose(), commands (see commands.js), onRun(command): called after the palette has closed
 */
export default function CommandPalette({ open, onClose, commands, onRun }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const dialog = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const base = useId();

  const found = useMemo(() => rankCommands(commands, query), [commands, query]);
  const active = found[Math.min(at, found.length - 1)] || null;
  const optionId = (command) => `${base}-${command.id.replace(/[^a-z0-9]+/gi, '-')}`;

  // Opened: start clean, take the focus, shut the rest of the panel out. Closed: put everything back.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setAt(0);
    const opener = document.activeElement;
    const restore = dialog.current ? inertOutside(dialog.current) : () => {};
    input.current?.focus();
    return () => {
      restore();
      const back = focusToRestore(opener, document.activeElement, document.body);
      if (back) back.focus();
    };
  }, [open]);

  // The highlighted command stays in view while the arrow keys move.
  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // optionId only joins strings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.id]);

  if (!open) return null;

  const run = (command) => {
    if (!command) return;
    onClose();
    onRun(command);
  };
  const move = (step) => {
    if (!found.length) return;
    setAt((n) => (Math.min(n, found.length - 1) + step + found.length) % found.length);
  };
  const onKeyDown = (e) => {
    const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && letter === 'n')) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && letter === 'p')) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home' && found.length) {
      e.preventDefault();
      setAt(0);
    } else if (e.key === 'End' && found.length) {
      e.preventDefault();
      setAt(found.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the box is the only control; the list is driven from it
    }
  };

  // Group headings appear while nothing is typed; a search shows one ranked list.
  const sections = [];
  found.forEach((command) => {
    const heading = query.trim() ? '' : command.group;
    const last = sections[sections.length - 1];
    if (last && last.heading === heading) last.items.push(command);
    else sections.push({ heading, items: [command] });
  });

  return (
    <div className="ab-palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="ab-palette" role="dialog" aria-modal="true" aria-label={t('Commands')}>
        <div className="ab-palette-box">
          <Icon name="search" size={16} className="ab-palette-glass" />
          <input
            ref={input}
            className="ab-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label={t('Search commands')}
            placeholder={t('Type a command or a screen…')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="ab-palette-list" id={`${base}-list`} role="listbox" aria-label={t('Commands')} ref={list}>
          {sections.map((section, i) => (
            <div key={`${section.heading}:${i}`} role={section.heading ? 'group' : 'presentation'} aria-label={section.heading ? groupLabel(section.heading) : undefined}>
              {section.heading && <div className="ab-palette-group" aria-hidden="true">{groupLabel(section.heading)}</div>}
              {section.items.map((command) => (
                <div
                  key={command.id}
                  id={optionId(command)}
                  role="option"
                  aria-selected={command === active}
                  data-command={command.id}
                  className={`ab-palette-item${command === active ? ' is-active' : ''}`}
                  onMouseMove={() => command !== active && setAt(found.indexOf(command))}
                  onClick={() => run(command)}
                >
                  <span className={`ab-palette-icon${command.ai ? ' is-ai' : ''}`}>
                    <Icon name={command.icon} size={15} />
                  </span>
                  <span className="ab-palette-text">
                    <span className="ab-palette-label">{command.label}</span>
                    {command.hint && <span className="ab-palette-hint">{command.hint}</span>}
                  </span>
                  {command.ai && (
                    <span className="ab-ai-badge" aria-hidden="true">
                      <Icon name="spark" size={10} />
                      AI
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {!found.length && <p className="ab-palette-empty" role="status">{t('Nothing matches "{query}".', { query: query.trim() })}</p>}
        </div>
        <div className="ab-palette-foot" aria-hidden="true">
          <span><kbd><Icon name="arrowUp" size={9} /></kbd> <kbd><Icon name="arrowDown" size={9} /></kbd> {t('move')}</span>
          <span><kbd>Enter</kbd> {t('run')}</span>
          <span><kbd>Esc</kbd> {t('close')}</span>
        </div>
      </div>
    </div>
  );
}
