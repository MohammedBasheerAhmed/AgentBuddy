const test = require('node:test');
const assert = require('node:assert/strict');
import { startOfLocalDay, startOfLocalWeek, bucketStarts, bucketCounts, bucketLabels, dayLabel, quantize, daysBetween, median, mean, formatDuration, DAY, HOUR } from '../src/reports/engine/time.js';
import { ageBuckets } from '../src/reports/engine/workload.js';
import { backlogSeries, partialBuckets, durationsHours, repeatCallers, mergeTop, normalizeTrend } from '../src/reports/engine/quality.js';
import { NOW } from './reports-fixtures.js';

test('local day and week starts follow the time zone offset', () => {
  // 12:00 UTC on Tuesday 27 Oct 2026.
  assert.equal(new Date(startOfLocalDay(NOW, 0)).toISOString(), '2026-10-27T00:00:00.000Z');
  // UTC-5 (offset +300): local time is 07:00, the day began at 05:00 UTC.
  assert.equal(new Date(startOfLocalDay(NOW, 300)).toISOString(), '2026-10-27T05:00:00.000Z');
  // UTC+5:30 (offset -330): local time is 17:30, the day began at 18:30 UTC the day before.
  assert.equal(new Date(startOfLocalDay(NOW, -330)).toISOString(), '2026-10-26T18:30:00.000Z');
  // 02:00 UTC is still yesterday for someone at UTC-5.
  const early = Date.UTC(2026, 9, 27, 2, 0, 0);
  assert.equal(new Date(startOfLocalDay(early, 300)).toISOString(), '2026-10-26T05:00:00.000Z');
  assert.equal(new Date(startOfLocalWeek(NOW, 0)).toISOString(), '2026-10-26T00:00:00.000Z'); // Monday
  const sunday = Date.UTC(2026, 9, 25, 12, 0, 0);
  assert.equal(new Date(startOfLocalWeek(sunday, 0)).toISOString(), '2026-10-19T00:00:00.000Z');
});

test('buckets run oldest to newest and end with the current day or week', () => {
  const days = bucketStarts({ now: NOW, unit: 'day', count: 3, offsetMin: 0 });
  assert.deepEqual(days.map((d) => new Date(d).toISOString().slice(0, 10)), ['2026-10-25', '2026-10-26', '2026-10-27']);
  const weeks = bucketStarts({ now: NOW, unit: 'week', count: 2, offsetMin: 0 });
  assert.deepEqual(weeks.map((d) => new Date(d).toISOString().slice(0, 10)), ['2026-10-19', '2026-10-26']);
  assert.deepEqual(bucketLabels(days, 0), ['Oct 25', 'Oct 26', 'Oct 27']);
  assert.equal(dayLabel(Date.UTC(2026, 0, 5), 0), 'Jan 5');
  assert.equal(bucketStarts({ now: NOW, count: 0, offsetMin: 0 }).length, 1);
  assert.equal(bucketStarts({ now: NOW, count: 9999, offsetMin: 0 }).length, 120);
});

test('timestamps are counted into the right bucket; outside values and junk are ignored', () => {
  const starts = bucketStarts({ now: NOW, unit: 'day', count: 3, offsetMin: 0 });
  const at = (d, h) => Date.UTC(2026, 9, d, h, 0, 0);
  const counts = bucketCounts([at(25, 0), at(25, 23), at(26, 5), at(27, 11), at(24, 23), at(28, 0), NaN, undefined, 'x'], starts, DAY);
  assert.deepEqual(counts, [2, 1, 1]);
  assert.deepEqual(bucketCounts([1, 2, 3], [], DAY), []);
});

test('quantize rounds down to the minute so equal requests share a cache entry', () => {
  assert.equal(quantize(NOW + 59999), NOW);
  assert.equal(quantize(NOW + 60000), NOW + 60000);
});

test('ageing buckets are built from cumulative counts and never go negative', () => {
  // 10 open; opened <2d: 3, <4d: 5, <8d: 6, <15d: 8
  const b = ageBuckets(10, [3, 5, 6, 8]);
  assert.deepEqual(b.map((x) => x.count), [3, 2, 1, 2, 2]);
  assert.deepEqual(b.map((x) => x.label), ['0-1 days', '2-3 days', '4-7 days', '8-14 days', '15+ days']);
  assert.equal(b.reduce((n, x) => n + x.count, 0), 10);
  // Numbers that moved between reads (a later count smaller than an earlier one, or bigger than the total).
  const odd = ageBuckets(4, [5, 3, 9, 1]);
  assert.ok(odd.every((x) => x.count >= 0));
  assert.equal(odd.reduce((n, x) => n + x.count, 0), 4);
  assert.deepEqual(ageBuckets(0, [0, 0, 0, 0]).map((x) => x.count), [0, 0, 0, 0, 0]);
});

test('backlog is worked backwards from the open count now', () => {
  assert.deepEqual(backlogSeries(10, [2, 3], [1, 1]), [8, 10]);
  // A quiet week then a spike: 5 open now; 4 opened and 0 resolved today.
  assert.deepEqual(backlogSeries(5, [0, 0, 4], [0, 0, 0]), [1, 1, 5]);
  assert.deepEqual(backlogSeries(0, [3], [5]), [0]);
  assert.deepEqual(backlogSeries(3, [], []), []);
  assert.ok(backlogSeries(1, [9, 9], [0, 0]).every((n) => n >= 0));
});

test('buckets older than the oldest row read are partial only when the read was cut short', () => {
  const starts = bucketStarts({ now: NOW, unit: 'day', count: 4, offsetMin: 0 });
  const earliest = Date.UTC(2026, 9, 26, 8, 0, 0);
  // Oct 24, 25 and 26 (the day the oldest row falls in) are partial; Oct 27 is whole.
  assert.deepEqual(partialBuckets(starts, earliest, true), [true, true, true, false]);
  assert.deepEqual(partialBuckets(starts, earliest, false), [false, false, false, false]);
  assert.deepEqual(partialBuckets(starts, NaN, true), [false, false, false, false]);
});

test('time to resolve uses only rows with both dates in the right order', () => {
  const rows = [
    { opened_at: '2026-10-26 08:00:00', resolved_at: '2026-10-26 10:00:00' },
    { opened_at: '2026-10-26 08:00:00', resolved_at: '2026-10-26 20:00:00' },
    { opened_at: '2026-10-26 08:00:00', resolved_at: '' },
    { opened_at: '2026-10-26 08:00:00', resolved_at: '2026-10-25 08:00:00' },
    { opened_at: 'junk', resolved_at: '2026-10-26 08:00:00' },
    { opened_at: { value: '2026-10-26 00:00:00' }, resolved_at: { value: '2026-10-26 04:00:00', display_value: 'whatever' } },
  ];
  const d = durationsHours(rows, 'resolved_at');
  assert.deepEqual(d, [2, 12, 4]);
  assert.equal(mean(d), 6);
  assert.equal(median(d), 4);
  assert.ok(Number.isNaN(median([])));
  assert.ok(Number.isNaN(mean([])));
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('repeat callers need the minimum number of tickets and a real caller', () => {
  const g = (id, name, n) => ({ count: n, avg: {}, keys: [{ field: 'caller_id', value: id, display: name }] });
  const out = repeatCallers([g('1', 'Ann', 2), g('2', 'Bo', 3), g('3', 'Cy', 5), g('', '', 9), g('4', '', 3)]);
  assert.deepEqual(out.map((x) => [x.name, x.count]), [['Cy', 5], ['Bo', 3], ['Unknown', 3]]);
  assert.deepEqual(repeatCallers([g('1', 'Ann', 3)], 4), []);
  assert.deepEqual(repeatCallers([]), []);
});

test('merged top lists add equal names across tables', () => {
  const out = mergeTop([[{ name: 'Network', count: 3 }, { name: 'Email', count: 1 }], [{ name: 'network', count: 4 }]], 5);
  assert.deepEqual(out.map((x) => [x.name, x.count]), [['Network', 7], ['Email', 1]]);
  assert.equal(mergeTop([[{ name: 'a', count: 1 }, { name: 'b', count: 1 }, { name: 'c', count: 1 }]], 2).length, 2);
});

test('trend choices fall back to 30 days', () => {
  assert.equal(normalizeTrend('week-8').span, 8);
  assert.equal(normalizeTrend({ unit: 'day', span: 14 }).id, 'day-14');
  assert.equal(normalizeTrend('nope').id, 'day-30');
  assert.equal(normalizeTrend(undefined).id, 'day-30');
});

test('small helpers', () => {
  assert.equal(daysBetween(NOW - 3 * DAY - HOUR, NOW), 3);
  assert.equal(daysBetween(NOW + DAY, NOW), 0);
  assert.equal(formatDuration(0.5), '30 min');
  assert.equal(formatDuration(5), '5 h');
  assert.equal(formatDuration(72), '3 d');
  assert.equal(formatDuration(NaN), '');
});
