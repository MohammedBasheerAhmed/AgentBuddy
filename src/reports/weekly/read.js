// The reads behind "My week" and the weekly report (round 5, docs/round5.md). GET only, through the reports engine's reader (counts from the
// Aggregate API, a few columns of the rows that are needed), with the person's own session: ACLs decide what comes back. Pure given the
// reader (tests/round5-weekly-read.test.js drives it with a fake instance). Nothing is stored; nothing leaves ServiceNow.
//
// What each number is, and when it is LEFT OUT (never zero, never made up):
//   Came in          tickets opened in the week. Left out when any ticket type could not be counted.
//   Closed           tickets resolved (else closed) in the week. Same.
//   Backlog change   came in minus closed, both exact counts. Same.
//   SLA kept         SLAs that came due in the week (planned end inside it, not cancelled, not paused) that were not breached. Left out
//                    when SLAs cannot be seen, or when none came due.
//   Reopened         closed tickets that carry a reopen count above zero, of the closed tickets of the types that have the column
//                    (incidents). Left out when no type has it. It counts tickets that CAME BACK, however much later.
//   My week only:    typical time to resolve (median, opened to closed), average first reply (the first customer-visible comment by
//                    somebody other than the customer, from the ticket being opened), answered inside the SLA (of the closed tickets
//                    that had an SLA). Each is left out under `minSample` tickets, and when the read was cut short.
import { SYS_ID_RE, raw, disp, parseSnTime, oneLine } from '../../context/util.js';
import { reachesCustomer, customerColumn } from '../../mywork/tables.js';
import { worstSla, riskOf, SLA_COLUMNS } from '../myDay.js';
import { attempt, keyName } from '../engine/reader.js';
import { andQuery, resolvedColumn, usableTables, readOpenStates, verifiedCount } from '../engine/common.js';
import { buildQuery } from '../engine/queryBuilder.js';
import { SLA_UNSEEN } from '../engine/sla.js';
import { localDaysBetween } from '../engine/time.js';
import { say, tm } from '../engine/say.js';
import { WEEKLY_LIMITS, areaBars, causeDecision, decisionsFrom, firstReplies, loadDecision, notesDecision, percentOf, replySummary, strictSum, typicalTime } from './figures.js';

export const READ_LIMITS = Object.freeze({
  rowsMax: 400, // closed tickets of one type read for the person's own week
  slaChunk: 50, // tickets per read of their SLAs
  replyChunk: 15, // tickets per read of their comments (oldest first, so a cut can only lose the later ones)
  replyRows: 400, // comment rows per chunk
  replyTicketsMax: 120, // more tickets than this: the first reply is not worked out
  numbersMax: 5, // ticket numbers kept for the AI line
});

// The types whose closing carries a "fix note" (the close notes). Another type has no such habit, so no note is asked of it.
const NOTE_TABLES = Object.freeze(['incident', 'problem', 'sn_customerservice_case']);

const range = (field, w) =>
  buildQuery([
    { op: 'since', field, ms: w.start },
    { op: 'before', field, ms: w.end },
  ]);
const facts = (t) => ({ rf: resolvedColumn(t), qual: t.meta.quality, has: (c) => Boolean(c) && t.cols.has(c) });
const columnsOf = (list) => [...new Set(list.filter(Boolean))];

/**
 * The ticket types the weekly numbers are counted over: the ones the person can read AND that have a closing date. A type with no closing
 * date (the instance has no such column, or hides it from this person) cannot be counted as "closed", and a "Closed" or "Backlog" that
 * silently left a type out would not be a total: so the type is left out of EVERY number, and one note says so.
 */
export function countableTables(ctx) {
  const usable = usableTables(ctx);
  const counted = usable.filter((t) => resolvedColumn(t));
  usable.filter((t) => !counted.includes(t)).forEach((t) => ctx.notes.push(say(tm('{table} are not counted: there is no closing date to work from.'), { table: t.meta.label })));
  return counted;
}

const fail = (ctx, source, got, label) => {
  if (got && !got.ok) ctx.access.push({ source, status: got.status, note: `${label}: ${got.note}` });
  return got;
};

// ---- Fix notes -------------------------------------------------------------------------------------------------------------------

/**
 * Closed tickets of one type that carry no fix note: { without, numbers } or null when the type has no such notes or the instance has no
 * `close_notes` column. The column is probed WITHOUT reading a note: the one row asked for is one whose notes are empty. A condition on a
 * column the instance does not have may be ignored (every closed ticket would then match), so a row that comes back without the column is
 * the answer "there is no such column", not "no fix note".
 */
export async function readFixNotes(ctx, tableInfo, closedQuery, { numbers = false, reopenedToo = false } = {}) {
  const T = tableInfo.table;
  if (!NOTE_TABLES.includes(T) || !closedQuery) return null;
  const { reader } = ctx;
  const empty = andQuery(closedQuery, buildQuery([{ op: 'empty', field: 'close_notes' }]));
  const probe = await attempt(() => reader.rows(T, empty, ['sys_id', 'close_notes'], { limit: 1 }), T);
  if (!probe.ok) return { ok: false, status: probe.status, note: probe.note };
  if (probe.value.length && !Object.prototype.hasOwnProperty.call(probe.value[0], 'close_notes')) return null; // no such column here
  if (!probe.value.length) return { ok: true, without: 0, numbers: [], reopenedWithout: 0 };
  const [count, list, again] = await Promise.all([
    attempt(() => reader.count(T, empty), T),
    numbers ? attempt(() => reader.rows(T, empty, ['sys_id', 'number'], { limit: READ_LIMITS.numbersMax }), T) : null,
    reopenedToo && facts(tableInfo).has(facts(tableInfo).qual.reopen) ? attempt(() => reader.count(T, andQuery(empty, buildQuery([{ op: 'gt', field: facts(tableInfo).qual.reopen, value: 0 }]))), T) : null,
  ]);
  if (!count.ok) return { ok: false, status: count.status, note: count.note };
  return {
    ok: true,
    without: count.value,
    numbers: list?.ok ? list.value.map((r) => oneLine(disp(r.number) || raw(r.number), 40)).filter(Boolean) : [],
    reopenedWithout: again?.ok ? again.value : null,
  };
}

// ---- SLAs of a week ----------------------------------------------------------------------------------------------------------------

/** { ok, total, breached } of the SLAs that came due in window `w`, for the tickets in scope; or the failed attempt. */
export async function readSlaWeek(ctx, tables, w) {
  const { reader, scope } = ctx;
  const names = tables.map((t) => t.table);
  if (!names.length) return { ok: false, status: 'error', note: tm('No ticket type can be read.') };
  // "Came due in the week": the planned end is inside it. A cancelled SLA never counted; a paused one is not counting down.
  const base = andQuery(`task.sys_class_nameIN${names.join(',')}`, scope.taskQuery, range('planned_end_time', w), 'stage!=cancelled', 'stage!=paused');
  const total = await verifiedCount(reader, 'task_sla', base, { unseen: SLA_UNSEEN });
  if (!total.ok) return total;
  const breached = await attempt(() => reader.count('task_sla', andQuery(base, 'has_breached=true')), 'task_sla');
  if (!breached.ok) return breached;
  return { ok: true, total: total.value, breached: Math.min(breached.value, total.value) };
}

const slaNumber = (week) => (week?.ok && week.total > 0 ? { percent: percentOf(week.total - week.breached, week.total), total: week.total, kept: week.total - week.breached } : null);

// ---- The weekly report: a team --------------------------------------------------------------------------------------------------------

async function teamTable(ctx, tableInfo) {
  const { reader, scope, windows } = ctx;
  const T = tableInfo.table;
  const { rf, qual, has } = facts(tableInfo);
  const q = (...x) => andQuery(scope.query, ...x);
  const closedQ = (w) => (rf ? q(range(rf, w)) : '');
  const reopenCol = rf && has(qual.reopen);
  const opened = (w) => attempt(() => reader.count(T, q(range('opened_at', w))), T);
  const closed = (w) => (rf ? attempt(() => reader.count(T, closedQ(w)), T) : null);
  const reopened = (w) => (reopenCol ? attempt(() => reader.count(T, andQuery(closedQ(w), buildQuery([{ op: 'gt', field: qual.reopen, value: 0 }]))), T) : null);

  const [cameIn, cameInBefore, closedNow, closedBefore, reopenedNow, reopenedBefore] = await Promise.all([
    opened(windows.current),
    opened(windows.previous),
    closed(windows.current),
    closed(windows.previous),
    reopened(windows.current),
    reopened(windows.previous),
  ]);
  const closedN = closedNow?.ok ? closedNow.value : 0;

  const [areas, cis, load, notes] = await Promise.all([
    // Where the week went: closed tickets by category; a type without one is one bar of its own name.
    rf && closedN > 0 && has(qual.category) ? attempt(() => reader.groups(T, closedQ(windows.current), [qual.category]), T) : null,
    has(qual.ci) && cameIn.ok && cameIn.value >= WEEKLY_LIMITS.causeMin ? attempt(() => reader.groups(T, q(range('opened_at', windows.current)), [qual.ci], { minCount: WEEKLY_LIMITS.causeMin }), T) : null,
    scope.kind !== 'mine'
      ? readOpenStates(reader, T, q('active=true')).then(({ live }) => attempt(() => reader.groups(T, q('active=true', 'assigned_toISNOTEMPTY', live), ['assigned_to']), T))
      : null,
    rf && closedN > 0 ? readFixNotes(ctx, tableInfo, closedQ(windows.current), { numbers: true }) : null,
  ]);

  [cameIn, cameInBefore, closedNow, closedBefore, reopenedNow, reopenedBefore, areas, cis, load].forEach((got) => fail(ctx, T, got, tableInfo.meta.label));
  if (notes && !notes.ok) fail(ctx, T, notes, tableInfo.meta.label);

  return { tableInfo, rf, qual, cameIn, cameInBefore, closedNow, closedBefore, reopenCol, reopenedNow, reopenedBefore, areas, cis, load, notes, hasCategory: has(qual.category) };
}

/** The closed tickets of the week by area, from the per-table reads; null when one could not be read. Pure. */
export function teamAreas(parts) {
  const items = [];
  for (const p of parts) {
    if (!p.closedNow?.ok) return null;
    if (p.closedNow.value === 0) continue;
    if (p.hasCategory) {
      if (!p.areas?.ok) return null;
      for (const g of p.areas.value) {
        const key = g.keys[0] || {};
        // A category the person cannot see the name of is "not shown to you", our word; a plain empty one is "no category set".
        items.push({ name: key.display || (key.value ? keyName(key, '') : ''), count: g.count, plain: !key.display });
      }
    } else {
      items.push({ name: p.tableInfo.meta.label, count: p.closedNow.value, plain: true });
    }
  }
  return areaBars(items);
}

/** The decisions of the week from the per-table reads. Pure. */
export function teamDecisions(parts, scope) {
  // 1. One likely cause: the configuration item most tickets of the week share.
  const candidates = new Map();
  let causeReadable = true;
  for (const p of parts) {
    if (!p.cis) continue;
    if (!p.cis.ok) {
      causeReadable = false;
      continue;
    }
    for (const g of p.cis.value) {
      const key = g.keys[0] || {};
      if (!SYS_ID_RE.test(key.value || '')) continue;
      const id = key.value.toLowerCase();
      const entry = candidates.get(id) || { id, name: key.display || '', count: 0, table: p.tableInfo.table, field: p.qual.ci };
      entry.count += g.count;
      candidates.set(id, entry);
    }
  }
  const cause = causeReadable ? causeDecision([...candidates.values()]) : null;
  if (cause) {
    const hit = candidates.get(cause.ciId);
    cause.field = hit?.field || '';
  }

  // 2. Load on a few people (only where a team is in scope, and only when every type's open tickets were counted).
  let load = null;
  if (scope.kind !== 'mine' && parts.every((p) => p.load?.ok)) {
    const perPerson = new Map();
    for (const p of parts) {
      for (const g of p.load.value) {
        const id = g.keys[0]?.value;
        if (id) perPerson.set(id, (perPerson.get(id) || 0) + g.count);
      }
    }
    load = loadDecision([...perPerson.values()]);
  }

  // 3. Closes without a fix note (the types that carry one, every one of them read).
  const noted = parts.filter((p) => p.notes !== null && p.notes !== undefined);
  let notes = null;
  if (noted.length && noted.every((p) => p.notes.ok && p.closedNow?.ok)) {
    const closed = noted.reduce((n, p) => n + p.closedNow.value, 0);
    const without = noted.reduce((n, p) => n + p.notes.without, 0);
    notes = notesDecision(closed, without);
    if (notes) notes.numbers = noted.flatMap((p) => p.notes.numbers).slice(0, READ_LIMITS.numbersMax);
  }
  return decisionsFrom({ cause, load, notes });
}

/** The oldest open tickets (the PDF's table), each with whether its SLA is breached or at risk. */
async function readOldest(ctx, tables) {
  const { reader, scope, now, offsetMin } = ctx;
  const fields = ['sys_id', 'number', 'short_description', 'opened_at', 'sys_class_name'];
  const lists = await Promise.all(
    tables.map(async (t) => {
      const { live } = await readOpenStates(reader, t.table, andQuery(scope.query, 'active=true'));
      const got = await attempt(() => reader.rows(t.table, `${andQuery(scope.query, 'active=true', live)}^ORDERBYopened_at`, fields, { limit: WEEKLY_LIMITS.oldestMax, displayValue: true }), t.table);
      fail(ctx, t.table, got, t.meta.label);
      return got.ok ? got.value.map((r) => ({ table: t.table, sysId: raw(r.sys_id).toLowerCase(), number: oneLine(disp(r.number) || raw(r.number), 40), title: oneLine(disp(r.short_description), 160), openedAt: parseSnTime(raw(r.opened_at)) })) : null;
    })
  );
  if (lists.every((l) => l === null)) return null;
  const oldest = lists
    .flat()
    .filter((x) => x && SYS_ID_RE.test(x.sysId) && x.number && Number.isFinite(x.openedAt))
    .sort((a, b) => a.openedAt - b.openedAt)
    .slice(0, WEEKLY_LIMITS.oldestMax);
  let slaKnown = false;
  const risks = new Map();
  if (oldest.length) {
    const got = await attempt(() => reader.rows('task_sla', andQuery('active=true', buildQuery([{ op: 'in', field: 'task', values: oldest.map((x) => x.sysId) }])), [...SLA_COLUMNS], { limit: oldest.length * 4, displayValue: true }), 'task_sla');
    if (got.ok) {
      slaKnown = true;
      const byTask = new Map();
      got.value.forEach((r) => {
        const id = raw(r.task).toLowerCase();
        if (!byTask.has(id)) byTask.set(id, []);
        byTask.get(id).push(r);
      });
      byTask.forEach((rows, id) => risks.set(id, riskOf(worstSla(rows))));
      // No SLA row at all may be a person who cannot see SLAs: only a table with something visible proves "no SLA" (rule 9).
      if (!got.value.length) slaKnown = (await reader.visibility('task_sla')).status === 'ok';
    }
  }
  return oldest.map((x) => ({
    table: x.table,
    sysId: x.sysId,
    number: x.number,
    title: x.title,
    ageDays: localDaysBetween(x.openedAt, now, offsetMin),
    // 'breached' | 'at-risk' | 'ok' | 'none' (no SLA) | null (SLAs cannot be seen)
    sla: slaKnown ? risks.get(x.sysId) || 'none' : null,
  }));
}

/**
 * The weekly report's numbers for the scope. Resolves to plain JSON (no functions): see the shape in the comments below.
 * @returns {Promise<object>}
 */
export async function readTeamWeek(ctx) {
  const tables = countableTables(ctx);
  const { windows } = ctx;
  const leftOut = [];
  const left = (key, why) => leftOut.push({ key, why });

  const [parts, slaNow, slaBefore, oldest] = await Promise.all([
    Promise.all(tables.map((t) => teamTable(ctx, t))),
    readSlaWeek(ctx, tables, windows.current),
    readSlaWeek(ctx, tables, windows.previous),
    readOldest(ctx, tables),
  ]);
  fail(ctx, 'task_sla', slaNow, tm('SLAs'));

  const cameIn = { value: strictSum(parts.map((p) => p.cameIn)), prev: strictSum(parts.map((p) => p.cameInBefore)) };
  // (a type with no closed date cannot be counted, so the total is not a total)
  const notCounted = { ok: false };
  const closed = { value: strictSum(parts.map((p) => p.closedNow || notCounted)), prev: strictSum(parts.map((p) => p.closedBefore || notCounted)) };
  const backlog = { value: cameIn.value !== null && closed.value !== null ? cameIn.value - closed.value : null, prev: cameIn.prev !== null && closed.prev !== null ? cameIn.prev - closed.prev : null };
  const why = tm('Some ticket types could not be counted.');
  if (cameIn.value === null) left('cameIn', why);
  if (closed.value === null) left('closed', why);
  if (backlog.value === null) left('backlog', why);

  // SLA kept: the SLAs that came due in the week that were not breached.
  const sla = slaNumber(slaNow);
  if (!sla) left('sla', slaNow.ok ? tm('No SLA came due in this week.') : slaNow.note);
  const slaPrev = slaNumber(slaBefore);

  // Reopened: closed tickets that came back, of the closed tickets of the types that record it.
  const withCol = parts.filter((p) => p.reopenCol);
  const reopenedNow = strictSum(withCol.map((p) => p.reopenedNow));
  const reopenedOf = strictSum(withCol.map((p) => p.closedNow));
  let reopened = null;
  if (withCol.length && reopenedNow !== null && reopenedOf !== null && reopenedOf > 0) {
    reopened = { value: reopenedNow, of: reopenedOf, prev: strictSum(withCol.map((p) => p.reopenedBefore)), prevOf: strictSum(withCol.map((p) => p.closedBefore)), types: withCol.map((p) => p.tableInfo.meta.label) };
  } else if (!withCol.length) left('reopened', tm('This ServiceNow site does not keep a count of reopened tickets.'));
  else if (reopenedOf === 0) left('reopened', tm('Nothing was closed in the ticket types that count reopening.'));
  else left('reopened', tm('Reopened tickets could not be counted.'));

  const decisions = teamDecisions(parts, ctx.scope);
  // Ticket numbers behind the one-cause decision, for the AI line (numbers only).
  const cause = decisions.find((d) => d.id === 'cause');
  if (cause?.field) {
    const got = await attempt(() => ctx.reader.rows(cause.table, andQuery(ctx.scope.query, range('opened_at', windows.current), buildQuery([{ op: 'eq', field: cause.field, value: cause.ciId }])), ['sys_id', 'number'], { limit: READ_LIMITS.numbersMax }), cause.table);
    cause.numbers = got.ok ? got.value.map((r) => oneLine(disp(r.number) || raw(r.number), 40)).filter(Boolean) : [];
  }
  decisions.forEach((d) => {
    delete d.field;
    delete d.ciId;
  });

  return {
    kind: 'team',
    types: tables.map((t) => t.meta.label),
    numbers: {
      cameIn: cameIn.value === null ? null : cameIn,
      closed: closed.value === null ? null : closed,
      backlog: backlog.value === null ? null : backlog,
      sla: sla ? { ...sla, prev: slaPrev ? slaPrev.percent : null } : null,
      reopened,
    },
    areas: teamAreas(parts),
    decisions,
    oldest,
    leftOut,
  };
}

// ---- My week --------------------------------------------------------------------------------------------------------------------------

async function mineTable(ctx, tableInfo, w) {
  const { reader, scope } = ctx;
  const T = tableInfo.table;
  const { rf, qual, has } = facts(tableInfo);
  const customer = reachesCustomer(T) ? customerColumn(T) : '';
  const fields = columnsOf(['sys_id', 'number', rf, 'opened_at', has(qual.reopen) && qual.reopen, has(qual.category) && qual.category, customer]);
  const closedQ = andQuery(scope.query, range(rf, w));
  const got = await attempt(() => reader.pages(T, `${closedQ}^ORDERBY${rf}`, fields, { max: READ_LIMITS.rowsMax, displayValue: true }), T);
  fail(ctx, T, got, tableInfo.meta.label);
  if (!got.ok) return { tableInfo, ok: false };
  const rows = got.value.rows
    .map((r) => ({
      sysId: raw(r.sys_id).toLowerCase(),
      number: oneLine(disp(r.number) || raw(r.number), 40),
      openedAt: parseSnTime(raw(r.opened_at)),
      closedAt: parseSnTime(raw(r[rf])),
      reopens: Number(raw(r[qual.reopen])) || 0,
      area: has(qual.category) ? { name: disp(r[qual.category]), plain: false } : { name: tableInfo.meta.label, plain: true },
      customer: customer ? raw(r[customer]).trim().toLowerCase() : '',
    }))
    .filter((r) => SYS_ID_RE.test(r.sysId));
  return { tableInfo, ok: true, rows, capped: got.value.capped, total: got.value.capped ? got.value.total : rows.length, reopenCol: has(qual.reopen), customerKnown: Boolean(customer), closedQ };
}

/** { ticket sysId -> { any: boolean, breached: boolean } } from task_sla rows, cancelled ones left out. Pure. */
export function slaByTicket(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const id = raw(r.task).toLowerCase();
    if (!SYS_ID_RE.test(id) || raw(r.stage).toLowerCase() === 'cancelled') continue;
    const e = out.get(id) || { breached: false };
    if (['true', '1', 'yes'].includes(raw(r.has_breached).toLowerCase())) e.breached = true;
    out.set(id, e);
  }
  return out;
}

async function readMineSla(ctx, tickets) {
  const { reader } = ctx;
  if (!tickets.length) return { ok: true, kept: 0, total: 0 };
  const rows = [];
  for (let i = 0; i < tickets.length; i += READ_LIMITS.slaChunk) {
    const ids = tickets.slice(i, i + READ_LIMITS.slaChunk).map((x) => x.sysId);
    // eslint-disable-next-line no-await-in-loop -- one batch after the other
    const got = await attempt(() => reader.rows('task_sla', buildQuery([{ op: 'in', field: 'task', values: ids }]), ['task', 'has_breached', 'stage'], { limit: ids.length * 5 }), 'task_sla');
    if (!got.ok) return got;
    rows.push(...got.value);
  }
  if (!rows.length) {
    // No SLA at all: none of these tickets had one, or an access rule hides every SLA (rule 9: only a table with something visible proves "none").
    const seen = await reader.visibility('task_sla');
    if (seen.status !== 'ok') return { ok: false, status: seen.status === 'hidden' ? 'hidden' : seen.status, note: SLA_UNSEEN };
  }
  const by = slaByTicket(rows);
  const total = by.size;
  const kept = [...by.values()].filter((e) => !e.breached).length;
  return { ok: true, kept, total };
}

async function readMineReplies(ctx, tickets) {
  const { reader } = ctx;
  const eligible = tickets.filter((x) => x.customer);
  if (eligible.length > READ_LIMITS.replyTicketsMax) return { ok: false, status: 'skipped', note: tm('Too many tickets to work out the first reply.') };
  const found = { times: [], noReply: 0, unknown: 0, left: tickets.length - eligible.length };
  for (let i = 0; i < eligible.length; i += READ_LIMITS.replyChunk) {
    const chunk = eligible.slice(i, i + READ_LIMITS.replyChunk);
    const query = buildQuery(
      [
        { op: 'eq', field: 'element', value: 'comments' },
        { op: 'in', field: 'element_id', values: chunk.map((x) => x.sysId) },
      ],
      { orderBy: 'sys_created_on' }
    );
    // eslint-disable-next-line no-await-in-loop -- one batch after the other
    const got = await attempt(() => reader.rows('sys_journal_field', query, ['element_id', 'sys_created_on', 'sys_created_by'], { limit: READ_LIMITS.replyRows }), 'sys_journal_field');
    if (!got.ok) return got;
    const one = firstReplies(chunk, got.value, { cut: got.value.length >= READ_LIMITS.replyRows });
    found.times.push(...one.times);
    found.noReply += one.noReply;
    found.unknown += one.unknown;
  }
  return { ok: true, found, eligible: eligible.length };
}

/** One week of the person's own closed tickets: counts and the measures that come from the tickets themselves. */
export async function readMineWindow(ctx, w, { extras = false } = {}) {
  const tables = countableTables(ctx);
  const per = await Promise.all(tables.map((t) => mineTable(ctx, t, w)));
  const readable = per.every((p) => p.ok);
  const out = { closed: null, complete: false, typicalMs: null, reopened: null, sla: null, reply: null, areas: null, notes: null, left: [] };
  if (!readable) {
    out.left.push({ key: 'closed', why: tm('Some ticket types could not be counted.') });
    return out;
  }
  const rows = per.flatMap((p) => p.rows.map((r) => ({ ...r, table: p.tableInfo.table })));
  out.closed = per.reduce((n, p) => n + p.total, 0);
  const complete = per.every((p) => !p.capped);
  out.complete = complete;
  if (!complete) {
    out.left.push({ key: 'typical', why: tm('More tickets were closed than could be read, so only the count is shown.') });
    return out;
  }

  out.typicalMs = typicalTime(rows.filter((r) => Number.isFinite(r.openedAt) && Number.isFinite(r.closedAt) && r.closedAt >= r.openedAt).map((r) => (r.closedAt - r.openedAt) / 3600000));
  if (out.closed > 0 && out.typicalMs === null) out.left.push({ key: 'typical', why: tm('Fewer than 3 tickets were closed, so there is no typical time.') });

  // Reopened: of the closed tickets of the types that record it.
  const withCol = per.filter((p) => p.reopenCol);
  if (withCol.length) {
    const of = withCol.reduce((n, p) => n + p.rows.length, 0);
    const back = withCol.flatMap((p) => p.rows.filter((r) => r.reopens > 0));
    if (of > 0) out.reopened = { n: back.length, of, types: withCol.map((p) => p.tableInfo.meta.label), numbers: back.map((r) => r.number).slice(0, READ_LIMITS.numbersMax) };
  } else if (out.closed > 0) out.left.push({ key: 'reopened', why: tm('This ServiceNow site does not keep a count of reopened tickets.') });

  if (extras) out.areas = areaBars(rows.map((r) => r.area));

  // SLAs and first replies read more; both only when something was closed.
  if (rows.length) {
    const [sla, reply] = await Promise.all([readMineSla(ctx, rows), readMineReplies(ctx, rows)]);
    if (sla.ok) {
      out.sla = sla.total > 0 ? { kept: sla.kept, total: sla.total, percent: percentOf(sla.kept, sla.total) } : null;
      if (!out.sla) out.left.push({ key: 'sla', why: tm('None of the closed tickets had an SLA.') });
    } else {
      out.left.push({ key: 'sla', why: sla.note });
      fail(ctx, 'task_sla', sla, tm('SLAs'));
    }
    if (reply.ok) {
      out.reply = replySummary(reply.found, reply.eligible);
      if (!out.reply) out.left.push({ key: 'reply', why: tm('Fewer than 3 tickets had a written reply, so there is no average.') });
    } else {
      out.left.push({ key: 'reply', why: reply.note });
      fail(ctx, 'sys_journal_field', reply, tm('Comments'));
    }
  }

  // The fix notes of this week (the tip's counts): closed tickets without one, and how many of those came back.
  if (extras && rows.length) {
    const noted = await Promise.all(per.map((p) => readFixNotes(ctx, p.tableInfo, p.closedQ, { reopenedToo: true })));
    const known = noted.filter((n) => n && n.ok);
    if (known.length && noted.every((n) => !n || n.ok)) {
      const noteTables = per.filter((p, i) => noted[i]);
      out.notes = { closed: noteTables.reduce((n, p) => n + p.rows.length, 0), without: known.reduce((n, k) => n + k.without, 0), reopenedWithout: known.every((k) => k.reopenedWithout !== null) ? known.reduce((n, k) => n + k.reopenedWithout, 0) : null };
    }
  }
  return out;
}

/** "My week": this week (or last) and the week it is compared with, for the signed-in person. */
export async function readMyWeek(ctx) {
  const [now, before] = await Promise.all([readMineWindow(ctx, ctx.windows.current, { extras: true }), readMineWindow(ctx, ctx.windows.previous)]);
  const { left: leftOut, ...current } = now;
  const { left: ignored, ...previous } = before;
  return { kind: 'mine', now: current, before: previous, leftOut, types: countableTables(ctx).map((t) => t.meta.label) };
}
