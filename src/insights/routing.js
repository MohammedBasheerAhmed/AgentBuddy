// N10, where similar tickets went: a vote over the solved look-alikes ("4 of 5 went to Network Support, category Network"). No AI:
// it counts what the look-alikes' own records say, read with the agent's session. Pure.
//
// It is a hint, not a rule. With fewer than two look-alikes that name a group there is no vote, and a split vote says so.

import { isolate, t } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const key = (v) => text(v).toLowerCase().replace(/\s+/g, ' ');

function tally(hits, column) {
  const counts = new Map();
  for (const hit of hits) {
    const name = text(hit?.[column]);
    if (!name) continue;
    const k = key(name);
    const entry = counts.get(k) || { name, count: 0, numbers: [] };
    entry.count += 1;
    entry.numbers.push(text(hit.number));
    counts.set(k, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * @param {object[]} hits solved look-alikes with assignment_group and category (the `lookalikes` read)
 * @param {{ group?: string, category?: string }} [current] the ticket's own group and category
 * @returns {{ enough: boolean, total: number, group: {name, count, numbers}|null, category: {name, count, numbers}|null,
 *   strong: boolean, matchesGroup: boolean|null, line: string, detail: string, groups: object[] }}
 */
export function routingVote(hits, current = {}) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && typeof h === 'object');
  const withGroup = list.filter((h) => text(h.assignment_group));
  const groups = tally(withGroup, 'assignment_group');
  const categories = tally(list, 'category');
  const total = withGroup.length;
  if (total < 2) {
    return { enough: false, total, group: null, category: null, strong: false, matchesGroup: null, line: '', detail: '', groups };
  }
  const group = groups[0];
  const category = categories[0] && categories[0].count >= 2 ? categories[0] : null;
  const tie = groups[1] && groups[1].count === group.count;
  const strong = !tie && group.count >= 2 && group.count / total >= 0.6;
  const currentGroup = text(current.group);
  const matchesGroup = currentGroup ? key(currentGroup) === key(group.name) : null;
  const line = tie
    ? t('Solved look-alikes went to different groups ({groups})', { groups: groups.slice(0, 3).map((g) => `${isolate(g.name)} ${g.count}`).join(t(', ')) })
    : category
      ? t('{count} of {total} solved look-alikes went to {group}, category {category}', { count: group.count, total, group: isolate(group.name), category: isolate(category.name) })
      : t('{count} of {total} solved look-alikes went to {group}', { count: group.count, total, group: isolate(group.name) });
  let detail = '';
  if (currentGroup && !tie) detail = matchesGroup ? t('This ticket is already with {group}.', { group: isolate(group.name) }) : t('This ticket is with {group}.', { group: isolate(currentGroup) });
  else if (!currentGroup && !tie) detail = t('This ticket has no assignment group yet.');
  return { enough: true, total, group, category, strong, matchesGroup, line, detail, groups };
}
