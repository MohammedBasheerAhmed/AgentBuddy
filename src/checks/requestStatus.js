// A9, "Where is this request?": one plain line that says what a request, requested item or catalog task is waiting for and
// who owns that, computed from the ContextPack alone (no AI, nothing sent anywhere). Pure: no I/O.
//
// Order of what blocks it, first match wins:
//   finished -> an approval was rejected -> an approval is waiting -> on hold / pending -> an open task or item -> nothing
// The pack's `access` list is read too: when the approvals could not be read the answer says so instead of claiming that
// nothing is waiting for approval.

import { approvalKind, finishedKind, isHoldState, isOpenItem, ownerOf } from './states.js';
import { isolate, t, tn } from '../i18n/index.js';

const text = (v) => String(v ?? '').trim();
const FIELD = (pack, name) => text(pack?.fields?.[name]);

// What each source is called when we have to say we could not read it.
const SOURCES = ['sysapproval_approver', 'sc_task', 'sc_req_item', 'sc_item_option_mtom', 'task_sla', 'task'];
const sourceLabel = (source) =>
  ({
    sysapproval_approver: t('approvals'),
    sc_task: t('catalog tasks'),
    sc_req_item: t('requested items'),
    sc_item_option_mtom: t('the answers to the request questions'),
    task_sla: t('SLAs'),
    task: t('tasks'),
  })[source];

/**
 * Honest notes about what the pack could not read: "You cannot see approvals..." Only sources this view shows are listed.
 * @param {{source: string, status: string, note?: string}[]} access
 * @param {string[]} [only] limit to these sources (default: the ones the request views use)
 */
export function accessNotes(access, only = SOURCES) {
  const notes = [];
  for (const entry of Array.isArray(access) ? access : []) {
    if (!only.includes(entry?.source)) continue;
    const label = sourceLabel(entry.source);
    // 'blocked' is the organisation's rule (managed policy blockedTables), not the person's access: say whose it is.
    if (entry.status === 'blocked') notes.push(t('Your organisation does not allow Agent Buddy to read {label}, so they are left out.', { label }));
    else if (entry.status === 'denied') notes.push(t('You cannot see {label} on this instance, so they are left out.', { label }));
    else if (entry.status === 'error') notes.push(t('{label} could not be read just now, so they are left out.', { label: `${label[0].toUpperCase()}${label.slice(1)}` }));
    else if (entry.status === 'empty-or-hidden') notes.push(t('Your user sees no {label} at all, so there may be some that an access rule hides.', { label }));
  }
  return notes;
}

/** True when this source could not be read (so "none" would be a guess). */
function unreadable(access, source) {
  return (Array.isArray(access) ? access : []).some((e) => e?.source === source && ['denied', 'error', 'empty-or-hidden', 'blocked'].includes(e.status));
}

// "A, B and C": the last two joined by the language's own "and".
const andList = (items) => (items.length > 1 ? t('{names} and {last}', { names: items.slice(0, -1).join(t(', ')), last: items[items.length - 1] }) : items[0] || '');

const listNames = (names, max = 3) => {
  const shown = names.slice(0, max).map(isolate);
  const extra = names.length - shown.length;
  if (!shown.length) return '';
  return extra > 0 ? t('{names} and {extra} more', { names: shown.join(t(', ')), extra }) : andList(shown);
};

/** One approval row as the view and the status line use it. */
export function describeApproval(row) {
  const who = text(row?.approver) || text(row?.group);
  return { who: who || t('an approver you cannot see'), named: Boolean(who), state: text(row?.state), kind: approvalKind(row?.state), updated: text(row?.updated) };
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

// The SLA that matters most: a breached one, else the first that is still running. When none is running, each one was met
// (completed, achieved) or cancelled: a cancelled SLA is not called finished.
function slaInfo(pack) {
  const slas = Array.isArray(pack?.related?.slas) ? pack.related.slas : [];
  if (!slas.length) return null;
  const breached = slas.find((s) => s.breached === 'true');
  const running = slas.find((s) => !/complet|cancel|achiev/i.test(text(s.stage)));
  const pick = breached || running;
  if (!pick) {
    const cancelled = slas.filter((s) => /cancel/i.test(text(s.stage))).length;
    if (slas.length === 1) {
      const only = isolate(text(slas[0].name)) || t('unnamed');
      return { text: cancelled ? t('SLA "{name}" was cancelled.', { name: only }) : t('SLA "{name}" is finished.', { name: only }), breached: false };
    }
    const all = cancelled === slas.length ? t('Every SLA was cancelled.') : cancelled ? t('No SLA is running: some were met, some cancelled.') : t('Every SLA is finished.');
    return { text: all, breached: false };
  }
  const name = isolate(text(pick.name)) || t('unnamed');
  if (breached) return { text: t('SLA "{name}" is breached.', { name }), breached: true };
  const paused = /pause/i.test(text(pick.stage));
  const bits = [t('SLA "{name}"', { name }), paused ? t('is paused') : pick.percentage ? t('{percentage}% of the time used', { percentage: pick.percentage }) : t('is running')];
  if (pick.plannedEnd && !paused) bits.push(t('due {date}', { date: isolate(pick.plannedEnd) }));
  return { text: `${bits.join(t(', '))}.`, breached: false };
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
  if (finished === 'done') return out('done', t('Finished ({state}). Nothing is left to wait for.', { state: isolate(stateText || requestState) }));
  if (finished === 'ended') return out('ended', t('Closed without being completed ({state}).', { state: isolate(stateText || requestState) }));

  // 2. Approvals.
  const approvalsKnown = Array.isArray(related.approvals);
  const approvals = (approvalsKnown ? related.approvals : []).map(describeApproval);
  const rejected = approvals.filter((a) => a.kind === 'rejected');
  if (rejected.length) {
    const who = listNames(rejected.map((a) => a.who));
    return out('rejected', t('An approval was rejected by {who}. It will not go ahead unless that is reversed.', { who }), who, rejected.map((a) => t('rejected by {who}', { who: isolate(a.who) })));
  }
  if (approvalKind(approvalField) === 'rejected') return out('rejected', t('The approval was rejected. It will not go ahead unless that is reversed.'));

  const pending = approvals.filter((a) => a.kind === 'pending');
  if (pending.length) {
    const who = listNames(pending.map((a) => a.who));
    const since = pending.find((a) => a.updated)?.updated;
    const line = since ? t('Waiting for approval from {who} (asked {since}).', { who, since: isolate(since) }) : t('Waiting for approval from {who}.', { who });
    return out('approval', line, who, pending.map((a) => t('approval from {who}', { who: isolate(a.who) })));
  }
  if (approvalKind(approvalField) === 'pending') {
    // The approval column says "requested" but no pending row is visible (hidden, or the rows are on the request).
    const why = approvalsKnown ? t('the approval record is not visible to you') : unreadable(access, 'sysapproval_approver') ? t('you cannot see the approvals') : t('who has to approve could not be read');
    return out('approval', t('Waiting for approval ({why}).', { why }), '', [t('approval')]);
  }

  // 3. On hold or pending.
  if (isHoldState(stateText)) {
    const reason = FIELD(pack, 'hold_reason');
    return out('hold', reason ? t('On hold: {reason}.', { reason: isolate(reason) }) : t('{state}. No reason is given on the record.', { state: isolate(stateText) }), ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') }), reason ? [reason] : []);
  }

  // 4. A catalog task seen on its own (its request item could not be read): the task is the work.
  if (kind === 'catalog_task') {
    const owner = ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') });
    return out('task', owner ? t('This task is open and with {owner}.', { owner: isolate(owner) }) : t('This task is open and not assigned to anyone yet.'), owner, [taskLine({ number: FIELD(pack, 'number'), short_description: FIELD(pack, 'short_description') })]);
  }

  // 5. Open catalog tasks (requested item) or open requested items (request).
  const openOf = (rows) => (Array.isArray(rows) ? rows.filter(isOpenItem) : []);
  const openTasks = openOf(related.catalogTasks);
  if (openTasks.length) {
    const first = openTasks[0];
    const owner = ownerOf(first);
    const more = openTasks.length > 1 ? ` ${tn(openTasks.length - 1, '{n} more task is open after it.', '{n} more tasks are open after it.')}` : '';
    const line = t('Waiting on {task}, {state}, {owner}.', { task: isolate(taskLine(first)), state: isolate(text(first.state)) || t('open'), owner: owner ? t('with {owner}', { owner: isolate(owner) }) : t('not assigned to anyone yet') });
    return out('task', `${line}${more}`, owner, openTasks.map(taskLine));
  }
  const openItems = openOf(related.items);
  if (openItems.length) {
    const waiting = openItems.filter((i) => approvalKind(i.approval) === 'pending');
    if (waiting.length) {
      return out('approval', tn(waiting.length, '{names} is waiting for approval.', '{names} are waiting for approval.', { names: listNames(waiting.map(taskLine)) }), '', waiting.map((i) => t('approval for {number}', { number: isolate(text(i.number)) })));
    }
    if (openItems.length === 1) {
      const only = openItems[0];
      const owner = ownerOf(only);
      const line = t('Waiting on {task}, {state}, {owner}.', { task: isolate(taskLine(only)), state: isolate(text(only.state)) || t('open'), owner: owner ? t('with {owner}', { owner: isolate(owner) }) : t('not assigned to anyone yet') });
      return out('task', line, owner, [taskLine(only)]);
    }
    return out('task', tn(openItems.length, '{n} requested item is still open: {numbers}.', '{n} requested items are still open: {numbers}.', { numbers: listNames(openItems.map((i) => text(i.number))) }), '', openItems.map(taskLine));
  }

  // 6. Nothing blocks it.
  const owner = ownerOf({ assignedTo: FIELD(pack, 'assigned_to'), assignmentGroup: FIELD(pack, 'assignment_group') });
  const checked = [];
  if (!approvalsKnown && unreadable(access, 'sysapproval_approver')) checked.push(t('approvals'));
  const unknownTasks = kind === 'requested_item' && !Array.isArray(related.catalogTasks);
  if (unknownTasks) checked.push(t('catalog tasks'));
  const caution = checked.length ? ` ${t('({what} could not be read, so this may be incomplete)', { what: andList(checked) })}` : '';
  if (Array.isArray(related.items) && related.items.length && !openItems.length) {
    return out('progress', t('All requested items are done, but the request itself is still open{caution}.', { caution }), owner);
  }
  const progress = owner
    ? t('In progress. Nothing is blocking it; it is with {owner}{caution}.', { owner: isolate(owner), caution })
    : t('In progress. Nothing is blocking it and nobody is named as owner yet{caution}.', { caution });
  return out('progress', progress, owner);
}
