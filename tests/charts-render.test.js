import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tile, HorizontalBar, StackedBar, TrendChart, Donut, Gauge, HeatStrip, DataTable, ChartFrame } from '../src/sidepanel/charts/index.js';

const h = React.createElement;
const html = (Component, props) => renderToStaticMarkup(h(Component, props));
const count = (markup, re) => (markup.match(re) || []).length;
const attr = (markup, name) => [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
const noop = () => {};

const HOSTILE = '<img src=x onerror=1>';

const STATES = [
  { key: 'new', label: 'New', value: 8 },
  { key: 'wip', label: 'In Progress', value: 12, tone: 'warn' },
];
const ROWS = [
  { key: 'alice', label: 'Alice', parts: [{ key: 'new', value: 3 }, { key: 'wip', value: 5 }] },
  { key: 'bob', label: 'Bob', parts: [{ key: 'new', value: 2 }] },
];
const SERIES = [{ key: 'new', label: 'New' }, { key: 'wip', label: 'In progress' }];
const TREND = [
  { key: 'o', label: 'Opened', points: [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 9 }, { label: 'Wed', value: 6 }] },
  { key: 'r', label: 'Resolved', points: [{ label: 'Mon', value: 1 }, { label: 'Tue', value: 2 }, { label: 'Wed', value: 4 }] },
];
const AGE = [
  { key: 'a', label: '0-1d', value: 10 },
  { key: 'b', label: '2-3d', value: 0 },
  { key: 'c', label: '4-7d', value: 5 },
  { key: 'd', label: '8-14d', value: 2 },
  { key: 'e', label: '15+d', value: 1 },
];

// Every chart, with data, with the drill-down on and off, and with nothing to show.
const CHARTS = [
  ['HorizontalBar', HorizontalBar, { title: 'Open by state', items: STATES }, 'items'],
  ['StackedBar', StackedBar, { title: 'Workload', rows: ROWS, series: SERIES }, 'rows'],
  ['TrendChart', TrendChart, { title: 'Opened and resolved', series: TREND }, 'series'],
  ['Donut', Donut, { title: 'Priority mix', items: STATES, centerLabel: 'open' }, 'items'],
  ['Gauge', Gauge, { title: 'SLA met', value: 82, max: 100, unit: '%', thresholds: { warn: 90, bad: 80 }, higherIsWorse: false }, null],
  ['HeatStrip', HeatStrip, { title: 'Ageing', cells: AGE }, 'cells'],
];

test('every chart is one image with a text summary of its numbers, and a table toggle', () => {
  for (const [name, Component, props] of CHARTS) {
    const markup = html(Component, props);
    assert.match(markup, /role="img"/, name);
    const [label] = attr(markup, 'aria-label');
    assert.ok(label && label.length > 10, `${name} has an aria-label`);
    assert.ok(/\d/.test(label), `${name} aria-label has the numbers: ${label}`);
    assert.ok(label.startsWith(props.title), `${name} aria-label starts with its title: ${label}`);
    assert.match(markup, /<button type="button" class="ab-btn ab-btn-quiet ab-btn-sm ab-chart-toggle" aria-pressed="false">Show as table<\/button>/, name);
    assert.match(markup, new RegExp(`<h3 class="ab-chart-title">${props.title}</h3>`), name);
    // nothing focusable but the toggle
    assert.equal(count(markup, /<button/g), 1, `${name}: only the toggle is a button`);
    assert.ok(!/tabindex/i.test(markup), `${name}: nothing is focusable without a drill-down`);
    assert.ok(!/role="button"/.test(markup), name);
  }
});

test('the exact summaries', () => {
  assert.equal(attr(html(HorizontalBar, { title: 'Open by state', items: STATES }), 'aria-label')[0], 'Open by state. New 8 (40%), In Progress 12 (60%). Total 20.');
  assert.equal(attr(html(StackedBar, { title: 'Workload', rows: ROWS, series: SERIES }), 'aria-label')[0], 'Workload. Alice: New 3, In progress 5, total 8. Bob: New 2, total 2.');
  assert.equal(attr(html(TrendChart, { title: 'Opened and resolved', series: TREND }), 'aria-label')[0], 'Opened and resolved. Opened: starts at 3 (Mon), ends at 6 (Wed), highest 9 (Tue). Resolved: starts at 1 (Mon), ends at 4 (Wed), highest 4 (Wed).');
  assert.equal(attr(html(Gauge, { title: 'SLA met', value: 82, max: 100, unit: '%', thresholds: { warn: 90, bad: 80 }, higherIsWorse: false }), 'aria-label')[0], 'SLA met: 82% of 100% (warning).');
  assert.equal(attr(html(HeatStrip, { title: 'Ageing', cells: AGE }), 'aria-label')[0], 'Ageing. 0-1d 10 (56%), 2-3d 0 (0%), 4-7d 5 (28%), 8-14d 2 (11%), 15+d 1 (6%). Total 18.');
});

test('the gauge writes its state out, so it never depends on colour', () => {
  const low = html(Gauge, { title: 'SLA met', value: 82, max: 100, unit: '%', thresholds: { warn: 90, bad: 80 }, higherIsWorse: false });
  assert.match(low, /Status: Warning \(warning at 90 or below, bad at 80 or below\)\./);
  assert.match(low, /ab-tone-warn/);
  const high = html(Gauge, { title: 'Backlog', value: 95, max: 120, thresholds: { warn: 70, bad: 90 } });
  assert.match(high, /Status: Bad \(warning at 70 or above, bad at 90 or above\)\./);
  assert.match(html(Gauge, { title: 'Age', value: 3, max: 10 }), /ab-gauge/);
  assert.ok(!/Status:/.test(html(Gauge, { title: 'Age', value: 3, max: 10 })), 'no thresholds, no verdict');
});

test('no chart ever prints NaN, undefined, [object, inline styles or a colour literal', () => {
  for (const [name, Component, props, key] of CHARTS) {
    const variants = [props, { ...props, onDrill: noop }, key ? { ...props, [key]: [] } : { ...props, value: NaN, max: NaN, thresholds: { warn: NaN } }, key ? { ...props, [key]: undefined } : { ...props, value: -5, max: 0 }, { ...props, defaultTable: true }];
    for (const variant of variants) {
      const markup = html(Component, variant);
      assert.ok(!/NaN|undefined|\[object|Infinity/.test(markup), `${name}: ${markup.match(/.{30}(NaN|undefined|\[object|Infinity).{30}/)?.[0]}`);
      assert.ok(!/ style=/.test(markup), `${name}: inline style`);
      assert.ok(!/#[0-9a-f]{6}\b/i.test(markup.replace(/url\(#[^)]*\)/g, '')), `${name}: colour literal`);
      for (const cls of attr(markup, 'class').flatMap((c) => c.split(/\s+/))) assert.ok(cls.startsWith('ab-'), `${name}: class ${cls}`);
    }
  }
});

test('empty data shows the empty text, not a broken chart', () => {
  for (const [name, Component, props, key] of CHARTS.filter((c) => c[3])) {
    const markup = html(Component, { ...props, [key]: [], emptyText: 'Nothing here yet.' });
    assert.match(markup, /Nothing here yet\./, name);
    assert.ok(!/role="img"/.test(markup), `${name}: no image role without data`);
    assert.ok(!/ab-chart-toggle/.test(markup), `${name}: no table toggle without data`);
  }
  assert.match(html(HorizontalBar, { items: [] }), /Nothing to show\./);
  // a donut whose slices are all zero has nothing to draw
  assert.match(html(Donut, { title: 'Mix', items: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] }), /Nothing to show\./);
  // bars with a zero value are still bars
  const zero = html(HorizontalBar, { items: [{ label: 'A', value: 0 }] });
  assert.match(zero, /role="img"/);
  assert.match(zero, /0/);
});

test('drill-down: real buttons or role=button with tabindex, named with the numbers; the wrapper becomes a labelled group', () => {
  const drilled = (Component, props) => html(Component, { ...props, onDrill: noop });

  const bars = drilled(HorizontalBar, CHARTS[0][2]);
  assert.equal(count(bars, /<button type="button" class="ab-hbar-row"/g), 2);
  assert.match(bars, /aria-label="New: 8, 40%\. Open the list\."/);
  assert.match(bars, /role="group"/);
  assert.ok(!/role="img"/.test(bars), 'an image role would hide the buttons from assistive technology');
  assert.match(bars, /aria-label="Open by state\. New 8/);

  const stack = drilled(StackedBar, CHARTS[1][2]);
  assert.equal(count(stack, /role="button"/g), 3); // Alice new + wip, Bob new
  assert.equal(count(stack, /role="button" tabindex="0"/g), 3);
  assert.match(stack, /aria-label="Alice, In progress: 5\. Open the list\."/);

  const donut = drilled(Donut, CHARTS[3][2]);
  assert.equal(count(donut, /<button type="button" class="ab-legend-item"/g), 2);
  assert.match(donut, /aria-label="In Progress: 12, 60%\. Open the list\."/);
  assert.match(donut, /role="img"/, 'the ring itself is a picture; its legend is the list of buttons');

  const heat = drilled(HeatStrip, CHARTS[5][2]);
  assert.equal(count(heat, /<button type="button" class="ab-heat-cell/g), 5);
  assert.match(heat, /aria-label="4-7d: 5, 28%\. Open the list\."/);

  const tile = html(Tile, { label: 'Open', value: 12, hint: 'assigned to your groups', onOpen: noop });
  assert.match(tile, /^<button type="button" class="ab-tile ab-tone-neutral ab-tile-button" aria-label="Open: 12, assigned to your groups\."/);
});

test('without a drill-down callback nothing is a button but the toggle (Tile too)', () => {
  const tile = html(Tile, { label: 'Open', value: 12 });
  assert.ok(!/<button/.test(tile));
  assert.match(tile, /<span class="ab-tile-label">Open<\/span><span class="ab-tile-value">12<\/span>/);
});

test('"Show as table" gives the same numbers as an accessible table', () => {
  const bars = html(HorizontalBar, { title: 'Open by state', items: STATES, defaultTable: true });
  assert.match(bars, /<table class="ab-table ab-chart-table"[^>]*><caption>Open by state<\/caption>/);
  assert.match(bars, /aria-pressed="true"/);
  assert.equal(count(bars, /<th scope="col"/g), 3);
  assert.match(bars, /<th scope="row"[^>]*>New<\/th><td[^>]*class="ab-chart-align-right">8<\/td><td[^>]*class="ab-chart-align-right">40%<\/td>/);
  assert.ok(!/role="img"/.test(bars), 'the table replaces the picture');

  const stack = html(StackedBar, { title: 'Workload', rows: ROWS, series: SERIES, defaultTable: true });
  assert.match(stack, /<th scope="col"[^>]*>In progress<\/th>/);
  assert.match(stack, /<th scope="row"[^>]*>Alice<\/th><td[^>]*>3<\/td><td[^>]*>5<\/td><td[^>]*>8<\/td>/);

  const trend = html(TrendChart, { title: 'T', series: TREND, defaultTable: true });
  assert.match(trend, /<th scope="row"[^>]*>Tue<\/th><td[^>]*>9<\/td><td[^>]*>2<\/td>/);

  const gauge = html(Gauge, { title: 'SLA', value: 82, max: 100, unit: '%', thresholds: { warn: 90, bad: 80 }, higherIsWorse: false, defaultTable: true });
  assert.match(gauge, /82%/);
  assert.match(gauge, /Warning/);
});

test('series differ by pattern and marker, not only by colour; ids are unique per chart', () => {
  const stack = html(StackedBar, { title: 'W', rows: ROWS, series: SERIES });
  const ids = attr(stack, 'id');
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.match(stack, /<pattern[^>]*id="[^"]+-p1"[^>]*>.*?<path class="ab-pat-line" d="M-1 1/); // series 2 has stripes
  // every fill points at a pattern that exists
  for (const ref of attr(stack, 'fill').filter((f) => f.startsWith('url(#'))) assert.ok(ids.includes(ref.slice(5, -1)), `${ref} is defined`);

  // two charts on one page never share ids
  const two = renderToStaticMarkup(h('div', null, h(StackedBar, { rows: ROWS, series: SERIES }), h(StackedBar, { rows: ROWS, series: SERIES }), h(Donut, { items: STATES })));
  const all = attr(two, 'id');
  assert.equal(new Set(all).size, all.length);

  const trend = html(TrendChart, { series: TREND });
  const markers = [...trend.matchAll(/<path class="ab-marker[^"]*" d="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(markers.length >= 6);
  assert.notEqual(markers[0], markers[3]); // different shapes for the two series, not just different colours
  assert.match(trend, /ab-line ab-line-s0/);
  assert.match(trend, /ab-line ab-line-s1/);
});

test('every bar, segment and slice has its value in text', () => {
  const stack = html(StackedBar, { rows: ROWS, series: SERIES });
  assert.match(stack, /<text class="ab-seg-text"[^>]*>3<\/text>/);
  assert.match(stack, /<text class="ab-seg-text"[^>]*>5<\/text>/);
  assert.match(stack, /<title>Alice, In progress: 5<\/title>/);
  const bars = html(HorizontalBar, { items: STATES });
  assert.match(bars, /<span class="ab-hbar-value">12<span class="ab-hbar-pct"> \(60%\)<\/span><\/span>/);
  const donut = html(Donut, { items: STATES, centerLabel: 'open' });
  assert.match(donut, />20<\/text>/);
  assert.match(donut, /<span class="ab-legend-value">12<\/span><span class="ab-legend-pct">60%<\/span>/);
  const trend = html(TrendChart, { series: TREND });
  assert.match(trend, /<text class="ab-point-label"[^>]*>9<\/text>/);
  const heat = html(HeatStrip, { cells: AGE });
  AGE.forEach((c) => assert.match(heat, new RegExp(`<span class="ab-heat-label"[^>]*>${c.label.replace('+', '\\+')}</span><span class="ab-heat-value">${c.value}</span>`)));
  assert.match(heat, /ab-heat-5/);
  assert.match(heat, /ab-heat-1/);
});

test('hostile labels come out as escaped text, never as markup', () => {
  const evil = { key: 'x', label: HOSTILE, value: 3 };
  const markups = [
    html(HorizontalBar, { title: HOSTILE, items: [evil], onDrill: noop }),
    html(HorizontalBar, { title: HOSTILE, items: [evil], defaultTable: true }),
    html(StackedBar, { title: HOSTILE, rows: [{ label: HOSTILE, parts: [{ key: 's', value: 2 }] }], series: [{ key: 's', label: HOSTILE }], onDrill: noop }),
    html(TrendChart, { title: HOSTILE, series: [{ key: 's', label: HOSTILE, points: [{ label: HOSTILE, value: 2 }] }] }),
    html(Donut, { title: HOSTILE, items: [evil], centerLabel: HOSTILE, onDrill: noop }),
    html(Gauge, { title: HOSTILE, label: HOSTILE, value: 5, max: 10 }),
    html(HeatStrip, { title: HOSTILE, cells: [evil], onDrill: noop }),
    html(Tile, { label: HOSTILE, value: HOSTILE, hint: HOSTILE, delta: { text: HOSTILE, direction: 'up' }, onOpen: noop }),
    html(DataTable, { caption: HOSTILE, columns: [{ key: 'a', label: HOSTILE }], rows: [{ a: HOSTILE }] }),
  ];
  for (const markup of markups) {
    assert.ok(!markup.includes('<img'), `a tag got through: ${markup.match(/.{20}<img.{20}/)?.[0]}`);
    assert.ok(!/onerror=1[^&]*>/.test(markup.replace(/&lt;img src=x onerror=1&gt;/g, '')), 'no live attribute');
    assert.ok(markup.includes('&lt;img src=x onerror=1&gt;'), 'the text is there, escaped');
  }
});

test('Tile: unavailable is words, never a zero; loading is a placeholder; a real zero stays a zero', () => {
  const missing = html(Tile, { label: 'Breached', value: 0, unavailable: true });
  assert.match(missing, /Not available to you/);
  assert.ok(!/>0</.test(missing), 'no zero shown');
  assert.match(missing, /ab-tile-missing/);
  assert.ok(!/ab-tile-value/.test(missing));
  const clickable = html(Tile, { label: 'Breached', value: 0, unavailable: true, onOpen: noop });
  assert.ok(!/<button/.test(clickable), 'a tile with nothing to open is not a button');

  const loading = html(Tile, { label: 'Open', loading: true });
  assert.match(loading, /…/);
  assert.match(loading, /Loading/);
  assert.ok(!/>0</.test(loading));

  const zero = html(Tile, { label: 'Breached', value: 0 });
  assert.match(zero, /<span class="ab-tile-value">0<\/span>/);
  assert.match(html(Tile, { label: 'Open', value: 1234567 }), />1,234,567</);
  assert.match(html(Tile, { label: 'Mean', value: '2.5 d' }), />2\.5 d</);
  assert.match(html(Tile, { label: 'Open', value: NaN }), /<span class="ab-tile-value">0<\/span>/);
});

test('Tile: change shown with an arrow and a word, and whether it is better or worse', () => {
  const up = html(Tile, { label: 'Open', value: 12, delta: { text: '3 more than yesterday', direction: 'up', good: false } });
  assert.match(up, /▲/);
  assert.match(up, /Up /);
  assert.match(up, /3 more than yesterday \(worse\)/);
  assert.match(up, /ab-tile-delta-bad/);
  const down = html(Tile, { label: 'Open', value: 9, delta: { text: '3 fewer', direction: 'down', good: true } });
  assert.match(down, /▼/);
  assert.match(down, /\(better\)/);
  const flat = html(Tile, { label: 'Open', value: 9, delta: { text: 'same as yesterday', direction: 'flat', good: null } });
  assert.match(flat, /▬/);
  assert.match(flat, /No change/);
  assert.ok(!/better|worse/.test(flat));
  assert.match(html(Tile, { label: 'Open', value: 9, delta: { text: 'x', direction: 'sideways' } }), /▬/);
  assert.match(html(Tile, { label: 'Open', value: 9, tone: 'bad' }), /ab-tone-bad/);
  assert.match(html(Tile, { label: 'Open', value: 9, tone: '"><script>' }), /ab-tone-neutral/);
});

test('DataTable: header scopes, formatted cells, row buttons, row cap, empty', () => {
  const columns = [{ key: 'name', label: 'Person' }, { key: 'open', label: 'Open', align: 'right', format: (v) => `${v} open` }, { key: 'note', label: 'Note' }];
  const rows = [{ key: 'a', name: 'Alice', open: 4, note: null }, { key: 'b', name: 'Bob', open: 0, note: 'x' }];
  const markup = html(DataTable, { caption: 'Workload', columns, rows });
  assert.match(markup, /<caption>Workload<\/caption>/);
  assert.equal(count(markup, /<th scope="col"/g), 3);
  assert.match(markup, /<th scope="row"[^>]*>Alice<\/th><td[^>]*class="ab-chart-align-right">4 open<\/td><td[^>]*>-<\/td>/);
  assert.ok(!/<button/.test(markup));

  const open = html(DataTable, { columns, rows, onRowOpen: noop });
  assert.equal(count(open, /<button type="button" class="ab-chart-link"/g), 2);

  const many = html(DataTable, { columns, rows: Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, open: i })), maxRows: 10 });
  assert.equal(count(many, /<tr[ >]/g), 11);
  assert.match(many, /Showing the first 10 of 30 rows\./);

  assert.match(html(DataTable, { columns, rows: [], emptyText: 'No rows.' }), /No rows\./);
  assert.match(html(DataTable, { columns: [], rows }), /Nothing to show\./);
  const odd = html(DataTable, { columns: columns.map(({ format, ...c }) => c), rows: [{ name: undefined, open: NaN }, null, 'x'] });
  assert.ok(!/NaN|undefined/.test(odd));
  assert.match(odd, /<th scope="row"[^>]*>-<\/th><td[^>]*class="ab-chart-align-right">-<\/td>/);
});

test('ChartFrame: image by default, group when interactive, table on request, empty text', () => {
  const picture = h('span', null, 'pic');
  const plain = html(ChartFrame, { title: 'T', summary: 'Summary 1, 2', children: picture });
  assert.match(plain, /<div class="ab-chart-visual" role="img" aria-label="Summary 1, 2"><span>pic<\/span><\/div>/);
  assert.ok(!/ab-chart-toggle/.test(plain), 'no table given, no toggle');
  assert.match(html(ChartFrame, { title: 'T', summary: 'S', interactive: true, children: picture }), /role="group" aria-label="S"/);
  const withTable = html(ChartFrame, { title: 'T', summary: 'S', children: picture, table: { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] } });
  assert.match(withTable, /aria-pressed="false">Show as table</);
  const shown = html(ChartFrame, { title: 'T', summary: 'S', children: picture, defaultTable: true, table: { caption: 'Cap', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] } });
  assert.match(shown, /<caption>Cap<\/caption>/);
  assert.ok(!shown.includes('pic'));
  assert.match(html(ChartFrame, { title: 'T', empty: true, emptyText: 'Empty!', children: picture }), /Empty!/);
  assert.match(html(ChartFrame, { children: picture }), /aria-label="Chart"/);
  const legend = html(ChartFrame, { title: 'T', summary: 'S', children: picture, legend: h('ul', { className: 'ab-legend' }) });
  assert.ok(legend.indexOf('</div><ul class="ab-legend">') > legend.indexOf('pic'), 'the legend sits outside the image');
});

test('long and many labels do not break the layout data', () => {
  const long = 'Service Desk - Tier 2 Hardware and Peripherals Support for the Northern European Region '.repeat(3);
  const markup = html(HorizontalBar, { title: 'Groups', items: Array.from({ length: 40 }, (_, i) => ({ key: `g${i}`, label: `${long}${i}`, value: 40 - i })), maxItems: 8 });
  assert.equal(count(markup, /<li>/g), 8);
  assert.match(markup, /and 32 more/);
  assert.ok(markup.includes('…'), 'long labels are clipped in the picture');
  assert.ok(markup.includes(`title="${long.replace(/\s+$/, '')}`.slice(0, 40)), 'the full text stays in the title');
  const donut = html(Donut, { items: Array.from({ length: 12 }, (_, i) => ({ key: `d${i}`, label: `Slice ${i}`, value: i + 1 })) });
  assert.equal(count(donut, /<pattern /g), 12);
  assert.ok(!/NaN/.test(donut));
});
