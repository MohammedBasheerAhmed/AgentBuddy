import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { focusToRestore, inertOutside } from '../dialogKeys.js';
import { Icon } from '../ui/icons.jsx';
import { AiBadge } from '../ui/primitives.jsx';
import { groupLabel } from './commands.js';
import { groupCommands, rankCommands } from './search.js';
import { t } from '../../i18n/index.js';

/** The key All tools opens with, as the person reads it on their computer: "Ctrl+K", or "⌘K" on a Mac. */
export function paletteShortcut() {
  const platform = String(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl+K';
}

/** Is this key press the one that opens All tools? The physical K key, so it works on any keyboard layout (Arabic too). */
export function isPaletteKey(e) {
  return Boolean((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK');
}

/**
 * Is another modal dialog of the panel on screen (the check before anything is sent to the AI)? Then the palette key does nothing:
 * that dialog holds the keyboard and the rest of the panel, and All tools must not open over it. A preview waiting in a part of the
 * panel that is hidden does not count (it holds nothing until it is shown).
 */
export function modalOnScreen(doc = globalThis.document) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return false;
  return Array.from(doc.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((el) => !el.closest('.ab-palette') && el.getClientRects().length > 0);
}

/**
 * All tools: the command palette grown into the place where everything beyond the five of each screen lives (docs/focus-layout.md).
 * A sheet over the panel under the header, with a search box at the top and the tools under their group headings (commands.js); the
 * person types what they want ("reply", "team", "dark") or moves to it, and presses Enter. The headings stay while they type: a search
 * keeps what matches inside each group and leaves out a group with no match.
 *
 * It is a combobox over a listbox: the focus stays in the box and the highlighted tool is named by aria-activedescendant, so a screen
 * reader says each one as the arrow keys move over it. The rest of the panel is inert while it is open and gets the focus back after.
 *
 * props: open, onClose(), commands (see commands.js), onRun(command): called after it has closed,
 *        section: the group to start at ('ticket-insights', 'ticket-assist'): its first tool is the highlighted one and in view
 */
export default function CommandPalette({ open, onClose, commands, onRun, section = '' }) {
  const [query, setQuery] = useState('');
  // The highlighted tool, as its place in the list; null until the person moves or types: the start (the first tool of `section`).
  const [at, setAt] = useState(null);
  const dialog = useRef(null);
  const input = useRef(null);
  const base = `ab-tools${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // (no colons: the ids must work in a CSS selector too)
  const startAt = useRef(section);
  startAt.current = section;

  const groups = useMemo(() => groupCommands(commands, query), [commands, query]);
  const found = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // While the person types, the best match is the highlighted one (Enter runs it), whichever group it is in: the groups keep their order
  // so the headings do not jump, but "team" still runs Go to Team, not an action whose description says "team".
  const best = useMemo(() => (query.trim() ? found.indexOf(rankCommands(commands, query, 1)[0]) : -1), [commands, query, found]);
  const start = Math.max(0, query.trim() ? best : found.findIndex((c) => c.group === section));
  const index = found.length ? Math.min(at ?? start, found.length - 1) : -1;
  const active = index >= 0 ? found[index] : null;
  const optionId = (command) => `${base}-${command.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const groupId = (group) => `${base}-group-${group}`;

  // Opened: start clean, take the focus, shut the rest of the panel out, and when opened at a group bring its heading to the top of the
  // list (its first tool is the highlighted one). Closed: put everything back.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setAt(null);
    const opener = document.activeElement;
    const restore = dialog.current ? inertOutside(dialog.current) : () => {};
    input.current?.focus();
    if (startAt.current) document.getElementById(groupId(startAt.current))?.scrollIntoView?.({ block: 'start' });
    return () => {
      restore();
      // So the next opening draws its start straight away, not this one's search for a moment.
      setQuery('');
      setAt(null);
      const back = focusToRestore(opener, document.activeElement, document.body);
      if (back) back.focus();
    };
    // groupId only joins strings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The highlighted tool stays in view while the arrow keys move.
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
    setAt((n) => (Math.min(n ?? start, found.length - 1) + step + found.length) % found.length);
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
      e.preventDefault(); // the box is the only control; the list is driven from it (Esc or the close button leave)
    }
  };

  return (
    <div className="ab-palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="ab-palette" role="dialog" aria-modal="true" aria-label={t('All tools')}>
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
            aria-label={t('Find a tool')}
            placeholder={t('Find a tool…')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(null); // the best match for the new words (start)
            }}
            onKeyDown={onKeyDown}
          />
          {/* For the pointer: the sheet covers the panel, so there is no backdrop left to click. The keyboard has Esc (the box keeps
              the focus, so this is not a tab stop). */}
          <button type="button" className="ab-iconbtn ab-palette-close" tabIndex={-1} aria-label={t('Close All tools')} title={t('Close All tools')} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="ab-palette-list" id={`${base}-list`} role="listbox" aria-label={t('All tools')}>
          {groups.map((g) => (
            <div key={g.group} id={groupId(g.group)} className="ab-palette-section" role="group" aria-label={groupLabel(g.group)} data-group={g.group}>
              <div className="ab-palette-group" aria-hidden="true">{groupLabel(g.group)}</div>
              {g.items.map((command) => (
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
                  {command.ai && <AiBadge title="" />}
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
