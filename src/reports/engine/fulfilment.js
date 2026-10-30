// Request fulfilment: requested items and catalog tasks by state, approvals waiting, and the oldest open items.
import { LIMITS, TICKET_FIELDS } from './constants.js';
import { attempt } from './reader.js';
import { andQuery, byCountDesc, raw, disp, sectionResult, stateClass, sumResults, usableTables, verifiedCount } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { daysBetween, timeOf } from './time.js';

export const FULFILMENT_TABLES = ['sc_req_item', 'sc_task'];

/** State breakdown rows with the class each label belongs to, biggest first. Pure. */
export function stateRows(groups) {
  return groups
    .map((g) => ({ key: g.keys[0]?.value || '', name: g.keys[0]?.display || '(none)', count: g.count, cls: stateClass(g.keys[0]?.display) }))
    .sort(byCountDesc);
}

/** The oldest open items first, across tables, with their age in whole days. Pure. */
export function oldestItems(rowsByTable, now, n = LIMITS.topN) {
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
        ageDays: Number.isFinite(opened) ? daysBetween(opened, now) : null,
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
  const tables = usableTables(ctx).filter((t) => FULFILMENT_TABLES.includes(t.table));
  const asked = ctx.tables.filter((t) => FULFILMENT_TABLES.includes(t.table));
  if (!asked.length) {
    return sectionResult('fulfilment', 'Request fulfilment', ctx, { available: false, reason: 'Turn on Requested items or Catalog tasks in the table list to see request fulfilment.' });
  }
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');

  const parts = await Promise.all(
    tables.map(async (t) => {
      const [states, oldest, openN] = await Promise.all([
        attempt(() => reader.groups(t.table, open, ['state']), t.table),
        attempt(() => reader.rows(t.table, q('active=true', buildQuery([], { orderBy: 'opened_at' })), TICKET_FIELDS, { limit: LIMITS.topN, displayValue: true }), t.table),
        attempt(() => reader.count(t.table, open), t.table),
      ]);
      return { t, states, oldest, openN };
    })
  );
  parts.forEach((p) => {
    const failed = [p.states, p.oldest, p.openN].filter((v) => !v.ok);
    if (failed.length) ctx.access.push({ source: p.t.table, status: failed[0].status, note: `${p.t.meta.label}: ${failed[0].note}` });
  });

  // Approvals: the ones waiting for me, and (for a team) the ones holding up the team's requested items.
  const { mine, team } = await readApprovals(ctx, tables);
  [mine, team].forEach((r) => {
    if (r && !r.ok) ctx.access.push({ source: 'sysapproval_approver', status: r.status, note: approvalNote(r) });
  });

  const openSum = sumResults(parts.map((p) => p.openN));
  return sectionResult('fulfilment', 'Request fulfilment', ctx, {
    available: true,
    byTable: parts.map((p) => ({
      table: p.t.table,
      label: p.t.meta.label,
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
      parts.filter((p) => p.oldest.ok).map((p) => ({ table: p.t.table, label: p.t.meta.label, rows: p.oldest.value })),
      ctx.now
    ),
    // A table whose count failed is not added as 0: the total is then flagged as partial (the tile says so).
    open: openSum.value,
    openPartial: openSum.partial,
  });
}

export const APPROVALS_UNSEEN = 'You can see no approval records at all, so a count of 0 would prove nothing.';
const approvalNote = (r) => (r.status === 'denied' ? 'Approvals are not available to you.' : r.note);

/**
 * Approvals waiting: for the person, and (for a team scope) on the requested items in scope. Shared with the hand-over page.
 * A 0 is believed only when the person can see approval records at all (verifiedCount).
 */
export async function readApprovals(ctx, tables) {
  const { reader, scope } = ctx;
  const mine = await verifiedCount(reader, 'sysapproval_approver', `approver=${scope.userId}^state=requested`, { unseen: APPROVALS_UNSEEN });
  const team =
    scope.kind !== 'mine' && !scope.empty && tables.some((t) => t.table === 'sc_req_item')
      ? await verifiedCount(reader, 'sysapproval_approver', andQuery('state=requested', 'sysapproval.sys_class_name=sc_req_item', `sysapproval.${scope.query}`), { unseen: APPROVALS_UNSEEN })
      : null;
  return { mine, team };
}

export function fulfilmentTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  const out = [];
  d.byTable.forEach((t) => {
    if (t.states) out.push({ title: `${t.label} by state`, columns: [{ key: 'name', label: 'State' }, { key: 'count', label: 'Open' }], rows: t.states });
  });
  out.push({
    title: 'Approvals waiting',
    columns: [{ key: 'what', label: 'Approvals' }, { key: 'count', label: 'Waiting' }],
    rows: [
      { what: 'Waiting for your approval', count: d.approvals.mine ?? 'n/a' },
      ...(d.approvals.team !== undefined ? [{ what: 'On requested items in this scope', count: d.approvals.team ?? 'n/a' }] : []),
    ],
  });
  if (d.oldest.length) {
    out.push({
      title: 'Oldest open items',
      columns: [
        { key: 'number', label: 'Item' },
        { key: 'title', label: 'Short description' },
        { key: 'state', label: 'State' },
        { key: 'ageDays', label: 'Age (days)' },
        { key: 'owner', label: 'Assigned to', person: true },
        { key: 'group', label: 'Group' },
      ],
      rows: d.oldest,
    });
  }
  return out;
}
