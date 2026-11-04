// The words of the panel, in the language the person chose (English or Arabic).
//
// How it works: the English text is the key. `t('Turn on for this site')` returns that text in English, and in Arabic the entry of
// the same English text in src/i18n/ar/*.js. A text with no entry is shown in English, so a missing translation is a gap in the
// words, never an empty button. Values that change go in as {name} and are never part of the key:
//
//     t('Related tickets ({count})', { count })
//     tn(count, '{n} ticket', '{n} tickets', { n: count })    // the plural forms of the language decide (Arabic has six)
//
// Rules for every text that reaches a person:
//  - ticket data, names, record numbers, field values and anything the AI wrote are not translated: they are shown as they are.
//    Put them in as {name} so a right-to-left sentence keeps them whole (see isolate()).
//  - the English text is the key, so changing an English word means changing its Arabic entry: tests/i18n.test.js fails when a
//    text used in the code has no entry, when an entry is not used, and when the {name}s of an entry differ from its key.
//  - fixed prompts for the AI (src/features) stay English; they are not shown to a person.
//
// Pure module: no React and no chrome.* needed (the language is set by the root of each page, see useLanguage.js).
// This file is the mechanism; ./index.js is the same API with the whole Arabic catalogue registered.

/** The languages Settings offers. `auto` follows the browser's own language. */
export const LANGUAGES = Object.freeze([
  Object.freeze({ id: 'auto', name: 'Same as the browser' }),
  Object.freeze({ id: 'en', name: 'English' }),
  Object.freeze({ id: 'ar', name: 'العربية' }),
]);
export const SUPPORTED = Object.freeze(['en', 'ar']);

// Catalogues are added by whoever needs them (index.js registers the whole Arabic catalogue for the pages; the bar on the ServiceNow
// page registers only its own few texts, so its script stays small).
const CATALOGUES = {};

/** Add texts for a language. Later entries win. */
export function registerCatalogue(code, table) {
  CATALOGUES[code] = { ...(CATALOGUES[code] || {}), ...table };
}
const RIGHT_TO_LEFT = new Set(['ar', 'he', 'fa', 'ur']);

let current = 'en';

/** The language to use: the person's choice, or for `auto` the browser's language when it is one we have, else English. */
export function resolveLanguage(setting, browserLocale = '') {
  const pick = String(setting || 'auto').toLowerCase();
  if (SUPPORTED.includes(pick)) return pick;
  const base = String(browserLocale || '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(base) ? base : 'en';
}

/** The language of the browser's own interface (chrome.i18n), or of the page when that is not there (tests). */
export function browserLanguage() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) return chrome.i18n.getUILanguage();
  } catch {
    /* no extension API here */
  }
  return typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en';
}

export function setLanguage(code) {
  current = SUPPORTED.includes(code) ? code : 'en';
  return current;
}

export const getLanguage = () => current;
export const isRtl = (code = current) => RIGHT_TO_LEFT.has(code);
/** The `dir` attribute for the page. */
export const direction = (code = current) => (isRtl(code) ? 'rtl' : 'ltr');

const PARAM = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function fill(text, params) {
  if (!params) return text;
  return text.replace(PARAM, (whole, name) => (Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole));
}

/** The text in the current language. `params` fill the {name}s. */
export function t(text, params) {
  const table = CATALOGUES[current];
  const found = table ? table[text] : undefined;
  return fill(typeof found === 'string' && found ? found : text, params);
}

/**
 * Mark a text for translation where it is written down but shown later: `const LABELS = { open: tm('Open') }` and then
 * `t(LABELS[state])`. It returns the text unchanged; the checks (scripts/lib/i18nCheck.js) read it as a key.
 */
export const tm = (text) => text;

const PLURAL_RULES = {};
const pluralCategory = (code, count) => {
  PLURAL_RULES[code] = PLURAL_RULES[code] || new Intl.PluralRules(code);
  return PLURAL_RULES[code].select(Math.abs(Number(count)));
};

/**
 * A text with a count. English: `one` for 1, else `other` ({n} is the count unless `params` says otherwise). Another language:
 * the entry for `${one}|${other}` is an object with the plural categories of that language (Arabic: zero, one, two, few, many, other).
 */
export function tn(count, one, other, params = {}) {
  const all = { n: count, ...params };
  const table = CATALOGUES[current];
  const entry = table ? table[`${one}|${other}`] : undefined;
  if (entry && typeof entry === 'object') {
    const form = entry[pluralCategory(current, count)] || entry.other;
    if (form) return fill(form, all);
  }
  return fill(Number(count) === 1 ? one : other, all);
}

// Unicode isolates: ticket data placed in a sentence of the other direction ("INC0010001" inside Arabic) keeps its own order and
// does not pull the punctuation around it into the wrong place.
const FSI = '⁨';
const PDI = '⁩';
/** Wrap a value that is not part of the sentence's language (a record number, a name, an address) so it reads whole. */
export const isolate = (value) => (isRtl() && value !== undefined && value !== null && value !== '' ? `${FSI}${value}${PDI}` : String(value ?? ''));

/** A number as the panel writes it: ASCII digits in every language (ServiceNow and the record numbers use them). */
export function formatNumber(value, options) {
  try {
    // (the Arabic formats add direction marks around a sign or a percent sign; they are not wanted in a sentence)
    return new Intl.NumberFormat(isRtl() ? 'ar-u-nu-latn' : 'en', options).format(value).replace(/[‎‏؜]/g, '');
  } catch {
    return String(value);
  }
}

/** The English texts that have an entry in a language (for the tests and for the coverage check). */
export const catalogueOf = (code) => CATALOGUES[code] || null;
