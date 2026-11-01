// F1 "My Day": the signed-in agent's own open tickets, ordered by how urgent they are. Deterministic, no AI, read-only.
//
// Round 3: the My work screen reads through src/mywork/read.js (every class counted first, then read in pages; approvals; the group
// queue; who wrote last). readMyDay below only answers the old 'myday' READ (src/content/reads.js), which no view asks any more; the SLA
// helpers (slaPercent, isPaused, worstSla, riskOf, SLA_COLUMNS, AT_RISK_PERCENT) are shared with the reports engine and src/mywork/sla.js.
// The reads go through dependency-injected `deps` (same shapes as src/content/tableApi.js), so it is unit-tested with a fake.
//
// Order: breached SLA first, then SLA nearly used up, then priority, then oldest update first (the thing nobody has
// touched for longest). A table the person cannot read is skipped with a note, never an error.
import { SYS_ID_RE, disp, raw, parseSnTime } from '../context/util.js';
import { classifyReadError, confirmEmptyIsReallyEmpty, STATUS } from '../context/access.js';

export const MY_DAY_TABLES = ['incident', 'sc_task', 'sc_req_item', 'sn_customerservice_case', 'problem', 'change_task'];
const FIELDS = ['sys_id', 'number', 'short_description', 'priority', 'state', 'sys_updated_on', 'opened_at', 'sys_class_name'];
export const AT_RISK_PERCENT = 75;
/** The task_sla columns every SLA reader asks for (My Day, the SLA radar, the hand-over). */
export const SLA_COLUMNS = Object.freeze(['task', 'sla', 'stage', 'has_breached', 'percentage', 'business_percentage', 'planned_end_time']);

const numOrNull = (v) => {
  const text = raw(v).trim();
  const n = text === '' ? NaN : Number(text);
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => ['true', '1', 'yes'].includes(raw(v).toLowerCase());

/**
 * How much of an SLA's time is used, in %. An SLA with a schedule (8 to 5 on working days) breaches when its BUSINESS time runs
 * out; the plain percentage also counts nights and weekends, so it passes 100 every evening on SLAs that are nowhere near breaking.
 * The business percentage is used when the row has one, as the record view does (src/context/related.js); the plain one otherwise.
 */
export function slaPercent(row) {
  const business = numOrNull(row?.business_percentage);
  if (business !== null) return { percentage: business, basis: 'business' };
  return { percentage: numOrNull(row?.percentage) ?? 0, basis: 'actual' };
}

/** A paused SLA is not counting down (it waits on the customer, a vendor...): it is never "due soon", whatever its end date says. */
export const isPaused = (row) => raw(row?.stage).toLowerCase() === 'paused' || /^paused$/i.test(disp(row?.stage).trim());

/** The most worrying SLA of several on one ticket. */
export function worstSla(rows) {
  let worst = null;
  (rows || []).forEach((r) => {
    const { percentage, basis } = slaPercent(r);
    const sla = {
      name: disp(r.sla),
      percentage: Math.round(percentage * 10) / 10,
      basis,
      breached: bool(r.has_breached),
      paused: isPaused(r),
      plannedEnd: disp(r.planned_end_time),
      stage: disp(r.stage),
    };
    if (!worst || (sla.breached && !worst.breached) || (sla.breached === worst.breached && sla.percentage > worst.percentage)) worst = sla;
  });
  return worst;
}

export const riskOf = (sla) => (!sla ? 'none' : sla.breached ? 'breached' : sla.percentage >= AT_RISK_PERCENT ? 'at-risk' : 'ok');

// ServiceNow priority is 1 (critical) to 5 (planning); lower is more urgent. Display text starts with the digit.
const priorityRank = (display) => {
  const n = parseInt(String(display).trim(), 10);
  return Number.isFinite(n) ? n : 9;
};

/** Sort key, smaller = sooner. Pure. */
export function urgencyScore(item) {
  const risk = { breached: 0, 'at-risk': 1, ok: 3, none: 3 }[item.risk];
  return risk * 100 + priorityRank(item.priority) * 10 - Math.min(9, Math.floor(item.idleHours / 24));
}

export function rankMyDay(items) {
  return [...items].sort((a, b) => urgencyScore(a) - urgencyScore(b) || b.idleHours - a.idleHours || a.number.localeCompare(b.number));
}

/**
 * @param {{ userId: string }} who the signed-in user's sys_id (from the page bridge)
 * @param {{ queryTable: Function }} deps
 * @param {{ tables?: string[], perTable?: number, now?: number }} [options]
 * @returns {Promise<{ items: object[], access: object[], empty: null | 'nothing' | 'unseen' | 'unread' }>}
 *   `empty` says what an empty list means: 'nothing' (the person can see tickets in these tables, none is theirs and open),
 *   'unseen' (they can see no ticket at all in the tables that answered, so "nothing assigned to you" would be a guess) or
 *   'unread' (no table could be read at all).
 */
export async function readMyDay({ userId }, deps, { tables = MY_DAY_TABLES, perTable = 25, now = Date.now() } = {}) {
  if (!SYS_ID_RE.test(userId || '')) throw new Error('Agent Buddy could not tell who is signed in. Reload the page and try again.');
  const access = [];
  const items = [];
  const answered = []; // tables whose read worked, even with no rows

  await Promise.all(
    tables.map(async (table) => {
      try {
        const rows = await deps.queryTable(table, `assigned_to=${userId}^active=true^ORDERBYDESCsys_updated_on`, FIELDS, { limit: perTable, displayValue: true });
        answered.push(table);
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const updated = parseSnTime(raw(r.sys_updated_on));
          items.push({
            table: raw(r.sys_class_name) || table,
            sysId: raw(r.sys_id),
            number: disp(r.number),
            short_description: disp(r.short_description),
            priority: disp(r.priority),
            state: disp(r.state),
            updated: disp(r.sys_updated_on),
            idleHours: Number.isFinite(updated) ? Math.max(0, Math.round((now - updated) / 3600000)) : 0,
            sla: null,
            risk: 'none',
          });
        });
      } catch (err) {
        // Not every agent can read every table (no case access, no change role): that is normal, not a failure.
        if (err?.code === 'SESSION_EXPIRED') throw err;
        const { status } = classifyReadError(err, table);
        access.push({ source: table, status, note: status === 'denied' ? 'You cannot read this table.' : String(err?.message || 'Could not be read.') });
      }
    })
  );

  const NO_SLA = 'SLA information is not available to you, so tickets are ordered by priority only.';
  // One read for every ticket's SLAs instead of one per ticket.
  const ids = items.map((i) => i.sysId).filter(Boolean);
  if (ids.length) {
    try {
      const slaRows = [];
      for (let i = 0; i < ids.length; i += 50) {
        // eslint-disable-next-line no-await-in-loop -- chunks stay sequential so the instance is not hit with a burst.
        const rows = await deps.queryTable('task_sla', `taskIN${ids.slice(i, i + 50).join(',')}^active=true`, [...SLA_COLUMNS], { limit: 200, displayValue: true });
        slaRows.push(...(Array.isArray(rows) ? rows : []));
      }
      const byTask = new Map();
      slaRows.forEach((r) => {
        const task = raw(r.task);
        if (!byTask.has(task)) byTask.set(task, []);
        byTask.get(task).push(r);
      });
      items.forEach((item) => {
        item.sla = worstSla(byTask.get(item.sysId));
        item.risk = riskOf(item.sla);
      });
      if (!slaRows.length) {
        // No SLA row: these tickets may have none, or an access rule hides every SLA from this person. Only the first is "no risk".
        const seen = await confirmEmptyIsReallyEmpty('task_sla', deps, new Map());
        if (seen.status !== STATUS.EMPTY) access.push({ source: 'task_sla', status: seen.status === STATUS.EMPTY_OR_HIDDEN ? 'hidden' : seen.status, note: NO_SLA });
      }
    } catch (err) {
      if (err?.code === 'SESSION_EXPIRED') throw err;
      access.push({ source: 'task_sla', status: classifyReadError(err, 'task_sla').status, note: NO_SLA });
    }
  }

  // An empty list proves nothing when the person cannot see a single ticket in the tables that answered. One one-row read per
  // table, stopping at the first table that shows something (usually the first).
  let empty = null;
  if (!items.length) {
    empty = answered.length ? 'unseen' : 'unread';
    const memo = new Map();
    for (const table of answered) {
      // eslint-disable-next-line no-await-in-loop -- one small read at a time, and usually only one.
      const seen = await confirmEmptyIsReallyEmpty(table, deps, memo);
      if (seen.status === STATUS.EMPTY) {
        empty = 'nothing';
        break;
      }
    }
  }

  return { items: rankMyDay(items), access, empty };
}
