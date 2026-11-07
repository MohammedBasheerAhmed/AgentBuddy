import { formatNumber, isolate, t, tn } from '../../i18n/index.js';
import { KB_MAX_ARTICLES, KB_MAX_OFFSET } from '../../context/knowledge.js';

// What the Duplicates and Gaps tools say about HOW MUCH they looked at, in plain words, always next to their results (audit of
// 2026-11-07, knowledge manager). A read that was cut short, or whose total is not known, never reads as "none found": the line says
// how many were compared of how many, and "No duplicates found." is said only when everything in the scope was compared. Pure: the
// panels pass in what the reads answered; nothing here reads.

/** Every title is compared with every other one here in the panel, so one scan stops at five pages of 300. */
export const MAX_TITLES = KB_MAX_OFFSET + KB_MAX_ARTICLES;
/** The groups kept on screen and in the export (the rest are counted, see groupsShown). */
export const MAX_GROUPS = 100;

const num = (value) => formatNumber(Number(value) || 0);

/**
 * The scope of a comparison by its display names: the knowledge base, with the category when one is chosen.
 * Without either it is all of them ("all knowledge bases").
 */
export function scopeText({ base = '', category = '' } = {}) {
  if (base && category) return t('{base}, category {category}', { base: isolate(base), category: isolate(category) });
  if (base) return isolate(base);
  if (category) return t('category {category}', { category: isolate(category) });
  return t('all knowledge bases');
}

/**
 * The coverage of a duplicate scan.
 * @param {{ compared: number, total?: number|null, truncated?: boolean, next?: number|null, ended?: boolean, groups?: number,
 *   base?: string, category?: string }} scan compared: articles compared so far (all pages); total: how many the scope holds by the
 *   instance's count (null: could not be counted); truncated: more follow by that count; next: the offset to continue at (null:
 *   none, or one scan cannot go further); ended: a page came back empty; groups: groups found.
 * @returns {{ line: string, verdict: string, hints: string[], complete: boolean, more: { next: number, count: number } | null, capped: boolean }}
 *   line: "Compared 300 of 1,240 articles in IT Knowledge Base."; verdict: what was found, and "No duplicates found." only when
 *   complete; hints: why it stopped, when it did; more: what "Compare the next {count}" continues with.
 */
export function duplicatesCoverage({ compared, total = null, truncated = false, next = null, ended = false, groups = 0, base = '', category = '' } = {}) {
  const n = Math.max(0, Math.floor(Number(compared)) || 0);
  const known = Number.isFinite(total);
  // (the count is the instance's own: it cannot be smaller than what was compared)
  const holds = known ? Math.max(Math.floor(total), n) : null;
  const scope = scopeText({ base, category });
  const params = { n: num(n), total: num(holds), scope };
  const line = known
    ? tn(holds, 'Compared {n} of {total} article in {scope}.', 'Compared {n} of {total} articles in {scope}.', params)
    : t('Compared {n} of an unknown number of articles in {scope}.', params);

  // (complete also means the page did not say that more follow: the two are never both true)
  const complete = known && n >= holds && !truncated;
  const goOn = truncated && Number.isFinite(next);
  const capped = truncated && !goOn;
  const verdict =
    groups > 0
      ? tn(groups, '{n} group read alike.', '{n} groups read alike.')
      : n === 0
        ? t('There was nothing to compare.')
        : complete
          ? t('No duplicates found.')
          : t('No duplicates among the {n} compared.', { n: num(n) });

  const hints = [];
  if (capped) {
    // One scan stops at 1,500 titles; a category is the way to look at the rest.
    if (category) hints.push(t('A category this large cannot be compared in full.'));
    else if (known) hints.push(t('Only the {n} most recently changed articles were compared (of {total}). Choose a category to narrow it.', { n: num(n), total: num(holds) }));
    else hints.push(t('Only the {n} most recently changed articles were compared. Choose a category to narrow it.', { n: num(n) }));
  } else if (!goOn) {
    // The end of what can be read. The count may include articles a row rule hides from this person, so a count that is not reached
    // is said, never passed over: those articles were not compared.
    if (ended) hints.push(t('There are no more articles to compare.'));
    if (known && !complete) hints.push(t('The other {m} could not be read; your role may hide them.', { m: num(holds - n) }));
  }
  const more = goOn ? { next, count: known ? Math.max(1, Math.min(KB_MAX_ARTICLES, holds - next)) : KB_MAX_ARTICLES } : null;
  return { line, verdict, hints, complete, more, capped };
}

/** "Showing the 100 biggest of 161 groups." when the groups on screen are not all that were found; '' otherwise. */
export const groupsShown = (shown, total) => (Number(total) > Number(shown) ? t('Showing the {shown} biggest of {total} groups.', { shown: num(shown), total: num(total) }) : '');

const pct = (ratio) => `${Math.round((Number(ratio) || 0) * 100)}%`;

/**
 * One short line on why a group is a group, from what the grouping really uses: the words of the titles (src/knowledge/similarity.js).
 * Not the category and not the text: the grouping looks at neither. The category is added as a plain fact (not as a reason) when the
 * scan is not already by category.
 * @param {{ score?: number, sharedWords?: string[], exactTitle?: boolean, articles?: { category?: string }[] }} cluster
 */
export function groupWhy(cluster, { showCategory = true } = {}) {
  const words = (Array.isArray(cluster?.sharedWords) ? cluster.sharedWords : []).filter(Boolean).slice(0, 6).map(isolate).join(', ');
  const percent = pct(cluster?.score);
  const why = cluster?.exactTitle
    ? t('The titles use the same words.')
    : words
      ? t('The titles share {words} and are about {percent} alike.', { words, percent })
      : t('The titles are about {percent} alike.', { percent });
  const categories = (Array.isArray(cluster?.articles) ? cluster.articles : []).map((a) => String(a?.category || '').trim());
  if (!showCategory || !categories.length || categories.some((c) => !c)) return why;
  const first = categories[0];
  return `${why} ${categories.every((c) => c === first) ? t('All are in the category {category}.', { category: isolate(first) }) : t('They are in different categories.')}`;
}

// ---- Gaps -----------------------------------------------------------------------------------------------------------------------

/**
 * "Looked at 500 of 12,400 tickets resolved in the last 60 days in your groups." The count is the instance's own, so the first number is
 * what was read and the second an upper bound. When the read was cut and the total could not be counted it says so ("of an unknown
 * number"), never a bare number that looks complete.
 * @param {{ scanned?: number, total?: number|null, days?: number, truncated?: boolean }} data
 */
export function lookedAtText(data, scopePhrase = '') {
  const scanned = Number(data?.scanned) || 0;
  const total = Number.isFinite(data?.total) ? data.total : null;
  const days = data?.days || 60;
  if (total !== null && total > scanned) {
    const params = { scanned: num(scanned), total: num(total), days, scope: scopePhrase };
    return scopePhrase ? t('Looked at {scanned} of {total} tickets resolved in the last {days} days {scope}.', params) : t('Looked at {scanned} of {total} tickets resolved in the last {days} days.', params);
  }
  if (total === null && data?.truncated && scanned > 0) {
    const params = { n: num(scanned), days, scope: scopePhrase };
    return scopePhrase
      ? t('Looked at the newest {n} of an unknown number of tickets resolved in the last {days} days {scope}.', params)
      : t('Looked at the newest {n} of an unknown number of tickets resolved in the last {days} days.', params);
  }
  const params = { n: num(scanned), days, scope: scopePhrase };
  return scopePhrase
    ? tn(scanned, 'Looked at {n} ticket resolved in the last {days} days {scope}.', 'Looked at {n} tickets resolved in the last {days} days {scope}.', params)
    : tn(scanned, 'Looked at {n} ticket resolved in the last {days} days.', 'Looked at {n} tickets resolved in the last {days} days.', params);
}

/** "3 tickets, 2 with a written fix": how many tickets stand behind a topic, and how many of them already hold a fix an author can borrow. */
export const topicBacking = (topic) => tn(Number(topic?.count) || 0, '{n} ticket, {m} with a written fix', '{n} tickets, {m} with a written fix', { m: num(topic?.withFix) });
