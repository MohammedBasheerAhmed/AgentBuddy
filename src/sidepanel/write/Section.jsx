import { useState } from 'react';
import { AiBadge } from '../ui/primitives.jsx';
import { Icon } from '../ui/icons.jsx';
import { t } from '../../i18n/index.js';

// The calm layout of the Write and Knowledge screens (the 2026 redesign): a screen is a few sections kept apart by space and one
// divider line, never boxes inside boxes. A section has a quiet heading, an optional few words beside it, and its content. A section
// that opens in place (a tool that reads only when it is opened) has its heading as a button with a chevron that points down, and
// up while it is open. Lists inside a section are rows with a divider between them (MoreRows). Styles: src/ui/areas/compose.css.

/**
 * One section of a screen.
 *   id         data-card: how the tests and the e2e scenarios find a section
 *   title      its name (a noun: "Snippets"); summary: a few words beside it ("12 snippets"), '' for none
 *   attention  '' | 'warn': the summary is said in the warning colour (the words still say it)
 *   ai         an AI tool: the small grey spark next to the title
 *   fold       the heading opens and closes the section; `open` / `onToggle` controlled, or its own state from `defaultOpen`.
 *              The content stays mounted while folded, so what was typed or found in it survives.
 */
export function Section({ id, title, summary = '', attention = '', ai = false, fold = false, open, defaultOpen = true, onToggle, className = '', children }) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = !fold || (open === undefined ? own : open);
  const toggle = () => {
    if (open === undefined) setOwn(!isOpen);
    onToggle?.(!isOpen);
  };
  const classes = `ab-section ab-wk-section${fold ? ' ab-wk-fold' : ''}${attention ? ` ab-wk-${attention}` : ''}${className ? ` ${className}` : ''}`;
  const words = (
    <>
      {ai && <AiBadge />}
      {summary && <span className="ab-wk-summary">{summary}</span>}
    </>
  );
  return (
    <section className={classes} data-card={id || undefined} aria-label={title}>
      {fold ? (
        <h2 className="ab-wk-head">
          <button type="button" className="ab-wk-toggle" aria-expanded={isOpen} onClick={toggle}>
            <span className="ab-section-title ab-wk-title">{title}</span>
            {words}
            <Icon name="chevronDown" className="ab-chevron ab-wk-chevron" />
          </button>
        </h2>
      ) : (
        <div className="ab-wk-head">
          <h2 className="ab-section-title ab-wk-title">{title}</h2>
          {words}
        </div>
      )}
      <div className="ab-wk-body" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/**
 * A list as rows (a divider between them, no box around them): the first `limit`, then "Show all (12)".
 *   items, render(item, index) -> an <li>, label: the list's name for a screen reader
 *   keep(item): an item that stays on screen while the rest is folded away (the one that is open)
 */
export function MoreRows({ items, render, limit = 3, keep, label, className = '' }) {
  const [all, setAll] = useState(false);
  const list = Array.isArray(items) ? items : [];
  const shown = all ? list : list.filter((item, i) => i < limit || Boolean(keep?.(item)));
  return (
    <>
      <ul className={`ab-rows ab-wk-rows${className ? ` ${className}` : ''}`} aria-label={label}>
        {shown.map((item, i) => render(item, i))}
      </ul>
      {list.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-showmore ab-wk-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? t('Show fewer') : `${t('Show all')} (${list.length})`}
        </button>
      )}
    </>
  );
}

/** A button that opens something in place: its words and a chevron that points down (up while open). */
export function OpenButton({ open, onClick, className = 'ab-btn ab-btn-quiet ab-btn-sm', children, ...rest }) {
  return (
    <button type="button" className={`${className} ab-wk-opener`} aria-expanded={open} onClick={onClick} {...rest}>
      {children}
      <Icon name="chevronDown" size={14} className="ab-chevron" />
    </button>
  );
}
