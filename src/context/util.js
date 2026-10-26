// Small helpers shared by src/context: the shapes the Table API returns, text clean-up, ServiceNow times, a bounded
// parallel map. Pure: no DOM, no network.

export const SYS_ID_RE = /^[0-9a-f]{32}$/i;
export const TABLE_RE = /^[a-z][a-z0-9_]*$/;

// ---- Table API value shapes ---------------------------------------------------------------------
// With sysparm_display_value=all every value is { value, display_value } (tests may use plain strings).
// `raw` is the stored value (UTC dates, references as sys_ids), `disp` what a person sees.

export function raw(v) {
  if (v && typeof v === 'object') return v.value == null ? '' : String(v.value);
  return v == null ? '' : String(v);
}

export function disp(v) {
  if (v && typeof v === 'object') return String(v.display_value || v.value || '');
  return v == null ? '' : String(v);
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
    text = text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|ul|ol|table|blockquote|pre)\s*>/gi, '\n\n')
      .replace(/<\/(div|tr|li)\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, (tag, offset, whole) => (startsLine(whole, offset) ? '- ' : '\n- '))
      .replace(/<(p|div|h[1-6]|tr|blockquote|pre)\b[^>]*>/gi, (tag, name, offset, whole) => (startsLine(whole, offset) ? '' : '\n'))
      .replace(/<\/?[a-z][^>]*>/gi, '');
    text = decodeEntities(text).replace(/[ \t]+/g, ' ');
  }
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cut to `max` characters with an ellipsis. Line breaks are kept. */
export function clipText(text, max) {
  const value = String(text ?? '');
  if (!Number.isFinite(max) || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** A value as it goes into a pack: HTML stripped, capped, and never a bare sys_id. */
export function cleanText(value, max) {
  const text = clipText(stripHtml(value), max);
  return SYS_ID_RE.test(text) ? '' : text;
}

/** One line, whitespace squeezed, capped. For names, titles and labels. */
export function oneLine(value, max = 120) {
  return clipText(stripHtml(value).replace(/\s+/g, ' ').trim(), max);
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

/** A value that is safe inside an encoded query, or '' when it is not (a caret would end the condition). */
export function queryValue(value) {
  const text = String(value ?? '').trim();
  return text && !/[\^\r\n]/.test(text) ? text : '';
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
