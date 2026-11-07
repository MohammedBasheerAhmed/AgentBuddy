import test from 'node:test';
import assert from 'node:assert/strict';
import { DUPLICATE_THRESHOLD, MIN_SHARED_WORDS, findDuplicateClusters, findDuplicateGroups, titleProfile, titleSimilarity } from '../src/knowledge/similarity.js';

// Wave 6, knowledge manager: the grouping of 1,500 titles must give exactly the groups it always gave (it only got faster), the groups
// found are counted before the list is cut, and what a group says about itself is what the grouping really used.

// The grouping as it was before the quick pre-check: every pair is scored. Views are distinct in these tests, so the order is plain.
function reference(articles, { threshold = DUPLICATE_THRESHOLD, minShared = MIN_SHARED_WORDS } = {}) {
  const items = articles.map((a) => ({ ...a, profile: titleProfile(a.title) })).filter((a) => a.profile.unigrams.size).sort((a, b) => b.views - a.views);
  const taken = new Set();
  const out = [];
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
    members.forEach((m) => taken.add(m.other.sysId));
    out.push({ ids: [centre.sysId, ...members.map((m) => m.other.sysId)], score: Math.round((members.reduce((s, m) => s + m.score, 0) / members.length) * 100) / 100 });
  }
  return out;
}

// A small deterministic random source, and titles made from a short vocabulary so that many pairs do share words.
const random = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const VOCAB = ['vpn', 'password', 'reset', 'outlook', 'printer', 'install', 'mac', 'teams', 'email', 'laptop', 'wifi', 'access', 'request', 'phone', 'setup', 'error', 'login', 'account', 'unlock', 'license'];
function titles(count, seed) {
  const next = random(seed);
  return Array.from({ length: count }, (_, i) => ({
    sysId: String(i + 1).padStart(32, '0'),
    number: `KB${i}`,
    title: Array.from({ length: 1 + Math.floor(next() * 5) }, () => VOCAB[Math.floor(next() * VOCAB.length)]).join(' '),
    views: i + 1,
    updated: '2026-01-01 00:00:00',
  }));
}

test('the quick pre-check changes nothing: the same groups, in the same order, with the same scores, on random titles', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const articles = titles(120, seed);
    const expected = reference(articles).sort((a, b) => b.ids.length - a.ids.length || b.score - a.score);
    const got = findDuplicateGroups(articles, { maxClusters: 1000 }).clusters;
    assert.deepEqual(got.map((c) => c.articles.map((a) => a.sysId).sort()), expected.map((c) => [...c.ids].sort()), `seed ${seed}`);
    assert.deepEqual(got.map((c) => c.score), expected.map((c) => c.score), `scores, seed ${seed}`);
  }
  const strict = titles(80, 99);
  assert.deepEqual(
    findDuplicateGroups(strict, { threshold: 0.9, maxClusters: 1000 }).clusters.map((c) => c.articles.length),
    reference(strict, { threshold: 0.9 }).sort((a, b) => b.ids.length - a.ids.length || b.score - a.score).map((c) => c.ids.length)
  );
});

test('1,500 titles are grouped in a few seconds at most', () => {
  const articles = titles(1500, 7);
  const started = Date.now();
  const { clusters, total } = findDuplicateGroups(articles, { maxClusters: 100 });
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
  assert.ok(clusters.length <= 100 && total >= clusters.length);
});

test('the groups found are counted before the list is cut', () => {
  const articles = [];
  for (let g = 0; g < 8; g += 1) {
    for (let k = 0; k < 2 + (g % 3); k += 1) articles.push({ sysId: `${g}${k}`.padStart(32, '0'), number: `KB${g}${k}`, title: `Alpha${g}x Beta${g}x Gamma${g}x`, views: 100 - g * 10 - k });
  }
  const all = findDuplicateGroups(articles, { maxClusters: 25 });
  assert.deepEqual([all.clusters.length, all.total], [8, 8]);
  const cut = findDuplicateGroups(articles, { maxClusters: 3 });
  assert.deepEqual([cut.clusters.length, cut.total], [3, 8], 'three shown of eight found');
  assert.deepEqual(cut.clusters.map((c) => c.id), ['d1', 'd2', 'd3']);
  assert.deepEqual(findDuplicateClusters(articles, { maxClusters: 3 }), cut.clusters, 'findDuplicateClusters is the kept groups of findDuplicateGroups');
  assert.deepEqual(findDuplicateGroups([], {}), { clusters: [], total: 0 });
  assert.deepEqual(findDuplicateGroups(null), { clusters: [], total: 0 });
});

test('a group carries what the grouping used, and nothing it did not: the words, how alike, whether the words are the same', () => {
  const art = (n, title, category) => ({ sysId: String(n).padStart(32, '0'), number: `KB${n}`, title, views: 10 - n, category, text: 'never read here' });
  const { clusters } = findDuplicateGroups([art(1, 'Reset your VPN password', 'VPN'), art(2, 'VPN password reset', 'Email'), art(3, 'Install Outlook on Mac', 'Email')]);
  assert.equal(clusters.length, 1);
  const [group] = clusters;
  assert.equal(group.exactTitle, false, 'a different order of the same words is alike, not the same');
  assert.deepEqual([...group.sharedWords].sort(), ['password', 'reset', 'vpn']);
  assert.ok(group.score >= DUPLICATE_THRESHOLD && group.score < 1);
  assert.deepEqual(Object.keys(group).sort(), ['articles', 'exactTitle', 'id', 'keep', 'score', 'sharedWords']);
  const same = findDuplicateGroups([art(1, 'Reset your VPN password', 'VPN'), art(2, 'Reset your VPN password', 'VPN')]).clusters[0];
  assert.equal(same.exactTitle, true);
  assert.equal(same.score, 1);
});
