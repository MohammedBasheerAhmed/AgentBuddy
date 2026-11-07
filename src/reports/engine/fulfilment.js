// Request fulfilment: requests, requested items and the tasks of a catalog, a customer service case and an HR case by state, approvals
// waiting, the oldest open items, and a count of the other kinds of ticket in scope (a custom class, another product's own).
import { TABLE_RE } from '../../context/util.js';
import { isSensitiveTable } from '../../context/kinds.js';
import { tableLabel } from '../../lib/tableLabels.js';
import { LIMITS, REPORT_TABLES, TICKET_FIELDS } from './constants.js';
import { attempt, nameOf } from './reader.js';
import { say, tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName, stateShown } from '../shown.js';
import { andQuery, byCountDesc, raw, disp, sectionResult, stateClass, stateName, sumResults, usableTables, verifiedCount, readOpenStates, openOf } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { localDaysBetween, timeOf } from './time.js';

export const FULFILMENT_TABLES = ['sc_request', 'sc_req_item', 'sc_task', 'sn_customerservice_task', 'sn_hr_core_task'];

/** State breakdown rows of one table with the class each state belongs to, biggest first. A state with no label is named by what it means. Pure. */
export function stateRows(groups, table = '') {
  return groups
    .map((g) => {
      const key = g.keys[0];
      const { name, plain } = stateName(key, table);
      return { key: key?.value || '', name, plain, count: g.count, cls: stateClass(key?.display, { table, value: key?.value }) };
    })
    .sort(byCountDesc);
}

/**
 * The kinds of ticket in the scope that no ticket type of the reports covers: a custom class, another product's own. From one count of
 * the active tickets by class. A class of the ticket types list is counted there, not here; a sensitive class (HR, security, risk...) and
 * a class the organisation's policy blocks are never listed, and their tickets are counted in `left` so the section can say that some
 * are not counted. Pure.
 * @param {{ keys: { value: string, display: string }[], count: number }[]} groups
 * @returns {{ items: { table: string, label: string, count: number }[], more: boolean, left: number }}
 */
export function otherKinds(groups, { allowSensitive = false, sensitivePrefixes = [], isBlocked = () => false, max = 20 } = {}) {
  const items = [];
  let left = 0;
  for (const g of Array.isArray(groups) ? groups : []) {
    const key = g?.keys?.[0] || {};
    const table = String(key.value || '').toLowerCase();
    if (!TABLE_RE.test(table) || !(g.count > 0)) continue;
    if (isSensitiveTable(table, sensitivePrefixes)) {
      // (the HR family is counted by the HR case and HR task types, when the person may see them)
      if (!(allowSensitive && table.startsWith('sn_hr_'))) left += g.count;
      continue;
    }
    if (Object.hasOwn(REPORT_TABLES, table)) continue;
    if (isBlocked(table)) {
      left += g.count;
      continue;
    }
    const existing = items.find((x) => x.table === table);
    if (existing) existing.count += g.count;
    else items.push({ table, label: tableLabel(table, { plural: true, sentenceCase: true, english: true, instanceLabel: key.display }), count: g.count });
  }
  items.sort(byCountDesc);
  return { items: items.slice(0, max), more: items.length > max, left };
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
        ...stateOf(r, table),
        owner: nameOf(r.assigned_to),
        group: nameOf(r.assignment_group),
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

// The state of a ticket row: the label shown; with none (only the stored number), the plain word for what it means (`statePlain`).
const stateOf = (row, table) => {
  const { name, plain } = stateName({ display: disp(row.state), value: raw(row.state) }, table);
  return { state: name, statePlain: plain };
};

export async function fulfilmentSection(ctx) {
  const { reader, scope } = ctx;
  const tables = usableTables(ctx).filter((tableInfo) => FULFILMENT_TABLES.includes(tableInfo.table));
  const asked = ctx.tables.filter((tableInfo) => FULFILMENT_TABLES.includes(tableInfo.table));
  if (!asked.length) {
    return sectionResult('fulfilment', tm('Request fulfilment'), ctx, { available: false, reason: tm('Turn on Requested items or Catalog tasks in the ticket types list to see request fulfilment.') });
  }
  const q = (...extra) => andQuery(scope.query, ...extra);
  const open = q('active=true');

  const parts = await Promise.all(
    tables.map(async (tableInfo) => {
      // The same "open" as the Overview and the Workload: active, less the resolved-but-active (one cached state breakdown serves all
      // three). The state bars below still show every active state, the resolved one included, as its own bar.
      const { states, done, live } = await readOpenStates(reader, tableInfo.table, open);
      const [oldest, counted] = await Promise.all([
        attempt(() => reader.rows(tableInfo.table, q('active=true', live, buildQuery([], { orderBy: 'opened_at' })), TICKET_FIELDS, { limit: LIMITS.topN, displayValue: true }), tableInfo.table),
        attempt(() => reader.count(tableInfo.table, open), tableInfo.table),
      ]);
      return { tableInfo, states, oldest, openN: openOf(counted, done) };
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

  // The other kinds of ticket in scope (a custom class, another product's own): one count of the active tickets by class. A count that
  // could not be made is said, never shown as none.
  const kinds = await attempt(() => reader.groups('task', open, ['sys_class_name']), 'task');
  let other = { items: [], more: false, left: 0 };
  if (kinds.ok) {
    other = otherKinds(kinds.value, { allowSensitive: ctx.allowSensitive, sensitivePrefixes: ctx.sensitivePrefixes, isBlocked: (table) => reader.isBlocked(table) });
    if (other.left) ctx.notes.push(tm('Some kinds of ticket are not counted: your organisation keeps them out of Agent Buddy.'));
    if (other.more) ctx.notes.push(say(tm('Only the {max} biggest kinds of ticket are listed.'), { max: other.items.length }));
  } else {
    ctx.access.push({ source: 'task', status: kinds.status, note: `${tm('Other kinds of ticket')}: ${kinds.note}` });
  }

  const openSum = sumResults(parts.map((p) => p.openN));
  return sectionResult('fulfilment', tm('Request fulfilment'), ctx, {
    available: true,
    byTable: parts.map((p) => ({
      table: p.tableInfo.table,
      label: p.tableInfo.meta.label,
      open: p.openN.ok ? p.openN.value : null,
      states: p.states.ok ? stateRows(p.states.value, p.tableInfo.table) : null,
      stateQuery: p.states.ok ? Object.fromEntries(stateRows(p.states.value, p.tableInfo.table).filter((s) => s.key !== '').map((s) => [s.key, andQuery(open, buildQuery([{ op: 'eq', field: 'state', value: s.key }]))])) : {},
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
    // (`query` lists the active tickets of the scope in any of those classes)
    other: { available: kinds.ok, items: other.items, more: other.more, query: open },
  });
}

export const APPROVALS_UNSEEN = tm('You can\'t see any approvals at all, so a count of 0 would prove nothing.');
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
    if (x.states) out.push({ title: t('{table} by state', { table: shown(x.label) }), columns: [{ key: 'name', label: t('State') }, { key: 'count', label: shown('Open') }], rows: x.states.map((s) => ({ ...s, name: s.plain ? shown(s.name) : placeholderName(s.name) })) });
  });
  if (d.other?.items?.length) {
    out.push({ title: t('Other kinds of ticket'), columns: [{ key: 'label', label: t('Ticket type') }, { key: 'count', label: t('Tickets') }], rows: d.other.items.map((x) => ({ ...x, label: shown(x.label) })) });
  }
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
      rows: d.oldest.map((item) => ({ ...item, state: stateShown(item) })),
    });
  }
  return out;
}
