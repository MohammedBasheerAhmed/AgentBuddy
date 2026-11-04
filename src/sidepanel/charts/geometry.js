// Pure helpers behind the charts: scales, bar / stacked / line / donut geometry, label thinning, and the plain-language
// summaries a screen reader gets. No DOM and no React in here, so all of it is unit-tested (tests/charts-geometry.test.js).
//
// Every function tolerates what real data looks like: an empty list, a zero total, NaN or negative numbers (clamped to 0),
// very large numbers and very long labels. Nothing in this file can produce NaN or Infinity in a number or a path.

import { t } from '../../i18n/core.js';

// ---- numbers -----------------------------------------------------------------------------------

const round = (n, decimals = 2) => {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  if (!Number.isFinite(r)) return n; // a value so large that scaling it overflows: keep it as it was
  return Object.is(r, -0) ? 0 : r;
};

// Beyond this nothing a report counts is real, and sums and scales of such numbers would overflow to Infinity.
const MAX_VALUE = 1e15;

/** A finite number between 0 and a quadrillion, else 0. Charts only draw sizes, and a size cannot be negative. */
export const num = (value) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_VALUE) : 0;
};

const mod = (n, m) => ((Math.floor(Number(n) || 0) % m) + m) % m;

/** part / total as a percentage (0 to 100), rounded; 0 when the total is 0. */
export function percent(part, total, decimals = 0) {
  const whole = num(total);
  if (whole <= 0) return 0;
  return round(Math.min(100, (num(part) / whole) * 100), decimals);
}

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * A number as people read it: 1,234 and 12.5. `compact` turns 12,300 into 12.3K (for tight spots).
 * Not a locale formatter on purpose: the output is the same on every machine, which keeps tests and exports stable.
 */
export function formatNumber(value, { compact = false, decimals } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e21) return n.toExponential(2);
  if (compact && abs >= 10000) {
    const sizes = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [size, suffix] of sizes) {
      if (abs >= size) {
        const scaled = n / size;
        const text = Math.abs(scaled) >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
        return `${text.replace(/\.0$/, '')}${suffix}`;
      }
    }
  }
  const places = decimals === undefined ? (Number.isInteger(n) ? 0 : 1) : Math.min(6, Math.max(0, Math.floor(decimals)));
  const fixed = n.toFixed(places);
  const [int, frac] = fixed.replace('-', '').split('.');
  return `${n < 0 && Number(fixed) !== 0 ? '-' : ''}${group(int)}${frac ? `.${frac}` : ''}`;
}

/** "12%", "5h" but "12 incidents": a % or a one-letter unit sticks to the number, a word does not. */
export function withUnit(text, unit) {
  const u = String(unit ?? '').trim();
  if (!u) return String(text);
  if (u === '%' || /^[a-z]$/i.test(u)) return `${text}${u}`;
  // "1 tickets" reads wrongly: a plural unit loses its s next to exactly one.
  const unit1 = String(text) === '1' && /[a-z]s$/i.test(u) && !/ss$/i.test(u) ? u.slice(0, -1) : u;
  return `${text} ${unit1}`;
}

/** One line of text, capped at `max` characters (counted as characters, not UTF-16 units), with an ellipsis. */
export function clipLabel(text, max = 28) {
  const clean = String(text ?? '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  const limit = Number.isFinite(max) ? Math.max(2, Math.floor(max)) : 28;
  const chars = Array.from(clean);
  if (chars.length <= limit) return clean;
  return `${chars.slice(0, limit - 1).join('').trimEnd()}…`;
}

// ---- scales ------------------------------------------------------------------------------------

/**
 * A round top value for an axis that starts at 0 and has a tick in the middle (0, max/2, max).
 * With `integer` (the default, for counts) small maxima become 2, 4, 6, 8, 10 so the middle tick is a whole number too.
 */
export function niceMax(max, { integer = true } = {}) {
  const m = num(max);
  if (m <= 0) return integer ? 2 : 1;
  if (integer && m <= 10) return Math.max(2, Math.ceil(m / 2) * 2);
  const exp = Math.floor(Math.log10(m));
  const base = 10 ** exp;
  const steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
  const mantissa = m / base;
  const step = steps.find((s) => s >= mantissa - 1e-9) ?? 10;
  return round(step * base, 6);
}

/** `count` evenly spaced tick values from 0 to `max`, both included. */
export function ticks(max, count = 3) {
  const n = Math.max(2, Math.floor(num(count)) || 3);
  const top = num(max);
  return Array.from({ length: n }, (_, i) => round((top * i) / (n - 1), 6));
}

/** Which of `labels` to print so that at most `maxCount` show: evenly spread, the first and the last always among them. */
export function thinLabels(labels, maxCount) {
  const n = Array.isArray(labels) ? labels.length : 0;
  if (n === 0) return [];
  const cap = Math.floor(num(maxCount));
  if (cap <= 1) return [0];
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  const picked = new Set();
  for (let k = 0; k < cap; k += 1) picked.add(Math.round((k * (n - 1)) / (cap - 1)));
  return [...picked].sort((a, b) => a - b);
}

// ---- tones, patterns, markers -------------------------------------------------------------------

export const TONES = ['good', 'warn', 'bad', 'neutral', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
export const CATEGORICAL = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

export const normTone = (tone, fallback = 'neutral') => (TONES.includes(tone) ? tone : fallback);

/** The class that sets `--tone` for an element and everything inside it. */
export const toneClass = (tone) => `ab-tone-${normTone(tone)}`;

/** The nth categorical tone, cycling after six. */
export const toneForIndex = (index) => CATEGORICAL[mod(index, CATEGORICAL.length)];

// Series are told apart by more than colour: each index gets its own fill pattern (bars, segments, legend swatches) and its
// own marker shape (lines). The pattern is drawn in 8 x 8 units.
export const PATTERNS = [
  { id: 'solid', label: 'solid', lines: '', dot: false },
  { id: 'diagonal', label: 'diagonal stripes', lines: 'M-1 1 L1 -1 M0 8 L8 0 M7 9 L9 7', dot: false },
  { id: 'dots', label: 'dots', lines: '', dot: true },
  { id: 'horizontal', label: 'horizontal lines', lines: 'M0 4 H8', dot: false },
  { id: 'cross', label: 'crosshatch', lines: 'M0 0 L8 8 M8 0 L0 8', dot: false },
  { id: 'vertical', label: 'vertical lines', lines: 'M4 0 V8', dot: false },
];

export const patternFor = (index) => ({ ...PATTERNS[mod(index, PATTERNS.length)], index: mod(index, PATTERNS.length) });

export const MARKERS = ['circle', 'square', 'diamond', 'triangle', 'cross', 'plus'];
export const markerFor = (index) => MARKERS[mod(index, MARKERS.length)];

/** SVG path for a marker of radius r centred on (cx, cy). */
export function markerPath(shape, cx, cy, r = 3.5) {
  const x = Number.isFinite(cx) ? cx : 0;
  const y = Number.isFinite(cy) ? cy : 0;
  const s = Number.isFinite(r) && r > 0 ? r : 3.5;
  const f = (n) => round(n, 2);
  switch (shape) {
    case 'square':
      return `M${f(x - s)} ${f(y - s)}H${f(x + s)}V${f(y + s)}H${f(x - s)}Z`;
    case 'diamond':
      return `M${f(x)} ${f(y - s * 1.25)}L${f(x + s * 1.25)} ${f(y)}L${f(x)} ${f(y + s * 1.25)}L${f(x - s * 1.25)} ${f(y)}Z`;
    case 'triangle':
      return `M${f(x)} ${f(y - s * 1.2)}L${f(x + s * 1.15)} ${f(y + s * 0.9)}L${f(x - s * 1.15)} ${f(y + s * 0.9)}Z`;
    case 'cross':
      return `M${f(x - s)} ${f(y - s)}L${f(x + s)} ${f(y + s)}M${f(x + s)} ${f(y - s)}L${f(x - s)} ${f(y + s)}`;
    case 'plus':
      return `M${f(x - s)} ${f(y)}H${f(x + s)}M${f(x)} ${f(y - s)}V${f(y + s)}`;
    default:
      return `M${f(x - s)} ${f(y)}a${f(s)} ${f(s)} 0 1 0 ${f(s * 2)} 0a${f(s)} ${f(s)} 0 1 0 ${f(-s * 2)} 0Z`;
  }
}

/** Markers made of lines (not closed shapes) need a stroke in the tone colour; the others are filled. */
export const markerIsLine = (shape) => shape === 'cross' || shape === 'plus';

// ---- bars --------------------------------------------------------------------------------------

const keyOf = (item, index) => {
  const k = item?.key;
  return k === undefined || k === null || k === '' ? String(index) : String(k);
};

/**
 * Layout for a horizontal bar chart, in any units you like (the component uses width = 100 and writes the numbers as
 * percentages, so the bars stretch with the panel while the text stays real HTML).
 * `labelWidth` is room reserved at the left; bars share what is left. Bar length is relative to the largest value
 * (or to `max` when given). A non-zero value always gets a visible sliver.
 */
export function barLayout(items, { width = 100, rowHeight = 10, gap = 6, labelWidth = 0, max, maxItems } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const cap = Number.isFinite(maxItems) && maxItems > 0 ? Math.floor(maxItems) : list.length;
  const shown = list.slice(0, cap);
  const rest = list.slice(cap);
  const values = shown.map((it) => num(it.value));
  const peak = values.reduce((a, b) => Math.max(a, b), 0);
  const scaleMax = num(max) || peak;
  const barSpace = Math.max(0, num(width) - num(labelWidth));
  const h = num(rowHeight) || 10;
  const g = num(gap);
  const rows = shown.map((it, i) => {
    const value = values[i];
    const fraction = scaleMax > 0 ? Math.min(1, value / scaleMax) : 0;
    const barWidth = value > 0 ? Math.max(fraction * barSpace, barSpace * 0.012) : 0;
    return {
      key: keyOf(it, i),
      label: String(it.label ?? ''),
      hint: it.hint == null ? '' : String(it.hint),
      tone: it.tone,
      value,
      fraction: round(fraction, 6),
      x: round(num(labelWidth), 4),
      y: round(i * (h + g), 4),
      height: h,
      width: round(barWidth, 4),
    };
  });
  const total = values.reduce((a, b) => a + b, 0) + rest.reduce((a, it) => a + num(it.value), 0);
  return {
    rows,
    hidden: { count: rest.length, value: rest.reduce((a, it) => a + num(it.value), 0) },
    height: shown.length ? round(shown.length * h + (shown.length - 1) * g, 4) : 0,
    scaleMax,
    total,
    barSpace: round(barSpace, 4),
  };
}

/**
 * Layout for stacked bars: one bar per row, its segments in the order of `series`. All rows share one scale (the largest
 * row's sum, or `max`), so bars can be compared. Segments with no value are left out of `segments` but stay in `parts`.
 * A row's `total` is the sum of its parts, unless the row gives its own (a number): Workload prints a person's OPEN tickets and draws
 * their resolved-but-not-closed part beside them, so the number agrees with the Open tile while the bar shows both.
 */
export function stackedLayout(rows, series, { width = 100, rowHeight = 18, gap = 10, labelWidth = 0, max, maxRows } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  const defs = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object').map((s, i) => ({ ...s, key: keyOf(s, i), index: i }));
  const cap = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : list.length;
  const shown = list.slice(0, cap);
  const valueOf = (row, key) =>
    (Array.isArray(row.parts) ? row.parts : []).reduce((sum, p) => (p && String(p.key) === key ? sum + num(p.value) : sum), 0);
  const sums = shown.map((row) => defs.reduce((sum, s) => sum + valueOf(row, s.key), 0));
  const totals = shown.map((row, ri) => (typeof row.total === 'number' ? num(row.total) : sums[ri]));
  const scaleMax = num(max) || sums.reduce((a, b) => Math.max(a, b), 0);
  const barSpace = Math.max(0, num(width) - num(labelWidth));
  const h = num(rowHeight) || 18;
  const g = num(gap);
  const out = shown.map((row, ri) => {
    let x = num(labelWidth);
    const parts = {};
    const segments = [];
    defs.forEach((s) => {
      const value = valueOf(row, s.key);
      parts[s.key] = value;
      if (value <= 0) return;
      const w = scaleMax > 0 ? (value / scaleMax) * barSpace : 0;
      segments.push({ key: s.key, seriesIndex: s.index, seriesLabel: String(s.label ?? s.key), tone: s.tone, value, x: round(x, 4), width: round(w, 4), fraction: round(scaleMax > 0 ? value / scaleMax : 0, 6) });
      x += w;
    });
    return { key: keyOf(row, ri), label: String(row.label ?? ''), total: totals[ri], parts, segments, y: round(ri * (h + g), 4), height: h };
  });
  return {
    rows: out,
    series: defs,
    scaleMax,
    hidden: Math.max(0, list.length - shown.length),
    height: out.length ? round(out.length * h + (out.length - 1) * g, 4) : 0,
    barSpace: round(barSpace, 4),
  };
}

// ---- lines -------------------------------------------------------------------------------------

const pt = (p) => `${round(p.x)} ${round(p.y)}`;
const finitePoints = (points) => (Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : []);

/** "M x y L x y ..." through the points; points with a non-finite coordinate are skipped; '' when none are left. */
export function linePath(points) {
  const list = finitePoints(points);
  if (!list.length) return '';
  return list.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('');
}

/** The line path closed down to the baseline, for an area under a line. */
export function areaPath(points, baselineY) {
  const list = finitePoints(points);
  const base = Number.isFinite(baselineY) ? baselineY : 0;
  if (!list.length) return '';
  const first = list[0];
  const last = list[list.length - 1];
  return `${linePath(list)}L${round(last.x)} ${round(base)}L${round(first.x)} ${round(base)}Z`;
}

/**
 * Layout for a line / area chart in real pixels (the component measures its width, so text is drawn at its true size).
 * series: [{ key, label, tone, points: [{ label, value }] }]. The x axis is the point index; labels come from the longest series.
 * The y axis starts at 0 and has three ticks. Each series gets its first, last and highest point labelled.
 */
export function trendLayout(series, { width = 320, height = 170, padding, maxXLabels, yMax, area = false } = {}) {
  const pad = { top: 18, right: 16, bottom: 26, left: 36, ...padding };
  const list = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object');
  const W = Math.max(120, num(width) || 320);
  const H = Math.max(90, num(height) || 170);
  const x0 = pad.left;
  const x1 = Math.max(x0 + 1, W - pad.right);
  const y0 = pad.top;
  const y1 = Math.max(y0 + 1, H - pad.bottom);
  const length = list.reduce((a, s) => Math.max(a, Array.isArray(s.points) ? s.points.length : 0), 0);
  const peak = list.reduce((a, s) => (Array.isArray(s.points) ? s.points.reduce((b, p) => Math.max(b, num(p?.value)), a) : a), 0);
  const top = niceMax(num(yMax) || peak);
  const xAt = (i) => (length <= 1 ? (x0 + x1) / 2 : x0 + (i / (length - 1)) * (x1 - x0));
  const yAt = (v) => y1 - (Math.min(num(v), top) / top) * (y1 - y0);
  const longest = list.find((s) => (s.points?.length || 0) === length);
  const labels = (longest?.points || []).map((p) => String(p?.label ?? ''));
  const labelLimit = Number.isFinite(maxXLabels) ? maxXLabels : Math.max(2, Math.floor((x1 - x0) / 56));
  const shownIdx = thinLabels(labels, labelLimit);
  const anchorAt = (x) => (x < x0 + 14 ? 'start' : x > x1 - 14 ? 'end' : 'middle');

  const out = list.map((s, si) => {
    const raw = Array.isArray(s.points) ? s.points : [];
    const points = raw.map((p, i) => ({ index: i, label: String(p?.label ?? ''), value: num(p?.value), x: round(xAt(i)), y: round(yAt(p?.value)) }));
    let peakIdx = -1;
    points.forEach((p, i) => {
      if (p.value > 0 && (peakIdx < 0 || p.value > points[peakIdx].value)) peakIdx = i;
    });
    const wanted = [];
    if (points.length) {
      wanted.push([0, 'first']);
      if (peakIdx >= 0) wanted.push([peakIdx, 'peak']);
      wanted.push([points.length - 1, 'last']);
    }
    const marks = [];
    wanted.forEach(([index, kind]) => {
      const existing = marks.find((m) => m.index === index);
      if (existing) {
        existing.kinds.push(kind);
        return;
      }
      const p = points[index];
      marks.push({ index, kinds: [kind], x: p.x, y: p.y, text: formatNumber(p.value, { compact: true }), anchor: anchorAt(p.x), above: si % 2 === 0 || p.y > y1 - 20 }); // later series label below the point, unless that runs into the axis
    });
    return {
      key: keyOf(s, si),
      label: String(s.label ?? s.key ?? ''),
      tone: s.tone,
      seriesIndex: si,
      marker: markerFor(si),
      points,
      line: linePath(points),
      area: area ? areaPath(points, y1) : '',
      marks,
    };
  });

  return {
    width: W,
    height: H,
    plot: { x0, x1, y0, y1 },
    yMax: top,
    ticks: ticks(top, 3).map((value) => ({ value, y: round(yAt(value)), label: formatNumber(value, { compact: true }) })),
    xLabels: shownIdx.map((index) => ({ index, x: round(xAt(index)), label: clipLabel(labels[index], 10), anchor: anchorAt(xAt(index)) })),
    series: out,
    length,
  };
}

// ---- donut -------------------------------------------------------------------------------------

// Angles are degrees, 0 at 12 o'clock, growing clockwise.
const polar = (cx, cy, r, angle) => {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
};

function ringPath(cx, cy, outer, inner, a0, a1) {
  const f = (n) => round(n, 2);
  if (a1 - a0 >= 359.99) {
    // One arc cannot close on itself: draw two halves, the inner ring in the other direction so it cuts a hole.
    return (
      `M${f(cx)} ${f(cy - outer)}A${f(outer)} ${f(outer)} 0 1 1 ${f(cx)} ${f(cy + outer)}A${f(outer)} ${f(outer)} 0 1 1 ${f(cx)} ${f(cy - outer)}Z` +
      `M${f(cx)} ${f(cy - inner)}A${f(inner)} ${f(inner)} 0 1 0 ${f(cx)} ${f(cy + inner)}A${f(inner)} ${f(inner)} 0 1 0 ${f(cx)} ${f(cy - inner)}Z`
    );
  }
  const large = a1 - a0 > 180 ? 1 : 0;
  const so = polar(cx, cy, outer, a0);
  const eo = polar(cx, cy, outer, a1);
  const si = polar(cx, cy, inner, a0);
  const ei = polar(cx, cy, inner, a1);
  return `M${f(so.x)} ${f(so.y)}A${f(outer)} ${f(outer)} 0 ${large} 1 ${f(eo.x)} ${f(eo.y)}L${f(ei.x)} ${f(ei.y)}A${f(inner)} ${f(inner)} 0 ${large} 0 ${f(si.x)} ${f(si.y)}Z`;
}

/**
 * Ring segments for a donut. Items with no value get an empty path (they stay in the legend). The angles of the segments add up
 * to 360, or to 0 when the total is 0. A single item is a full ring.
 */
export function donutArcs(items, { radius = 50, thickness = 18, cx, cy } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const outer = num(radius) || 50;
  const inner = Math.max(1, outer - (num(thickness) || 18));
  const centerX = Number.isFinite(cx) ? cx : outer + 2;
  const centerY = Number.isFinite(cy) ? cy : outer + 2;
  const values = list.map((it) => num(it.value));
  const total = values.reduce((a, b) => a + b, 0);
  const lastWithValue = values.reduce((acc, v, i) => (v > 0 ? i : acc), -1);
  let angle = 0;
  const arcs = list.map((it, i) => {
    const value = values[i];
    const fraction = total > 0 ? value / total : 0;
    const start = angle;
    // The last real segment ends exactly at 360, so rounding can never leave a hairline gap.
    const end = value > 0 ? (i === lastWithValue ? 360 : angle + fraction * 360) : angle;
    angle = end;
    return { key: keyOf(it, i), label: String(it.label ?? ''), tone: it.tone, value, fraction: round(fraction, 6), startAngle: round(start, 6), endAngle: round(end, 6), d: value > 0 ? ringPath(centerX, centerY, outer, inner, start, end) : '' };
  });
  return { total, arcs, cx: centerX, cy: centerY, radius: outer, innerRadius: inner, size: (outer + 2) * 2 };
}

// ---- heat strip --------------------------------------------------------------------------------

/** Step 1 to 5 on the sequential scale. Zero is step 1 on its own; anything above zero is 2 to 5, relative to the largest cell. */
export function heatLevel(value, max) {
  const v = num(value);
  const m = num(max);
  if (v <= 0 || m <= 0) return 1;
  return 2 + Math.min(3, Math.floor((Math.min(1, v / m) * 4) - 1e-9));
}

export function heatLayout(cells, { total } = {}) {
  const list = Array.isArray(cells) ? cells.filter((c) => c && typeof c === 'object') : [];
  const peak = list.reduce((a, c) => Math.max(a, num(c.value)), 0);
  const sum = list.reduce((a, c) => a + num(c.value), 0);
  const denominator = num(total) || sum;
  return {
    total: denominator,
    cells: list.map((c, i) => ({ key: keyOf(c, i), label: String(c.label ?? ''), value: num(c.value), level: heatLevel(c.value, peak), share: percent(c.value, denominator) })),
  };
}

// ---- text for people who cannot see the chart ----------------------------------------------------

/**
 * "In Progress 12 (40%), New 8 (27%), and 3 more. Total 30." With `shares: false` (values that are not parts of a whole, such as
 * averages) no percentage and no total: "Critical 0.5 days, Low 9.5 days."
 */
export function summarizeItems(items, { unit = '', total, max = 6, shares = true } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  if (!list.length) return t('No data.');
  const sum = list.reduce((a, it) => a + num(it.value), 0);
  const whole = shares ? num(total) || sum : 0;
  const cap = Math.max(1, Math.floor(num(max)) || 6);
  const parts = list.slice(0, cap).map((it) => {
    const value = withUnit(formatNumber(num(it.value)), unit);
    return `${clipLabel(it.label, 40)} ${value}${whole > 0 ? ` (${percent(it.value, whole)}%)` : ''}`;
  });
  const more = list.length - cap;
  if (!shares) return more > 0 ? t('{parts}, and {more} more.', { parts: parts.join(t(', ')), more }) : t('{parts}.', { parts: parts.join(t(', ')) });
  const totalText = withUnit(formatNumber(whole), unit);
  return more > 0 ? t('{parts}, and {more} more. Total {total}.', { parts: parts.join(t(', ')), more, total: totalText }) : t('{parts}. Total {total}.', { parts: parts.join(t(', ')), total: totalText });
}

/** "Alice: New 3, In Progress 5, total 8. Bob: ..." for stacked bars. */
export function summarizeStacked(rows, series, { max = 5 } = {}) {
  const layout = stackedLayout(rows, series, { maxRows: Math.max(1, Math.floor(num(max)) || 5) });
  if (!layout.rows.length) return t('No data.');
  const parts = layout.rows.map((row) => {
    const bits = layout.series.filter((s) => row.parts[s.key] > 0).map((s) => `${clipLabel(s.label, 30)} ${formatNumber(row.parts[s.key])}`);
    return t('{label}: {bits}, total {total}', { label: clipLabel(row.label, 40), bits: bits.length ? bits.join(t(', ')) : t('none'), total: formatNumber(row.total) });
  });
  return `${parts.join('. ')}.${layout.hidden ? ` ${t('{n} more not listed.', { n: layout.hidden })}` : ''}`;
}

/** "Opened: starts at 3 (Mon), ends at 7 (Sun), highest 9 (Wed). Resolved: ..." for line charts. */
export function summarizeSeries(series, { unit = '', maxSeries = 4 } = {}) {
  const list = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object');
  if (!list.length || list.every((s) => !(s.points || []).length)) return t('No data.');
  const at = (p) => `${withUnit(formatNumber(num(p?.value)), unit)}${p?.label ? ` (${clipLabel(p.label, 14)})` : ''}`;
  return list
    .slice(0, Math.max(1, Math.floor(num(maxSeries)) || 4))
    .map((s) => {
      const pts = Array.isArray(s.points) ? s.points : [];
      const name = clipLabel(s.label ?? s.key ?? t('Series'), 30);
      if (!pts.length) return t('{name}: no data.', { name });
      let high = pts[0];
      pts.forEach((p) => {
        if (num(p?.value) > num(high?.value)) high = p;
      });
      return t('{name}: starts at {first}, ends at {last}, highest {high}.', { name, first: at(pts[0]), last: at(pts[pts.length - 1]), high: at(high) });
    })
    .join(' ');
}

/** The plain sentence for a tile: "Open: 12, assigned to your groups. Up 3 since yesterday." */
export function describeTile({ label, value, hint, delta, unavailable, loading } = {}) {
  const name = clipLabel(label, 60);
  if (loading) return t('{name}: loading.', { name });
  if (unavailable) return t('{name}: not available to you.', { name });
  const shown = typeof value === 'number' ? formatNumber(value) : String(value ?? '');
  const dir = { up: t('Up'), down: t('Down'), flat: t('No change') }[delta?.direction] || '';
  const change = delta?.text ? ` ${[dir, delta.text].filter(Boolean).join(' ')}.` : '';
  return `${name}: ${shown}${hint ? `, ${clipLabel(hint, 80)}` : ''}.${change}`;
}

// ---- the same data as a table (the "Show as table" view) ------------------------------------------

const col = (key, label, align) => ({ key, label, ...(align ? { align } : {}) });

/** The items as table rows; `shares: false` leaves out the Share column (averages are not shares of anything). */
export function itemsToTable(items, { unit = '', total, labelHeader = t('Name'), valueHeader, shares = true } = {}) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const sum = list.reduce((a, it) => a + num(it.value), 0);
  const whole = num(total) || sum;
  return {
    columns: [col('label', labelHeader), col('value', valueHeader ?? (unit ? t('Value ({unit})', { unit }) : t('Count')), 'right'), ...(shares ? [col('share', t('Share'), 'right')] : [])],
    rows: list.map((it, i) => ({ key: keyOf(it, i), label: String(it.label ?? ''), value: num(it.value), ...(shares ? { share: whole > 0 ? `${percent(it.value, whole)}%` : '-' } : {}) })),
  };
}

/** `totalHeader` names the last column when the rows print their own total (see stackedLayout); 'Total' otherwise. */
export function stackedToTable(rows, series, { labelHeader = t('Name'), totalHeader } = {}) {
  const layout = stackedLayout(rows, series);
  return {
    columns: [col('label', labelHeader), ...layout.series.map((s) => col(`s_${s.key}`, String(s.label ?? s.key), 'right')), col('total', totalHeader ?? t('Total'), 'right')],
    rows: layout.rows.map((row) => ({ key: row.key, label: row.label, total: row.total, ...Object.fromEntries(layout.series.map((s) => [`s_${s.key}`, row.parts[s.key]])) })),
  };
}

export function seriesToTable(series, { labelHeader = t('When') } = {}) {
  const list = (Array.isArray(series) ? series : []).filter((s) => s && typeof s === 'object');
  const length = list.reduce((a, s) => Math.max(a, Array.isArray(s.points) ? s.points.length : 0), 0);
  const longest = list.find((s) => (s.points?.length || 0) === length);
  return {
    columns: [col('label', labelHeader), ...list.map((s, i) => col(`s${i}`, String(s.label ?? s.key ?? t('Series {n}', { n: i + 1 })), 'right'))],
    rows: Array.from({ length }, (_, i) => ({ key: String(i), label: String(longest?.points?.[i]?.label ?? ''), ...Object.fromEntries(list.map((s, si) => [`s${si}`, s.points?.[i] ? num(s.points[i].value) : null])) })),
  };
}
