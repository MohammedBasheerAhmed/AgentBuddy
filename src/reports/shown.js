// An English text written by the reports engine, shown in the language of the panel.
//
// The engine runs in the ServiceNow page and writes English only (src/reports/engine/say.js), and the AI reads the same words, so
// the numbers it returns stay English. The side panel calls shown(text) where it draws such a text. The Arabic is found by the English
// text, as everywhere else: an exact entry, or an entry with {names} that the text fills ("No update in 3+ days" fits
// "No update in {days}+ days"). A text with no entry is shown as it is.
//
// (It imports the mechanism, src/i18n/core.js, not the catalogue: the page that draws registers that, and the engine, which is also
// bundled into the ServiceNow page, can use it for its own tables without carrying the Arabic.)
//
// Only call it for words the engine or the panel wrote ("Open", "Some tables could not be counted"), never for ticket data (a state,
// a group, a person): "Open" as a state of a ticket is the instance's word and must stay as it is.
import { catalogueOf, getLanguage, isolate, t as translate, tm } from '../i18n/core.js';

// A few English words are a button in one place and a label in another ("Open": افتح, but مفتوحة above a count). The label has its own
// entry, used here.
const AS_LABEL = { Open: tm('Open (tickets)') };

// The {names} whose value is itself an engine text ("{table}: {note}"); any other value is data and is only isolated.
const TEXT_SLOTS = new Set(['note', 'reason', 'table', 'measure', 'groupBy', 'hint', 'text', 'what', 'where', 'units', 'window']);

// The {names} that hold a number, and the ones that may hold several sentences: a slot is only as wide as its kind of value, so a long
// text is not taken for a short entry ("Incidents: number of tickets" is not "{count} tickets").
const NUMERIC_SLOTS = new Set(['n', 'count', 'total', 'days', 'hours', 'min', 'max', 'fetched', 'looked', 'used', 'shown', 'multi', 'reopened', 'threshold', 'percent', 'words', 'h', 'm', 'd', 'sampleMax', 'NOTABLE_MAX']);
const LONG_SLOTS = new Set(['note', 'reason', 'hint']);
const slotPattern = (name) => {
  if (NUMERIC_SLOTS.has(name)) return '([-+]?[\\d.,]+%?)';
  if (LONG_SLOTS.has(name)) return '([\\s\\S]+?)';
  return name === 'table' ? '((?:(?!: |\\. )[\\s\\S])+?)' : '((?:(?!\\. )[\\s\\S])+?)';
};

const SLOT = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBERISH = /^[-+]?[\d.,]+%?$/;
const MAX_DEPTH = 3;

const lookup = (table, key) => {
  const found = table[key];
  return typeof found === 'string' && found ? found : undefined;
};

const compiled = new WeakMap();
/** The entries with {names}, as patterns, the most specific (the most fixed words) first. */
function templatesOf(table) {
  let list = compiled.get(table);
  if (list) return list;
  list = [];
  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== 'string' || !value || !/\{[A-Za-z]/.test(key)) continue;
    const literal = key.replace(SLOT, '');
    if (!/[A-Za-z]{2}/.test(literal)) continue; // "{a}: {b}" alone would fit everything
    const names = [];
    let pattern = '';
    let last = 0;
    for (const m of key.matchAll(SLOT)) {
      pattern += escapeRegex(key.slice(last, m.index)) + slotPattern(m[1]);
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    pattern += escapeRegex(key.slice(last));
    list.push({ key, names, weight: literal.length, texts: names.filter((n) => TEXT_SLOTS.has(n)).length, re: new RegExp('^' + pattern + '$') });
  }
  // The same words twice: the entry whose {names} are texts of the engine comes first ("{table}: ..." before "{name}: ...").
  list.sort((a, b) => b.weight - a.weight || b.texts - a.texts);
  compiled.set(table, list);
  return list;
}

function slotValue(name, value, table, depth) {
  if (NUMBERISH.test(value)) return value;
  if (TEXT_SLOTS.has(name)) {
    const done = convert(value, table, depth);
    if (done !== undefined) return done;
  }
  return isolate(value);
}

function fromTemplate(text, table, depth) {
  for (const tpl of templatesOf(table)) {
    const hit = tpl.re.exec(text);
    if (!hit) continue;
    const params = {};
    tpl.names.forEach((name, i) => {
      params[name] = slotValue(name, hit[i + 1], table, depth + 1);
    });
    return translate(tpl.key, params);
  }
  return undefined;
}

// "Incidents: SLA information is not available to you." or "INC0010001: comments could not be read": a name, a colon, a text.
function fromLabelled(text, table, depth) {
  const hit = /^([^:\n]{1,80}): ([\s\S]+)$/.exec(text);
  if (!hit) return undefined;
  const head = convert(hit[1], table, depth + 1);
  const rest = convert(hit[2], table, depth + 1);
  if (head === undefined && rest === undefined) return undefined;
  return `${head ?? isolate(hit[1])}: ${rest ?? hit[2]}`;
}

// Several sentences written one after the other ("... Choose groups again. No longer active: A.").
function fromSentences(text, table, depth) {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"(])/);
  if (parts.length < 2) return undefined;
  let changed = false;
  const out = [];
  let i = 0;
  while (i < parts.length) {
    // The longest run of sentences that is one entry ("... left out. Choose groups again."), else the sentence on its own.
    let taken = 0;
    for (let j = parts.length; j > i && !taken; j -= 1) {
      const run = parts.slice(i, j).join(' ');
      const done = j - i > 1 ? direct(run, table, depth + 1) : convert(run, table, depth + 1);
      if (done !== undefined) {
        out.push(done);
        taken = j - i;
        changed = true;
      }
    }
    if (!taken) {
      out.push(parts[i]);
      taken = 1;
    }
    i += taken;
  }
  return changed ? out.join(' ') : undefined;
}

// The text as one of the entries: the label word, the exact text, its capitalised form, or an entry with {names}.
function direct(text, table, depth) {
  const label = AS_LABEL[text] ? lookup(table, AS_LABEL[text]) : undefined;
  if (label) return label;
  const exact = lookup(table, text);
  if (exact) return exact;
  // The engine lower-cases a word it puts inside a sentence ("number of tickets by state").
  const first = text[0];
  if (first !== first.toUpperCase()) {
    const capital = lookup(table, first.toUpperCase() + text.slice(1));
    if (capital) return capital;
  }
  return depth >= MAX_DEPTH ? undefined : fromTemplate(text, table, depth);
}

function convert(text, table, depth) {
  if (!text) return undefined;
  const whole = direct(text, table, depth);
  if (whole !== undefined) return whole;
  // A text that is an entry without its full stop ("Tickets that are still active" in "... active. Some tables could not be counted.").
  if (text.endsWith('.')) {
    const bare = direct(text.slice(0, -1), table, depth + 1);
    if (bare !== undefined) return `${bare}.`;
  }
  if (depth >= MAX_DEPTH) return undefined;
  return fromLabelled(text, table, depth) ?? fromSentences(text, table, depth);
}

let cache = new Map();
let cacheTable = null;

/** `text` (written in English by the engine) in the language of the panel; the text itself when there is no entry for it. */
export function shown(text) {
  if (typeof text !== 'string' || !text) return text;
  const language = getLanguage();
  const table = language === 'en' ? null : catalogueOf(language);
  if (!table) return text;
  if (cacheTable !== table) {
    cache = new Map();
    cacheTable = table;
  }
  if (cache.has(text)) return cache.get(text);
  const out = convert(text, table, 0) ?? text;
  if (cache.size > 3000) cache.clear();
  cache.set(text, out);
  return out;
}

/** "Open, In my groups" (a list the engine joined with commas), each part shown in the language of the panel. */
export function shownList(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.split(', ').map(shown).join(translate(', '));
}

// The names the engine gives a row that has no value ('(unassigned)', '(no group)', '(none)', '(empty)', 'Unknown'). Any other name is data.
const PLACEHOLDERS = new Set(['(unassigned)', '(no group)', '(none)', '(empty)', 'Unknown']);

/** A name from a report row: the engine's own word for "nobody" shown in the language of the panel, any other name as it is. */
export const placeholderName = (name) => (PLACEHOLDERS.has(name) ? shown(name) : name);

// Texts the ServiceNow page writes outside the reports engine (src/content/ops/reports.js, the group search and the list of the
// person's groups), marked here so that their Arabic is found when the panel draws them with shown().
export const CONTENT_TEXTS = Object.freeze([
  tm('Type at least two letters of the group name.'),
  tm('Groups are not available to you.'),
  tm('No group matches.'),
  tm('You are not a member of any active group that you can see.'),
  tm('Your group memberships are not available to you.'),
]);
