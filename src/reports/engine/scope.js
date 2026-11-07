// Whose tickets a report covers: just mine, the groups I belong to, or groups I pick. Pure given a reader.
import { SYS_ID_RE, oneLine } from '../../context/util.js';
import { LIMITS, SCOPE_KINDS } from './constants.js';
import { attempt, keyName, raw, disp } from './reader.js';
import { andQuery, buildQuery } from './queryBuilder.js';
import { say, tm } from './say.js';

/** Clean a scope that arrived from the panel: a known kind, valid group ids, short display names. Throws on nonsense. */
export function normalizeScope(input) {
  const kind = SCOPE_KINDS.includes(input?.kind) ? input.kind : 'mine';
  const names = input?.groupNames && typeof input.groupNames === 'object' ? input.groupNames : {};
  const groupIds = [];
  for (const id of Array.isArray(input?.groupIds) ? input.groupIds : []) {
    const text = String(id || '').trim().toLowerCase();
    if (SYS_ID_RE.test(text) && !groupIds.includes(text)) groupIds.push(text);
    if (groupIds.length >= LIMITS.maxGroups) break;
  }
  const groupNames = {};
  groupIds.forEach((id) => {
    const n = oneLine(names[id] || '', 80);
    if (n) groupNames[id] = n;
  });
  if (kind === 'chosen' && !groupIds.length) throw new Error(tm('Pick at least one group.'));
  return { kind, groupIds: kind === 'chosen' ? groupIds : [], groupNames: kind === 'chosen' ? groupNames : {} };
}

/**
 * Order a person's groups for a scope that can hold only `max` of them. Under the cap the membership order stays as it is; over it,
 * the groups that hold the most open work come first (ties keep their order), so a lead in 41 groups is shown the 25 that matter.
 * `work` is a Map of group id -> open tickets, or null when that could not be counted. Pure.
 */
export function pickTeamGroups(groups, { work = null, max = LIMITS.maxGroups } = {}) {
  const list = Array.isArray(groups) ? groups.map((g, i) => ({ g, i })) : [];
  if (list.length > max && work) list.sort((a, b) => (work.get(b.g.id) || 0) - (work.get(a.g.id) || 0) || a.i - b.i);
  return list.map((x) => x.g).slice(0, max);
}

/** "25 of 41 groups used: ..." for a scope that had to leave groups out, or '' when every group fits. Pure. */
export function teamNote({ used, total, ranked, more }) {
  if (!(total > used)) return '';
  if (ranked) {
    return more
      ? say(tm('{used} of {total} or more groups used: the ones with the most open work. Choose groups to see others.'), { used, total })
      : say(tm('{used} of {total} groups used: the ones with the most open work. Choose groups to see others.'), { used, total });
  }
  return more
    ? say(tm('{used} of {total} or more groups used: the first ones in your memberships. Choose groups to see others.'), { used, total })
    : say(tm('{used} of {total} groups used: the first ones in your memberships. Choose groups to see others.'), { used, total });
}

/** Open tickets per group across the tables, for ranking: a Map, or null when nothing could be counted. */
async function openWorkByGroup(reader, ids, tables) {
  const work = new Map();
  let counted = false;
  for (const table of tables) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop -- a few grouped counts, one at a time.
      const r = await attempt(() => reader.groups(table, andQuery('active=true', buildQuery([{ op: 'in', field: 'assignment_group', values: chunk }])), ['assignment_group']), table);
      if (!r.ok) continue;
      counted = true;
      r.value.forEach((g) => {
        const id = g.keys[0]?.value;
        if (id) work.set(id, (work.get(id) || 0) + g.count);
      });
    }
  }
  return counted ? work : null;
}

/**
 * The signed-in user's ACTIVE groups. Memberships are read up to LIMITS.membershipMax; a scope holds at most LIMITS.maxGroups, and
 * when there are more, the ones with the most open work in `tables` are kept (pickTeamGroups).
 * @returns {Promise<{ groups: {id,name}[], total: number, capped: boolean, ranked: boolean, more: boolean, note: string }>}
 *   `more`: the membership read itself was full, so there may be even more groups than `total`.
 * Throws a read failure; the caller decides what to say.
 */
export async function readMyTeam(reader, userId, { tables = [] } = {}) {
  if (!SYS_ID_RE.test(userId || '')) throw new Error(tm('Agent Buddy could not tell who is signed in. Reload the page and try again.'));
  // group.active: a group that was retired keeps its members, and its old tickets would make the numbers look busier than they are.
  const rows = await reader.rows('sys_user_grmember', `user=${userId}^group.active=true`, ['group'], { limit: LIMITS.membershipMax, displayValue: true });
  const seen = new Set();
  const all = [];
  rows.forEach((r) => {
    const id = raw(r.group);
    if (SYS_ID_RE.test(id) && !seen.has(id)) {
      seen.add(id);
      all.push({ id, name: disp(r.group) || tm('A group you cannot see') });
    }
  });
  const more = rows.length >= LIMITS.membershipMax;
  const max = LIMITS.maxGroups;
  const work = all.length > max && tables.length ? await openWorkByGroup(reader, all.map((g) => g.id), tables) : null;
  const groups = pickTeamGroups(all, { work, max });
  const info = { used: groups.length, total: all.length, ranked: Boolean(work), more };
  return { groups, total: all.length, capped: all.length > max, ranked: Boolean(work), more, note: teamNote(info) };
}

/** The groups the signed-in user belongs to: [{ id, name }] (active ones, at most LIMITS.maxGroups). Throws a read failure. */
export async function readMyGroups(reader, userId, options) {
  return (await readMyTeam(reader, userId, options)).groups;
}

/**
 * Chosen groups, checked against THIS instance: a group id saved on another instance (or a group deleted since) would otherwise
 * match no ticket and show zeros that look real. { groups (the ones that exist, with their current names), missing, inactive,
 * checked }. When groups cannot be read (an access rule, a 403) nothing is dropped and `checked` is false.
 */
export async function checkChosenGroups(reader, groups) {
  const ids = groups.map((g) => g.id);
  if (!ids.length) return { groups, missing: [], inactive: [], checked: false };
  const got = await attempt(() => reader.rows('sys_user_group', buildQuery([{ op: 'in', field: 'sys_id', values: ids }]), ['sys_id', 'name', 'active'], { limit: ids.length, displayValue: false }), 'sys_user_group');
  if (!got.ok) return { groups, missing: [], inactive: [], checked: false };
  const found = new Map();
  got.value.forEach((r) => {
    const id = raw(r.sys_id).toLowerCase();
    if (SYS_ID_RE.test(id)) found.set(id, r);
  });
  if (!found.size) {
    // 200 with nothing: only a table this person can see rows of proves that none of them exists (rule 9).
    const vis = await reader.visibility('sys_user_group');
    if (vis.status !== 'ok') return { groups, missing: [], inactive: [], checked: false };
  }
  const missing = groups.filter((g) => !found.has(g.id));
  const kept = groups.filter((g) => found.has(g.id)).map((g) => ({ id: g.id, name: oneLine(raw(found.get(g.id).name), 80) || g.name }));
  const inactive = kept.filter((g) => raw(found.get(g.id).active).toLowerCase() === 'false');
  return { groups: kept, missing, inactive, checked: true };
}

/**
 * When group membership cannot be read, the groups of the tickets assigned to me say which team I work in.
 * @returns {Promise<{id:string,name:string}[]>}
 */
async function inferGroups(reader, userId, tables) {
  const found = new Map();
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop -- a few small reads, one at a time.
    const r = await attempt(() => reader.groups(table, `assigned_to=${userId}^active=true`, ['assignment_group']), table);
    if (r.ok) r.value.forEach((g) => g.keys[0]?.value && SYS_ID_RE.test(g.keys[0].value) && found.set(g.keys[0].value, keyName(g.keys[0], '', tm('A group you cannot see'))));
  }
  return [...found].map(([id, name]) => ({ id, name })).slice(0, LIMITS.maxGroups);
}

/**
 * Turn a scope request into what sections need.
 * @returns {Promise<{ kind, label, userId, groups: {id,name}[], inferred: boolean, empty: boolean, note: string,
 *   query: string, taskQuery: string, unassignedMeaningful: boolean }>}
 *   `query` filters a ticket table; `taskQuery` filters task_sla rows by their ticket (dot-walk).
 */
export async function resolveScope(input, { reader, userId, tables = [] }) {
  const scope = normalizeScope(input);
  if (!SYS_ID_RE.test(userId || '')) throw new Error(tm('Agent Buddy could not tell who is signed in. Reload the page and try again.'));
  if (scope.kind === 'mine') {
    return { kind: 'mine', label: 'Mine', userId, groups: [], inferred: false, empty: false, note: '', query: `assigned_to=${userId}`, taskQuery: `task.assigned_to=${userId}`, unassignedMeaningful: false };
  }

  let groups;
  let inferred = false;
  let note = '';
  let of = 0; // the number of groups there were when not all of them fit
  if (scope.kind === 'chosen') {
    const checked = await checkChosenGroups(reader, scope.groupIds.map((id) => ({ id, name: scope.groupNames[id] || 'Group' })));
    groups = checked.groups;
    const n = checked.missing.length;
    if (n && !groups.length) note = tm('None of the chosen groups exists on this ServiceNow site (they may have been chosen on another one). Choose groups again.');
    else if (n === 1) note = tm('1 of the chosen groups does not exist on this ServiceNow site, so it is left out. Choose groups again.');
    else if (n) note = say(tm('{n} of the chosen groups do not exist on this ServiceNow site, so they are left out. Choose groups again.'), { n });
    if (checked.inactive.length) note = [note, say(tm('No longer active: {names}.'), { names: checked.inactive.map((g) => g.name).join(', ') })].filter(Boolean).join(' ');
  } else {
    const mine = await attempt(() => readMyTeam(reader, userId, { tables }), 'sys_user_grmember');
    if (mine.ok) {
      groups = mine.value.groups;
      note = mine.value.note;
      if (mine.value.capped) of = mine.value.total;
    } else {
      groups = await inferGroups(reader, userId, tables);
      inferred = groups.length > 0;
      note = inferred
        ? tm('Your group memberships are not visible to you, so "my groups" are the groups of the tickets assigned to you.')
        : tm('Your group memberships are not visible to you, and none of your open tickets names a group.');
    }
    if (!groups.length && !note) note = tm('You are not a member of any group that you can see. Pick groups instead.');
  }

  const ids = groups.map((g) => g.id);
  const list = ids.join(',');
  return {
    kind: scope.kind,
    label: scope.kind === 'chosen' ? `Chosen groups (${groups.length})` : `My groups (${of ? `${groups.length} of ${of}` : groups.length})`,
    userId,
    groups,
    inferred,
    empty: !ids.length,
    note,
    query: ids.length ? `assignment_groupIN${list}` : '',
    taskQuery: ids.length ? `task.assignment_groupIN${list}` : '',
    unassignedMeaningful: true,
  };
}
