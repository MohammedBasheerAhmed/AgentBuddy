// "Explain this dashboard": turns the results the dashboard's widgets have already loaded (src/reports/ai/loaded.js) into a
// compact, aggregate-only input for the AI, as a ContextPack-shaped object. Pure; nothing is read from the instance here.
//
// WHAT IS SENT: counts, trends, group names, ticket numbers, and the names of assignees (which go into `pack.people`, so the
// firewall masks them). NOT sent: ticket titles or descriptions, callers' names (repeat callers are only counted), notes. A
// section that is not on the dashboard is not sent, and the AI is told it is missing so it does not guess.
import { REPORT_TABLE, addPeople, blockedSet, carriesSensitive, checkAnswer, figure, line, resultNotes, scopeText } from './common.js';

export const INSIGHT_HEADINGS = Object.freeze(['What stands out:', 'Likely reasons (hypotheses):', 'Suggested actions:']);
export const INSIGHT_MAX_WORDS = 220;

/** The sections this feature understands, in the order they are written out. `field` is the part's handle for a policy. */
export const INSIGHT_SECTIONS = Object.freeze([
  { id: 'overview', title: 'Overview', field: 'insights_overview' },
  { id: 'handover', title: 'Shift handover', field: 'insights_handover' },
  { id: 'workload', title: 'Workload and ageing', field: 'insights_workload' },
  { id: 'sla', title: 'SLA risk radar', field: 'insights_sla' },
  { id: 'quality', title: 'Quality and trend', field: 'insights_quality' },
  { id: 'fulfilment', title: 'Request fulfilment', field: 'insights_requests' },
]);
// A dashboard that shows none of these has nothing to explain; the others add to it.
export const INSIGHT_CORE = Object.freeze(['overview', 'workload', 'sla', 'quality', 'fulfilment']);

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const pct = (n) => (Number.isFinite(n) ? `${round1(n)}%` : 'not available');
const hours = (h) => (Number.isFinite(h) ? `${round1(h)} hours` : 'not available');
const NO_ONE = /^\((unassigned|no group)\)$/i;

/**
 * The newest usable result per section from the widgets' loaded results: [{ id, section, result }] in, a map out.
 * A result is usable when it is for that section and has data the engine could produce (`available` is not false).
 */
export function collectLoaded(entries) {
  const bySection = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    const r = e?.result;
    if (!r || r.id !== e.section || !r.data || r.data.available === false) continue;
    const known = INSIGHT_SECTIONS.some((s) => s.id === e.section);
    if (!known) continue;
    const have = bySection[e.section];
    if (!have || (r.readAt || 0) >= (have.readAt || 0)) bySection[e.section] = r;
  }
  return bySection;
}

// ---- One compactor per section: lines of plain text, and the assignee names they mention --------------------------------------

function overviewLines(d) {
  const lines = (d.tiles || []).map((t) => `- ${t.label}: ${t.unavailable ? 'not available to this person' : figure(t.value)}${t.partial ? ' (some tables could not be counted)' : ''}`);
  if ((d.perTable || []).length > 1) {
    lines.push('By table:');
    d.perTable.forEach((r) => lines.push(`- ${r.label}: open ${figure(r.open)}, no update in ${d.staleDays}+ days ${figure(r.stale)}, waiting ${figure(r.waiting)}, opened today ${figure(r.openedToday)}, resolved today ${figure(r.resolvedToday)}`));
  }
  return { lines, names: [] };
}

function handoverLines(d) {
  const s = d.snapshot || {};
  const w = d.waiting || {};
  const lines = [
    `- Period for recent events: the last ${d.hours} hours`,
    `- Open: ${figure(s.open)}; SLA breached: ${figure(s.breached)}; SLA at risk: ${figure(s.atRisk)}; due soon: ${figure(s.dueSoon)}`,
    `- Waiting: ${figure(w.total)} (on the customer ${figure(w.customer)}, on an approval ${figure(w.approval)}, other ${figure(w.other)})`,
    `- Priority 1-2 opened in the period: ${figure(d.events?.opened?.total)}; resolved: ${figure(d.events?.resolved?.total)}; SLAs breached: ${figure(d.events?.breaches?.total)}; tickets handed over 3+ times and touched: ${figure(d.events?.reassigned?.total)}`,
  ];
  return { lines, names: [] };
}

function workloadLines(d, blocked) {
  const t = d.totals || {};
  const lines = [
    `- Open tickets: ${figure(t.open)}${t.openPartial ? ' (some tables could not be counted)' : ''}`,
    ...(t.unassigned !== null && t.unassigned !== undefined ? [`- Open with nobody assigned: ${figure(t.unassigned)}`] : []),
    `- Open with no update in ${d.staleDays}+ days: ${figure(t.stale)}`,
    `- Ageing of open tickets: ${(d.ageing?.buckets || []).map((b) => `${b.label} ${b.count}`).join('; ') || 'not available'}`,
  ];
  const names = [];
  const owner = (r) => `${r.name}: ${r.count} open (working ${r.classes?.working ?? 0}, waiting ${r.classes?.waiting ?? 0}, new ${r.classes?.new ?? 0}, other ${r.classes?.other ?? 0})`;
  const people = (d.byAssignee || []).filter((r) => !r.others).slice(0, 8);
  if (people.length && !blocked.has('assigned_to')) {
    lines.push(`- Open work by person (busiest ${people.length}): ${people.map(owner).join('; ')}`);
  }
  people.forEach((r) => !NO_ONE.test(r.name) && names.push(r.name));
  const groups = (d.byGroup || []).filter((r) => !r.others).slice(0, 8);
  if (groups.length && !blocked.has('assignment_group')) lines.push(`- Open work by group (busiest ${groups.length}): ${groups.map(owner).join('; ')}`);
  const pp = d.pingPong;
  if (pp?.available) {
    lines.push(`- Tickets handed over ${pp.threshold}+ times: ${pp.count}`);
    (pp.items || []).slice(0, 5).forEach((i) => {
      lines.push(`  - ${i.number}: ${i.reassignments} reassignments${!blocked.has('assignment_group') && i.group ? `, group ${i.group}` : ''}${!blocked.has('assigned_to') && i.owner ? `, assigned to ${i.owner}` : ''}`);
      if (i.owner) names.push(i.owner);
    });
  }
  return { lines, names };
}

function slaLines(d, blocked) {
  const lines = [
    `- Breached: ${d.counts?.breached ?? 'not available'}; at risk (${d.atRiskPercent}% of the time used or more): ${d.counts?.atRisk ?? 'not available'}; due within ${d.dueSoonHours} hours: ${d.counts?.dueSoon ?? 'not available'}`,
    `- ${d.ticketsAtIssue} tickets are at issue out of ${d.activeSlas} active SLAs`,
  ];
  const names = [];
  const top = (d.top || []).slice(0, 8);
  if (top.length) {
    lines.push('Closest to breaking:');
    top.forEach((t) => {
      const bits = [
        t.number,
        t.breached ? 'breached' : `at ${t.sla?.percentage ?? '?'}% of its time`,
        t.sla?.plannedEnd && `ends ${t.sla.plannedEnd}`,
        !blocked.has('priority') && t.priority && `priority ${t.priority}`,
        !blocked.has('state') && t.state && `state ${t.state}`,
        !blocked.has('assignment_group') && t.group && `group ${t.group}`,
        !blocked.has('assigned_to') && t.owner && `assigned to ${t.owner}`,
      ];
      lines.push(`  - ${bits.filter(Boolean).join(', ')}`);
      if (t.owner) names.push(t.owner);
    });
  }
  const tally = (r) => `${r.name}: breached ${r.breached}, at risk ${r.atRisk}, due soon ${r.dueSoon}`;
  const owners = (d.byOwner || []).filter((r) => r.breached + r.atRisk + r.dueSoon > 0).slice(0, 5);
  if (owners.length && !blocked.has('assigned_to')) lines.push(`- By owner: ${owners.map(tally).join('; ')}`);
  owners.forEach((r) => !NO_ONE.test(r.name) && names.push(r.name));
  const groups = (d.byGroup || []).filter((r) => r.breached + r.atRisk + r.dueSoon > 0).slice(0, 5);
  if (groups.length && !blocked.has('assignment_group')) lines.push(`- By group: ${groups.map(tally).join('; ')}`);
  return { lines, names };
}

function qualityLines(d) {
  const tr = d.trend;
  const series = (label, values) => `- ${label} per ${tr.unit}: ${tr.labels.map((l, i) => `${l} ${values[i]}${tr.partial?.[i] ? ' (partial)' : ''}`).join('; ')}`;
  const lines = [`- Period: ${tr.label}`, series('Opened', tr.opened)];
  if (tr.resolved) lines.push(series('Resolved', tr.resolved));
  if (tr.backlog) lines.push(series('Estimated open at the end of each', tr.backlog));
  if (d.mttr) lines.push(`- Time to resolve: mean ${hours(d.mttr.meanHours)}, median ${hours(d.mttr.medianHours)}, from ${d.mttr.sample} tickets (${d.mttr.window})`);
  if (d.reopen) lines.push(`- Reopened: ${pct(d.reopen.percent)} (${d.reopen.reopened} of ${d.reopen.of}, ${d.reopen.window})`);
  if (d.reassign) lines.push(`- Reassignments: ${round1(d.reassign.average)} on average; ${d.reassign.multi} of ${d.reassign.of} tickets were reassigned ${d.reassign.threshold}+ times`);
  if ((d.categories || []).length) lines.push(`- Top categories: ${d.categories.slice(0, 5).map((c) => `${c.name} ${c.count}`).join('; ')}`);
  if ((d.cis || []).length) lines.push(`- Top configuration items: ${d.cis.slice(0, 5).map((c) => `${c.name} ${c.count}`).join('; ')}`);
  // Callers are people: only the counts are sent.
  if (d.repeatCallers) lines.push(`- Callers with ${d.repeatCallers.min}+ tickets in ${d.repeatCallers.days} days: ${d.repeatCallers.total} (names are not included)`);
  return { lines, names: [] };
}

function fulfilmentLines(d, blocked) {
  const lines = [];
  const names = [];
  (d.byTable || []).forEach((t) => {
    lines.push(`- ${t.label}: ${figure(t.open)} open${t.states ? `; by state: ${t.states.slice(0, 8).map((s) => `${s.name} ${s.count}`).join('; ')}` : ''}`);
  });
  const a = d.approvals || {};
  lines.push(`- Approvals waiting for the person who is signed in: ${figure(a.mine)}${a.team !== undefined ? `; on requested items in this scope: ${figure(a.team)}` : ''}`);
  const oldest = (d.oldest || []).slice(0, 5);
  if (oldest.length) {
    lines.push('Oldest open items:');
    oldest.forEach((i) => {
      lines.push(`  - ${i.number}: ${i.ageDays ?? '?'} days old, state ${i.state}${!blocked.has('assignment_group') && i.group ? `, group ${i.group}` : ''}${!blocked.has('assigned_to') && i.owner ? `, assigned to ${i.owner}` : ''}`);
      if (i.owner) names.push(i.owner);
    });
  }
  return { lines, names };
}

const COMPACT = { overview: overviewLines, handover: handoverLines, workload: workloadLines, sla: slaLines, quality: qualityLines, fulfilment: fulfilmentLines };

/**
 * The pack for "Explain this dashboard", or null when no usable section is on screen.
 * @param {{ id: string, section: string, result: object }[]} entries the widgets' loaded results
 * @param {{ blockedFields?: string[] }} [options]
 */
export function buildInsightsPack(entries, { blockedFields = [], sensitivePrefixes = [] } = {}) {
  const bySection = collectLoaded(entries);
  const present = INSIGHT_SECTIONS.filter((s) => bySection[s.id]);
  if (!present.length) return null;
  const blocked = blockedSet(blockedFields);

  const people = [];
  const sections = present.map((s) => {
    const { lines, names } = COMPACT[s.id](bySection[s.id].data, blocked);
    addPeople(people, 'assigned_to', names);
    return { id: s.id, title: s.title, field: s.field, lines: lines.map((l) => l.slice(0, 600)) };
  });
  const first = bySection[present[0].id];
  const missing = INSIGHT_CORE.filter((id) => !bySection[id]).map((id) => INSIGHT_SECTIONS.find((s) => s.id === id).title);
  const readAts = present.map((s) => bySection[s.id].readAt).filter(Number.isFinite);

  return {
    version: 1,
    table: REPORT_TABLE,
    sysId: 'insights',
    number: '',
    kind: 'other',
    // Figures read from HR cases are HR content: the pipeline's HR rules apply.
    ...(carriesSensitive(present.map((s) => bySection[s.id]), sensitivePrefixes) ? { sensitive: true } : {}),
    fields: {},
    people,
    journal: [],
    related: {},
    access: [],
    report: {
      kind: 'insights',
      scope: scopeText(first, { hideGroups: blocked.has('assignment_group') }),
      readAt: readAts.length ? Math.min(...readAts) : null,
      sections,
      missing,
      notes: [...new Set(present.flatMap((s) => resultNotes(bySection[s.id])))].slice(0, 8),
    },
  };
}

/** What `buildInsightsPack` would use, for the screen: titles of the sections on screen and of the ones that are not. */
export function describeInputs(entries) {
  const bySection = collectLoaded(entries);
  const readAts = INSIGHT_SECTIONS.map((s) => bySection[s.id]?.readAt).filter(Number.isFinite);
  return {
    used: INSIGHT_SECTIONS.filter((s) => bySection[s.id]).map((s) => s.title),
    missing: INSIGHT_CORE.filter((id) => !bySection[id]).map((id) => INSIGHT_SECTIONS.find((s) => s.id === id).title),
    readAt: readAts.length ? Math.min(...readAts) : null,
  };
}

/** The parts the firewall wraps: the scope and what is missing, then one part per section on screen. */
export function insightsParts(pack) {
  const r = pack?.report;
  if (!r || r.kind !== 'insights') return [];
  const head = [
    `Team and scope: ${r.scope}`,
    'The figures below are what the team lead has on the dashboard now. They are aggregates counted by Agent Buddy.',
    ...(r.missing.length ? [`Not on the dashboard, so nothing is known about them: ${r.missing.join(', ')}.`] : []),
    ...(r.notes.length ? ['Things that could not be read or are incomplete:', ...r.notes.map((n) => `- ${n}`)] : []),
  ];
  return [
    { label: 'Dashboard scope', field: 'insights_scope', text: head.join('\n') },
    ...r.sections.map((s) => ({ label: s.title, field: s.field, text: s.lines.join('\n').slice(0, 6000) })),
  ];
}

/** Words used against the cap, and which of the three headings did not come back. */
export const checkInsightsNote = (text) => checkAnswer(text, { headings: INSIGHT_HEADINGS, maxWords: INSIGHT_MAX_WORDS });
