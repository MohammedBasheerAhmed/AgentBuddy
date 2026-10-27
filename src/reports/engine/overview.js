// Overview tiles: open, due soon, breached, unassigned, stale, waiting, opened today, resolved today. Counts come from the
// Aggregate API (nothing but numbers is transferred), one set per table, added up. A table the person cannot read is left
// out and named; a number that is missing for any table is flagged, never shown as zero.
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { andQuery, clampInt, sectionResult, stateClass, sumResults, usableTables, resolvedColumn } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { DAY, HOUR, startOfLocalDay } from './time.js';
import { readSlaSnapshot } from './sla.js';

/** Waiting state values and labels out of a state breakdown. Pure. */
export function waitingStates(groups) {
  const waiting = (groups || []).filter((g) => stateClass(g.keys[0]?.display) === 'waiting');
  return {
    count: waiting.reduce((n, g) => n + g.count, 0),
    values: waiting.map((g) => g.keys[0].value).filter((v) => v !== ''),
    labels: [...new Set(waiting.map((g) => g.keys[0].display).filter(Boolean))],
  };
}

async function readTable(ctx, t, { staleDays, dayStart }) {
  const { reader, scope } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');
  const resolved = resolvedColumn(t);
  const staleCut = buildQuery([{ op: 'before', field: 'sys_updated_on', ms: ctx.now - staleDays * DAY }]);
  const [openN, unassigned, stale, states, openedToday, resolvedToday] = await Promise.all([
    attempt(() => reader.count(t.table, open), t.table),
    scope.unassignedMeaningful ? attempt(() => reader.count(t.table, q('active=true', 'assigned_toISEMPTY')), t.table) : null,
    attempt(() => reader.count(t.table, q('active=true', staleCut)), t.table),
    attempt(() => reader.groups(t.table, open, ['state']), t.table),
    attempt(() => reader.count(t.table, q(buildQuery([{ op: 'since', field: 'opened_at', ms: dayStart }]))), t.table),
    resolved ? attempt(() => reader.count(t.table, q(buildQuery([{ op: 'since', field: resolved, ms: dayStart }]))), t.table) : null,
  ]);
  return {
    table: t.table,
    label: t.meta.label,
    open: openN,
    unassigned,
    stale,
    waiting: states.ok ? { ok: true, value: waitingStates(states.value).count, detail: waitingStates(states.value) } : states,
    openedToday,
    resolvedToday: resolvedToday || { ok: false, status: 'error', note: 'No resolved date column on this table.' },
  };
}

const total = (rows, key) => sumResults(rows.filter((r) => r[key] !== null).map((r) => r[key]));

function tile(key, label, sum, extra = {}) {
  return {
    key,
    label,
    value: sum.value,
    unavailable: sum.value === null,
    partial: sum.partial,
    ...extra,
  };
}

export async function overviewSection(ctx) {
  const staleDays = clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays);
  const dayStart = startOfLocalDay(ctx.now, ctx.offsetMin);
  const tables = usableTables(ctx);

  const [rows, sla] = await Promise.all([Promise.all(tables.map((t) => readTable(ctx, t, { staleDays, dayStart }))), tables.length ? readSlaSnapshot(ctx) : { ok: false, status: 'error', note: 'No ticket table can be read.' }]);
  if (sla.ok && sla.cap) ctx.caps.push(sla.cap);

  const waitLabels = [...new Set(rows.flatMap((r) => (r.waiting.ok ? r.waiting.detail.labels : [])))];
  // For a drill-down: per table, the query that lists exactly what the number counts.
  const scopeQ = (...extra) => andQuery(ctx.scope.query, ...extra);
  const drill = (key) =>
    rows
      .map((r) => {
        const value = key === 'waiting' ? (r.waiting.ok ? r.waiting.value : null) : r[key]?.ok ? r[key].value : null;
        const t = tables.find((x) => x.table === r.table);
        const resolved = resolvedColumn(t);
        const queries = {
          open: scopeQ('active=true'),
          unassigned: scopeQ('active=true', 'assigned_toISEMPTY'),
          stale: scopeQ('active=true', buildQuery([{ op: 'before', field: 'sys_updated_on', ms: ctx.now - staleDays * DAY }])),
          waiting: r.waiting.ok && r.waiting.detail.values.length ? scopeQ('active=true', buildQuery([{ op: 'in', field: 'state', values: r.waiting.detail.values }])) : '',
          openedToday: scopeQ(buildQuery([{ op: 'since', field: 'opened_at', ms: dayStart }])),
          resolvedToday: resolved ? scopeQ(buildQuery([{ op: 'since', field: resolved, ms: dayStart }])) : '',
        };
        return { table: r.table, label: r.label, count: value, query: queries[key] || '' };
      })
      .filter((d) => d.count > 0 && d.query)
      .sort((a, b) => b.count - a.count);

  const slaUnavailable = !sla.ok;
  // The SLA tiles open the task_sla list (the SLAs, not the tickets): the ticket is one click further.
  const slaBase = andQuery('active=true', `task.sys_class_nameIN${tables.map((t) => t.table).join(',')}`, ctx.scope.taskQuery);
  const slaDrills = {
    dueSoon: andQuery(slaBase, 'has_breached=false', buildQuery([{ op: 'until', field: 'planned_end_time', ms: ctx.now + LIMITS.dueSoonHours * HOUR }])),
    breached: andQuery(slaBase, 'has_breached=true'),
  };
  const slaTile = (key, label, n, hint) => ({
    key,
    label,
    value: sla.ok ? n : null,
    unavailable: slaUnavailable,
    note: slaUnavailable ? sla.note : '',
    hint,
    partial: false,
    drills: sla.ok && n > 0 ? [{ table: 'task_sla', label: 'SLAs', count: n, query: slaDrills[key] }] : [],
  });

  const tiles = [
    { ...tile('open', 'Open', total(rows, 'open')), drills: drill('open'), hint: 'Tickets that are still active' },
    slaTile('dueSoon', 'Due soon', sla.counts?.dueSoon, `SLA ends within ${LIMITS.dueSoonHours} hours`),
    slaTile('breached', 'Breached', sla.counts?.breached, 'SLA already breached'),
  ];
  if (ctx.scope.unassignedMeaningful) tiles.push({ ...tile('unassigned', 'Unassigned', total(rows, 'unassigned')), drills: drill('unassigned'), hint: 'Open with nobody assigned' });
  tiles.push(
    { ...tile('stale', `No update in ${staleDays}+ days`, total(rows, 'stale')), drills: drill('stale'), hint: 'Open and untouched' },
    { ...tile('waiting', 'Waiting', total(rows, 'waiting')), drills: drill('waiting'), hint: waitLabels.length ? `States: ${waitLabels.join(', ')}` : 'On hold, pending or awaiting information' },
    { ...tile('openedToday', 'Opened today', total(rows, 'openedToday')), drills: drill('openedToday'), hint: 'Since midnight' },
    { ...tile('resolvedToday', 'Resolved today', total(rows, 'resolvedToday')), drills: drill('resolvedToday'), hint: 'Resolved or closed since midnight' }
  );
  tiles.forEach((t) => {
    if (t.partial) t.hint = `${t.hint}. Some tables could not be counted.`;
    t.drills = t.drills || [];
  });

  // Why a number is missing: the first failure for each table.
  rows.forEach((r) => {
    const failures = ['open', 'unassigned', 'stale', 'waiting', 'openedToday'].map((k) => r[k]).filter((v) => v && !v.ok);
    if (failures.length) ctx.access.push({ source: r.table, status: failures[0].status, note: `${r.label}: ${failures[0].note}` });
  });

  return sectionResult('overview', 'Overview', ctx, {
    tiles,
    staleDays,
    perTable: rows.map((r) => ({
      table: r.table,
      label: r.label,
      open: r.open.ok ? r.open.value : null,
      unassigned: r.unassigned?.ok ? r.unassigned.value : null,
      stale: r.stale.ok ? r.stale.value : null,
      waiting: r.waiting.ok ? r.waiting.value : null,
      openedToday: r.openedToday.ok ? r.openedToday.value : null,
      resolvedToday: r.resolvedToday.ok ? r.resolvedToday.value : null,
    })),
    sla: sla.ok ? { activeSlas: sla.activeSlas, ticketsAtIssue: sla.tickets.length } : { unavailable: true, note: sla.note },
  });
}

export function overviewTables(result) {
  const d = result.data;
  if (!d) return [];
  return [
    {
      title: 'Overview',
      columns: [
        { key: 'label', label: 'Measure' },
        { key: 'value', label: 'Value' },
        { key: 'note', label: 'Note' },
      ],
      rows: d.tiles.map((t) => ({ label: t.label, value: t.unavailable ? 'Not available to you' : t.value, note: t.hint || '' })),
    },
    {
      title: 'Overview by table',
      columns: [
        { key: 'label', label: 'Table' },
        { key: 'open', label: 'Open' },
        { key: 'unassigned', label: 'Unassigned' },
        { key: 'stale', label: `No update in ${d.staleDays}+ days` },
        { key: 'waiting', label: 'Waiting' },
        { key: 'openedToday', label: 'Opened today' },
        { key: 'resolvedToday', label: 'Resolved today' },
      ],
      rows: d.perTable.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? 'n/a' : v]))),
    },
  ];
}
