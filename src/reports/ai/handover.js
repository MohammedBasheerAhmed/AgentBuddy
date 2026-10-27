// F4, the AI half: the hand-over note. Pure functions that turn the engine's `handover` result (src/reports/engine/handover.js)
// into a ContextPack-shaped object and the parts the firewall wraps. Nothing here reads from the instance or calls a model.
//
// WHAT IS SENT (and nothing else): the counted figures, the scope's group names, a few plain notes about what could not be read,
// and at most NOTABLE_MAX tickets with their number, type, priority, state, group, assignee and short description. The
// assignees, and the requesters of those tickets, go into `pack.people`, so the firewall masks their names wherever they appear.
//
// HONEST LIMIT: a person who is named only inside a ticket title ("Printer broken at Priya's desk") and who is neither the
// assignee nor the requester of a listed ticket is NOT masked: no pattern finds a free-form name. The panel says so next to the
// button, and the preview shows exactly what will be sent so the lead can look before anything leaves.
import { REPORT_TABLE, addPeople, blockedSet, checkAnswer, figure, line, resultNotes, scopeText } from './common.js';

export const HANDOVER_HEADINGS = Object.freeze(['Headline:', 'Needs attention now:', 'Waiting on others:', 'Watch during the next shift:', 'Notes for the incoming team:']);
export const HANDOVER_MAX_WORDS = 220;
export const NOTABLE_MAX = 15;

const priorityLabel = (item) => {
  const n = parseInt(String(item.priorityValue || item.priority || '').trim(), 10);
  return Number.isFinite(n) ? `P${n}` : 'urgent';
};

/**
 * The tickets worth naming in the note, most important first, each with the reasons it was picked. The order is fixed:
 * breached now, urgent tickets opened in the period, breaches in the period, SLAs at risk, urgent tickets resolved, tickets handed
 * over often, then the oldest waiting and the oldest open. A ticket that fits several reasons appears once with all of them.
 * Pure and deterministic: the same data gives the same list.
 */
export function pickNotable(data, max = NOTABLE_MAX) {
  if (!data || data.available === false) return [];
  const hours = data.hours;
  const tiers = [
    [(data.sla?.top || []).filter((t) => t.risk === 'Breached'), () => 'SLA breached'],
    [data.events?.opened?.items || [], (t) => `${priorityLabel(t)} opened in the last ${hours} hours`],
    [data.events?.breaches?.items || [], () => `SLA breached during the last ${hours} hours`],
    [(data.sla?.top || []).filter((t) => t.risk !== 'Breached'), (t) => (t.risk === 'At risk' ? `SLA at risk (${t.percent}% of the time used)` : 'SLA due soon')],
    [data.events?.resolved?.items || [], (t) => `${priorityLabel(t)} resolved in the last ${hours} hours`],
    [data.events?.reassigned?.items || [], (t) => `handed over ${t.reassignments ?? 'several'} times`],
    [data.waiting?.oldest || [], (t) => `one of the oldest waiting${Number.isFinite(t.ageDays) ? ` (${t.ageDays} days old)` : ''}`],
    [data.oldest || [], (t) => `one of the oldest open${Number.isFinite(t.ageDays) ? ` (${t.ageDays} days old)` : ''}`],
  ];
  const byKey = new Map();
  for (const [items, why] of tiers) {
    for (const item of items) {
      if (!item || !item.number) continue;
      const key = item.sysId ? `${item.table}:${item.sysId}` : `number:${item.number}`;
      if (!byKey.has(key)) byKey.set(key, { ...item, reasons: [] });
      const entry = byKey.get(key);
      const reason = why(item);
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    }
  }
  return [...byKey.values()].slice(0, Math.max(0, max));
}

// What the figures are called in the text the AI reads. A figure that could not be read says so; it is never 0.
function figuresOf(d) {
  const s = d.snapshot || {};
  const w = d.waiting || {};
  const list = [
    ['Open tickets', s.open],
    ['SLA breached now', s.breached],
    ['SLA at risk (most of the time used)', s.atRisk],
    [`SLA due within ${s.dueSoonHours ?? 4} hours`, s.dueSoon],
    ...(s.unassigned !== undefined ? [['Open with nobody assigned', s.unassigned]] : []),
    [`Open with no update in ${s.staleDays ?? 3}+ days`, s.stale],
    ['Waiting in total (customer, approval or other)', s.waiting],
    ['Waiting on the customer', w.customer],
    ['Waiting on an approval', w.approval],
    ['On hold or pending for other reasons', w.other],
    ['Approvals waiting for the person who is signed in', w.approvals?.mine],
    ...(w.approvals?.team !== undefined ? [['Approvals waiting on requested items in this scope', w.approvals.team]] : []),
    [`Priority 1 or 2 tickets opened in the last ${d.hours} hours`, d.events?.opened?.total],
    [`Priority 1 or 2 tickets resolved in the last ${d.hours} hours`, d.events?.resolved?.total],
    [`SLAs that breached in the last ${d.hours} hours`, d.events?.breaches?.total],
    [`Tickets handed over 3+ times and touched in the last ${d.hours} hours`, d.events?.reassigned?.total],
  ];
  return list.map(([label, value]) => ({ label, value: value === undefined ? null : value }));
}

/**
 * The pack for the hand-over note, or null when the result has nothing to hand over (no data, a scope with no groups, no table).
 * @param {object} result the engine's handover result
 * @param {{ blockedFields?: string[] }} [options] the organisation's blocked field names: a blocked column is left out of the
 *   ticket lines (so the note still works, with less in it)
 */
export function buildHandoverPack(result, { blockedFields = [] } = {}) {
  const d = result?.data;
  if (!d || d.available === false) return null;
  const blocked = blockedSet(blockedFields);
  const notable = pickNotable(d, NOTABLE_MAX);

  const people = [];
  notable.forEach((t) => addPeople(people, 'assigned_to', [t.owner]));
  notable.forEach((t) => addPeople(people, 'requester', t.maskNames || []));

  return {
    version: 1,
    table: REPORT_TABLE,
    sysId: 'handover',
    number: '',
    kind: 'other',
    fields: {},
    people,
    journal: [],
    related: {},
    // The tickets in it change with every shift, so the person sees the preview every time, not only the first (see runLogic.js).
    requirePreview: true,
    access: (result.access || []).slice(0, 10).map((a) => ({ source: String(a.source || 'report'), status: String(a.status || 'error'), note: line(a.note, 160) })),
    report: {
      kind: 'handover',
      scope: scopeText(result, { hideGroups: blocked.has('assignment_group') }),
      hours: d.hours,
      figures: figuresOf(d),
      notes: resultNotes(result),
      tickets: notable.map((t) => ({
        number: t.number,
        type: t.kind || '',
        priority: blocked.has('priority') ? '' : t.priority || '',
        state: blocked.has('state') ? '' : t.state || '',
        group: blocked.has('assignment_group') ? '' : t.group || '',
        assignee: blocked.has('assigned_to') ? '' : t.owner || '',
        title: blocked.has('short_description') ? '' : line(t.title, 120).replace(/"/g, "'"),
        reasons: t.reasons,
      })),
    },
  };
}

function ticketLine(t, i) {
  const bits = [
    `${i + 1}. ${t.number}${t.type ? ` (${t.type})` : ''}`,
    t.priority && `priority: ${t.priority}`,
    t.state && `state: ${t.state}`,
    t.group && `group: ${t.group}`,
    `assigned to: ${t.assignee || 'nobody'}`,
    t.title && `short description: "${t.title}"`,
    t.reasons?.length && `flagged because: ${t.reasons.join('; ')}`,
  ];
  return bits.filter(Boolean).join(' | ');
}

/**
 * The parts the firewall wraps: the counted figures (with what could not be read), and the notable tickets. Their fields are
 * `handover_figures` and `handover_tickets`: plain handles a policy or strict mode can see.
 */
export function handoverParts(pack) {
  const r = pack?.report;
  if (!r || r.kind !== 'handover') return [];
  const figures = [
    `Team and scope: ${r.scope}`,
    `Recent events cover the last ${r.hours} hours.`,
    'Figures counted by Agent Buddy (a figure marked "not available" could not be read with this person\'s access):',
    ...r.figures.map((f) => `- ${f.label}: ${figure(f.value)}`),
    ...(r.notes.length ? ['Things that could not be read or are incomplete:', ...r.notes.map((n) => `- ${n}`)] : []),
  ];
  const tickets = r.tickets.length
    ? [`Notable tickets (${r.tickets.length}, picked by a fixed rule from the figures above):`, ...r.tickets.map(ticketLine)]
    : ['No notable tickets were found in the data.'];
  return [
    { label: 'Hand-over figures', field: 'handover_figures', text: figures.join('\n').slice(0, 6000) },
    { label: 'Notable tickets', field: 'handover_tickets', text: tickets.join('\n').slice(0, 6000) },
  ];
}

/** Words used against the 220-word aim, and which of the five headings did not come back. */
export const checkHandoverNote = (text) => checkAnswer(text, { headings: HANDOVER_HEADINGS, maxWords: HANDOVER_MAX_WORDS });
