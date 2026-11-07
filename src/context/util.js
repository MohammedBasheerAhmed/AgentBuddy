// Small helpers shared by src/context: the shapes the Table API returns, text clean-up, ServiceNow times, a bounded
// parallel map. Pure: no DOM, no network.

// ---- Identifiers ---------------------------------------------------------------------------------
// The one set of checks for what crosses from the panel to the page and into a query or an address (everything that validates a
// sys_id, a table or a column name imports these; src/page/bridge.js, which runs in the page's own world, keeps its own copy).

/** A record id: 32 hexadecimal characters, either case. */
export const SYS_ID_RE = /^[0-9a-f]{32}$/i;
/** A table name: a plain lower-case identifier. ServiceNow allows 80 characters, so a longer name is not a table. */
export const TABLE_RE = /^[a-z][a-z0-9_]{0,79}$/;
/** A column name: the same rule as a table name. */
export const FIELD_RE = TABLE_RE;

/** The same record id, whatever the case of either (a sys_id is hexadecimal; the instance may answer in either case). */
export const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// ---- Table API value shapes ---------------------------------------------------------------------
// With sysparm_display_value=all every value is { value, display_value } (tests may use plain strings).
// `raw` is the stored value (UTC dates, references as sys_ids), `disp` what a person sees.

export function raw(v) {
  if (v && typeof v === 'object') return v.value == null ? '' : String(v.value);
  return v == null ? '' : String(v);
}

/**
 * What a person sees for a value. The stored value stands in for an empty display value, EXCEPT when it is a sys_id: a reference the
 * signed-in user may not read can come back with no display value, and its stored value is the id of the thing. A bare id is never a
 * name (audit of 2026-11-07, D1/R-13), so it is '' here and the caller says "not visible to you" in its own words. The id stays
 * available to logic through raw().
 */
export function disp(v) {
  const shown = v && typeof v === 'object' ? String(v.display_value || v.value || '') : v == null ? '' : String(v);
  return SYS_ID_RE.test(shown) ? '' : shown;
}

// ---- Text ---------------------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '(c)',
  reg: '(R)',
  trade: '(TM)',
  hellip: '...',
  ndash: '-',
  mdash: '-',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: '*',
  middot: '.',
  euro: 'EUR',
};

/** &amp; &#39; &#x27; &nbsp; and friends to plain characters. Unknown names are left as they are. */
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

// Zero-width space, joiners and the byte-order mark: invisible, and they defeat name and email matching.
const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`, 'g');

/**
 * HTML to plain text that keeps the line breaks: block ends and <br> become newlines, list items get a dash,
 * script/style are dropped with their content, entities are decoded. ServiceNow's [code]...[/code] wrapper around
 * rich journal entries is removed too. Text without markup passes through (trimmed, 3+ newlines squeezed to 2).
 */
export function stripHtml(input) {
  let text = String(input ?? '');
  if (!text) return '';
  text = text.replace(/\[\/?code\]/gi, '').replace(ZERO_WIDTH, '');
  if (/[<&]/.test(text)) {
    // Ends of blocks first, so an opening tag can tell whether it already starts a line.
    const startsLine = (whole, offset) => offset === 0 || whole[offset - 1] === '\n';
    // Every pattern runs in linear time on hostile text (ticket text is data from anyone): a tag stops at the next "<" ([^<>]*, not
    // [^>]*, which scanned to the end again for every "<a " with no ">": "<a " 70,000 times took 19 s), and the blocks and comments
    // are found by searching forward, never by a lazy match that fails at the end for every unclosed one.
    text = dropComments(dropBlocks(text))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|ul|ol|table|blockquote|pre)\s*>/gi, '\n\n')
      .replace(/<\/(div|tr|li)\s*>/gi, '\n')
      .replace(/<li\b[^<>]*>/gi, (tag, offset, whole) => (startsLine(whole, offset) ? '- ' : '\n- '))
      .replace(/<(p|div|h[1-6]|tr|blockquote|pre)\b[^<>]*>/gi, (tag, name, offset, whole) => (startsLine(whole, offset) ? '' : '\n'))
      .replace(/<\/?[a-z][^<>]*>/gi, '');
    text = decodeEntities(text).replace(/[ \t]+/g, ' ');
  }
  return tidyLines(text);
}

// <script>...</script> and <style>...</style>, with what is inside. An unclosed one is left to the tag pass (which removes the tag
// itself); once a name has no closing tag after some point, no later opening tag of that name can have one either.
function dropBlocks(text) {
  const lower = text.toLowerCase();
  const open = /<(script|style)\b[^<>]*>/g;
  const unclosed = new Set();
  let out = '';
  let from = 0;
  for (let m = open.exec(lower); m; m = open.exec(lower)) {
    if (unclosed.has(m[1])) continue;
    const end = closingEnd(lower, m[1], open.lastIndex);
    if (end === -1) {
      unclosed.add(m[1]);
      continue;
    }
    out += text.slice(from, m.index);
    from = end;
    open.lastIndex = end;
  }
  return out + text.slice(from);
}

// Where the first `</name>` (spaces allowed before ">") at or after `at` ends; -1 when there is none.
function closingEnd(lower, name, at) {
  for (let i = lower.indexOf(`</${name}`, at); i !== -1; i = lower.indexOf(`</${name}`, i + 1)) {
    let j = i + name.length + 2;
    while (j < lower.length && /\s/.test(lower[j])) j += 1;
    if (lower[j] === '>') return j + 1;
  }
  return -1;
}

// <!-- comments -->. Only the text up to the last "-->" can hold a whole one: an unclosed "<!--" after it is left alone (the lazy
// match would have scanned to the end of the text for each of them).
function dropComments(text) {
  const last = text.lastIndexOf('-->');
  if (last === -1) return text;
  return text.slice(0, last + 3).replace(/<!--[\s\S]*?-->/g, '') + text.slice(last + 3);
}

// Spaces and tabs at the end of a line, cut by hand: the pattern /[ \t]+\n/g takes quadratic time on a long run of spaces (a field of
// 200,000 spaces held the page for minutes).
function trimLineEnd(line) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
  return end === line.length ? line : line.slice(0, end);
}

// Line ends evened out, no spaces at the end of a line, three or more line breaks squeezed to two, trimmed.
const tidyLines = (text) => text.replace(/\r\n?/g, '\n').split('\n').map(trimLineEnd).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Plain text tidied the way stripHtml tidies its result (zero-width characters out, line ends and blank lines evened out, trimmed),
 * with every other character kept as written: "List<String>", "a<b and c>d" and "R&amp;D" stay as they are.
 */
export function plainText(input) {
  return tidyLines(String(input ?? '').replace(ZERO_WIDTH, ''));
}

// Markup that only HTML has: a tag of an HTML element, closing ("</p>"), bare ("<b>", "<br/>") or with an attribute value
// ("<img src=x>"); a comment; or ServiceNow's [code] wrapper of rich journal text. Plain text that holds angle brackets is never
// taken for HTML: "List<String>" and a pasted XML error name no HTML element, and in "a<b and c>d" the b has no attribute value.
const HTML_ELEMENT = 'a|abbr|audio|b|base|big|blockquote|body|br|button|caption|center|code|col|dd|del|div|dl|dt|em|embed|font|form|h[1-6]|head|hr|html|i|iframe|img|input|ins|kbd|label|li|link|mark|meta|object|ol|option|p|pre|q|s|samp|script|select|small|source|span|strike|strong|style|sub|sup|svg|table|tbody|td|textarea|tfoot|th|thead|title|tr|tt|u|ul|video';
// (the attribute part stops at its first "=", so a long run of brackets or equals signs costs linear time)
const HTML_MARK = new RegExp(`</(?:${HTML_ELEMENT})\\s*>|<(?:${HTML_ELEMENT})(?:\\s*/?>|\\s[^<>=]*=[^<>]*>)|<!--|\\[/?code\\]`, 'i');

/** Does this value carry HTML markup (see HTML_MARK)? */
export const looksLikeHtml = (value) => HTML_MARK.test(String(value ?? ''));

/**
 * A journal entry (a comment, a work note, a chat message) as text. ServiceNow keeps it as escaped text ("O&#39;Neil", "&nbsp;"), and
 * as HTML only when it carries markup (a [code] block, rich text): the entities are decoded either way, but tags are stripped only
 * from HTML, so "List<String>" written in a plain note stays.
 */
export function journalText(value) {
  const s = String(value ?? '');
  if (looksLikeHtml(s)) return stripHtml(s);
  return plainText(s.includes('&') ? decodeEntities(s).replace(/[ \t]+/g, ' ') : s);
}

/**
 * A value as text. html: true for a source that is HTML (an article's body); 'auto' for one whose type is not known (a record's
 * columns, which hold HTML on some tables and releases): HTML only when it carries markup, so script and style blocks still go;
 * false for plain text.
 */
export function asText(value, html = 'auto') {
  return html === true || (html === 'auto' && looksLikeHtml(value)) ? stripHtml(value) : plainText(value);
}

/** Cut to `max` characters with an ellipsis. Line breaks are kept. */
export function clipText(text, max) {
  const value = String(text ?? '');
  if (!Number.isFinite(max) || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * A value as it goes into a pack: capped, and never a bare sys_id. HTML is stripped only where the value is HTML: `html` true (an HTML
 * column), 'auto' (the default: a column whose type is not known is read as HTML only when it carries markup), false (plain text).
 */
export function cleanText(value, max, { html = 'auto' } = {}) {
  const text = clipText(asText(value, html), max);
  return SYS_ID_RE.test(text) ? '' : text;
}

/** One line, whitespace squeezed, capped. For names, titles and labels; `html` as for cleanText. */
export function oneLine(value, max = 120, { html = 'auto' } = {}) {
  return clipText(asText(value, html).replace(/\s+/g, ' ').trim(), max);
}

// ---- Times --------------------------------------------------------------------------------------

/** 'YYYY-MM-DD HH:MM:SS' (ServiceNow's stored UTC format) to milliseconds, NaN when it is not that shape. */
export function parseSnTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text || '').trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : NaN;
}

/** Milliseconds as ServiceNow's 'YYYY-MM-DD HH:MM:SS' (UTC). */
export function formatSnTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// ---- Queries ------------------------------------------------------------------------------------

// Control characters (including NUL, tab and the ones that end a line), the DEL character, and the Unicode line/paragraph separators.
const QUERY_UNSAFE = new RegExp(`[\\u0000-\\u001f\\u007f\\u0085${String.fromCharCode(0x2028, 0x2029)}\\^\\\\]`);
// Invisible and format characters (zero width space, joiners, bidi marks) are removed before looking for "javascript:", so
// "java<ZWSP>script:" does not slip through.
const QUERY_INVISIBLE = /[\s\p{Cf}]/gu;

/**
 * A value that is safe inside an encoded query, or '' when it is not. Refused: a caret (it ends the condition), a backslash,
 * any control character or line break, and anything containing "javascript:" in any case (an encoded query may evaluate a value
 * that starts with it on the server). Values come from record data (a CI's name), never from a person typing, but they are
 * still data from the instance. Prefer a sys_id condition wherever the id is at hand; this is for the display names that remain.
 */
export function queryValue(value) {
  const text = String(value ?? '').trim();
  if (!text || QUERY_UNSAFE.test(text)) return '';
  if (/javascript:/i.test(text.replace(QUERY_INVISIBLE, ''))) return '';
  return text;
}

// ---- Concurrency --------------------------------------------------------------------------------

/** Run `task(item, index)` over `items`, at most `max` at a time. Results keep the order of `items`. */
export async function mapLimit(items, max, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop -- each worker takes the next item only when it is free.
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker));
  return out;
}

/** Distinct, non-empty values in first-seen order. */
export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}
