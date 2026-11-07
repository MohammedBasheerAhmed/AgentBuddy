import { useId, useState } from 'react';
import { Icon } from './icons.jsx';
import { t, tn } from '../../i18n/index.js';

// Small building blocks every screen uses, so the panel looks and behaves the same everywhere (TRACKER.md 2.3 and 2.4):
//   AiBadge       the one mark every AI element carries (never an Insights element)
//   CardFrame     a card with a title that folds open and closed, a one-line summary when folded, an optional attention level
//   ShowMore      the first few items, then "Show all (12)"
//   HalfRule      the one line under the Insights / AI Assist switch that says where data goes
// Styles: src/ui/areas/shell.css.

/**
 * The AI mark: a small grey spark (no colour, no letters on screen: green is the panel's only accent). Its name, "AI", is there for a
 * screen reader, and the hover text says what using AI means. Decorative (label="") where the text next to it already says AI.
 *   size: the spark in px (14 by default; 16 in a main button)
 */
export function AiBadge({ label = 'AI', title = t('Uses AI. Masked text goes to the AI you chose, after a preview.'), size = 14 }) {
  return (
    <span className="ab-ai-badge" title={title || undefined}>
      <Icon name="spark" size={size} strokeWidth={2} className="ab-ai-spark" />
      {label && <span className="ab-sr">{label}</span>}
    </span>
  );
}

/** The shield mark that replaces the footer sentence: the privacy promise, said once, on hover and for screen readers. */
export function ShieldMark() {
  const text = t('Reads from ServiceNow as you. Personal data is masked before any AI call. Nothing is written to ServiceNow.');
  return (
    <span className="ab-shield" title={text} role="img" aria-label={text}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M8 1 L14 3.2 V7.6 C14 11 11.4 13.8 8 15 C4.6 13.8 2 11 2 7.6 V3.2 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5.4 8.1 L7.3 10 L10.8 6.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * A card whose title folds it open and closed: a row with the title, a line under it, and a chevron that points down (up when open).
 *   title      the card's name (a noun: "Related tickets")
 *   summary    one short line under the title, open or folded ("10 earlier · 5 open"); '' for none
 *   attention  '' | 'warn' | 'danger': a status dot before the title and the line in that colour, for a card that needs a look
 *   open / onToggle   controlled; leave out to let the card keep its own state, starting at `defaultOpen`
 *   actions    small controls drawn at the right of the title row (a Refresh button); keep to one or two
 */
export function CardFrame({ title, summary = '', attention = '', open, defaultOpen = true, onToggle, actions = null, children, id }) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open === undefined ? own : open;
  const bodyId = useId();
  const toggle = () => {
    if (open === undefined) setOwn(!isOpen);
    onToggle?.(!isOpen);
  };
  return (
    <section className={`ab-cardx${attention ? ` ab-cardx-${attention}` : ''}`} data-card={id || undefined} aria-label={title}>
      <div className="ab-cardx-head">
        <button type="button" className="ab-cardx-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
          {attention && <span className={`ab-dot ab-dot-${attention}`} aria-hidden="true" />}
          <span className="ab-cardx-text">
            <span className="ab-cardx-title">{title}</span>
            {summary && <span className="ab-cardx-summary">{summary}</span>}
          </span>
          <Icon name="chevronDown" size={16} className="ab-chevron ab-cardx-chevron" />
        </button>
        {actions && <span className="ab-cardx-actions">{actions}</span>}
      </div>
      <div id={bodyId} className="ab-cardx-body" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/**
 * The first `limit` items, then a button for the rest.
 *   items, render(item, index) -> node, limit (default 3), more ("Show all") and less ("Show fewer") labels
 */
export function ShowMore({ items, render, limit = 3, more = t('Show all'), less = t('Show fewer'), className = 'ab-list' }) {
  const [all, setAll] = useState(false);
  const list = Array.isArray(items) ? items : [];
  const shown = all ? list : list.slice(0, limit);
  return (
    <>
      <div className={className}>{shown.map((item, i) => render(item, i))}</div>
      {list.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-showmore" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? less : `${more} (${list.length})`}
        </button>
      )}
    </>
  );
}

/**
 * The line under the half switch that says where data goes.
 *   half: 'insights' | 'assist'; destination: where AI text goes ("DeepSeek (api.deepseek.com)") for AI Assist
 */
export function HalfRule({ half, destination = '' }) {
  if (half === 'assist') {
    return (
      <p className="ab-halfrule ab-halfrule-assist">
        <AiBadge />
        <span>{destination ? t('Masked text goes to {destination}. You see it first.', { destination }) : t('Masked text goes to the AI you choose. You see it first.')}</span>
      </p>
    );
  }
  return (
    <p className="ab-halfrule ab-halfrule-insights">
      <ShieldMark />
      <span>{t('Stays in ServiceNow. Nothing is sent anywhere.')}</span>
    </p>
  );
}

/**
 * The Insights / AI Assist switch under a screen's title. A screen with one half draws no switch (pass `assist={false}`).
 *   value: 'insights' | 'assist'; onChange(next); idBase: unique per screen (for the tab and panel ids)
 *   assistNote: a few words after "AI Assist" when it cannot be used as is ("off", "set up")
 *   count: how many rows of Insights need a look (the Ticket screen); a number after the name, said in words to a screen reader
 */
export function HalfSwitch({ value, onChange, idBase, assist = true, assistNote = '', count = 0 }) {
  if (!assist) return null;
  const tabs = [
    { id: 'insights', label: t('Insights') },
    { id: 'assist', label: t('AI Assist') },
  ];
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'insights' : e.key === 'End' ? 'assist' : value === 'insights' ? 'assist' : 'insights';
    onChange(next);
    e.currentTarget.querySelector(`#${idBase}-tab-${next}`)?.focus();
  };
  return (
    <div className="ab-halfswitch" role="tablist" aria-label={t('Insights or AI Assist')} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idBase}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          className={`ab-halfswitch-tab ab-halfswitch-${tab.id}${value === tab.id ? ' is-on' : ''}`}
          aria-label={tab.id === 'insights' && count > 0 ? tn(count, 'Insights: {n} needs a look', 'Insights: {n} need a look') : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.id === 'assist' && <AiBadge label="" title="" />}
          {tab.label}
          {tab.id === 'insights' && count > 0 && (
            <span className="ab-halfswitch-count" aria-hidden="true">
              {count}
            </span>
          )}
          {tab.id === 'assist' && assistNote && <span className="ab-halfswitch-note">{assistNote}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The panel a half switch controls. `switched` is false where there is no switch (a screen with one half, or AI switched off): the
 * panel is then a plain pane, since a tab panel named by a tab that is not there is a broken reference for a screen reader.
 */
export function HalfPanel({ idBase, half, hidden, switched = true, children }) {
  const tabProps = switched ? { role: 'tabpanel', 'aria-labelledby': `${idBase}-tab-${half}` } : {};
  return (
    <div id={`${idBase}-panel-${half}`} {...tabProps} className="ab-pane" hidden={hidden || undefined}>
      {children}
    </div>
  );
}

/** An empty state that still helps: one line, and optionally one next step. */
export function EmptyNote({ children, action = null }) {
  return (
    <div className="ab-empty">
      <p className="ab-empty-text">{children}</p>
      {action}
    </div>
  );
}
