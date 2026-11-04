import { useId, useState } from 'react';
import RecordLink from '../RecordLink.jsx';
import { Icon } from '../ui/icons.jsx';
import { slaText, idleText, waitingText } from '../../mywork/time.js';
import { priorityRank } from '../../mywork/rank.js';
import { isolate, t, t as tr } from '../../i18n/index.js';

// The small pieces the My work cards share: a ticket row, a list of rows with "Show all", a fold, the filter chips. (Copying a template:
// src/sidepanel/reports/download.js copyText.) Styles: src/ui/areas/mywork.css, on top of the shared rows, chips and dots (ui.css).

/** The one status chip of a ticket: who it waits on, or its state. { text, tone: 'reply' | 'quiet' | 'plain' }. Pure. */
export function statusChip(item) {
  if (item.work !== 'resolved' && item.marker?.replied === 'customer') return { text: t('Customer replied'), tone: 'reply' };
  if (item.work !== 'resolved' && item.marker?.replied === 'other') return { text: t('New comment'), tone: 'reply' };
  if (item.work === 'waiting-customer') return { text: t('Waiting on customer'), tone: 'quiet' };
  if (item.work === 'on-hold') return { text: item.holdReason ? t('On hold: {reason}', { reason: isolate(item.holdReason) }) : item.state || t('On hold'), tone: 'quiet' };
  if (item.work === 'resolved') return { text: item.state || t('Resolved'), tone: 'quiet' };
  if (item.work === 'new') return { text: t('New'), tone: 'plain' };
  return item.state ? { text: item.state, tone: 'plain' } : null;
}

// A reply is the one state chip with a colour (someone is waiting for an answer); every other state is neutral.
const CHIP = { reply: 'ab-chip-ok', quiet: 'ab-chip-neutral', plain: 'ab-chip-neutral' };

/**
 * The status dot in front of a ticket: 'danger' for a breached SLA, 'warn' for an SLA at risk, 'ok' when the customer (or someone
 * else) wrote last, 'neutral' otherwise. In place of a red border around the whole queue; the chips on the row say the same in words.
 * where: 'queue' | 'group' (nobody owns a group ticket, so nobody has been answered). Pure.
 */
export function rowDot(item, where = 'queue') {
  if (!item || item.work === 'resolved') return 'neutral';
  if (item.sla?.risk === 'breached') return 'danger';
  if (item.sla?.risk === 'at-risk') return 'warn';
  if (where !== 'group' && item.marker?.replied) return 'ok';
  return 'neutral';
}

/** "P2" for "2 - High"; '' when there is no priority. */
export const priorityShort = (display) => {
  const n = priorityRank(display);
  return n < 9 ? `P${n}` : '';
};

/**
 * One row: a status dot, then the number (mono) and the title on up to two lines, and a line of chips and facts under them. The whole
 * row is one real link (RecordLink): a plain click calls `onOpen`, Ctrl+click or the right-click menu use a new tab.
 *   item     what RecordLink opens ({ table, sysId }) and what `number` / `title` come from
 *   dot      'danger' | 'warn' | 'ok' | 'neutral'
 *   children the chips and facts of the second line
 *   after    something the row offers under its text (a quiet button), outside the link
 */
export function Row({ page, item, number, title, dot = 'neutral', onOpen, children, after = null, className = '' }) {
  return (
    <li className={`ab-mw-row${className ? ` ${className}` : ''}`}>
      <RecordLink page={page} item={item} onOpen={onOpen} className="ab-row ab-mw-link">
        <span className={`ab-dot ab-dot-${dot}`} aria-hidden="true" />
        <span className="ab-row-main">
          <span className="ab-row-title ab-mw-head">
            {number ? <span className="ab-mw-num">{number}</span> : null}
            {number ? ' ' : null}
            <span className="ab-mw-title">{title}</span>
          </span>
          {children ? <span className="ab-mw-sub">{children}</span> : null}
        </span>
      </RecordLink>
      {after}
    </li>
  );
}

/**
 * One ticket: number and title; one status chip, the SLA (or how long it has been quiet) and the priority under them.
 *   where: 'queue' | 'group' (the group queue shows the group and how long it has been waiting instead of the last update)
 */
export function TicketRow({ page, item, now, onOpen, where = 'queue' }) {
  const chip = where === 'group' ? null : statusChip(item);
  const sla = slaText(item.sla, now);
  const risk = item.sla?.risk || 'none';
  const quiet = where === 'group' ? (item.openedAt ? waitingText(item.openedAt, now) : '') : sla ? '' : idleText(item.updatedAt, now);
  const meta = [priorityShort(item.priority), where === 'group' ? item.group?.name : '', quiet].filter(Boolean).join(' · ');
  // A breached or nearly breached SLA is a chip in its colour; any other SLA time is plain text.
  const slaChip = risk === 'breached' ? ' ab-chip ab-chip-danger' : risk === 'at-risk' ? ' ab-chip ab-chip-warn' : '';
  return (
    <Row page={page} item={item} number={item.number} title={item.title || t('No title')} dot={rowDot(item, where)} onOpen={() => onOpen(item)}>
      {chip && <span className={`ab-chip ${CHIP[chip.tone]} ab-mw-state`}>{chip.text}</span>}
      {sla && <span className={`ab-mw-sla ab-mw-sla-${risk}${slaChip}`}>{sla}</span>}
      {meta && <span className="ab-mw-meta">{meta}</span>}
    </Row>
  );
}

/** The first `limit` rows, then "Show all (12)" / "Show fewer". `render(item)` draws one row (an <li>). */
export function RowList({ items, render, limit = 3 }) {
  const [all, setAll] = useState(false);
  const list = Array.isArray(items) ? items : [];
  const shown = all ? list : list.slice(0, limit);
  return (
    <>
      <ul className="ab-rows ab-mw-rows">{shown.map((item) => render(item))}</ul>
      {list.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-showmore ab-mw-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? t('Show fewer') : `${t('Show all')} (${list.length})`}
        </button>
      )}
    </>
  );
}

/** A folded group inside a card: "Waiting on the customer or others (3)", with a chevron that points down (up when open). */
export function Fold({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="ab-mw-fold">
      <button type="button" className="ab-mw-fold-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {title} ({count})
        <Icon name="chevronDown" size={16} className="ab-chevron" />
      </button>
      <div id={id} className="ab-mw-fold-body" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}

/**
 * The filter chips, each with its count. One filter at a time; pressing the chip that is on turns it off. The first `limit` chips show,
 * the rest behind "More filters" (with it, four buttons in the row: a card shows at most four at a time, TRACKER.md 2.4).
 */
export function FilterChips({ chips, value, onChange, limit = 3 }) {
  const [more, setMore] = useState(false);
  const onIndex = chips.findIndex((c) => c.id === value);
  // The chip that is on always shows, even when it is one of the folded ones.
  const shown = more ? chips : chips.filter((c, i) => i < limit || i === onIndex);
  return (
    <div className="ab-mw-chips" role="group" aria-label={t('Filter the queue')}>
      {shown.map((c) => (
        <button key={c.id} type="button" className="ab-mw-filter" aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? '' : c.id)}>
          {tr(c.label)} <span className="ab-mw-count">{c.count}</span>
        </button>
      ))}
      {chips.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-mw-filter-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? t('Fewer filters') : t('More filters ({count})', { count: chips.length - shown.length })}
        </button>
      )}
    </div>
  );
}
