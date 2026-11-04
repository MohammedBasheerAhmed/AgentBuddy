// Record-aware name dictionary. Built from ContextPack.people, so it knows exactly who is on THIS ticket and can mask
// them precisely: full names ("Abel Tuter", "Tuter, Abel"), first and last name tokens, possessives ("Abel's"),
// email addresses and email local parts ("abel.tuter").
//
// What it cannot do: find a name that is not in `people`. A colleague mentioned in a work note who is not one of the
// record's people is only caught if a detector matches something else near them (an email, a phone). That is a limit of
// the approach, and firewall.js says so too.
//
// Matching is on word tokens, not on substrings: "Abel" never matches inside "Abelian", the comparison ignores case and
// accents ("JOSE" matches "Jose" and "Jos" + combining accent), and works for any script with word separators. Scripts
// written without spaces (Chinese, Japanese, Thai...) fall back to plain substring matching for those names.
//
// Ambiguity is handled honestly: if two people share a token ("Beth Anglin" and "Beth Jones"), a bare "Beth" is not
// attributed to either; it gets its own placeholder instead of being guessed.

import { foldArabicLetters } from './arabic.js';

const APOSTROPHES = "'" + String.fromCharCode(0x2019);
// A word is letters, marks and digits with apostrophes inside it (O'Brien). A hyphen separates words: "Abel-Tuter" is two.
const WORD = new RegExp(`[\\p{L}\\p{M}\\p{N}_]+(?:[${APOSTROPHES}][\\p{L}\\p{M}\\p{N}_]+)*`, 'gu');
const JOINERS = new RegExp(`[${APOSTROPHES}]`); // apostrophes inside a name token (D'Souza)
const ASCII_ONLY = /^\p{ASCII}*$/u;
const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const CURLY_APOS = String.fromCharCode(0x2019);
// Scripts written without spaces between words: names in them are matched as substrings.
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const OPENERS = new Set([' ', '\t', '"', "'", '(', '[', String.fromCharCode(0x201c), String.fromCharCode(0x2018)]);

/** Lowercase and strip accents. ASCII takes a fast path. */
export function fold(s) {
  if (ASCII_ONLY.test(s)) return s.toLowerCase();
  // (Arabic spellings are made one before the text is put back together: a hamza is a combining mark until then)
  return foldArabicLetters(s.normalize('NFD').replace(COMBINING, '')).normalize('NFC').toLowerCase().split(CURLY_APOS).join("'");
}

/** Lowercase text while keeping every index aligned with the original (a few characters change length when lowercased). */
export function alignedLower(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = '';
  for (const ch of text) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

// Words that are ordinary vocabulary AND plausible name tokens ("Mark", "Will", "Grace", "Brown"), plus ticket
// vocabulary. A name token in this set is masked only when it is capitalised in the middle of a sentence; the full name
// is always masked. This is the trade-off between leaking a first name and wrecking every sentence that has "will".
export const COMMON_WORDS = new Set(
  (
    'will mark grace hope faith joy bill pat art don dawn summer april may june august amber ruby violet rose lily daisy ' +
    'holly ivy sandy chase frank gene guy jay rich cash king young long short brown white black green gray grey hill ' +
    'stone wood woods fox wolf bird baker cook miller taylor carter cooper fisher hunter page price rice strong sharp ' +
    'swift bell bass case lane park reed wells west north east south field fields banks parks mills hall ford love pope ' +
    'church law moss rush ward watch wise gold day dean duke hood knight lord mason pierce prince queen rank sage shaw ' +
    'snow steel sweet wild wing wright bond bush cross crow dale dash drake flint fort frost glass grant hunt lamb lark ' +
    'lock marsh moon noble penny pine plant power powers rain rider river rock ross salt sand silver smart spring star ' +
    'storm swan tanner tower trace trail wall wash wave wheel york bank blue bright brook brooks brand clay clear cole ' +
    'crane dark dove dream fair fall farm fast fish flood flower forest free hand hardy hawk heath hold house key kind ' +
    'lake last leaf mill miles monk nice oak olive orange pace paint patch peak pearl pink pool post pound prime pride ' +
    'quick race reach rest ring rise road robin root round royal rule safe sale sell test user users admin administrator ' +
    'system service services support help helpdesk desk team ticket tickets incident request change problem task data ' +
    'mail email server network access account password reset login logon manager director analyst engineer agent owner ' +
    'customer client caller contact people person group department office site location company business global ' +
    'general main primary secondary default custom standard basic simple common public private internal external ' +
    'open close closed done new old first second third final next previous current latest recent early late high low ' +
    'good great best better little small large big full half more most less least many much some any all none other ' +
    'only just also then than that this these those there here where when what which while with without within about ' +
    'above below after before again against between during from into over under until upon very been being have has ' +
    'had does did could would should shall might must need needs want wants like make made take took give gave find ' +
    'found keep kept call called work works worked working use used using look looks looked see saw seen say said ' +
    'tell told ask asked try tried let put set get got put run ran bad fine sure true real right left back down off ' +
    'out in on at by for to of or and not nor but yet so if as is it an be do go no yes up we he she they you me him ' +
    'her them his its our their your mine ours yours the a can may day week month year time today tomorrow yesterday ' +
    'morning evening night noon hour minute second monday tuesday wednesday thursday friday saturday sunday january ' +
    'february march july september october november december'
  ).split(/\s+/)
);

// Name particles: part of a full name, never masked on their own.
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'dos', 'das', 'del', 'della', 'dei', 'bin', 'bint', 'ibn', 'abu', 'ben', 'ter', 'ten', 'zur', 'zum', 'mrs', 'mister', 'miss', 'prof', 'professor', 'sir', 'madam']);

// Accounts that are not people. "System Administrator" in prose is just prose.
const NOT_A_PERSON = new Set(['system administrator', 'system', 'admin', 'administrator', 'guest', 'servicenow', 'service account', 'itil', 'root', 'anonymous', 'unknown', 'none', 'n/a', 'tbd', 'api user', 'integration user']);

// Shared mailboxes: the local part of "info@" or "helpdesk@" names a function, not a person, so it is not a username.
const SHARED_MAILBOXES = new Set([
  'info', 'admin', 'administrator', 'support', 'helpdesk', 'servicedesk', 'itsupport', 'help', 'hr', 'it', 'sales', 'contact',
  'noreply', 'donotreply', 'service', 'services', 'team', 'office', 'billing', 'accounts', 'accounting', 'security', 'webmaster',
  'postmaster', 'hello', 'mail', 'email', 'notifications', 'alerts', 'jobs', 'careers', 'press', 'marketing', 'finance', 'legal',
  'ops', 'devops', 'privacy', 'abuse', 'enquiries', 'inquiries', 'reception', 'orders', 'feedback',
]);

const letterCount = (s) => (s.match(/\p{L}/gu) || []).length;
// Marks are kept: a Devanagari or Arabic word often ends in a combining mark that is part of the word.
const trimPunct = (s) => s.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
// A name needs at least one letter or digit ("..." and "-" are junk).
const nameStr = (v) => {
  const s = str(v);
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
};

function newNode() {
  return { kids: new Map(), hit: null };
}

// "Tuter, Abel" and "Abel Tuter" give the same token lists.
function nameTokens(name) {
  const comma = name.indexOf(',');
  const parts = comma === -1 ? [name] : [name.slice(0, comma), name.slice(comma + 1)];
  const lists = parts.map((p) => p.split(/[\s-]+/).map(trimPunct).filter(Boolean)); // "Mary-Jane" is two tokens
  if (comma === -1 || !lists[0].length || !lists[1].length) return { forward: lists.flat(), written: lists.flat() };
  return { forward: [...lists[1], ...lists[0]], written: [...lists[0], ...lists[1]] };
}

/**
 * @param {{role?: string, name?: string, email?: string, sysId?: string, prose?: boolean}[]} people ContextPack.people. An entry
 *   with `prose: true` is a name the firewall found written in the text itself (src/pii/names.js), not one the record lists: it
 *   is matched only where its first word is capitalised ("Tom", not "tom"), so a wrong guess cannot mask an ordinary word everywhere.
 */
export function createDictionary(people = []) {
  const root = newNode();
  const literals = []; // { term, kind, entity, canonical, confidence, boundary }
  const identities = new Map(); // key -> identity
  const byId = [];

  // 1. People who are the same human (same sysId, or same email) share one identity, whatever their role.
  for (const p of Array.isArray(people) ? people : []) {
    if (!p || typeof p !== 'object') continue;
    const name = nameStr(p.name);
    const email = str(p.email).toLowerCase();
    const sysId = str(p.sysId).toLowerCase();
    if (NOT_A_PERSON.has(fold(name))) {
      if (!email) continue;
    }
    const keys = [];
    if (sysId) keys.push(`sys:${sysId}`);
    if (email) keys.push(`mail:${email}`);
    if (!keys.length && name) keys.push(`name:${fold(name)}`);
    if (!keys.length) continue;
    let identity = keys.map((k) => identities.get(k)).find(Boolean);
    if (!identity) {
      identity = { id: `p${byId.length + 1}`, canonical: '', names: [], emails: new Set(), prose: p.prose === true };
      byId.push(identity);
    }
    if (p.prose !== true) identity.prose = false; // the record lists them too: matched as a record person
    for (const k of keys) identities.set(k, identity);
    if (name && !NOT_A_PERSON.has(fold(name))) {
      identity.names.push(name);
      if (!identity.canonical) identity.canonical = name;
    }
    if (email) {
      identity.emails.add(email);
      if (!identity.canonical) identity.canonical = email;
    }
  }

  // 2. Terms. `capOnly`: matched only where the first word is capitalised (names found in prose).
  function addSequence(tokens, identity, confidence, conditional) {
    const capOnly = identity.prose === true;
    let node = root;
    for (const t of tokens) {
      const key = fold(t);
      if (!node.kids.has(key)) node.kids.set(key, newNode());
      node = node.kids.get(key);
    }
    if (!node.hit) node.hit = { ids: new Set(), conditional, confidence, capOnly };
    node.hit.ids.add(identity.id);
    node.hit.conditional = node.hit.conditional && conditional;
    node.hit.capOnly = node.hit.capOnly && capOnly; // a record person with the same words makes them unconditional again
    node.hit.confidence = Math.max(node.hit.confidence, confidence);
  }

  function addSingle(token, identity) {
    const f = fold(token);
    if (PARTICLES.has(f) || /^\d+$/.test(f)) return;
    const noSpace = NO_SPACE_SCRIPT.test(token);
    if (noSpace) {
      if (letterCount(token) >= 2) literals.push({ term: token.toLowerCase(), kind: 'PERSON', entity: identity.id, confidence: 0.9, boundary: false });
      return;
    }
    if (letterCount(f) < 3) return;
    const common = COMMON_WORDS.has(f);
    addSequence([token], identity, common ? 0.8 : 0.9, common);
  }

  for (const identity of byId) {
    for (const name of identity.names) {
      const { forward, written } = nameTokens(name);
      if (forward.length >= 2) {
        // Full name, in the order of the record and in natural order, with and without middle names.
        addSequence(forward, identity, 0.97, false);
        addSequence(written, identity, 0.97, false);
        const last = forward[forward.length - 1];
        addSequence([last, ...forward.slice(0, -1)], identity, 0.97, false); // "Tuter, Abel" and "Smith, Mary Ann"
        if (forward.length >= 3) {
          addSequence([forward[0], last], identity, 0.97, false);
          addSequence([last, forward[0]], identity, 0.97, false);
        }
        // Concatenated forms such as "AbelTuter" are not matched; they are rare in ticket text.
      }
      for (const token of forward) {
        addSingle(token, identity);
        // "Mary-Jane" and "D'Souza": the parts can stand alone too.
        if (JOINERS.test(token)) for (const part of token.split(JOINERS)) addSingle(part, identity);
      }
      if (NO_SPACE_SCRIPT.test(name) && forward.length >= 2) {
        // A Japanese name written with a space is also written without one.
        literals.push({ term: forward.join('').toLowerCase(), kind: 'PERSON', entity: identity.id, confidence: 0.97, boundary: false });
      }
    }
    for (const email of identity.emails) {
      literals.push({ term: email, kind: 'EMAIL', entity: null, confidence: 0.99, boundary: true });
      const local = email.slice(0, email.indexOf('@'));
      const f = fold(local);
      // "abel.tuter" on its own is a username for this person; "admin" or "support" is a shared mailbox, not a person.
      if (local && f.length >= 4 && !COMMON_WORDS.has(f) && !SHARED_MAILBOXES.has(f)) literals.push({ term: local, kind: 'PERSON', entity: identity.id, confidence: 0.93, boundary: true });
    }
  }

  // Tokens that two different people share are ambiguous: do not guess whose they are.
  function resolveEntity(hit, folded) {
    return hit.ids.size === 1 ? { entity: [...hit.ids][0], ambiguous: false } : { entity: `amb:${folded}`, ambiguous: true };
  }
  const canonicalOf = (entity) => byId.find((i) => i.id === entity)?.canonical;

  // Does a sentence (or a quoted sentence, after a colon) begin at `pos`? Looks back over spaces, quotes and brackets.
  function sentenceStart(text, pos) {
    let k = pos - 1;
    let quoted = false;
    while (k >= 0 && OPENERS.has(text[k])) {
      if (text[k] === '"' || text[k] === String.fromCharCode(0x201c)) quoted = true;
      k--;
    }
    if (k < 0) return true;
    const ch = text[k];
    return ch === '\n' || ch === '\r' || ch === '.' || ch === '!' || ch === '?' || (quoted && ch === ':');
  }

  const isUpperFirst = (s) => {
    const c = [...s][0];
    return c !== c.toLowerCase();
  };

  const GAP = /^(?:\.?[ \t\xa0]{1,3}|[ \t\xa0]{0,2},[ \t\xa0]{0,2}|-)$/;
  const MERGE_GAP = /^[ \t\xa0]{1,2}$/;

  function nameFindings(text, unconditionalOnly) {
    const found = [];
    if (!root.kids.size) return found;
    const tokens = [];
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(text)) !== null) {
      const f = fold(m[0]);
      const poss = f.endsWith("'s") && f.length > 3 ? f.slice(0, -2) : null;
      tokens.push({ start: m.index, end: m.index + m[0].length, fold: f, poss, possEnd: m.index + m[0].length - 2 });
    }
    for (let i = 0; i < tokens.length; i++) {
      let node = root;
      let best = null;
      for (let j = i; j < tokens.length; j++) {
        const t = tokens[j];
        if (j > i && !GAP.test(text.slice(tokens[j - 1].end, t.start))) break;
        let child = node.kids.get(t.fold);
        let possessive = false;
        if (!child && t.poss) {
          child = node.kids.get(t.poss);
          possessive = true;
        }
        if (!child) break;
        node = child;
        if (node.hit) best = { hit: node.hit, last: j, end: possessive ? t.possEnd : t.end, folded: possessive ? t.poss : t.fold };
        if (possessive) break;
      }
      if (!best) continue;
      const single = best.last === i;
      if (single && best.hit.conditional) {
        // A common word that is also this person's name: only when capitalised, and not just starting a sentence.
        if (unconditionalOnly || !isUpperFirst(text.slice(tokens[i].start, tokens[i].end)) || sentenceStart(text, tokens[i].start)) continue;
      } else if (best.hit.capOnly && !isUpperFirst(text.slice(tokens[i].start, tokens[i].end))) {
        // A name found in prose: wherever it is capitalised, also at the start of a sentence; never as a lowercase word.
        continue;
      }
      const { entity, ambiguous } = resolveEntity(best.hit, best.folded);
      found.push({
        kind: 'PERSON',
        start: tokens[i].start,
        end: best.end,
        value: text.slice(tokens[i].start, best.end),
        confidence: best.hit.confidence,
        entity,
        canonical: ambiguous ? undefined : canonicalOf(entity),
      });
      i = best.last;
    }
    // Two hits of one person with only a space between them ("Mary" "Smith" for a record "Mary Ann Smith") become one hit.
    // A middle initial ("Abel M. Tuter") keeps them apart: both halves are still masked.
    const merged = [];
    for (const f of found) {
      const prev = merged[merged.length - 1];
      if (prev && prev.entity === f.entity && MERGE_GAP.test(text.slice(prev.end, f.start))) {
        prev.end = f.end;
        prev.value = text.slice(prev.start, prev.end);
        prev.confidence = Math.max(prev.confidence, f.confidence);
      } else {
        merged.push({ ...f });
      }
    }
    return merged;
  }

  const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

  function literalFindings(text) {
    const found = [];
    if (!literals.length) return found;
    const lower = alignedLower(text);
    for (const lit of literals) {
      if (!lit.term) continue;
      for (let at = lower.indexOf(lit.term); at !== -1; at = lower.indexOf(lit.term, at + lit.term.length)) {
        const end = at + lit.term.length;
        if (lit.boundary && (isWordChar(text[at - 1]) || isWordChar(text[end]))) continue;
        found.push({
          kind: lit.kind,
          start: at,
          end,
          value: text.slice(at, end),
          confidence: lit.confidence,
          entity: lit.entity || undefined,
          canonical: lit.entity ? canonicalOf(lit.entity) : undefined,
        });
      }
    }
    return found;
  }

  return Object.freeze({
    /** Names and emails of the record's people found in `text` (may overlap; resolve with resolveOverlaps). */
    find(text, options = {}) {
      if (typeof text !== 'string' || !text) return [];
      return [...nameFindings(text, Boolean(options.unconditionalOnly)), ...literalFindings(text)];
    },
    /** How many distinct people the dictionary knows. */
    get size() {
      return byId.length;
    },
    toJSON() {
      return { people: byId.length };
    },
  });
}
