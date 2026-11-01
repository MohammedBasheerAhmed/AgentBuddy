import React, { useId, useState } from 'react';
import RecordLink from '../RecordLink.jsx';
import { slaText, idleText, agoText } from '../../mywork/time.js';
import { priorityRank } from '../../mywork/rank.js';

// The small pieces the My work cards share: a ticket line, a fold, the filter chips, copying a template. Styles: src/ui/areas/mywork.css.

/** The one status chip of a ticket: who it waits on, or its state. { text, tone: 'reply' | 'quiet' | 'plain' }. Pure. */
export function statusChip(item) {
  if (item.work !== 'resolved' && item.marker?.replied === 'customer') return { text: 'Customer replied', tone: 'reply' };
  if (item.work !== 'resolved' && item.marker?.replied === 'other') return { text: 'New comment', tone: 'reply' };
  if (item.work === 'waiting-customer') return { text: 'Waiting on customer', tone: 'quiet' };
  if (item.work === 'on-hold') return { text: item.holdReason ? `On hold: ${item.holdReason}` : item.state || 'On hold', tone: 'quiet' };
  if (item.work === 'resolved') return { text: item.state || 'Resolved', tone: 'quiet' };
  if (item.work === 'new') return { text: 'New', tone: 'plain' };
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
  const quiet = where === 'group' ? (item.openedAt ? `waiting ${agoText(item.openedAt, now).replace(/ ago$/, '')}` : '') : sla ? '' : idleText(item.updatedAt, now);
  const meta = [priorityShort(item.priority), where === 'group' ? item.group?.name : '', quiet].filter(Boolean).join(' · ');
  return (
    <div className="ab-mw-row">
      <RecordLink page={page} item={item} onOpen={() => onOpen(item)} className="ab-mw-link">
        <span className="ab-mw-line">
          <span className="ab-record-number">{item.number}</span>
          <span className="ab-mw-title">{item.title || 'No title'}</span>
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
    <div className="ab-mw-chips" role="group" aria-label="Filter the queue">
      {shown.map((c) => (
        <button key={c.id} type="button" className="ab-mw-filter" aria-pressed={value === c.id} onClick={() => onChange(value === c.id ? '' : c.id)}>
          {c.label} <span className="ab-mw-count">{c.count}</span>
        </button>
      ))}
      {chips.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Fewer filters' : `More filters (${chips.length - shown.length})`}
        </button>
      )}
    </div>
  );
}

/** Put text on the clipboard; true when it worked. Falls back to a hidden text area where the clipboard API is not allowed. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'ab-mw-sr';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
