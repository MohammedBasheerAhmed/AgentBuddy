// Deterministic PII and secret detectors. Pure functions, no I/O.
//
// Every detector returns findings { kind, start, end, value, confidence } over the ORIGINAL text, so a caller can
// replace them by offset. detect() runs the detectors, drops weak findings and resolves overlaps (the finding with the
// higher confidence wins, then the longer one).
//
// What this is NOT: a name detector. Free-form personal names in prose cannot be found by patterns; the record-aware
// dictionary (dictionary.js) covers the people the ticket already tells us about, and nothing else.
//
// Regex safety: every pattern is either anchored with a lookbehind so it starts once per token, or uses small bounded
// repetition, or is replaced by a plain indexOf/char scan. There are no nested unbounded quantifiers, so there is no
// catastrophic backtracking; tests/pii-detectors.test.js feeds 200k characters of adversarial input to prove it.

export const KINDS = Object.freeze([
  'EMAIL',
  'PHONE',
  'CARD',
  'IBAN',
  'NATIONAL_ID',
  'IP',
  'MAC',
  'DOB',
  'ADDRESS',
  'EMPLOYEE_ID',
  'SECRET',
  'URL_CREDENTIALS',
]);

/** Regions with their own national id, phone and postcode formats. All are on unless `regions` says otherwise. */
export const REGIONS = Object.freeze(['US', 'UK', 'IN']);

/** Findings below this confidence are not returned by default (loopback addresses, netmasks and the like). */
export const DEFAULT_MIN_CONFIDENCE = 0.5;

/** A finding at or above this confidence that survives redaction makes the firewall refuse to send. */
export const HIGH_CONFIDENCE = 0.85;

// ---------------------------------------------------------------------------------------------------------------
// Validators (exported through `validators` for the tests)
// ---------------------------------------------------------------------------------------------------------------

function luhnOk(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

// IBAN length per country. A candidate with a country that is not listed is not reported (fewer false positives).
const IBAN_LENGTH = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

function ibanMod97(compact) {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    const v = c >= 65 ? c - 55 : c - 48; // A=10 ... Z=35
    remainder = v > 9 ? (remainder * 100 + v) % 97 : (remainder * 10 + v) % 97;
  }
  return remainder;
}

function ibanOk(compact) {
  const expected = IBAN_LENGTH[compact.slice(0, 2)];
  return Boolean(expected) && compact.length === expected && ibanMod97(compact) === 1;
}

// Verhoeff checksum, used by Aadhaar numbers.
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffOk(digits) {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = digits.charCodeAt(digits.length - 1 - i) - 48;
    c = V_D[c][V_P[i % 8][n]];
  }
  return digits.length > 1 && c === 0;
}

// US social security number rules: area not 000, 666 or 9xx; group not 00; serial not 0000.
function ssnOk(area, group, serial) {
  if (area === '000' || area === '666' || area[0] === '9') return false;
  return group !== '00' && serial !== '0000';
}

const NINO_BAD_PREFIX = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);

export const validators = Object.freeze({ luhnOk, ibanOk, verhoeffOk, ssnOk });

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function make(kind, text, start, end, confidence) {
  return { kind, start, end, value: text.slice(start, end), confidence };
}

/** Run a global regex over `text`, calling `fn(match)` for each non-empty match. */
function each(re, text, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    fn(m);
  }
}

const digitsOf = (s) => s.replace(/\D/g, '');

// The 30 characters before an index, used to look for a label such as "phone:" without scanning the whole text.
const before = (text, index, n = 32) => text.slice(Math.max(0, index - n), index);

const ASCII_ALNUM = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const UNICODE_ALNUM = /^[\p{L}\p{N}]$/u;
const isAlnumAt = (text, i) => {
  const c = text.charCodeAt(i);
  return c < 128 ? ASCII_ALNUM(c) : UNICODE_ALNUM.test(text[i]);
};

// ---------------------------------------------------------------------------------------------------------------
// EMAIL: found by walking out from each "@" with bounded loops (no regex over long runs of letters).
// ---------------------------------------------------------------------------------------------------------------

const NOT_A_TLD = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'css', 'js', 'json', 'html', 'htm', 'php', 'xml', 'txt', 'pdf', 'md', 'zip', 'exe', 'dll']);

function emailLocalChar(text, i) {
  const c = text.charCodeAt(i);
  if (c < 128) return ASCII_ALNUM(c) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45 || c === 39; // . _ % + - '
  return UNICODE_ALNUM.test(text[i]);
}

function emailDomainChar(text, i) {
  const c = text.charCodeAt(i);
  if (c < 128) return ASCII_ALNUM(c) || c === 46 || c === 45; // . -
  return UNICODE_ALNUM.test(text[i]);
}

function detectEmails(text, out) {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let s = at;
    while (s > 0 && at - s < 128 && emailLocalChar(text, s - 1)) s--;
    while (s < at && !isAlnumAt(text, s)) s++; // a leading quote or dot is not part of the address
    if (s === at) continue;
    let e = at + 1;
    while (e < text.length && e - at < 256 && emailDomainChar(text, e)) e++;
    while (e > at + 1 && (text[e - 1] === '.' || text[e - 1] === '-')) e--;
    const labels = text.slice(at + 1, e).split('.');
    if (labels.length < 2) continue;
    if (labels.some((l) => !l || l.length > 63 || l[0] === '-' || l[l.length - 1] === '-')) continue;
    const tld = labels[labels.length - 1];
    if (!(/^\p{L}{2,24}$/u.test(tld) || /^xn--[a-z0-9-]{2,20}$/i.test(tld))) continue;
    if (NOT_A_TLD.has(tld.toLowerCase())) continue; // icon@2x.png
    out.push(make('EMAIL', text, s, e, 0.98));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// URL_CREDENTIALS: scheme://user:password@host, found by scanning from each "://".
// ---------------------------------------------------------------------------------------------------------------

function detectUrlCredentials(text, out) {
  for (let i = text.indexOf('://'); i !== -1; i = text.indexOf('://', i + 3)) {
    let s = i;
    while (s > 0 && i - s < 24 && /[A-Za-z0-9+.-]/.test(text[s - 1])) s--;
    if (s === i || !/[A-Za-z]/.test(text[s])) continue;
    // The authority ends at the first / ? # quote, bracket or whitespace; the user info ends at the LAST "@" inside it.
    const limit = Math.min(text.length, i + 3 + 300);
    let j = i + 3;
    let lastAt = -1;
    let colon = -1;
    for (; j < limit; j++) {
      const ch = text[j];
      if (ch === '/' || ch === '?' || ch === '#' || ch === '"' || ch === "'" || ch === '<' || ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
      if (ch === '@') lastAt = j;
    }
    if (lastAt === -1) continue;
    for (let k = i + 3; k < lastAt; k++) {
      if (text[k] === ':') {
        colon = k;
        break;
      }
    }
    if (colon === -1 || colon + 1 >= lastAt) continue; // needs user:password
    out.push(make('URL_CREDENTIALS', text, i + 3, lastAt, 0.99));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// SECRET
// ---------------------------------------------------------------------------------------------------------------

// -----BEGIN ... PRIVATE KEY----- ... -----END ... PRIVATE KEY-----, also when the block is cut off before the END line.
function detectPrivateKeys(text, out) {
  const BEGIN = '-----BEGIN ';
  let noMoreEnd = false;
  let i = text.indexOf(BEGIN);
  while (i !== -1) {
    const headerClose = text.indexOf('-----', i + BEGIN.length);
    const label = headerClose === -1 || headerClose - i > 80 ? '' : text.slice(i + BEGIN.length, headerClose);
    if (!/PRIVATE KEY(?: BLOCK)?$/.test(label)) {
      i = text.indexOf(BEGIN, i + BEGIN.length);
      continue;
    }
    const bodyStart = headerClose + 5;
    let end = -1;
    const endAt = noMoreEnd ? -1 : text.indexOf('-----END ', bodyStart);
    if (endAt === -1) noMoreEnd = true;
    if (endAt !== -1 && endAt - bodyStart <= 20000) {
      const close = text.indexOf('-----', endAt + 9);
      end = close === -1 ? endAt + 9 : close + 5;
    } else {
      // No END line close enough: take the run of base64 and whitespace that follows (a truncated paste).
      let k = bodyStart;
      const stop = Math.min(text.length, bodyStart + 20000);
      while (k < stop && /[A-Za-z0-9+/=\s:,.-]/.test(text[k]) && text.slice(k, k + 5) !== '-----') k++;
      if (k - bodyStart >= 16) end = k;
    }
    if (end === -1) {
      i = text.indexOf(BEGIN, i + BEGIN.length); // only a mention of the header, no key material
      continue;
    }
    out.push(make('SECRET', text, i, end, 1));
    i = text.indexOf(BEGIN, end);
  }
}

// Key shapes that identify themselves. All are anchored so they start once per token.
const SECRET_SHAPES = [
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,3000}\.[A-Za-z0-9_-]{8,3000}(?:\.[A-Za-z0-9_-]{0,3000})?/g, 0.97], // JWT
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA)[0-9A-Z]{16}(?![A-Za-z0-9])/g, 0.97], // AWS key id
  [/(?<![A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]{0,200}\d)(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,200}/g, 0.97], // OpenAI, Anthropic
  [/(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,255}(?![A-Za-z0-9])/g, 0.97], // GitHub
  [/(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{50,255}/g, 0.97],
  [/(?<![A-Za-z0-9])glpat-[A-Za-z0-9_-]{20,100}/g, 0.97], // GitLab
  [/(?<![A-Za-z0-9-])xox[abprs]-[A-Za-z0-9-]{10,200}/g, 0.97], // Slack
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,100}/g, 0.97],
  [/(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, 0.97], // Google API key
  [/(?<![A-Za-z0-9_.-])ya29\.[0-9A-Za-z_-]{20,300}/g, 0.95], // Google OAuth
  [/(?<![A-Za-z0-9_])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,100}/g, 0.97], // Stripe
  [/(?<![A-Za-z0-9_-])SG\.[A-Za-z0-9_-]{16,100}\.[A-Za-z0-9_-]{16,100}/g, 0.97], // SendGrid
  [/(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, 0.97],
];

// Authorization: Basic xxx / Bearer xxx. The finding is the credential only, so the scheme stays readable.
const AUTH_HEADER = /(?<![A-Za-z0-9_-])Authorization["']?[ \t]{0,3}[:=][ \t]{0,3}["']?(?:Basic|Bearer|Token|Digest|Negotiate|NTLM|ApiKey)[ \t]{1,3}([A-Za-z0-9+/=._~-]{8,2048})/gid;
// A bare bearer token must contain a digit, so "Bearer authentication" in prose is left alone.
const BEARER = /(?<![A-Za-z0-9_-])Bearer[ \t]{1,3}(?=[A-Za-z0-9\-._~+/]{0,2048}[0-9])([A-Za-z0-9\-._~+/]{16,2048}=*)/gd;

// "password: x", "pwd=x", "api_key = x", {"token":"x"}, "password for jdoe is x", "password was reset to x".
const ci = (word) => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const label = (phrase) => phrase.split(' ').map(ci).join('[ _-]?');
const STRONG_WORDS = ['password', 'passwd', 'passcode', 'passphrase', 'pwd'];
const TOKEN_WORDS = [
  'secret access key', 'client secret', 'api secret', 'api key', 'apikey', 'access key', 'access token', 'auth token',
  'refresh token', 'private key', 'account key', 'secret key', 'secret', 'credentials', 'credential', 'token',
  'signature', 'sig', 'g_ck', 'sysparm_ck', 'x-usertoken', 'jsessionid',
];
const SEP_WORDS = ['was reset to', 'is reset to', 'was changed to', 'is changed to', 'was set to', 'is set to', 'was updated to', 'is updated to', 'reset to', 'changed to', 'set to', 'updated to', 'is', 'was', 'are', 'now', 'equals'];
const ASSIGN = new RegExp(
  // the label starts a token, or starts a camelCase hump (dbPassword)
  '(?:(?<![A-Za-z0-9])|(?<=[a-z0-9])(?=[A-Z]))' +
    `(${[...STRONG_WORDS, 'pass'].map(label).join('|')}|${TOKEN_WORDS.map(label).join('|')})` +
    '(?:\\d{1,2})?(["\']?)' +
    '(?:[ \\t]+' + ci('for') + '[ \\t]+\\S{1,40})?' +
    '[ \\t]{0,3}' +
    `(?:(:=|=>|[:=])|[ \\t]+(${SEP_WORDS.map((w) => w.split(' ').map(ci).join('[ \\t]+')).join('|')}))` +
    '[ \\t]{0,3}' +
    '(?:"([^"\\r\\n]{1,200})"|\'([^\'\\r\\n]{1,200})\'|([^\\s"\'<>;]{1,200}))',
  'gd'
);

const STOP_VALUES = new Set([
  'required', 'expired', 'expire', 'expires', 'reset', 'resets', 'change', 'changed', 'incorrect', 'invalid', 'wrong',
  'forgotten', 'unknown', 'empty', 'blank', 'null', 'nil', 'none', 'n/a', 'na', 'true', 'false', 'yes', 'no', 'hidden',
  'masked', 'redacted', 'provided', 'sent', 'given', 'missing', 'entered', 'correct', 'same', 'old', 'new', 'temporary',
  'temp', 'default', 'policy', 'the', 'a', 'an', 'to', 'is', 'was', 'and', 'or', 'not', 'your', 'my', 'his', 'her',
  'their', 'this', 'that', 'it', 'set', 'unset', 'updated', 'locked', 'unlocked', 'enabled', 'disabled', 'pending',
  'failed', 'success', 'successful', 'ok', 'okay', 'valid', 'here', 'below', 'above', 'attached', 'stored', 'saved',
  'shared', 'secure', 'vault', 'manager', 'please', 'undefined', 'todo', 'tbd', 'xxx', 'xxxx', 'rotated', 'rotation',
  'verified', 'accepted', 'rejected', 'denied', 'granted', 'sufficient', 'insufficient', 'complex', 'strong', 'weak',
  'length', 'minimum', 'maximum', 'history', 'age', 'complexity', 'lockout', 'sync', 'synced', 'managed',
]);

// Runs of * x # . - or bullet characters are a mask, not a value.
const MASK_CHARS = new RegExp('^[*xX#_.' + String.fromCharCode(0x2022, 0xb7) + '-]{3,}' + String.fromCharCode(36));

function placeholderish(v) {
  return (
    MASK_CHARS.test(v) ||
    /^\[[^\]]*\]$/.test(v) ||
    /^<[^>]*>$/.test(v) ||
    /^\{\{.*\}\}$/.test(v) ||
    /^\$\{.*\}$/.test(v) ||
    /^%[A-Za-z_]+%$/.test(v)
  );
}

const complex = (v) => /\d/.test(v) || /[^A-Za-z0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v) && v.length >= 6);

function secretValueOk(cls, symbolic, quoted, raw) {
  // Judge the value without sentence punctuation ("password is incorrect." is prose); the masked span keeps it.
  const v = quoted ? raw : raw.replace(/[.,;:!?)\]]+$/, '');
  if (!v || STOP_VALUES.has(v.toLowerCase()) || placeholderish(v)) return false;
  if (cls === 'strong') return symbolic ? v.length >= (quoted ? 3 : 4) : v.length >= 5 && complex(v);
  if (cls === 'weak') return symbolic && v.length >= 6 && complex(v); // "pass"
  if (v.length < 8) return false; // token-like labels need a long value
  if (!symbolic) return v.length >= 12 && /\d/.test(v);
  return /\d/.test(v) || v.length >= 20 || (/[a-z]/.test(v) && /[A-Z]/.test(v) && /[^A-Za-z0-9]/.test(v));
}

function detectSecrets(text, out) {
  detectPrivateKeys(text, out);
  for (const [re, confidence] of SECRET_SHAPES) each(re, text, (m) => out.push(make('SECRET', text, m.index, m.index + m[0].length, confidence)));
  for (const re of [AUTH_HEADER, BEARER]) {
    each(re, text, (m) => {
      const [s, e] = m.indices[1];
      out.push(make('SECRET', text, s, e, 0.95));
    });
  }
  each(ASSIGN, text, (m) => {
    const word = m[1].toLowerCase().replace(/[^a-z]/g, '');
    const cls = STRONG_WORDS.includes(word) ? 'strong' : word === 'pass' ? 'weak' : 'token';
    const group = m[5] !== undefined ? 5 : m[6] !== undefined ? 6 : 7;
    const quoted = group !== 7;
    let [s, e] = m.indices[group];
    // In a query string "&" ends the value; elsewhere it can be part of a password.
    const prev = text[m.index - 1];
    if (!quoted && (prev === '?' || prev === '&')) {
      const amp = text.slice(s, e).indexOf('&');
      if (amp !== -1) e = s + amp;
    }
    const value = text.slice(s, e);
    if (!value || !secretValueOk(cls, m[3] !== undefined, quoted, value)) return;
    out.push(make('SECRET', text, s, e, 0.9));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CARD: digit groups, Luhn checked, with a plausible issuer prefix
// ---------------------------------------------------------------------------------------------------------------

const CARD_CANDIDATE = /(?<!\d)\d(?:[ \xa0-]?\d){12,18}(?!\d)/g;
// Visa 4, Mastercard 51-55 and 2221-2720, Amex 34/37, Discover 6011/644-649/65, JCB 3528-3589, Diners 30/36/38/39,
// UnionPay 62, Maestro 50/56-69, RuPay 60/65/81/82/508. A first digit of 1, 7 or 9 (epoch timestamps, ids) is never a card.
function plausibleIssuer(d) {
  const p2 = Number(d.slice(0, 2));
  const p4 = Number(d.slice(0, 4));
  if (d[0] === '4') return true;
  if (p2 >= 51 && p2 <= 55) return true;
  if (p4 >= 2221 && p4 <= 2720) return true;
  if (p2 === 34 || p2 === 37) return true;
  if (p2 === 30 || p2 === 36 || p2 === 38 || p2 === 39) return true;
  if (p4 >= 3528 && p4 <= 3589) return true;
  if (p2 >= 56 && p2 <= 69) return true;
  if (p2 === 50 || p2 === 81 || p2 === 82) return true;
  return false;
}

function cardOk(segment) {
  const d = digitsOf(segment);
  if (d.length < 13 || d.length > 19 || !plausibleIssuer(d) || !luhnOk(d)) return false;
  // Separators should be regular: groups of 4 (or 4-6-5 / 4-6-4 for Amex and Diners), or none at all.
  const groups = segment.split(/[ \xa0-]/);
  return groups.length === 1 || groups.slice(0, -1).every((g) => g.length === 4) || /^\d{4}[ -]\d{6}[ -]\d{4,5}$/.test(segment);
}

function detectCards(text, out) {
  each(CARD_CANDIDATE, text, (m) => {
    // The candidate can run on into a CVV or another number ("4111 1111 1111 1111 123"), so try the whole run first and
    // then shorter runs of whole digit groups, longest first, from each starting group.
    const spans = [];
    const digitGroup = /\d+/g;
    let g;
    while ((g = digitGroup.exec(m[0])) !== null) spans.push([g.index, g.index + g[0].length]);
    const digitsBefore = [0]; // digits before group k, so a run's length is a subtraction
    for (const [s, e] of spans) digitsBefore.push(digitsBefore[digitsBefore.length - 1] + (e - s));
    let i = 0;
    while (i < spans.length) {
      const first = m[0][spans[i][0]];
      let matched = false;
      if (first >= '2' && first <= '8') {
        for (let j = spans.length - 1; j >= i; j--) {
          const length = digitsBefore[j + 1] - digitsBefore[i];
          if (length > 19) continue;
          if (length < 13) break; // shorter runs only get shorter
          const segment = m[0].slice(spans[i][0], spans[j][1]);
          if (!cardOk(segment)) continue;
          out.push(make('CARD', text, m.index + spans[i][0], m.index + spans[j][1], 0.97));
          i = j + 1;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// IBAN
// ---------------------------------------------------------------------------------------------------------------

const IBAN_CANDIDATE = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}(?![A-Za-z0-9])/g;

function detectIbans(text, out) {
  each(IBAN_CANDIDATE, text, (m) => {
    const country = m[0].slice(0, 2).toUpperCase();
    const expected = IBAN_LENGTH[country];
    if (!expected) return;
    // Walk until `expected` letters/digits have been read, so a following word is not swallowed.
    let count = 0;
    let end = 0;
    for (let i = 0; i < m[0].length && count < expected; i++) {
      if (m[0][i] !== ' ') {
        count++;
        end = i + 1;
      }
    }
    if (count !== expected) return;
    const compact = m[0].slice(0, end).replace(/ /g, '').toUpperCase();
    if (!ibanOk(compact)) return;
    out.push(make('IBAN', text, m.index, m.index + end, 0.97));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// NATIONAL_ID: US social security number, UK national insurance number, Indian Aadhaar and PAN
// ---------------------------------------------------------------------------------------------------------------

const SSN_DASHED = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g;
const SSN_SPACED = /(?<![\d-])(\d{3}) (\d{2}) (\d{4})(?![\d-])/g;
const SSN_LABELLED = /(?<![A-Za-z])(?:SSN|SS#|social[ \t]+security(?:[ \t]+(?:number|no\.?|num|#))?)[ \t]{0,3}[:=#-]?[ \t]{0,3}(\d{3})[ -]?(\d{2})[ -]?(\d{4})(?![\d-])/gid;
const NINO = /(?<![A-Za-z0-9])([A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z])[ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?[A-D](?![A-Za-z0-9])/g;
const AADHAAR_FORMATTED = /(?<![\w-])[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?![\w-])/g;
const AADHAAR_PLAIN = /(?<![\w-])[2-9]\d{11}(?![\w-])/g;
const AADHAAR_LABELLED = /(?<![A-Za-z])(?:aadhaar|aadhar|adhaar|uidai|uid)(?:[ \t]+(?:number|no\.?|num|card|#))?[ \t]{0,3}[:=#-]?[ \t]{0,3}(\d{4}[ -]?\d{4}[ -]?\d{4})(?![\d-])/gid;
const PAN = /(?<![A-Za-z0-9])[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z](?![A-Za-z0-9])/g;

function detectNationalIds(text, out, regions) {
  if (regions.has('US')) {
    each(SSN_DASHED, text, (m) => {
      if (ssnOk(m[1], m[2], m[3])) out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.92));
    });
    each(SSN_SPACED, text, (m) => {
      if (ssnOk(m[1], m[2], m[3])) out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.7));
    });
    each(SSN_LABELLED, text, (m) => {
      if (!ssnOk(m[1], m[2], m[3])) return;
      // The finding is the number only, not the "SSN:" label in front of it.
      out.push(make('NATIONAL_ID', text, m.indices[1][0], m.indices[3][1], 0.92));
    });
  }
  if (regions.has('UK')) {
    each(NINO, text, (m) => {
      if (!NINO_BAD_PREFIX.has(m[1])) out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.9));
    });
  }
  if (regions.has('IN')) {
    each(AADHAAR_FORMATTED, text, (m) => {
      if (verhoeffOk(digitsOf(m[0]))) out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.85));
    });
    each(AADHAAR_PLAIN, text, (m) => {
      if (verhoeffOk(m[0])) out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.8));
    });
    each(AADHAAR_LABELLED, text, (m) => {
      const [s, e] = m.indices[1];
      if (verhoeffOk(digitsOf(text.slice(s, e)))) out.push(make('NATIONAL_ID', text, s, e, 0.9));
    });
    each(PAN, text, (m) => out.push(make('NATIONAL_ID', text, m.index, m.index + m[0].length, 0.85)));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// PHONE
// ---------------------------------------------------------------------------------------------------------------

// Starts must not sit inside a word, a longer number, a version ("v1.555...") or a path.
const PHONE_US = /(?<![\w.+/-])(?:\+?1[ .\xa0-]?)?(?:\([2-9]\d{2}\)[ .\xa0-]?|[2-9]\d{2}[ .\xa0-])\d{3}[ .\xa0-]\d{4}(?!\d|[.-]\d)/g;
const PHONE_INTL = /(?<![\w.+/-])(?:\+|00)[1-9][\d ().\xa0-]{6,28}\d/g;
const PHONE_UK = /(?<![\w.+/-])0(?:7\d{3}|\d{2,4})[ -]?\d{3,4}[ -]?\d{3,4}(?!\d|[.-]\d)/g;
const PHONE_IN_MOBILE = /(?<![\w.+/-])(?:(?:\+91|91|0)[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d|[.-]\d)/g;
const PHONE_IN_LANDLINE = /(?<![\w.+/-])0\d{2,4}[ -]\d{6,8}(?!\d|[.-]\d)/g;
const PHONE_LABELLED = /(?<![A-Za-z])(?:phone|tel|telephone|mobile|mob|cell|fax|whatsapp|contact(?:[ \t]+(?:no|number|num))?|ph|msisdn)\b\.?[ \t]{0,3}(?:no\.?|number|num|#)?[ \t]{0,3}[:=-]?[ \t]{0,3}(\+?\(?\d[\d ().\xa0-]{5,22}\d)/gid;
const PHONE_LABEL_BEFORE = /(?:phone|tel|telephone|mobile|mob|cell|fax|whatsapp|contact|call|dial|ph|msisdn)\b[^\n]{0,14}$/i;

const DATE_LIKE = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;

// Shorten a run such as "+44 20 7946 0958 123" to at most `max` digits, cutting at a group boundary.
function fitDigits(str, max) {
  let digits = 0;
  let lastGroupEnd = -1;
  for (let i = 0; i < str.length; i++) {
    const isDigit = str.charCodeAt(i) >= 48 && str.charCodeAt(i) <= 57;
    if (!isDigit) {
      if (i > 0 && str.charCodeAt(i - 1) >= 48 && str.charCodeAt(i - 1) <= 57) lastGroupEnd = i;
      continue;
    }
    if (digits === max) return lastGroupEnd;
    digits++;
  }
  return str.length;
}

function detectPhones(text, out, regions) {
  const push = (start, end, confidence) => out.push(make('PHONE', text, start, end, confidence));
  const labelled = (index) => PHONE_LABEL_BEFORE.test(before(text, index));

  each(PHONE_INTL, text, (m) => {
    if (/\d[ .-]$/.test(before(text, m.index, 2))) return; // the middle of a longer run of digit groups
    const cut = fitDigits(m[0], m[0].startsWith('+') ? 15 : 17);
    if (cut <= 0) return;
    const body = m[0].slice(0, cut).replace(/[^\d]+$/, '');
    const n = digitsOf(body).length - (body.startsWith('00') ? 2 : 0);
    if (n < 8 || n > 15 || DATE_LIKE.test(body.replace(/^\+/, ''))) return;
    // "0012345678" with no spacing is an order or account number far more often than a dialled number.
    if (body.startsWith('00') && !/[ ().\xa0-]/.test(body) && !labelled(m.index)) return;
    push(m.index, m.index + body.length, 0.85);
  });
  each(PHONE_LABELLED, text, (m) => {
    const [s] = m.indices[1];
    const cut = fitDigits(m[1], 15);
    if (cut <= 0) return;
    const body = m[1].slice(0, cut).replace(/[^\d]+$/, '');
    const n = digitsOf(body).length;
    if (n < 7 || n > 15 || DATE_LIKE.test(body)) return;
    push(s, s + body.length, 0.9);
  });
  if (regions.has('US')) {
    each(PHONE_US, text, (m) => push(m.index, m.index + m[0].length, 0.8));
  }
  if (regions.has('UK')) {
    each(PHONE_UK, text, (m) => {
      const n = digitsOf(m[0]).length;
      if (n < 10 || n > 11) return;
      const separated = /[ -]/.test(m[0]);
      const mobile = /^07\d{9}$/.test(m[0]);
      if (separated || mobile || labelled(m.index)) push(m.index, m.index + m[0].length, 0.8);
    });
  }
  if (regions.has('IN')) {
    each(PHONE_IN_MOBILE, text, (m) => {
      const prefixed = /^(?:\+91|91|0)/.test(m[0]) && digitsOf(m[0]).length > 10;
      const separated = /[ -]/.test(m[0]);
      // A bare 10-digit number starting 6-9 is too often an id; it needs a prefix, a space/dash, or a label.
      if (m[0].startsWith('+91') || separated || labelled(m.index) || (prefixed && m[0].startsWith('91') && separated)) push(m.index, m.index + m[0].length, 0.8);
    });
    each(PHONE_IN_LANDLINE, text, (m) => {
      const n = digitsOf(m[0]).length;
      if (n >= 10 && n <= 12) push(m.index, m.index + m[0].length, 0.75);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// IP and MAC
// ---------------------------------------------------------------------------------------------------------------

const IPV4 = /(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?!\w|\.\d)/g;
const VERSION_CONTEXT = /(?<![A-Za-z])(?:version|ver\.?|build|release|rev|revision|firmware|fw|patch|v)[ \t:=]*$/i;
const IPV6_CANDIDATE = /(?<![\w:.])[A-Fa-f0-9:][A-Fa-f0-9:.]{1,44}(?![\w:])/g;
const MAC_PAIRS = /(?<![\w:.-])[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![\w:-])/g;
const MAC_CISCO = /(?<![\w:.-])[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}(?![\w:.-])/g;

function ipv4Confidence([a, b, c, d]) {
  const mask = [255, 254, 252, 248, 240, 224, 192, 128, 0];
  if (mask.includes(a) && mask.includes(b) && mask.includes(c) && mask.includes(d) && a >= b && b >= c && c >= d) return 0.2; // netmask
  if (a === 0 || a === 127 || a >= 224) return 0.3; // unspecified, loopback, multicast, broadcast
  if (a === 169 && b === 254) return 0.4; // link-local
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 0.7; // private ranges
  return 0.85;
}

function ipv6Ok(s) {
  if (!/\d/.test(s) || (s.match(/:/g) || []).length < 2 || s.includes(':::')) return false;
  let body = s.replace(/\.+$/, '');
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(body);
  if (tail) {
    if (tail[2].split('.').some((o) => Number(o) > 255)) return false;
    body = `${tail[1]}0:0`;
  }
  if (!/^[0-9A-Fa-f:]+$/.test(body)) return false;
  const first = body.indexOf('::');
  if (first !== body.lastIndexOf('::')) return false;
  const group = (g) => /^[0-9A-Fa-f]{1,4}$/.test(g);
  if (first === -1) {
    const groups = body.split(':');
    return groups.length === 8 && groups.every(group);
  }
  const [left, right] = body.split('::');
  const lg = left ? left.split(':') : [];
  const rg = right ? right.split(':') : [];
  return lg.length + rg.length <= 7 && lg.every(group) && rg.every(group);
}

function detectNetwork(text, out) {
  each(IPV4, text, (m) => {
    if (VERSION_CONTEXT.test(before(text, m.index, 14))) return; // "version 3.2.1.5" is not an address
    const confidence = ipv4Confidence(m[0].split('.').map(Number));
    out.push(make('IP', text, m.index, m.index + m[0].length, confidence));
  });
  each(IPV6_CANDIDATE, text, (m) => {
    const cand = m[0].replace(/\.+$/, '');
    if (!ipv6Ok(cand)) return;
    const lower = cand.toLowerCase();
    const confidence = lower === '::1' || /^(?:0:){7}1$/.test(lower) ? 0.3 : lower.startsWith('fe80') ? 0.5 : 0.8;
    out.push(make('IP', text, m.index, m.index + cand.length, confidence));
  });
  for (const re of [MAC_PAIRS, MAC_CISCO]) {
    each(re, text, (m) => {
      const hex = m[0].replace(/[^0-9A-Fa-f]/g, '').toLowerCase();
      const trivial = /^(0{12}|f{12})$/.test(hex);
      out.push(make('MAC', text, m.index, m.index + m[0].length, trivial ? 0.3 : 0.85));
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// DOB, EMPLOYEE_ID, ADDRESS
// ---------------------------------------------------------------------------------------------------------------

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE =
  `(?:\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}[/.-]\\d{1,2}[/.-]\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?[ \\t]+(?:of[ \\t]+)?${MONTH}\\.?,?[ \\t]+\\d{2,4}|${MONTH}\\.?[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]+\\d{2,4})`;
const DOB = new RegExp(
  `(?<![A-Za-z])(?:d\\.?o\\.?b\\.?|date[ -]of[ -]birth|birth[ -]?date|birthday|born(?:[ \\t]+on)?)(?![A-Za-z])[ \\t]{0,3}(?:is|was|:|=|-|on)?[ \\t]{0,3}(${DATE})(?![\\d])`,
  'gid'
);

const EMPLOYEE_LABELLED = /(?<![A-Za-z])(?:employee|emp|staff|personnel|worker|badge)[ \t_-]{0,2}(?:id|no|number|num|#|code)\b\.?[ \t]{0,3}[:=#-]?[ \t]{0,3}([A-Za-z]{0,4}-?\d[A-Za-z0-9-]{2,14})/gid;
const EMPLOYEE_PREFIXED = /(?<![A-Za-z0-9])(?:EMP|EID|STF)[-_]?\d{4,8}(?![A-Za-z0-9])/g;

const SUFFIX_CLEAR = 'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Nagar|Marg';
const SUFFIX_AMBIGUOUS = 'Way|Court|Ct|Place|Pl|Drive|Dr|Square|Sq|Close|Circle|Cir|Terrace|Ter|Cross|Layout|Colony|Gardens|Gdns|Crescent|Cres|Highway|Hwy|Parkway|Pkwy';
const UNIT = '(?:,?[ \\t]+(?:Apt|Apartment|Suite|Ste|Unit|Flat|Floor|Fl)\\.?[ \\t]*#?[A-Za-z0-9-]{1,6})?';
// "221B Baker Street": a house number, one to four words, then a street word. Plain suffixes match in any case; the
// ambiguous ones (Way, Drive, Close...) need capitalised street words so "5 min drive" and "1 other way" stay clean.
const STREET_CLEAR = new RegExp(`(?<![\\w#])\\d{1,5}[A-Za-z]?(?:[ \\t]+[\\p{L}\\d'.-]{1,24}){1,4}?[ \\t]+(?:${SUFFIX_CLEAR})\\b\\.?${UNIT}`, 'giu');
const STREET_AMBIGUOUS = new RegExp(`(?<![\\w#])\\d{1,5}[A-Za-z]?(?:[ \\t]+(?:\\p{Lu}[\\p{L}'.-]{0,23}|\\d{1,3}(?:st|nd|rd|th)))(?:[ \\t]+\\p{Lu}[\\p{L}'.-]{0,23}){0,3}?[ \\t]+(?:${SUFFIX_AMBIGUOUS})\\b\\.?${UNIT}`, 'gu');
// "12 of the Road" is prose, not an address: a stop word between the number and the street word rejects the match.
const STREET_STOP = new Set(['of', 'the', 'on', 'in', 'at', 'to', 'a', 'an', 'and', 'or', 'for', 'from', 'by', 'with', 'is', 'are', 'was', 'were', 'this', 'that', 'per', 'via', 'than', 'then']);
const STREET_WORDS = new Set([...SUFFIX_CLEAR.split('|'), ...SUFFIX_AMBIGUOUS.split('|')].map((s) => s.toLowerCase()));
function streetOk(matched) {
  const words = matched.split(/[ \t]+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
    if (STREET_WORDS.has(w)) return true;
    if (STREET_STOP.has(w)) return false;
  }
  return true;
}
const PO_BOX = /(?<![\w])P\.?[ \t]?O\.?[ \t]?Box[ \t]+\d{1,8}/gi;
const UK_POSTCODE = /(?<![A-Za-z0-9])(?:GIR 0AA|[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[ABD-HJLNP-UW-Z]{2})(?![A-Za-z0-9])/g;
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_ZIP_STATE = new RegExp(`(?<![A-Za-z])(?:${US_STATES})[ \\t,]{1,3}\\d{5}(?:-\\d{4})?(?![\\d-])`, 'g');
const POSTCODE_LABELLED = /(?<![A-Za-z])(?:zip(?:[ -]?code)?|postal[ -]?code|post[ -]?code|pin[ -]?code|pincode)[ \t]{0,3}[:#-]?[ \t]{0,3}(\d{5}(?:-\d{4})?|[1-9]\d{2}[ ]?\d{3}|[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2})(?![A-Za-z0-9])/gid;

function detectDobEmployeeAddress(text, out, regions) {
  each(DOB, text, (m) => {
    const [s, e] = m.indices[1];
    out.push(make('DOB', text, s, e, 0.9));
  });
  each(EMPLOYEE_LABELLED, text, (m) => {
    const [s, e] = m.indices[1];
    out.push(make('EMPLOYEE_ID', text, s, e, 0.9));
  });
  each(EMPLOYEE_PREFIXED, text, (m) => out.push(make('EMPLOYEE_ID', text, m.index, m.index + m[0].length, 0.7)));

  for (const re of [STREET_CLEAR, STREET_AMBIGUOUS]) {
    each(re, text, (m) => {
      if (streetOk(m[0])) out.push(make('ADDRESS', text, m.index, m.index + m[0].length, 0.7));
    });
  }
  each(PO_BOX, text, (m) => out.push(make('ADDRESS', text, m.index, m.index + m[0].length, 0.8)));
  if (regions.has('UK')) each(UK_POSTCODE, text, (m) => out.push(make('ADDRESS', text, m.index, m.index + m[0].length, 0.75)));
  if (regions.has('US')) each(US_ZIP_STATE, text, (m) => out.push(make('ADDRESS', text, m.index, m.index + m[0].length, 0.65)));
  each(POSTCODE_LABELLED, text, (m) => {
    const value = m[1];
    const isUs = /^\d{5}(?:-\d{4})?$/.test(value);
    const isIn = /^[1-9]\d{2} ?\d{3}$/.test(value);
    const ok = isUs ? regions.has('US') : isIn ? regions.has('IN') : regions.has('UK');
    if (!ok) return;
    const [s, e] = m.indices[1];
    out.push(make('ADDRESS', text, s, e, 0.75));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

function normalizeRegions(regions) {
  if (regions === undefined || regions === null) return new Set(REGIONS);
  const list = Array.isArray(regions) ? regions : [regions];
  const set = new Set();
  for (const r of list) {
    const up = String(r).toUpperCase();
    set.add(up === 'GB' ? 'UK' : up);
  }
  return set;
}

const PLACEHOLDER = /\[[A-Z]{2,12}_\d{1,6}\]/;

/**
 * Every candidate from every detector, BEFORE overlaps are resolved. The firewall merges these with the dictionary
 * findings and resolves them once; most callers want detect().
 * @param {string} text
 * @param {{regions?: string[], kinds?: string[], minConfidence?: number}} [options]
 */
export function detectCandidates(text, options = {}) {
  if (typeof text !== 'string' || !text) return [];
  const regions = normalizeRegions(options.regions);
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const min = typeof options.minConfidence === 'number' ? options.minConfidence : DEFAULT_MIN_CONFIDENCE;
  const want = (k) => !kinds || kinds.has(k);
  const found = [];
  if (want('EMAIL')) detectEmails(text, found);
  if (want('URL_CREDENTIALS')) detectUrlCredentials(text, found);
  if (want('SECRET')) detectSecrets(text, found);
  if (want('CARD')) detectCards(text, found);
  if (want('IBAN')) detectIbans(text, found);
  if (want('NATIONAL_ID')) detectNationalIds(text, found, regions);
  if (want('PHONE')) detectPhones(text, found, regions);
  if (want('IP') || want('MAC')) detectNetwork(text, found);
  if (want('DOB') || want('EMPLOYEE_ID') || want('ADDRESS')) detectDobEmployeeAddress(text, found, regions);
  // A finding that is, or contains, one of our own placeholders ([ID_1]) is never real data.
  return found.filter((f) => want(f.kind) && f.confidence >= min && !PLACEHOLDER.test(f.value));
}

/**
 * Resolve overlapping findings: the higher confidence wins, then the longer span, then the earlier start.
 * Runs in O(n log n) so a flood of matches cannot make it quadratic. Returns the survivors sorted by start.
 */
export function resolveOverlaps(findings) {
  const order = [...findings].sort((a, b) => b.confidence - a.confidence || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept = []; // sorted by start, never overlapping
  for (const f of order) {
    // binary search for the first kept finding that starts at or after f.start
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kept[mid].start < f.start) lo = mid + 1;
      else hi = mid;
    }
    const prev = kept[lo - 1];
    const next = kept[lo];
    if ((prev && prev.end > f.start) || (next && next.start < f.end)) continue;
    kept.splice(lo, 0, f);
  }
  return kept;
}

/**
 * Find PII and secrets in `text`.
 * @param {string} text
 * @param {{regions?: string[], kinds?: string[], minConfidence?: number}} [options]
 *   regions: which national formats to look for ('US', 'UK', 'IN'); default all.
 *   kinds: restrict to some of KINDS; default all.
 * @returns {{kind: string, start: number, end: number, value: string, confidence: number}[]} sorted by start, no overlaps
 */
export function detect(text, options = {}) {
  return resolveOverlaps(detectCandidates(text, options));
}
