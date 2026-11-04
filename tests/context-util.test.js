import test from 'node:test';
import assert from 'node:assert/strict';
import { clipText, cleanText, decodeEntities, disp, journalText, looksLikeHtml, mapLimit, oneLine, parseSnTime, plainText, queryValue, raw, stripHtml } from '../src/context/util.js';
import { cpuTime } from './fixtures/timing.js';

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

// Audit P3.27: HTML is stripped only where the value is HTML. Plain text with angle brackets keeps every word.
test('plain text keeps its angle brackets and ampersands: cleanText and oneLine strip HTML only where there is markup', () => {
  for (const plain of ['List<String> is empty', 'if a<b and c>d then', 'Map<String, List<Integer>> fails', '<error><detail>500</detail></error>', 'I <3 the new laptop', 'R&amp;D asked for <this>']) {
    assert.equal(cleanText(plain, 200), plain, plain);
    assert.equal(oneLine(plain, 200), plain, plain);
    assert.equal(looksLikeHtml(plain), false, plain);
  }
  assert.equal(cleanText('line one\r\nline two\n\n\n\nthree  \nfour', 200), 'line one\nline two\n\nthree\nfour', 'line ends are still evened out');
  assert.equal(oneLine(`Ab${String.fromCharCode(0x200b)}el <Tuter>`, 50), 'Abel <Tuter>', 'zero-width characters still go');
  assert.equal(plainText('  <p>kept</p> \r\n'), '<p>kept</p>');
});

test('a long run of spaces is tidied in linear time (it held the page for minutes)', () => {
  const spaces = `x${' '.repeat(200000)}y\n${'\t '.repeat(50000)}\nz`;
  const started = process.cpuUsage();
  assert.equal(plainText(spaces), `x${' '.repeat(200000)}y\n\nz`);
  assert.equal(stripHtml(spaces), `x${' '.repeat(200000)}y\n\nz`);
  assert.equal(cleanText(spaces, 10), 'x…');
  const { user, system } = process.cpuUsage(started);
  assert.ok((user + system) / 1000 < 2000, `${(user + system) / 1000} ms of CPU`);
});

test('journalText: a plain note keeps what was written and has its entities decoded; a [code] or rich-text note is stripped', () => {
  assert.equal(journalText('Cannot map List<String> to <Project X>; a<b and c>d'), 'Cannot map List<String> to <Project X>; a<b and c>d');
  assert.equal(journalText("resets.&nbsp;Manager is O&#39;Neil, R&amp;D"), "resets. Manager is O'Neil, R&D");
  assert.equal(journalText('[code]<p>Rich <b>text</b></p><script>x()</script>[/code]'), 'Rich text');
  assert.equal(journalText('  line one  \r\n\r\n\r\nline two '), 'line one\n\nline two');
});

test('stripping HTML stays linear on hostile markup: unclosed tags, blocks and comments', () => {
  // Each took seconds before: a tag pattern scanned to the end of the text again for every "<a " with no ">", and a lazy block or
  // comment pattern did the same for every unclosed "<script>" or "<!--".
  const hostile = ['<a '.repeat(70000), '<script>'.repeat(30000), '<style x>'.repeat(30000), '<!--'.repeat(50000), `${'<script></scriptx'.repeat(15000)}`];
  for (const input of hostile) {
    const { ms } = cpuTime(() => stripHtml(input), 1000);
    assert.ok(ms < 1000, `${input.slice(0, 12)}...: ${Math.round(ms)} ms of CPU`);
  }
  // ...and the same answers where it matters: a closed block goes with its content, an unclosed one leaves its text.
  assert.equal(stripHtml('a<script>x</script >b<STYLE>y</style>c'), 'abc');
  assert.equal(stripHtml('a<script>x'), 'ax');
  assert.equal(stripHtml('a<!-- c -->b<!-- open'), 'ab<!-- open');
  assert.equal(stripHtml('a<script>x</scriptx>y</script>z'), 'az');
  // An unescaped "<" inside an attribute (ServiceNow escapes it) leaves the start of that tag as text: shown as plain text, never as
  // markup (the panel renders no HTML and the AI gets data only).
  assert.equal(stripHtml('<div class="a<b">kept</div>'), '<div class="akept');
});

test('HTML is still stripped where there is markup, script and style blocks with it', () => {
  assert.equal(cleanText('<p>Hello <b>Abel</b></p><p>List&lt;String&gt; &amp; more</p>', 200), 'Hello Abel\n\nList<String> & more');
  assert.equal(cleanText('Look<script>alert(1)</script> here<style>p{}</style><br>next', 200), 'Look here\nnext');
  assert.equal(cleanText('[code]<p>rich text</p>[/code]', 200), 'rich text');
  assert.equal(cleanText('<!-- hidden -->visible', 200), 'visible');
  assert.equal(oneLine('<span>Abel</span> <b>Tuter</b>', 50), 'Abel Tuter');
  for (const html of ['<p>x</p>', 'a<br>b', 'a<br/>b', '<!-- c -->', '[code]x[/code]', '<div class="x">y</div>', 'x</SCRIPT>', 'Service Desk <b>', '<img src=x onerror=alert(1)>']) assert.equal(looksLikeHtml(html), true, html);
  // a tag from the instance is still taken out of a one-line name (the answer from the page is untrusted)
  assert.equal(oneLine('Service Desk <b>', 50), 'Service Desk');
  assert.equal(oneLine('<img src=x onerror=alert(1)>VPN', 50), 'VPN');
  // the caller decides when it knows: an HTML column is HTML even with entities only, plain text stays as written
  assert.equal(cleanText('Tom &amp; Jerry', 100, { html: true }), 'Tom & Jerry');
  assert.equal(cleanText('Tom &amp; Jerry', 100), 'Tom &amp; Jerry');
  assert.equal(cleanText('<p>kept as typed</p>', 100, { html: false }), '<p>kept as typed</p>');
  assert.equal(oneLine('<p>kept as typed</p>', 100, { html: false }), '<p>kept as typed</p>');
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
