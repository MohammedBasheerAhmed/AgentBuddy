// One ticket's SLA, as My work shows and ranks it. Pure.
//
// A ticket can have several SLAs (response, resolution). The one shown is the most pressing: a breached one first; else the RUNNING
// one that ends soonest (or, without an end time, the one most used up); else a paused one. A paused SLA is not counting down (it
// waits on the customer or a vendor), so it is shown as "SLA paused" and ranks after every running one, whatever its end date says.
import { raw, disp, parseSnTime } from '../context/util.js';
import { slaPercent, isPaused, AT_RISK_PERCENT } from '../reports/myDay.js';
import { HOUR } from './time.js';

/** A running SLA that ends within this time is "at risk" even if its share used is still below AT_RISK_PERCENT. */
export const AT_RISK_WITHIN_MS = 2 * HOUR;

const bool = (v) => ['true', '1', 'yes'].includes(raw(v).toLowerCase());

/** One task_sla row in plain terms. `dueAt` is the planned end (stored UTC value, so it compares with Date.now()). */
export function slaOf(row) {
  const { percentage, basis } = slaPercent(row);
  const due = parseSnTime(raw(row?.planned_end_time));
  return {
    name: disp(row?.sla),
    breached: bool(row?.has_breached),
    paused: isPaused(row),
    percentage: Math.round(percentage * 10) / 10,
    basis,
    dueAt: Number.isFinite(due) ? due : null,
  };
}

const order = (s) => (s.breached ? 0 : s.paused ? 2 : 1);

/** The SLA to show for a ticket, from its task_sla rows (see the header), with its risk; null when it has none. */
export function mostPressingSla(rows, now) {
  let best = null;
  for (const row of rows || []) {
    const s = slaOf(row);
    if (!best) {
      best = s;
      continue;
    }
    const a = order(s);
    const b = order(best);
    if (a !== b) {
      if (a < b) best = s;
      continue;
    }
    // Same kind: the one that ends soonest; without end times, the one most used up.
    const left = (x) => (x.dueAt === null ? Infinity : x.dueAt - now);
    if (left(s) < left(best) || (left(s) === left(best) && s.percentage > best.percentage)) best = s;
  }
  if (!best) return null;
  return { ...best, risk: riskOfSla(best, now) };
}

/** 'breached' | 'at-risk' | 'ok' | 'paused' | 'none'. */
export function riskOfSla(sla, now) {
  if (!sla) return 'none';
  if (sla.breached) return 'breached';
  if (sla.paused) return 'paused';
  if (sla.percentage >= AT_RISK_PERCENT) return 'at-risk';
  if (sla.dueAt !== null && sla.dueAt - now <= AT_RISK_WITHIN_MS) return 'at-risk';
  return 'ok';
}
