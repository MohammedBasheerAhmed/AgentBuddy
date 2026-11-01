// N24, the ticket journey: what happened to the ticket, in one short list (opened, assigned, passed between groups, state changes,
// the last message from the customer, SLA events, resolved). The no-AI answer to "what happened here?". Pure.
//
// Sources, in order of trust: the record's own dates and counters (opened_at, reassignment_count, reopen_count), the field history
// (sys_audit) when the agent's user may read it, the notes and comments, and the SLA rows. Without the field history the group path
// cannot be known; the card then shows the count and where the ticket is now, and says why.

import { identities, roleOfEntry } from '../itsm/sentiment.js';
import { parseSnTime } from '../context/util.js';
import { noteInstant, storedTime } from './time.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const countOf = (value) => {
  const n = Number.parseInt(text(String(value ?? '')), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const nameOf = (pack, role) => text((Array.isArray(pack?.people) ? pack.people : []).find((p) => p?.role === role)?.name);

/** "Service Desk > Network > Desktop" from the group changes (first old value, then each new one); [] when there are none. */
export function groupPath(changes) {
  const groups = (Array.isArray(changes) ? changes : []).filter((c) => c?.field === 'assignment_group');
  const path = [];
  const push = (name) => {
    const n = text(name);
    if (n && path[path.length - 1] !== n) path.push(n);
  };
  groups.forEach((c, i) => {
    if (i === 0) push(c.from);
    push(c.to);
  });
  return path;
}

const FIELD_LABEL = { assignment_group: 'Assigned to', state: 'State', priority: 'Priority', assigned_to: 'Owner' };

/**
 * @param {{ pack: object, slas?: object[]|null, audit?: { available: boolean, changes?: object[], note?: string }|null, now: number }} input
 *   audit.changes: [{ field, from, to, atUtc }] with display names (the `journey` read resolves them)
 * @returns {{ events: { at: number, label: string, detail: string, kind: string, approx: boolean }[], path: string[],
 *   reassignments: number|null, reopens: number|null, historyRead: boolean, note: string, now: { group: string, owner: string } }}
 *   events are oldest first; every event has a time (an event without one is not listed)
 */
export function buildJourney({ pack, slas = null, audit = null, now }) {
  const f = pack?.fields || {};
  const events = [];
  const add = (at, label, detail, kind, approx = false) => {
    if (Number.isFinite(at)) events.push({ at, label, detail: text(detail), kind, approx });
  };

  const opener = nameOf(pack, 'opened_by');
  add(storedTime(pack, 'opened_at'), 'Opened', opener ? `by ${opener}` : '', 'opened');

  const changes = audit?.available && Array.isArray(audit.changes) ? audit.changes : [];
  for (const c of changes) {
    const label = FIELD_LABEL[c?.field];
    if (!label) continue;
    const to = text(c.to) || '(empty)';
    add(parseSnTime(c.atUtc), c.field === 'assignment_group' ? `Assigned to ${to}` : `${label}: ${to}`, text(c.from) ? `was ${text(c.from)}` : '', c.field);
  }

  // The conversation: the first reply from support, and the customer's last message.
  const ids = identities(pack || {});
  const comments = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e?.type === 'comment' && text(e.text));
  if (ids.known) {
    const firstReply = comments.find((e) => roleOfEntry(e, ids) === 'support');
    const lastCustomer = [...comments].reverse().find((e) => roleOfEntry(e, ids) === 'customer');
    if (firstReply) {
      const t = noteInstant(firstReply, pack);
      add(t.ms, 'First reply to the customer', text(firstReply.by) ? `by ${text(firstReply.by)}` : '', 'reply', t.approx);
    }
    if (lastCustomer) {
      const t = noteInstant(lastCustomer, pack);
      add(t.ms, 'Last message from the customer', '', 'customer', t.approx);
    }
  } else if (comments.length) {
    const last = comments[comments.length - 1];
    const t = noteInstant(last, pack);
    add(t.ms, 'Last customer-visible comment', text(last.by) ? `by ${text(last.by)}` : '', 'comment', t.approx);
  }

  for (const s of Array.isArray(slas) ? slas : []) {
    if (!s || /cancel/i.test(`${s.stage} ${s.stageValue}`)) continue;
    const name = text(s.name) || 'SLA';
    if (s.breached) add(parseSnTime(s.plannedEndUtc), `SLA breached: ${name}`, '', 'sla');
    else if (/pause/i.test(`${s.stage} ${s.stageValue}`)) add(parseSnTime(s.startUtc), `SLA started: ${name}`, 'paused now', 'sla');
  }

  add(storedTime(pack, 'resolved_at'), 'Resolved', '', 'resolved');
  add(storedTime(pack, 'closed_at'), 'Closed', '', 'closed');

  events.sort((a, b) => a.at - b.at);
  const path = groupPath(changes);
  const reassignments = countOf(f.reassignment_count);
  const reopens = countOf(f.reopen_count);
  let note = '';
  if (!audit?.available) note = text(audit?.note) || 'The field history is not readable for your user, so the path between groups is not shown.';
  return {
    events: events.filter((e) => e.at <= now + 60000),
    path,
    reassignments,
    reopens,
    historyRead: Boolean(audit?.available),
    note,
    now: { group: text(f.assignment_group), owner: text(f.assigned_to) },
  };
}

/** The one-line summary: "Reassigned 3 times · Service Desk > Network > Desktop" or "Opened 3 d ago · 2 changes of hands". */
export function journeySummary(journey) {
  const bits = [];
  if (journey.reassignments !== null) bits.push(journey.reassignments === 0 ? 'Never reassigned' : `Reassigned ${journey.reassignments} time${journey.reassignments === 1 ? '' : 's'}`);
  if (journey.reopens) bits.push(`reopened ${journey.reopens} time${journey.reopens === 1 ? '' : 's'}`);
  if (journey.path.length > 1) bits.push(journey.path.slice(-3).join(' > '));
  else if (journey.now.group) bits.push(`now with ${journey.now.group}`);
  return bits.join(' · ') || `${journey.events.length} event${journey.events.length === 1 ? '' : 's'}`;
}
