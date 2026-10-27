import test from 'node:test';
import assert from 'node:assert/strict';
import {
  num, percent, formatNumber, withUnit, clipLabel, niceMax, ticks, thinLabels,
  TONES, normTone, toneVar, toneClass, toneForIndex, PATTERNS, patternFor, MARKERS, markerFor, markerPath, markerIsLine,
  barLayout, stackedLayout, linePath, areaPath, trendLayout, donutArcs, gaugeTone, gaugeArc, heatLevel, heatLayout,
  summarizeItems, summarizeStacked, summarizeSeries, summarizeGauge, describeTile, itemsToTable, stackedToTable, seriesToTable,
} from '../src/sidepanel/charts/geometry.js';

// Nothing a chart computes may contain a NaN or an Infinity, in a number or in a path string.
function assertClean(value, where = 'value') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${where} is ${value}`);
  else if (typeof value === 'string') assert.ok(!/NaN|Infinity|undefined/.test(value), `${where} contains NaN/Infinity/undefined: ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertClean(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertClean(v, `${where}.${k}`));
}

test('num clamps to a finite number >= 0', () => {
  assert.equal(num(5), 5);
  assert.equal(num('7'), 7);
  assert.equal(num(1e300), 1e15); // clamped, so sums and scales can never overflow
  for (const bad of [-1, NaN, Infinity, -Infinity, null, undefined, 'abc', {}, []]) assert.equal(num(bad), 0, String(bad));
});

test('percent rounds, clamps to 0..100 and survives a zero total', () => {
  assert.equal(percent(1, 4), 25);
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(1, 3, 1), 33.3);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(10, 5), 100);
  assert.equal(percent(-1, 5), 0);
  assert.equal(percent(NaN, 5), 0);
  assert.equal(percent(1, NaN), 0);
});

test('formatNumber: grouping, decimals, compact, bad input', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(12.5), '12.5');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(-1234.5), '-1,234.5');
  assert.equal(formatNumber(3, { decimals: 2 }), '3.00');
  assert.equal(formatNumber(12300, { compact: true }), '12.3K');
  assert.equal(formatNumber(9999, { compact: true }), '9,999');
  assert.equal(formatNumber(1500000, { compact: true }), '1.5M');
  assert.equal(formatNumber(2e9, { compact: true }), '2B');
  assert.equal(formatNumber(250000, { compact: true }), '250K');
  assert.equal(formatNumber(1e22), '1.00e+22');
  assert.equal(formatNumber(1e15), '1,000,000,000,000,000');
  for (const bad of [NaN, Infinity, undefined, null, 'x']) assert.equal(formatNumber(bad), bad === null ? '0' : '0', String(bad));
  assert.equal(formatNumber(-0.04), '0.0');
});

test('withUnit attaches % and one-letter units, separates words', () => {
  assert.equal(withUnit('12', '%'), '12%');
  assert.equal(withUnit('5', 'h'), '5h');
  assert.equal(withUnit('12', 'incidents'), '12 incidents');
  assert.equal(withUnit('12', ''), '12');
  assert.equal(withUnit(12, undefined), '12');
});

test('clipLabel: one line, capped by characters, no broken emoji, no control characters', () => {
  assert.equal(clipLabel('  hello   world \n'), 'hello world');
  assert.equal(clipLabel('a'.repeat(100), 10), `${'a'.repeat(9)}…`);
  assert.equal(Array.from(clipLabel('😀'.repeat(10), 5)).length, 5);
  assert.ok(!clipLabel('😀'.repeat(10), 5).includes('\ud83d\u0000'));
  assert.equal(clipLabel('a\u0000b'), 'a b');
  assert.equal(clipLabel(null), '');
  assert.equal(clipLabel(undefined, NaN), '');
  assert.equal(clipLabel('short', 28), 'short');
  assert.equal(clipLabel('x'.repeat(5000), 28).length, 28);
});

test('niceMax: round tops with a whole-number middle tick for counts', () => {
  assert.equal(niceMax(0), 2);
  assert.equal(niceMax(1), 2);
  assert.equal(niceMax(3), 4);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(10), 10);
  assert.equal(niceMax(11), 12);
  assert.equal(niceMax(13), 16);
  assert.equal(niceMax(25), 30);
  assert.equal(niceMax(45), 50);
  assert.equal(niceMax(999), 1000);
  assert.equal(niceMax(0.3, { integer: false }), 0.3);
  assert.equal(niceMax(0, { integer: false }), 1);
  for (const bad of [NaN, -5, undefined, Infinity]) assert.equal(niceMax(bad), 2);
  for (const big of [1e9, 1e30, 1e300, 1.7e308, 123456789]) {
    const top = niceMax(big);
    assert.ok(Number.isFinite(top) && top >= Math.min(big, 1e15), `${big} -> ${top}`);
  }
  // never below the data
  for (let v = 0.1; v < 5000; v *= 1.37) assert.ok(niceMax(v) >= v - 1e-9, `${v}`);
});

test('ticks run from 0 to max, both included', () => {
  assert.deepEqual(ticks(10), [0, 5, 10]);
  assert.deepEqual(ticks(8, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(ticks(0), [0, 0, 0]);
  assert.deepEqual(ticks(NaN), [0, 0, 0]);
  assert.deepEqual(ticks(10, 1), [0, 10]);
});

test('thinLabels keeps first and last and spreads the rest', () => {
  assert.deepEqual(thinLabels([], 5), []);
  assert.deepEqual(thinLabels(['a', 'b', 'c'], 10), [0, 1, 2]);
  assert.deepEqual(thinLabels(Array(10).fill('x'), 3), [0, 5, 9]);
  assert.deepEqual(thinLabels(Array(10).fill('x'), 2), [0, 9]);
  assert.deepEqual(thinLabels(Array(10).fill('x'), 1), [0]);
  assert.deepEqual(thinLabels(Array(10).fill('x'), NaN), [0]);
  const picked = thinLabels(Array(25).fill('x'), 6);
  assert.ok(picked.length <= 6 && picked[0] === 0 && picked.at(-1) === 24);
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
  assert.equal(new Set(picked).size, picked.length);
});

test('tones map to the chart tokens; unknown tones fall back to neutral', () => {
  assert.equal(toneVar('bad'), 'var(--ab-chart-bad)');
  assert.equal(toneVar('c3'), 'var(--ab-chart-3)');
  assert.equal(toneVar('nope'), 'var(--ab-chart-neutral)');
  assert.equal(toneVar(undefined), 'var(--ab-chart-neutral)');
  assert.equal(toneClass('c2'), 'ab-tone-c2');
  assert.equal(toneClass('<script>'), 'ab-tone-neutral');
  assert.equal(normTone('warn'), 'warn');
  assert.equal(toneForIndex(0), 'c1');
  assert.equal(toneForIndex(6), 'c1');
  assert.equal(toneForIndex(7), 'c2');
  assert.equal(toneForIndex(-1), 'c6');
  assert.equal(toneForIndex(NaN), 'c1');
  assert.equal(TONES.length, 10);
});

test('every series index gets its own pattern and marker, cycling after six', () => {
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, 6);
  assert.equal(new Set(MARKERS).size, 6);
  assert.equal(patternFor(0).id, 'solid');
  assert.equal(patternFor(1).id, 'diagonal');
  assert.equal(patternFor(6).id, 'solid');
  assert.equal(patternFor(-1).id, 'vertical');
  assert.equal(markerFor(0), 'circle');
  assert.equal(markerFor(6), 'circle');
  // every non-solid pattern draws something
  PATTERNS.slice(1).forEach((p) => assert.ok(p.lines || p.dot, p.id));
});

test('marker paths are valid for every shape and survive bad numbers', () => {
  for (const shape of [...MARKERS, 'unknown']) {
    for (const args of [[10, 20, 3.5], [NaN, undefined, NaN], [1e6, -1e6, 0], [0, 0, -4]]) {
      const d = markerPath(shape, ...args);
      assert.match(d, /^M/);
      assertClean(d, `${shape}`);
    }
  }
  assert.ok(markerIsLine('cross') && markerIsLine('plus') && !markerIsLine('circle'));
});

test('barLayout: bars relative to the largest value, a sliver for tiny values, nothing for zero', () => {
  const layout = barLayout([{ key: 'a', label: 'A', value: 10 }, { key: 'b', label: 'B', value: 5 }, { key: 'c', label: 'C', value: 0 }], { width: 100, labelWidth: 20, rowHeight: 10, gap: 6 });
  assert.equal(layout.barSpace, 80);
  assert.equal(layout.scaleMax, 10);
  assert.equal(layout.total, 15);
  assert.deepEqual(layout.rows.map((r) => r.width), [80, 40, 0]);
  assert.deepEqual(layout.rows.map((r) => r.fraction), [1, 0.5, 0]);
  assert.deepEqual(layout.rows.map((r) => r.y), [0, 16, 32]);
  assert.equal(layout.rows[0].x, 20);
  assert.equal(layout.height, 42);
  const tiny = barLayout([{ value: 1000 }, { value: 1 }], { width: 100 });
  assert.ok(tiny.rows[1].width >= 1.2 && tiny.rows[1].width < 5);
  assert.equal(tiny.rows[0].key, '0');
  assertClean(tiny);
});

test('barLayout: caps rows, reports what is hidden, honours max, tolerates garbage', () => {
  const capped = barLayout([{ value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], { maxItems: 2 });
  assert.equal(capped.rows.length, 2);
  assert.deepEqual(capped.hidden, { count: 2, value: 3 });
  assert.equal(capped.total, 10);
  assert.equal(barLayout([{ value: 10 }], { max: 20 }).rows[0].fraction, 0.5);
  assert.equal(barLayout([{ value: 50 }], { max: 20 }).rows[0].fraction, 1);
  const empty = barLayout([]);
  assert.deepEqual([empty.rows, empty.height, empty.scaleMax, empty.total], [[], 0, 0, 0]);
  assert.deepEqual(barLayout(undefined).rows, []);
  const garbage = barLayout([null, undefined, 3, { value: -5 }, { value: NaN }, { value: '7' }, { value: 1e300 }, { value: Infinity }]);
  assertClean(garbage);
  assert.equal(garbage.rows.length, 5);
  const zeros = barLayout([{ value: 0 }, { value: 0 }]);
  assert.deepEqual(zeros.rows.map((r) => [r.width, r.fraction]), [[0, 0], [0, 0]]);
  assertClean(barLayout([{ value: 1e308 }, { value: 1e308 }]));
});

test('stackedLayout: segments in series order on a shared scale', () => {
  const rows = [
    { key: 'r1', label: 'Alice', parts: [{ key: 'new', value: 3 }, { key: 'wip', value: 5 }] },
    { key: 'r2', label: 'Bob', parts: [{ key: 'new', value: 2 }] },
  ];
  const series = [{ key: 'new', label: 'New', tone: 'c1' }, { key: 'wip', label: 'In progress' }];
  const l = stackedLayout(rows, series);
  assert.equal(l.scaleMax, 8);
  assert.deepEqual(l.rows[0].segments.map((s) => [s.key, s.x, s.width]), [['new', 0, 37.5], ['wip', 37.5, 62.5]]);
  assert.deepEqual(l.rows[1].segments.map((s) => [s.key, s.x, s.width]), [['new', 0, 25]]);
  assert.deepEqual(l.rows[1].parts, { new: 2, wip: 0 });
  assert.deepEqual(l.rows.map((r) => r.total), [8, 2]);
  assert.equal(l.rows[0].segments[1].seriesIndex, 1);
  assert.equal(l.rows[0].segments[0].tone, 'c1');
  assert.equal(l.height, 18 * 2 + 10);
  assertClean(l);
});

test('stackedLayout: unknown parts ignored, repeats summed, empty and capped input', () => {
  const series = [{ key: 'a', label: 'A' }];
  const l = stackedLayout([{ label: 'X', parts: [{ key: 'a', value: 1 }, { key: 'a', value: 2 }, { key: 'zzz', value: 99 }, { key: 'a', value: -4 }, { key: 'a', value: NaN }] }], series);
  assert.equal(l.rows[0].total, 3);
  assert.equal(l.rows[0].segments.length, 1);
  assert.equal(l.rows[0].key, '0');
  assert.deepEqual(stackedLayout([], series).rows, []);
  assert.deepEqual(stackedLayout(undefined, undefined).rows, []);
  const empty = stackedLayout([{ label: 'none', parts: [] }], series);
  assert.deepEqual(empty.rows[0].segments, []);
  assert.equal(empty.scaleMax, 0);
  const capped = stackedLayout([{ parts: [] }, { parts: [] }, { parts: [] }], series, { maxRows: 2 });
  assert.equal(capped.rows.length, 2);
  assert.equal(capped.hidden, 1);
  assertClean(stackedLayout([{ label: 'h', parts: [{ key: 'a', value: 1e300 }] }], series));
});

test('linePath and areaPath', () => {
  assert.equal(linePath([]), '');
  assert.equal(linePath(undefined), '');
  assert.equal(linePath([{ x: 1, y: 2 }]), 'M1 2');
  assert.equal(linePath([{ x: 0, y: 0 }, { x: 10, y: 5.123 }]), 'M0 0L10 5.12');
  assert.equal(linePath([{ x: 0, y: 0 }, { x: NaN, y: 3 }, { x: 4, y: Infinity }, { x: 5, y: 5 }]), 'M0 0L5 5');
  assert.equal(areaPath([{ x: 0, y: 0 }, { x: 10, y: 5 }], 20), 'M0 0L10 5L10 20L0 20Z');
  assert.equal(areaPath([], 20), '');
  assertClean(areaPath([{ x: 0, y: 0 }], NaN));
  assert.ok(areaPath([{ x: 0, y: 0 }], NaN).endsWith('Z'));
});

const OPENED = { key: 'o', label: 'Opened', tone: 'c1', points: [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 9 }, { label: 'Wed', value: 6 }] };
const RESOLVED = { key: 'r', label: 'Resolved', tone: 'c2', points: [{ label: 'Mon', value: 1 }, { label: 'Tue', value: 2 }, { label: 'Wed', value: 4 }] };

test('trendLayout: scale from 0, three ticks, points inside the plot, first/peak/last marks', () => {
  const t = trendLayout([OPENED, RESOLVED], { width: 320, height: 170 });
  assert.equal(t.yMax, 10);
  assert.deepEqual(t.ticks.map((x) => x.value), [0, 5, 10]);
  assert.deepEqual(t.plot, { x0: 36, x1: 304, y0: 18, y1: 144 });
  assert.equal(t.ticks[0].y, 144);
  assert.equal(t.ticks[2].y, 18);
  const [o, r] = t.series;
  assert.deepEqual(o.points.map((p) => p.x), [36, 170, 304]);
  assert.equal(o.points[1].y, 30.6);
  assert.deepEqual(o.marks.map((m) => [m.index, m.kinds.join('+')]), [[0, 'first'], [1, 'peak'], [2, 'last']]);
  assert.equal(o.marks[0].anchor, 'start');
  assert.equal(o.marks[2].anchor, 'end');
  assert.equal(o.marks[1].anchor, 'middle');
  assert.ok(o.line.startsWith('M36 '));
  assert.equal(o.area, '');
  assert.notEqual(o.marker, r.marker);
  assert.equal(o.marks[1].above, true);
  assert.equal(r.marks[1].above, false); // the second series writes its numbers below its points
  t.series.forEach((s) => s.points.forEach((p) => assert.ok(p.x >= 36 && p.x <= 304 && p.y >= 18 && p.y <= 144)));
  assertClean(t);
  assert.ok(trendLayout([OPENED], { area: true }).series[0].area.endsWith('Z'));
});

test('trendLayout: edge cases (empty, one point, zeros, uneven series, huge values, many points)', () => {
  const none = trendLayout([]);
  assert.equal(none.length, 0);
  assert.deepEqual(none.series, []);
  assertClean(none);
  assertClean(trendLayout(undefined));
  const one = trendLayout([{ label: 'A', points: [{ label: 'Mon', value: 4 }] }]);
  assert.equal(one.series[0].points[0].x, (36 + 304) / 2);
  assert.deepEqual(one.series[0].marks.map((m) => m.kinds.join('+')), ['first+peak+last']);
  const zeros = trendLayout([{ label: 'Z', points: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }]);
  assert.equal(zeros.yMax, 2);
  assert.deepEqual(zeros.series[0].marks.map((m) => m.kinds.join('+')), ['first', 'last']);
  assertClean(zeros);
  const uneven = trendLayout([OPENED, { label: 'Short', points: [{ label: 'Mon', value: 1 }] }]);
  assert.equal(uneven.length, 3);
  assert.equal(uneven.series[1].points.length, 1);
  const bad = trendLayout([{ label: 'B', points: [{ label: 'a', value: NaN }, { label: 'b', value: -3 }, { label: 'c', value: 1e300 }, null] }]);
  assertClean(bad);
  const many = trendLayout([{ label: 'M', points: Array.from({ length: 90 }, (_, i) => ({ label: `d${i}`, value: i })) }], { width: 320 });
  assert.ok(many.xLabels.length <= 5 && many.xLabels[0].index === 0 && many.xLabels.at(-1).index === 89);
  assertClean(many);
  const narrow = trendLayout([OPENED], { width: 10, height: 5 });
  assert.ok(narrow.width >= 120 && narrow.height >= 90);
  assertClean(narrow);
});

test('donutArcs: angles add up to 360 (or 0), a lone item is a full ring', () => {
  const d = donutArcs([{ label: 'A', value: 3 }, { label: 'B', value: 1 }]);
  assert.equal(d.total, 4);
  assert.deepEqual(d.arcs.map((a) => [a.startAngle, a.endAngle]), [[0, 270], [270, 360]]);
  const sweep = (list) => list.arcs.reduce((acc, a) => acc + (a.endAngle - a.startAngle), 0);
  assert.ok(Math.abs(sweep(d) - 360) < 1e-6);
  const thirds = donutArcs([{ value: 1 }, { value: 1 }, { value: 1 }]);
  assert.ok(Math.abs(sweep(thirds) - 360) < 1e-6);
  assert.equal(thirds.arcs.at(-1).endAngle, 360);
  d.arcs.forEach((a) => assert.match(a.d, /^M.*Z$/));
  const single = donutArcs([{ label: 'All', value: 7 }]);
  assert.equal(single.arcs[0].endAngle, 360);
  assert.equal((single.arcs[0].d.match(/Z/g) || []).length, 2); // outer ring and the hole
  assertClean(single);
  const zero = donutArcs([{ value: 0 }, { value: 0 }]);
  assert.equal(zero.total, 0);
  assert.deepEqual(zero.arcs.map((a) => [a.d, a.startAngle, a.endAngle]), [['', 0, 0], ['', 0, 0]]);
  const gap = donutArcs([{ value: 1 }, { value: 0 }, { value: 1 }]);
  assert.equal(gap.arcs[1].d, '');
  assert.equal(gap.arcs[1].startAngle, gap.arcs[1].endAngle);
  assert.ok(Math.abs(sweep(gap) - 360) < 1e-6);
  assert.deepEqual(donutArcs([]).arcs, []);
  assert.equal(donutArcs([]).total, 0);
  assertClean(donutArcs([{ value: -1 }, { value: NaN }, { value: 1e300 }, null, { value: '2' }]));
  const wide = donutArcs([{ value: 3 }, { value: 1 }]);
  assert.match(wide.arcs[0].d, /A\d+(\.\d+)? \d+(\.\d+)? 0 1 1 /); // 270 degrees needs the large-arc flag
});

test('gaugeTone: thresholds in both directions', () => {
  const t = { warn: 70, bad: 90 };
  assert.deepEqual([50, 70, 89, 90, 120].map((v) => gaugeTone(v, t)), ['good', 'warn', 'warn', 'bad', 'bad']);
  const low = { warn: 90, bad: 80 };
  assert.deepEqual([95, 90, 85, 80, 10].map((v) => gaugeTone(v, low, false)), ['good', 'warn', 'warn', 'bad', 'bad']);
  assert.equal(gaugeTone(5, undefined), 'neutral');
  assert.equal(gaugeTone(5, {}), 'neutral');
  assert.equal(gaugeTone(NaN, t), 'good');
  assert.equal(gaugeTone(80, { bad: 75 }), 'bad');
});

test('gaugeArc: semicircle from the left over the top, ticks at the thresholds', () => {
  const g = gaugeArc(50, 100, { radius: 80, thickness: 16, thresholds: { warn: 70, bad: 90 } });
  assert.equal(g.fraction, 0.5);
  assert.equal(g.cx, 98);
  assert.ok(g.fill.startsWith('M18 98A80 80 0 0 1 98 18'));
  assert.ok(g.track.startsWith('M18 98A80 80 0 0 1 178 98'));
  assert.deepEqual(g.ticks.map((t) => [t.name, t.fraction]), [['warn', 0.7], ['bad', 0.9]]);
  assert.deepEqual(g.left, { x: 18, y: 98 });
  assert.deepEqual(g.right, { x: 178, y: 98 });
  assert.equal(gaugeArc(0, 100).fill, '');
  assert.notEqual(gaugeArc(0, 100).track, '');
  assert.equal(gaugeArc(500, 100).fraction, 1);
  assert.equal(gaugeArc(5, 0).fraction, 1); // no scale given: 1
  assert.equal(gaugeArc(NaN, NaN).fraction, 0);
  assert.deepEqual(gaugeArc(50, 100, { thresholds: { warn: 150, bad: -1 } }).ticks, []);
  assertClean(gaugeArc(1e300, 1e300, { thresholds: { warn: NaN } }));
  assertClean(g);
});

test('heat levels and layout', () => {
  assert.equal(heatLevel(0, 10), 1);
  assert.equal(heatLevel(1, 10), 2);
  assert.equal(heatLevel(5, 10), 3);
  assert.equal(heatLevel(6, 10), 4);
  assert.equal(heatLevel(10, 10), 5);
  assert.equal(heatLevel(5, 0), 1);
  assert.equal(heatLevel(NaN, NaN), 1);
  assert.equal(heatLevel(99, 10), 5);
  const l = heatLayout([{ key: '0-1', label: '0-1d', value: 10 }, { key: '2-3', label: '2-3d', value: 0 }, { key: '4-7', label: '4-7d', value: 5 }]);
  assert.deepEqual(l.cells.map((c) => c.level), [5, 1, 3]);
  assert.deepEqual(l.cells.map((c) => c.share), [67, 0, 33]);
  assert.equal(l.total, 15);
  assert.deepEqual(heatLayout([{ value: 5 }], { total: 50 }).cells.map((c) => c.share), [10]);
  assert.deepEqual(heatLayout([]).cells, []);
  assertClean(heatLayout([{ value: NaN }, { value: 0 }]));
});

test('summarizeItems reads the numbers out in words', () => {
  const items = [{ label: 'In Progress', value: 12 }, { label: 'New', value: 8 }];
  assert.equal(summarizeItems(items), 'In Progress 12 (60%), New 8 (40%). Total 20.');
  assert.equal(summarizeItems(items, { unit: 'incidents' }), 'In Progress 12 incidents (60%), New 8 incidents (40%). Total 20 incidents.');
  assert.equal(summarizeItems(items, { total: 40 }), 'In Progress 12 (30%), New 8 (20%). Total 40.');
  assert.equal(summarizeItems(items, { max: 1 }), 'In Progress 12 (60%), and 1 more. Total 20.');
  assert.equal(summarizeItems([{ label: 'Met', value: 82 }], { unit: '%' }), 'Met 82% (100%). Total 82%.');
  assert.equal(summarizeItems([]), 'No data.');
  assert.equal(summarizeItems(undefined), 'No data.');
  assert.equal(summarizeItems([{ label: 'A', value: 0 }, { label: 'B', value: 0 }]), 'A 0, B 0. Total 0.');
  assertClean(summarizeItems([{ label: 'x', value: NaN }, { value: -3 }, null, { label: 'y'.repeat(500), value: 1e300 }]));
  assert.ok(summarizeItems([{ label: 'y'.repeat(500), value: 1 }]).length < 120);
});

test('summarizeStacked, summarizeSeries, summarizeGauge, describeTile', () => {
  const rows = [{ label: 'Alice', parts: [{ key: 'new', value: 3 }, { key: 'wip', value: 5 }] }, { label: 'Bob', parts: [{ key: 'new', value: 2 }] }];
  const series = [{ key: 'new', label: 'New' }, { key: 'wip', label: 'In progress' }];
  assert.equal(summarizeStacked(rows, series), 'Alice: New 3, In progress 5, total 8. Bob: New 2, total 2.');
  assert.equal(summarizeStacked([], series), 'No data.');
  assert.equal(summarizeStacked([{ label: 'Nobody', parts: [] }], series), 'Nobody: none, total 0.');

  assert.equal(summarizeSeries([OPENED]), 'Opened: starts at 3 (Mon), ends at 6 (Wed), highest 9 (Tue).');
  assert.equal(summarizeSeries([OPENED, RESOLVED], { unit: 'tickets' }), 'Opened: starts at 3 tickets (Mon), ends at 6 tickets (Wed), highest 9 tickets (Tue). Resolved: starts at 1 ticket (Mon), ends at 4 tickets (Wed), highest 4 tickets (Wed).');
  assert.equal(summarizeSeries([]), 'No data.');
  assert.equal(summarizeSeries([{ label: 'A', points: [] }]), 'No data.');
  assert.equal(summarizeSeries([OPENED, { label: 'Resolved', points: [] }]), 'Opened: starts at 3 (Mon), ends at 6 (Wed), highest 9 (Tue). Resolved: no data.');
  assertClean(summarizeSeries([{ label: 'B', points: [{ label: 'a', value: NaN }, { value: 1e300 }, null] }]));

  assert.equal(summarizeGauge({ label: 'SLA met', value: 82, max: 100, unit: '%', tone: 'warn' }), 'SLA met: 82% of 100% (warning).');
  assert.equal(summarizeGauge({ label: 'Mean age', value: 2.5, unit: 'd' }), 'Mean age: 2.5d.');
  assertClean(summarizeGauge({}));

  assert.equal(describeTile({ label: 'Open', value: 12, hint: 'assigned to your groups', delta: { text: '3 since yesterday', direction: 'up' } }), 'Open: 12, assigned to your groups. Up 3 since yesterday.');
  assert.equal(describeTile({ label: 'Open', value: 1234 }), 'Open: 1,234.');
  assert.equal(describeTile({ label: 'Open', unavailable: true, value: 0 }), 'Open: not available to you.');
  assert.equal(describeTile({ label: 'Open', loading: true }), 'Open: loading.');
  assertClean(describeTile({}));
});

test('table helpers give the same numbers as the chart', () => {
  const t = itemsToTable([{ key: 'a', label: 'New', value: 6 }, { key: 'b', label: 'Done', value: 2 }]);
  assert.deepEqual(t.columns.map((c) => c.key), ['label', 'value', 'share']);
  assert.deepEqual(t.rows.map((r) => [r.label, r.value, r.share]), [['New', 6, '75%'], ['Done', 2, '25%']]);
  assert.equal(t.columns[1].label, 'Count');
  assert.equal(itemsToTable([], {}).rows.length, 0);
  assert.equal(itemsToTable([{ label: 'A', value: 0 }]).rows[0].share, '-');
  assert.equal(itemsToTable([{ label: 'A', value: 1 }], { unit: 'h' }).columns[1].label, 'Value (h)');

  const s = stackedToTable([{ key: 'r1', label: 'Alice', parts: [{ key: 'new', value: 3 }, { key: 'wip', value: 5 }] }], [{ key: 'new', label: 'New' }, { key: 'wip', label: 'In progress' }]);
  assert.deepEqual(s.columns.map((c) => c.label), ['Name', 'New', 'In progress', 'Total']);
  assert.deepEqual([s.rows[0].s_new, s.rows[0].s_wip, s.rows[0].total], [3, 5, 8]);

  const tr = seriesToTable([OPENED, { label: 'Short', points: [{ label: 'Mon', value: 1 }] }]);
  assert.deepEqual(tr.columns.map((c) => c.label), ['When', 'Opened', 'Short']);
  assert.deepEqual(tr.rows.map((r) => [r.label, r.s0, r.s1]), [['Mon', 3, 1], ['Tue', 9, null], ['Wed', 6, null]]);
  assert.deepEqual(seriesToTable([]).rows, []);
});
