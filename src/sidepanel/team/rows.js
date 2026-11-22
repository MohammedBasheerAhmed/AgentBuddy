import { LIMITS } from '../../reports/engine/constants.js';
import { NOBODY_KEY } from '../../reports/engine/workload.js';
import { placeholderName, shown } from '../../reports/shown.js';
import { hours } from '../reports/format.js';
import { isolate, t, tn } from '../../i18n/index.js';

// The five rows of Team's first screen (round 5, board C, docs/round5.md), worked out from the results of three sections the Team
// overview already reads, by the same engine and the same numbers (nothing new is read):
//   attention  "Needs attention now": the SLA counts and the tickets behind them (src/reports/engine/attention.js)
//   workload   "Workload and ageing": open work by person, the ageing buckets, the open total (src/reports/engine/workload.js)
//   quality    "Quality and trend": top configuration items, repeat callers, reopens, resolved (src/reports/engine/quality.js)
//
// Row 1 Needs attention now      attention: counts.breached + counts.closest
// Row 2 Getting old              workload: the ageing buckets 8-14 days and 15+ days
// Row 3 Who is carrying the load workload: open work by person; the line holds numbers only, names are inside the opened row
// Row 4 Coming back again        quality: the top configuration item of the last 30 days, else the callers with 3+ tickets
// Row 5 How well tickets are closed  quality: the tickets that were reopened; when the engine also counts closes without a fix note
//                                (`closeNotes`: { without, of }) that is the line (it needs a column the engine does not read yet)
//
// A section that is not ready is `{ status, d, reason }` (sectionState): 'loading', 'error' (could not be read), 'unavailable' (the
// engine says why: `reason`) or 'ready'. A row of a section that is not ready says so in words, with no number: never a zero.
// A row with nothing to report is a calm sentence and still shows. Pure; every text goes through t().

/** What a section's state (useSection's) comes to. `none`: the section was never asked (no ticket type can be read). */
export function sectionState(state, { none = '' } = {}) {
  if (none) return { status: 'unavailable', d: null, reason: none };
  const d = state?.result?.data;
  if (state?.result && d && d.available === false) return { status: 'unavailable', d: null, reason: d.reason || '' };
  // `scopeKind`: whose tickets the numbers are about ('mine', 'groups', 'chosen'): a view of one's own tickets has no other person.
  if (state?.result && d) return { status: 'ready', d, reason: '', scopeKind: state.result.scope?.kind || '' };
  if (state?.phase === 'error') return { status: 'error', d: null, reason: '' };
  return { status: 'loading', d: null, reason: '' };
}

const notReady = (s) => ({
  count: null,
  level: '',
  items: [],
  line: s.status === 'loading' ? t('Reading the numbers…') : s.status === 'unavailable' && s.reason ? shown(s.reason) : t('Could not be read.'),
});

const join = (parts) => parts.filter(Boolean).join(', ');

// ---- 1. Needs attention now ------------------------------------------------------------------------------------------------------

/** The count of one SLA reason when it was read; null when it was not (a refused or failed read). */
const slaCount = (c) => (c && c.ok && Number.isFinite(c.population) ? c.population : null);

export function attentionRow(s) {
  if (s.status !== 'ready') return { ...notReady(s), hint: '' };
  const { counts, rows } = s.d;
  const b = slaCount(counts.breached);
  const c = slaCount(counts.closest);
  const parts = [];
  if (b) parts.push(counts.breached.atLeast ? tn(b, 'at least {n} breached', 'at least {n} breached') : tn(b, '{n} breached', '{n} breached'));
  if (c) parts.push(counts.closest.atLeast ? tn(c, 'at least {n} about to breach', 'at least {n} about to breach') : tn(c, '{n} about to breach', '{n} about to breach'));
  if (b === null) parts.push(t('breached could not be counted'));
  if (c === null) parts.push(t('about to breach could not be counted'));
  const items = rows.filter((r) => r.reason === 'breached' || r.reason === 'closest');
  const counted = (b || 0) + (c || 0);
  return {
    count: b === null && c === null ? null : counted,
    line: parts.length ? join(parts) : t('Nothing is breached or about to breach.'),
    level: b ? 'danger' : c ? 'warn' : '',
    items,
    hint: items.length < counted ? t('Showing {shown} of {total}.', { shown: items.length, total: counted }) : '',
  };
}

// ---- 2. Getting old -------------------------------------------------------------------------------------------------------------

export function ageingRow(s, attention) {
  if (s.status !== 'ready') return { ...notReady(s), buckets: [], oldest: [] };
  const { ageing, totals, staleDays } = s.d;
  if (!ageing.byTable.length) return { count: null, level: '', items: [], line: t('Could not be read.'), buckets: [], oldest: [], stale: null, staleDays };
  const [, , , d8, d15] = ageing.buckets;
  const over7 = d8.count + d15.count;
  const parts = [];
  if (over7) parts.push(tn(over7, '{n} open for more than 7 days', '{n} open for more than 7 days'));
  if (d15.count) parts.push(tn(d15.count, '{n} for 15 days or more', '{n} for 15 days or more'));
  if (ageing.left) parts.push(t('some ticket types could not be aged'));
  // The oldest tickets are the ones "Needs attention now" lists under its "Oldest open" reason (at most a few of them).
  const oldest = attention?.status === 'ready' ? attention.d.rows.filter((r) => r.reasons.includes('oldest')).slice(0, 3) : [];
  return {
    count: over7,
    line: parts.length ? join(parts) : t('Nothing has been open for more than 7 days.'),
    level: over7 ? 'warn' : '',
    buckets: ageing.buckets,
    oldest,
    stale: totals.stale,
    staleDays,
  };
}

// ---- 3. Who is carrying the load -------------------------------------------------------------------------------------------------

/** The people with open work, busiest first (not "nobody", not the folded "Other people (n)"). */
export const peopleOf = (d) => (d.detail?.assignees || []).filter((r) => r.key !== NOBODY_KEY && r.count > 0);

export function loadRow(s) {
  if (s.status !== 'ready') return { ...notReady(s), people: [], unassigned: null };
  const d = s.d;
  const open = d.totals.open;
  const unassigned = d.totals.unassigned;
  if (!Number.isFinite(open)) return { count: null, level: '', items: [], line: t('Could not be read.'), people: [], unassigned };
  // A view of my own tickets has no other person. A team view whose per-person read gave nothing at all (not even "nobody") could not be
  // read: that is said, it is not "nobody is carrying anything".
  if (!d.assigneeCount && !d.detail.assignees.length) {
    if (!open) return { count: 0, level: '', items: [], line: t('Nothing is open.'), people: [], unassigned };
    if (s.scopeKind === 'mine') return { count: null, level: '', items: [], line: t('Only your own tickets are in this view.'), people: [], unassigned };
    return { count: null, level: '', items: [], line: t('Could not be read.'), people: [], unassigned };
  }
  const people = peopleOf(d);
  if (!open || !people.length) return { count: 0, level: '', items: [], line: open ? t('No open ticket is assigned to a person.') : t('Nothing is open.'), people, unassigned };
  const k = Math.min(2, people.length);
  const held = people.slice(0, k).reduce((n, p) => n + p.count, 0);
  const percent = Math.min(100, Math.round((held / open) * 100));
  return {
    count: k,
    level: '',
    items: [],
    line: tn(k, 'The busiest person holds {percent}% of the open tickets', 'The busiest {n} people hold {percent}% of the open tickets', { percent }),
    people,
    unassigned,
  };
}

// ---- 4. Coming back again ------------------------------------------------------------------------------------------------------

/** From this many tickets on one configuration item in the window, "one cause?" is worth asking (the same as My work's). */
export const CAUSE_MIN = LIMITS.repeatCallerMin;

export function comingBackRow(s) {
  if (s.status !== 'ready') return { ...notReady(s), cis: [], callers: [] };
  const d = s.d;
  const days = d.windowDays;
  const cis = (d.cis || []).filter((x) => x.count >= 2);
  const callers = d.repeatCallers?.items || [];
  const top = (d.cis || [])[0];
  if (top && top.count >= CAUSE_MIN) {
    return { count: top.count, level: 'warn', items: [], line: t('{name}: {n} tickets in the last {days} days. One cause?', { name: isolate(placeholderName(top.name)), n: top.count, days }), cis, callers, days };
  }
  if (callers.length) {
    return {
      count: callers.length,
      level: '',
      items: [],
      line: tn(callers.length, '{n} caller has {min} or more tickets in the last {days} days', '{n} callers have {min} or more tickets in the last {days} days', { min: d.repeatCallers.min, days: d.repeatCallers.days }),
      cis,
      callers,
      days,
    };
  }
  return { count: 0, level: '', items: [], line: t('No cause stands out in the last {days} days.', { days }), cis, callers, days };
}

// ---- 5. How well tickets are closed --------------------------------------------------------------------------------------------

/** A reopen rate from this share up is worth a look (the Quality section's own line). */
export const REOPEN_LOOK_PERCENT = 10;

export function closedRow(s) {
  if (s.status !== 'ready') return { ...notReady(s), facts: [], fixNotes: false };
  const d = s.d;
  const facts = [
    d.resolved ? { label: t('Resolved in the last {days} days', { days: d.windowDays }), value: String(d.resolved.value) } : null,
    d.mttr ? { label: t('Time to resolve'), value: hours(d.mttr.meanHours) } : null,
    d.reopen ? { label: t('Reopened'), value: `${d.reopen.reopened} / ${d.reopen.of}` } : null,
  ].filter(Boolean);
  const notes = d.closeNotes;
  if (notes && Number.isFinite(notes.of) && Number.isFinite(notes.without)) {
    const calm = notes.without === 0;
    return {
      count: notes.without,
      level: calm ? '' : 'warn',
      items: [],
      line: calm ? t('Every ticket closed this week has a fix note.') : tn(notes.without, '{n} of {total} closed this week has no fix note', '{n} of {total} closed this week have no fix note', { total: notes.of }),
      facts,
      fixNotes: true,
    };
  }
  if (!d.reopen) return { count: null, level: '', items: [], line: t('Reopens could not be read for these ticket types.'), facts, fixNotes: false };
  const { reopened, of, percent } = d.reopen;
  return {
    count: reopened,
    level: percent >= REOPEN_LOOK_PERCENT ? 'warn' : '',
    items: [],
    line: reopened ? tn(reopened, '{n} of {total} tickets opened in the last {days} days was reopened', '{n} of {total} tickets opened in the last {days} days were reopened', { total: of, days: d.windowDays }) : t('No ticket opened in the last {days} days was reopened.', { days: d.windowDays }),
    facts,
    fixNotes: false,
  };
}

// ---- the summary under "Team" ---------------------------------------------------------------------------------------------------

/** "38 open tickets. 5 need a lead today." Pure. `needs`: attentionRow's answer, `load`: the workload state. */
export function teamSummary(workload, needs) {
  const open = workload.status === 'ready' ? workload.d.totals.open : null;
  const head = Number.isFinite(open) ? tn(open, '{n} open ticket.', '{n} open tickets.') : workload.status === 'loading' ? '' : t('Open tickets could not be counted.');
  const k = needs.count;
  const tail = k === null ? '' : k ? tn(k, '{n} needs a lead today.', '{n} need a lead today.') : t('Nothing needs a lead today.');
  return [head, tail].filter(Boolean).join(' ');
}
