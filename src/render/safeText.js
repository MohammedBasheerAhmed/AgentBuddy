// Safe text: turns UNTRUSTED model output into plain data blocks.
//
// The result is data only (type, text, nesting); nothing here builds markup. The UI renders the blocks with ordinary
// React elements, so the browser never parses anything the model wrote. Rules that matter for safety:
//   - images are never rendered: `![alt](url)` becomes the visible text "[image removed: alt]" and the url is dropped
//   - links never become links: `[text](url)` becomes the text followed by the url shown as plain text (type 'url')
//   - raw HTML is just text (React escapes it on output)
//   - control, bidi-override and zero-width characters are removed before parsing, so text cannot hide or reorder
//   - total length and nesting are capped, and every scan is linear (no regex with nested quantifiers)
//
// Block   = { type: 'paragraph', inlines } | { type: 'heading', level: 1|2|3, inlines }
//         | { type: 'list', ordered, start, items: [{ checked: null|bool, inlines, children: Block[] }] }
//         | { type: 'quote', blocks } | { type: 'code', lang, text } | { type: 'rule' }
// Inline  = { type: 'text'|'bold'|'italic'|'code'|'url', text }   (text may contain "\n" for a line break)

import { invisibleChars } from '../lib/invisible.js';

export const DEFAULT_MAX_CHARS = 60000;
export const DEFAULT_MAX_DEPTH = 4;
const HARD_MAX_CHARS = 1000000;
const HARD_MAX_DEPTH = 8;
const MAX_URL = 2048; // longest url shown; longer ones stay plain text
const MAX_LABEL = 400;
const MAX_ALT = 120;
const MAX_TITLE = 300; // link titles are read (to match the syntax) but never shown
const TRUNCATED_NOTICE = '[Output truncated: it was too long to display in full.]';

// ---- Cleaning ------------------------------------------------------------------------------------------------------

// Characters that change how text reads without showing (controls, zero-width and direction marks, fillers, tag characters):
// the one list the PII firewall uses too (src/lib/invisible.js). The emoji variation selectors FE0E/FE0F stay here (they only
// pick how an emoji is drawn), and so does a zero-width joiner between two emoji (see joinsEmoji).
// Written as numbers so this file stays plain ASCII (no hidden characters in the source itself).
const hex4 = (n) => `\\u${n.toString(16).padStart(4, '0')}`;
const charClass = (items) => `[${items.map((x) => (Array.isArray(x) ? `${hex4(x[0])}-${hex4(x[1])}` : hex4(x))).join('')}]`;
const INVISIBLE = invisibleChars({ keep: [0xfe0e, 0xfe0f] });
const ODD_SPACES = new RegExp(charClass([0xa0, 0x1680, [0x2000, 0x200a], 0x202f, 0x205f, 0x3000]), 'g');
const LINE_BREAKS = new RegExp(`\\r\\n?|${charClass([0x85, 0x2028, 0x2029])}`, 'g');
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const ZWJ = String.fromCharCode(0x200d);
const REPLACEMENT = String.fromCharCode(0xfffd);
const ELLIPSIS = String.fromCharCode(0x2026);

function codePointBefore(s, end) {
  const lo = s.charCodeAt(end - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && end >= 2) {
    const hi = s.charCodeAt(end - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(end - 2, end);
  }
  return s.slice(end - 1, end);
}

function codePointAt(s, at) {
  const hi = s.charCodeAt(at);
  if (hi >= 0xd800 && hi <= 0xdbff) {
    const lo = s.charCodeAt(at + 1);
    if (lo >= 0xdc00 && lo <= 0xdfff) return s.slice(at, at + 2);
  }
  return s.slice(at, at + 1);
}

// A zero-width joiner is kept only when it glues two emoji together (family, profession sequences).
function joinsEmoji(s, at) {
  let before = at;
  if (s.charCodeAt(before - 1) === 0xfe0f) before--;
  if (before <= 0 || at + 1 >= s.length) return false;
  return PICTOGRAPH.test(codePointBefore(s, before)) && PICTOGRAPH.test(codePointAt(s, at + 1));
}

/** Removes hidden and direction-changing characters, normalises line breaks and odd spaces. Keeps tab and newline. */
export function stripUnsafeChars(input) {
  let s = typeof input === 'string' ? input : input == null ? '' : safeString(input);
  s = s.replace(LINE_BREAKS, '\n').replace(ODD_SPACES, ' ');
  s = s.replace(INVISIBLE, (m, at, whole) => (m === ZWJ && joinsEmoji(whole, at) ? m : ''));
  return s.replace(LONE_SURROGATE, REPLACEMENT);
}

function safeString(value) {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Caps the length first (so a huge input costs nothing), then cleans. Returns { text, truncated }. */
export function cleanText(input, maxChars = DEFAULT_MAX_CHARS) {
  let s = typeof input === 'string' ? input : input == null ? '' : safeString(input);
  let truncated = false;
  if (s.length > maxChars) {
    s = s.slice(0, maxChars);
    truncated = true;
  }
  return { text: stripUnsafeChars(s), truncated };
}

// ---- Inline parsing ------------------------------------------------------------------------------------------------

const isSpaceCode = (c) => c === 32 || c === 10 || c === 9;
const isDigitCode = (c) => c >= 48 && c <= 57;
const isAlnumCode = (c) => isDigitCode(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// Characters that end a url written without brackets: whitespace, quotes, angle and square brackets, braces, pipe,
// backslash, caret, backtick and the emphasis star.
function isUrlStop(c) {
  return c <= 32 || c === 34 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 124 || c === 92 || c === 94 || c === 96 || c === 42;
}

// For every "[" the position of its matching "]" (brackets nest), or -1. One pass over the paragraph, computed on
// first use, so asking about each "[" is O(1) however many unmatched ones there are.
function matchBrackets(s) {
  const match = new Int32Array(s.length).fill(-1);
  const open = [];
  for (let q = 0; q < s.length; q++) {
    const c = s.charCodeAt(q);
    if (c === 91) open.push(q);
    else if (c === 93 && open.length) match[open.pop()] = q;
  }
  return match;
}

// Backtick runs of the paragraph, with the next run of the same length for each one.
function indexBacktickRuns(s) {
  const pos = [];
  const len = [];
  for (let p = 0; p < s.length; ) {
    if (s.charCodeAt(p) === 96) {
      let q = p + 1;
      while (s.charCodeAt(q) === 96) q++;
      pos.push(p);
      len.push(q - p);
      p = q;
    } else p++;
  }
  const nextSame = new Array(pos.length).fill(-1);
  const seen = new Map();
  for (let r = pos.length - 1; r >= 0; r--) {
    if (seen.has(len[r])) nextSame[r] = seen.get(len[r]);
    seen.set(len[r], pos[r]);
  }
  return { byPos: new Map(pos.map((p, r) => [p, r])), nextSame };
}

const BARE_URL = /https?:\/\//iy;
const TRAILING_PUNCT = new Set([46, 44, 59, 58, 33, 63, 39, 34]); // . , ; : ! ? ' "

// End index of a bare http(s) url starting at i, or -1.
function bareUrlEnd(s, i) {
  BARE_URL.lastIndex = i;
  if (!BARE_URL.test(s)) return -1;
  const start = BARE_URL.lastIndex;
  const cap = Math.min(s.length, i + MAX_URL);
  let k = start;
  let open = 0;
  let close = 0;
  while (k < cap && !isUrlStop(s.charCodeAt(k))) {
    const c = s.charCodeAt(k);
    if (c === 40) open++;
    else if (c === 41) close++;
    k++;
  }
  // Sentence punctuation and an unmatched closing parenthesis are not part of the address.
  while (k > start) {
    const c = s.charCodeAt(k - 1);
    if (TRAILING_PUNCT.has(c)) k--;
    else if (c === 41 && close > open) {
      close--;
      k--;
    } else break;
  }
  return k > start ? k : -1;
}

const skipSpaces = (s, k, max) => {
  let steps = 0;
  while (k < s.length && isSpaceCode(s.charCodeAt(k)) && steps++ < max) k++;
  return k;
};

// The "(destination "title")" part of a markdown link, starting just after the opening parenthesis.
// Returns { url, end } (end is past the closing parenthesis) or null. Every scan is bounded.
function scanDestination(s, p) {
  let k = skipSpaces(s, p, 32);
  let url = '';
  if (s.charCodeAt(k) === 60) {
    const start = k + 1;
    let e = start;
    // Spaces are allowed inside angle brackets, line breaks are not.
    while (e < s.length && e - start <= MAX_URL && s.charCodeAt(e) !== 62 && s.charCodeAt(e) !== 60 && s.charCodeAt(e) !== 10) e++;
    if (s.charCodeAt(e) !== 62) return null;
    url = s.slice(start, e);
    k = e + 1;
  } else {
    const start = k;
    let depth = 0;
    while (k < s.length && k - start <= MAX_URL) {
      const c = s.charCodeAt(k);
      if (c === 40) depth++;
      else if (c === 41) {
        if (depth === 0) break;
        depth--;
      } else if (c <= 32 || c === 34 || c === 60 || c === 62 || c === 91 || c === 93 || c === 96) break;
      k++;
    }
    if (k - start > MAX_URL) return null;
    url = s.slice(start, k);
  }
  k = skipSpaces(s, k, 32);
  const quote = s.charCodeAt(k);
  if (quote === 34 || quote === 39) {
    const limit = Math.min(s.length, k + 1 + MAX_TITLE);
    let e = k + 1;
    while (e < limit && s.charCodeAt(e) !== quote) e++;
    if (e >= limit) return null;
    k = skipSpaces(s, e + 1, 32);
  }
  if (s.charCodeAt(k) !== 41) return null;
  return { url, end: k + 1 };
}

// Link text and image alt text as one tidy line: no markers, no line breaks, capped.
function tidyLabel(raw, max) {
  let t = raw.replace(/[`*\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (t.length > max) t = `${t.slice(0, max)}${ELLIPSIS}`;
  return t;
}

function pushToken(tokens, k, v) {
  if (v) tokens.push({ k, v });
}

/** Parses one paragraph's text into flat inlines. Bold wins over italic when both are active. */
function parseInlines(s) {
  if (!s) return [];
  if (!/[`*[]|https?:\/\//i.test(s)) return [{ type: 'text', text: s }];

  const len = s.length;
  const tokens = [];
  let i = 0;
  let mark = 0; // start of the plain text not yet pushed
  const flush = (end) => {
    if (end > mark) tokens.push({ k: 't', v: s.slice(mark, end) });
  };
  let brackets = null;
  let runs = null;

  while (i < len) {
    const c = s.charCodeAt(i);

    if (c === 96) {
      // Code span: closes at the next run of exactly the same number of backticks; its content is not parsed.
      let n = 1;
      while (s.charCodeAt(i + n) === 96) n++;
      runs = runs || indexBacktickRuns(s);
      const r = runs.byPos.get(i);
      const at = r === undefined ? -1 : runs.nextSame[r];
      if (at < 0) {
        i += n;
        continue;
      }
      let code = s.slice(i + n, at).replace(/\n/g, ' ');
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim() !== '') code = code.slice(1, -1);
      flush(i);
      pushToken(tokens, 'c', code);
      i = at + n;
      mark = i;
    } else if (c === 42) {
      // Emphasis markers are paired afterwards; one that finds no partner stays literal text.
      let n = 1;
      while (s.charCodeAt(i + n) === 42) n++;
      if (n > 3) {
        i += n;
        continue;
      }
      flush(i);
      const canOpen = i + n < len && !isSpaceCode(s.charCodeAt(i + n));
      const canClose = i > 0 && !isSpaceCode(s.charCodeAt(i - 1));
      if (n >= 2) tokens.push({ k: 'b', canOpen, canClose, lit: '**', role: '' });
      if (n === 1 || n === 3) tokens.push({ k: 'i', canOpen, canClose, lit: '*', role: '' });
      i += n;
      mark = i;
    } else if (c === 91 || (c === 33 && s.charCodeAt(i + 1) === 91)) {
      // [text](url) and ![alt](url); the brackets of the text may nest.
      const image = c === 33;
      const open = image ? i + 1 : i;
      let match = null;
      brackets = brackets || matchBrackets(s);
      const cb = brackets[open];
      if (cb >= 0 && s.charCodeAt(cb + 1) === 40) {
        const dest = scanDestination(s, cb + 2);
        if (dest) match = { end: dest.end, url: dest.url, label: s.slice(open + 1, cb) };
      }
      if (!match) {
        i = open + 1;
        continue;
      }
      flush(i);
      if (image) {
        const alt = tidyLabel(match.label.replace(/[[\]]/g, ' '), MAX_ALT);
        pushToken(tokens, 't', `[image removed${alt ? `: ${alt}` : ''}]`);
      } else {
        const label = tidyLabel(match.label, MAX_LABEL);
        const url = match.url;
        if (!url) pushToken(tokens, 't', label);
        else if (!label || label === url) pushToken(tokens, 'u', url);
        else {
          pushToken(tokens, 't', label);
          pushToken(tokens, 't', ' (');
          pushToken(tokens, 'u', url);
          pushToken(tokens, 't', ')');
        }
      }
      i = match.end;
      mark = i;
    } else if ((c === 104 || c === 72) && (i === 0 || !isAlnumCode(s.charCodeAt(i - 1)))) {
      const end = bareUrlEnd(s, i);
      if (end < 0) {
        i++;
        continue;
      }
      flush(i);
      pushToken(tokens, 'u', s.slice(i, end));
      i = end;
      mark = i;
    } else {
      i++;
    }
  }
  flush(len);

  pairMarkers(tokens, 'b');
  pairMarkers(tokens, 'i');
  return emitInlines(tokens);
}

// Marks which emphasis markers of one kind open and close a span. A marker opens only if a later marker of the same
// kind can close it, so nothing stays open; one backward pass finds the closers, one forward pass pairs them.
function pairMarkers(tokens, kind) {
  const n = tokens.length;
  const closerAfter = new Int32Array(n);
  let nearest = -1;
  for (let idx = n - 1; idx >= 0; idx--) {
    closerAfter[idx] = nearest;
    if (tokens[idx].k === kind && tokens[idx].canClose) nearest = idx;
  }
  for (let idx = 0; idx < n; idx++) {
    const t = tokens[idx];
    if (t.k !== kind || !t.canOpen) continue;
    const closer = closerAfter[idx];
    if (closer < 0) continue;
    t.role = 'open';
    tokens[closer].role = 'close';
    idx = closer; // markers in between stay literal
  }
}

function emitInlines(tokens) {
  const out = [];
  let bold = false;
  let italic = false;
  const textType = () => (bold ? 'bold' : italic ? 'italic' : 'text');
  const push = (type, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type && (type === 'text' || type === 'bold' || type === 'italic')) last.text += text;
    else out.push({ type, text });
  };
  for (const t of tokens) {
    if (t.k === 'b' || t.k === 'i') {
      if (t.role === 'open' || t.role === 'close') {
        if (t.k === 'b') bold = t.role === 'open';
        else italic = t.role === 'open';
      } else push(textType(), t.lit);
    } else if (t.k === 't') push(textType(), t.v);
    else if (t.k === 'c') push('code', t.v);
    else if (t.k === 'u') push('url', t.v);
  }
  return out;
}

// ---- Block parsing -------------------------------------------------------------------------------------------------

function indentInfo(line) {
  let cols = 0;
  let k = 0;
  for (; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c === 32) cols++;
    else if (c === 9) cols += 4;
    else break;
  }
  return { cols, rest: k ? line.slice(k) : line };
}

// Removes up to `cols` columns of leading whitespace.
function dedent(line, cols) {
  let k = 0;
  let used = 0;
  while (k < line.length && used < cols) {
    const c = line.charCodeAt(k);
    if (c === 32) used++;
    else if (c === 9) used += 4;
    else break;
    k++;
  }
  return k ? line.slice(k) : line;
}

const isBlank = (line) => indentInfo(line).rest === '';

function matchFence(rest) {
  const ch = rest.charCodeAt(0);
  if (ch !== 96 && ch !== 126) return null;
  let n = 0;
  while (rest.charCodeAt(n) === ch) n++;
  if (n < 3) return null;
  const info = rest.slice(n).trim();
  if (ch === 96 && info.indexOf('`') >= 0) return null; // that is inline code, not a fence
  const word = info.split(/\s/, 1)[0];
  return { ch, len: n, lang: /^[A-Za-z0-9_+#.-]{1,24}$/.test(word) ? word : '' };
}

function isFenceClose(line, ch, len) {
  const { cols, rest } = indentInfo(line);
  if (cols >= 4) return false;
  let k = 0;
  while (rest.charCodeAt(k) === ch) k++;
  return k >= len && rest.slice(k).trim() === '';
}

function matchHeading(rest) {
  let h = 0;
  while (rest.charCodeAt(h) === 35) h++;
  if (h < 1 || h > 6) return null;
  if (h < rest.length && rest.charCodeAt(h) !== 32 && rest.charCodeAt(h) !== 9) return null;
  let text = rest.slice(h).trim();
  let e = text.length;
  while (e > 0 && text.charCodeAt(e - 1) === 35) e--; // optional closing hashes
  if (e < text.length && (e === 0 || text.charCodeAt(e - 1) === 32)) text = text.slice(0, e).trim();
  return { level: Math.min(h, 3), text };
}

function isRule(rest) {
  const ch = rest.charCodeAt(0);
  if (ch !== 45 && ch !== 42 && ch !== 95) return false;
  let count = 0;
  for (let k = 0; k < rest.length; k++) {
    const c = rest.charCodeAt(k);
    if (c === ch) count++;
    else if (c !== 32 && c !== 9) return false;
  }
  return count >= 3;
}

// A list item marker: -, *, + or 1. / 1) followed by a space. width = columns taken by marker and spaces.
function matchItem(rest) {
  if (isRule(rest)) return null;
  const c = rest.charCodeAt(0);
  let k;
  let ordered = false;
  let number = 1;
  if (c === 45 || c === 42 || c === 43) k = 1;
  else if (isDigitCode(c)) {
    k = 1;
    while (isDigitCode(rest.charCodeAt(k))) k++;
    if (k > 9) return null;
    const d = rest.charCodeAt(k);
    if (d !== 46 && d !== 41) return null;
    ordered = true;
    number = Number(rest.slice(0, k));
    k++;
  } else return null;
  const sp = rest.charCodeAt(k);
  if (sp !== 32 && sp !== 9) return null;
  let m = k;
  while (rest.charCodeAt(m) === 32 || rest.charCodeAt(m) === 9) m++;
  const spaces = m - k;
  const wide = spaces > 4 || m >= rest.length;
  return { ordered, number, width: k + (wide ? 1 : spaces), content: wide ? rest.slice(k + 1) : rest.slice(m) };
}

// Does this (unindented) line start something other than paragraph text?
function startsBlock(rest) {
  const c = rest.charCodeAt(0);
  return c === 62 || (c === 35 && matchHeading(rest) !== null) || matchFence(rest) !== null || isRule(rest) || matchItem(rest) !== null;
}

const TASK_MARK = /^\[([ xX])\](?:[ \t]+|$)/;

// Splits an item's lines into its own text and its nested blocks.
function buildItem(bodyLines, depth, ctx) {
  let checked = null;
  const m = TASK_MARK.exec(bodyLines[0]);
  if (m) {
    checked = m[1] !== ' ';
    bodyLines[0] = bodyLines[0].slice(m[0].length);
  }
  const blocks = parseBlocks(bodyLines, depth + 1, ctx);
  if (blocks.length && blocks[0].type === 'paragraph') return { checked, inlines: blocks[0].inlines, children: blocks.slice(1) };
  return { checked, inlines: [], children: blocks };
}

// A list starting at lines[start]. Items are siblings when their marker is at (about) the same indent and of the same
// kind; anything indented two or more columns further belongs to the item above (nested lists, code, more text).
function parseList(lines, start, depth, ctx) {
  const n = lines.length;
  const first = indentInfo(lines[start]);
  const base = first.cols;
  const head = matchItem(first.rest);
  const ordered = head.ordered;
  const sibling = (info) => {
    if (info.cols >= base + 2) return null;
    const it = matchItem(info.rest);
    return it && it.ordered === ordered ? it : null;
  };
  const items = [];
  let i = start;
  while (i < n) {
    const info = indentInfo(lines[i]);
    const it = i === start ? head : sibling(info);
    if (!it) break;
    const offset = info.cols + it.width;
    const body = [it.content];
    let j = i + 1;
    while (j < n) {
      const line = lines[j];
      const li = indentInfo(line);
      if (li.rest === '') {
        // Blank lines belong to the list only if more of it follows.
        let m = j + 1;
        while (m < n && isBlank(lines[m])) m++;
        if (m >= n) break;
        const nx = indentInfo(lines[m]);
        if (!(nx.cols >= base + 2 || sibling(nx))) break;
        for (let b = j; b < m; b++) body.push('');
        j = m;
        continue;
      }
      if (li.cols >= base + 2) {
        body.push(dedent(line, offset));
        j++;
        continue;
      }
      // Not indented: the next item, another kind of block, or a lazy continuation of the paragraph above.
      if (startsBlock(li.rest) || body[body.length - 1] === '') break;
      body.push(li.rest.trim());
      j++;
    }
    items.push(buildItem(body, depth, ctx));
    i = j;
  }
  return { block: { type: 'list', ordered, start: ordered ? head.number : 1, items }, next: i };
}

function parseBlocks(lines, depth, ctx) {
  const out = [];
  const n = lines.length;
  const canNest = depth < ctx.maxDepth;
  let para = [];
  const endPara = () => {
    if (!para.length) return;
    const inlines = parseInlines(para.join('\n'));
    if (inlines.length) out.push({ type: 'paragraph', inlines });
    para = [];
  };

  let i = 0;
  while (i < n) {
    const { cols, rest } = indentInfo(lines[i]);
    if (rest === '') {
      endPara();
      i++;
      continue;
    }
    if (cols < 4) {
      const fence = matchFence(rest);
      if (fence) {
        endPara();
        const text = [];
        let j = i + 1;
        while (j < n && !isFenceClose(lines[j], fence.ch, fence.len)) {
          text.push(dedent(lines[j], cols));
          j++;
        }
        out.push({ type: 'code', lang: fence.lang, text: text.join('\n') });
        i = j < n ? j + 1 : n; // an unterminated fence runs to the end
        continue;
      }
      const heading = matchHeading(rest);
      if (heading) {
        endPara();
        const inlines = parseInlines(heading.text);
        if (inlines.length) out.push({ type: 'heading', level: heading.level, inlines });
        i++;
        continue;
      }
      if (isRule(rest)) {
        endPara();
        out.push({ type: 'rule' });
        i++;
        continue;
      }
      if (canNest && rest.charCodeAt(0) === 62) {
        endPara();
        const inner = [];
        let j = i;
        while (j < n) {
          const li = indentInfo(lines[j]);
          if (li.cols >= 4 || li.rest.charCodeAt(0) !== 62) break;
          const t = li.rest.slice(1);
          inner.push(t.charCodeAt(0) === 32 ? t.slice(1) : t);
          j++;
        }
        const blocks = parseBlocks(inner, depth + 1, ctx);
        if (blocks.length) out.push({ type: 'quote', blocks });
        i = j;
        continue;
      }
      if (canNest) {
        const item = matchItem(rest);
        // Like markdown, a numbered item only interrupts a paragraph when it starts at 1.
        if (item && !(para.length && item.ordered && item.number !== 1)) {
          endPara();
          const { block, next } = parseList(lines, i, depth, ctx);
          out.push(block);
          i = next;
          continue;
        }
      }
    }
    para.push(rest.trim());
    i++;
  }
  endPara();
  return out;
}

/**
 * Model output (untrusted) to blocks. Never throws and never returns markup.
 * options: maxChars (default 60000, hard limit 1,000,000), maxDepth (nesting of lists and quotes, default 4).
 */
export function parseSafeText(text, options = {}) {
  const maxChars = clampInt(options && options.maxChars, DEFAULT_MAX_CHARS, 0, HARD_MAX_CHARS);
  const maxDepth = clampInt(options && options.maxDepth, DEFAULT_MAX_DEPTH, 0, HARD_MAX_DEPTH);
  const { text: clean, truncated } = cleanText(text, maxChars);
  let blocks;
  try {
    blocks = parseBlocks(clean.split('\n'), 0, { maxDepth });
  } catch {
    // Should not happen; fall back to the cleaned text as plain paragraphs rather than showing nothing or throwing.
    blocks = clean
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => ({ type: 'paragraph', inlines: [{ type: 'text', text: p.trim() }] }));
  }
  if (truncated) blocks.push({ type: 'paragraph', truncated: true, inlines: [{ type: 'text', text: TRUNCATED_NOTICE }] });
  return blocks;
}

// ---- Plain text (Copy button) --------------------------------------------------------------------------------------

const inlinesToText = (inlines) => (Array.isArray(inlines) ? inlines.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('') : '');

const indentLines = (text, pad) => text.split('\n').map((l) => (l ? pad + l : l)).join('\n');

function blockToText(block, depth) {
  if (!block || typeof block !== 'object' || depth > 24 || block.truncated) return '';
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlinesToText(block.inlines);
    case 'code':
      return typeof block.text === 'string' ? block.text : '';
    case 'quote':
      return blocksToText(block.blocks, depth + 1);
    case 'list': {
      const lines = [];
      const start = Number.isFinite(block.start) ? block.start : 1;
      (Array.isArray(block.items) ? block.items : []).forEach((item, idx) => {
        if (!item || typeof item !== 'object') return;
        const marker = block.ordered ? `${start + idx}.` : '-';
        const box = item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : '';
        lines.push(`${marker} ${box}${inlinesToText(item.inlines)}`.trimEnd());
        const pad = ' '.repeat(marker.length + 1);
        for (const child of Array.isArray(item.children) ? item.children : []) {
          const t = blockToText(child, depth + 1);
          if (t) lines.push(indentLines(t, pad));
        }
      });
      return lines.join('\n');
    }
    default:
      return '';
  }
}

function blocksToText(blocks, depth) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((b) => blockToText(b, depth))
    .filter((t) => t !== '')
    .join('\n\n');
}

/** Blocks (or raw text, which is parsed first) to clean text for the clipboard: no markdown noise except list markers. */
export function toPlainText(blocks) {
  const list = typeof blocks === 'string' ? parseSafeText(blocks) : blocks;
  return blocksToText(list, 0).trim();
}
