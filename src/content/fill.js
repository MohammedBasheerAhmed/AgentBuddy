// FILL_FIELD, the one write Agent Buddy has: put text into ONE field of the form that is open. Nothing is saved; the person
// presses Save. Everything the panel sends is checked here before the page bridge is asked to do anything:
//
//   - the field must be one of FILLABLE_FIELDS (src/lib/fillable.js), not just a well-formed column name
//   - `expect`, when sent, must be the form that is open now: the record the text was written for (or a blank form of that
//     table, or that record's email client). A mismatch answers 'wrong-record' and nothing is written
//   - a one-line field is replaced, never appended to, and its line breaks become spaces
//   - an HTML field gets the text as escaped HTML (toSafeHtml); the bridge uses it on a form with g_form, and types the plain
//     text into the rich-text editor of a Workspace
//
// The bridge's answer comes from the page, so it is data: only two shapes go back to the panel.
//
// Dependencies are injected so this is tested without a browser (tests/insert-content-fill.test.js).

import { FILL_REASONS, emailClientTarget, fieldMeta, isFillable, matchesExpect, parseExpect, toOneLine, toSafeHtml } from '../lib/fillable.js';

const FIELD_RE = /^[a-z][a-z0-9_]{0,79}$/;
export const MAX_INSERT_CHARS = 20000;

// What a control is called, from the page: short, printable, one line (the panel shows it as text).
const hex4 = (n) => `\\u${n.toString(16).padStart(4, '0')}`; // (written as numbers so this file stays plain ASCII)
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => `${hex4(a)}-${hex4(b)}`).join('')}]`, 'g');
const cleanLabel = (value) => (typeof value === 'string' ? value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '');

/**
 * @param {{ field?: string, value?: string, label?: string, mode?: string, expect?: object }} message from the side panel
 * @param {{
 *   callPage: (action: string, args: any[]) => Promise<any>,
 *   currentRecord: () => Promise<{table: string, sysId: string}|null>,
 *   currentNewRecord: () => Promise<{table: string}|null>,
 *   href: () => string,
 * }} deps
 * @returns {Promise<{ ok: true, method: 'gform'|'dom', label?: string } | { ok: false, reason: string }>}
 */
export async function handleFillField(message, { callPage, currentRecord, currentNewRecord, href }) {
  const field = message?.field;
  if (typeof field !== 'string' || !FIELD_RE.test(field) || !isFillable(field)) return { ok: false, reason: 'bad-field' };
  const meta = fieldMeta(field);
  let text = String(message.value ?? '');
  if (meta.singleLine) text = toOneLine(text);
  if (!text.trim()) return { ok: false, reason: 'bad-field' };
  if (text.length > MAX_INSERT_CHARS) return { ok: false, reason: 'too-long' };

  try {
    // The form must be the record the text was written for (checked now, not when the panel last looked).
    const want = parseExpect(message.expect);
    if (want === 'invalid') return { ok: false, reason: 'wrong-record' };
    // The email body belongs to the email client: on any other page there is no such field (not a different record's form).
    if (want && want.kind === 'email' && !emailClientTarget(href())) return { ok: false, reason: 'no-such-field' };
    if (want) {
      const [record, newRecord] = await Promise.all([Promise.resolve(currentRecord()).catch(() => null), Promise.resolve(currentNewRecord()).catch(() => null)]);
      if (!matchesExpect(message.expect, { record, newRecord, href: href() })) {
        return { ok: false, reason: 'wrong-record' };
      }
    }

    // Only an explicit 'append' adds below what the field holds, and never on a one-line field.
    const append = message.mode === 'append' && !meta.singleLine;
    const label = typeof message.label === 'string' ? message.label.slice(0, 100) : '';
    // For an HTML field the form gets escaped HTML; the plain text is still passed for a page that has no g_form.
    const html = meta.html ? toSafeHtml(text) : '';
    if (meta.html && html.length > MAX_INSERT_CHARS) return { ok: false, reason: 'too-long' };
    const answer = await callPage('fillField', [field, text, label, append, html]);
    if (answer?.ok === true) {
      const matched = cleanLabel(answer.label);
      return { ok: true, method: answer.method === 'gform' ? 'gform' : 'dom', ...(matched ? { label: matched } : {}) };
    }
    return { ok: false, reason: FILL_REASONS.includes(answer?.reason) && answer.reason !== 'wrong-record' ? answer.reason : 'no-form' };
  } catch {
    return { ok: false, reason: 'no-form' };
  }
}

