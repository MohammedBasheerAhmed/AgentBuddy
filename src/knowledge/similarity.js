// Near-duplicate knowledge articles. Pure and deterministic: no AI, no network.
//
// Stage 1 compares TITLES of the articles in one scope (one knowledge base or category, read 300 at a time, at most 1,500): the
// words of a title and its pairs of neighbouring words ("shingles"), compared with Jaccard similarity. The grouping uses nothing but
// the titles (not the category, not the text), so that is all a group can say about why it is one. Stage 2 compares the TEXT of the
// few articles of one cluster the person picked: overlapping 3-word shingles. Titles decide what is shown; the text figure
// only helps the person judge, and says how much of the shorter article also appears in the other.

import { STOP_TITLE, jaccard, stemsWithForms, wordsOf } from './text.js';
import { parseSnTime } from '../context/util.js';
import { normalizeArabic } from '../lib/scriptDetect.js';

export const DUPLICATE_THRESHOLD = 0.55;
export const MIN_SHARED_WORDS = 2;
export const MAX_CLUSTERS = 25;

// ---- Titles ---------------------------------------------------------------------------------------

/**
 * { words: string[], unigrams: Set, bigrams: Set, forms: Map } for a title. Order matters a little (bigrams), not much. `forms` maps
 * each stem to the word as the title writes it (lower case), for showing: an Arabic stem is folded and cut, not something to read.
 */
export function titleProfile(title) {
  const terms = stemsWithForms(title, STOP_TITLE);
  const words = terms.map((x) => x.stem);
  const forms = new Map();
  for (const { stem, form } of terms) if (!forms.has(stem)) forms.set(stem, form);
  const bigrams = new Set();
  for (let i = 0; i + 1 < words.length; i += 1) bigrams.add(`${words[i]} ${words[i + 1]}`);
  return { words, unigrams: new Set(words), bigrams, forms };
}

/**
 * How alike two titles are, 0 to 1: 65% shared words, 35% shared neighbouring pairs. Two titles with the same words in a
 * different order ("Reset password", "Password reset") still score 0.65. `shared` lists the common words.
 */
export function titleSimilarity(a, b) {
  const pa = a.unigrams ? a : titleProfile(a);
  const pb = b.unigrams ? b : titleProfile(b);
  const shared = [...pa.unigrams].filter((w) => pb.unigrams.has(w));
  const words = jaccard(pa.unigrams, pb.unigrams);
  // A title of one word has no pairs: the word score stands for both.
  const pairs = pa.bigrams.size && pb.bigrams.size ? jaccard(pa.bigrams, pb.bigrams) : words;
  return { score: Math.round((0.65 * words + 0.35 * pairs) * 1000) / 1000, shared };
}

// When an article was last changed, in ms: the stored UTC value when the article carries it (updatedUtc), else the shown one
// (updated) when it is in ServiceNow's own YYYY-MM-DD form; NaN when neither can be read. Never the shown text itself: in the
// person's date format "12/01/2026" sorts after "01/06/2027".
const changedAt = (a) => {
  const stored = parseSnTime(a.updatedUtc);
  return Number.isFinite(stored) ? stored : parseSnTime(a.updated);
};
// Newest first; a time that cannot be read comes after every one that can.
const newerFirst = (x, y) => (Number.isFinite(x) ? (Number.isFinite(y) ? y - x : -1) : Number.isFinite(y) ? 1 : 0);
const cmpRank = (a, b) => b.views - a.views || newerFirst(changedAt(a), changedAt(b)) || String(a.number).localeCompare(String(b.number));

// Do two titles share at least `need` words? Stops counting at `need`. Cheap, so the dearer score is worked out only for titles that
// can pass the "enough shared words" test at all (every pair of a 1,500-title scan goes through here).
function sharesAtLeast(a, b, need) {
  if (need <= 0) return true;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const word of small) {
    if (large.has(word) && (count += 1) >= need) return true;
  }
  return false;
}

/**
 * Groups of articles whose titles read alike, and how many such groups there are in all. The same as findDuplicateClusters, which
 * returns only the groups that are kept (`maxClusters`): `total` is what was found before that cut, so a screen can say "the 25 biggest
 * of 61" instead of looking complete.
 * @returns {{ clusters: object[], total: number }}
 */
export function findDuplicateGroups(articles, { threshold = DUPLICATE_THRESHOLD, minShared = MIN_SHARED_WORDS, maxClusters = MAX_CLUSTERS } = {}) {
  const items = (Array.isArray(articles) ? articles : [])
    .filter((a) => a && a.sysId && String(a.title || '').trim())
    .map((a) => ({ ...a, views: Number(a.views) || 0, updated: a.updated || '', profile: titleProfile(a.title) }))
    .filter((a) => a.profile.unigrams.size)
    .sort(cmpRank);

  const taken = new Set();
  const clusters = [];
  for (const centre of items) {
    if (taken.has(centre.sysId)) continue;
    const members = [];
    for (const other of items) {
      if (other.sysId === centre.sysId || taken.has(other.sysId)) continue;
      const need = Math.min(minShared, centre.profile.unigrams.size, other.profile.unigrams.size);
      if (!sharesAtLeast(centre.profile.unigrams, other.profile.unigrams, need)) continue;
      const { score, shared } = titleSimilarity(centre.profile, other.profile);
      if (score >= threshold && shared.length >= need) members.push({ other, score, shared });
    }
    if (!members.length) continue;
    taken.add(centre.sysId);
    for (const m of members) taken.add(m.other.sysId);
    const strip = ({ profile, ...rest }) => rest;
    const sharedAll = members.map((m) => new Set(m.shared)).reduce((acc, set) => new Set([...acc].filter((w) => set.has(w))));
    clusters.push({
      keep: strip(centre),
      articles: [strip(centre), ...members.map((m) => strip(m.other))],
      score: Math.round((members.reduce((sum, m) => sum + m.score, 0) / members.length) * 100) / 100,
      // The shared words as the centre's title writes them (the stems are for comparing only).
      sharedWords: [...sharedAll].map((w) => centre.profile.forms?.get(w) || w),
      exactTitle: members.every((m) => m.score >= 0.999),
    });
  }
  const kept = clusters
    .sort((a, b) => b.articles.length - a.articles.length || b.score - a.score || cmpRank(a.keep, b.keep))
    .slice(0, maxClusters)
    .map((c, i) => ({ id: `d${i + 1}`, ...c }));
  return { clusters: kept, total: clusters.length };
}

/**
 * Groups of articles whose titles read alike. Greedy and star-shaped: articles are taken most-viewed first (then newest);
 * each one that is not already in a group becomes the centre of a new group made of every still-free article whose title is
 * alike enough. Nothing chains (A~B and B~C never puts A and C together), so a group can always be explained by its centre.
 * @param {{ sysId: string, number: string, title: string, views?: number, updated?: string, updatedUtc?: string }[]} articles
 * @param {{ threshold?: number, minShared?: number, maxClusters?: number }} [options]
 * @returns {{ id: string, keep: object, articles: object[], score: number, sharedWords: string[], exactTitle: boolean }[]}
 *   `keep` is the centre (the most-viewed article) as a suggestion; `articles` lists it first. Biggest groups first.
 *   `score` is how alike the titles are (the average over the group of titleSimilarity to the centre), `sharedWords` the words
 *   every title has, `exactTitle` that every title has exactly the centre's words: what a screen says about WHY they were grouped.
 */
export function findDuplicateClusters(articles, options) {
  return findDuplicateGroups(articles, options).clusters;
}

// ---- Text -------------------------------------------------------------------------------------------

const SHINGLE = 3;

/**
 * The set of 3-word shingles of a text (all words, no stop list: wording matters when comparing bodies). Words are folded with
 * normalizeArabic, so the same Arabic sentence written with and without hamza or short vowels still meets.
 */
export function textShingles(text) {
  const words = wordsOf(text).map(normalizeArabic);
  const out = new Set();
  if (words.length < SHINGLE) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i + SHINGLE <= words.length; i += 1) out.add(words.slice(i, i + SHINGLE).join(' '));
  return out;
}

/**
 * How much two article bodies overlap: `containment` is the share of the SHORTER body's shingles that also appear in the
 * other (a short article copied into a long one scores 1), `jaccard` the share of all shingles that are common.
 */
export function textSimilarity(textA, textB) {
  const a = textShingles(textA);
  const b = textShingles(textB);
  if (!a.size || !b.size) return { containment: 0, jaccard: 0, shared: 0 };
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return {
    containment: Math.round((shared / Math.min(a.size, b.size)) * 100) / 100,
    jaccard: Math.round((shared / (a.size + b.size - shared)) * 100) / 100,
    shared,
  };
}

/** Every pair among `articles` ({ sysId, number, text }) with its text overlap, most alike first. */
export function pairwiseText(articles) {
  const out = [];
  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      out.push({ a: articles[i].number, b: articles[j].number, ...textSimilarity(articles[i].text, articles[j].text) });
    }
  }
  return out.sort((x, y) => y.containment - x.containment || y.jaccard - x.jaccard);
}
