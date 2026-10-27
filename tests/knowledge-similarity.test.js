import test from 'node:test';
import assert from 'node:assert/strict';
import { jaccard, keywordsOf, stem, stemsOf, wordsOf } from '../src/knowledge/text.js';
import { DUPLICATE_THRESHOLD, findDuplicateClusters, pairwiseText, textShingles, textSimilarity, titleProfile, titleSimilarity } from '../src/knowledge/similarity.js';

const article = (n, title, views = 0, updated = '2026-01-01 00:00:00') => ({ sysId: `id${n}`, number: `KB${n}`, title, views, updated });

// ---- words and stems --------------------------------------------------------------------------------------

test('words keep letters and digits, in order, lower case, across scripts', () => {
  assert.deepEqual(wordsOf('Windows 11: VPN-client (v2.5) Überprüfung'), ['windows', '11', 'vpn', 'client', 'v2', '5', 'überprüfung']);
  assert.deepEqual(wordsOf(''), []);
  assert.deepEqual(wordsOf(null), []);
  const curly = String.fromCharCode(0x2019);
  assert.deepEqual(wordsOf(`don't can${curly}t`), ["don't", `can${curly}t`]);
});

test('the stemmer makes plurals and verb forms meet, and leaves other words alone', () => {
  assert.equal(stem('disconnecting'), stem('disconnected'));
  assert.equal(stem('disconnects'), stem('disconnect'));
  assert.equal(stem('passwords'), 'password');
  assert.equal(stem('resetting'), stem('reset'));
  assert.equal(stem('updated'), stem('update'));
  assert.equal(stem('devices'), stem('device'));
  assert.equal(stem('access'), 'access', 'double s is not a plural');
  assert.equal(stem('status'), 'status');
  assert.equal(stem('vpn'), 'vpn');
  assert.equal(stem('use'), 'use');
});

test('stems drop filler words but keep numbers, so "Windows 10" and "Windows 11" differ', () => {
  assert.deepEqual(stemsOf('How to use the Windows 11 VPN guide'), ['window', '11', 'vpn']);
  assert.deepEqual(stemsOf('a'), []);
});

test('keywords: acronyms and long words first, no repeats, a cap', () => {
  const words = keywordsOf('VPN keeps disconnecting; the VPN client disconnects when sleeping', { max: 3 });
  assert.equal(words.length, 3);
  assert.equal(words[0].form, 'vpn');
  assert.equal(new Set(words.map((w) => w.stem)).size, 3);
  assert.deepEqual(keywordsOf('the and of'), []);
});

test('jaccard of empty sets is 0, not 1', () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.equal(jaccard(new Set(['a']), new Set(['a'])), 1);
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
});

// ---- titles --------------------------------------------------------------------------------------------

test('identical and reordered titles score high, different topics score low', () => {
  assert.equal(titleSimilarity('Reset your VPN password', 'Reset your VPN password').score, 1);
  const reordered = titleSimilarity('Reset password', 'Password reset');
  assert.equal(reordered.score, 0.65, 'same words, no shared neighbouring pairs');
  assert.deepEqual(reordered.shared.sort(), ['password', 'reset']);
  assert.ok(titleSimilarity('Install Outlook on Mac', 'Printer driver installation').score < 0.2);
  assert.equal(titleSimilarity('', 'Reset password').score, 0);
});

test('a superset title is not a duplicate on its own, and the profile exposes its words', () => {
  assert.ok(titleSimilarity('VPN', 'VPN setup guide').score < DUPLICATE_THRESHOLD);
  assert.deepEqual(titleProfile('How to reset your VPN password').words, ['reset', 'vpn', 'password']);
});

test('clusters: the near-duplicates group around the most viewed article; the others stay out', () => {
  const clusters = findDuplicateClusters([
    article(1, 'How to reset your VPN password', 340),
    article(2, 'Reset VPN password', 90),
    article(3, 'VPN password reset guide', 12),
    article(4, 'Install Outlook on Mac', 55),
    article(5, 'Printer driver installation for the third floor', 30),
  ]);
  assert.equal(clusters.length, 1);
  const [c] = clusters;
  assert.equal(c.keep.number, 'KB1');
  assert.deepEqual(c.articles.map((a) => a.number), ['KB1', 'KB2', 'KB3']);
  assert.deepEqual(c.sharedWords.sort(), ['password', 'reset', 'vpn']);
  assert.ok(c.score >= DUPLICATE_THRESHOLD && c.score <= 1);
  assert.equal(c.id, 'd1');
  assert.ok(!('profile' in c.keep), 'the working data is not returned');
});

test('exact same titles are flagged as such', () => {
  const [c] = findDuplicateClusters([article(1, 'Printer setup', 5), article(2, 'Printer setup', 9), article(3, 'printer SETUP!', 1)]);
  assert.equal(c.exactTitle, true);
  assert.equal(c.keep.number, 'KB2', 'most viewed first');
  assert.equal(c.articles.length, 3);
});

test('no chaining: A~B and B~C do not put A and C together', () => {
  const clusters = findDuplicateClusters(
    [
      article(1, 'alpha bravo charlie delta', 100),
      article(2, 'alpha bravo charlie echo', 50), // alike to 1
      article(3, 'bravo charlie echo foxtrot', 10), // alike to 2, but not enough to 1
    ],
    { threshold: 0.5 }
  );
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].articles.map((a) => a.number), ['KB1', 'KB2']);
});

test('ties are broken by the newest change, then the number; the result is the same every time', () => {
  const input = [article(2, 'Reset VPN password now', 5, '2026-01-01 00:00:00'), article(1, 'Reset VPN password now!', 5, '2026-06-01 00:00:00')];
  const a = findDuplicateClusters(input);
  const b = findDuplicateClusters([...input].reverse());
  assert.equal(a[0].keep.number, 'KB1');
  assert.deepEqual(a, b);
});

test('the threshold, the shared-word minimum and the cap are honoured', () => {
  const set = [article(1, 'Reset VPN password', 3), article(2, 'Reset VPN token', 2)];
  assert.equal(findDuplicateClusters(set, { threshold: 0.9 }).length, 0);
  assert.equal(findDuplicateClusters(set, { threshold: 0.3 }).length, 1);
  const many = [];
  for (let i = 0; i < 40; i += 1) many.push(article(i * 2, `unique${i} topic${i} guide${i} thing${i}`), article(i * 2 + 1, `unique${i} topic${i} guide${i} thing${i}`));
  assert.equal(findDuplicateClusters(many, { maxClusters: 5 }).length, 5);
  assert.equal(findDuplicateClusters(many).length, 25);
});

test('articles without a title or an id, and bad input, are ignored', () => {
  assert.deepEqual(findDuplicateClusters(undefined), []);
  assert.deepEqual(findDuplicateClusters([null, {}, article(1, ''), { sysId: 'x', title: '   ' }, article(2, 'the and of')]), []);
  assert.deepEqual(findDuplicateClusters([article(1, 'Only one article')]), []);
});

test('a few hundred articles are compared quickly', () => {
  const rows = [];
  for (let i = 0; i < 300; i += 1) rows.push(article(i, `Topic ${i % 40} procedure ${i % 7} for team ${i % 11}`, i));
  const started = Date.now();
  const clusters = findDuplicateClusters(rows);
  assert.ok(Date.now() - started < 2000, 'under two seconds');
  assert.ok(clusters.length > 0);
});

// ---- text -------------------------------------------------------------------------------------------

test('text overlap: a short article inside a long one is fully contained', () => {
  const short = 'Open the VPN client and choose Forgot password then follow the email link.';
  const long = `Intro text about the company. ${short} More paragraphs about other things that matter to people in the office.`;
  const r = textSimilarity(short, long);
  assert.equal(r.containment, 1);
  assert.ok(r.jaccard > 0 && r.jaccard < 1);
  assert.equal(textSimilarity(short, 'Something entirely different about printers and paper trays today.').containment, 0);
});

test('text overlap handles empty and tiny texts', () => {
  assert.deepEqual(textSimilarity('', 'abc def ghi'), { containment: 0, jaccard: 0, shared: 0 });
  assert.equal(textSimilarity('one two', 'one two').containment, 1, 'two words are one shingle');
  assert.equal(textShingles('a b c d').size, 2);
  assert.equal(textShingles('').size, 0);
});

test('pairwise overlap lists every pair, most alike first, with the numbers', () => {
  const pairs = pairwiseText([
    { number: 'KB1', text: 'reset the vpn password using the forgot password link in the client' },
    { number: 'KB2', text: 'completely different text about printer toner and paper' },
    { number: 'KB3', text: 'you can reset the vpn password using the forgot password link in the client today' },
  ]);
  assert.equal(pairs.length, 3);
  assert.deepEqual([pairs[0].a, pairs[0].b], ['KB1', 'KB3']);
  assert.equal(pairs[0].containment, 1);
  assert.equal(pairs[2].containment, 0);
});
