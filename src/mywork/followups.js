// N27 Follow-ups due: tickets where the customer is owed a word, and the text to send. Pure, no AI: the template is fixed wording
// filled from the ticket's number and title.
//
//   'replied'   the ticket was waiting on the customer and the customer answered: pick it up (no template)
//   'reminder'  waiting on the customer for N days or more since the last customer-visible comment: send a reminder
//   'update'    live work where nobody on our side (me, or a colleague such as the previous assignee) has written to the customer for
//               N days (or ever, on a ticket opened N days ago): send a status update. Only for tickets that have a customer (an
//               incident, a request, a case...).
//
// "N days" needs the comments: when they could not be read (marker.known false), nothing is claimed. When the read of comments was
// capped (marker.since > 0) a ticket with no comment in the window has had none since `since`; that proves "N days" only when
// `since` is itself N days ago.
import { hasCustomer } from './tables.js';
import { DAY, wholeDaysSince } from './time.js';
import { groupOf } from './rank.js';
import { t, tn } from '../i18n/index.js';

export const FOLLOW_UP_DAY_CHOICES = Object.freeze([2, 3, 5, 7]);
export const DEFAULT_FOLLOW_UP_DAYS = 3;

/** A follow-up period the person may choose (2, 3, 5 or 7 days); anything else is the default. */
export function cleanDays(value) {
  const n = Math.floor(Number(value));
  return FOLLOW_UP_DAY_CHOICES.includes(n) ? n : DEFAULT_FOLLOW_UP_DAYS;
}

/**
 * When the ticket last had a customer-visible word from anyone, as far as the read can tell: the newest comment; with none, the
 * window start when the read was capped (it has been quiet at least that long); with none in a complete read, the last update.
 */
function quietSince(item) {
  const m = item.marker;
  if (m.lastAt !== null && m.lastAt !== undefined) return m.lastAt;
  if (m.since) return m.since;
  return Number.isFinite(item.updatedAt) ? item.updatedAt : null;
}

/**
 * When the customer last had a word from our side: my newest comment, or a colleague's when it is newer. null for "never" (complete
 * read). A comment by somebody else is a colleague's only when it cannot be the customer's: the ticket's customer is known (then
 * their own comments are lastCustomerAt, src/mywork/markers.js customerKnown). Otherwise it may be the customer's and is not counted.
 */
function ourSince(item) {
  const m = item.marker;
  const at = (v) => (v !== null && v !== undefined ? v : null);
  const colleague = m.customerKnown ? at(m.lastOtherAt) : null;
  const newest = [at(m.lastMineAt), colleague].filter((v) => v !== null);
  if (newest.length) return Math.max(...newest);
  if (m.since) return m.since; // nothing of ours in a capped window: at least since then
  return null;
}

/**
 * @param {object[]} items the queue (src/mywork/read.js items)
 * @param {{ now: number, days?: number }} options
 * @returns {{ kind: 'replied'|'reminder'|'update', item: object, days: number, never?: boolean }[]} replied first, then the longest due
 */
export function followUps(items, { now, days = DEFAULT_FOLLOW_UP_DAYS }) {
  const n = cleanDays(days);
  const limit = now - n * DAY;
  const out = [];
  for (const item of items || []) {
    if (!item?.marker?.known || item.work === 'resolved') continue;
    const m = item.marker;
    if (item.work === 'waiting-customer') {
      if (m.replied === 'customer' || m.replied === 'other') {
        out.push({ kind: 'replied', item, days: wholeDaysSince(m.lastCustomerAt ?? m.lastOtherAt, now) });
        continue;
      }
      const quiet = quietSince(item);
      if (quiet !== null && quiet <= limit) out.push({ kind: 'reminder', item, days: wholeDaysSince(quiet, now) });
      continue;
    }
    // Live work, and tickets on hold for somebody else (the customer still wants to hear why it waits).
    if (!hasCustomer(item.type || item.table) || (groupOf(item) !== 'now' && item.work !== 'on-hold')) continue;
    const ours = ourSince(item);
    if (ours === null) {
      // Never written to the customer: due once the ticket is N days old.
      if (Number.isFinite(item.openedAt) && item.openedAt <= limit) out.push({ kind: 'update', item, days: wholeDaysSince(item.openedAt, now), never: true });
      continue;
    }
    if (ours <= limit) out.push({ kind: 'update', item, days: wholeDaysSince(ours, now) });
  }
  const rank = { replied: 0, reminder: 1, update: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.days - a.days || String(a.item.number).localeCompare(String(b.item.number)));
}

/** The reason line: "Customer replied 2 h ago", "Waiting on the customer 4 d", "Customer not updated for 5 d". */
export function followUpReason(entry) {
  // (the English forms are the same: "5 d" is one unit; Arabic names the days with their own plural forms)
  if (entry.kind === 'replied') return entry.days >= 1 ? tn(entry.days, 'Customer replied {n} d ago', 'Customer replied {n} d ago') : t('Customer replied today');
  if (entry.kind === 'reminder') return tn(entry.days, 'Waiting on the customer {n} d', 'Waiting on the customer {n} d');
  return entry.never ? tn(entry.days, 'No update to the customer in {n} d', 'No update to the customer in {n} d') : tn(entry.days, 'Customer not updated for {n} d', 'Customer not updated for {n} d');
}

const clean = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/**
 * The fixed text for a follow-up, filled from the ticket (number and title only: no names, nothing from the comments). The agent
 * copies it, reads it and pastes it into the ticket's customer-visible comment; nothing is sent or written by Agent Buddy.
 */
export function followUpText(entry) {
  const number = clean(entry.item.number, 40);
  const title = clean(entry.item.title, 120);
  const about = title ? `${number} (${title})` : number;
  // The text is written in the panel's language: it is a message to the customer, like a snippet, and the person reads it before pasting.
  if (entry.kind === 'reminder') {
    return [
      t('Hello,'),
      '',
      t('We are still waiting for your reply on {about}. Could you send us the information we asked for, or let us know if you no longer need help?', { about }),
      '',
      t('If we do not hear back from you, this ticket may be closed. You can reopen it by replying.'),
      '',
      t('Thank you.'),
    ].join('\n');
  }
  if (entry.kind === 'update') {
    return [
      t('Hello,'),
      '',
      t('A quick update on {about}: we are still working on it, and we will let you know as soon as there is news.', { about }),
      '',
      t('Thank you for your patience.'),
    ].join('\n');
  }
  return '';
}

/** The copy button's name: "Copy reminder" or "Copy status update"; '' for a ticket the customer just answered. */
export const followUpAction = (entry) => (entry.kind === 'reminder' ? t('Copy reminder') : entry.kind === 'update' ? t('Copy status update') : '');
