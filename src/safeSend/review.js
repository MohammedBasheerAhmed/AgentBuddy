// The ONE review of text that is about to be put into a form field. ResultView (the Insert buttons on a result) and the Write
// screen both call it; there is no second copy to drift apart.
//
//   reviewForCustomer(text, { people, scan, internalTexts }) -> { serious: Finding[], hints: Finding[] }
//   reviewForInsert(field, text, opts)                       -> the same, for the field it goes into
//   isCustomerVisible(field)                                 -> from FILLABLE_FIELDS (src/lib/fillable.js)
//
// `serious` findings stop the insert until the person chooses "Insert anyway". `hints` are low severity (another person's name,
// an IP or MAC address, "escalated to"): shown as a non-blocking "Worth a look" list, never hidden.
//
// What it looks at, in one place:
//   - personal data and secrets (checkOutgoing, the same detectors the firewall uses), and what the firewall hid on the way out
//     and the model brought back (its own memory: `scan`)
//   - markup: a tag, [code], or a script link. A journal field shows [code] as HTML, and an article body is HTML
//   - links, as a "Worth a look" hint naming the site (a requester can plant a link in the ticket and ask for it in the reply)
//   - a placeholder that was never replaced, such as [PERSON_1]
//   - words copied from an internal work note of the same record (6 or more in a row); for resolution notes the insert flow
//     (src/sidepanel/insertFlow.js reviewInsert) and checkTypedText make that a hint
//   - the organisation's own internal-only phrases (policy `internalPhrases`), on top of the built-in ones
//
//   checkTypedText(field, text, opts)  -> "Check my comment": the same review for what the agent typed into the form themselves
//
// Findings never carry the value itself: only a masked excerpt and advice. This is a reviewer's aid, not a guarantee.

import { DEFAULT_INTERNAL_PHRASES, checkOutgoing, maskExcerpt } from './index.js';
import { isCustomerVisible } from '../lib/fillable.js';
import { tm, t as tr } from '../i18n/index.js';

export { isCustomerVisible };

/**
 * The internal-only phrases to look for: the built-in list plus the organisation's own (policy `internalPhrases`: team names, system
 * names, project code names). The organisation adds to the list; it never replaces the built-in phrases. Case and repeats aside.
 * @param {string[]|undefined} extra
 * @returns {string[]}
 */
export function phrasesWith(extra) {
  const out = [];
  const seen = new Set();
  for (const p of [...DEFAULT_INTERNAL_PHRASES, ...(Array.isArray(extra) ? extra : [])]) {
    const phrase = typeof p === 'string' ? p.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!phrase || seen.has(phrase.toLowerCase())) continue;
    seen.add(phrase.toLowerCase());
    out.push(phrase);
  }
  return out;
}

// Kinds the firewall masks on the way out and that must never come back into a message the customer reads.
const NEVER_BACK = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const NEVER_BACK_ADVICE = tm('This is a password, key, card number or ID that was hidden from the AI, and it is back in the draft. Remove it before it reaches the customer.');

const MARKUP_ADVICE = tm('This has markup in it (a tag, [code] or a script link). A form field can show it as live HTML. Remove it, or say it in words.');
const PLACEHOLDER_ADVICE = tm('A hidden-name marker such as [PERSON_1] is still in the text, where a real value belongs. Replace it before you use the text.');
// A password, card or ID number is never put back into an answer (src/pii/firewall.js NEVER_REHYDRATE), so its marker stays.
const KEPT_PLACEHOLDER = /^\[(?:SECRET|CARD|IBAN|ID)_\d+\]$/;
const KEPT_PLACEHOLDER_ADVICE = tm('A password, card or ID number stays hidden as a marker such as [CARD_1]. Remove the marker, or type the value yourself only if it really belongs here.');
const OVERLAP_ADVICE = tm('These words are also in an internal work note on this ticket. Check you may share them with the customer.');

// ---- Markup ---------------------------------------------------------------------------------------------------------

const MARKUP_PATTERNS = [
  /<\/?[A-Za-z!?]/g, // <img, </p>, <!--, <?xml
  /\[\/?code\]/gi, // [code] and [/code]: journal fields render these as HTML
  /\b(?:java|vb)script\s*:/gi,
];

/** Tags, [code] markers and script links. At most three are reported; each is one high finding. */
export function markupFindings(text) {
  const plain = String(text ?? '');
  const out = [];
  for (const pattern of MARKUP_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(plain)) !== null && out.length < 3) {
      const end = Math.min(plain.length, m.index + 40);
      out.push({ kind: 'MARKUP', severity: 'high', start: m.index, end: m.index + m[0].length, excerpt: plain.slice(m.index, end).replace(/\s+/g, ' ').slice(0, 24), advice: tr(MARKUP_ADVICE) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- Links ----------------------------------------------------------------------------------------------------------

// A link in a customer reply may have come from the ticket itself (a requester can write anything there and ask the model to repeat
// it). It is not blocked, links are normal, but it is named so the person sees where it points before the customer clicks it.
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;
const LINK_ADVICE = tm('This draft has a link in it. Check it goes where you mean before the customer reads it. It points to');

/** Links (http, https, www.) as low hints, one per site, at most three. The excerpt is the site's name only, never the path. */
export function linkFindings(text) {
  const plain = String(text ?? '');
  const out = [];
  const hosts = new Set();
  LINK.lastIndex = 0;
  let m;
  while ((m = LINK.exec(plain)) !== null && out.length < 3) {
    let host;
    try {
      // (the URL parser writes an international name in its xn-- form, so a look-alike name shows as what it is)
      host = new URL(/^www\./i.test(m[0]) ? `https://${m[0]}` : m[0]).hostname;
    } catch {
      host = '';
    }
    host = host.slice(0, 80) || 'an address that could not be read';
    if (hosts.has(host)) continue;
    hosts.add(host);
    out.push({ kind: 'LINK', severity: 'low', start: m.index, end: m.index + m[0].length, excerpt: host, advice: tr(LINK_ADVICE) });
  }
  return out;
}

// ---- Placeholders ---------------------------------------------------------------------------------------------------

const PLACEHOLDER = /\[[A-Z][A-Z_]*_\d+\]/g;

/** `[PERSON_1]`-style markers the firewall wrote and nobody turned back into a value. At most three. */
export function placeholderFindings(text, severity = 'medium') {
  const plain = String(text ?? '');
  const out = [];
  PLACEHOLDER.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER.exec(plain)) !== null && out.length < 3) {
    const advice = KEPT_PLACEHOLDER.test(m[0]) ? KEPT_PLACEHOLDER_ADVICE : PLACEHOLDER_ADVICE;
    out.push({ kind: 'PLACEHOLDER', severity, start: m.index, end: m.index + m[0].length, excerpt: m[0], advice: tr(advice) });
  }
  return out;
}

// ---- Words copied from an internal note -----------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
const MAX_INTERNAL_TEXTS = 30;
const MAX_INTERNAL_CHARS = 20000;

function wordsWithOffsets(text) {
  const words = [];
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(text)) !== null) words.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return words;
}

/**
 * A run of `minWords` or more words in a row that also stands in one of `internalTexts` (the work notes of the same record).
 * Case and punctuation do not matter. Short runs of small words (under `minChars` characters) are ignored. At most three.
 */
export function overlapFindings(text, internalTexts, { minWords = 6, minChars = 24 } = {}) {
  const notes = (Array.isArray(internalTexts) ? internalTexts : []).filter((t) => typeof t === 'string' && t.trim()).slice(0, MAX_INTERNAL_TEXTS);
  if (!notes.length) return [];
  const seen = new Set();
  for (const note of notes) {
    const words = wordsWithOffsets(note.slice(0, MAX_INTERNAL_CHARS));
    for (let i = 0; i + minWords <= words.length; i += 1) seen.add(words.slice(i, i + minWords).map((x) => x.w).join(' '));
  }
  if (!seen.size) return [];
  const plain = String(text ?? '');
  const words = wordsWithOffsets(plain);
  const out = [];
  let i = 0;
  while (i + minWords <= words.length && out.length < 3) {
    const key = words.slice(i, i + minWords).map((x) => x.w).join(' ');
    if (!seen.has(key) || key.length < minChars) {
      i += 1;
      continue;
    }
    // Take the whole run: every following window that also matches extends it by one word.
    let last = i + minWords - 1;
    while (last + 1 < words.length && seen.has(words.slice(last + 2 - minWords, last + 2).map((x) => x.w).join(' '))) last += 1;
    const start = words[i].start;
    const end = words[last].end;
    out.push({ kind: 'INTERNAL_NOTE', severity: 'medium', start, end, excerpt: maskExcerpt(plain.slice(start, end)), advice: tr(OVERLAP_ADVICE) });
    i = last + 1;
  }
  return out;
}

// ---- The review -----------------------------------------------------------------------------------------------------

// What the firewall hid on the way out and the model brought back, as findings (only the kinds that must never come back).
function rememberedFindings(plain, scan, alreadyFound) {
  let remembered = [];
  try {
    remembered = (typeof scan === 'function' ? scan(plain) : []).filter((f) => NEVER_BACK.has(f.kind));
  } catch {
    /* the text check still applies */
  }
  return remembered
    .filter((f) => !alreadyFound.some((g) => g.start < f.end && f.start < g.end))
    .map((f) => ({ kind: f.kind, severity: 'high', start: f.start, end: f.end, excerpt: maskExcerpt(f.value), advice: tr(NEVER_BACK_ADVICE) }));
}

const byPosition = (a, b) => a.start - b.start || b.end - a.end;
const split = (all) => ({ serious: all.filter((f) => f.severity !== 'low'), hints: all.filter((f) => f.severity === 'low') });

/**
 * Review text that the customer (or the reader of an article) will be able to read.
 * @param {string} text the text about to be inserted
 * @param {{ people?: object[], scan?: (text: string) => object[], internalTexts?: string[] }} [options]
 *   people: the record's people (their own email addresses are not flagged); scan: the firewall's scan() from the run that
 *   produced the text; internalTexts: the record's work notes
 * @returns {{ serious: object[], hints: object[] }} findings: { kind, severity, start, end, excerpt, advice }
 */
export function reviewForCustomer(text, { people = [], scan = null, internalTexts = [], internalPhrases, overlapSeverity = 'medium' } = {}) {
  const plain = String(text ?? '');
  // The organisation's phrases are ADDED to the built-in ones; without any, checkOutgoing uses its defaults as before.
  const phrases = Array.isArray(internalPhrases) && internalPhrases.length ? phrasesWith(internalPhrases) : undefined;
  const base = checkOutgoing(plain, { people, internalPhrases: phrases }).findings;
  const seriousBase = base.filter((f) => f.severity !== 'low');
  const all = [
    ...base,
    ...rememberedFindings(plain, scan, seriousBase),
    ...markupFindings(plain),
    ...linkFindings(plain),
    ...placeholderFindings(plain, 'medium'),
    ...overlapFindings(plain, internalTexts).map((f) => ({ ...f, severity: overlapSeverity === 'low' ? 'low' : f.severity })),
  ].sort(byPosition);
  return split(all);
}

/**
 * Review text for the field it is going into. A field the customer can read gets the whole review; an internal one (work notes)
 * still gets the markup check (journal fields render [code] as HTML) and a note about a leftover placeholder.
 * options: people, scan, internalTexts, internalPhrases (the organisation's, added to the built-in list).
 */
export function reviewForInsert(field, text, options = {}) {
  if (isCustomerVisible(field)) return reviewForCustomer(text, options);
  const plain = String(text ?? '');
  return split([...markupFindings(plain), ...placeholderFindings(plain, 'low')].sort(byPosition));
}

// Resolution notes repeat what was done, usually written in a work note first: six shared words are expected there, not a leak.
const OVERLAP_IS_A_HINT = new Set(['close_notes', 'fix_notes', 'cause_notes']);

// ---- "Check my comment": what the agent TYPED ---------------------------------------------------------------------------

/**
 * The safe-to-send check for text the agent typed into the form themselves (not text Agent Buddy inserts): the same review as an
 * insert into that field. A field the customer cannot read (a work note) is said to be internal instead of being checked.
 * @param {string} field the form field the text is in (comments, close_notes, description, ...)
 * @param {string} text what is in the field now
 * @param {{ people?: object[], internalTexts?: string[], internalPhrases?: string[] }} [options]
 * @returns {{ status: 'empty' | 'internal' | 'clean' | 'findings', serious: object[], hints: object[] }}
 *   clean: nothing found (which does not prove the text is safe); findings: at least one serious finding or hint
 */
export function checkTypedText(field, text, options = {}) {
  const plain = String(text ?? '');
  if (!plain.trim()) return { status: 'empty', serious: [], hints: [] };
  if (!isCustomerVisible(field)) return { status: 'internal', serious: [], hints: [] };
  // Resolution notes are written from the work notes: shared words are a hint there, as for an insert (src/sidepanel/insertFlow.js).
  const { serious, hints } = reviewForCustomer(plain, { ...options, overlapSeverity: OVERLAP_IS_A_HINT.has(field) ? 'low' : 'medium' });
  return { status: serious.length || hints.length ? 'findings' : 'clean', serious, hints };
}

/**
 * The work notes of a pack (internal, never meant for the customer), as a list of texts for reviewForCustomer's `internalTexts`.
 * Kept in memory with the result of a run and nowhere else.
 */
export function internalTextsOf(pack) {
  const journal = Array.isArray(pack?.journal) ? pack.journal : [];
  return journal
    .filter((entry) => entry && entry.type === 'work_note' && typeof entry.text === 'string' && entry.text.trim())
    .map((entry) => entry.text)
    .slice(-MAX_INTERNAL_TEXTS);
}
