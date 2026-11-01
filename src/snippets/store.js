// Personal snippet library as pure functions over a plain array. The caller (options page or side panel) keeps the
// array in storage; nothing here touches chrome.* or the clock unless the caller leaves `now` / `makeId` out.
//
// Snippet = { id, title, shortcut, body, createdAt, updatedAt }
//   title    one line, at most 80 characters
//   shortcut optional SEARCH WORD (the panel calls it that): at most 30 characters of a-z 0-9 - _ / (lower case), unique in the
//            library. It only makes the snippet quick to find in the search box; nothing types it into a ServiceNow page.
//   body     the template text (see render.js), at most 8000 characters
//
// Every function returns new arrays and never throws on bad input; problems come back as messages.
// options (all optional): now (ms number or () => ms), makeId (used) => string, for predictable tests.

import { stripUnsafeChars } from '../render/safeText.js';
import { isolate, t } from '../i18n/index.js';

export const LIMITS = Object.freeze({ title: 80, shortcut: 30, body: 8000, count: 500, importChars: 2000000, importEntries: 2000, importErrors: 20 });

const SHORTCUT_OK = /^[a-z0-9_/-]+$/;
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const EXPORT_FORMAT = 'agent-buddy-snippets';

const nowOf = (options) => {
  const n = options && options.now;
  const v = typeof n === 'function' ? n() : n;
  return Number.isFinite(v) ? v : Date.now();
};

function randomId() {
  const bytes = new Uint8Array(9);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `s${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

// An id that is not in `used`.
function freshId(used, options) {
  const make = options && typeof options.makeId === 'function' ? options.makeId : randomId;
  for (let tries = 0; tries < 20; tries++) {
    const id = String(make(used));
    if (ID_OK.test(id) && !used.has(id)) return id;
  }
  let n = used.size + 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

const oneLine = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * Cleans one snippet-like value. Returns { snippet, errors }; snippet is null when there are errors.
 * Control and direction-changing characters are removed; the title becomes one line; the shortcut is lower-cased.
 * Over-long values are rejected, never silently cut.
 */
export function normalizeSnippet(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { snippet: null, errors: [t('This is not a snippet.')] };
  const errors = [];
  // `mustBeText` says the problem in the panel's language, only when there is one.
  const field = (name, mustBeText) => {
    const v = input[name];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') {
      errors.push(mustBeText());
      return '';
    }
    return v;
  };
  const title = oneLine(stripUnsafeChars(field('title', () => t('The title must be text.'))));
  const shortcut = stripUnsafeChars(field('shortcut', () => t('The search word must be text.'))).trim().toLowerCase();
  const body = stripUnsafeChars(field('body', () => t('The text must be text.')));

  if (!title) errors.push(t('A title is needed.'));
  else if (title.length > LIMITS.title) errors.push(t('The title is longer than {max} characters.', { max: LIMITS.title }));
  if (shortcut.length > LIMITS.shortcut) errors.push(t('The search word is longer than {max} characters.', { max: LIMITS.shortcut }));
  else if (shortcut && !SHORTCUT_OK.test(shortcut)) errors.push(t('The search word can only use a-z, 0-9, dash, underscore and slash (no spaces).'));
  if (!body.trim()) errors.push(t('The text is empty.'));
  else if (body.length > LIMITS.body) errors.push(t('The text is longer than {max} characters.', { max: LIMITS.body }));
  if (errors.length) return { snippet: null, errors };

  const now = nowOf(options);
  const stamp = (v) => (Number.isFinite(v) && v > 0 ? v : now);
  return {
    snippet: {
      id: typeof input.id === 'string' && ID_OK.test(input.id) ? input.id : '',
      title,
      shortcut,
      body,
      createdAt: stamp(input.createdAt),
      updatedAt: stamp(input.updatedAt),
    },
    errors: [],
  };
}

const owner = (list, shortcut, exceptId) => (shortcut ? list.find((s) => s.shortcut === shortcut && s.id !== exceptId) : undefined);

/** Adds a snippet. Returns { list, snippet, error }; error is '' on success and list is then a new array. */
export function addSnippet(list, input, options) {
  const current = Array.isArray(list) ? list : [];
  if (current.length >= LIMITS.count) return { list: current, snippet: null, error: t('The library is full ({max} snippets).', { max: LIMITS.count }) };
  const { snippet, errors } = normalizeSnippet(input, options);
  if (!snippet) return { list: current, snippet: null, error: errors[0] };
  const taken = owner(current, snippet.shortcut, '');
  if (taken) return { list: current, snippet: null, error: t('The search word "{word}" is already used by "{title}".', { word: isolate(snippet.shortcut), title: isolate(taken.title) }) };
  const now = nowOf(options);
  const added = { ...snippet, id: freshId(new Set(current.map((s) => s.id)), options), createdAt: now, updatedAt: now };
  return { list: [...current, added], snippet: added, error: '' };
}

/** Changes the fields in `patch` (title, shortcut, body) of the snippet with this id. Returns { list, snippet, error }. */
export function updateSnippet(list, id, patch, options) {
  const current = Array.isArray(list) ? list : [];
  const at = current.findIndex((s) => s.id === id);
  if (at < 0) return { list: current, snippet: null, error: t('That snippet no longer exists.') };
  const old = current[at];
  const changes = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    ...old,
    ...('title' in changes ? { title: changes.title } : {}),
    ...('shortcut' in changes ? { shortcut: changes.shortcut } : {}),
    ...('body' in changes ? { body: changes.body } : {}),
  };
  const { snippet, errors } = normalizeSnippet(merged, options);
  if (!snippet) return { list: current, snippet: null, error: errors[0] };
  const taken = owner(current, snippet.shortcut, old.id);
  if (taken) return { list: current, snippet: null, error: t('The search word "{word}" is already used by "{title}".', { word: isolate(snippet.shortcut), title: isolate(taken.title) }) };
  const next = { ...snippet, id: old.id, createdAt: old.createdAt, updatedAt: nowOf(options) };
  return { list: current.map((s, i) => (i === at ? next : s)), snippet: next, error: '' };
}

/** The list without the snippet that has this id (a new array; unchanged content if there is no such snippet). */
export function removeSnippet(list, id) {
  return (Array.isArray(list) ? list : []).filter((s) => s.id !== id);
}

// ---- Search --------------------------------------------------------------------------------------------------------

const bare = (t) => t.replace(/^\/+/, '');

// Score of one search word against one snippet: shortcut matches beat title matches beat body matches.
function scoreTerm(term, title, shortcut, body) {
  const bareTerm = bare(term) || term;
  const bareShortcut = bare(shortcut);
  let best = 0;
  if (shortcut) {
    if (shortcut === term || bareShortcut === bareTerm) best = 100;
    else if (shortcut.startsWith(term) || bareShortcut.startsWith(bareTerm)) best = 80;
    else if (shortcut.includes(bareTerm)) best = 50;
  }
  if (title === term) best = Math.max(best, 70);
  else if (title.startsWith(term)) best = Math.max(best, 60);
  else if (title.includes(` ${term}`)) best = Math.max(best, 45);
  else if (title.includes(term)) best = Math.max(best, 40);
  if (best < 10 && body.includes(term)) best = 10;
  return best;
}

/**
 * Snippets matching every word of the query (case-insensitive), best first: shortcut, then title, then body.
 * An empty query returns everything by title. options: limit.
 */
export function searchSnippets(list, query, options) {
  const all = Array.isArray(list) ? list : [];
  const terms = String(query == null ? '' : query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.slice(0, 60));
  const limit = options && Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;
  const byTitle = (a, b) => a.snippet.title.toLowerCase().localeCompare(b.snippet.title.toLowerCase()) || a.at - b.at;
  const rows = [];
  all.forEach((snippet, at) => {
    if (!snippet || typeof snippet !== 'object') return;
    const title = String(snippet.title || '').toLowerCase();
    const shortcut = String(snippet.shortcut || '').toLowerCase();
    const body = String(snippet.body || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
      const s = scoreTerm(term, title, shortcut, body);
      if (!s) {
        score = -1;
        break;
      }
      score += s;
    }
    if (score >= 0) rows.push({ snippet, score, at });
  });
  rows.sort((a, b) => b.score - a.score || byTitle(a, b));
  return rows.slice(0, limit).map((r) => r.snippet);
}

// ---- Export and import ---------------------------------------------------------------------------------------------

/** The library as a JSON file's text: titles, shortcuts and bodies only (ids and dates are not exported). */
export function exportSnippets(list) {
  const snippets = (Array.isArray(list) ? list : []).map((s) => ({ title: s.title, shortcut: s.shortcut || '', body: s.body }));
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, snippets }, null, 2);
}

/**
 * Merges snippets from a JSON file's text into `existing`. Accepts the export format or a bare array.
 * Never throws. Returns { list, added, skipped, errors }: bad entries are skipped with a message, an entry whose
 * shortcut is already taken (in the library or earlier in the file) or that repeats an existing title and text is
 * skipped, and nothing is added past the library limit. Ids in the file are ignored.
 */
export function importSnippets(jsonText, existing, options) {
  const result = { list: Array.isArray(existing) ? existing.slice() : [], added: 0, skipped: 0, errors: [] };
  if (typeof jsonText !== 'string' || !jsonText.trim()) {
    result.errors.push(t('The file is empty.'));
    return result;
  }
  if (jsonText.length > LIMITS.importChars) {
    result.errors.push(t('The file is too large to import.'));
    return result;
  }
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    result.errors.push(t('This is not a valid JSON file.'));
    return result;
  }
  const entries = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.snippets) ? data.snippets : null;
  if (!entries) {
    result.errors.push(t('No snippets found: expected a list of snippets or {format}.', { format: '{"snippets": [...]}' }));
    return result;
  }

  const messages = [];
  const usedIds = new Set(result.list.map((s) => s.id));
  const shortcuts = new Set(result.list.map((s) => s.shortcut).filter(Boolean));
  const texts = new Set(result.list.map((s) => `${s.title}\u0000${s.body}`));
  let full = false;
  const considered = Math.min(entries.length, LIMITS.importEntries);
  if (entries.length > considered) messages.push(t('Only the first {count} entries were read.', { count: considered }));

  for (let n = 0; n < considered; n++) {
    // Only the three content fields are taken from the file; ids and dates are made fresh.
    const entry = entries[n];
    const picked = entry && typeof entry === 'object' && !Array.isArray(entry) ? { title: entry.title, shortcut: entry.shortcut, body: entry.body } : entry;
    const { snippet, errors } = normalizeSnippet(picked, options);
    if (!snippet) {
      result.skipped++;
      messages.push(t('Snippet {number}: {problem}', { number: n + 1, problem: errors[0] }));
      continue;
    }
    if (result.list.length >= LIMITS.count) {
      result.skipped++;
      if (!full) messages.push(t('The library is full ({max} snippets); the rest were skipped.', { max: LIMITS.count }));
      full = true;
      continue;
    }
    if (snippet.shortcut && shortcuts.has(snippet.shortcut)) {
      result.skipped++;
      messages.push(t('Snippet {number} ("{title}"): the search word "{word}" is already used.', { number: n + 1, title: isolate(snippet.title), word: isolate(snippet.shortcut) }));
      continue;
    }
    const key = `${snippet.title}\u0000${snippet.body}`;
    if (texts.has(key)) {
      result.skipped++;
      messages.push(t('Snippet {number} ("{title}"): already in your library.', { number: n + 1, title: isolate(snippet.title) }));
      continue;
    }
    const id = freshId(usedIds, options);
    usedIds.add(id);
    if (snippet.shortcut) shortcuts.add(snippet.shortcut);
    texts.add(key);
    result.list.push({ ...snippet, id });
    result.added++;
  }

  const shown = messages.slice(0, LIMITS.importErrors);
  if (messages.length > shown.length) shown.push(t('...and {count} more.', { count: messages.length - shown.length }));
  result.errors = shown;
  return result;
}
