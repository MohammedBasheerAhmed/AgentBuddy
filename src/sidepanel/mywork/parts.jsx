import { useId, useState } from 'react';
import RecordLink from '../RecordLink.jsx';
import { slaText, idleText, waitingText } from '../../mywork/time.js';
import { priorityRank } from '../../mywork/rank.js';
import { isolate, t, t as tr } from '../../i18n/index.js';

// The small pieces the My work cards share: a ticket line, a fold, the filter chips. (Copying a template: src/sidepanel/reports/download.js
// copyText.) Styles: src/ui/areas/mywork.css.

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

/** "P2" for "2 - High"; '' when there is no priority. */
export const priorityShort = (display) => {
  const n = priorityRank(display);
  return n < 9 ? `P${n}` : '';
};

/**
 * One ticket: number and title on the first line; one status chip, the SLA (or how long it has been quiet) and the priority on the
 * second. A plain click opens it in this tab (`onOpen`); Ctrl+click or the right-click menu use a new tab (RecordLink).
 *   where: 'queue' | 'group' (the group queue shows the group and how long it has been waiting instead of the last update)
 */
export function TicketRow({ page, item, now, onOpen, where = 'queue' }) {
  const chip = where === 'group' ? null : statusChip(item);
  const sla = slaText(item.sla, now);
  const risk = item.sla?.risk || 'none';
  const quiet = where === 'group' ? (item.openedAt ? waitingText(item.openedAt, now) : '') : sla ? '' : idleText(item.updatedAt, now);
  const meta = [priorityShort(item.priority), where === 'group' ? item.group?.name : '', quiet].filter(Boolean).join(' · ');
  return (
    <div className="ab-mw-row">
      <RecordLink page={page} item={item} onOpen={() => onOpen(item)} className="ab-mw-link">
        <span className="ab-mw-line">
          <span className="ab-record-number">{item.number}</span>
          <span className="ab-mw-title">{item.title || t('No title')}</span>
        </span>
        <span className="ab-mw-line ab-mw-sub">
          {chip && <span className={`ab-mw-chip ab-mw-chip-${chip.tone}`}>{chip.text}</span>}
          {sla && <span className={`ab-mw-sla ab-mw-sla-${risk}`}>{sla}</span>}
          {meta && <span className="ab-mw-meta">{meta}</span>}
        </span>
      </RecordLink>
    </div>
  );
}

/** A folded group inside a card: "Waiting on the customer or others (3)". */
export function Fold({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="ab-mw-fold">
      <button type="button" className="ab-mw-fold-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="ab-mw-fold-chevron" aria-hidden="true" />
        {title} ({count})
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
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? t('Fewer filters') : t('More filters ({count})', { count: chips.length - shown.length })}
        </button>
      )}
    </div>
  );
}
