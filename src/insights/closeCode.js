// Close well: the close code the solved look-alikes used ("4 of 5 solved look-alikes used Solved (Work Around)"). No AI: a vote over
// what the look-alikes' own records say, read with the agent's session. Pure.
//
// A hint, not a rule: fewer than two look-alikes with a close code, or a tie, means no suggestion. The suggestion carries the stored
// value (what a form's choice field takes) as well as the label (what the agent reads), because a choice field is filled by value.
// Shared by the Close well row (ResolveCard) and "Prepare to close" (docs/round4.md). Ask the lead before changing what it returns.

import { isolate, t } from '../i18n/index.js';
import { similarKeywords } from '../lib/similar.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const key = (v) => text(v).toLowerCase().replace(/\s+/g, ' ');

/**
 * @param {object[]} hits solved look-alikes (findSimilarTickets in src/context/similar.js) with close_code (the label) and
 *   close_code_value (the stored value; may be '' when the instance did not return it)
 * @param {{ current?: string }} [options] the ticket's own close code (label or value), when one is set already
 * @returns {{ enough: boolean, of: number, value: string, label: string, votes: number, numbers: string[], line: string,
 *   matchesCurrent: boolean|null, ranked: { label: string, value: string, votes: number, numbers: string[] }[] }}
 */
export function closeCodeVote(hits, { current = '' } = {}) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && typeof h === 'object' && text(h.close_code));
  const counts = new Map();
  for (const hit of list) {
    const label = text(hit.close_code);
    const k = key(label);
    const entry = counts.get(k) || { label, value: '', votes: 0, numbers: [] };
    entry.votes += 1;
    if (!entry.value && text(hit.close_code_value)) entry.value = text(hit.close_code_value);
    if (text(hit.number)) entry.numbers.push(text(hit.number));
    counts.set(k, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label));
  const of = list.length;
  const top = ranked[0];
  const tie = Boolean(top && ranked[1] && ranked[1].votes === top.votes);
  if (!top || top.votes < 2 || tie) {
    return { enough: false, of, value: '', label: '', votes: top ? top.votes : 0, numbers: [], line: '', matchesCurrent: null, ranked };
  }
  const cur = key(current);
  const matchesCurrent = cur ? cur === key(top.label) || Boolean(top.value && cur === key(top.value)) : null;
  const line = t('{votes} of {of} solved look-alikes used {code}', { votes: top.votes, of, code: isolate(top.label) });
  return { enough: true, of, value: top.value || top.label, label: top.label, votes: top.votes, numbers: top.numbers, line, matchesCurrent, ranked };
}

// ---- Round 4, the rest of the Close well row (owned by the Close well agent; extends the file, the vote above is unchanged) ------

/**
 * The "Close code" fact, said the way the row and Prepare to close say it: "Suggested: Solved (Work Around). 4 of 5 look-alikes used
 * it."; when the ticket has that code already, a quiet line that says so; '' when there is no vote (nothing is said then).
 * @param {ReturnType<typeof closeCodeVote>|null} vote
 */
export function closeCodeFact(vote) {
  if (!vote?.enough) return '';
  const code = isolate(vote.label);
  if (vote.matchesCurrent === true) return t('The ticket already has {code}, as {votes} of {of} look-alikes did.', { code, votes: vote.votes, of: vote.of });
  return t('Suggested: {code}. {votes} of {of} look-alikes used it.', { code, votes: vote.votes, of: vote.of });
}

// A record number (INC0010019, RITM0010050, CS0001234): letters then digits. Anything else is not named.
const NUMBER_RE = /^[A-Za-z]{2,12}\d{4,12}$/;
const fold = (v) => text(v).toLowerCase();

/**
 * "Looks like a repeat": the newest of the caller's other tickets that reads like this one. The rule the caller history uses for its
 * own repeat hint (src/context/history.js): at least two keywords of the short descriptions shared, or one and the same category or
 * configuration item. No AI; nothing is read for it (the `history` read the "Same caller" card makes, and the ticket's own fields).
 * @param {{ short_description?: string, category?: string, cmdb_ci?: string }} ticket  this ticket's fields (display values)
 * @param {{ items?: object[] } | null} history  the history read (the caller's OTHER tickets, oldest first)
 * @returns {{ number: string, table: string, sysId: string, line: string } | null}  table and sysId '' when they cannot be linked
 */
export function repeatOfCaller(ticket, history) {
  const wanted = new Set(similarKeywords(text(ticket?.short_description), 4));
  if (!wanted.size) return null;
  const category = fold(ticket?.category);
  const ci = fold(ticket?.cmdb_ci);
  const items = Array.isArray(history?.items) ? history.items.filter((h) => h && typeof h === 'object') : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    const number = text(item.number);
    if (!NUMBER_RE.test(number)) continue;
    const shared = similarKeywords(text(item.short_description), 4).filter((w) => wanted.has(w)).length;
    const sameCategory = Boolean(category) && fold(item.category) === category;
    const sameCi = Boolean(ci) && fold(item.cmdb_ci) === ci;
    if (!(shared >= 2 || (shared >= 1 && (sameCategory || sameCi)))) continue;
    const linkable = TABLE_RE.test(text(item.table)) && SYS_ID_RE.test(text(item.sysId));
    return {
      number: number.toUpperCase(),
      table: linkable ? text(item.table) : '',
      sysId: linkable ? text(item.sysId).toLowerCase() : '',
      line: t('{number} from the same caller is the same issue: link it, or raise a problem if it comes back.', { number: isolate(number.toUpperCase()) }),
    };
  }
  return null;
}

/**
 * The "Close well" row's line: the ready part (readyLine in src/checks/resolutionCheck.js) and one fact more, the close code first:
 * "Not yet: the caller has not confirmed · close code suggested".
 */
export function closeWellLine({ ready = '', vote = null, repeat = null } = {}) {
  const bits = [ready].filter(Boolean);
  if (vote?.enough && vote.matchesCurrent !== true) bits.push(t('close code suggested'));
  else if (repeat) bits.push(t('looks like a repeat'));
  return bits.join(' · ');
}
