// The arithmetic of the weekly views (round 5, docs/round5.md), as pure functions: how a number changed against the week before, how long
// a first reply took, the closed tickets by area, and the three "Needs a decision" rules. Nothing here reads from ServiceNow; the
// reads are in ./read.js and hand these functions plain numbers.
//
// A rule of the whole round: a number the data cannot give honestly is LEFT OUT, never zero. So every function here answers `null`
// (nothing to say) rather than 0 when its input is missing, and the views draw nothing for a null.
import { entriesByTicket } from '../../mywork/markers.js';
import { mean, median } from '../engine/time.js';
import { tm } from '../engine/say.js';

export const WEEKLY_LIMITS = Object.freeze({
  // The least tickets a number is an "average" or a "typical time" of. Under this the tile is left out.
  minSample: 3,
  // "Needs a decision": one cause, load on a few people, closes without a fix note. Each shows only past its line.
  causeMin: 3, // tickets opened in the week that share one configuration item
  loadMinOpen: 10, // open tickets with an owner, at least
  loadMinPeople: 4, // owners, at least (with fewer, "2 people hold 50%" says nothing)
  loadTop: 2, // the busiest people counted together
  loadShare: 0.4, // and the share of the open tickets they hold
  notesMinClosed: 5, // closed tickets that should carry a fix note, at least
  notesMin: 3, // closed without one, at least
  notesShare: 0.2, // and the share of the closed tickets
  areasMax: 5, // bars in "where the week went", then "Other"
  oldestMax: 8, // oldest open tickets in the PDF
});

/** Logins that write comments without being a person who answered (the platform, a mail robot, an anonymous visitor). */
export const AUTOMATED_AUTHORS = Object.freeze(['system', 'guest', 'admin', 'sn_agent']);

// ---- Change against the week before --------------------------------------------------------------------------------------------

/**
 * How `now` compares with `before`: { delta, dir: 'up' | 'down' | 'same', tone: 'good' | 'bad' | 'neutral' }, or null when either is
 * not a number (no comparison is better than a made-up one).
 *   goodWhen   'up' | 'down' | null: which direction is better ("closed" up, "reopened" down, "came in" neither)
 *   tolerance  a change smaller than this counts as 'same' (a typical time that moved by 20 seconds did not move)
 */
export function change(now, before, { goodWhen = null, tolerance = 0 } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const delta = now - before;
  if (Math.abs(delta) <= tolerance) return { delta: 0, dir: 'same', tone: 'neutral' };
  const dir = delta > 0 ? 'up' : 'down';
  return { delta, dir, tone: goodWhen ? (dir === goodWhen ? 'good' : 'bad') : 'neutral' };
}

/** Two minutes or 5 %, whichever is more: below that a typical time has not changed in any way a person would notice. */
export const durationTolerance = (before) => Math.max(120000, Math.abs(Number(before) || 0) * 0.05);

/** A share in whole percent, or null when there is nothing it is a share of. */
export const percentOf = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Add up counts that must ALL have been read: { ok, value } results from attempt(). The sum when every one succeeded, else null (a total
 * that is missing a ticket type is not a total). `none`: true when there was nothing to add up.
 */
export function strictSum(results) {
  const list = (Array.isArray(results) ? results : []).filter((r) => r !== null && r !== undefined);
  if (!list.length || list.some((r) => !r.ok)) return null;
  return list.reduce((n, r) => n + (Number(r.value) || 0), 0);
}

// ---- First reply -----------------------------------------------------------------------------------------------------------------

/**
 * The first customer-visible comment on each ticket by somebody other than the customer, as the time from opening to it.
 * @param {{ sysId: string, openedAt: number, customer: string }[]} tickets  `customer` is the customer's login; a ticket without one is
 *   left out (without it a reply cannot be told from the customer's own comment)
 * @param {object[]} rows sys_journal_field rows read oldest first (element_id, sys_created_on, sys_created_by)
 * @param {{ cut?: boolean }} [options] `cut`: the read stopped at its row limit, so a ticket with no comment in the rows may have one later
 * @returns {{ times: number[], noReply: number, unknown: number, left: number }} times in ms; `noReply` tickets that had no reply (the read
 *   was complete); `unknown` tickets the read cannot say anything about (it was cut); `left` tickets left out for want of a customer login
 */
export function firstReplies(tickets, rows, { cut = false } = {}) {
  const entries = entriesByTicket(rows); // newest first: read from the end
  const out = { times: [], noReply: 0, unknown: 0, left: 0 };
  for (const ticket of tickets || []) {
    if (!ticket.customer || !Number.isFinite(ticket.openedAt)) {
      out.left += 1;
      continue;
    }
    const list = [...(entries.get(String(ticket.sysId).toLowerCase()) || [])].reverse();
    const first = list.find((e) => e.at >= ticket.openedAt && e.by && e.by !== ticket.customer && !AUTOMATED_AUTHORS.includes(e.by));
    if (first) out.times.push(first.at - ticket.openedAt);
    else if (cut && !list.length) out.unknown += 1;
    else out.noReply += 1;
  }
  return out;
}

/**
 * The average first reply of a week: { meanMs, n, of } or null when fewer than `minSample` tickets had a reply (an average of one or two
 * tickets is not an average). `of` is how many tickets could have had one.
 */
export function replySummary(found, of, minSample = WEEKLY_LIMITS.minSample) {
  if (!found || found.times.length < minSample) return null;
  return { meanMs: mean(found.times), n: found.times.length, of };
}

/** The typical (median) time to resolve of a week, in ms, or null when fewer than `minSample` tickets. */
export function typicalTime(durationsHours, minSample = WEEKLY_LIMITS.minSample) {
  const list = (durationsHours || []).filter(Number.isFinite);
  return list.length >= minSample ? median(list) * 3600000 : null;
}

// ---- Where the week went -----------------------------------------------------------------------------------------------------------

const NO_AREA = tm('No category set');
const OTHER = tm('Other');

/**
 * Closed tickets by area, biggest first: the `max` biggest, then one "Other" with the rest. Areas that are written the same (any case)
 * add up. Each entry is { name, count, plain }: `plain` is true for a word of ours (shown in the panel's language), false for the site's
 * own category. Pure.
 * @param {{ name: string, count: number, plain?: boolean }[]} items
 */
export function areaBars(items, max = WEEKLY_LIMITS.areasMax) {
  const merged = new Map();
  for (const item of items || []) {
    const count = Number(item?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const plain = item.plain === true || !String(item.name || '').trim();
    const name = String(item.name || '').trim() || NO_AREA;
    const key = `${plain ? 'p' : 's'}|${name.toLowerCase()}`;
    const entry = merged.get(key) || { name, count: 0, plain };
    entry.count += count;
    merged.set(key, entry);
  }
  const sorted = [...merged.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (sorted.length <= max + 1) return sorted;
  const rest = sorted.slice(max);
  return [...sorted.slice(0, max), { name: OTHER, count: rest.reduce((n, x) => n + x.count, 0), plain: true }];
}

// ---- Needs a decision --------------------------------------------------------------------------------------------------------------
// Three plain rules from the numbers. Each answers a decision object or null: shown ONLY when the data supports it, never a guess.

/**
 * One likely cause: the configuration item that most tickets opened in the week share, when it is at least `causeMin` of them.
 * @param {{ id: string, name: string, count: number, table?: string }[]} candidates tickets opened in the week per configuration item
 */
export function causeDecision(candidates, min = WEEKLY_LIMITS.causeMin) {
  const best = [...(candidates || [])].filter((c) => c && c.id && Number(c.count) >= min).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))[0];
  if (!best) return null;
  // (a tie at the top is not "one likely cause": the second must be clearly behind)
  const second = [...(candidates || [])].filter((c) => c && c.id && c.id !== best.id).sort((a, b) => b.count - a.count)[0];
  if (second && second.count === best.count) return null;
  return { id: 'cause', count: best.count, name: String(best.name || ''), ciId: best.id, table: best.table || '' };
}

/**
 * Load on a few people: the busiest `loadTop` hold at least `loadShare` of the open tickets that have an owner.
 * @param {number[]} perPerson open tickets per owner (one number per person, any order)
 */
export function loadDecision(perPerson, limits = WEEKLY_LIMITS) {
  const counts = (perPerson || []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);
  if (counts.length < limits.loadMinPeople || total < limits.loadMinOpen) return null;
  const top = counts.slice(0, limits.loadTop).reduce((a, b) => a + b, 0);
  if (top / total < limits.loadShare) return null;
  return { id: 'load', people: limits.loadTop, percent: Math.round((top / total) * 100), of: total };
}

/** Closes without a fix note: at least `notesMin` of the `closed` tickets, and at least `notesShare` of them. */
export function notesDecision(closed, without, limits = WEEKLY_LIMITS) {
  if (!Number.isFinite(closed) || !Number.isFinite(without) || closed < limits.notesMinClosed || without < limits.notesMin || without / closed < limits.notesShare) return null;
  return { id: 'notes', without, closed };
}

/** The decisions in their fixed order (cause, load, notes), only the ones the data supports. */
export const decisionsFrom = ({ cause = null, load = null, notes = null } = {}) => [cause, load, notes].filter(Boolean);
