// Request fulfilment: requested items and catalog tasks by state, approvals waiting, and the oldest open items.
import { LIMITS, TICKET_FIELDS } from './constants.js';
import { attempt } from './reader.js';
import { tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName } from '../shown.js';
import { andQuery, byCountDesc, raw, disp, sectionResult, stateClass, sumResults, usableTables, verifiedCount } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { localDaysBetween, timeOf } from './time.js';

export const FULFILMENT_TABLES = ['sc_req_item', 'sc_task'];

/** State breakdown rows with the class each label belongs to, biggest first. Pure. */
export function stateRows(groups) {
  return groups
    .map((g) => ({ key: g.keys[0]?.value || '', name: g.keys[0]?.display || tm('(none)'), count: g.count, cls: stateClass(g.keys[0]?.display) }))
    .sort(byCountDesc);
}

/**
 * The oldest open items first, across tables, with their age in calendar days in the person's zone (`tz`, see time.js): 0 is "opened
 * today", never an item opened yesterday evening. Pure.
 */
export function oldestItems(rowsByTable, { now, tz, n = LIMITS.topN }) {
  const items = [];
  rowsByTable.forEach(({ table, label, rows }) => {
    rows.forEach((r) => {
      const opened = timeOf(raw(r.opened_at));
      items.push({
        table,
        label,
        sysId: raw(r.sys_id),
        number: disp(r.number),
        title: disp(r.short_description),
        state: disp(r.state),
        owner: disp(r.assigned_to),
        group: disp(r.assignment_group),
        openedAt: disp(r.opened_at),
        ageDays: Number.isFinite(opened) ? localDaysBetween(opened, now, tz) : null,
        openedMs: Number.isFinite(opened) ? opened : Infinity,
      });
    });
  });
  return items
    .sort((a, b) => a.openedMs - b.openedMs || a.number.localeCompare(b.number))
    .slice(0, n)
    .map(({ openedMs, ...rest }) => rest);
}

export async function fulfilmentSection(ctx) {
  const { reader, scope } = ctx;
  const tables = usableTables(ctx).filter((tableInfo) => FULFILMENT_TABLES.includes(tableInfo.table));
  const asked = ctx.tables.filter((tableInfo) => FULFILMENT_TABLES.includes(tableInfo.table));
  if (!asked.length) {
    return sectionResult('fulfilment', tm('Request fulfilment'), ctx, { available: false, reason: tm('Turn on Requested items or Catalog tasks in the table list to see request fulfilment.') });
  }
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');

  const parts = await Promise.all(
    tables.map(async (tableInfo) => {
      const [states, oldest, openN] = await Promise.all([
        attempt(() => reader.groups(tableInfo.table, open, ['state']), tableInfo.table),
        attempt(() => reader.rows(tableInfo.table, q('active=true', buildQuery([], { orderBy: 'opened_at' })), TICKET_FIELDS, { limit: LIMITS.topN, displayValue: true }), tableInfo.table),
        attempt(() => reader.count(tableInfo.table, open), tableInfo.table),
      ]);
      return { tableInfo, states, oldest, openN };
    })
  );
  parts.forEach((p) => {
    const failed = [p.states, p.oldest, p.openN].filter((v) => !v.ok);
    if (failed.length) ctx.access.push({ source: p.tableInfo.table, status: failed[0].status, note: `${p.tableInfo.meta.label}: ${failed[0].note}` });
  });

  // Approvals: the ones waiting for me, and (for a team) the ones holding up the team's requested items.
  const { mine, team } = await readApprovals(ctx, tables);
  [mine, team].forEach((r) => {
    if (r && !r.ok) ctx.access.push({ source: 'sysapproval_approver', status: r.status, note: approvalNote(r) });
  });

  const openSum = sumResults(parts.map((p) => p.openN));
  return sectionResult('fulfilment', tm('Request fulfilment'), ctx, {
    available: true,
    byTable: parts.map((p) => ({
      table: p.tableInfo.table,
      label: p.tableInfo.meta.label,
      open: p.openN.ok ? p.openN.value : null,
      states: p.states.ok ? stateRows(p.states.value) : null,
      stateQuery: p.states.ok ? Object.fromEntries(stateRows(p.states.value).filter((s) => s.key !== '').map((s) => [s.key, andQuery(open, buildQuery([{ op: 'eq', field: 'state', value: s.key }]))])) : {},
    })),
    approvals: {
      mine: mine.ok ? mine.value : null,
      mineNote: mine.ok ? '' : mine.note,
      team: team ? (team.ok ? team.value : null) : undefined,
      teamNote: team && !team.ok ? team.note : '',
    },
    oldest: oldestItems(
      parts.filter((p) => p.oldest.ok).map((p) => ({ table: p.tableInfo.table, label: p.tableInfo.meta.label, rows: p.oldest.value })),
      { now: ctx.now, tz: ctx.offsetMin }
    ),
    // A table whose count failed is not added as 0: the total is then flagged as partial (the tile says so).
    open: openSum.value,
    openPartial: openSum.partial,
  });
}

export const APPROVALS_UNSEEN = tm('You can see no approval records at all, so a count of 0 would prove nothing.');
const approvalNote = (r) => (r.status === 'denied' ? tm('Approvals are not available to you.') : r.note);

/**
 * Approvals waiting: for the person, and (for a team scope) on the requested items in scope. Shared with the hand-over page.
 * A 0 is believed only when the person can see approval records at all (verifiedCount).
 */
export async function readApprovals(ctx, tables) {
  const { reader, scope } = ctx;
  const mine = await verifiedCount(reader, 'sysapproval_approver', `approver=${scope.userId}^state=requested`, { unseen: APPROVALS_UNSEEN });
  const team =
    scope.kind !== 'mine' && !scope.empty && tables.some((tableInfo) => tableInfo.table === 'sc_req_item')
      ? await verifiedCount(reader, 'sysapproval_approver', andQuery('state=requested', 'sysapproval.sys_class_name=sc_req_item', `sysapproval.${scope.query}`), { unseen: APPROVALS_UNSEEN })
      : null;
  return { mine, team };
}

export function fulfilmentTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  const out = [];
  d.byTable.forEach((x) => {
    if (x.states) out.push({ title: t('{table} by state', { table: shown(x.label) }), columns: [{ key: 'name', label: t('State') }, { key: 'count', label: shown('Open') }], rows: x.states.map((s) => ({ ...s, name: placeholderName(s.name) })) });
  });
  out.push({
    title: t('Approvals waiting'),
    columns: [{ key: 'what', label: t('Approvals') }, { key: 'count', label: t('Waiting') }],
    rows: [
      { what: t('Waiting for your approval'), count: d.approvals.mine ?? t('n/a') },
      ...(d.approvals.team !== undefined ? [{ what: t('On requested items in this scope'), count: d.approvals.team ?? t('n/a') }] : []),
    ],
  });
  if (d.oldest.length) {
    out.push({
      title: t('Oldest open items'),
      columns: [
        { key: 'number', label: t('Item') },
        { key: 'title', label: t('Short description') },
        { key: 'state', label: t('State') },
        { key: 'ageDays', label: t('Age (days)') },
        { key: 'owner', label: t('Assigned to'), person: true },
        { key: 'group', label: t('Group') },
      ],
      rows: d.oldest,
    });
  }
  return out;
}
