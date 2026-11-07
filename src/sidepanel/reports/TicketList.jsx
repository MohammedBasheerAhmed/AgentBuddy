import { useState } from 'react';
import { isPlainClick, NEW_TAB_HINT } from '../linkClick.js';
import { t } from '../../i18n/index.js';

/**
 * A short list of tickets, easy to scan at 400 px: rows parted by dividers, the number (a real link to the record) and the title on
 * up to two lines, a few plain facts under them ("Breached 2 h ago · Ann Lee · 1 - Critical"). The first `limit` are shown, then
 * "Show all (8)".
 * Replaces the label/value tables the SLA radar and the hand-over drew, which a lead had to read cell by cell.
 *
 *   caption   the list's name (heading for screen readers and the eye)
 *   label     the list's name for screen readers only, when it sits under a fold that already shows the title
 *   items     [{ table, sysId, number, title, ... }]
 *   meta      (item) => string[]: the facts on the second line, empty ones dropped
 *   env       the dashboard env: openTicket(ref) and ticketHref(ref)
 *   empty     the line shown when there is nothing (useful, not blank)
 */
export default function TicketList({ caption, label, items, meta, env, limit = 3, empty = t('Nothing to show.') }) {
  const [all, setAll] = useState(false);
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.number);
  if (!list.length) return <p className="ab-tlist-empty">{empty}</p>;
  const shown = all ? list : list.slice(0, limit);
  return (
    <div className="ab-tlist-wrap">
      {caption && <h3 className="ab-tlist-caption">{caption}</h3>}
      <ul className="ab-tlist" aria-label={caption || label || undefined}>
        {shown.map((item) => {
          const ref = item.table && item.sysId ? { table: item.table, sysId: item.sysId } : null;
          const href = ref && env?.ticketHref ? env.ticketHref(ref) || '' : '';
          const facts = (meta ? meta(item) : []).filter(Boolean);
          return (
            <li key={`${item.table || ''}:${item.sysId || item.number}`} className="ab-tlist-row">
              <span className="ab-tlist-line">
                {ref && href ? (
                  <a
                    className="ab-chart-link ab-tlist-number"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-ab-link="record"
                    title={t(NEW_TAB_HINT)}
                    onClick={(event) => {
                      if (!isPlainClick(event)) return;
                      event.preventDefault();
                      env.openTicket(ref);
                    }}
                  >
                    {item.number}
                  </a>
                ) : ref && env?.openTicket ? (
                  <button type="button" className="ab-chart-link ab-tlist-number" onClick={() => env.openTicket(ref)}>
                    {item.number}
                  </button>
                ) : (
                  <span className="ab-tlist-number">{item.number}</span>
                )}
                {item.title ? ' ' : null}
                {item.title ? <span className="ab-tlist-title">{item.title}</span> : null}
              </span>
              {facts.length > 0 && <span className="ab-tlist-meta">{facts.join(' · ')}</span>}
            </li>
          );
        })}
      </ul>
      {list.length > limit && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-showmore" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t('Show fewer') : t('Show all ({n})', { n: list.length })}
        </button>
      )}
    </div>
  );
}
