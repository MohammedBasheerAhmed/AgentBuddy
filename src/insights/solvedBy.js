// Find the fix: "solved before by". Which assignment group the solved look-alikes went to, how many, and who in it solved most of them
// ("Service Desk – Email: 3 solved look-alikes (Beth Anglin solved 2 of them)"), so the agent knows whom to ask. No AI: a count over
// what the look-alikes' own records say (the `lookalikes` read, src/context/similar.js: assignment_group with the routing read, and
// assigned_to), read with the agent's session. Pure.
//
// For the panel only. The names here (groups and people) are shown to the agent, who can open those tickets anyway; they are never put
// into a prompt (assigned_to is on HIT_PERSON_COLUMNS, so it is masked if a hit ever reaches one).
//
// Thresholds: fewer than two look-alikes that name a group says nothing; a tie for the most says the tied groups; a person is named
// only when they solved two or more of the top group's look-alikes and nobody solved as many.

import { isolate, t, tn } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const key = (v) => text(v).toLowerCase().replace(/\s+/g, ' ');

function tally(hits, column) {
  const counts = new Map();
  for (const hit of hits) {
    const name = text(hit?.[column]);
    if (!name) continue;
    const k = key(name);
    const entry = counts.get(k) || { name, count: 0, numbers: [], hits: [] };
    entry.count += 1;
    if (text(hit.number)) entry.numbers.push(text(hit.number));
    entry.hits.push(hit);
    counts.set(k, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const strip = ({ hits, ...rest }) => rest;
const NOTHING = Object.freeze({ enough: false, tie: false, total: 0, group: null, groups: [], person: null, line: '', after: '', fact: '' });

/**
 * @param {object[]} hits solved look-alikes with assignment_group (display name) and assigned_to (display name)
 * @returns {{ enough: boolean, tie: boolean, total: number, group: { name, count, numbers }|null, groups: { name, count, numbers }[],
 *   person: { name, count }|null, line: string, after: string, fact: string }}
 *   total: look-alikes that name a group. line: the card's one line on its own ("Solved 3 times before by Service Desk"); after: the
 *   same after another fact ("Error 0x800CCC0F found · solved 3 times before by ..."); fact: the value of "Solved before by".
 */
export function solvedBy(hits) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && typeof h === 'object');
  const withGroup = list.filter((h) => text(h.assignment_group));
  const total = withGroup.length;
  if (total < 2) return { ...NOTHING, total };
  const ranked = tally(withGroup, 'assignment_group');
  const top = ranked[0];
  const tied = ranked.filter((g) => g.count === top.count);
  const groups = ranked.map(strip);

  if (tied.length > 1) {
    const names = tied.slice(0, 3).map((g) => isolate(g.name)).join(t(', '));
    return {
      enough: true,
      tie: true,
      total,
      group: null,
      groups,
      person: null,
      line: t('Solved before by {groups}', { groups: names }),
      after: t('solved before by {groups}', { groups: names }),
      fact: tn(top.count, '{groups}: {n} solved look-alike each', '{groups}: {n} solved look-alikes each', { groups: names }),
    };
  }

  // Who in that group solved most of its look-alikes: two or more, and nobody else as many.
  const people = tally(top.hits, 'assigned_to');
  const lead = people[0] && people[0].count >= 2 && !(people[1] && people[1].count === people[0].count) ? { name: people[0].name, count: people[0].count } : null;
  const group = isolate(top.name);
  const main = tn(top.count, '{group}: {n} solved look-alike', '{group}: {n} solved look-alikes', { group });
  const who = lead ? tn(lead.count, '{name} solved {n} of them', '{name} solved {n} of them', { name: isolate(lead.name) }) : '';
  return {
    enough: true,
    tie: false,
    total,
    group: strip(top),
    groups,
    person: lead,
    line: tn(top.count, 'Solved {n} time before by {group}', 'Solved {n} times before by {group}', { group }),
    after: tn(top.count, 'solved {n} time before by {group}', 'solved {n} times before by {group}', { group }),
    fact: who ? t('{what} ({why})', { what: main, why: who }) : main,
  };
}
