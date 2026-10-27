// F3 "SLA risk radar": which tickets in the chosen scope have a breached SLA, an SLA nearly used up, or one that falls due
// within a few hours; grouped by owner and by group, with the ten closest to breaking. It reads task_sla (active SLAs of the
// tickets in scope, narrowed to the worrying ones) and then looks the tickets up in the task table.
// The risk line (75 % of the time used) is the one My Day draws: src/reports/myDay.js.
import { worstSla, riskOf } from '../myDay.js';
import { SYS_ID_RE } from '../../context/util.js';
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { andQuery, raw, disp, capNote, sectionResult, usableTables, byCountDesc, clampInt } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { HOUR, snLiteral, timeOf } from './time.js';

const SLA_FIELDS = ['task', 'sla', 'stage', 'has_breached', 'percentage', 'planned_end_time'];
const TASK_FIELDS = ['sys_id', 'number', 'short_description', 'priority', 'state', 'assigned_to', 'assignment_group', 'sys_class_name'];

const isTrue = (v) => ['true', '1', 'yes'].includes(raw(v).toLowerCase());

/** Collapse SLA rows to one entry per ticket: the worst SLA, and whether any SLA is due within `dueMs`. Pure. */
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
    let soonest = Infinity;
    rows.forEach((r) => {
      if (isTrue(r.has_breached)) return;
      const end = timeOf(raw(r.planned_end_time));
      if (Number.isFinite(end) && end < soonest) soonest = end;
    });
    const dueSoon = !worst.breached && Number.isFinite(soonest) && soonest <= now + dueMs;
    const atRisk = !worst.breached && worst.percentage >= atRiskPercent;
    tickets.push({ sysId, sla: worst, risk, breached: worst.breached, atRisk, dueSoon, dueAt: Number.isFinite(soonest) ? soonest : null });
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
  tickets.forEach((t) => {
    const id = t[idKey] || '';
    const row = map.get(id) || { id, name: t[nameKey] || emptyName, breached: 0, atRisk: 0, dueSoon: 0, count: 0 };
    if (t.breached) row.breached += 1;
    else if (t.atRisk) row.atRisk += 1;
    if (t.dueSoon) row.dueSoon += 1;
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
    const usable = usableTables(ctx).map((t) => t.table);
    if (!usable.length) return { ok: false, status: 'error', note: 'No ticket table can be read.' };
    const dueUntil = now + LIMITS.dueSoonHours * HOUR;
    const base = andQuery('active=true', `task.sys_class_nameIN${usable.join(',')}`, scope.taskQuery);
    const worrying = `has_breached=true^ORpercentage>=${LIMITS.slaAtRiskPercent}^ORplanned_end_time<=${snLiteral(dueUntil)}`;

    const total = await attempt(() => reader.count('task_sla', base), 'task_sla');
    if (!total.ok) return { ok: false, status: total.status, note: total.status === 'denied' ? 'SLA information is not available to you.' : total.note };
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
        breached: tickets.filter((t) => t.breached).length,
        atRisk: tickets.filter((t) => t.atRisk).length,
        dueSoon: tickets.filter((t) => t.dueSoon).length,
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
    const ids = wanted.slice(i, i + 50).map((t) => t.sysId);
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
    return sectionResult('sla', 'SLA risk radar', ctx, { available: false, reason: snap.note, status: snap.status });
  }
  if (snap.cap) ctx.caps.push(snap.cap);

  const { details, failure, looked } = await lookUpTickets(ctx, snap.tickets);
  if (failure) ctx.access.push({ source: 'task', status: failure.status, note: 'Ticket details are not available to you, so only the counts are shown.' });
  if (snap.tickets.length > looked) ctx.notes.push(`Names and owners were looked up for the ${looked} most worrying tickets of ${snap.tickets.length}.`);

  const tickets = snap.tickets.slice(0, looked).map((t) => {
    const d = details.get(t.sysId);
    return {
      ...t,
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
  const known = tickets.filter((t) => t.number);
  const topN = clampInt(ctx.params.top, 1, 25, LIMITS.topN);

  return sectionResult('sla', 'SLA risk radar', ctx, {
    available: true,
    counts: snap.counts,
    ticketsAtIssue: snap.tickets.length,
    activeSlas: snap.activeSlas,
    top: known.slice(0, topN),
    byOwner: tallyBy(known, 'ownerId', 'owner', '(unassigned)').slice(0, 15),
    byGroup: tallyBy(known, 'groupId', 'group', '(no group)').slice(0, 15),
    detailsMissing: Boolean(failure),
    dueSoonHours: LIMITS.dueSoonHours,
    atRiskPercent: LIMITS.slaAtRiskPercent,
  });
}

/** Rows for CSV / print / copy. */
export function slaTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  return [
    {
      title: 'Closest to breaking',
      columns: [
        { key: 'number', label: 'Ticket' },
        { key: 'title', label: 'Short description' },
        { key: 'priority', label: 'Priority' },
        { key: 'risk', label: 'SLA' },
        { key: 'percent', label: 'Time used (%)' },
        { key: 'due', label: 'Due' },
        { key: 'owner', label: 'Owner', person: true },
        { key: 'group', label: 'Group' },
      ],
      rows: d.top.map((t) => ({ number: t.number, title: t.title, priority: t.priority, risk: t.breached ? 'Breached' : 'At risk', percent: t.sla.percentage, due: t.sla.plannedEnd, owner: t.owner || '(unassigned)', group: t.group })),
    },
    {
      title: 'SLA risk by owner',
      columns: [
        { key: 'name', label: 'Owner', person: true },
        { key: 'breached', label: 'Breached' },
        { key: 'atRisk', label: 'At risk' },
        { key: 'dueSoon', label: 'Due soon' },
      ],
      rows: d.byOwner,
    },
    {
      title: 'SLA risk by group',
      columns: [
        { key: 'name', label: 'Group' },
        { key: 'breached', label: 'Breached' },
        { key: 'atRisk', label: 'At risk' },
        { key: 'dueSoon', label: 'Due soon' },
      ],
      rows: d.byGroup,
    },
  ];
}
