// Tickets at risk (round 4, docs/round4.md): which of my tickets are the few that cost the most time, and why. Pure.
//
// HappySignals finds that about 13 % of tickets cause 80 % of the time lost to incidents: the ones that bounce between teams, get
// reopened, wait or go wrong. My work marks them "At risk" and names the reasons on the row ("Reassigned 3 times · waiting on you
// 2 days"). A ticket is at risk when ANY of these holds (the definition the user approved on the mockup):
//
//   reopened     reopened at least RISK_LIMITS.reopens time (incident.reopen_count): the fix did not hold
//   reassigned   reassigned RISK_LIMITS.reassignments times or more (task.reassignment_count): it bounced between teams
//   waiting      the customer (or, on a ticket whose customer is not known, someone else) wrote after my last comment, and that was
//                RISK_LIMITS.waitingDays whole days ago or more: waiting on me (src/mywork/markers.js, authors and times only)
//   sla          the SLA is breached or at risk as src/mywork/sla.js decides (75 % used, AT_RISK_PERCENT, or under 2 hours left):
//                the same rule as the amber and red SLA chips, so every ticket the SLA ranks first is "at risk" too
//   vip          the customer is marked VIP in ServiceNow (the customer's sys_user.vip, dot-walked)
//   account      a case of one of the organisation's priority accounts (policy `priorityAccounts`, as N28 on the Ticket screen)
//
// The facts come from the read (src/mywork/read.js, columns in src/context/specs/mywork.js); a fact the instance did not return is
// null and is simply not used. Nothing here reads ticket text: My work never does, so it cannot tell the customer's mood. A resolved
// ticket is never at risk (nothing is left to do on it). The line names the reasons in REASON_ORDER: what the row does not show
// otherwise first (reopened, reassigned, waiting), then the SLA, then who it is for.
import { isPriorityAccount } from '../insights/priorityAccount.js';
import { wholeDaysSince } from './time.js';
import { t, tn } from '../i18n/index.js';

export const RISK_LIMITS = Object.freeze({
  reassignments: 2, // reassigned this many times or more
  reopens: 1, // reopened this many times or more
  waitingDays: 2, // whole days since the customer's word that nobody answered
});

/**
 * How many of my open tickets have a risk fact that could not be read (`factsUnread`, src/mywork/read.js itemOf). Their "At risk" mark
 * (or its absence) rests on less than the rule asks for, so the screen says so. A resolved ticket is never at risk: it is not counted.
 */
export function ticketsWithUnreadFacts(items) {
  return (Array.isArray(items) ? items : []).filter((i) => i && i.work !== 'resolved' && Number.isInteger(i.factsUnread) && i.factsUnread > 0).length;
}

export const REASON_ORDER = Object.freeze(['reopened', 'reassigned', 'waiting', 'sla', 'vip', 'account']);

const isCount = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Whole days the newest unanswered customer word has waited (src/mywork/markers.js `replied`); NaN when nothing waits on me. */
export function waitingOnYouDays(item, now) {
  const m = item?.marker;
  if (!m?.known || item.work === 'resolved') return NaN;
  if (m.replied === 'customer') return wholeDaysSince(m.lastCustomerAt, now);
  if (m.replied === 'other') return wholeDaysSince(m.lastOtherAt, now);
  return NaN;
}

/**
 * Why a ticket is at risk, in REASON_ORDER; [] when it is not.
 * @param {object} item a My work item (src/mywork/read.js itemOf, with its SLA and marker)
 * @param {{ now: number, policy?: { priorityAccounts?: string[] } }} options
 * @returns {{ id: string, count?: number, days?: number, breached?: boolean }[]}
 */
export function riskReasons(item, { now, policy } = {}) {
  if (!item || item.work === 'resolved') return [];
  const out = [];
  if (isCount(item.reopens) && item.reopens >= RISK_LIMITS.reopens) out.push({ id: 'reopened', count: item.reopens });
  if (isCount(item.reassignments) && item.reassignments >= RISK_LIMITS.reassignments) out.push({ id: 'reassigned', count: item.reassignments });
  const days = waitingOnYouDays(item, now);
  if (days >= RISK_LIMITS.waitingDays) out.push({ id: 'waiting', days });
  const sla = item.sla?.risk;
  if (sla === 'breached' || sla === 'at-risk') out.push({ id: 'sla', breached: sla === 'breached' });
  if (item.vip === true) out.push({ id: 'vip' });
  if (item.account && isPriorityAccount(item.account, policy?.priorityAccounts)) out.push({ id: 'account' });
  return out;
}

// One reason in words, written to follow a " · " (lower case where English allows); the line starts with a capital.
const WORDS = {
  reopened: (r) => (r.count === 2 ? t('reopened twice') : tn(r.count, 'reopened once', 'reopened {n} times')),
  reassigned: (r) => tn(r.count, 'reassigned {n} time', 'reassigned {n} times'),
  waiting: (r) => tn(r.days, 'waiting on you {n} day', 'waiting on you {n} days'),
  sla: (r) => (r.breached ? t('SLA breached') : t('SLA nearly used')),
  vip: () => t('VIP caller'),
  account: () => t('priority account'),
};

/** The reason line: "Reassigned 3 times · waiting on you 2 days", "Reopened twice · priority account"; '' for no reason. */
export function riskLine(reasons) {
  const line = (Array.isArray(reasons) ? reasons : [])
    .filter((r) => Object.prototype.hasOwnProperty.call(WORDS, r?.id))
    .map((r) => WORDS[r.id](r))
    .join(' · ');
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : '';
}

/**
 * The queue with each ticket at risk carrying its reasons (`atRisk`, read by src/mywork/rank.js: the "At risk" filter and the order);
 * the others are returned as they are. Worked out in the panel, where the organisation's priority accounts are known.
 */
export function withRisk(items, options) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const reasons = riskReasons(item, options);
    return reasons.length ? { ...item, atRisk: reasons } : item;
  });
}
