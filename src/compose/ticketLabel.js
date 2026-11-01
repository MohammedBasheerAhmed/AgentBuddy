// Which ticket a Write tool is working on, in one line: "For INC0012345 – VPN keeps disconnecting". A snippet is filled from that
// ticket, a check reads its form, a rewrite goes back into it; saying so up front means nobody wonders which ticket they are on.
// Pure: the panel passes in what the page said about the record and the header it read.

const MAX_TITLE = 70;
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const DASH = String.fromCharCode(0x2013); // an en dash, written as a code so this file stays plain ASCII

/**
 * @param {{ record?: { table?: string, number?: string } | null, newRecord?: { table?: string } | null }} page
 * @param {{ number?: string, short_description?: string } | null} [header] the record's header read (may still be loading)
 * @returns {{ kind: 'record' | 'new' | 'none', text: string, number: string }}
 *   record: "For INC0012345 – title" (the title is left out while unknown); new: "For a new incident form"; none: no ticket open
 */
export function ticketLabel(page, header = null) {
  const record = page?.record;
  if (record && (record.number || record.table)) {
    const number = oneLine(record.number || header?.number || '').slice(0, 40) || oneLine(record.table).slice(0, 40);
    let title = oneLine(header?.short_description);
    if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1).trimEnd()}...`;
    return { kind: 'record', number, text: title ? `For ${number} ${DASH} ${title}` : `For ${number}` };
  }
  const table = oneLine(page?.newRecord?.table);
  if (table) return { kind: 'new', number: '', text: `For a new ${table.replace(/^sn_customerservice_/, '').replace(/_/g, ' ')} form` };
  return { kind: 'none', number: '', text: 'No ticket is open.' };
}
