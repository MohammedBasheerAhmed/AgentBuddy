// F3 "SLA risk radar": which tickets in the chosen scope have a breached SLA, an SLA nearly used up, or one that falls due
// within a few hours; grouped by owner and by group, with the ten closest to breaking. It reads task_sla (active SLAs of the
// tickets in scope, narrowed to the worrying ones) and then looks the tickets up in the task table.
// The risk line (75 % of the time used) is the one My Day draws: src/reports/myDay.js.
import { worstSla, riskOf, isPaused, SLA_COLUMNS } from '../myDay.js';
import { SYS_ID_RE } from '../../context/util.js';
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { say, tm } from './say.js';
import { t } from '../../i18n/core.js';
import { placeholderName } from '../shown.js';
import { andQuery, raw, disp, capNote, sectionResult, usableTables, byCountDesc, clampInt, verifiedCount } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { HOUR, snLiteral, timeOf } from './time.js';

const SLA_FIELDS = [...SLA_COLUMNS];
const TASK_FIELDS = ['sys_id', 'number', 'short_description', 'priority', 'state', 'assigned_to', 'assignment_group', 'sys_class_name'];
export const SLA_UNSEEN = tm('You can see no SLA records at all, so SLA numbers would prove nothing: there may be none, or an access rule may hide them.');

const isTrue = (v) => ['true', '1', 'yes'].includes(raw(v).toLowerCase());

/**
 * The task_sla condition for "worth a look": breached, or at least `pct` % used, or ending by `untilMs`. Both percentages are asked
 * for (the business one decides, see slaPercent in ../myDay.js; the plain one covers an SLA row that has no business figure), so
 * the read is a little wider than the risk and the rows are judged here.
 */
export const worryingQuery = (pct, untilMs) => `has_breached=true^ORbusiness_percentage>=${pct}^ORpercentage>=${pct}^ORplanned_end_time<=${snLiteral(untilMs)}`;

/**
 * Collapse SLA rows to one entry per ticket: the worst SLA, and whether any SLA is due within `dueMs`. Only tickets that are breached,
 * at risk or due soon are kept: the read is wider than the risk (worryingQuery), and a ticket that is none of the three (118 % of wall
 * time but 62 % of its working time, as the record shows) would otherwise be counted at issue, listed as closest to breaking and called
 * "at risk" or "due soon" in the export and the hand-over. Pure.
 */
export function groupSlaByTicket(slaRows, { now, dueMs = LIMITS.dueSoonHours * HOUR, atRiskPercent = LIMITS.slaAtRiskPercent } = {}) {
  const byTask = new Map();
  for (const r of slaRows || []) {
    const task = raw(r.task);
    if (!SYS_ID_RE.test(task)) continue;
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task).push(r);
  }
  const tickets = [];
  for (const [sysId, rows] of byTask) {
    const worst = worstSla(rows);
    const risk = riskOf(worst);
    // The soonest end of any SLA that has not breached: "due soon" even when its percentage is still low (a long pause ended).
    // A paused SLA is left out: its clock is stopped and its planned end moves when it resumes (it may even lie in the past).
    let soonest = Infinity;
    rows.forEach((r) => {
      if (isTrue(r.has_breached) || isPaused(r)) return;
      const end = timeOf(raw(r.planned_end_time));
      if (Number.isFinite(end) && end < soonest) soonest = end;
    });
    const dueSoon = !worst.breached && Number.isFinite(soonest) && soonest <= now + dueMs;
    const atRisk = !worst.breached && worst.percentage >= atRiskPercent;
    if (!worst.breached && !atRisk && !dueSoon) continue;
    // The stored (UTC) end of the worst SLA, so the panel can say 'due in 1 h 20 min' or 'breached 2 h ago' instead of a timestamp.
    const worstRow = rows.find((r) => disp(r.planned_end_time) === worst.plannedEnd && disp(r.sla) === worst.name);
    const endMs = worstRow ? timeOf(raw(worstRow.planned_end_time)) : NaN;
    tickets.push({ sysId, sla: worst, risk, breached: worst.breached, atRisk, dueSoon, dueAt: Number.isFinite(soonest) ? soonest : null, endMs: Number.isFinite(endMs) ? endMs : null });
  }
  return tickets;
}

/** Most worrying first: breached, then the fullest SLA, then the one due soonest. Pure. */
export function rankSlaTickets(tickets) {
  return [...tickets].sort(
    (a, b) =>
      Number(b.breached) - Number(a.breached) ||
      b.sla.percentage - a.sla.percentage ||
      (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
      a.sysId.localeCompare(b.sysId)
  );
}

/** Count tickets per owner or per group: [{ id, name, breached, atRisk, dueSoon, count }], busiest first. Pure. */
export function tallyBy(tickets, idKey, nameKey, emptyName) {
  const map = new Map();
  tickets.forEach((ticket) => {
    const id = ticket[idKey] || '';
    const row = map.get(id) || { id, name: ticket[nameKey] || emptyName, breached: 0, atRisk: 0, dueSoon: 0, count: 0 };
    if (ticket.breached) row.breached += 1;
    else if (ticket.atRisk) row.atRisk += 1;
    if (ticket.dueSoon) row.dueSoon += 1;
    row.count += 1;
    map.set(id, row);
  });
  return [...map.values()].sort((a, b) => b.breached - a.breached || b.atRisk - a.atRisk || byCountDesc(a, b));
}

/**
 * Read the SLA picture for the scope. Shared by the SLA section and the Overview tiles (one set of requests, thanks to
 * the cache). Returns { ok, ... } or { ok: false, status, note } when task_sla cannot be read.
 */
export async function readSlaSnapshot(ctx) {
  if (ctx.slaMemo) return ctx.slaMemo;
  ctx.slaMemo = (async () => {
    const { reader, scope, now } = ctx;
    const usable = usableTables(ctx).map((tableInfo) => tableInfo.table);
    if (!usable.length) return { ok: false, status: 'error', note: tm('No ticket table can be read.') };
    const dueUntil = now + LIMITS.dueSoonHours * HOUR;
    const base = andQuery('active=true', `task.sys_class_nameIN${usable.join(',')}`, scope.taskQuery);
    const worrying = worryingQuery(LIMITS.slaAtRiskPercent, dueUntil);

    // "0 breached" is only said when this person can see SLA records at all.
    const total = await verifiedCount(reader, 'task_sla', base, { unseen: SLA_UNSEEN });
    if (!total.ok) return { ok: false, status: total.status, note: total.status === 'denied' ? tm('SLA information is not available to you.') : total.note };
    const read = await attempt(
      () => reader.pages('task_sla', `${base}^${worrying}^ORDERBYDESChas_breached^ORDERBYDESCpercentage`, SLA_FIELDS, { max: LIMITS.slaRowsMax, pageSize: 500, displayValue: true }),
      'task_sla'
    );
    if (!read.ok) return { ok: false, status: read.status, note: read.note };

    const tickets = rankSlaTickets(groupSlaByTicket(read.value.rows, { now }));
    return {
      ok: true,
      activeSlas: total.value,
      rowsRead: read.value.fetched,
      cap: capNote('task_sla', read.value),
      tickets,
      counts: {
        breached: tickets.filter((ticket) => ticket.breached).length,
        atRisk: tickets.filter((ticket) => ticket.atRisk).length,
        dueSoon: tickets.filter((ticket) => ticket.dueSoon).length,
      },
    };
  })();
  return ctx.slaMemo;
}

/** Look up the tickets behind the most worrying SLAs (number, title, owner, group). */
async function lookUpTickets(ctx, tickets) {
  const { reader } = ctx;
  const wanted = tickets.slice(0, LIMITS.slaTicketsMax);
  const details = new Map();
  let failure = null;
  for (let i = 0; i < wanted.length; i += 50) {
    const ids = wanted.slice(i, i + 50).map((ticket) => ticket.sysId);
    // eslint-disable-next-line no-await-in-loop -- chunks of ids, one request after another.
    const read = await attempt(() => reader.rows('task', buildQuery([{ op: 'in', field: 'sys_id', values: ids }]), TASK_FIELDS, { limit: 50, displayValue: true }), 'task');
    if (!read.ok) {
      failure = read;
      break;
    }
    read.value.forEach((r) => details.set(raw(r.sys_id), r));
  }
  return { details, failure, looked: wanted.length };
}

export async function slaSection(ctx) {
  const snap = await readSlaSnapshot(ctx);
  if (!snap.ok) {
    return sectionResult('sla', tm('SLA risk radar'), ctx, { available: false, reason: snap.note, status: snap.status });
  }
  if (snap.cap) ctx.caps.push(snap.cap);

  const { details, failure, looked } = await lookUpTickets(ctx, snap.tickets);
  if (failure) ctx.access.push({ source: 'task', status: failure.status, note: tm('Ticket details are not available to you, so only the counts are shown.') });
  if (snap.tickets.length > looked) ctx.notes.push(say(tm('Names and owners were looked up for the {looked} most worrying tickets of {total}.'), { looked, total: snap.tickets.length }));

  const tickets = snap.tickets.slice(0, looked).map((ticket) => {
    const d = details.get(ticket.sysId);
    return {
      ...ticket,
      table: d ? raw(d.sys_class_name) : '',
      number: d ? disp(d.number) : '',
      title: d ? disp(d.short_description) : '',
      priority: d ? disp(d.priority) : '',
      state: d ? disp(d.state) : '',
      owner: d ? disp(d.assigned_to) : '',
      ownerId: d ? raw(d.assigned_to) : '',
      group: d ? disp(d.assignment_group) : '',
      groupId: d ? raw(d.assignment_group) : '',
    };
  });
  const known = tickets.filter((ticket) => ticket.number);
  const topN = clampInt(ctx.params.top, 1, 25, LIMITS.topN);

  return sectionResult('sla', tm('SLA risk radar'), ctx, {
    available: true,
    counts: snap.counts,
    ticketsAtIssue: snap.tickets.length,
    activeSlas: snap.activeSlas,
    top: known.slice(0, topN),
    byOwner: tallyBy(known, 'ownerId', 'owner', tm('(unassigned)')).slice(0, 15),
    byGroup: tallyBy(known, 'groupId', 'group', tm('(no group)')).slice(0, 15),
    detailsMissing: Boolean(failure),
    dueSoonHours: LIMITS.dueSoonHours,
    atRiskPercent: LIMITS.slaAtRiskPercent,
  });
}

/** Rows for CSV / print / copy. */
export function slaTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  const named = (r) => ({ ...r, name: placeholderName(r.name) });
  return [
    {
      title: t('Closest to breaking'),
      columns: [
        { key: 'number', label: t('Ticket') },
        { key: 'title', label: t('Short description') },
        { key: 'priority', label: t('Priority') },
        { key: 'risk', label: t('SLA') },
        { key: 'percent', label: t('Time used (%)') },
        { key: 'due', label: t('Due') },
        { key: 'owner', label: t('Owner'), person: true },
        { key: 'group', label: t('Group') },
      ],
      rows: d.top.map((x) => ({ number: x.number, title: x.title, priority: x.priority, risk: x.breached ? t('Breached') : x.atRisk ? t('At risk') : t('Due soon'), percent: x.sla.percentage, due: x.sla.plannedEnd, owner: x.owner || t('(unassigned)'), group: x.group })),
    },
    {
      title: t('SLA risk by owner'),
      columns: [
        { key: 'name', label: t('Owner'), person: true },
        { key: 'breached', label: t('Breached') },
        { key: 'atRisk', label: t('At risk') },
        { key: 'dueSoon', label: t('Due soon') },
      ],
      rows: d.byOwner.map(named),
    },
    {
      title: t('SLA risk by group'),
      columns: [
        { key: 'name', label: t('Group') },
        { key: 'breached', label: t('Breached') },
        { key: 'atRisk', label: t('At risk') },
        { key: 'dueSoon', label: t('Due soon') },
      ],
      rows: d.byGroup.map(named),
    },
  ];
}
