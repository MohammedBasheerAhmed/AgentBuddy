// F2 "Team workload and ageing board": open work by assignee and by group, split by what state it is in, how long it has been
// open, what nobody owns, what nobody touched, and tickets that keep being handed from group to group.
// Counts come from the Aggregate API, so the board is exact however long the queue is.
import { LIMITS, AGE_BUCKETS } from './constants.js';
import { attempt } from './reader.js';
import { andQuery, byCountDesc, clampInt, raw, disp, sectionResult, stateClass, STATE_CLASSES, sumResults, topWithOthers, usableTables } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { DAY } from './time.js';

const emptyClasses = () => Object.fromEntries(STATE_CLASSES.map((c) => [c.key, 0]));

/**
 * Fold "assignee x state" (or "group x state") groups from several tables into one row per person or group.
 * @param {{table:string, groups: ReturnType<import('./reader.js').normalizeGroups>}[]} parts
 * @returns {{ key, id, name, count, classes, byTable }[]} busiest first
 */
export function foldByOwner(parts, emptyName) {
  const rows = new Map();
  parts.forEach(({ table, groups }) => {
    groups.forEach((g) => {
      const who = g.keys[0] || { value: '', display: '' };
      const state = g.keys[1] || { display: '' };
      const key = who.value || '';
      const row = rows.get(key) || { key, id: key, name: who.display || emptyName, count: 0, classes: emptyClasses(), byTable: {} };
      const cls = stateClass(state.display);
      row.count += g.count;
      row.classes[cls] += g.count;
      row.byTable[table] = (row.byTable[table] || 0) + g.count;
      rows.set(key, row);
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

async function readTable(ctx, t) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');
  const staleCut = buildQuery([{ op: 'before', field: 'sys_updated_on', ms: now - clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays) * DAY }]);
  const cumulative = AGE_BUCKETS.filter((b) => b.to !== null).map((b) => attempt(() => reader.count(t.table, q('active=true', buildQuery([{ op: 'after', field: 'opened_at', ms: now - b.to * DAY }]))), t.table));
  const pingPong = t.cols.has('reassignment_count');
  const [openN, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows] = await Promise.all([
    attempt(() => reader.count(t.table, open), t.table),
    scope.kind === 'mine' ? null : attempt(() => reader.groups(t.table, open, ['assigned_to', 'state']), t.table),
    scope.kind === 'mine' ? null : attempt(() => reader.groups(t.table, open, ['assignment_group', 'state']), t.table),
    scope.unassignedMeaningful ? attempt(() => reader.count(t.table, q('active=true', 'assigned_toISEMPTY')), t.table) : null,
    attempt(() => reader.count(t.table, q('active=true', staleCut)), t.table),
    Promise.all(cumulative),
    pingPong ? attempt(() => reader.count(t.table, q('active=true', buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }]))), t.table) : null,
    pingPong
      ? attempt(
          () =>
            reader.rows(t.table, q('active=true', buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }], { orderBy: 'reassignment_count', descending: true })), ['sys_id', 'number', 'short_description', 'assigned_to', 'assignment_group', 'reassignment_count'], { limit: 5, displayValue: true }),
          t.table
        )
      : null,
  ]);
  return { t, openN, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows };
}

/** For a click on an ageing cell: the query for the tickets in that age bucket (the same dates the counts used). */
function ageQueries({ scope, now }) {
  return Object.fromEntries(
    AGE_BUCKETS.map((b) => {
      const conditions = [];
      if (b.to !== null) conditions.push({ op: 'after', field: 'opened_at', ms: now - b.to * DAY });
      if (b.from > 0) conditions.push({ op: 'until', field: 'opened_at', ms: now - b.from * DAY });
      return [b.key, andQuery(scope.query, 'active=true', buildQuery(conditions))];
    })
  );
}

export async function workloadSection(ctx) {
  const tables = usableTables(ctx);
  const parts = await Promise.all(tables.map((t) => readTable(ctx, t)));
  const { scope } = ctx;

  // Why a number is missing, once per table.
  parts.forEach((p) => {
    const failed = [p.openN, p.byAssignee, p.byGroup, p.unassigned, p.stale].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.t.table, status: failed[0].status, note: `${p.t.meta.label}: ${failed[0].note}` });
  });

  const openSum = sumResults(parts.map((p) => p.openN));
  const unassignedSum = scope.unassignedMeaningful ? sumResults(parts.map((p) => p.unassigned)) : null;
  const staleSum = sumResults(parts.map((p) => p.stale));

  const fold = (key, emptyName) => {
    const usable = parts.filter((p) => p[key]?.ok);
    return foldByOwner(usable.map((p) => ({ table: p.t.table, groups: p[key].value })), emptyName);
  };
  const assigneeRows = scope.kind === 'mine' ? [] : fold('byAssignee', '(unassigned)');
  const groupRows = scope.kind === 'mine' ? [] : fold('byGroup', '(no group)');
  // For a click on a row: the query that lists exactly that person's (or group's) open tickets, per table.
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
    .map((p) => ({ table: p.t.table, label: p.t.meta.label, open: p.openN.value, buckets: ageBuckets(p.openN.value, p.ageCounts.map((c) => c.value)) }));
  const ageTotal = AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: ageTables.reduce((n, a) => n + a.buckets[i].count, 0) }));

  // Reassignment ping-pong.
  const ppParts = parts.filter((p) => p.pingCount);
  const pingOk = ppParts.filter((p) => p.pingCount.ok);
  const pingPong = {
    available: pingOk.length > 0,
    threshold: LIMITS.pingPongMin,
    count: pingOk.reduce((n, p) => n + p.pingCount.value, 0),
    items: pingOk
      .flatMap((p) => (p.pingRows?.ok ? p.pingRows.value.map((r) => ({ table: p.t.table, label: p.t.meta.label, sysId: raw(r.sys_id), number: disp(r.number), title: disp(r.short_description), owner: disp(r.assigned_to), group: disp(r.assignment_group), reassignments: Number(raw(r.reassignment_count)) || 0 })) : []))
      .sort((a, b) => b.reassignments - a.reassignments)
      .slice(0, 5),
  };
  if (!pingPong.available) ctx.notes.push('Reassignment counts are not available on these tables, so hand-offs are not shown.');

  const staleDays = clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays);
  const topN = clampInt(ctx.params.top, 3, 30, 12);

  return sectionResult('workload', 'Workload and ageing', ctx, {
    totals: {
      open: openSum.value,
      openPartial: openSum.partial,
      unassigned: unassignedSum ? unassignedSum.value : null,
      stale: staleSum.value,
    },
    staleDays,
    classes: STATE_CLASSES,
    byAssignee: topWithOthers(assigneeRows, topN, 'Other people'),
    byGroup: topWithOthers(groupRows, topN, 'Other groups'),
    assigneeCount: assigneeRows.length,
    groupCount: groupRows.length,
    ageing: { buckets: ageTotal, byTable: ageTables, open: ageTables.reduce((n, a) => n + a.open, 0), queries: ageQueries(ctx) },
    pingPong,
    detail: { assignees: assigneeRows, groups: groupRows },
  });
}

export function workloadTables(result) {
  const d = result.data;
  if (!d) return [];
  const classCols = d.classes.map((c) => ({ key: c.key, label: c.label }));
  const ownerRow = (r) => ({ name: r.name, total: r.count, ...r.classes });
  const out = [];
  if (d.detail.assignees.length) {
    out.push({ title: 'Open work by person', columns: [{ key: 'name', label: 'Person', person: true }, { key: 'total', label: 'Open' }, ...classCols], rows: d.detail.assignees.map(ownerRow) });
  }
  if (d.detail.groups.length) {
    out.push({ title: 'Open work by group', columns: [{ key: 'name', label: 'Group' }, { key: 'total', label: 'Open' }, ...classCols], rows: d.detail.groups.map(ownerRow) });
  }
  out.push({
    title: 'Ageing of open work',
    columns: [{ key: 'label', label: 'Age' }, { key: 'count', label: 'Open tickets' }],
    rows: d.ageing.buckets,
  });
  if (d.pingPong.items.length) {
    out.push({
      title: `Tickets reassigned ${d.pingPong.threshold}+ times`,
      columns: [
        { key: 'number', label: 'Ticket' },
        { key: 'title', label: 'Short description' },
        { key: 'reassignments', label: 'Reassignments' },
        { key: 'owner', label: 'Assigned to', person: true },
        { key: 'group', label: 'Group' },
      ],
      rows: d.pingPong.items,
    });
  }
  return out;
}
