// Overview tiles: open, due soon, breached, unassigned, stale, waiting, opened today, resolved today. Counts come from the
// Aggregate API (nothing but numbers is transferred), one set per table, added up. A table the person cannot read is left
// out and named; a number that is missing for any table is flagged, never shown as zero.
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { say, tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown } from '../shown.js';
import { andQuery, clampInt, sectionResult, stateClass, sumResults, usableTables, resolvedColumn, notResolved, onlyResolved, readOpenStates, openOf } from './common.js';
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
  // The state breakdown comes first: it says which states mean "resolved, waiting to close" on this instance (an incident stays
  // active after Resolved), so Open, Unassigned and Stale leave those out and they are counted on their own. It is the same question
  // the hand-over and the workload ask, so one cached request serves all three.
  const { states, done, live } = await readOpenStates(reader, t.table, open);
  const [openN, unassigned, stale, openedToday, resolvedToday] = await Promise.all([
    attempt(() => reader.count(t.table, open), t.table),
    scope.unassignedMeaningful ? attempt(() => reader.count(t.table, q('active=true', 'assigned_toISEMPTY', live)), t.table) : null,
    attempt(() => reader.count(t.table, q('active=true', staleCut, live)), t.table),
    attempt(() => reader.count(t.table, q(buildQuery([{ op: 'since', field: 'opened_at', ms: dayStart }]))), t.table),
    resolved ? attempt(() => reader.count(t.table, q(buildQuery([{ op: 'since', field: resolved, ms: dayStart }]))), t.table) : null,
  ]);
  return {
    table: t.table,
    label: t.meta.label,
    // Active minus resolved-but-active.
    open: openOf(openN, done),
    unassigned,
    stale,
    waiting: states.ok ? { ok: true, value: waitingStates(states.value).count, detail: waitingStates(states.value) } : states,
    resolvedActive: states.ok ? { ok: true, value: done.count } : states,
    doneValues: done.values,
    doneLabels: done.labels,
    openedToday,
    resolvedToday: resolvedToday || { ok: false, status: 'error', note: tm('No resolved date column on this table.') },
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

  const [rows, sla] = await Promise.all([Promise.all(tables.map((t) => readTable(ctx, t, { staleDays, dayStart }))), tables.length ? readSlaSnapshot(ctx) : { ok: false, status: 'error', note: tm('No ticket table can be read.') }]);
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
        const live = notResolved(r.doneValues);
        const queries = {
          open: scopeQ('active=true', live),
          unassigned: scopeQ('active=true', 'assigned_toISEMPTY', live),
          stale: scopeQ('active=true', buildQuery([{ op: 'before', field: 'sys_updated_on', ms: ctx.now - staleDays * DAY }]), live),
          resolvedActive: onlyResolved(r.doneValues) ? scopeQ('active=true', onlyResolved(r.doneValues)) : '',
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
    // A paused SLA is not counting down, so it is not "due soon" (sla.js leaves it out of the count the same way).
    dueSoon: andQuery(slaBase, 'has_breached=false', 'stage!=paused', buildQuery([{ op: 'until', field: 'planned_end_time', ms: ctx.now + LIMITS.dueSoonHours * HOUR }])),
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
    drills: sla.ok && n > 0 ? [{ table: 'task_sla', label: tm('SLAs'), count: n, query: slaDrills[key] }] : [],
  });

  const tiles = [
    { ...tile('open', tm('Open'), total(rows, 'open')), drills: drill('open'), hint: tm('Tickets that are still active') },
    slaTile('dueSoon', tm('Due soon'), sla.counts?.dueSoon, say(tm('SLA ends within {hours} hours'), { hours: LIMITS.dueSoonHours })),
    slaTile('breached', tm('Breached'), sla.counts?.breached, tm('SLA already breached')),
  ];
  if (ctx.scope.unassignedMeaningful) tiles.push({ ...tile('unassigned', tm('Unassigned'), total(rows, 'unassigned')), drills: drill('unassigned'), hint: tm('Open with nobody assigned') });
  tiles.push(
    { ...tile('stale', say(tm('No update in {days}+ days'), { days: staleDays }), total(rows, 'stale')), drills: drill('stale'), hint: tm('Open and untouched') },
    { ...tile('waiting', tm('Waiting'), total(rows, 'waiting')), drills: drill('waiting'), hint: waitLabels.length ? say(tm('States: {labels}'), { labels: waitLabels.join(', ') }) : tm('On hold, pending or awaiting information') },
    { ...tile('openedToday', tm('Opened today'), total(rows, 'openedToday')), drills: drill('openedToday'), hint: tm('Since midnight') },
    { ...tile('resolvedToday', tm('Resolved today'), total(rows, 'resolvedToday')), drills: drill('resolvedToday'), hint: tm('Resolved or closed since midnight') }
  );
  // Resolved but not yet closed: only when there are some, so a queue without them shows no extra tile. Never part of Open.
  const resolvedActive = total(rows, 'resolvedActive');
  const doneLabels = [...new Set(rows.flatMap((r) => r.doneLabels || []))];
  if (resolvedActive.value > 0) {
    tiles.splice(1, 0, { ...tile('resolvedActive', tm('Resolved, not closed'), resolvedActive), drills: drill('resolvedActive'), hint: doneLabels.length ? say(tm('Waiting to close ({labels}). Not counted as open.'), { labels: doneLabels.join(', ') }) : tm('Waiting to close. Not counted as open.') });
  }
  tiles.forEach((t) => {
    if (t.partial) t.hint = say(tm('{hint}. Some tables could not be counted.'), { hint: t.hint });
    t.drills = t.drills || [];
  });

  // Why a number is missing: the first failure for each table.
  rows.forEach((r) => {
    const failures = ['open', 'unassigned', 'stale', 'waiting', 'openedToday'].map((k) => r[k]).filter((v) => v && !v.ok);
    if (failures.length) ctx.access.push({ source: r.table, status: failures[0].status, note: `${r.label}: ${failures[0].note}` });
  });

  return sectionResult('overview', tm('Overview'), ctx, {
    tiles,
    staleDays,
    perTable: rows.map((r) => ({
      table: r.table,
      label: r.label,
      open: r.open.ok ? r.open.value : null,
      unassigned: r.unassigned?.ok ? r.unassigned.value : null,
      stale: r.stale.ok ? r.stale.value : null,
      waiting: r.waiting.ok ? r.waiting.value : null,
      resolvedActive: r.resolvedActive.ok ? r.resolvedActive.value : null,
      openedToday: r.openedToday.ok ? r.openedToday.value : null,
      resolvedToday: r.resolvedToday.ok ? r.resolvedToday.value : null,
    })),
    resolvedActive: resolvedActive.value,
    sla: sla.ok ? { activeSlas: sla.activeSlas, ticketsAtIssue: sla.tickets.length } : { unavailable: true, note: sla.note },
  });
}

export function overviewTables(result) {
  const d = result.data;
  if (!d || d.available === false) return []; // an empty scope or a table list with nothing to read has no tables
  return [
    {
      title: t('Overview'),
      columns: [
        { key: 'label', label: t('Measure') },
        { key: 'value', label: t('Value') },
        { key: 'note', label: t('Note') },
      ],
      rows: d.tiles.map((tile) => ({ label: shown(tile.label), value: tile.unavailable ? t('Not available to you') : tile.value, note: shown(tile.hint || '') })),
    },
    {
      title: t('Overview by table'),
      columns: [
        { key: 'label', label: t('Table') },
        { key: 'open', label: shown('Open') },
        { key: 'unassigned', label: t('Unassigned') },
        { key: 'stale', label: t('No update in {days}+ days', { days: d.staleDays }) },
        { key: 'waiting', label: t('Waiting') },
        { key: 'resolvedActive', label: t('Resolved, not closed') },
        { key: 'openedToday', label: t('Opened today') },
        { key: 'resolvedToday', label: t('Resolved today') },
      ],
      rows: d.perTable.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? t('n/a') : k === 'label' ? shown(v) : v]))),
    },
  ];
}
