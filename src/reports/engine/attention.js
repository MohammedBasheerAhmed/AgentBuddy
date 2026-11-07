// "Needs attention now": the few tickets that most need a team lead, each with ONE reason, at the top of the Team overview.
//
// It is composed from what the other sections already read, by the same functions they use (readSlaTickets, summarizeReassigned,
// summarizeAgeing, summarizeWaiting, summarizeOldest...), so a number here can never differ from the one in its own section. It asks
// for no table and no column the Team screen does not already read; the questions are worded in one place (liveQuestions in
// workload.js, readWaitingAndOldest in handover.js), so when the Workload and the Shift handover are on the same dashboard one cached
// request serves them all.
//
// The reasons, strongest first (the order of the rows):
//   breached    a ticket with a breached SLA                                   (the SLA section's Breached)
//   closest     not breached, but an SLA is nearly used up or due soon         (its "closest to breaking")
//   approval    waits for an approval, for a few days                          (the hand-over's "On an approval")
//   reassigned  handed over 3+ times                                           (the Workload's "Tickets reassigned 3+ times")
//   oldest      open for 15+ days                                              (the Workload's last ageing bucket)
//   customer    waits for the customer, for a few days                         (the hand-over's "On the customer")
// A ticket is ONE row, under its strongest reason; its other reasons are a count. At most ATTENTION_MAX rows.
//
// Honest by construction (rule 9): `complete` is false when any source could not be read in full (a refused or failed read, an SLA read
// that stopped early, a ticket type that could not be counted); the panel then says so and never says "Nothing needs attention". The
// number of tickets behind the rows (`total`) is a lower bound ("at least") whenever a list is only a sample of its reason.
import { AGE_BUCKETS, LIMITS } from './constants.js';
import { tm } from './say.js';
import { t, tn } from '../../i18n/core.js';
import { andQuery, readOpenStates, sectionResult, usableTables } from './common.js';
import { readSlaTickets } from './sla.js';
import { readLive, summarizeAgeing, summarizeReassigned } from './workload.js';
import { readWaitingAndOldest, summarizeOldest, summarizeWaiting, summarizeWaitingKind } from './handover.js';
import { DAY } from './time.js';

export const ATTENTION_MAX = 8;
/** The reasons, strongest first. */
export const ATTENTION_REASONS = Object.freeze(['breached', 'closest', 'approval', 'reassigned', 'oldest', 'customer']);
/** A ticket waiting for an approval or the customer is on the list once it has been open this many days (the "no update" days). */
export const WAIT_MIN_DAYS = LIMITS.staleDays;
/** "Oldest": open at least as long as the last ageing bucket (15+ days) starts. */
export const OLDEST_MIN_DAYS = AGE_BUCKETS[AGE_BUCKETS.length - 1].from;

// ---- The words of a reason (the panel and the export say the same thing) ----------------------------------------------------------------

/** One reason as words, for a row: `{ reason, facts }` -> 'Breached', 'Reassigned 5 times'... (translated where it is drawn). */
export function reasonLabel(reason, facts = {}) {
  switch (reason) {
    case 'breached':
      return t('Breached');
    case 'closest':
      return t('Closest to breaking');
    case 'approval':
      return t('Waiting for approval');
    case 'reassigned':
      return tn(Number(facts.n) || 0, 'Reassigned {n} time', 'Reassigned {n} times');
    case 'oldest':
      return t('Oldest open');
    case 'customer':
      return t('Customer waiting');
    default:
      return '';
  }
}

// ---- The sources: one per reason, in one shape -----------------------------------------------------------------------------------------
// { ok, population, atLeast, listedAll, items }
//   ok          the source was read (a number of tickets and the tickets behind it)
//   population  how many tickets the source's own section counts for this reason (null when it could not be read)
//   atLeast     that number is a lower bound (a read stopped early, or a ticket type could not be counted)
//   listedAll   every ticket of the population is among `items` (so nothing for this reason is missing from the rows' pool)
//   items       the tickets to choose rows from, in the source's own order: { sysId, table, number, title, priority, owner, group, facts }

const slaItem = (x) => ({
  sysId: x.sysId,
  table: x.table,
  number: x.number,
  title: x.title,
  priority: x.priority,
  owner: x.owner,
  group: x.group,
  facts: { breached: Boolean(x.breached), percent: x.sla?.percentage ?? 0, plannedEnd: x.sla?.plannedEnd || '', endMs: x.endMs ?? null, paused: Boolean(x.sla?.paused) },
});
const reassignedItem = (x) => ({ sysId: x.sysId, table: x.table, number: x.number, title: x.title, priority: '', owner: x.owner, group: x.group, facts: { n: x.reassignments } });
const listItem = (x) => ({ sysId: x.sysId, table: x.table, number: x.number, title: x.title, priority: x.priority, owner: x.owner, group: x.group, facts: { ageDays: x.ageDays, state: x.state, statePlain: Boolean(x.statePlain) } });

const unread = { ok: false, population: null, atLeast: false, listedAll: false, items: [] };

/**
 * The six sources from what the sections' own functions return. Pure.
 * @param {{ sla: object, reassigned: object, ageing: object, waiting: object, approval: object, customer: object, oldest: object, now: number }} input
 *   sla       readSlaTickets()'s answer
 *   reassigned  summarizeReassigned(), ageing  summarizeAgeing()
 *   waiting   summarizeWaiting() (the totals), approval / customer  summarizeWaitingKind()
 *   oldest    { items: summarizeOldest(), failed }
 */
export function attentionSources({ sla, reassigned, ageing, waiting, approval, customer, oldest, now }) {
  const out = {};

  // ---- SLA: breached and closest to breaking, from one read
  const snap = sla.snap;
  if (snap.ok) {
    const breachedItems = sla.known.filter((x) => x.breached).map(slaItem);
    const closestItems = sla.known.filter((x) => !x.breached).map(slaItem);
    // A failed lookup of the ticket details leaves tickets without a number: they are counted, not listed, so the read is incomplete.
    const read = !sla.failure;
    const breached = snap.counts.breached;
    const closest = snap.tickets.length - breached;
    out.breached = { ok: read, population: breached, atLeast: snap.atLeast === true, listedAll: breachedItems.length >= breached, items: breachedItems };
    out.closest = { ok: read, population: closest, atLeast: snap.atLeast === true, listedAll: closestItems.length >= closest, items: closestItems };
  } else {
    out.breached = { ...unread };
    out.closest = { ...unread };
  }

  // ---- A wait for an approval or for the customer: the totals are exact counts of states; the rows are the old ones
  const waits = (kind, found) => {
    const ok = waiting.statesOk && !found.failed;
    const population = waiting.statesOk ? waiting.sumKind(kind) : null;
    const old = found.items.filter((x) => Number.isFinite(x.ageDays) && x.ageDays >= WAIT_MIN_DAYS).map(listItem);
    return { ok, population, atLeast: waiting.partial || waiting.listsPartial, listedAll: ok && found.items.length >= population, items: old };
  };
  out.approval = waits('approval', approval);
  out.customer = waits('customer', customer);

  // ---- Handed over often
  out.reassigned = reassigned.available
    ? { ok: !reassigned.listPartial, population: reassigned.count, atLeast: reassigned.partial, listedAll: !reassigned.listPartial && reassigned.items.length >= reassigned.count, items: reassigned.items.map(reassignedItem) }
    : { ...unread };

  // ---- Open longest: the last ageing bucket is the count; the oldest open tickets are the rows
  const oldItems = oldest.items.filter((x) => Number.isFinite(x.openedMs) && x.openedMs > 0 && now - x.openedMs >= OLDEST_MIN_DAYS * DAY).map(listItem);
  const known = ageing.byTable.length > 0;
  const bucket = known ? ageing.buckets[ageing.buckets.length - 1].count : null;
  out.oldest = known
    ? { ok: !oldest.failed, population: bucket, atLeast: ageing.left > 0, listedAll: !oldest.failed && oldItems.length >= bucket, items: oldItems }
    : { ...unread };
  return out;
}

// ---- Composing the rows ---------------------------------------------------------------------------------------------------------------

const BASE = ['sysId', 'table', 'number', 'title', 'priority', 'owner', 'group'];

/**
 * Choose and order the rows. One row per ticket, under its strongest reason (ATTENTION_REASONS is the order), the other reasons it was
 * found under as a count; at most `limit` rows. Also says how many tickets stand behind the rows and whether that is exact.
 * Pure: the same sources always give the same rows.
 */
export function composeAttention(sources, { limit = ATTENTION_MAX } = {}) {
  const byTicket = new Map();
  for (const reason of ATTENTION_REASONS) {
    for (const item of sources[reason].items) {
      if (!item.sysId || !item.number) continue;
      const entry = byTicket.get(item.sysId) || { ...Object.fromEntries(BASE.map((k) => [k, ''])), reasons: [], facts: {} };
      // The first source to name a ticket gives its words; a later one fills what the first did not have (a hand-off row has no priority).
      BASE.forEach((k) => {
        if (!entry[k] && item[k]) entry[k] = item[k];
      });
      entry.reasons.push(reason);
      entry.facts[reason] = item.facts;
      byTicket.set(item.sysId, entry);
    }
  }
  const pool = [...byTicket.values()];
  const rows = pool.slice(0, limit).map((e) => ({ ...e, reason: e.reasons[0], more: e.reasons.length - 1 }));

  // Missing: a source that was not read in full. Incomplete means "do not call a short list the whole truth".
  const missing = ATTENTION_REASONS.filter((r) => !sources[r].ok || sources[r].atLeast);
  const counts = Object.fromEntries(
    ATTENTION_REASONS.map((r) => [r, { ok: sources[r].ok, population: sources[r].population, atLeast: sources[r].atLeast, listed: sources[r].items.length, listedAll: sources[r].listedAll }])
  );

  // How many tickets stand behind the rows: at least every distinct ticket listed, and at least each source's own count. Exact only when
  // every reason is read in full AND listed in full. (An approval or a customer waiting less than WAIT_MIN_DAYS is not a reason yet, so
  // the two waiting counts never lift the total; they are exact only through `listedAll`.)
  const lifts = ['breached', 'closest', 'reassigned', 'oldest'].map((r) => (Number.isFinite(sources[r].population) ? sources[r].population : 0));
  const total = Math.max(pool.length, ...lifts);
  const exact = missing.length === 0 && ATTENTION_REASONS.every((r) => sources[r].listedAll);
  return {
    available: true,
    limit,
    rows,
    shown: rows.length,
    total,
    // "of at least 17": the rows are the top of a list whose size is only known from below
    totalAtLeast: !exact,
    // Every source was read in full. When false the panel says "Based on what you can see; some data could not be read", and a short
    // or empty list is never called "nothing needs attention".
    complete: missing.length === 0,
    missing,
    counts,
    waitMinDays: WAIT_MIN_DAYS,
    oldestMinDays: OLDEST_MIN_DAYS,
  };
}

// ---- Proving the numbers ------------------------------------------------------------------------------------------------------------

/**
 * Do the numbers of a Needs-attention result agree with its sources? Returns { ok, problems: string[] }. Pure.
 *   - each reason's count is its source's count, and its listed tickets are the source's
 *   - a ticket is one row; the rows are in order of their strongest reason; a row's reasons are the sources it was found in
 *   - never more rows than the limit; the total is not below the rows or any count
 */
export function reconcileAttention(data, sources, { limit = ATTENTION_MAX } = {}) {
  const problems = [];
  const say = (text) => problems.push(text);
  if (!data || !data.available) return { ok: false, problems: ['no result'] };
  ATTENTION_REASONS.forEach((r) => {
    const c = data.counts?.[r];
    const s = sources[r];
    if (!c || !s) return say(`${r}: missing`);
    if (c.population !== s.population) say(`${r}: count ${c.population} is not the source's ${s.population}`);
    if (c.listed !== s.items.length) say(`${r}: ${c.listed} listed, the source lists ${s.items.length}`);
    if (c.atLeast !== s.atLeast || c.ok !== s.ok) say(`${r}: the honesty flags differ from the source`);
  });
  if (data.rows.length > limit) say(`${data.rows.length} rows, more than ${limit}`);
  if (data.shown !== data.rows.length) say('shown is not the number of rows');
  const seen = new Set();
  let last = -1;
  data.rows.forEach((row) => {
    if (seen.has(row.sysId)) say(`${row.number} is in two rows`);
    seen.add(row.sysId);
    const found = ATTENTION_REASONS.filter((r) => sources[r].items.some((i) => i.sysId === row.sysId));
    if (found.join() !== row.reasons.join()) say(`${row.number}: reasons ${row.reasons.join('+')} are not the sources' ${found.join('+')}`);
    if (row.reason !== found[0]) say(`${row.number}: its row is not under its strongest reason`);
    if (row.more !== found.length - 1) say(`${row.number}: "${row.more} more" is not ${found.length - 1}`);
    const at = ATTENTION_REASONS.indexOf(row.reason);
    if (at < last) say(`${row.number}: out of order`);
    last = Math.max(last, at);
  });
  // A row that is missing though a stronger ticket was left out: the rows must be the head of the severity order.
  const order = [];
  ATTENTION_REASONS.forEach((r) => sources[r].items.forEach((i) => i.sysId && i.number && !order.includes(i.sysId) && order.push(i.sysId)));
  if (data.rows.map((r) => r.sysId).join() !== order.slice(0, limit).join()) say('the rows are not the first tickets in order of reason');
  const lifts = ['breached', 'closest', 'reassigned', 'oldest'].map((r) => (Number.isFinite(sources[r].population) ? sources[r].population : 0));
  if (data.total < Math.max(order.length, ...lifts)) say('the total is below the tickets it stands for');
  if (data.complete !== ATTENTION_REASONS.every((r) => sources[r].ok && !sources[r].atLeast)) say('complete does not follow the sources');
  return { ok: problems.length === 0, problems };
}

/**
 * Does each count in a Needs-attention result equal the count of the same tickets in the section it came from? The sections' own
 * results (`.data`) go in; the differences come out as sentences ([] when they agree). Pure. This is what a lead's trust rests on: the
 * number here is the number there, and a ticket is not counted twice.
 *   breached     the Overview's Breached tile, the SLA radar's, the hand-over's
 *   closest      the radar's tickets at issue less its breached (a ticket can be both at risk and due soon, so NOT at risk + due soon)
 *   reassigned   the Workload's "reassigned 3+ times"; the tickets are its list
 *   oldest       the Workload's last ageing cell; the tickets are the hand-over's oldest open
 *   approval, customer   the hand-over's "On an approval" and "On the customer"
 * @param {object} data a Needs-attention result's data
 * @param {{ overview?: object, sla?: object, workload?: object, handover?: object }} sections their results' data
 */
export function reconcileWithSections(data, { overview, sla, workload, handover } = {}) {
  const problems = [];
  const same = (what, ours, theirs) => {
    if (ours !== theirs) problems.push(`${what}: ${ours === null ? 'not read' : ours} here, ${theirs === null ? 'not read' : theirs} there`);
  };
  const c = data.counts;
  const numberOf = (reason) => data.rows.filter((r) => r.reasons.includes(reason));

  if (sla?.available) {
    same('breached (SLA radar)', c.breached.population, sla.counts.breached);
    same('closest to breaking (SLA radar)', c.closest.population, sla.ticketsAtIssue - sla.counts.breached);
    same('breached + closest (tickets at issue)', c.breached.population + c.closest.population, sla.ticketsAtIssue);
    // the rows are the radar's first tickets, in its order (Closest to breaking shows ten)
    const top = sla.top.map((x) => x.number);
    ['breached', 'closest'].forEach((reason) =>
      numberOf(reason).forEach((r) => {
        if (r.reason === reason && !top.includes(r.number)) problems.push(`${r.number} is a "${reason}" row but not in the SLA radar's list`);
      })
    );
    sla.top.forEach((x) => {
      const row = data.rows.find((r) => r.number === x.number);
      const ours = row ? row.reasons.includes('breached') : null;
      if (row && ours !== Boolean(x.breached) && (row.reasons.includes('breached') || row.reasons.includes('closest'))) problems.push(`${x.number}: breached here ${ours}, there ${Boolean(x.breached)}`);
    });
  } else same('breached (SLA radar)', c.breached.population, null);
  const tile = overview?.tiles?.find((x) => x.key === 'breached');
  if (tile && !tile.unavailable) same('breached (Overview)', c.breached.population, tile.value);
  if (handover?.available && handover.snapshot.breached !== null) same('breached (hand-over)', c.breached.population, handover.snapshot.breached);

  if (workload?.pingPong) {
    same('reassigned often (Workload)', c.reassigned.population, workload.pingPong.available ? workload.pingPong.count : null);
    const listed = workload.pingPong.items.map((x) => x.number);
    numberOf('reassigned').forEach((r) => {
      if (!listed.includes(r.number)) problems.push(`${r.number} is a "reassigned" row but not in the Workload's list`);
      const item = workload.pingPong.items.find((x) => x.number === r.number);
      if (item && item.reassignments !== r.facts.reassigned?.n) problems.push(`${r.number}: moved ${r.facts.reassigned?.n} times here, ${item.reassignments} there`);
    });
    const cells = workload.ageing?.buckets;
    same('open longest (Workload ageing)', c.oldest.population, workload.ageing?.byTable?.length ? cells[cells.length - 1].count : null);
  }
  if (handover?.available) {
    same('waiting for an approval (hand-over)', c.approval.population, handover.waiting.approval);
    same('waiting for the customer (hand-over)', c.customer.population, handover.waiting.customer);
    const oldest = handover.oldest.map((x) => x.number);
    numberOf('oldest').forEach((r) => {
      if (r.reason === 'oldest' && !oldest.includes(r.number)) problems.push(`${r.number} is an "oldest" row but not in the hand-over's oldest open`);
    });
  }
  return problems;
}

// ---- The section ---------------------------------------------------------------------------------------------------------------------

export async function attentionSection(ctx) {
  const tables = usableTables(ctx);
  if (!tables.length) {
    return sectionResult('attention', tm('Needs attention now'), ctx, { available: false, reason: tm('No ticket type can be read with your access, so there is nothing to look at.') });
  }
  const { reader, scope } = ctx;
  const [slaPart, live, lists] = await Promise.all([
    readSlaTickets(ctx),
    Promise.all(tables.map((tableInfo) => readLive(ctx, tableInfo))),
    Promise.all(
      tables.map(async (tableInfo) => {
        const opened = await readOpenStates(reader, tableInfo.table, andQuery(scope.query, 'active=true'));
        return { tableInfo, states: opened.states, ...(await readWaitingAndOldest(ctx, tableInfo, opened, { perKind: true })) };
      })
    ),
  ]);

  // Why a number is missing, once per table (the same words the sections use, so the dashboard says each thing once).
  const why = (p, reads) => {
    const failed = reads.filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.tableInfo.table, status: failed[0].status, note: `${p.tableInfo.meta.label}: ${failed[0].note}` });
  };
  live.forEach((p) => why(p, [p.openN, ...p.ageCounts, p.pingCount, p.pingRows]));
  lists.forEach((p) => why(p, [p.states, p.waitingRows, p.oldest, ...Object.values(p.kindRows)]));
  if (!slaPart.snap.ok) ctx.access.push({ source: 'task_sla', status: slaPart.snap.status, note: slaPart.snap.note });

  const waiting = summarizeWaiting(lists, ctx);
  const sources = attentionSources({
    sla: slaPart,
    reassigned: summarizeReassigned(live),
    ageing: summarizeAgeing(live),
    waiting,
    approval: summarizeWaitingKind(lists, 'approval', ctx),
    customer: summarizeWaitingKind(lists, 'customer', ctx),
    oldest: { items: summarizeOldest(lists, ctx), failed: lists.some((p) => !p.oldest.ok) },
    now: ctx.now,
  });
  return sectionResult('attention', tm('Needs attention now'), ctx, composeAttention(sources));
}

/** Rows for CSV / print / copy. */
export function attentionTables(result) {
  const d = result.data;
  if (!d?.available || !d.rows?.length) return [];
  return [
    {
      title: t('Needs attention now'),
      columns: [
        { key: 'number', label: t('Ticket') },
        { key: 'title', label: t('Short description') },
        { key: 'reason', label: t('Reason') },
        { key: 'priority', label: t('Priority') },
        { key: 'owner', label: t('Assigned to'), person: true },
        { key: 'group', label: t('Group') },
      ],
      rows: d.rows.map((r) => ({ number: r.number, title: r.title, reason: reasonLabel(r.reason, r.facts[r.reason]), priority: r.priority, owner: r.owner || t('(unassigned)'), group: r.group })),
    },
  ];
}
