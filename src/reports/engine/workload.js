// F2 "Team workload and ageing board": open work by assignee and by group, split by what state it is in, how long it has been
// open, what nobody owns, what nobody touched, and tickets that keep being handed from group to group.
// Counts come from the Aggregate API, so the board is exact however long the queue is.
import { LIMITS, AGE_BUCKETS } from './constants.js';
import { attempt, keyName, nameOf } from './reader.js';
import { tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName } from '../shown.js';
import { andQuery, byCountDesc, clampInt, raw, disp, sectionResult, showsPersonRows, stateClass, STATE_CLASSES, sumResults, topWithOthers, usableTables, notResolved, readOpenStates, openOf } from './common.js';
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
export function foldByOwner(parts, emptyName, hiddenName) {
  const rows = new Map();
  parts.forEach(({ table, groups }) => {
    groups.forEach((g) => {
      const who = g.keys[0] || { value: '', display: '' };
      const state = g.keys[1] || { display: '' };
      const id = who.value || '';
      const row = rows.get(id) || { key: id || NOBODY_KEY, id, name: keyName(who, emptyName, hiddenName), count: 0, classes: emptyClasses(), byTable: {} };
      const cls = stateClass(state.display, { table, value: state.value });
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

/**
 * The questions about the LIVE work of one table (not resolved, waiting to close) that the Workload section and Needs attention both
 * ask, worded once so they are the same requests (one cached read serves both) and give the same numbers: how many were opened within
 * each ageing bucket's days, and how many were handed over often, with the five handed over most. `live` is the condition that leaves
 * the resolved-but-active out (readOpenStates).
 */
export function liveQuestions(ctx, tableInfo, live) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const cumulative = AGE_BUCKETS.filter((b) => b.to !== null).map((b) => attempt(() => reader.count(tableInfo.table, q('active=true', buildQuery([{ op: 'after', field: 'opened_at', ms: now - b.to * DAY }]), live)), tableInfo.table));
  const pingPong = tableInfo.cols.has('reassignment_count');
  const often = buildQuery([{ op: 'gte', field: 'reassignment_count', value: LIMITS.pingPongMin }]);
  return {
    ageCounts: Promise.all(cumulative),
    pingCount: pingPong ? attempt(() => reader.count(tableInfo.table, q('active=true', often, live)), tableInfo.table) : null,
    pingRows: pingPong
      ? attempt(
          () =>
            reader.rows(tableInfo.table, andQuery(q('active=true', often, live), 'ORDERBYDESCreassignment_count'), ['sys_id', 'number', 'short_description', 'assigned_to', 'assignment_group', 'reassignment_count'], { limit: 5, displayValue: true }),
          tableInfo.table
        )
      : null,
  };
}

/** What one table tells Needs attention: its open count (resolved-but-active left out) and the live questions. */
export async function readLive(ctx, tableInfo) {
  const { reader, scope } = ctx;
  const open = andQuery(scope.query, 'active=true');
  const { done, live } = await readOpenStates(reader, tableInfo.table, open);
  const asked = liveQuestions(ctx, tableInfo, live);
  const [openN, ageCounts, pingCount, pingRows] = await Promise.all([attempt(() => reader.count(tableInfo.table, open), tableInfo.table), asked.ageCounts, asked.pingCount, asked.pingRows]);
  return { tableInfo, openN: openOf(openN, done), ageCounts, pingCount, pingRows };
}

async function readTable(ctx, tableInfo) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');
  // Which states mean "resolved, waiting to close" (the Overview asks the same question, so this is a cache hit after it): those
  // tickets are left out of the open, stale, ageing and hand-off numbers, and shown as their own part of the per-person bars.
  const { states, done, live } = await readOpenStates(reader, tableInfo.table, open);
  const staleCut = buildQuery([{ op: 'before', field: 'sys_updated_on', ms: now - clampInt(ctx.params.staleDays, 1, 60, LIMITS.staleDays) * DAY }]);
  const asked = liveQuestions(ctx, tableInfo, live);
  const [openN, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows] = await Promise.all([
    attempt(() => reader.count(tableInfo.table, open), tableInfo.table),
    showsPersonRows(scope) ? attempt(() => reader.groups(tableInfo.table, open, ['assigned_to', 'state']), tableInfo.table) : null,
    scope.kind === 'mine' ? null : attempt(() => reader.groups(tableInfo.table, open, ['assignment_group', 'state']), tableInfo.table),
    scope.unassignedMeaningful ? attempt(() => reader.count(tableInfo.table, q('active=true', 'assigned_toISEMPTY', live)), tableInfo.table) : null,
    attempt(() => reader.count(tableInfo.table, q('active=true', staleCut, live)), tableInfo.table),
    asked.ageCounts,
    asked.pingCount,
    asked.pingRows,
  ]);
  return { tableInfo, openN: openOf(openN, done), resolvedActive: states.ok ? done.count : null, doneValues: done.values, byAssignee, byGroup, unassigned, stale, ageCounts, pingCount, pingRows };
}

/**
 * The ageing of open work, per table and in total, from what readTable / readLive read. A table whose open count or any ageing count
 * could not be read is left OUT, and `left` says how many: the total is then lower than the open count, never a silent gap. Pure.
 */
export function summarizeAgeing(parts) {
  const whole = parts.filter((p) => p.openN.ok && p.ageCounts.every((c) => c.ok));
  const byTable = whole.map((p) => ({ table: p.tableInfo.table, label: p.tableInfo.meta.label, open: p.openN.value, buckets: ageBuckets(p.openN.value, p.ageCounts.map((c) => c.value)) }));
  const buckets = AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: byTable.reduce((n, a) => n + a.buckets[i].count, 0) }));
  return { buckets, byTable, open: byTable.reduce((n, a) => n + a.open, 0), left: parts.length - whole.length };
}

/**
 * The tickets handed over often (LIMITS.pingPongMin or more times), from what readTable / readLive read. `count` adds up the tables that
 * could be counted; a table that could not be counted, or has no hand-off count at all, makes it "at least" (`partial`), never a total.
 * `items`: the five handed over most, across tables, with the person's name as the platform shows it. Pure.
 */
export function summarizeReassigned(parts) {
  const counted = parts.filter((p) => p.pingCount && p.pingCount.ok);
  return {
    available: counted.length > 0,
    threshold: LIMITS.pingPongMin,
    count: counted.reduce((n, p) => n + p.pingCount.value, 0),
    // Some ticket type could not be counted (a failed read, or it has no hand-off count): the number is at least this.
    partial: counted.length < parts.length,
    // The list of the five was not read for every table that was counted: it may miss some of them.
    listPartial: counted.some((p) => !p.pingRows || !p.pingRows.ok),
    items: counted
      .flatMap((p) =>
        p.pingRows?.ok
          ? p.pingRows.value.map((r) => ({
              table: p.tableInfo.table,
              label: p.tableInfo.meta.label,
              sysId: raw(r.sys_id),
              number: disp(r.number),
              title: disp(r.short_description),
              // nameOf, not disp: a person this user may not see is "not shown to you", never "unassigned" (rule 9)
              owner: nameOf(r.assigned_to),
              group: nameOf(r.assignment_group),
              reassignments: Number(raw(r.reassignment_count)) || 0,
            }))
          : []
      )
      .sort((a, b) => b.reassignments - a.reassignments || a.number.localeCompare(b.number))
      .slice(0, 5),
  };
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
    // (the age and hand-off reads too: a failed one used to leave a number lower than it was with nothing said)
    const failed = [p.openN, p.byAssignee, p.byGroup, p.unassigned, p.stale, ...p.ageCounts, p.pingCount, p.pingRows].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.tableInfo.table, status: failed[0].status, note: `${p.tableInfo.meta.label}: ${failed[0].note}` });
  });

  const openSum = sumResults(parts.map((p) => p.openN));
  const unassignedSum = scope.unassignedMeaningful ? sumResults(parts.map((p) => p.unassigned)) : null;
  const staleSum = sumResults(parts.map((p) => p.stale));

  const fold = (key, emptyName, hiddenName) => {
    const usable = parts.filter((p) => p[key]?.ok);
    return foldByOwner(usable.map((p) => ({ table: p.tableInfo.table, groups: p[key].value })), emptyName, hiddenName);
  };
  const assigneeRows = showsPersonRows(scope) ? fold('byAssignee', tm('(unassigned)'), tm('A person you cannot see')) : [];
  const groupRows = scope.kind === 'mine' ? [] : fold('byGroup', tm('(no group)'), tm('A group you cannot see'));
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

  // Ageing, per table and in total (a table left out is said, not hidden in a lower total).
  const ageing = summarizeAgeing(parts);
  if (ageing.left) ctx.notes.push(tm('Some ticket types could not be aged, so the ageing leaves them out.'));

  // Reassignment ping-pong (one function, shared with Needs attention, so the two always agree).
  const pingPong = summarizeReassigned(parts);
  if (!pingPong.available) ctx.notes.push(tm('Reassignment counts are not available on these ticket types, so hand-offs are not shown.'));
  else if (pingPong.partial) ctx.notes.push(tm('Some ticket types could not be checked for hand-offs, so the number of tickets handed over often may be low.'));

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
    ageing: { buckets: ageing.buckets, byTable: ageing.byTable, open: ageing.open, left: ageing.left, queries: ageQueries(ctx), queriesByTable: Object.fromEntries(parts.map((p) => [p.tableInfo.table, ageQueries(ctx, p.doneValues)])) },
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
