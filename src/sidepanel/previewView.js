// The check before sending, as a person reads it (PreviewDialog): the ticket data of the request cut into the pieces the firewall
// built, so the ticket reads like a ticket and every hidden value can be drawn as a chip. Pure: no React, no DOM
// (tests/preview-view.test.js).
//
// DISPLAY ONLY. What is sent is the sealed request (src/pii/firewall.js), shown character for character under "Show the exact text".
// Nothing here changes it, and nothing of it is left out of this view: only the blank lines between blocks are not drawn. A block that
// cannot be read as fields or as a note is shown as its plain text, and text outside the blocks (the task the AI is given) is shown too.
import { FIELDS_BLOCK } from '../pii/firewall.js';
import { JOURNAL_FIELDS } from '../features/parts.js';
import { PROVIDERS, endpointHost } from '../providers/config.js';

// One block as the firewall writes it. Its text has every angle bracket escaped, so it can never hold "</ticket_data>": the first
// closing tag after the opening one is its own.
const BLOCK = /<ticket_data field="([^"\n]*)"(?: label="([^"\n]*)")?>\n([\s\S]*?)\n<\/ticket_data>/g;

// The firewall escapes < and > inside a block (and nothing else); the view shows them as they were written.
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * The "Label: value" lines of the fields block (the firewall writes them so; a label never holds ": "). A line that is not one keeps
 * its whole text as the value, with no label. Joined back with ": " and new lines, the rows are exactly the text they came from.
 */
export function fieldRows(body) {
  return String(body ?? '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf(': ');
      return at > 0 ? { label: line.slice(0, at), value: line.slice(at + 2) } : { label: '', value: line };
    });
}

// One note or comment as src/features/parts.js writes it: "[when] author: text".
const NOTE = /^\[([^\]\n]*)\] ([^\n]*?): ([\s\S]*)$/;

/** { when, by, text } of a note or comment, or null when the text is not written that way (then it is shown whole). */
export function noteOf(body) {
  const text = String(body ?? '');
  const m = NOTE.exec(text);
  if (!m) return null;
  const [, when, by, said] = m;
  // (only when the three pieces are the text again: nothing can fall out between them)
  return `[${when}] ${by}: ${said}` === text ? { when, by, text: said } : null;
}

/**
 * The ticket data of a request (runLogic splitPreview's `data`: the user message), as sections to read, in the order they are sent:
 *   { kind: 'fields', rows: [{ label, value }] }                          the short columns of the record (one block of lines)
 *   { kind: 'notes', items: [{ field, label, when, by, text }] }          notes and comments that follow each other, as sent
 *   { kind: 'block', field, label, text }                                 any other block, under its label
 *   { kind: 'task', text }                                                the text after the last block: what the AI is asked to do
 *   { kind: 'text', text }                                                any other text outside the blocks
 * `whole` is true when no block was found at all: then one 'text' section holds the whole text.
 * @param {string} data
 * @returns {{ whole: boolean, sections: object[] }}
 */
export function parseSent(data) {
  const text = String(data ?? '');
  const sections = [];
  const outside = (piece, kind) => {
    if (piece.trim()) sections.push({ kind, text: piece.trim() });
  };
  let at = 0;
  let blocks = 0;
  for (const m of text.matchAll(BLOCK)) {
    outside(text.slice(at, m.index), 'text');
    at = m.index + m[0].length;
    blocks += 1;
    const [, field, label = '', raw] = m;
    const body = unescape(raw);
    if (field === FIELDS_BLOCK && !label) {
      sections.push({ kind: 'fields', rows: fieldRows(body) });
    } else if (JOURNAL_FIELDS.includes(field)) {
      const note = noteOf(body);
      const item = { field, label, ...(note || { when: '', by: '', text: body }) };
      const last = sections[sections.length - 1];
      if (last?.kind === 'notes') last.items.push(item);
      else sections.push({ kind: 'notes', items: [item] });
    } else {
      sections.push({ kind: 'block', field, label, text: body });
    }
  }
  if (!blocks) return { whole: true, sections: text.trim() ? [{ kind: 'text', text }] : [] };
  outside(text.slice(at), 'task');
  return { whole: false, sections };
}

/**
 * Every piece of text of the request a section shows, in order: a block's label (its heading, or the kind of a note), then its text.
 * For the tests: with the block wrappers and the blank lines between blocks taken away, the request's ticket data and these pieces are
 * the same characters.
 */
export function sectionTexts(section) {
  if (section.kind === 'fields') return section.rows.map((r) => (r.label ? `${r.label}: ${r.value}` : r.value));
  if (section.kind === 'notes') return section.items.flatMap((n) => [n.label, n.by || n.when ? `[${n.when}] ${n.by}: ${n.text}` : n.text]);
  if (section.kind === 'block') return [section.label, section.text];
  return [section.text];
}

// A placeholder as the tokenizer writes it (src/pii/tokenizer.js): [PERSON_1], [EMAIL_2], [MASKED_1].
const PLACEHOLDER = /\[([A-Z]{2,12})_(\d{1,6})\]/g;

/** A text cut into plain pieces and placeholders: [{ text } | { token, label, n }], in order; joined, the tokens and texts are the text. */
export function maskedPieces(text) {
  const s = String(text ?? '');
  const out = [];
  let at = 0;
  for (const m of s.matchAll(PLACEHOLDER)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push({ token: m[0], label: m[1], n: Number(m[2]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

// Kinds the person reads as one ("ID number" either way; a password in an address is a password).
const SAME_AS = { NATIONAL_ID: 'ID', URL_CREDENTIALS: 'SECRET' };

/**
 * What was hidden, by kind, for the chips of the check: [{ kind, n }] for every count above 0, in the order the firewall counted
 * them; kinds that read the same are added up. Numbers only.
 */
export function hiddenCounts(stats) {
  const byKind = new Map();
  for (const [kind, count] of Object.entries(stats?.counts || {})) {
    const n = Number(count) || 0;
    if (n <= 0) continue;
    const key = SAME_AS[kind] || kind;
    byKind.set(key, (byKind.get(key) || 0) + n);
  }
  return [...byKind].map(([kind, n]) => ({ kind, n }));
}

/**
 * Where the request goes, as the check names it: the provider's own name ("DeepSeek"), or the address of a gateway or a server of the
 * person's own ("localhost:11434", the same rule as providers/config.js endpointHost), and the model ('' when none is set).
 * @param {{ provider?: string, baseUrl?: string, model?: string }} config
 * @returns {{ name: string, model: string }}
 */
export function destinationOf(config = {}) {
  const host = endpointHost(config || {});
  const id = String(config?.provider || '');
  const name = host === null ? PROVIDERS[id]?.short || id : host || id;
  const model = typeof config?.model === 'string' ? config.model.trim() : '';
  return { name, model };
}

/**
 * Does the selection take in any of `nodes` (the chips of the view)? A chip shows "Person 1" where "[PERSON_1]" is sent, so a selection
 * across one is not text that can be hidden. `selection` is the window's Selection (injected, so this is tested without a browser).
 */
export function selectionTouches(selection, nodes) {
  if (!selection || typeof selection.containsNode !== 'function') return false;
  for (const node of nodes || []) if (selection.containsNode(node, true)) return true;
  return false;
}
