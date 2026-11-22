import { useId } from 'react';
import { Icon } from '../ui/icons.jsx';
import { useRailSection } from '../shell/SideRail.jsx';
import { t } from '../../i18n/index.js';

// The first screens of My work and Team (round 5, docs/round5.md): FIVE rows, one finding on each, the detail one tap down. This is
// the Ticket screen's row (docs/focus-layout.md, TicketInsights.jsx GroupRow) with its look (ui/areas/insights.css: the tile, the dot on
// the tile, the title, the line) and one more thing it does not have: the number the row stands for, in a small pill before the chevron.
// Styles for what is new: src/ui/areas/mywork.css (.ab-fr-*).

/**
 * One of the five rows.
 *   rowId      a stable name for tests and the rail ('needs', 'risk' ...)
 *   rail       { id, icon }: the row is also an item of the side rail (when it is drawn); its label is the row's title; null: not listed
 *   icon       an icon name (src/sidepanel/ui/iconPaths.js)
 *   line       the one finding, in words; a row with nothing to report says so in a calm sentence, so the row always shows
 *   count      the number the row stands for, or null when it could not be read (then the line says so, never a zero)
 *   level      '' | 'warn' | 'danger': the dot on the tile when the row needs a look
 *   open, onToggle(open)   the row opens in place (aria-expanded)
 */
export function FiveRow({ rowId, rail, icon, title, line, count = null, level = '', open, onToggle, children }) {
  const bodyId = `ab-fr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const railRef = useRailSection({ id: rail?.id, label: title, icon: rail?.icon || icon, attention: level ? 'warn' : '', open: () => onToggle(true) });
  return (
    <li ref={railRef} className={`ab-ins-pain ab-fr-item${level ? ` is-${level}` : ''}`} data-row={rowId}>
      <button type="button" className="ab-row ab-ins-group-row ab-fr-head" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
        <span className="ab-ins-tile" aria-hidden="true">
          <Icon name={icon} size={18} />
          {level && <span className={`ab-ins-tile-dot is-${level}`} />}
        </span>
        <span className="ab-row-main">
          <span className="ab-row-title ab-ins-pain-title">{title}</span>
          {level && <span className="ab-sr">{t('Needs a look.')}</span>}
          <span className="ab-row-sub ab-fr-line">{line}</span>
        </span>
        {count !== null && count !== undefined && <span className="ab-fr-num">{count}</span>}
        <Icon name="chevronDown" size={16} className="ab-chevron ab-ins-card-chevron" />
      </button>
      <div id={bodyId} className="ab-ins-pain-body ab-fr-body" hidden={!open}>
        {open && children}
      </div>
    </li>
  );
}

/**
 * The quiet rows under the five ("All 6 open tickets, with filters", "My week", "All team charts and tables"): the accent words of
 * "More for this ticket", an icon in front, nothing filled. `detail` is a second, muted part of the same line ("11 closed...").
 */
export function QuietRow({ icon, label, detail = '', onClick, innerRef = null }) {
  return (
    <li className="ab-more-row ab-fr-quiet">
      <button type="button" ref={innerRef} className="ab-row ab-more-tools" onClick={onClick}>
        <Icon name={icon} size={16} className="ab-more-tools-icon" />
        <span className="ab-row-main">
          <span className="ab-more-tools-text">
            {label}
            {detail ? <span className="ab-fr-quiet-detail"> · {detail}</span> : null}
          </span>
        </span>
        <Icon name="chevronRight" size={16} className="ab-more-tools-chevron ab-flip" />
      </button>
    </li>
  );
}

/** "Back" to a screen's five rows, from the view a row opened (the same button as the Ticket screen's). */
export function BackButton({ onBack, innerRef = null }) {
  return (
    <button type="button" ref={innerRef} className="ab-ins-back ab-fr-back" onClick={onBack}>
      <Icon name="chevronLeft" size={16} className="ab-flip" />
      {t('Back')}
    </button>
  );
}
