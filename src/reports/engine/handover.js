// F4 "Shift handover" (the deterministic page): what is open, what is breached or at risk, what waits on the customer or on an
// approval, what happened in the last 8, 12 or 24 hours, and the oldest open items. No AI is needed to use it; the AI note
// (src/reports/ai/handover.js, feature 'shift-handover') only takes this section's JSON as its input.
//
// It adds to what the other sections already read instead of repeating it: the Overview section's tiles and the SLA snapshot
// are called on the same context (so the same short-lived cache serves them), and the new reads are bounded:
//   - tickets opened or resolved in the period at priority 1 or 2 (a short list each, plus the true total when the list is full)
//   - SLAs whose planned end fell inside the period and which breached (a count, and the tickets behind the first few)
//   - tickets handed over 3+ times and touched in the period
//   - the oldest tickets that wait (customer, approver or other) and the oldest open tickets
// Every read is a GET through the shared reader, fails on its own and says so in `access`; a missing number is null, never 0.
import { SYS_ID_RE } from '../../context/util.js';
import { LIMITS, TICKET_FIELDS } from './constants.js';
import { attempt } from './reader.js';
import { tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown } from '../shown.js';
import { andQuery, raw, disp, sectionResult, stateClass, usableTables, resolvedColumn, verifiedCount, readOpenStates } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { HOUR, localDaysBetween, timeOf } from './time.js';
import { overviewSection, waitingStates } from './overview.js';
import { groupSlaByTicket, rankSlaTickets, readSlaSnapshot, SLA_UNSEEN } from './sla.js';
import { readApprovals } from './fulfilment.js';
import { SLA_COLUMNS } from '../myDay.js';

export const HANDOVER_HOURS = Object.freeze([8, 12, 24]);
export const HANDOVER_DEFAULT_HOURS = 12;
export const HANDOVER_LIMITS = Object.freeze({ list: 8, slaTop: 8, waitingOldest: 6, oldest: 8, reassigned: 6, perTableOldest: 5, breachRows: 30, lookupMax: 24 });

// ServiceNow priorities 1 (critical) and 2 (high) are the "urgent" ones.
const URGENT = ['1', '2'];
const SLA_FIELDS = [...SLA_COLUMNS];
// A requester's name is read only so the AI note can mask it where a ticket title mentions the person; it is never shown or exported.
const LOOKUP_FIELDS = [...TICKET_FIELDS, 'opened_by'];

/** 8, 12 or 24; anything else is 12. */
export function normalizeHours(value) {
  const n = Math.floor(Number(value));
  return HANDOVER_HOURS.includes(n) ? n : HANDOVER_DEFAULT_HOURS;
}

/**
 * What a waiting state is waiting FOR, judged from the label the instance shows: 'approval', 'customer' (the person who raised
 * it) or 'other' (on hold, pending, or waiting on another team or a vendor). Pure.
 */
export function waitingKind(label) {
  const text = String(label || '');
  if (/approv/i.test(text)) return 'approval';
  if (/\b(caller|customer|user|requester|requestor|requested for|info|information|response|reply|confirmation|feedback)\b/i.test(text)) return 'customer';
  return 'other';
}

// Smaller priority number = more urgent; text with no number goes last.
const priorityNumber = (value) => {
  const n = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 9;
};

/**
 * One ticket row (read with display values) as the plain item every list on the page uses. `ctx` gives "now" and the person's zone:
 * the age is in calendar days there, so 0 means opened today (not "less than 24 hours ago", which may be yesterday evening).
 */
function ticketItem(row, { table, kind }, { now, offsetMin }) {
  const opened = timeOf(raw(row.opened_at));
  const names = [row.opened_by, row.caller_id].map(disp).filter(Boolean);
  return {
    table,
    kind,
    sysId: raw(row.sys_id),
    number: disp(row.number),
    title: disp(row.short_description),
    priority: disp(row.priority),
    priorityValue: raw(row.priority),
    state: disp(row.state),
    owner: disp(row.assigned_to),
    group: disp(row.assignment_group),
    openedAt: disp(row.opened_at),
    ageDays: Number.isFinite(opened) ? localDaysBetween(opened, now, offsetMin) : null,
    maskNames: [...new Set(names)],
    openedMs: Number.isFinite(opened) ? opened : 0,
  };
}

const strip = ({ openedMs, ...rest }) => rest;

/** Most urgent first, then newest. Pure. */
const byUrgency = (a, b) => priorityNumber(a.priorityValue || a.priority) - priorityNumber(b.priorityValue || b.priority) || b.openedMs - a.openedMs || a.number.localeCompare(b.number);
/** Oldest first. Pure. */
const byAge = (a, b) => a.openedMs - b.openedMs || a.number.localeCompare(b.number);

/**
 * A short list plus its true size. `filter` is the query without ordering, `ordered` the same with it. When the list came back full
 * there may be more, so the count is asked for; if that fails the total is unknown (null) and `capped` says why.
 */
async function readList(reader, table, filter, ordered, fields, limit) {
  const rows = await attempt(() => reader.rows(table, ordered, fields, { limit, displayValue: true }), table);
  if (!rows.ok) return rows;
  let total = rows.value.length;
  let capped = false;
  if (rows.value.length >= limit) {
    const counted = await attempt(() => reader.count(table, filter), table);
    if (counted.ok) {
      total = counted.value;
      capped = counted.value > rows.value.length;
    } else {
      total = null;
      capped = true;
    }
  }
  return { ok: true, value: { rows: rows.value, total, capped } };
}

async function readTable(ctx, t, since) {
  const { reader, scope } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');
  const resolved = resolvedColumn(t);
  const fields = [...LOOKUP_FIELDS, ...(t.cols.has('caller_id') ? ['caller_id'] : [])];
  const urgent = { op: 'in', field: 'priority', values: URGENT };
  const list = (filterParts, order) => {
    const filter = q(...filterParts);
    return [filter, andQuery(filter, buildQuery([], order))];
  };

  const [openedF, openedO] = list([buildQuery([{ op: 'since', field: 'opened_at', ms: since }, urgent])], { orderBy: 'opened_at', descending: true });
  const [resolvedF, resolvedO] = resolved ? list([buildQuery([{ op: 'since', field: resolved, ms: since }, urgent])], { orderBy: resolved, descending: true }) : ['', ''];
  const canReassign = t.cols.has('reassignment_count');
  const [reassignedF, reassignedO] = canReassign
    ? list(['active=true', buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }, { op: 'since', field: 'sys_updated_on', ms: since }])], { orderBy: 'reassignment_count', descending: true })
    : ['', ''];

  // The state breakdown has the same query as the Overview's, so it is a cache hit when Overview ran first. It also says which
  // states mean 'resolved, waiting to close': those tickets are not 'oldest open'.
  const { states, live } = await readOpenStates(reader, t.table, open);
  const waiting = states.ok ? waitingStates(states.value) : null;
  const [oldestF, oldestO] = list(['active=true', live], { orderBy: 'opened_at' });

  const [openedUrgent, resolvedUrgent, reassigned, waitingRows, oldest] = await Promise.all([
    readList(reader, t.table, openedF, openedO, fields, HANDOVER_LIMITS.list),
    resolved ? readList(reader, t.table, resolvedF, resolvedO, fields, HANDOVER_LIMITS.list) : null,
    canReassign ? readList(reader, t.table, reassignedF, reassignedO, [...fields, 'reassignment_count'], HANDOVER_LIMITS.reassigned) : null,
    waiting?.values.length
      ? attempt(() => reader.rows(t.table, q('active=true', buildQuery([{ op: 'in', field: 'state', values: waiting.values }], { orderBy: 'opened_at' })), fields, { limit: HANDOVER_LIMITS.perTableOldest, displayValue: true }), t.table)
      : null,
    attempt(() => reader.rows(t.table, oldestO, fields, { limit: HANDOVER_LIMITS.perTableOldest, displayValue: true }), t.table),
  ]);
  return { t, states, openedUrgent, resolvedUrgent, reassigned, waitingRows, oldest, hasResolved: Boolean(resolved), canReassign };
}

/** Tickets by sys_id from the task table (display values): { details: Map, failure }. Chunks of 50, bounded. */
async function lookUp(ctx, sysIds) {
  const ids = [...new Set(sysIds)].filter((id) => SYS_ID_RE.test(id)).slice(0, HANDOVER_LIMITS.lookupMax);
  const details = new Map();
  let failure = null;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    // eslint-disable-next-line no-await-in-loop -- chunks of ids, one request after another.
    const got = await attempt(() => ctx.reader.rows('task', buildQuery([{ op: 'in', field: 'sys_id', values: chunk }]), LOOKUP_FIELDS, { limit: 50, displayValue: true }), 'task');
    if (!got.ok) {
      failure = got;
      break;
    }
    got.value.forEach((r) => details.set(raw(r.sys_id), r));
  }
  return { details, failure };
}

/** SLAs that breached with their planned end inside the period: a count, and the tickets behind the first rows. */
async function readBreaches(ctx, tables, since) {
  const { reader, scope, now } = ctx;
  const base = andQuery('has_breached=true', `task.sys_class_nameIN${tables.map((t) => t.table).join(',')}`, scope.taskQuery, buildQuery([{ op: 'since', field: 'planned_end_time', ms: since }, { op: 'until', field: 'planned_end_time', ms: now }]));
  const total = await verifiedCount(reader, 'task_sla', base, { unseen: SLA_UNSEEN });
  if (!total.ok) return { ok: false, status: total.status, note: total.status === 'denied' ? tm('SLA information is not available to you, so breaches in this period are not shown.') : total.note };
  if (!total.value) return { ok: true, total: 0, tickets: [] };
  const rows = await attempt(() => reader.rows('task_sla', `${base}^ORDERBYDESCplanned_end_time`, SLA_FIELDS, { limit: HANDOVER_LIMITS.breachRows, displayValue: true }), 'task_sla');
  if (!rows.ok) return { ok: true, total: total.value, tickets: [], note: rows.note };
  return { ok: true, total: total.value, tickets: rankSlaTickets(groupSlaByTicket(rows.value, { now })).slice(0, HANDOVER_LIMITS.list) };
}

const kindOf = (t) => ({ table: t.table, kind: t.meta.singular });

/** Merge per-table list reads into one: items (as ticket items), the summed total, and whether any table could not be read. */
function mergeLists(parts, pick, ctx, sorter, max) {
  const reads = parts.map((p) => ({ p, read: pick(p) })).filter((x) => x.read);
  const ok = reads.filter((x) => x.read.ok);
  if (!ok.length) return { available: false, total: null, items: [], partial: false, capped: false };
  const items = ok.flatMap(({ p, read }) => read.value.rows.map((row) => ({ ...ticketItem(row, kindOf(p.t), ctx), ...(row.reassignment_count !== undefined ? { reassignments: Number(raw(row.reassignment_count)) || 0 } : {}) })));
  const unknown = ok.some(({ read }) => read.value.total === null);
  return {
    available: true,
    total: unknown ? null : ok.reduce((n, { read }) => n + read.value.total, 0),
    items: items.sort(sorter).slice(0, max).map(strip),
    partial: ok.length < reads.length,
    capped: ok.some(({ read }) => read.value.capped),
  };
}

export async function handoverSection(ctx) {
  const hours = normalizeHours(ctx.params.hours);
  const tables = usableTables(ctx);
  if (!tables.length) {
    return sectionResult('handover', tm('Shift handover'), ctx, { available: false, reason: tm('No ticket table can be read with your access, so there is nothing to hand over.') });
  }
  const since = ctx.now - hours * HOUR;

  const [overview, sla, parts, breaches, approvals] = await Promise.all([
    overviewSection(ctx),
    readSlaSnapshot(ctx),
    Promise.all(tables.map((t) => readTable(ctx, t, since))),
    readBreaches(ctx, tables, since),
    readApprovals(ctx, tables),
  ]);
  if (sla.ok && sla.cap) ctx.caps.push(sla.cap);

  // Why a number is missing, once per table (the Overview section reports its own).
  parts.forEach((p) => {
    const failed = [p.states, p.openedUrgent, p.resolvedUrgent, p.reassigned, p.waitingRows, p.oldest].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.t.table, status: failed[0].status, note: `${p.t.meta.label}: ${failed[0].note}` });
  });
  if (!sla.ok) ctx.access.push({ source: 'task_sla', status: sla.status, note: sla.note });
  if (!breaches.ok && breaches.status !== sla.status) ctx.access.push({ source: 'task_sla', status: breaches.status, note: breaches.note });
  [approvals.mine, approvals.team].forEach((r) => {
    if (r && !r.ok) ctx.access.push({ source: 'sysapproval_approver', status: r.status, note: r.status === 'denied' ? tm('Approvals are not available to you.') : r.note });
  });
  if (!parts.some((p) => p.canReassign)) ctx.notes.push(tm('Reassignment counts are not available on these tables, so heavy hand-offs are not shown.'));
  if (!parts.some((p) => p.hasResolved)) ctx.notes.push(tm('These tables have no resolved date, so tickets resolved in this period are not shown.'));

  // The tickets behind the most worrying SLAs and the breaches of the period, looked up together.
  const slaTop = sla.ok ? sla.tickets.slice(0, HANDOVER_LIMITS.slaTop) : [];
  const breachTop = breaches.ok ? breaches.tickets : [];
  const { details, failure } = await lookUp(ctx, [...slaTop, ...breachTop].map((t) => t.sysId));
  if (failure) ctx.access.push({ source: 'task', status: failure.status, note: tm('Ticket details are not available to you, so SLA lists show counts only.') });
  const tableOf = (row) => tables.find((t) => t.table === raw(row.sys_class_name));
  const withDetails = (entries, extra) =>
    entries
      .map((e) => {
        const row = details.get(e.sysId);
        const t = row && tableOf(row);
        return t ? { ...strip(ticketItem(row, kindOf(t), ctx)), ...extra(e) } : null;
      })
      .filter(Boolean);

  const slaItems = withDetails(slaTop, (e) => ({ risk: e.breached ? 'Breached' : e.atRisk ? 'At risk' : 'Due soon', percent: e.sla.percentage, plannedEnd: e.sla.plannedEnd, endMs: e.endMs ?? null, paused: Boolean(e.sla.paused) }));
  const breachItems = withDetails(breachTop, (e) => ({ risk: 'Breached', percent: e.sla.percentage, plannedEnd: e.sla.plannedEnd, endMs: e.endMs ?? null, paused: false }));

  // Waiting: by state label, by what it waits for, and the oldest that wait.
  const byLabel = new Map();
  parts.filter((p) => p.states.ok).forEach((p) => {
    p.states.value.forEach((g) => {
      const label = g.keys[0]?.display || '';
      if (label && stateClass(label) === 'waiting') byLabel.set(label, (byLabel.get(label) || 0) + g.count);
    });
  });
  const byState = [...byLabel].map(([label, count]) => ({ label, count, kind: waitingKind(label) })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const sumKind = (kind) => byState.filter((s) => s.kind === kind).reduce((n, s) => n + s.count, 0);
  const waitingOldest = parts
    .filter((p) => p.waitingRows?.ok)
    .flatMap((p) => p.waitingRows.value.map((row) => ticketItem(row, kindOf(p.t), ctx)))
    .sort(byAge)
    .slice(0, HANDOVER_LIMITS.waitingOldest)
    .map(strip);
  const oldest = parts
    .filter((p) => p.oldest.ok)
    .flatMap((p) => p.oldest.value.map((row) => ticketItem(row, kindOf(p.t), ctx)))
    .sort(byAge)
    .slice(0, HANDOVER_LIMITS.oldest)
    .map(strip);

  const tile = (key) => overview.data.tiles.find((x) => x.key === key);
  const figure = (key) => {
    const x = tile(key);
    return x && !x.unavailable ? x.value : null;
  };
  const statesOk = parts.some((p) => p.states.ok);

  const opened = mergeLists(parts, (p) => p.openedUrgent, ctx, byUrgency, HANDOVER_LIMITS.list);
  const resolvedList = mergeLists(parts, (p) => p.resolvedUrgent, ctx, byUrgency, HANDOVER_LIMITS.list);
  const reassigned = mergeLists(parts, (p) => p.reassigned, ctx, (a, b) => (b.reassignments || 0) - (a.reassignments || 0) || a.number.localeCompare(b.number), HANDOVER_LIMITS.reassigned);

  return sectionResult('handover', tm('Shift handover'), ctx, {
    available: true,
    hours,
    since,
    until: ctx.now,
    snapshot: {
      open: figure('open'),
      unassigned: ctx.scope.unassignedMeaningful ? figure('unassigned') : undefined,
      stale: figure('stale'),
      staleDays: overview.data.staleDays,
      waiting: statesOk ? byState.reduce((n, s) => n + s.count, 0) : figure('waiting'),
      breached: sla.ok ? sla.counts.breached : null,
      atRisk: sla.ok ? sla.counts.atRisk : null,
      dueSoon: sla.ok ? sla.counts.dueSoon : null,
      dueSoonHours: LIMITS.dueSoonHours,
      partial: overview.data.tiles.filter((x) => x.partial).map((x) => x.key),
    },
    sla: sla.ok
      ? { available: true, counts: sla.counts, ticketsAtIssue: sla.tickets.length, top: slaItems, detailsMissing: Boolean(failure) }
      : { available: false, reason: sla.note, counts: null, top: [] },
    waiting: {
      total: statesOk ? byState.reduce((n, s) => n + s.count, 0) : null,
      partial: statesOk && parts.some((p) => !p.states.ok),
      customer: statesOk ? sumKind('customer') : null,
      approval: statesOk ? sumKind('approval') : null,
      other: statesOk ? sumKind('other') : null,
      byState,
      approvals: { mine: approvals.mine.ok ? approvals.mine.value : null, team: approvals.team ? (approvals.team.ok ? approvals.team.value : null) : undefined },
      oldest: waitingOldest,
    },
    events: {
      opened,
      resolved: resolvedList,
      breaches: breaches.ok ? { available: true, total: breaches.total, items: breachItems, partial: false, capped: breaches.total > breachItems.length } : { available: false, total: null, items: [], partial: false, capped: false },
      reassigned,
    },
    oldest,
  });
}

const dash = (v) => (v === null || v === undefined ? t('n/a') : v);
const RISK_WORDS = () => ({ Breached: t('Breached'), 'At risk': t('At risk'), 'Due soon': t('Due soon') });

/** Rows for CSV / print / copy. */
export function handoverTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  const s = d.snapshot;
  const out = [];
  const measures = [
    [shown('Open'), s.open],
    [t('SLA breached'), s.breached],
    [t('SLA at risk'), s.atRisk],
    [t('SLA due within {hours} hours', { hours: s.dueSoonHours }), s.dueSoon],
    ...(s.unassigned !== undefined ? [[t('Unassigned'), s.unassigned]] : []),
    [t('No update in {days}+ days', { days: s.staleDays }), s.stale],
    [t('Waiting (customer, approval or other)'), s.waiting],
    [`  ${t('waiting on the customer')}`, d.waiting.customer],
    [`  ${t('waiting on an approval')}`, d.waiting.approval],
    [`  ${t('on hold or pending (other)')}`, d.waiting.other],
    [t('Approvals waiting for you'), d.waiting.approvals.mine],
    ...(d.waiting.approvals.team !== undefined ? [[t('Approvals waiting on requested items in scope'), d.waiting.approvals.team]] : []),
    [t('Priority 1-2 opened in the last {hours} hours', { hours: d.hours }), d.events.opened.total],
    [t('Priority 1-2 resolved in the last {hours} hours', { hours: d.hours }), d.events.resolved.total],
    [t('SLAs breached in the last {hours} hours', { hours: d.hours }), d.events.breaches.total],
    [t('Tickets handed over {n}+ times and touched in the last {hours} hours', { n: LIMITS.pingPongMin, hours: d.hours }), d.events.reassigned.total],
  ];
  out.push({ title: t('Shift handover'), columns: [{ key: 'measure', label: t('Measure') }, { key: 'value', label: t('Value') }], rows: measures.map(([measure, value]) => ({ measure, value: dash(value) })) });

  const ticketColumns = [
    { key: 'number', label: t('Ticket') },
    { key: 'title', label: t('Short description') },
    { key: 'priority', label: t('Priority') },
    { key: 'state', label: t('State') },
    { key: 'owner', label: t('Assigned to'), person: true },
    { key: 'group', label: t('Group') },
  ];
  const list = (title, items, extra = []) => items.length && out.push({ title, columns: [...ticketColumns, ...extra], rows: items.map((i) => ({ ...i, owner: i.owner || t('(unassigned)'), ...(i.risk ? { risk: RISK_WORDS()[i.risk] || i.risk } : {}) })) });
  list(t('Closest to breaking'), d.sla.top, [{ key: 'risk', label: t('SLA') }, { key: 'percent', label: t('Time used (%)') }, { key: 'plannedEnd', label: t('Due') }]);
  list(t('Priority 1-2 opened in the last {hours} hours', { hours: d.hours }), d.events.opened.items, [{ key: 'openedAt', label: t('Opened') }]);
  list(t('Priority 1-2 resolved in the last {hours} hours', { hours: d.hours }), d.events.resolved.items);
  list(t('SLAs breached in the last {hours} hours', { hours: d.hours }), d.events.breaches.items, [{ key: 'plannedEnd', label: t('Due') }]);
  list(t('Handed over {n}+ times', { n: LIMITS.pingPongMin }), d.events.reassigned.items, [{ key: 'reassignments', label: t('Reassignments') }]);
  if (d.waiting.byState.length) out.push({ title: t('Waiting by state'), columns: [{ key: 'label', label: t('State') }, { key: 'kind', label: t('Waiting for') }, { key: 'count', label: t('Tickets') }], rows: d.waiting.byState.map((s2) => ({ ...s2, kind: { customer: t('The customer'), approval: t('An approval'), other: t('Other') }[s2.kind] || s2.kind })) });
  list(t('Oldest waiting'), d.waiting.oldest, [{ key: 'ageDays', label: t('Age (days)') }]);
  list(t('Oldest open'), d.oldest, [{ key: 'ageDays', label: t('Age (days)') }]);
  return out;
}
