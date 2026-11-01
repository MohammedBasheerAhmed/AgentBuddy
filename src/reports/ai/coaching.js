// F6, the AI half of the coaching snapshot: pure functions only. Reads live in src/reports/engine/coaching.js.
//
// This feature evaluates the written work of people, which some organisations may only do with HR or works-council approval.
// So it is built to look at TEXT, never at people:
//   - the lead picks ONE group and a date range, never a person;
//   - the sample is at most 10 resolved tickets chosen by a fixed rule that uses only the resolution date and the ticket number
//     (pickSample), so nobody can be picked or avoided by name;
//   - the AI gets the close notes, the close code and the customer-visible comments the group's agents wrote, WITHOUT author
//     names, and is told never to name, score, rank or compare an individual;
//   - the answer is checked here for that kind of language (flagPerPersonScoring) and held back behind a warning if it appears;
//   - nothing is stored anywhere, and the whole feature is off until the organisation's policy switches coaching on.
import { SYS_ID_RE, oneLine } from '../../context/util.js';
import { REPORT_TABLE_IDS, STANDARD_TABLE_IDS } from '../engine/constants.js';
import { REPORT_TABLE, addPeople, blockedSet, checkAnswer, line } from './common.js';

export const COACHING_REMINDER = 'This is a coaching aid for the team lead only, not a performance rating.';

/** The fixed rubric, in the order the answer gives it. Each is judged per ticket as Strong, Adequate, Needs work or Not enough to judge. */
export const COACHING_RUBRIC = Object.freeze([
  Object.freeze({ id: 'completeness', label: 'Completeness of notes' }),
  Object.freeze({ id: 'clarity', label: 'Clarity' }),
  Object.freeze({ id: 'tone', label: 'Tone with the customer' }),
  Object.freeze({ id: 'follow-through', label: 'Follow-through' }),
]);

export const COACHING_HEADINGS = Object.freeze(['Group themes:', 'What the group does well:']);

const DAY = 86400000;

export const COACHING_LIMITS = Object.freeze({
  sampleMax: 10,
  sampleDefault: 8,
  rangeDaysMax: 92,
  lookBackDaysMax: 366,
  candidatesMax: 300, // resolved tickets read to choose from (the newest of them when there are more)
  minMembers: 3, // a "group" of one or two people would describe an individual
  membersMax: 200,
  commentRows: 30,
  commentsPerTicket: 4,
  commentChars: 500,
  closeNotesChars: 900,
});

// The columns that carry the content of this feature. A policy that blocks either one makes the feature impossible, and the
// panel says so before reading anything.
export const COACHING_REQUIRED_FIELDS = Object.freeze(['close_notes', 'comments']);

/** '' when the organisation's blocked fields leave coaching possible, else the sentence to show. */
export function coachingBlockedBy(blockedFields) {
  const blocked = blockedSet(blockedFields);
  const hit = COACHING_REQUIRED_FIELDS.filter((f) => blocked.has(f));
  return hit.length ? `Your organisation blocks the ${hit.map((f) => f.replace('_', ' ')).join(' and ')} field${hit.length > 1 ? 's' : ''} that coaching needs, so it cannot run.` : '';
}

// ---- The request ---------------------------------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the local day containing `ms` (offsetMin: minutes west of UTC, as Date#getTimezoneOffset). */
export function formatDay(ms, offsetMin = 0) {
  const d = new Date(ms - offsetMin * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The first and last instant of the days 'YYYY-MM-DD' .. 'YYYY-MM-DD' (both included) in the person's own time zone, or null when
 * either day is not a real date or the last day is before the first. Pure.
 */
export function rangeFromDays(fromDay, toDay, offsetMin = 0) {
  const parse = (text) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!m) return NaN;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms + offsetMin * 60000 : NaN;
  };
  const from = parse(fromDay);
  const to = parse(toDay);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return { fromMs: from, toMs: to + DAY - 1000 };
}

const isHrTable = (table) => /^sn_hr_/i.test(String(table || ''));

/**
 * Check what the panel asked for and return the clean request. Throws an Error whose message is fit for the person.
 * @param {{ groupId?: string, groupName?: string, fromMs?: number, toMs?: number, sample?: number, tables?: string[] }} input
 */
export function normalizeCoachingRequest(input, { now = Date.now() } = {}) {
  const groupId = typeof input?.groupId === 'string' ? input.groupId.trim().toLowerCase() : '';
  if (!SYS_ID_RE.test(groupId)) throw new Error('Pick one group first.');
  const fromMs = Math.floor(Number(input?.fromMs));
  let toMs = Math.floor(Number(input?.toMs));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error('Choose the first and the last day.');
  if (toMs > now + DAY) throw new Error('The last day cannot be in the future.');
  toMs = Math.min(toMs, now);
  if (toMs <= fromMs) throw new Error('The last day must come after the first day.');
  if (toMs - fromMs > COACHING_LIMITS.rangeDaysMax * DAY) throw new Error(`Choose at most ${COACHING_LIMITS.rangeDaysMax} days.`);
  if (fromMs < now - COACHING_LIMITS.lookBackDaysMax * DAY) throw new Error('Choose days from the last twelve months.');
  const asked = Array.isArray(input?.tables) ? input.tables.map((t) => String(t || '').toLowerCase()) : [];
  // HR cases are never coached on: not read, not sampled, not an option.
  if (asked.some(isHrTable)) throw new Error('HR case tables are never used for coaching.');
  const tables = asked.filter((t, i) => REPORT_TABLE_IDS.includes(t) && asked.indexOf(t) === i);
  const n = Math.floor(Number(input?.sample));
  const sample = Number.isFinite(n) ? Math.min(COACHING_LIMITS.sampleMax, Math.max(1, n)) : COACHING_LIMITS.sampleDefault;
  return { groupId, groupName: oneLine(input?.groupName || '', 80), fromMs, toMs, sample, tables: tables.length ? tables : [...STANDARD_TABLE_IDS] };
}

// ---- The sample ----------------------------------------------------------------------------------------------------------

/**
 * Choose up to `k` (1 to 10) tickets from the resolved ones, by a rule that looks at nothing but WHEN a ticket was resolved and its
 * number: sort by resolution time (then number, then id), then take evenly spaced positions through the list. So the sample is
 * spread across the period, is the same every time for the same data, and cannot favour or avoid anyone. Pure.
 * @param {{ sysId: string, number: string, table?: string, resolvedMs?: number }[]} candidates
 */
export function pickSample(candidates, k) {
  const asked = Math.floor(Number(k));
  const size = Number.isFinite(asked) ? Math.min(COACHING_LIMITS.sampleMax, Math.max(1, asked)) : COACHING_LIMITS.sampleDefault;
  const seen = new Set();
  const list = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !c.sysId || !c.number) continue;
    const key = `${c.table || ''}:${c.sysId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(c);
  }
  const at = (c) => (Number.isFinite(c.resolvedMs) ? c.resolvedMs : 0);
  list.sort((a, b) => at(a) - at(b) || String(a.number).localeCompare(String(b.number)) || String(a.sysId).localeCompare(String(b.sysId)));
  if (list.length <= size) return list;
  return Array.from({ length: size }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / size)]);
}

// ---- The pack ------------------------------------------------------------------------------------------------------------

/**
 * The pack for the coaching snapshot, from what the read operation returned (src/reports/engine/coaching.js), or null when the
 * read did not succeed or found nothing to review.
 * @param {object} result the `coachingSample` answer
 * @param {{ blockedFields?: string[], periodLabel?: string }} [options] a blocked close code column is left out; the label is
 *   the period as the lead sees it
 */
export function buildCoachingPack(result, { blockedFields = [], periodLabel = '' } = {}) {
  if (!result || result.ok === false || !Array.isArray(result.tickets) || !result.tickets.length) return null;
  const blocked = blockedSet(blockedFields);
  // Group members come first, so a member who also raised a ticket is known as a team member.
  const people = [];
  addPeople(people, 'agent', result.agents || []);
  addPeople(people, 'agent', result.tickets.map((t) => t.assignee).filter(Boolean));
  addPeople(people, 'requester', result.tickets.flatMap((t) => t.requesters || []));

  return {
    version: 1,
    table: REPORT_TABLE,
    sysId: 'coaching',
    number: '',
    kind: 'other',
    fields: {},
    people,
    journal: [],
    related: {},
    // Different tickets every time: the person sees the preview every time, not only the first (see runLogic.js).
    requirePreview: true,
    access: (result.access || []).slice(0, 10).map((a) => ({ source: String(a.source || 'report'), status: String(a.status || 'error'), note: line(a.note, 160) })),
    report: {
      kind: 'coaching',
      group: line(result.group?.name || 'the group', 80),
      period: line(periodLabel, 60),
      candidates: Number.isFinite(result.candidates) ? result.candidates : null,
      tickets: result.tickets.map((t) => ({
        number: t.number,
        type: t.kind || '',
        closeCode: blocked.has('close_code') || blocked.has('resolution_code') ? '' : line(t.closeCode, 80),
        closeNotes: String(t.closeNotes || '').slice(0, COACHING_LIMITS.closeNotesChars),
        comments: (t.comments || []).slice(-COACHING_LIMITS.commentsPerTicket).map((c) => ({ when: line(c.when, 30), text: String(c.text || '').slice(0, COACHING_LIMITS.commentChars) })),
        commentsNote: line(t.commentsNote, 160),
      })),
      notes: (result.notes || []).map((n) => line(n, 160)).slice(0, 6),
    },
  };
}

/**
 * The parts the firewall wraps: the sample's description, then for each ticket its closing information and the group's
 * customer-visible comments. Their fields are `close_notes` and `comments` on purpose: a policy that blocks either stops the run.
 */
export function coachingParts(pack) {
  const r = pack?.report;
  if (!r || r.kind !== 'coaching') return [];
  const head = [
    `Group: ${r.group}`,
    `Period: ${r.period || 'not stated'}`,
    `Tickets this group resolved in the period: ${r.candidates ?? 'not stated'}. The ${r.tickets.length} below were chosen by a fixed rule (spread evenly over the resolution dates), not by who worked on them.`,
    `Rubric for each ticket: ${COACHING_RUBRIC.map((x) => x.label).join('; ')}.`,
    'Author names are not included. Comments are only those written by agents of this group and visible to the customer.',
    ...(r.notes.length ? ['Things that could not be read or are incomplete:', ...r.notes.map((n) => `- ${n}`)] : []),
  ];
  const parts = [{ label: 'Coaching sample', field: 'coaching_scope', text: head.join('\n') }];
  for (const t of r.tickets) {
    const closing = [`Ticket ${t.number}${t.type ? ` (${t.type})` : ''}`, ...(t.closeCode ? [`Close code: ${t.closeCode}`] : []), `Close notes: ${t.closeNotes.trim() || '(empty)'}`];
    parts.push({ label: `Closed ticket ${t.number}`, field: 'close_notes', text: closing.join('\n') });
    const comments = t.comments.length
      ? t.comments.map((c) => `${c.when ? `[${c.when}] ` : ''}${c.text}`)
      : [`No customer-visible comment written by this group's agents was found${t.commentsNote ? ` (${t.commentsNote})` : ''}.`];
    parts.push({ label: `Customer comments on ${t.number}`, field: 'comments', text: comments.join('\n') });
  }
  return parts;
}

/** Group sections the answer must end with. The per-ticket blocks are checked by the reader, not by a rule. */
export const checkCoachingAnswer = (text) => checkAnswer(text, { headings: COACHING_HEADINGS });
