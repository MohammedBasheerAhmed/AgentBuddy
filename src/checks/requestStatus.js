// A9, "Where is this request?": one plain line that says what a request, requested item or catalog task is waiting for and
// who owns that, computed from the ContextPack alone (no AI, nothing sent anywhere). Pure: no I/O.
//
// Order of what blocks it, first match wins:
//   finished -> an approval was rejected -> an approval is waiting -> on hold / pending -> an open task or item -> nothing
// The pack's `access` list is read too: when the approvals could not be read the answer says so instead of claiming that
// nothing is waiting for approval.

import { approvalKind, finishedKind, isHoldState, isOpenItem, ownerOf } from './states.js';

const text = (v) => String(v ?? '').trim();
const FIELD = (pack, name) => text(pack?.fields?.[name]);

// What each source is called when we have to say we could not read it.
const SOURCE_LABEL = {
  sysapproval_approver: 'approvals',
  sc_task: 'catalog tasks',
  sc_req_item: 'requested items',
  sc_item_option_mtom: 'the answers to the request questions',
  task_sla: 'SLAs',
  task: 'tasks',
};

/**
 * Honest notes about what the pack could not read: "You cannot see approvals..." Only sources this view shows are listed.
 * @param {{source: string, status: string, note?: string}[]} access
 * @param {string[]} [only] limit to these sources (default: the ones the request views use)
 */
export function accessNotes(access, only = Object.keys(SOURCE_LABEL)) {
  const notes = [];
  for (const entry of Array.isArray(access) ? access : []) {
    if (!only.includes(entry?.source)) continue;
    const label = SOURCE_LABEL[entry.source];
    // 'blocked' is the organisation's rule (managed policy blockedTables), not the person's access: say whose it is.
    if (entry.status === 'blocked') notes.push(`Your organisation does not allow Agent Buddy to read ${label}, so they are left out.`);
    else if (entry.status === 'denied') notes.push(`You cannot see ${label} on this instance, so they are left out.`);
    else if (entry.status === 'error') notes.push(`${label[0].toUpperCase()}${label.slice(1)} could not be read just now, so they are left out.`);
    else if (entry.status === 'empty-or-hidden') notes.push(`Your user sees no ${label} at all, so there may be some that an access rule hides.`);
  }
  return notes;
}

/** True when this source could not be read (so "none" would be a guess). */
function unreadable(access, source) {
  return (Array.isArray(access) ? access : []).some((e) => e?.source === source && ['denied', 'error', 'empty-or-hidden', 'blocked'].includes(e.status));
}

const listNames = (names, max = 3) => {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  if (!shown.length) return '';
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  return extra > 0 ? `${shown.join(', ')} and ${extra} more` : head;
};

/** One approval row as the view and the status line use it. */
export function describeApproval(row) {
  const who = text(row?.approver) || text(row?.group);
  return { who: who || 'an approver you cannot see', named: Boolean(who), state: text(row?.state), kind: approvalKind(row?.state), updated: text(row?.updated) };
}

// due date: shown as the instance shows it. "overdue" is only claimed when it is certain, whatever the time zone
// (the display value is in the reader's zone, which we do not know: allow the widest real offset, 14 hours).
function dueInfo(pack, now) {
  const due = FIELD(pack, 'due_date');
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(due);
  let overdue = null;
  if (m && Number.isFinite(now)) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const slack = 14 * 3600 * 1000;
    if (ms + slack < now) overdue = true;
    else if (ms - slack > now) overdue = false;
  }
  return { text: due, overdue };
}

// The SLA that matters most: a breached one, else the first that is still running.
function slaInfo(pack) {
  const slas = Array.isArray(pack?.related?.slas) ? pack.related.slas : [];
  if (!slas.length) return null;
  const breached = slas.find((s) => s.breached === 'true');
  const running = slas.find((s) => !/complet|cancel|achiev/i.test(text(s.stage)));
  const pick = breached || running;
  if (!pick) return { text: `${text(pick?.name) || 'SLA'}: finished`, breached: false };
  if (breached) return { text: `SLA "${text(pick.name) || 'unnamed'}" is breached.`, breached: true };
  const paused = /pause/i.test(text(pick.stage));
  const bits = [`SLA "${text(pick.name) || 'unnamed'}"`, paused ? 'is paused' : pick.percentage ? `${pick.percentage}% of the time used` : 'is running'];
  if (pick.plannedEnd && !paused) bits.push(`due ${pick.plannedEnd}`);
  return { text: `${bits.join(', ')}.`, breached: false };
}

/** "SCTASK0010061 (Deliver the laptop)". */
export const taskLine = (task) => {
  const what = text(task?.short_description) || text(task?.item);
  return [text(task?.number), what && `(${what})`].filter(Boolean).join(' ');
};

/**
 * What the request is waiting for.
 * @param {object} pack a ContextPack of a request, requested item or catalog task
 * @param {{ now?: number }} [options]
 * @returns {{
 *   state: 'done' | 'ended' | 'rejected' | 'approval' | 'hold' | 'task' | 'progress',
 *   line: string,          the one plain sentence
 *   owner: string,         who to chase ('' when nobody is named)
 *   blockers: string[],    the individual things it waits for, one short phrase each
 *   due: { text: string, overdue: boolean | null } | null,
 *   sla: { text: string, breached: boolean } | null,
 *   caveats: string[],     what could not be read
 * }}
 */
export function requestStatus(pack, { now = Date.now() } = {}) {
  const related = pack?.related || {};
  const access = pack?.access || [];
  const due = dueInfo(pack, now);
  const sla = slaInfo(pack);
  const caveats = accessNotes(access);
  const out = (state, line, owner = '', blockers = []) => ({ state, line, owner, blockers, due, sla, caveats });

  const kind = pack?.kind || '';
  const stateText = FIELD(pack, 'state');
  const requestState = FIELD(pack, 'request_state');
  const approvalField = FIELD(pack, 'approval');

  // 1. Finished.
  const finished = finishedKind(stateText) || finishedKind(requestState);
  if (finished === 'done') return out('done', `Finished (${stateText || requestState}). Nothing is left to wait for.`);
  if (finished === 'ended') return out('ended', `Closed without being completed (${stateText || requestState}).`);

  // 2. Approvals.
  const approvalsKnown = Array.isArray(related.approvals);
  const approvals = (approvalsKnown ? related.approvals : []).map(describeApproval);
  const rejected = approvals.filter((a) => a.kind === 'rejected');
  if (rejected.length) {
    const who = listNames(rejected.map((a) => a.who));
    return out('rejected', `An approval was rejected by ${who}. It will not go ahead unless that is reversed.`, who, rejected.map((a) => `rejected by ${a.who}`));
  }
  if (approvalKind(approvalField) === 'rejected') return out('rejected', 'The approval was rejected. It will not go ahead unless that is reversed.');

  const pending = approvals.filter((a) => a.kind === 'pending');
  if (pending.length) {
    const who = listNames(pending.map((a) => a.who));
    const since = pending.find((a) => a.updated)?.updated;
    return out('approval', `Waiting for approval from ${who}${since ? ` (asked ${since})` : ''}.`, who, pending.map((a) => `approval from ${a.who}`));
  }
  if (approvalKind(approvalField) === 'pending') {
    // The approval column says "requested" but no pending row is visible (hidden, or the rows are on the request).
    const why = approvalsKnown ? 'the approval record is not visible to you' : unreadable(access, 'sysapproval_approver') ? 'you cannot see the approvals' : 'who has to approve could not be read';
    return out('approval', `Waiting for approval (${why}).`, '', ['approval']);
  }

  // 3. On hold or pending.
  if (isHoldState(stateText)) {
    const reason = FIELD(pack, 'hold_reason');
    return out('hold', reason ? `On hold: ${reason}.` : `${stateText}. No reason is given on the record.`, ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') }), reason ? [reason] : []);
  }

  // 4. A catalog task seen on its own (its request item could not be read): the task is the work.
  if (kind === 'catalog_task') {
    const owner = ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') });
    return out('task', owner ? `This task is open and with ${owner}.` : 'This task is open and not assigned to anyone yet.', owner, [taskLine({ number: FIELD(pack, 'number'), short_description: FIELD(pack, 'short_description') })]);
  }

  // 5. Open catalog tasks (requested item) or open requested items (request).
  const openOf = (rows) => (Array.isArray(rows) ? rows.filter(isOpenItem) : []);
  const openTasks = openOf(related.catalogTasks);
  if (openTasks.length) {
    const first = openTasks[0];
    const owner = ownerOf(first);
    const more = openTasks.length > 1 ? ` ${openTasks.length - 1} more task${openTasks.length - 1 === 1 ? ' is' : 's are'} open after it.` : '';
    return out('task', `Waiting on ${taskLine(first)}, ${text(first.state) || 'open'}, ${owner ? `with ${owner}` : 'not assigned to anyone yet'}.${more}`, owner, openTasks.map(taskLine));
  }
  const openItems = openOf(related.items);
  if (openItems.length) {
    const waiting = openItems.filter((i) => approvalKind(i.approval) === 'pending');
    if (waiting.length) {
      return out('approval', `${listNames(waiting.map(taskLine))} ${waiting.length === 1 ? 'is' : 'are'} waiting for approval.`, '', waiting.map((i) => `approval for ${text(i.number)}`));
    }
    if (openItems.length === 1) {
      const only = openItems[0];
      const owner = ownerOf(only);
      return out('task', `Waiting on ${taskLine(only)}, ${text(only.state) || 'open'}, ${owner ? `with ${owner}` : 'not assigned to anyone yet'}.`, owner, [taskLine(only)]);
    }
    return out('task', `${openItems.length} requested items are still open: ${listNames(openItems.map((i) => text(i.number)))}.`, '', openItems.map(taskLine));
  }

  // 6. Nothing blocks it.
  const owner = ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') });
  const checked = [];
  if (!approvalsKnown && unreadable(access, 'sysapproval_approver')) checked.push('approvals');
  const unknownTasks = kind === 'requested_item' && !Array.isArray(related.catalogTasks);
  if (unknownTasks) checked.push('catalog tasks');
  const caution = checked.length ? ` (${checked.join(' and ')} could not be read, so this may be incomplete)` : '';
  if (Array.isArray(related.items) && related.items.length && !openItems.length) {
    return out('progress', `All requested items are done, but the request itself is still open${caution}.`, owner);
  }
  return out('progress', `In progress. Nothing is blocking it${owner ? `; it is with ${owner}` : ' and nobody is named as owner yet'}${caution}.`, owner);
}
