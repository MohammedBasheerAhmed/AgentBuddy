// The caller briefing's related list (docs/focus-layout.md, part B): who the caller of a ticket is, and what the `history` read
// (src/content/reads.js, src/context/history.js) answered about their other tickets, put onto a ContextPack for the feature's
// enrich() (src/features/packs/caller.js), and the text of that list for the parts (src/domain/parts.js).
//
// The answer comes from the page's side of the extension, so it is treated as untrusted data: only the expected keys are kept, every
// value becomes a short plain string on one line (text from another ticket cannot start a line that looks like one of our labels), a
// record number must look like one, the list is capped, and a status we do not know becomes an error.
//
// No names. The history read asks for no person column (the caller is the same person on every row, and is on the pack already);
// a name written inside a close note is masked when it is someone on the pack, by pattern otherwise, and the person sees what is
// sent every time (requirePreview), as for every pack that carries other tickets' text.

import { SYS_ID_RE, oneLine } from '../context/util.js';

/** At most this many of the caller's tickets reach the AI (the `history` read is asked for the newest 10 too). */
export const CALLER_TICKETS_LIMIT = 10;

/**
 * Who the caller of a ticket is: the first of these roles (src/context/people.js PERSON_FIELDS) that the pack's people list has with a
 * sys_id. The same roles in the same order as the Ticket screen's caller card (CALLER_ROLES in src/sidepanel/ticket/cards/data.js), so
 * the card and the briefing always talk about the same person. opened_by comes last: an agent often opens a ticket for someone else,
 * so it only stands in when the record names nobody it is for (a problem, a catalog task, a plain task).
 */
export const CALLER_ROLES = Object.freeze(['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'opened_by']);

// The people list keeps ONE role per person: the first column that names them, in the order of the kind's ceiling (src/context/people.js
// resolvePeople). On an HR case the employee is usually both subject_person and opened_for, and subject_person comes first, so the
// opened_for person is found under that role. (Without this an HR case would almost never have a caller.)
const SAME_AS = { opened_for: ['opened_for', 'subject_person'] };

// How the record names the column the caller is in, for the model (the role, never the person).
const ROLE_FIELD = {
  caller: 'Caller',
  requested_for: 'Requested for',
  contact: 'Contact',
  consumer: 'Consumer',
  opened_for: 'Opened for',
  subject_person: 'Subject person',
  opened_by: 'Opened by',
};

// The tables the history read looks at (src/context/history.js HISTORY_SOURCES), in the words the model reads.
const TYPE_OF_TABLE = { incident: 'incident', sc_req_item: 'requested item', sn_customerservice_case: 'case', sn_hr_core_case: 'HR case' };
const LIST_OF_TABLE = { incident: 'incidents', sc_req_item: 'requested items', sn_customerservice_case: 'customer service cases', sn_hr_core_case: 'HR cases' };

const STATUSES = new Set(['ok', 'empty', 'empty-or-hidden', 'denied', 'error', 'skipped', 'blocked']);
// A table that could not be checked: the list may be missing some of the caller's tickets. 'skipped' is not one (HR cases left out
// on purpose, a table this instance does not have).
const NOT_CHECKED = ['blocked', 'denied', 'error', 'empty-or-hidden'];
const PHRASE = {
  blocked: 'not allowed by your organisation',
  denied: 'not readable by your user',
  error: 'could not be read',
  'empty-or-hidden': 'nothing visible to your user, so some may be hidden',
};

// A record number: letters then digits (INC0010123, RITM0010050, CS0001234, HRC0001001).
const NUMBER_RE = /^[A-Za-z]{2,12}\d{4,12}$/;
const CLOSED_STATE = /closed|resolved|cancel|complete|solved/i;
const HR_TABLE = /^sn_hr_/i;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v, max) => oneLine(typeof v === 'string' || typeof v === 'number' ? String(v) : '', max);
const numberOf = (v) => {
  const n = text(v, 40);
  return NUMBER_RE.test(n) ? n.toUpperCase() : '';
};

/**
 * The caller of a pack: `{ role, sysId }` of the first CALLER_ROLES person with a valid sys_id, or null. `role` is the role the person
 * has on the pack (an HR case's employee may be there as subject_person, see SAME_AS).
 */
export function callerOf(pack) {
  const people = Array.isArray(pack?.people) ? pack.people.filter(isObject) : [];
  for (const wanted of CALLER_ROLES) {
    for (const role of SAME_AS[wanted] || [wanted]) {
      const person = people.find((p) => p.role === role && SYS_ID_RE.test(String(p.sysId || '')));
      if (person) return { role, sysId: String(person.sysId).toLowerCase() };
    }
  }
  return null;
}

/** Is the ticket itself an HR record? Only then may the caller's HR cases be part of its briefing (see the feature, caller.js). */
export const isHrTicket = (pack) => HR_TABLE.test(String(pack?.table || '')) || pack?.kind === 'hr_case';

/**
 * The tickets of an answer, cleaned, newest first (the read answers oldest first). Never more than CALLER_TICKETS_LIMIT, never one
 * without a number and a short description, and an HR case only when `allowHr`.
 */
export function cleanCallerTickets(items, { allowHr = false } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter(isObject)
    .filter((row) => allowHr || !HR_TABLE.test(String(row.table || '')))
    .map((row) => {
      const table = text(row.table, 80);
      const state = text(row.state, 40);
      const resolved = text(row.resolved_at, 40);
      return {
        number: numberOf(row.number),
        type: TYPE_OF_TABLE[table] || 'ticket',
        short_description: text(row.short_description, 300),
        state,
        opened_at: text(row.opened_at, 40),
        resolved_at: resolved,
        close_code: text(row.close_code, 60),
        // The fix in a few sentences (the read keeps 400 characters).
        close_notes: text(row.close_notes, 300),
        open: !resolved && row.active !== 'false' && !CLOSED_STATE.test(state),
        hr: HR_TABLE.test(table),
      };
    })
    .filter((row) => row.number || row.short_description)
    .reverse()
    .slice(0, CALLER_TICKETS_LIMIT);
}

// The read's access entries, cleaned: { table, status } for each table it says something about.
const accessOf = (answer) =>
  (Array.isArray(answer?.access) ? answer.access : [])
    .filter(isObject)
    .slice(0, 8)
    .map((a) => ({ table: text(a.source, 80), status: STATUSES.has(a.status) ? a.status : 'error' }));

// The worst of what the tables said, for the one entry that says the whole list could not be read.
const WORST = ['blocked', 'denied', 'error', 'empty-or-hidden'];
const worstOf = (entries) => WORST.find((status) => entries.some((e) => e.status === status)) || 'error';

// A later ticket the read saw coming back soon after an earlier one was resolved (src/context/history.js reopenHint). Kept only when
// both numbers are on the list that is sent, so the model is never told about a ticket it cannot see.
function repeatOf(signals, rows) {
  const hint = isObject(signals) && isObject(signals.reopenedHint) ? signals.reopenedHint : null;
  if (!hint) return null;
  const earlier = numberOf(hint.earlier);
  const later = numberOf(hint.later);
  const days = Number(hint.days);
  const listed = new Set(rows.map((r) => r.number).filter(Boolean));
  if (!earlier || !later || earlier === later || !listed.has(earlier) || !listed.has(later) || !Number.isFinite(days) || days < 0 || days > 14) return null;
  return { earlier, later, days: Math.round(days * 10) / 10 };
}

/**
 * @param {object} pack ContextPack
 * @param {{ items?: object[], signals?: object, access?: object[] }} answer what the `history` read returned
 * @param {{ caller: { role: string }, allowHr?: boolean }} options
 * @returns {object} a new pack. When at least one table was read: `related.callerTickets` (a list, possibly empty) and
 *   `related.callerTicketsSummary` ({ role, more, notChecked, repeat }); `requirePreview` when the list has tickets; `sensitive` when
 *   an HR case is on it. When no table could be read: no list, and one `caller-history` access entry saying so.
 */
export function mergeCallerTickets(pack, answer, { caller, allowHr = false } = {}) {
  const access = accessOf(answer);
  const worked = access.some((a) => a.status === 'ok' || a.status === 'empty');
  if (!worked || !Array.isArray(answer?.items)) {
    const failed = access.filter((a) => NOT_CHECKED.includes(a.status));
    return withEntry(pack, failed.length ? worstOf(failed) : 'error', "The caller's other tickets could not be read.");
  }
  const cleaned = cleanCallerTickets(answer.items, { allowHr });
  const rows = cleaned.map(({ hr: _hr, ...row }) => row);
  const notChecked = access
    .filter((a) => NOT_CHECKED.includes(a.status) && (allowHr || !HR_TABLE.test(a.table)))
    .map((a) => ({ what: LIST_OF_TABLE[a.table] || 'other tickets', status: a.status }))
    .filter((a, i, all) => all.findIndex((b) => b.what === a.what) === i);
  const summary = {
    role: ROLE_FIELD[caller?.role] ? caller.role : '',
    more: rows.length >= CALLER_TICKETS_LIMIT,
    notChecked,
    repeat: repeatOf(answer.signals, rows),
  };
  return {
    ...pack,
    related: { ...(pack.related || {}), callerTickets: rows, callerTicketsSummary: summary },
    // Other tickets' wording (written by other agents too): the person sees what is sent every time.
    ...(rows.length ? { requirePreview: true } : {}),
    // An HR case on the list (only on an HR ticket, see the feature): the run is gated like any HR record (src/lib/pipeline.js).
    ...(cleaned.some((r) => r.hr) ? { sensitive: true } : {}),
  };
}

// One fixed entry in the pack's access list: the model is told the list is not available (never that it is empty), and the panel
// shows it under "Made without" (src/features/parts.js knows the source 'caller-history').
function withEntry(pack, status, note) {
  return { ...pack, access: [...(Array.isArray(pack?.access) ? pack.access : []), { source: 'caller-history', status, note }] };
}

/** The entry added when the ticket names nobody to look up. Fixed text. */
export const callerTicketsNoCaller = (pack) =>
  withEntry(pack, 'skipped', 'No caller was found on this ticket, so their other tickets were not looked up.');

/** The entry added when the read itself failed (the content script did not answer): fixed text, no error message. */
export const callerTicketsFailed = (pack) => withEntry(pack, 'error', "The caller's other tickets could not be read.");

// ---- The text of the list (src/domain/parts.js puts it in a part of its own) ----------------------------------------------------

const present = (value) => String(value ?? '').trim();

function rowLine(r) {
  const when = [r.opened_at ? `opened ${r.opened_at}` : 'opening date not shown', r.resolved_at ? `resolved ${r.resolved_at}` : ''].filter(Boolean).join(', ');
  return (
    `- ${present(r.number) || 'Number not shown'} (${present(r.type) || 'ticket'}, ${present(r.state) || 'state not shown'}): ` +
    `${present(r.short_description) || 'no short description'}; ${when}` +
    `${present(r.close_code) ? ` | Close code: ${r.close_code}` : ''}${present(r.close_notes) ? ` | Close notes: ${r.close_notes}` : ''}`
  );
}

/**
 * The text of the caller's other tickets, or '' when the pack has no list (it could not be read, or there is no caller: the pack's
 * access says which, and the "Not available" part tells the model). Who the caller is is said by the column they are in, never by name.
 */
export function callerTicketsText(pack) {
  const rows = pack?.related?.callerTickets;
  if (!Array.isArray(rows)) return '';
  const summary = isObject(pack.related.callerTicketsSummary) ? pack.related.callerTicketsSummary : {};
  const role = ROLE_FIELD[summary.role];
  const lines = [
    summary.role === 'opened_by'
      ? 'This ticket names no caller, requester or contact, so the person in its "Opened by" field is taken as the caller.'
      : role
        ? `The caller is the person in this ticket's "${role}" field.`
        : '',
  ];
  if (!rows.length) {
    lines.push('Checked: the caller has no other tickets that your user can see.');
  } else {
    lines.push(`Their other tickets that your user can see: ${rows.length}, newest first.`);
    lines.push(...rows.map((r) => rowLine(isObject(r) ? r : {})));
    const open = rows.filter((r) => r?.open === true).length;
    if (open) lines.push(`Still open: ${open} of them.`);
    if (summary.more === true) lines.push(`At most ${CALLER_TICKETS_LIMIT} are listed; the caller may have older tickets too.`);
  }
  const notChecked = Array.isArray(summary.notChecked) ? summary.notChecked.filter(isObject) : [];
  if (notChecked.length) {
    lines.push(`Not checked, so the list may be incomplete: ${notChecked.map((n) => `${present(n.what)} (${PHRASE[n.status] || PHRASE.error})`).join('; ')}.`);
  }
  const repeat = isObject(summary.repeat) ? summary.repeat : null;
  if (repeat) lines.push(`Possible repeat: ${repeat.later} was opened ${repeat.days} days after ${repeat.earlier} was resolved, with similar wording.`);
  return lines.filter(Boolean).join('\n');
}
