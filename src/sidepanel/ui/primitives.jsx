import React, { useId, useState } from 'react';

// Small building blocks every screen uses, so the panel looks and behaves the same everywhere (TRACKER.md 2.3 and 2.4):
//   AiBadge       the one mark every AI element carries (never an Insights element)
//   CardFrame     a card with a title that folds open and closed, a one-line summary when folded, an optional attention level
//   ShowMore      the first few items, then "Show all (12)"
//   HalfRule      the one line under the Insights / AI Assist switch that says where data goes
// Styles: src/ui/areas/shell.css.

/** The AI mark: a small spark and the letters "AI". Decorative where the text next to it already says AI. */
export function AiBadge({ label = 'AI', title = 'Uses AI. Masked text goes to the AI you chose, after a preview.' }) {
  return (
    <span className="ab-ai-badge" title={title}>
      <svg className="ab-ai-spark" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M6 0.5 L7.2 4.8 L11.5 6 L7.2 7.2 L6 11.5 L4.8 7.2 L0.5 6 L4.8 4.8 Z" fill="currentColor" />
      </svg>
      {label}
    </span>
  );
}

/** The shield mark that replaces the footer sentence: the privacy promise, said once, on hover and for screen readers. */
export function ShieldMark() {
  const text = 'Reads with your own ServiceNow session. Personal data is masked before any AI call. Nothing is written to ServiceNow.';
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
 * A card whose title folds it open and closed.
 *   title      the card's name (a noun: "Related tickets")
 *   summary    one short line shown next to the title, open or folded ("10 earlier · 5 open"); '' for none
 *   attention  '' | 'warn' | 'danger': a coloured edge and dot, for a card that needs a look (an outage, a breached SLA)
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
          <span className="ab-cardx-chevron" aria-hidden="true" />
          <span className="ab-cardx-title">{title}</span>
          {summary && <span className="ab-cardx-summary">{summary}</span>}
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
export function ShowMore({ items, render, limit = 3, more = 'Show all', less = 'Show fewer', className = 'ab-list' }) {
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
        <span>{destination ? `Masked text goes to ${destination}. You see it first.` : 'Masked text goes to the AI you choose. You see it first.'}</span>
      </p>
    );
  }
  return (
    <p className="ab-halfrule ab-halfrule-insights">
      <ShieldMark />
      <span>Stays in ServiceNow. Nothing is sent anywhere.</span>
    </p>
  );
}

/**
 * The Insights / AI Assist switch under a screen's title. A screen with one half draws no switch (pass `assist={false}`).
 *   value: 'insights' | 'assist'; onChange(next); idBase: unique per screen (for the tab and panel ids)
 *   assistNote: a few words after "AI Assist" when it cannot be used as is ("off", "set up")
 */
export function HalfSwitch({ value, onChange, idBase, assist = true, assistNote = '' }) {
  if (!assist) return null;
  const tabs = [
    { id: 'insights', label: 'Insights' },
    { id: 'assist', label: 'AI Assist' },
  ];
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'insights' : e.key === 'End' ? 'assist' : value === 'insights' ? 'assist' : 'insights';
    onChange(next);
    e.currentTarget.querySelector(`#${idBase}-tab-${next}`)?.focus();
  };
  return (
    <div className="ab-halfswitch" role="tablist" aria-label="Insights or AI Assist" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${idBase}-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`${idBase}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={`ab-halfswitch-tab ab-halfswitch-${t.id}${value === t.id ? ' is-on' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.id === 'assist' && <AiBadge label="" title="" />}
          {t.label}
          {t.id === 'assist' && assistNote && <span className="ab-halfswitch-note">{assistNote}</span>}
        </button>
      ))}
    </div>
  );
}

/** The panel a half switch controls. */
export function HalfPanel({ idBase, half, hidden, children }) {
  return (
    <div id={`${idBase}-panel-${half}`} role="tabpanel" aria-labelledby={`${idBase}-tab-${half}`} className="ab-pane" hidden={hidden || undefined}>
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
