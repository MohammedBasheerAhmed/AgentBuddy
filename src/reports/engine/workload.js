// F2 "Team workload and ageing board": open work by assignee and by group, split by what state it is in, how long it has been
// open, what nobody owns, what nobody touched, and tickets that keep being handed from group to group.
// Counts come from the Aggregate API, so the board is exact however long the queue is.
import { LIMITS, AGE_BUCKETS } from './constants.js';
import { attempt } from './reader.js';
import { tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName } from '../shown.js';
import { andQuery, byCountDesc, clampInt, raw, disp, sectionResult, stateClass, STATE_CLASSES, sumResults, topWithOthers, usableTables, notResolved, readOpenStates, openOf } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { DAY } from './time.js';

const emptyClasses = () => Object.fromEntries(STATE_CLASSES.map((c) => [c.key, 0]));

// The key of the row for "nobody" ('(unassigned)', '(no group)'): never '' (a chart swaps an empty key for the row's position, and the
// row could then not be found again for a click). Its `id` stays '' so its query asks for an empty column.
export const NOBODY_KEY = '__none';

/**
 * Fold "assignee x state" (or "group x state") groups from several tables into one row per person or group.
 * `count` is the row's OPEN tickets, as the Open tile counts them: the resolved-but-active are in `classes.resolved` (drawn as their own
 * part of the bar) but are not open. `byTable` counts every active ticket of the row (what a click on the row lists).
 * @param {{table:string, groups: ReturnType<import('./reader.js').normalizeGroups>}[]} parts
 * @returns {{ key, id, name, count, classes, byTable }[]} busiest first
 */
export function foldByOwner(parts, emptyName) {
  const rows = new Map();
  parts.forEach(({ table, groups }) => {
    groups.forEach((g) => {
      const who = g.keys[0] || { value: '', display: '' };
      const state = g.keys[1] || { display: '' };
      const id = who.value || '';
      const row = rows.get(id) || { key: id || NOBODY_KEY, id, name: who.display || emptyName, count: 0, classes: emptyClasses(), byTable: {} };
      const cls = stateClass(state.display);
      if (cls !== 'resolved') row.count += g.count;
      row.classes[cls] += g.count;
      row.byTable[table] = (row.byTable[table] || 0) + g.count;
      rows.set(id, row);
    });
  });
  return [...rows.values()].sort(byCountDesc);
}

/**
 * Turn cumulative "opened after X days ago" counts into the ageing buckets. `open` is every open ticket; `newerThan[i]` is
 * how many were opened less than AGE_BUCKETS[i].to days ago. Pure; never negative even when the numbers moved between reads.
 */
export function ageBuckets(open, newerThan) {
  const out = [];
  let previous = 0;
  AGE_BUCKETS.forEach((b, i) => {
    const upTo = b.to === null ? open : Math.min(open, Math.max(previous, newerThan[i] ?? previous));
    out.push({ key: b.key, label: b.label, count: Math.max(0, upTo - previous) });
    previous = upTo;
  });
  return out;
}

async function readTable(ctx, tableInfo) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');
  // Which states mean "resolved, waiting to close" (the Overview asks the same question, so this is a cache hit after it): those
  // tickets are left out of the open, stale, ageing and hand-off numbers, and shown as their own part of the per-person bars.
  const { states, done, live } = await readOpenStates(reader, tableInfo.table, open);
  const staleCut = buildQuery([{ op: 'before', field: 'sys_updated_on', ms: now - clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays) * DAY }]);
  const cumulative = AGE_BUCKETS.filter((b) => b.to !== null).map((b) => attempt(() => reader.count(tableInfo.table, q('active=true', buildQuery([{ op: 'after', field: 'opened_at', ms: now - b.to * DAY }]), live)), tableInfo.table));
  const pingPong = tableInfo.cols.has('reassignment_count');
  const [openN, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows] = await Promise.all([
    attempt(() => reader.count(tableInfo.table, open), tableInfo.table),
    scope.kind === 'mine' ? null : attempt(() => reader.groups(tableInfo.table, open, ['assigned_to', 'state']), tableInfo.table),
    scope.kind === 'mine' ? null : attempt(() => reader.groups(tableInfo.table, open, ['assignment_group', 'state']), tableInfo.table),
    scope.unassignedMeaningful ? attempt(() => reader.count(tableInfo.table, q('active=true', 'assigned_toISEMPTY', live)), tableInfo.table) : null,
    attempt(() => reader.count(tableInfo.table, q('active=true', staleCut, live)), tableInfo.table),
    Promise.all(cumulative),
    pingPong ? attempt(() => reader.count(tableInfo.table, q('active=true', buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }]), live)), tableInfo.table) : null,
    pingPong
      ? attempt(
          () =>
            reader.rows(tableInfo.table, andQuery(q('active=true', buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }]), live), 'ORDERBYDESCreassignment_count'), ['sys_id', 'number', 'short_description', 'assigned_to', 'assignment_group', 'reassignment_count'], { limit: 5, displayValue: true }),
          tableInfo.table
        )
      : null,
  ]);
  return { tableInfo, openN: openOf(openN, done), resolvedActive: states.ok ? done.count : null, doneValues: done.values, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows };
}

/**
 * For a click on an ageing cell: the query for the tickets in that age bucket (the same dates the counts used), per table, since
 * each table has its own resolved states to leave out.
 */
function ageQueries({ scope, now }, doneValues = []) {
  return Object.fromEntries(
    AGE_BUCKETS.map((b) => {
      const conditions = [];
      if (b.to !== null) conditions.push({ op: 'after', field: 'opened_at', ms: now - b.to * DAY });
      if (b.from > 0) conditions.push({ op: 'until', field: 'opened_at', ms: now - b.from * DAY });
      return [b.key, andQuery(scope.query, 'active=true', buildQuery(conditions), notResolved(doneValues))];
    })
  );
}

export async function workloadSection(ctx) {
  const tables = usableTables(ctx);
  const parts = await Promise.all(tables.map((tableInfo) => readTable(ctx, tableInfo)));
  const { scope } = ctx;

  // Why a number is missing, once per table.
  parts.forEach((p) => {
    const failed = [p.openN, p.byAssignee, p.byGroup, p.unassigned, p.stale].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.tableInfo.table, status: failed[0].status, note: `${p.tableInfo.meta.label}: ${failed[0].note}` });
  });

  const openSum = sumResults(parts.map((p) => p.openN));
  const unassignedSum = scope.unassignedMeaningful ? sumResults(parts.map((p) => p.unassigned)) : null;
  const staleSum = sumResults(parts.map((p) => p.stale));

  const fold = (key, emptyName) => {
    const usable = parts.filter((p) => p[key]?.ok);
    return foldByOwner(usable.map((p) => ({ table: p.tableInfo.table, groups: p[key].value })), emptyName);
  };
  const assigneeRows = scope.kind === 'mine' ? [] : fold('byAssignee', tm('(unassigned)'));
  const groupRows = scope.kind === 'mine' ? [] : fold('byGroup', tm('(no group)'));
  // For a click on a row: the query that lists exactly that person's (or group's) active tickets, per table: what the bar draws, its
  // resolved-but-active part included. "Nobody" (id '') asks for an empty column.
  const ownerQueries = (row, field) =>
    Object.fromEntries(Object.keys(row.byTable).map((table) => [table, andQuery(scope.query, 'active=true', row.id ? buildQuery([{ op: 'eq', field, value: row.id }]) : `${field}ISEMPTY`)]));
  assigneeRows.forEach((r) => {
    r.queries = ownerQueries(r, 'assigned_to');
  });
  groupRows.forEach((r) => {
    r.queries = ownerQueries(r, 'assignment_group');
  });

  // Ageing, per table and in total.
  const ageTables = parts
    .filter((p) => p.openN.ok && p.ageCounts.every((c) => c.ok))
    .map((p) => ({ table: p.tableInfo.table, label: p.tableInfo.meta.label, open: p.openN.value, buckets: ageBuckets(p.openN.value, p.ageCounts.map((c) => c.value)) }));
  const ageTotal = AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: ageTables.reduce((n, a) => n + a.buckets[i].count, 0) }));

  // Reassignment ping-pong.
  const ppParts = parts.filter((p) => p.pingCount);
  const pingOk = ppParts.filter((p) => p.pingCount.ok);
  const pingPong = {
    available: pingOk.length > 0,
    threshold: LIMITS.pingPongMin,
    count: pingOk.reduce((n, p) => n + p.pingCount.value, 0),
    items: pingOk
      .flatMap((p) => (p.pingRows?.ok ? p.pingRows.value.map((r) => ({ table: p.tableInfo.table, label: p.tableInfo.meta.label, sysId: raw(r.sys_id), number: disp(r.number), title: disp(r.short_description), owner: disp(r.assigned_to), group: disp(r.assignment_group), reassignments: Number(raw(r.reassignment_count)) || 0 })) : []))
      .sort((a, b) => b.reassignments - a.reassignments)
      .slice(0, 5),
  };
  if (!pingPong.available) ctx.notes.push(tm('Reassignment counts are not available on these tables, so hand-offs are not shown.'));

  const staleDays = clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays);
  const topN = clampInt(ctx.params.top, 3, 30, 12);

  return sectionResult('workload', tm('Workload and ageing'), ctx, {
    totals: {
      open: openSum.value,
      openPartial: openSum.partial,
      unassigned: unassignedSum ? unassignedSum.value : null,
      stale: staleSum.value,
      // Resolved but still active: left out of every number above, shown on its own (null when no breakdown could be read).
      resolvedActive: parts.some((p) => p.resolvedActive !== null) ? parts.reduce((n, p) => n + (p.resolvedActive || 0), 0) : null,
    },
    staleDays,
    classes: STATE_CLASSES,
    byAssignee: topWithOthers(assigneeRows, topN, tm('Other people ({n})')),
    byGroup: topWithOthers(groupRows, topN, tm('Other groups ({n})')),
    assigneeCount: assigneeRows.length,
    groupCount: groupRows.length,
    ageing: { buckets: ageTotal, byTable: ageTables, open: ageTables.reduce((n, a) => n + a.open, 0), queries: ageQueries(ctx), queriesByTable: Object.fromEntries(parts.map((p) => [p.tableInfo.table, ageQueries(ctx, p.doneValues)])) },
    pingPong,
    detail: { assignees: assigneeRows, groups: groupRows },
  });
}

export function workloadTables(result) {
  const d = result.data;
  if (!d || d.available === false) return []; // an empty scope or a table list with nothing to read has no tables
  const classCols = d.classes.map((c) => ({ key: c.key, label: shown(c.label) }));
  const ownerRow = (r) => ({ name: placeholderName(r.name), total: r.count, ...r.classes });
  const out = [];
  if (d.detail.assignees.length) {
    out.push({ title: t('Open work by person'), columns: [{ key: 'name', label: t('Person'), person: true }, { key: 'total', label: shown('Open') }, ...classCols], rows: d.detail.assignees.map(ownerRow) });
  }
  if (d.detail.groups.length) {
    out.push({ title: t('Open work by group'), columns: [{ key: 'name', label: t('Group') }, { key: 'total', label: shown('Open') }, ...classCols], rows: d.detail.groups.map(ownerRow) });
  }
  out.push({
    title: t('Ageing of open work'),
    columns: [{ key: 'label', label: t('Age') }, { key: 'count', label: t('Open tickets') }],
    rows: d.ageing.buckets.map((b) => ({ ...b, label: shown(b.label) })),
  });
  if (d.pingPong.items.length) {
    out.push({
      title: t('Tickets reassigned {n}+ times', { n: d.pingPong.threshold }),
      columns: [
        { key: 'number', label: t('Ticket') },
        { key: 'title', label: t('Short description') },
        { key: 'reassignments', label: t('Reassignments') },
        { key: 'owner', label: t('Assigned to'), person: true },
        { key: 'group', label: t('Group') },
      ],
      rows: d.pingPong.items,
    });
  }
  return out;
}
