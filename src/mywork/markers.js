// Who wrote last on each ticket, from the customer-visible comments. Pure.
//
// The reader (src/mywork/read.js) asks for the newest comments of a batch of tickets in one GET: only WHO wrote (sys_created_by, a
// login) and WHEN (sys_created_on), never the text. From that, for each ticket:
//   lastMineAt       my newest customer-visible comment
//   lastCustomerAt   the customer's newest one (the caller / requester / contact, matched by login), when the customer is known
//   lastOtherAt      the newest one by anybody else (a colleague; or the customer, when the ticket names none we could read)
//   lastAt           the newest one by anybody
//   replied          'customer' when the customer wrote after my last comment; 'other' when somebody else did and the ticket names
//                    no customer we could match; '' otherwise
//   since            what the read covered: entries older than this may be missing for a ticket with none in the window (the read
//                    is capped); 0 when the read was complete. `known` is false when the comments could not be read at all.
import { raw, parseSnTime } from '../context/util.js';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * @param {object[]} rows sys_journal_field rows: { element_id, sys_created_on, sys_created_by }
 * @returns {Map<string, { at: number, by: string }[]>} newest first, per ticket sys_id
 */
export function entriesByTicket(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = lower(raw(r?.element_id));
    const at = parseSnTime(raw(r?.sys_created_on));
    if (!id || !Number.isFinite(at)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ at, by: lower(raw(r?.sys_created_by)) });
  }
  for (const list of out.values()) list.sort((a, b) => b.at - a.at);
  return out;
}

/** An empty marker for a ticket whose comments could not be read. */
export const UNKNOWN_MARKER = Object.freeze({ known: false, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' });

/**
 * @param {{ at: number, by: string }[]} entries one ticket's comments, newest first
 * @param {{ me: string, customer?: string, since?: number }} who my login, the customer's login ('' when unknown), the window start
 */
export function markerFor(entries, { me, customer = '', since = 0 }) {
  const mine = lower(me);
  const them = lower(customer);
  let lastMineAt = null;
  let lastCustomerAt = null;
  let lastOtherAt = null;
  for (const e of entries || []) {
    if (mine && e.by === mine) lastMineAt = lastMineAt ?? e.at;
    else if (them && e.by === them) lastCustomerAt = lastCustomerAt ?? e.at;
    else lastOtherAt = lastOtherAt ?? e.at;
  }
  const lastAt = entries?.length ? entries[0].at : null;
  const after = (at) => at !== null && (lastMineAt === null || at > lastMineAt);
  let replied = '';
  if (after(lastCustomerAt)) replied = 'customer';
  else if (!them && after(lastOtherAt)) replied = 'other';
  return { known: true, since, lastMineAt, lastCustomerAt, lastOtherAt, lastAt, replied };
}

/**
 * The window a capped read covered: when it returned as many rows as it was allowed, entries older than its oldest row may be
 * missing; otherwise it is complete (0).
 */
export function windowStart(rows, limit) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < limit) return 0;
  let oldest = Infinity;
  for (const r of list) {
    const at = parseSnTime(raw(r?.sys_created_on));
    if (Number.isFinite(at) && at < oldest) oldest = at;
  }
  return Number.isFinite(oldest) ? oldest : 0;
}
