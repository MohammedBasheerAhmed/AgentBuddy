// Ordering, grouping and filtering My work's lists. Pure: everything takes plain items (src/mywork/read.js) and `now`.
//
// An item: { table, sysId, number, title, priority, state, work ('open'|'new'|'waiting-customer'|'on-hold'|'resolved'), holdReason,
//            updatedAt, openedAt, ci: { id, name } | null, sla: null | { breached, paused, percentage, dueAt, risk }, marker: {...},
//            atRisk?: [reasons] } (atRisk: set by src/mywork/risk.js withRisk in the panel; without it no ticket is "at risk")
//
// The groups of the queue:
//   'now'       waiting on you: live work, and anything the customer answered (even a ticket still marked "on hold")
//   'waiting'   on hold, waiting on the customer or on somebody else
//   'resolved'  resolved but still active (the base incident and case stay active until they auto-close)
import { pluralOf } from './tables.js';
import { tm } from '../i18n/core.js';

/** ServiceNow priority 1 (critical) to 5 (planning), from its display text ("2 - High"); 9 when there is none. */
export function priorityRank(display) {
  const n = parseInt(String(display ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 9;
}

/** Did someone (the customer, or someone else when no customer is known) write after my last customer-visible comment? */
export const hasReply = (item) => Boolean(item?.marker?.replied);

/** Is the ticket one of the few that cost the most time (src/mywork/risk.js names why)? Never a resolved one. */
export const isAtRisk = (item) => Array.isArray(item?.atRisk) && item.atRisk.length > 0 && item.work !== 'resolved';

// At risk first: 0 for a ticket at risk, 1 for the rest. It decides before anything else inside a group (see compareNow).
const band = (item) => (isAtRisk(item) ? 0 : 1);

/** Which group of the queue an item belongs to. */
export function groupOf(item) {
  if (item.work === 'resolved') return 'resolved';
  if (hasReply(item)) return 'now';
  if (item.work === 'waiting-customer' || item.work === 'on-hold') return 'waiting';
  return 'now';
}

// Tier within "waiting on you": smaller = sooner.
function tier(item) {
  const risk = item.sla?.risk || 'none';
  if (risk === 'breached') return 0;
  if (risk === 'at-risk') return 1;
  if (hasReply(item)) return 2;
  return 3;
}

// SLA order inside a tier: a running SLA by the time it has left, then paused ones, then tickets with none.
function slaKey(item, now) {
  const s = item.sla;
  if (!s) return 3e15;
  if (s.paused && !s.breached) return 2e15;
  return s.dueAt === null || s.dueAt === undefined ? 1e15 : s.dueAt - now;
}

const idle = (item, now) => (Number.isFinite(item.updatedAt) ? now - item.updatedAt : 0);

/**
 * "Waiting on you", most urgent first. Tickets at risk come first (src/mywork/risk.js); inside each of the two bands the order is
 * the one My work always had: breached SLA, then SLA at risk (75 % used or under 2 hours left), then tickets the customer answered,
 * then the rest. Inside the first two: the least time left first. Inside the others: priority, then the SLA that ends soonest (paused
 * ones after running ones), then the ticket nobody touched for longest.
 * A breached or nearly breached SLA is itself a reason to be at risk, so those tickets always lead the first band; in effect the
 * order is: breached, SLA at risk, at risk and answered, at risk, answered, the rest. Without risk reasons (the page script ranks
 * before the panel adds them) the bands are one and the order is the old one.
 */
export function compareNow(a, b, now) {
  const ba = band(a);
  const bb = band(b);
  if (ba !== bb) return ba - bb;
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta <= 1) {
    const d = slaKey(a, now) - slaKey(b, now);
    if (d) return d;
    return priorityRank(a.priority) - priorityRank(b.priority) || idle(b, now) - idle(a, now) || String(a.number).localeCompare(String(b.number));
  }
  if (ta === 2) {
    const ra = a.marker?.lastCustomerAt ?? a.marker?.lastOtherAt ?? 0;
    const rb = b.marker?.lastCustomerAt ?? b.marker?.lastOtherAt ?? 0;
    return priorityRank(a.priority) - priorityRank(b.priority) || ra - rb || String(a.number).localeCompare(String(b.number));
  }
  const p = priorityRank(a.priority) - priorityRank(b.priority);
  if (p) return p;
  const s = slaKey(a, now) - slaKey(b, now);
  if (s) return s;
  return idle(b, now) - idle(a, now) || String(a.number).localeCompare(String(b.number));
}

// Waiting: the one that has waited longest first (the first to chase). Resolved: the oldest first.
const waitedSince = (item) => item.marker?.lastAt ?? item.updatedAt ?? 0;

/** The queue in its three groups, each in its own order (in "waiting" too, the tickets at risk first). */
export function groupQueue(items, now) {
  const out = { now: [], waiting: [], resolved: [] };
  for (const item of items || []) out[groupOf(item)].push(item);
  out.now.sort((a, b) => compareNow(a, b, now));
  out.waiting.sort((a, b) => band(a) - band(b) || waitedSince(a) - waitedSince(b) || String(a.number).localeCompare(String(b.number)));
  out.resolved.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0) || String(a.number).localeCompare(String(b.number)));
  return out;
}

/** The whole queue in one ranked list (now, then waiting, then resolved). */
export function rankQueue(items, now) {
  const g = groupQueue(items, now);
  return [...g.now, ...g.waiting, ...g.resolved];
}

// ---- the unassigned queue of my groups ---------------------------------------------------------------------------------------------

// 0 for an SLA that has run out, 1 for one that is nearly used up, 2 for the rest (running well, paused, or none to show).
const slaTier = (item) => ({ breached: 0, 'at-risk': 1 })[item?.sla?.risk] ?? 2;

// A ticket on hold or pending cannot be worked now: ready work goes first (0), waiting work after it (1).
const readiness = (item) => (item?.work === 'waiting-customer' || item?.work === 'on-hold' ? 1 : 0);

/**
 * The order of the tickets nobody has picked up yet (audit of 2026-11-07, F17): what a person who is looking for work should take first.
 * An SLA that has run out, then one that is nearly used up, then (inside the same SLA state) work that is ready before work that is on
 * hold or pending, then the more urgent priority, then the one that has waited longest, then the number. Only columns My work already
 * reads: the SLA (src/mywork/sla.js), the state, the priority and the opening time. Without an SLA read (the first ordering, before the
 * SLAs are known) the SLA state is the same for every ticket and the order is readiness, priority, age.
 */
export function compareGroupQueue(a, b) {
  return (
    slaTier(a) - slaTier(b) ||
    readiness(a) - readiness(b) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    (Number.isFinite(a.openedAt) ? a.openedAt : Infinity) - (Number.isFinite(b.openedAt) ? b.openedAt : Infinity) ||
    String(a.number).localeCompare(String(b.number))
  );
}

/** The unassigned tickets in the order of compareGroupQueue (a new array). */
export const rankGroupQueue = (items) => [...(items || [])].sort(compareGroupQueue);

// ---- filters ------------------------------------------------------------------------------------------------------------------

/** Does an item pass the filter chip `id` ('' = no filter)? */
export function passes(item, id) {
  if (!id) return true;
  const [dim, value] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (dim === 'type') return (item.type || item.table) === value;
  if (dim === 'prio') return String(priorityRank(item.priority)) === value;
  if (dim === 'ci') return item.ci?.id === value;
  if (dim === 'status') {
    if (value === 'risk') return isAtRisk(item);
    if (value === 'replied') return hasReply(item) && item.work !== 'resolved';
    if (value === 'waiting') return groupOf(item) === 'waiting';
    if (value === 'breached') return item.sla?.risk === 'breached';
    if (value === 'due') return item.sla?.risk === 'at-risk';
  }
  return false;
}

/**
 * The filter chips with their counts, only the ones that would show something: "At risk 3" first (the tickets the person wants
 * first), "SLA breached 2", "SLA at risk 1", "Customer replied 3", "On hold 4", then "P1 2", "P2 5", then the types when there is
 * more than one ("Incidents 12", "Catalog tasks 8").
 * @returns {{ id: string, label: string, count: number }[]}
 */
export function filterChips(items, { classNames = {} } = {}) {
  const list = items || [];
  const count = (id) => list.filter((i) => passes(i, id)).length;
  const chips = [
    { id: 'status:risk', label: tm('At risk') },
    { id: 'status:breached', label: tm('SLA breached') },
    { id: 'status:due', label: tm('SLA at risk') },
    { id: 'status:replied', label: tm('Replied') },
    { id: 'status:waiting', label: tm('On hold') },
    { id: 'prio:1', label: tm('P1') },
    { id: 'prio:2', label: tm('P2') },
  ].map((c) => ({ ...c, count: count(c.id) }));
  const types = [...new Set(list.map((i) => i.type || i.table))];
  if (types.length > 1) {
    types
      .map((type) => ({ id: `type:${type}`, label: pluralOf(type, classNames[type]), count: count(`type:${type}`) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .forEach((c) => chips.push(c));
  }
  return chips.filter((c) => c.count > 0);
}

// ---- several of my tickets on one CI ------------------------------------------------------------------------------------------

/** Several of my open tickets on the same configuration item may be one cause. [{ id, name, count, numbers }], most first. */
export function sharedCis(items, { min = 3 } = {}) {
  const by = new Map();
  for (const item of items || []) {
    if (!item.ci?.id || item.work === 'resolved') continue;
    const entry = by.get(item.ci.id) || { id: item.ci.id, name: item.ci.name || tm('one configuration item'), count: 0, numbers: [] };
    entry.count += 1;
    entry.numbers.push(item.number);
    by.set(item.ci.id, entry);
  }
  return [...by.values()].filter((e) => e.count >= min).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
