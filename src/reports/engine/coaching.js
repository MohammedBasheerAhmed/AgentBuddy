// F6 coaching snapshot, the READ half. GET-only, with the person's own session, through the same reader as every report section.
// What it reads, and nothing more (the columns are the 'coaching-snapshot' spec in src/context/specs/reports.js):
//   - the group (its name) and who is in it, so a comment can be matched to "an agent of this group"
//   - the ticket numbers the group resolved in the chosen days, to pick a sample from (at most 10, by pickSample's fixed rule)
//   - for each sampled ticket: its close notes, close code, and the customer-visible comments written by the group's agents.
//     Work notes are not read. Descriptions and short descriptions are not read. Comment authors are used to filter and are
//     NOT returned: the AI never gets an author name.
//   - the names of the group's members, the ticket's assignee and its requesters, returned only so the firewall can mask them.
// HR-family tables are never read (not in the engine's table list, and refused by name in normalizeCoachingRequest).
//
// Nothing is stored: the reader gets a cache of its own that is dropped with the call, so no close note or comment lingers in
// the shared report cache.
import { SYS_ID_RE, cleanText, clipText, journalText, oneLine } from '../../context/util.js';
import { allowedFields } from '../../context/allowlists.js';
import { parseJournalString } from '../../context/journal.js';
import { isSensitiveTable } from '../../context/kinds.js';
import { COACHING_LIMITS, pickSample } from '../ai/coaching.js';
import { LIMITS } from './constants.js';
import { createCache, createLimiter } from './cache.js';
import { attempt, createReader } from './reader.js';
import { andQuery, disp, normalizeTables, probeTables, raw, resolvedColumn, tableAccess } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { timeOf } from './time.js';
import { say, tm } from './say.js';

export const COACHING_FEATURE = 'coaching-snapshot';
const PEOPLE_COLUMNS = ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'requested_by'];

const fail = (code, reason) => ({ ok: false, code, reason });
const lower = (v) => String(v ?? '').trim().toLowerCase();

const GROUPS_ARE = { denied: tm('Groups are not available to you.'), blocked: tm('Groups are not allowed by your organisation.') };
const MEMBERSHIP_IS = { denied: tm('Group membership is not available to you.'), blocked: tm('Group membership is not allowed by your organisation.') };
const failureText = (read, texts) => texts[read.status] || read.note;

/**
 * @param {ReturnType<import('../ai/coaching.js').normalizeCoachingRequest>} request already checked
 * @param {{ deps: {queryTable: Function, aggregate: Function}, userId: string, blocked?: string[], isBlocked?: (table: string) => boolean, now?: number }} env
 */
export async function readCoachingSample(request, { deps, userId, blocked = [], isBlocked = null, now = Date.now() }) {
  if (!SYS_ID_RE.test(userId || '')) throw new Error(tm('Agent Buddy could not tell who is signed in. Reload the page and try again.'));
  if (request.tables.some(isSensitiveTable)) throw new Error(tm('HR cases are never used for coaching.'));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.sectionTimeoutMs);
  const reader = createReader({ deps, cache: createCache({ ttlMs: 30000 }), limiter: createLimiter(3), prefix: userId, blocked, isBlocked, signal: controller.signal });
  const access = [];
  const notes = [];

  try {
    // 1. The group, as this person can see it.
    const group = await attempt(() => reader.rows('sys_user_group', buildQuery([{ op: 'eq', field: 'sys_id', value: request.groupId }]), ['sys_id', 'name'], { limit: 1, displayValue: false }), 'sys_user_group');
    if (!group.ok) return fail('NO_GROUP', failureText(group, GROUPS_ARE));
    if (!group.value.length) return fail('NO_GROUP', tm('That group is not visible to you.'));
    const groupName = oneLine(raw(group.value[0].name) || request.groupName || 'the group', 80);

    // 2. Its people. Without them nobody can say which comments an agent of the group wrote, so the run stops rather than guess.
    const read = await attempt(
      () => reader.rows('sys_user_grmember', buildQuery([{ op: 'eq', field: 'group', value: request.groupId }, { op: 'true', field: 'user.active' }]), ['user', 'user.user_name'], { limit: COACHING_LIMITS.membersMax, displayValue: true }),
      'sys_user_grmember'
    );
    if (!read.ok) return fail('NO_MEMBERS', say(tm('{reason} Agent Buddy cannot tell which comments this group\'s agents wrote, so it cannot build the snapshot.'), { reason: failureText(read, MEMBERSHIP_IS) }));
    const members = [];
    const seen = new Set();
    read.value.forEach((r) => {
      const name = oneLine(disp(r.user), 80);
      const login = lower(raw(r['user.user_name']));
      const key = login || lower(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      members.push({ name, login });
    });
    if (members.length < COACHING_LIMITS.minMembers) {
      return fail(
        'GROUP_TOO_SMALL',
        members.length === 1
          ? say(tm('This group has one person you can see. A snapshot of fewer than {min} people would describe individuals, not a group, so it is not offered. Pick a larger group.'), { min: COACHING_LIMITS.minMembers })
          : say(tm('This group has {count} people you can see. A snapshot of fewer than {min} people would describe individuals, not a group, so it is not offered. Pick a larger group.'), { count: members.length, min: COACHING_LIMITS.minMembers })
      );
    }
    const logins = new Set(members.map((m) => m.login).filter(Boolean));
    const names = new Set(members.map((m) => lower(m.name)).filter(Boolean));
    const isAgent = (author) => logins.has(lower(author)) || names.has(lower(author));

    // 3. The tickets this group resolved in the chosen days.
    const probed = await probeTables(reader, normalizeTables(request.tables));
    const usable = probed.filter((t) => t.usable);
    if (!usable.length) return fail('NO_TABLE', tm('None of the ticket types can be read with your access.'));
    const found = await Promise.all(
      usable.map(async (t) => {
        const col = resolvedColumn(t);
        if (!col) return { t, skipped: true };
        const filter = buildQuery([
          { op: 'eq', field: 'assignment_group', value: request.groupId },
          { op: 'since', field: col, ms: request.fromMs },
          { op: 'until', field: col, ms: request.toMs },
        ]);
        const rows = await attempt(() => reader.rows(t.table, andQuery(filter, buildQuery([], { orderBy: col, descending: true })), ['sys_id', 'number', col], { limit: COACHING_LIMITS.candidatesMax, displayValue: false }), t.table);
        if (!rows.ok) return { t, failed: rows };
        let total = rows.value.length;
        if (rows.value.length >= COACHING_LIMITS.candidatesMax) {
          const counted = await attempt(() => reader.count(t.table, filter), t.table);
          total = counted.ok ? counted.value : rows.value.length;
        }
        const list = rows.value
          .map((r) => ({ table: t.table, kind: t.meta.singular, sysId: raw(r.sys_id), number: raw(r.number), resolvedMs: timeOf(raw(r[col])) }))
          .filter((c) => SYS_ID_RE.test(c.sysId) && c.number);
        return { t, list, total, capped: total > list.length };
      })
    );
    found.forEach((f) => {
      if (f.failed) access.push({ source: f.t.table, status: f.failed.status, note: `${f.t.meta.label}: ${f.failed.note}` });
      if (f.skipped) notes.push(say(tm('{table} have no resolved date, so they are not part of the sample.'), { table: f.t.meta.label }));
      if (f.capped) notes.push(say(tm('{table}: the sample was chosen from the {shown} most recently resolved of {total}.'), { table: f.t.meta.label, shown: f.list.length, total: f.total }));
    });
    const candidates = found.reduce((n, f) => n + (f.list ? f.total : 0), 0);
    const picked = pickSample(found.flatMap((f) => f.list || []), request.sample);

    // 4. For each sampled ticket: closing information and the group's customer-visible comments.
    async function readTicket(c) {
      const fields = ['sys_id', ...allowedFields(c.table, COACHING_FEATURE)];
      const row = await attempt(() => reader.rows(c.table, buildQuery([{ op: 'eq', field: 'sys_id', value: c.sysId }]), fields, { limit: 1, displayValue: true }), c.table);
      if (!row.ok || !row.value.length) return { unreadable: true, c };
      const r = row.value[0];
      const comments = await readAgentComments(reader, c, isAgent);
      return {
        table: c.table,
        kind: c.kind,
        sysId: c.sysId,
        number: c.number,
        resolvedMs: c.resolvedMs,
        closeCode: oneLine(disp(r.close_code) || disp(r.resolution_code), 80),
        closeNotes: cleanText(disp(r.close_notes), COACHING_LIMITS.closeNotesChars),
        comments: comments.entries,
        commentsNote: comments.note,
        // Only for masking: these names are never shown to the AI as authors or subjects of anything.
        assignee: oneLine(disp(r.assigned_to), 80),
        requesters: [...new Set(PEOPLE_COLUMNS.map((k) => oneLine(disp(r[k]), 80)).filter(Boolean))],
        accessNote: comments.access,
      };
    }
    const details = await Promise.all(picked.map(readTicket));
    const unreadable = details.filter((d) => d.unreadable);
    const tickets = details.filter((d) => !d.unreadable);
    if (unreadable.length) notes.push(say(tm('{count} of the {total} chosen tickets could not be read with your access and were left out.'), { count: unreadable.length, total: picked.length }));
    tickets.forEach((t) => {
      if (t.accessNote) access.push({ source: 'journal', status: 'error', note: `${t.number}: ${t.accessNote}` });
    });
    if (controller.signal.aborted) notes.push(tm('Some of it took too long to read and is missing.'));

    return {
      ok: true,
      group: { id: request.groupId, name: groupName, members: members.length },
      period: { fromMs: request.fromMs, toMs: request.toMs },
      candidates,
      tickets: tickets.map(({ accessNote, ...rest }) => rest),
      agents: members.map((m) => m.name).filter(Boolean),
      tables: tableAccess(probed),
      access,
      notes,
      readAt: reader.readAt || now,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The customer-visible comments of one ticket that agents of the group wrote: the newest few, oldest first, WITHOUT their authors.
 * The journal table is tried first; when it cannot be read the record's own comments column is (the same fallback the context
 * engine uses), unless the organisation blocked the journal table on purpose. Work notes are never asked for.
 */
async function readAgentComments(reader, c, isAgent) {
  const query = buildQuery(
    [{ op: 'eq', field: 'name', value: c.table }, { op: 'eq', field: 'element_id', value: c.sysId }, { op: 'eq', field: 'element', value: 'comments' }],
    { orderBy: 'sys_created_on', descending: true }
  );
  const table = await attempt(() => reader.rows('sys_journal_field', query, ['element', 'value', 'sys_created_on', 'sys_created_by', 'element_id'], { limit: COACHING_LIMITS.commentRows, displayValue: false }), 'sys_journal_field');

  let entries = [];
  let how = '';
  if (table.ok) {
    // An instance that ignores a condition answers with other records' rows: none of them may be used.
    const own = table.value.filter((row) => raw(row.element_id) === c.sysId && raw(row.element) === 'comments');
    entries = own.map((row) => ({ when: raw(row.sys_created_on), by: raw(row.sys_created_by), text: clipText(journalText(raw(row.value)), COACHING_LIMITS.commentChars) }));
    if (entries.length) how = 'journal';
  }
  let access = '';
  if (!entries.length && table.status !== 'blocked') {
    const own = await attempt(() => reader.rows(c.table, buildQuery([{ op: 'eq', field: 'sys_id', value: c.sysId }]), ['sys_id', 'comments'], { limit: 1, displayValue: true }), c.table);
    if (own.ok && own.value.length) {
      entries = parseJournalString(disp(own.value[0].comments), { type: 'comment' }).map((e) => ({ when: e.when, by: e.by, text: clipText(e.text, COACHING_LIMITS.commentChars) }));
      if (entries.length) how = 'record';
    } else if (!own.ok && !table.ok) {
      access = tm('comments could not be read');
    }
  }

  const written = entries.filter((e) => e.text && isAgent(e.by));
  const skipped = entries.length - written.length;
  const newest = written.slice(0, COACHING_LIMITS.commentsPerTicket).reverse(); // newest first in, oldest first out
  const parts = [];
  if (!entries.length) parts.push(access ? 'comments could not be read' : 'no customer-visible comments on the ticket');
  else if (!written.length) parts.push('the comments were not written by agents of this group');
  if (skipped && written.length) parts.push(`${skipped} comment${skipped === 1 ? '' : 's'} by the customer or by people outside the group left out`);
  if (how === 'record') parts.push('read from the ticket\'s own comments field');
  return { entries: newest.map(({ when, text }) => ({ when, text })), note: parts.join('; '), access };
}
