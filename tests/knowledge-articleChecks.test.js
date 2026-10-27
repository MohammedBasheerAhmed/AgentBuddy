import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, articleFromPack, checkArticle } from '../src/knowledge/articleChecks.js';
import { NOW, POOR_PACK } from './knowledge-fixtures.js';

const ids = (result) => result.findings.map((f) => f.id);
const DAY = 86400000;

// A healthy article: every check passes.
const good = () => ({
  title: 'How to reset your VPN password',
  text: `Open the VPN client, then select Forgot password. Before you begin you need your user name. ${'It sends an email with a link. '.repeat(20)}`,
  meta: 'vpn, password, reset, forgot password',
  state: 'published',
  views: 200,
  stats: { textLength: 700, words: 120, headings: 3, orderedLists: 1, listItems: 4, images: 0 },
  updatedMs: NOW - 30 * DAY,
  publishedMs: NOW - 400 * DAY,
  validToMs: NOW + 400 * DAY,
});

test('a healthy article has no findings', () => {
  const result = checkArticle(good(), { now: NOW });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.counts, { problem: 0, warn: 0, info: 0 });
  assert.equal(result.facts.headings, 3);
  assert.equal(result.facts.updatedDaysAgo, 30);
  assert.equal(result.facts.daysToExpiry, 400);
});

test('titles: missing, short, vague, long, with a ticket number, in capitals', () => {
  const run = (title) => ids(checkArticle({ ...good(), title }, { now: NOW }));
  assert.ok(run('').includes('title-missing'));
  assert.ok(run('VPN').includes('title-short'));
  assert.ok(run('Reset password').includes('title-short'), 'two words and 14 characters is still short');
  assert.ok(run('Issue').includes('title-vague'));
  assert.ok(!run('Issue').includes('title-short'), 'a vague title is reported once');
  assert.ok(run('x'.repeat(LIMITS.titleMaxChars + 1)).includes('title-long'));
  assert.ok(run('Fix for INC0010001 VPN problem').includes('title-ticket'));
  assert.ok(run('HOW TO RESET YOUR VPN PASSWORD').includes('title-caps'));
  assert.deepEqual(run('How to reset your VPN password'), []);
  assert.deepEqual(run('Reset your VPN password'), [], 'a good five-word title passes');
});

test('text size: empty, very short, very long; a wiki article with no readable body is not called empty', () => {
  const run = (patch) => ids(checkArticle({ ...good(), ...patch }, { now: NOW }));
  assert.ok(run({ text: '', stats: null }).includes('text-empty'));
  assert.ok(run({ text: 'Do it.', stats: { textLength: 6, words: 2, headings: 0, orderedLists: 0 } }).includes('text-short'));
  assert.ok(run({ stats: { textLength: LIMITS.textMaxChars + 1, words: 1800, headings: 5, orderedLists: 1 } }).includes('text-long'));
  const wiki = run({ text: '', stats: null, articleType: 'wiki' });
  assert.ok(wiki.includes('text-wiki') && !wiki.includes('text-empty'));
  assert.ok(run({ text: `${good().text} TODO write the rest` }).includes('text-placeholder'));
});

test('the full length from the HTML counts, not the capped text that goes into a pack', () => {
  const result = checkArticle({ ...good(), text: 'x'.repeat(6000), stats: { textLength: 20000, words: 3000, headings: 4, orderedLists: 1 } }, { now: NOW });
  assert.ok(ids(result).includes('text-long'));
  assert.equal(result.facts.chars, 20000);
});

test('structure: long text without headings; instructions without numbered steps; no prerequisites; mostly pictures', () => {
  const steps = 'Click the icon. Select Settings. Open the page. Press Save. ';
  const run = (patch) => ids(checkArticle({ ...good(), ...patch }, { now: NOW }));
  assert.ok(run({ stats: { textLength: 2000, words: 300, headings: 0, orderedLists: 1 } }).includes('structure-headings'));
  assert.ok(!run({ stats: { textLength: 1000, words: 150, headings: 0, orderedLists: 1 } }).includes('structure-headings'), 'short text needs no headings');
  const noSteps = run({ text: steps, stats: { textLength: 400, words: 70, headings: 2, orderedLists: 0 } });
  assert.ok(noSteps.includes('structure-steps'));
  assert.ok(noSteps.includes('structure-prerequisites'));
  assert.ok(!run({ text: `1. Click the icon.\n2. Select Settings.\n3. Open the page.\n${'x '.repeat(200)}`, stats: null }).includes('structure-steps'), 'numbered lines in plain text count as steps');
  assert.ok(run({ text: 'See the pictures.', stats: { textLength: 300, words: 40, headings: 1, orderedLists: 0, images: 4 } }).includes('structure-images'));
  // Without HTML counts nothing is said about headings (plain text has none to count).
  assert.ok(!run({ stats: null }).includes('structure-headings'));
});

test('keywords: none, a few, enough; separators of every kind', () => {
  const run = (meta) => ids(checkArticle({ ...good(), meta }, { now: NOW }));
  assert.ok(run('').includes('keywords-none'));
  assert.ok(run('   ,  ;').includes('keywords-none'));
  assert.ok(run('vpn, password').includes('keywords-thin'));
  assert.deepEqual(run('vpn; password\nreset'), []);
});

test('freshness: stale, very stale, expired, expiring, and dates that cannot be read', () => {
  const run = (patch) => checkArticle({ ...good(), ...patch }, { now: NOW });
  assert.ok(ids(run({ updatedMs: NOW - 400 * DAY })).includes('stale'));
  assert.ok(ids(run({ updatedMs: NOW - 800 * DAY })).includes('stale-very'));
  assert.ok(!ids(run({ updatedMs: NOW - 800 * DAY })).includes('stale'));
  assert.ok(ids(run({ validToMs: NOW - 2 * DAY })).includes('expired'));
  assert.ok(ids(run({ validToMs: NOW + 10 * DAY })).includes('expires-soon'));
  assert.ok(ids(run({ validToMs: NOW + 45 * DAY })).includes('expires-later'));
  assert.deepEqual(ids(run({ updatedMs: NaN, validToMs: NaN, publishedMs: NaN })), []);
  assert.equal(run({ updatedMs: NaN }).facts.updatedDaysAgo, null);
});

test('views: only when readable, only for an article that has been live a while', () => {
  const run = (patch) => ids(checkArticle({ ...good(), ...patch }, { now: NOW }));
  assert.ok(run({ views: 3 }).includes('views-low'));
  assert.ok(!run({ views: 3, publishedMs: NOW - 20 * DAY, updatedMs: NOW - 20 * DAY }).includes('views-low'), 'a new article has had no time to be read');
  assert.ok(!run({ views: null }).includes('views-low'), 'unreadable view counts say nothing');
  assert.ok(!run({ views: 500 }).includes('views-low'));
});

test('state and secrets', () => {
  const run = (patch, options) => checkArticle({ ...good(), ...patch }, { now: NOW, ...options });
  assert.ok(ids(run({ state: 'draft' })).includes('not-published'));
  assert.ok(!ids(run({ state: '' })).includes('not-published'));
  const secrets = run({}, { scanSecrets: () => 2 });
  assert.equal(secrets.findings[0].id, 'secrets');
  assert.equal(secrets.findings[0].level, 'problem');
  assert.match(secrets.findings[0].detail, /2 values/);
  assert.ok(!ids(run({}, { scanSecrets: () => 0 })).includes('secrets'));
});

test('findings are ordered worst first and counted', () => {
  const result = checkArticle(articleFromPack(POOR_PACK), { now: NOW });
  const levels = result.findings.map((f) => f.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ problem: 0, warn: 1, info: 2 })[a] - ({ problem: 0, warn: 1, info: 2 })[b]));
  assert.ok(result.counts.problem >= 2 && result.counts.warn >= 2);
  assert.equal(result.counts.problem + result.counts.warn + result.counts.info, result.findings.length);
});

test('articleFromPack reads the stored dates, counts and views from a knowledge pack', () => {
  const a = articleFromPack(POOR_PACK);
  assert.equal(a.title, 'VPN');
  assert.equal(a.views, 2);
  assert.equal(a.stats.textLength, 11);
  assert.equal(a.updatedMs, Date.UTC(2023, 0, 5, 8));
  assert.equal(a.validToMs, Date.UTC(2026, 9, 1));
  const ids2 = ids(checkArticle(a, { now: NOW }));
  for (const expected of ['title-short', 'text-short', 'keywords-none', 'stale-very', 'expired', 'views-low']) assert.ok(ids2.includes(expected), expected);
});

test('display dates in another format are read when they are unambiguous, else skipped', () => {
  const pack = (fields) => ({ fields: { short_description: 'A title with enough words', text: 'x', ...fields }, related: {} });
  assert.equal(articleFromPack(pack({ valid_to: '2026-03-04' })).validToMs, Date.UTC(2026, 2, 4));
  assert.equal(articleFromPack(pack({ valid_to: 'Mar 4, 2026' })).validToMs, Date.parse('Mar 4, 2026'));
  assert.ok(Number.isNaN(articleFromPack(pack({ valid_to: '04/03/2026' })).validToMs), 'day/month order is not guessed');
  assert.equal(articleFromPack(pack({})).views, null);
  assert.equal(articleFromPack(pack({ view_count: '17' })).views, 17);
  assert.equal(articleFromPack(pack({ sys_view_count: 'many' })).views, null);
});

test('hostile or empty input does not throw', () => {
  assert.doesNotThrow(() => checkArticle(undefined));
  assert.doesNotThrow(() => checkArticle({}));
  assert.doesNotThrow(() => articleFromPack(undefined));
  const empty = checkArticle({}, { now: NOW });
  assert.ok(ids(empty).includes('title-missing') && ids(empty).includes('text-empty'));
  const odd = checkArticle({ title: null, text: 5, meta: { a: 1 }, views: 'x' }, { now: NOW });
  assert.ok(Array.isArray(odd.findings));
});
