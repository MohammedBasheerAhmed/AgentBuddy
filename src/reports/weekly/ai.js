// The AI half of "My week" and the weekly report (round 5, docs/round5.md): the packs and the parts of the two AI lines, "The week in
// short" and "One thing to try". Pure functions that turn the weekly result (src/reports/weekly/read.js) into a ContextPack-shaped object
// and the parts the firewall wraps. Nothing here reads from the instance or calls a model.
//
// WHAT IS SENT (and nothing else): COUNTS and TICKET NUMBERS. No name of a person or a group, no ticket text, no short description, no
// configuration item, no comment. The only words that come from ServiceNow are the AREAS (the category a closed ticket was filed under,
// a choice list), and each is cut to a plain label first (cleanArea): anything that looks like free text becomes "Other". The ticket
// numbers are checked against the shape of a ticket number (cleanNumber): anything else is dropped. The screen says so, and the preview
// shows exactly what goes out. tests/round5-weekly-ai.test.js feeds names and ticket text through and checks none arrives.

/** The table label every report pack carries (the audit entry shows it; policy `blockedTables` can name it). */
export const WEEKLY_TABLE = 'report';

export const WEEKLY_MAX_WORDS = 70;
export const TIP_MAX_WORDS = 40;

const NUMBER_RE = /^[A-Za-z]{2,12}\d{4,10}$/;
// A plain label: letters (any script), digits, spaces and a few joiners; short. A category such as "Network" or "Inquiry / Help" passes.
const AREA_RE = /^[\p{L}\p{N}][\p{L}\p{N} /&+()-]{0,38}[\p{L}\p{N})]?$/u;

/** A ticket number as it is written (INC0010001), or '' for anything else. */
export const cleanNumber = (value) => {
  const text = String(value ?? '').trim();
  return NUMBER_RE.test(text) ? text.toUpperCase() : '';
};

/** The numbers of a list, each checked, once, at most `max`. */
export const cleanNumbers = (list, max = 5) => [...new Set((Array.isArray(list) ? list : []).map(cleanNumber).filter(Boolean))].slice(0, max);

/** An area (a category) as a plain label, or "Other" for anything that does not look like one (it may be free text, or hold a name). */
export function cleanArea(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  // (at most four words and no long run of digits: a phone number, an id or a sentence is not a category)
  return text && AREA_RE.test(text) && text.split(' ').length <= 4 && !/\d{4,}|\d[ -]\d/.test(text) ? text : 'Other';
}

const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const figure = (value) => (value === null || value === undefined ? 'not available' : String(value));
const minutes = (ms) => (Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null);
const signed = (n) => (n === null ? null : n > 0 ? `+${n}` : String(n));

/** The areas as { label, count }: every one cleaned, merged when two come out the same, at most 6. */
export function cleanAreas(areas, { blockedFields = [] } = {}) {
  if (!Array.isArray(areas) || (blockedFields || []).map((f) => String(f).toLowerCase()).includes('category')) return [];
  const merged = new Map();
  for (const a of areas) {
    const count = int(a?.count);
    if (!count || count < 1) continue;
    const label = cleanArea(a.name);
    merged.set(label, (merged.get(label) || 0) + count);
  }
  return [...merged].map(([label, count]) => ({ label, count })).slice(0, 6);
}

const weekLine = (window) => (window?.which === 'this' ? 'This week so far (Monday to now), compared with the same days of last week.' : 'The last whole week (Monday to Sunday), compared with the week before it.');

const missing = (leftOut) => [...new Set((Array.isArray(leftOut) ? leftOut : []).map((x) => String(x?.key || '')).filter(Boolean))];
const NAMES = { cameIn: 'came in', closed: 'closed', backlog: 'backlog change', sla: 'SLAs kept', reopened: 'reopened', typical: 'typical time to resolve', reply: 'first reply' };

// ---- The weekly report ----------------------------------------------------------------------------------------------------------------

/**
 * The pack for "The week in short", or null when there is nothing to write from (no data, an empty scope, not one number).
 * @param {object} result the weekly result (data.kind === 'team')
 */
export function buildWeeklyPack(result, { blockedFields = [] } = {}) {
  const d = result?.data;
  if (!d || d.available === false || d.kind !== 'team') return null;
  const n = d.numbers || {};
  if (![n.cameIn, n.closed, n.backlog, n.sla, n.reopened].some(Boolean)) return null;
  return {
    version: 1,
    table: WEEKLY_TABLE,
    sysId: 'weekly',
    number: '',
    kind: 'other',
    fields: {},
    people: [],
    journal: [],
    related: {},
    // The week changes every time: the person sees the preview every time, not only the first.
    requirePreview: true,
    access: [],
    report: {
      kind: 'weekly',
      week: weekLine(d.window),
      figures: {
        cameIn: n.cameIn ? { value: int(n.cameIn.value), before: int(n.cameIn.prev) } : null,
        closed: n.closed ? { value: int(n.closed.value), before: int(n.closed.prev) } : null,
        backlog: n.backlog ? { value: int(n.backlog.value), before: int(n.backlog.prev) } : null,
        sla: n.sla ? { percent: int(n.sla.percent), total: int(n.sla.total), before: int(n.sla.prev) } : null,
        reopened: n.reopened ? { value: int(n.reopened.value), of: int(n.reopened.of), before: int(n.reopened.prev), beforeOf: int(n.reopened.prevOf) } : null,
      },
      areas: cleanAreas(d.areas, { blockedFields }),
      findings: (d.decisions || []).map((x) => ({
        id: x.id === 'cause' || x.id === 'load' || x.id === 'notes' ? x.id : '',
        count: int(x.count),
        people: int(x.people),
        percent: int(x.percent),
        of: int(x.of),
        without: int(x.without),
        closed: int(x.closed),
        numbers: cleanNumbers(x.numbers),
      })).filter((x) => x.id),
      unavailable: missing(d.leftOut).map((k) => NAMES[k]).filter(Boolean),
    },
  };
}

const ago = (b) => (b === null ? '' : ` (week before: ${b})`);

/** The parts the firewall wraps for the weekly summary: one block of figures. Counts and ticket numbers only. */
export function weeklyParts(pack) {
  const r = pack?.report;
  if (!r || r.kind !== 'weekly') return [];
  const f = r.figures;
  const lines = [r.week, 'Figures counted by Agent Buddy from ServiceNow (a figure marked "not available" could not be read):'];
  lines.push(`- Tickets that came in: ${figure(f.cameIn?.value ?? null)}${ago(f.cameIn?.before ?? null)}`);
  lines.push(`- Tickets closed: ${figure(f.closed?.value ?? null)}${ago(f.closed?.before ?? null)}`);
  lines.push(`- Backlog change (came in minus closed): ${figure(signed(f.backlog?.value ?? null))}${f.backlog?.before !== null && f.backlog?.before !== undefined ? ` (week before: ${signed(f.backlog.before)})` : ''}`);
  lines.push(f.sla ? `- SLAs kept: ${figure(f.sla.percent)}% of ${figure(f.sla.total)} SLAs that came due${f.sla.before !== null ? ` (week before: ${f.sla.before}%)` : ''}` : '- SLAs kept: not available');
  lines.push(f.reopened ? `- Closed tickets that were reopened: ${figure(f.reopened.value)} of ${figure(f.reopened.of)} closed (incidents only)${f.reopened.before !== null ? ` (week before: ${f.reopened.before} of ${figure(f.reopened.beforeOf)})` : ''}` : '- Closed tickets that were reopened: not available');
  if (r.areas.length) lines.push(`Closed tickets by area: ${r.areas.map((a) => `${a.label} ${a.count}`).join('; ')}`);
  if (r.findings.length) {
    lines.push('Findings (from fixed rules; ticket numbers only):');
    for (const x of r.findings) {
      const numbers = x.numbers.length ? ` Ticket numbers: ${x.numbers.join(', ')}.` : '';
      if (x.id === 'cause') lines.push(`- ${figure(x.count)} tickets opened this week share one configuration item, so one cause is likely.${numbers}`);
      else if (x.id === 'load') lines.push(`- ${figure(x.people)} people hold ${figure(x.percent)}% of the ${figure(x.of)} open tickets that have an owner.`);
      else lines.push(`- ${figure(x.without)} of ${figure(x.closed)} closed tickets have no fix note.${numbers}`);
    }
  } else lines.push('Findings: none this week.');
  if (r.unavailable.length) lines.push(`Not available this week: ${r.unavailable.join(', ')}.`);
  return [{ label: 'Weekly figures', field: 'weekly_figures', text: lines.join('\n').slice(0, 4000) }];
}

// ---- My week ---------------------------------------------------------------------------------------------------------------------------

/**
 * The pack for "One thing to try", or null when nothing was closed that could be written about.
 * @param {object} result the weekly result (data.kind === 'mine')
 */
export function buildMyWeekPack(result, { blockedFields = [] } = {}) {
  const d = result?.data;
  if (!d || d.available === false || d.kind !== 'mine' || !d.now || d.now.closed === null || d.now.closed === undefined) return null;
  const a = d.now;
  const b = d.before || {};
  return {
    version: 1,
    table: WEEKLY_TABLE,
    sysId: 'my-week',
    number: '',
    kind: 'other',
    fields: {},
    people: [],
    journal: [],
    related: {},
    requirePreview: true,
    access: [],
    report: {
      kind: 'my-week',
      week: weekLine(d.window),
      figures: {
        closed: { value: int(a.closed), before: int(b.closed) },
        typicalMinutes: a.typicalMs === null || a.typicalMs === undefined ? null : { value: minutes(a.typicalMs), before: minutes(b.typicalMs) },
        replyMinutes: a.reply ? { value: minutes(a.reply.meanMs), of: int(a.reply.n), before: b.reply ? minutes(b.reply.meanMs) : null } : null,
        reopened: a.reopened ? { value: int(a.reopened.n), of: int(a.reopened.of), before: b.reopened ? int(b.reopened.n) : null } : null,
        sla: a.sla ? { kept: int(a.sla.kept), total: int(a.sla.total), before: b.sla ? int(b.sla.percent) : null } : null,
      },
      areas: cleanAreas(a.areas, { blockedFields }),
      notes: a.notes ? { closed: int(a.notes.closed), without: int(a.notes.without), reopenedWithout: int(a.notes.reopenedWithout) } : null,
      reopenedNumbers: cleanNumbers(a.reopened?.numbers),
      unavailable: missing(d.leftOut).map((k) => NAMES[k]).filter(Boolean),
    },
  };
}

/** The parts the firewall wraps for "One thing to try": the person's own counts and the numbers of their reopened tickets. */
export function myWeekParts(pack) {
  const r = pack?.report;
  if (!r || r.kind !== 'my-week') return [];
  const f = r.figures;
  const lines = [r.week, 'Figures counted by Agent Buddy for the person who closed the tickets (a figure marked "not available" could not be read):'];
  lines.push(`- Tickets closed: ${figure(f.closed?.value ?? null)}${ago(f.closed?.before ?? null)}`);
  lines.push(f.typicalMinutes ? `- Typical time to resolve (median): ${figure(f.typicalMinutes.value)} minutes${ago(f.typicalMinutes.before)}` : '- Typical time to resolve: not available');
  lines.push(f.replyMinutes ? `- Average first reply: ${figure(f.replyMinutes.value)} minutes, from ${figure(f.replyMinutes.of)} tickets${ago(f.replyMinutes.before)}` : '- Average first reply: not available');
  lines.push(f.reopened ? `- Closed tickets that were reopened: ${figure(f.reopened.value)} of ${figure(f.reopened.of)}${ago(f.reopened.before)}` : '- Closed tickets that were reopened: not available');
  lines.push(f.sla ? `- Closed tickets answered inside the SLA: ${figure(f.sla.kept)} of ${figure(f.sla.total)}` : '- Closed tickets answered inside the SLA: not available');
  if (r.areas.length) lines.push(`Closed tickets by area: ${r.areas.map((a) => `${a.label} ${a.count}`).join('; ')}`);
  if (r.notes) lines.push(`Fix notes: of ${figure(r.notes.closed)} closed tickets of the types that carry a fix note, ${figure(r.notes.without)} had none${r.notes.reopenedWithout === null ? '' : `, and ${r.notes.reopenedWithout} of those came back (were reopened)`}.`);
  if (r.reopenedNumbers.length) lines.push(`Reopened tickets (numbers only): ${r.reopenedNumbers.join(', ')}.`);
  if (r.unavailable.length) lines.push(`Not available this week: ${r.unavailable.join(', ')}.`);
  return [{ label: 'My week figures', field: 'my_week_figures', text: lines.join('\n').slice(0, 4000) }];
}

