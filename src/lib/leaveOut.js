// "What goes in" (round 5, board F, docs/round5.md): before a request is sent the person can leave out whole groups of it: the notes
// and comments, the caller's other tickets, look-alike tickets, articles... Pure: no storage, no React, no network.
//
// The rules that keep this safe:
//  - It can only take things OUT. Nothing is ever added to a request here, and what the feature builds stays the ceiling: the groups
//    shown are the groups the request really holds (choicesOf), so the list never offers something that is not there.
//  - It works on the finished PARTS of the request, before the firewall masks and seals them, so masking, blocked fields and the
//    organisation's policy treat what is left exactly as before.
//  - The model is told what was left out by the person (leftOutAccess feeds the "Not available" part), so it never reads "no notes"
//    as "the ticket has no notes". The panel says the same under the answer ("Made without: ... (left out by you)").
//  - The ticket's own fields (number, short description, state...) are never a choice: without them there is no request.
//  - What a person chose is kept per AI action in the settings (aiLeaveOut: action id -> group ids): configuration, never ticket text.
import { tm } from '../i18n/core.js';

// Each group: the parts it covers (by the handle the part carries in `field`), its words for the person, and a fixed sentence for the
// model. The labels are the words of the check ("Work notes", "The caller's other tickets"); a part with a field not listed here is not
// a choice and always stays.
export const LEAVE_OUT_GROUPS = Object.freeze([
  { id: 'comments', fields: ['comments'], label: tm('Comments to the customer') },
  { id: 'work_notes', fields: ['work_notes'], label: tm('Work notes (internal)') },
  { id: 'caller_tickets', fields: ['caller_tickets'], label: tm("The caller's other tickets") },
  { id: 'account_cases', fields: ['account_cases'], label: tm("The account's other cases") },
  { id: 'reference_tickets', fields: ['reference_ticket', 'reference_ticket_routing'], label: tm('Solved look-alike tickets') },
  { id: 'kb_articles', fields: ['kb_article'], label: tm('Knowledge articles') },
  { id: 'linked_incidents', fields: ['linked_incidents'], label: tm('Incidents linked to this problem') },
  { id: 'recent_changes', fields: ['recent_changes'], label: tm('Recent changes on the same item') },
  { id: 'schedule_conflicts', fields: ['schedule_conflicts'], label: tm('Other changes overlapping the planned window') },
]);

export const LEAVE_OUT_IDS = Object.freeze(LEAVE_OUT_GROUPS.map((g) => g.id));
const BY_ID = new Map(LEAVE_OUT_GROUPS.map((g) => [g.id, g]));
const FIELD_TO_GROUP = new Map(LEAVE_OUT_GROUPS.flatMap((g) => g.fields.map((f) => [f, g.id])));

/** The ids of an action in the settings are plain handles ('record-summary', 'reply-draft'). */
const ACTION_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MAX_ACTIONS = 80;

/**
 * The groups a request really holds, in the order they are sent, with how many parts each covers: [{ id, label, count }].
 * Only these can be left out. `parts` are the request's parts before anything was left out.
 */
export function choicesOf(parts) {
  const counts = new Map();
  for (const part of Array.isArray(parts) ? parts : []) {
    const id = FIELD_TO_GROUP.get(part?.field);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return LEAVE_OUT_GROUPS.filter((g) => counts.has(g.id)).map((g) => ({ id: g.id, label: g.label, count: counts.get(g.id) }));
}

/** The ids that are known groups, each once, in a fixed order (an unknown id, a repeat or a non-list is dropped). */
export function knownIds(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return LEAVE_OUT_IDS.filter((id) => wanted.has(id));
}

/** The parts without the groups in `ids`. Parts that are not in any group are never removed. */
export function leaveOutParts(parts, ids) {
  const gone = new Set(knownIds(ids));
  if (!gone.size) return Array.isArray(parts) ? parts : [];
  return (Array.isArray(parts) ? parts : []).filter((part) => !gone.has(FIELD_TO_GROUP.get(part?.field)));
}

/**
 * What the request is made without, for the pack's access list (src/features/parts.js unavailable): one entry per group left out,
 * marked `leftOut` so the panel says "left out by you" and the model is told it was the person's choice, not a missing read.
 * @param {{ id: string, label: string }[]} groups the groups that were left out (from choicesOf)
 */
export function leftOutAccess(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter((g) => BY_ID.has(g?.id))
    .map((g) => ({
      source: `left-out:${g.id}`,
      status: 'skipped',
      leftOut: true,
      what: BY_ID.get(g.id).label,
      note: 'The person chose to leave this out, so do not describe it as empty or as "none".',
    }));
}

/**
 * The settings value `aiLeaveOut` as it is kept: only plain action handles, only known groups, at most MAX_ACTIONS actions, and an
 * action with nothing left out is not kept at all. A stored value that is not an object (an old or hand-edited setting) is {}.
 * @returns {Record<string, string[]>}
 */
export function cleanLeaveOut(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [action, ids] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_ACTIONS) break;
    if (!ACTION_ID.test(action)) continue;
    const known = knownIds(ids);
    if (known.length) out[action] = known;
  }
  return out;
}

/** The settings value after the person chose `ids` for one action: the action's entry replaced, or removed when nothing is left out. */
export function withLeaveOut(current, action, ids) {
  const next = { ...cleanLeaveOut(current) };
  const known = knownIds(ids);
  if (!ACTION_ID.test(String(action || ''))) return next;
  if (known.length) next[action] = known;
  else delete next[action];
  return next;
}
