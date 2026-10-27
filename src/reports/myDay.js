// F1 "My Day": the signed-in agent's own open tickets, ordered by how urgent they are. Deterministic, no AI, read-only.
// The reads go through dependency-injected `deps` (same shapes as src/content/tableApi.js), so it is unit-tested with a fake.
//
// Order: breached SLA first, then SLA nearly used up, then priority, then oldest update first (the thing nobody has
// touched for longest). A table the person cannot read is skipped with a note, never an error.
import { SYS_ID_RE, disp, raw, parseSnTime } from '../context/util.js';

export const MY_DAY_TABLES = ['incident', 'sc_task', 'sc_req_item', 'sn_customerservice_case', 'problem', 'change_task'];
const FIELDS = ['sys_id', 'number', 'short_description', 'priority', 'state', 'sys_updated_on', 'opened_at', 'sys_class_name'];
export const AT_RISK_PERCENT = 75;

const num = (v) => {
  const n = Number(raw(v));
  return Number.isFinite(n) ? n : 0;
};
const bool = (v) => ['true', '1', 'yes'].includes(raw(v).toLowerCase());

/** The most worrying SLA of several on one ticket. */
export function worstSla(rows) {
  let worst = null;
  (rows || []).forEach((r) => {
    const sla = {
      name: disp(r.sla),
      percentage: num(r.percentage),
      breached: bool(r.has_breached),
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
 * @returns {Promise<{ items: object[], access: object[] }>}
 */
export async function readMyDay({ userId }, deps, { tables = MY_DAY_TABLES, perTable = 25, now = Date.now() } = {}) {
  if (!SYS_ID_RE.test(userId || '')) throw new Error('Agent Buddy could not tell who is signed in. Reload the page and try again.');
  const access = [];
  const items = [];

  await Promise.all(
    tables.map(async (table) => {
      try {
        const rows = await deps.queryTable(table, `assigned_to=${userId}^active=true^ORDERBYDESCsys_updated_on`, FIELDS, { limit: perTable, displayValue: true });
        rows.forEach((r) => {
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
        access.push({ source: table, status: err?.code === 'ACCESS_DENIED' ? 'denied' : 'error', note: err?.code === 'ACCESS_DENIED' ? 'You cannot read this table.' : String(err?.message || 'Could not be read.') });
      }
    })
  );

  // One read for every ticket's SLAs instead of one per ticket.
  const ids = items.map((i) => i.sysId).filter(Boolean);
  if (ids.length) {
    try {
      const slaRows = [];
      for (let i = 0; i < ids.length; i += 50) {
        // eslint-disable-next-line no-await-in-loop -- chunks stay sequential so the instance is not hit with a burst.
        slaRows.push(...(await deps.queryTable('task_sla', `taskIN${ids.slice(i, i + 50).join(',')}^active=true`, ['task', 'sla', 'stage', 'has_breached', 'percentage', 'planned_end_time'], { limit: 200, displayValue: true })));
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
    } catch (err) {
      if (err?.code === 'SESSION_EXPIRED') throw err;
      access.push({ source: 'task_sla', status: err?.code === 'ACCESS_DENIED' ? 'denied' : 'error', note: 'SLA information is not available to you, so tickets are ordered by priority only.' });
    }
  }

  return { items: rankMyDay(items), access };
}
