// Near-duplicate knowledge articles. Pure and deterministic: no AI, no network.
//
// Stage 1 compares TITLES of the articles in one scope (one knowledge base or category, at most ~300 articles): the words of a
// title and its pairs of neighbouring words ("shingles"), compared with Jaccard similarity. Stage 2 compares the TEXT of the
// few articles of one cluster the person picked: overlapping 3-word shingles. Titles decide what is shown; the text figure
// only helps the person judge, and says how much of the shorter article also appears in the other.

import { STOP_TITLE, jaccard, stemsOf, wordsOf } from './text.js';

export const DUPLICATE_THRESHOLD = 0.55;
export const MIN_SHARED_WORDS = 2;
export const MAX_CLUSTERS = 25;

// ---- Titles ---------------------------------------------------------------------------------------

/** { words: string[], unigrams: Set, bigrams: Set } for a title. Order matters a little (bigrams), not much. */
export function titleProfile(title) {
  const words = stemsOf(title, STOP_TITLE);
  const bigrams = new Set();
  for (let i = 0; i + 1 < words.length; i += 1) bigrams.add(`${words[i]} ${words[i + 1]}`);
  return { words, unigrams: new Set(words), bigrams };
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

const cmpRank = (a, b) => b.views - a.views || String(b.updated).localeCompare(String(a.updated)) || String(a.number).localeCompare(String(b.number));

/**
 * Groups of articles whose titles read alike. Greedy and star-shaped: articles are taken most-viewed first (then newest);
 * each one that is not already in a group becomes the centre of a new group made of every still-free article whose title is
 * alike enough. Nothing chains (A~B and B~C never puts A and C together), so a group can always be explained by its centre.
 * @param {{ sysId: string, number: string, title: string, views?: number, updated?: string }[]} articles
 * @param {{ threshold?: number, minShared?: number, maxClusters?: number }} [options]
 * @returns {{ id: string, keep: object, articles: object[], score: number, sharedWords: string[], exactTitle: boolean }[]}
 *   `keep` is the centre (the most-viewed article) as a suggestion; `articles` lists it first. Biggest groups first.
 */
export function findDuplicateClusters(articles, { threshold = DUPLICATE_THRESHOLD, minShared = MIN_SHARED_WORDS, maxClusters = MAX_CLUSTERS } = {}) {
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
      const { score, shared } = titleSimilarity(centre.profile, other.profile);
      if (score >= threshold && shared.length >= Math.min(minShared, centre.profile.unigrams.size, other.profile.unigrams.size)) members.push({ other, score, shared });
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
      sharedWords: [...sharedAll],
      exactTitle: members.every((m) => m.score >= 0.999),
    });
  }
  return clusters
    .sort((a, b) => b.articles.length - a.articles.length || b.score - a.score || cmpRank(a.keep, b.keep))
    .slice(0, maxClusters)
    .map((c, i) => ({ id: `d${i + 1}`, ...c }));
}

// ---- Text -------------------------------------------------------------------------------------------

const SHINGLE = 3;

/** The set of 3-word shingles of a text (all words, no stop list: wording matters when comparing bodies). */
export function textShingles(text) {
  const words = wordsOf(text);
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
