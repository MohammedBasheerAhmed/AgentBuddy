// Find the fix: the error codes a ticket quotes ("0x800CCC0F", "error 1603", "HTTP 503", "ORA-12154", "SQLSTATE 08001",
// "NullPointerException", "Event ID 4625"), so the agent can look them up in articles and solved tickets with one click. No AI:
// patterns over the text the ticket screen already read (its short description, description and newest notes). Pure.
//
// Conservative on purpose: a bare number is a code only right after words that say so ("error", "exit code", "HTTP", "Event ID"), and
// what only looks like a code is taken out first: links, email addresses, IP addresses, phone numbers, ServiceNow record numbers
// (INC0010023, KB0000032: letters and 7 digits) and dates and times. A wrong code costs the agent a useless search; a missed one costs
// nothing they would not have done anyway.
//
//   extractErrorCodes(text, { max })      the codes in one text, in the order they are written
//   errorCodesOf(pack, { notes, max })    the codes of a ticket (glance pack): short description, then description, then newest notes
//   mentionsCode(text, term)              does a text (an article, a solved ticket) mention the code searched for (src/content/ops/fix.js)
//   isCodeTerm(term)                      is this a search term the READ operation accepts (letters, digits, . _ -; 2 to 40 characters)
//
// A code: { code, search, kind, where }. `code` is what the agent reads ("HTTP 503"); `search` is what goes into the encoded query
// ("503"): letters, digits, dot, underscore and dash only. kind: 'hex' | 'windows' | 'http' | 'oracle' | 'sqlstate' | 'exception' |
// 'event'. where: 'short_description' | 'description' | 'notes' ('' for a plain text).

/** The search terms the READ operation accepts: what goes into an encoded query must not be able to end its condition. */
export const CODE_TERM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
export const isCodeTerm = (term) => typeof term === 'string' && CODE_TERM_RE.test(term);

const MAX_CODES = 3;
const MAX_TEXT = 20000; // a long description is cut before any pattern runs (the patterns are linear, this bounds the work)

// ---- What only looks like a code, taken out first --------------------------------------------------------------------------

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const NOISE = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, // links (http://, https://, ftp://...)
  /\bwww\.[^\s<>"']+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // email addresses
  /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?!\w)(?!\.\d)/g, // IPv4 addresses (with a port)
  /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})(?![\w:])/gi, // IPv6 addresses (and anything time-like with colons)
  /\b[a-z]{2,10}\d{7,}\b/gi, // ServiceNow record numbers: INC0010023, KB0000032, RITM0010001, SCTASK0010001...
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/gi, // ISO dates and times
  /\b\d{4}[/.]\d{1,2}[/.]\d{1,2}\b/g, // 2026/10/26
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, // 26/10/2026, 10-26-26
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{2,4}\\b`, 'gi'), // 26 Oct 2026
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'), // Oct 26, 2026
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?/gi, // 09:50, 9:50 am
];

// A phone number: a run of digits with spaces, dots, dashes or brackets between them, 7 digits or more, with a separator or a leading
// "+" (so "80070005", an HRESULT, is not one).
const PHONE_LIKE = /(?<![\w+])\+?\(?\d{1,4}\)?(?:[\s.-]{1,2}\(?\d{1,5}\)?){1,5}(?!\w)/g;
const isPhone = (run) => (run.match(/\d/g) || []).length >= 7 && (/^\+/.test(run) || /[\s().-]/.test(run));

function withoutNoise(text) {
  let out = String(text ?? '').slice(0, MAX_TEXT);
  for (const re of NOISE) out = out.replace(re, ' ');
  return out.replace(PHONE_LIKE, (run) => (isPhone(run) ? ' ' : run));
}

// ---- The patterns -------------------------------------------------------------------------------------------------------------

// After a number that is a code: not more of a number (1603.5, 555-0134, 10:30), not the next group of digits ("error 555 0134") and
// not a count ("Error: 100 users affected", "error 500 times").
const UNITS = 'users?|people|persons?|customers?|machines?|devices?|computers?|laptops?|phones?|servers?|times?|attempts?|tries|minutes?|mins?|hours?|hrs?|seconds?|secs?|ms|days?|weeks?|months?|years?|items?|records?|rows?|tickets?|emails?|messages?|mails?|files?|pages?|percent|kb|mb|gb|tb';
const NUM_END = `(?![\\w])(?![-./:]\\d)(?!\\s\\d)(?!\\s*%)(?!\\s+(?:${UNITS})\\b)`;
// An HRESULT written without "0x" (80070005, C0000005): eight hex digits that start with 8 or C.
const HRESULT = '[8c][0-9a-f]{7}';

const HTTP_REASONS_STRICT = 'Bad Request|Unauthorized|Payment Required|Forbidden|Not Found|Method Not Allowed|Not Acceptable|Request Time-?out|Conflict|Gone|Precondition Failed|Unsupported Media Type|Not Implemented';
const HTTP_REASONS_ANY_CASE = 'Internal Server Error|Service Unavailable|Bad Gateway|Gateway Time-?out|Too Many Requests|Payload Too Large|Request Entity Too Large|URI Too Long';

const upper = (s) => String(s).toUpperCase();

// Each pattern: its kind, a regular expression (global), and how a match becomes { code, search }. `rank` decides which of two
// patterns names a code that both found ("HTTP error 503" is HTTP 503, not error 503).
const PATTERNS = [
  {
    kind: 'hex',
    rank: 0,
    re: /(?<![\w.])0x([0-9a-f]{8})(?!\w)/gi,
    // The search is the eight digits: an article may write 0x800CCC0F or 800CCC0F.
    make: (m) => ({ code: `0x${upper(m[1])}`, search: upper(m[1]) }),
  },
  {
    kind: 'oracle',
    rank: 0,
    re: /\b(ORA|TNS|PLS)-(\d{5})(?!\w)/gi,
    make: (m) => ({ code: `${upper(m[1])}-${m[2]}`, search: `${upper(m[1])}-${m[2]}` }),
  },
  {
    kind: 'sqlstate',
    rank: 0,
    re: /\bSQLSTATE\s*(?:\[\s*([0-9a-z]{5})\s*\]|[:=]?\s*([0-9a-z]{5})(?!\w))/gi,
    make: (m) => {
      const value = upper(m[1] || m[2]);
      return /\d/.test(value) ? { code: `SQLSTATE ${value}`, search: value } : null;
    },
  },
  {
    kind: 'event',
    rank: 0,
    re: new RegExp(`\\bEvent\\s*ID\\s*[:=#]?\\s*(\\d{2,5})${NUM_END}`, 'gi'),
    make: (m) => ({ code: `Event ID ${m[1]}`, search: m[1] }),
  },
  {
    kind: 'http',
    rank: 1,
    re: new RegExp(`\\bHTTP(?:\\/\\d(?:\\.\\d)?)?(?:\\s+(?:error|status(?:\\s+code)?|code|response))?\\s*[:=]?\\s*([45]\\d{2})${NUM_END}`, 'gi'),
    make: (m) => ({ code: `HTTP ${m[1]}`, search: m[1] }),
  },
  {
    kind: 'http',
    rank: 1,
    re: new RegExp(`\\bstatus\\s+code\\s*[:=]?\\s*([45]\\d{2})${NUM_END}`, 'gi'),
    make: (m) => ({ code: `HTTP ${m[1]}`, search: m[1] }),
  },
  {
    // "404 Not Found" (as servers write it: the short reasons only in their own capitals, so "500 not found in stock" is no code)
    kind: 'http',
    rank: 1,
    re: new RegExp(`(?<![\\w.,-])([45]\\d{2})\\s+(?:-\\s+)?(?:${HTTP_REASONS_STRICT})\\b`, 'g'),
    make: (m) => ({ code: `HTTP ${m[1]}`, search: m[1] }),
  },
  {
    kind: 'http',
    rank: 1,
    re: new RegExp(`(?<![\\w.,-])([45]\\d{2})\\s+(?:-\\s+)?(?:${HTTP_REASONS_ANY_CASE})\\b`, 'gi'),
    make: (m) => ({ code: `HTTP ${m[1]}`, search: m[1] }),
  },
  {
    // Windows and installer codes: "error 1603", "Error code: 80070005", "err #619", "exit code 1603", "return code: 1618"
    kind: 'windows',
    rank: 2,
    re: new RegExp(`\\b(?:(?:error|err)(?:\\s+(?:code|number|no\\.?|#))?|(?:exit|return|result|fault|failure|stop)\\s+code)\\s*[:=#]?\\s*(\\d{3,5}|${HRESULT})${NUM_END}`, 'gi'),
    make: (m) => ({ code: upper(m[1]), search: upper(m[1]) }),
  },
  {
    // Exception and error class names: NullPointerException, java.net.SocketTimeoutException (the class name), TypeError, OutOfMemoryError
    kind: 'exception',
    rank: 3,
    re: /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9]*?)(Exception|Error)(?![A-Za-z0-9_])/g,
    make: (m) => {
      const [, head, tail] = m;
      // "Exception" or "Error" alone, or with a single letter in front ("AError"), is a word, not a name.
      if (head.length < (tail === 'Exception' ? 2 : 3)) return null;
      return { code: `${head}${tail}`, search: `${head}${tail}` };
    },
  },
];

function scan(text) {
  const clean = withoutNoise(text);
  const found = [];
  for (const p of PATTERNS) {
    for (const m of clean.matchAll(p.re)) {
      const made = p.make(m);
      if (!made || !isCodeTerm(made.search)) continue;
      found.push({ ...made, kind: p.kind, rank: p.rank, at: m.index });
    }
  }
  return found;
}

/**
 * One entry per code (by its search term), at the place it is first written, named by the more telling pattern when two found it
 * ("HTTP error 503" is HTTP 503, not error 503; "0x80070005" and "error code 80070005" are one code).
 */
function unique(found) {
  const byTerm = new Map();
  for (const c of found) {
    const key = c.search.toLowerCase();
    const seen = byTerm.get(key);
    if (!seen) byTerm.set(key, c);
    else byTerm.set(key, { ...(c.rank < seen.rank ? c : seen), at: Math.min(c.at, seen.at) });
  }
  return [...byTerm.values()];
}

const shape = ({ code, search, kind }, where = '') => ({ code, search, kind, where });

/**
 * The error codes in one text, in the order they are written (at most `max`).
 * @param {string} text
 * @param {{ max?: number }} [options]
 * @returns {{ code: string, search: string, kind: string, where: string }[]}
 */
export function extractErrorCodes(text, { max = MAX_CODES } = {}) {
  return unique(scan(text))
    .sort((a, b) => a.at - b.at || a.rank - b.rank)
    .slice(0, Math.max(0, max))
    .map((c) => shape(c));
}

const textOf = (v) => (typeof v === 'string' ? v : '');

/**
 * The error codes of a ticket: its short description first, then its description, then its newest notes (comments and work notes,
 * newest first). A code is listed once, where it is written first. Reads nothing: the glance pack (src/content/ops/insights.js) has
 * all of it already.
 * @param {{ fields?: object, journal?: { text: string }[] }} pack
 * @param {{ notes?: number, max?: number }} [options] notes: how many of the newest notes to look at
 */
export function errorCodesOf(pack, { notes = 5, max = MAX_CODES } = {}) {
  const fields = pack?.fields && typeof pack.fields === 'object' ? pack.fields : {};
  const journal = Array.isArray(pack?.journal) ? pack.journal : [];
  const count = Math.max(0, Math.floor(Number(notes)) || 0);
  const sources = [
    ['short_description', textOf(fields.short_description)],
    ['description', textOf(fields.description)],
    // (the journal is newest last)
    ...(count ? journal.slice(-count) : [])
      .reverse()
      .map((entry) => ['notes', textOf(entry?.text)]),
  ];
  const out = [];
  const seen = new Set();
  for (const [where, text] of sources) {
    if (!text || out.length >= max) continue;
    for (const c of extractErrorCodes(text, { max: MAX_CODES * 2 })) {
      const key = c.search.toLowerCase();
      if (seen.has(key) || out.length >= max) continue;
      seen.add(key);
      out.push(shape(c, where));
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this text mention the code searched for? The instance's LIKE finds the characters anywhere ("503" in a room number), so every
 * answer is checked again here. A short number (up to 5 digits: error 1603, HTTP 503, Event ID 4625, SQLSTATE 08001) must be quoted as
 * a code, with the words that say so; anything longer or with letters must stand as a word of its own (an "0x" in front is allowed).
 * @param {string} text plain text (no HTML)
 * @param {string} term a search term (isCodeTerm)
 */
export function mentionsCode(text, term) {
  if (!isCodeTerm(term) || typeof text !== 'string' || !text) return false;
  if (/^\d{1,5}$/.test(term)) return unique(scan(text)).some((c) => c.search === term);
  const word = new RegExp(`(?<![A-Za-z0-9_])(?:0x)?${escapeRe(term)}(?![A-Za-z0-9_])`, 'i');
  return word.test(text.slice(0, MAX_TEXT * 5));
}
