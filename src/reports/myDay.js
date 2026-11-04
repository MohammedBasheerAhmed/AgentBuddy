// The SLA helpers the first "My Day" list was built on. The My work screen reads through src/mywork/read.js; these helpers (slaPercent,
// isPaused, worstSla, riskOf, SLA_COLUMNS, AT_RISK_PERCENT) are shared by the reports engine, the hand-over and src/mywork/sla.js.
// Pure, so they are unit-tested without an instance.
import { disp, raw } from '../context/util.js';

export const AT_RISK_PERCENT = 75;
/** The task_sla columns every SLA reader asks for (My work, the SLA radar, the hand-over). */
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
