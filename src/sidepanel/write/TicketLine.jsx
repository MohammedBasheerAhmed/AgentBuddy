import { useEffect, useState } from 'react';
import { read } from '../ask.js';
import { ticketLabel } from '../../compose/ticketLabel.js';
import { t } from '../../i18n/index.js';

// "For INC0012345 – VPN keeps disconnecting": the line at the top of each Write half, so it is always clear which ticket a snippet is
// filled from, which form a check reads and where a rewrite goes. The title comes from the record's header read (number, title,
// state, priority: the same small read the Ticket screen makes), once per record and only while the half is on show.

/**
 * The open record's header ({ number, short_description }), or null while unknown. Read again when another record opens.
 * `allowSensitive`: the organisation allows HR content (eff.policy.allowHrContent), as for every other read; without it the title of an
 * HR or other sensitive record is not read (src/content/header.js) and the line shows the number only.
 */
export function useTicketHeader(page, active, allowSensitive = false) {
  const record = page?.record;
  const key = record?.table && record?.sysId ? `${record.table}:${record.sysId}:${allowSensitive ? 'hr' : ''}` : '';
  const [state, setState] = useState({ key: '', header: null });
  useEffect(() => {
    if (!active || !key || state.key === key) return undefined;
    let cancelled = false;
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId, allowSensitive })
      .then((header) => !cancelled && setState({ key, header: header && typeof header === 'object' ? header : null }))
      .catch(() => !cancelled && setState({ key, header: null }));
    return () => {
      cancelled = true;
    };
    // The record's identity decides when to read; the page object changes on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, page?.tabId]);
  return state.key === key ? state.header : null;
}

export default function TicketLine({ page, header }) {
  const label = ticketLabel(page, header);
  return (
    <p className={`ab-write-for ab-write-for-${label.kind}`} aria-live="polite">
      {label.kind === 'none' ? `${label.text} ${t('Open one to fill in its details.')}` : label.text}
    </p>
  );
}
