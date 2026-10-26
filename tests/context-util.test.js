import test from 'node:test';
import assert from 'node:assert/strict';
import { clipText, cleanText, decodeEntities, disp, mapLimit, oneLine, parseSnTime, queryValue, raw, stripHtml } from '../src/context/util.js';

test('raw and disp read both the display_value=all shape and plain strings', () => {
  assert.equal(raw({ value: '2', display_value: 'In Progress' }), '2');
  assert.equal(disp({ value: '2', display_value: 'In Progress' }), 'In Progress');
  assert.equal(disp({ value: 'x', display_value: '' }), 'x');
  assert.equal(raw('plain'), 'plain');
  assert.equal(disp(null), '');
  assert.equal(raw(undefined), '');
});

test('stripHtml keeps line breaks, drops tags, scripts and the [code] wrapper', () => {
  assert.equal(stripHtml('<p>Hello <b>Abel</b></p><p>Second&nbsp;paragraph</p>'), 'Hello Abel\n\nSecond paragraph');
  assert.equal(stripHtml('line one<br>line two<br/>line three'), 'line one\nline two\nline three');
  assert.equal(stripHtml('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
  assert.equal(stripHtml('[code]<p>rich text</p>[/code]'), 'rich text');
  assert.equal(stripHtml('a<script>alert(1)</script>b<style>p{}</style>c'), 'abc');
  assert.equal(stripHtml('<!-- hidden -->visible'), 'visible');
  assert.equal(stripHtml('<div>a</div><div>b</div>'), 'a\nb');
});

test('stripHtml decodes entities once and leaves plain text alone', () => {
  assert.equal(stripHtml('Tom &amp; Jerry &lt;3 &quot;quotes&quot; it&#39;s &#x41;'), 'Tom & Jerry <3 "quotes" it\'s A');
  assert.equal(decodeEntities('&unknownentity; &amp;amp;'), '&unknownentity; &amp;');
  assert.equal(stripHtml('if a < b and c > d'), 'if a < b and c > d');
  assert.equal(stripHtml('no markup\r\nsecond line\n\n\n\nthird'), 'no markup\nsecond line\n\nthird');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('stripHtml removes zero-width characters that defeat name matching', () => {
  const zw = String.fromCharCode(0x200b);
  assert.equal(stripHtml(`Ab${zw}el`), 'Abel');
});

test('clipText cuts with an ellipsis and keeps short text whole', () => {
  assert.equal(clipText('abcdef', 10), 'abcdef');
  assert.equal(clipText('abcdefghij', 5), 'abcd…');
  assert.equal(clipText('abcdefghij', 5).length, 5);
});

test('cleanText never lets a bare sys_id through', () => {
  assert.equal(cleanText('46d44a23a9fe19810012d100cca80666', 100), '');
  assert.equal(cleanText('<p>VPN down</p>', 100), 'VPN down');
  assert.equal(oneLine('  a \n b  ', 20), 'a b');
});

test('parseSnTime reads the stored UTC format', () => {
  assert.equal(parseSnTime('2026-10-26 12:00:00'), Date.UTC(2026, 9, 26, 12, 0, 0));
  assert.equal(parseSnTime('2026-10-26'), Date.UTC(2026, 9, 26));
  assert.ok(Number.isNaN(parseSnTime('26/10/2026')));
  assert.ok(Number.isNaN(parseSnTime('')));
});

test('queryValue refuses what would end a condition', () => {
  assert.equal(queryValue('Email Server'), 'Email Server');
  assert.equal(queryValue('a^b'), '');
  assert.equal(queryValue('a\nb'), '');
  assert.equal(queryValue(null), '');
});

test('mapLimit keeps the order and never runs more than max at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2);
});
