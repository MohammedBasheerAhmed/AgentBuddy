// The knowledge-gap radar: resolved tickets that have no knowledge article, grouped by what they are about and ranked by how
// many there are. Pure and deterministic: no AI, no network. The tickets come from src/context/knowledge.js (bounded read).
//
// Grouping is by shared keywords of the ticket titles, picked greedily: the most common pair of words (or, when no pair is
// nearly as common, the most common word) names a group, every free ticket that has all its words joins it, and the next
// group is chosen from what is left. A group can therefore always be explained by its label. Tickets left over are grouped by
// category, then by configuration item, when at least two share one.

import { STOP_TICKET, keywordsOf } from './text.js';

export const MIN_CLUSTER = 2;
export const MAX_CLUSTERS = 15;
export const MIN_FIX_CHARS = 40; // close notes at least this long count as "the fix is written down"
const EXAMPLES = 3;
const MAX_KEYWORDS = 8;

const lower = (text) => String(text || '').trim().toLowerCase();

// Email addresses, links, phone numbers and record numbers are not topics, and an address or a number repeated across tickets
// must never turn into a group label (labels are what an outline is drafted from).
const NOISE = [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, /https?:\/\/\S+/gi, /\+?\d[\d\s().-]{6,}\d/g, /\b[A-Z]{2,8}\d{5,}\b/g];
const withoutNoise = (text) => NOISE.reduce((out, re) => out.replace(re, ' '), String(text ?? ''));

function prepare(ticket) {
  const words = keywordsOf(withoutNoise(ticket.title), { stop: STOP_TICKET, max: MAX_KEYWORDS });
  return { ticket, keys: new Set(words.map((w) => w.stem)), forms: new Map(words.map((w) => [w.stem, w.form])) };
}

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

// The group label to try next: a pair of words when one is nearly as common as the best single word, else the best word.
function nextLabel(items, minSize) {
  const singles = new Map();
  const pairs = new Map();
  for (const item of items) {
    const keys = [...item.keys].sort();
    for (const k of keys) bump(singles, k);
    for (let i = 0; i < keys.length; i += 1) for (let j = i + 1; j < keys.length; j += 1) bump(pairs, `${keys[i]}\u0001${keys[j]}`);
  }
  // Most common first; ties go to longer (more specific) words, then alphabetical, so the result is the same every time.
  const best = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0] || null;
  const single = best(singles);
  const pair = best(pairs);
  if (pair && pair[1] >= minSize && single && pair[1] >= 0.5 * single[1]) return pair[0].split('\u0001');
  if (single && single[1] >= minSize) return [single[0]];
  return null;
}

// The value most tickets of a group share, when more than half of them do.
function dominant(tickets, pick) {
  const counts = new Map();
  for (const t of tickets) {
    const value = pick(t);
    if (value) bump(counts, value);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top && top[1] * 2 > tickets.length ? top[0] : '';
}

function describe(id, basis, label, keywords, tickets) {
  const withFix = tickets.filter((t) => t.fixLength >= MIN_FIX_CHARS);
  // Examples that already have a written fix come first (an author can borrow it), then the newest.
  const examples = [...withFix, ...tickets.filter((t) => t.fixLength < MIN_FIX_CHARS)]
    .slice(0, EXAMPLES)
    .map((t) => ({ table: t.table, sysId: t.sysId, number: t.number, title: t.title }));
  return {
    id,
    basis,
    label,
    keywords,
    count: tickets.length,
    withFix: withFix.length,
    category: dominant(tickets, (t) => t.category),
    ci: dominant(tickets, (t) => t.ci),
    tables: [...new Set(tickets.map((t) => t.table))],
    examples,
  };
}

/**
 * Group tickets about the same thing.
 * @param {{ table: string, sysId: string, number: string, title: string, category?: string, ci?: string, fixLength?: number }[]} tickets
 *   newest first (the order is kept inside a group)
 * @returns {object[]} { id, basis: 'keywords'|'category'|'ci', label, keywords: string[], count, withFix, category, ci, tables, examples[] }
 *   biggest first (then those with more written fixes)
 */
export function clusterTickets(tickets, { minSize = MIN_CLUSTER, maxClusters = MAX_CLUSTERS } = {}) {
  let free = (Array.isArray(tickets) ? tickets : []).map((t) => prepare({ fixLength: 0, category: '', ci: '', ...t }));
  const out = [];

  while (free.length >= minSize) {
    const label = nextLabel(free, minSize);
    if (!label) break;
    const members = free.filter((item) => label.every((k) => item.keys.has(k)));
    if (members.length < minSize) break;
    free = free.filter((item) => !members.includes(item));
    // Show the words as they were written, the way most of the group wrote them.
    const forms = label.map((k) => {
      const counts = new Map();
      members.forEach((m) => m.forms.has(k) && bump(counts, m.forms.get(k)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || k;
    });
    out.push(describe('', 'keywords', forms.join(' + '), forms, members.map((m) => m.ticket)));
  }

  // Leftovers that share a category, then a configuration item.
  for (const [basis, pick, noun] of [['category', (t) => t.category, 'Category'], ['ci', (t) => t.ci, 'Configuration item']]) {
    const groups = new Map();
    for (const item of free) {
      const key = lower(pick(item.ticket));
      if (key) groups.set(key, [...(groups.get(key) || []), item]);
    }
    for (const members of [...groups.values()].sort((a, b) => b.length - a.length)) {
      if (members.length < minSize) continue;
      free = free.filter((item) => !members.includes(item));
      const shown = pick(members[0].ticket);
      out.push(describe('', basis, `${noun}: ${shown}`, [], members.map((m) => m.ticket)));
    }
  }

  return out
    .sort((a, b) => b.count - a.count || b.withFix - a.withFix || a.label.localeCompare(b.label))
    .slice(0, maxClusters)
    .map((c, i) => ({ ...c, id: `g${i + 1}` }));
}

/**
 * The radar: which tickets had no article, and what they are about.
 * @param {{ tickets: object[], linked?: Set<string>|string[], linkKnown?: boolean }} input
 *   linked: sys_ids of tickets that have an article; linkKnown: whether that could be read at all. When it could not, no
 *   ticket is left out and the note says so.
 * @returns {{ clusters: object[], considered: number, withArticle: number, candidates: number, unclustered: number, linkKnown: boolean, note: string }}
 */
export function buildGapRadar({ tickets, linked = new Set(), linkKnown = false } = {}, options = {}) {
  const all = Array.isArray(tickets) ? tickets : [];
  const have = new Set([...linked].map((id) => String(id).toLowerCase()));
  const candidates = linkKnown ? all.filter((t) => !have.has(String(t.sysId).toLowerCase())) : all;
  const clusters = clusterTickets(candidates, options);
  const grouped = clusters.reduce((sum, c) => sum + c.count, 0);
  return {
    clusters,
    considered: all.length,
    withArticle: linkKnown ? all.length - candidates.length : 0,
    candidates: candidates.length,
    unclustered: Math.max(0, candidates.length - grouped),
    linkKnown,
    note: linkKnown || !all.length ? '' : 'Could not tell which tickets had an article, so every recent resolved ticket is counted. The list ranks repeated wording, category and configuration item.',
  };
}
