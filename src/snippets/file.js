// Snippet backup as a FILE: the name of the file the panel saves, and the checks a chosen file passes before its text is read. The
// content itself is checked by importSnippets() (store.js), the same as pasted text: only title, search word and text are taken,
// nothing is overwritten, and every skipped entry is named. Pure: the panel hands in the File's name, size and type and, later, its text.

import { LIMITS } from './store.js';
import { t } from '../i18n/index.js';

/**
 * The largest file read at all (bytes): the largest file "Save to a file" can write (LIMITS.importChars, src/snippets/store.js). Its
 * text has at most as many characters as the file has bytes, so it passes importSnippets' own length check too.
 */
export const MAX_FILE_BYTES = LIMITS.importChars;

const JSON_TYPES = new Set(['', 'application/json', 'text/json', 'text/plain']);

/** "agent-buddy-snippets-2026-10-30.json" for the date given (ms or Date). */
export function snippetFileName(now = Date.now()) {
  const d = new Date(now);
  const day = Number.isNaN(d.getTime()) ? 'backup' : d.toISOString().slice(0, 10);
  return `agent-buddy-snippets-${day}.json`;
}

/**
 * Why a chosen file is not read ('' when it may be). Only a .json file (or one the browser calls JSON or plain text) of at most
 * MAX_FILE_BYTES, and not an empty one.
 * @param {{ name?: string, size?: number, type?: string } | null | undefined} file
 */
export function fileProblem(file) {
  if (!file || typeof file !== 'object') return t('Choose a file first.');
  const name = String(file.name || '');
  const type = String(file.type || '').toLowerCase();
  if (!/\.json$/i.test(name) || !JSON_TYPES.has(type)) return t('Choose a .json file saved by Agent Buddy (Save to a file).');
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return t('The file is empty.');
  if (size > MAX_FILE_BYTES) return t('The file is too large to import.');
  return '';
}

/** The file's text without a byte-order mark (a file saved by a spreadsheet or by the panel's own download starts with one). */
const BOM = String.fromCharCode(0xfeff); // (written as a code so this file stays plain ASCII)
export const withoutBom = (text) => { const s = String(text ?? ''); return s.startsWith(BOM) ? s.slice(1) : s; };
