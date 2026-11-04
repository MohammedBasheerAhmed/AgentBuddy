// Notes to ticket: suggestions for the fields Agent Buddy never fills itself (TRACKER.md AI24). No AI is involved: they come from
// GET reads with the person's own session, and they are only SHOWN. Caller, category and assignment group are reference or choice
// fields; the person picks them on the form (FILL_FIELD cannot write them, src/lib/fillable.js).
//
//   category and assignment group  the vote of recently resolved tickets of the same table whose short description shares words
//                                  with the proposed one ("4 of 6 similar resolved incidents went to Network Support")
//   caller                         the active users whose name is exactly one the agent listed under "Names to hide" (the people
//                                  on the call), so the right one can be told apart from a namesake by department and email
//
// readNotesHints(args, deps) runs in the content script (src/content/ops/compose.js); the vote itself (voteRouting) is pure.

import { similarKeywords, rankSimilar } from '../lib/similar.js';
import { STATUS, entry as accessEntry, softRead } from '../context/access.js';
import { SYS_ID_RE, disp, oneLine, queryValue, raw } from '../context/util.js';

/** The ticket tables Notes to ticket works on (a blank incident or case form). */
export const HINT_TABLES = Object.freeze({ incident: 'incident', case: 'sn_customerservice_case', sn_customerservice_case: 'sn_customerservice_case' });
// What is read about each look-alike: its title (to rank it), category and group (the vote). All in the incident and case ceilings.
export const HINT_TICKET_FIELDS = Object.freeze(['sys_id', 'short_description', 'category', 'assignment_group', 'resolved_at']);
// What is read about a user with a listed name: enough to tell two people of the same name apart.
export const HINT_USER_FIELDS = Object.freeze(['sys_id', 'name', 'email', 'department']);
const LOOK_ALIKES = 30;
const VOTERS = 10;
const MIN_VOTES = 2;
const MAX_NAMES = 3;
const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{1,59}$/u;

const bump = (map, key, label) => {
  const before = map.get(key) || { key, label, count: 0 };
  before.count += 1;
  map.set(key, before);
};
const top = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] || null;

/**
 * The category and assignment group most of the look-alikes share, when at least two of them and more than a third share it.
 * @param {{ category?: {value, label}, group?: {id, label} }[]} voters the best look-alikes, best first
 * @returns {{ looked: number, category: {value: string, name: string, count: number}|null, group: {id: string, name: string, count: number}|null }}
 */
export function voteRouting(voters) {
  const list = (Array.isArray(voters) ? voters : []).slice(0, VOTERS);
  const categories = new Map();
  const groups = new Map();
  for (const v of list) {
    if (v?.category?.value) bump(categories, v.category.value, v.category.label || v.category.value);
    if (v?.group?.id && SYS_ID_RE.test(v.group.id)) bump(groups, v.group.id, v.group.label || '');
  }
  const enough = (hit) => hit && hit.count >= MIN_VOTES && hit.count * 3 > list.length;
  const cat = top(categories);
  const grp = top(groups);
  return {
    looked: list.length,
    category: enough(cat) ? { value: cat.key, name: cat.label, count: cat.count } : null,
    group: enough(grp) && grp.label ? { id: grp.key, name: grp.label, count: grp.count } : null,
  };
}

/** The names worth looking up: up to three, letters with spaces, dots, apostrophes or dashes, and a space (a full name). */
export function namesToLookUp(names) {
  const out = [];
  for (const n of Array.isArray(names) ? names : []) {
    const name = String(n ?? '').replace(/\s+/g, ' ').trim();
    if (!NAME_RE.test(name) || !name.includes(' ') || !queryValue(name) || out.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

/**
 * The suggestions, read with the person's session.
 * @param {{ table: string, text: string, names?: string[] }} args table: incident or a case table; text: the proposed short description
 * @returns {Promise<{ routing: ReturnType<typeof voteRouting>, keywords: string[], callers: { name: string, matches: { name, department, email }[] }[], access: object[] }>}
 */
export async function readNotesHints({ table, text, names = [] }, deps) {
  const target = typeof table === 'string' && Object.hasOwn(HINT_TABLES, table) ? HINT_TABLES[table] : '';
  if (!target) throw new Error('Suggestions are only offered for a new incident or case.');
  const access = [];
  const keywords = similarKeywords(String(text ?? '').slice(0, 300), 4).map((w) => w.replace(/[^a-z0-9_-]/g, '')).filter(Boolean);
  let routing = voteRouting([]);
  if (keywords.length) {
    const like = keywords.map((w, i) => `${i ? 'OR' : ''}short_descriptionLIKE${w}`).join('^');
    const { rows, failure } = await softRead(deps, target, `resolved_atISNOTEMPTY^${like}^ORDERBYDESCresolved_at`, HINT_TICKET_FIELDS, { limit: LOOK_ALIKES, displayValue: true });
    if (failure) access.push(accessEntry(target, failure.status, failure.note));
    else {
      // Only rows that really share a word (an ignored condition answers with anything), best first.
      const ranked = rankSimilar(rows.map((r) => ({ ...r, short_description: disp(r.short_description), sys_updated_on: raw(r.resolved_at) })), keywords);
      routing = voteRouting(
        ranked.map(({ row }) => ({
          category: raw(row.category) ? { value: oneLine(raw(row.category), 80), label: oneLine(disp(row.category), 80) } : null,
          group: SYS_ID_RE.test(raw(row.assignment_group)) ? { id: raw(row.assignment_group).toLowerCase(), label: oneLine(disp(row.assignment_group), 100) } : null,
        }))
      );
    }
  }
  const callers = [];
  for (const name of namesToLookUp(names)) {
    // eslint-disable-next-line no-await-in-loop -- at most three small reads, one after the other
    const { rows, failure } = await softRead(deps, 'sys_user', `active=true^name=${queryValue(name)}`, HINT_USER_FIELDS, { limit: 3, displayValue: true });
    if (failure) {
      access.push(accessEntry('sys_user', failure.status, failure.note));
      break;
    }
    // A condition the instance ignored answers with other people: only exact names count.
    const matches = rows
      .filter((r) => oneLine(disp(r.name), 100).toLowerCase() === name.toLowerCase())
      .map((r) => ({ name: oneLine(disp(r.name), 100), department: oneLine(disp(r.department), 100), email: oneLine(disp(r.email), 120) }));
    callers.push({ name, matches });
  }
  if (!access.length) access.push(accessEntry(target, STATUS.OK));
  return { routing, keywords, callers, access };
}
