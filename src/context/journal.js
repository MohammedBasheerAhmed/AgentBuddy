// Comments and work notes of one record, as { when, by, type, text } entries, oldest first (newest last).
//
// Strategy 1: sys_journal_field (one row per entry, UTC time, the author's login). Non-admins often cannot read it:
// the Table API then answers 403 (ACCESS_DENIED) or HTTP 200 with zero rows.
// Strategy 2: the record's own `comments` and `work_notes` columns. With display values they are one string per
// column, ServiceNow's rendering of every entry: a header line, then the text, newest entry first:
//
//   2026-10-26 09:14:03 - Beth Anglin (Additional comments)
//   Hello Abel, I have restarted the VPN gateway.
//
//   2026-10-25 16:00:00 - Abel Tuter (Work notes)
//   ...
//
// Each column falls back on its own, so one that can be read through the table is not replaced by the string.
// The header's time and name are in the reader's date format and time zone, not UTC.

import { LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { clipText, oneLine, parseSnTime, raw, stripHtml } from './util.js';

export const JOURNAL_SOURCE = 'journal';
export const JOURNAL_RECORD_FIELDS = Object.freeze(['comments', 'work_notes']);

// ---- Parsing the display string -------------------------------------------------------------------

const DATE = String.raw`(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[- ][A-Za-z]{3,9}\.?[- ]\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?`;
const STAMP = `${DATE}[ T]+${TIME}`;
// hyphen, en dash, em dash
const DASH = `[-${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`;

const WITH_DASH_AND_LABEL = new RegExp(`^(${STAMP})\\s+${DASH}\\s+(.*?)\\s*\\(([^()]{1,60})\\)$`);
const WITH_LABEL_ONLY = new RegExp(`^(${STAMP})\\s+(.*?)\\s*\\(([^()]{1,60})\\)$`);
const WITH_DASH_ONLY = new RegExp(`^(${STAMP})\\s+${DASH}\\s+(\\S.*)$`);

// A label we recognise lets a header stand anywhere; any other parenthesised label only counts at the start of a block
// (so "2026-10-26 10:00 - Beth restarted it (twice)" inside a note is not taken for a header).
const KNOWN_LABEL = /comment|work\s*note|note|customer|visible|additional|internal/i;

function looksLikeName(text) {
  const value = text.trim();
  return value.length > 0 && value.length <= 60 && value.split(/\s+/).length <= 6 && /\p{L}/u.test(value) && !/[.!?:;,]$/.test(value);
}

// 2026-10-26 9:14 -> 2026-10-26 09:14:00. Other formats (dd/mm/yyyy, "Oct 26, 2026 9:14 AM") are kept as written.
function normaliseWhen(when) {
  const text = when.replace(/\s+/g, ' ').trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return text;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}:${pad(m[6] || 0)}`;
}

function readHeader(line, atBlockStart) {
  const text = line.trim();
  if (!text) return null;
  const labelled = WITH_DASH_AND_LABEL.exec(text) || WITH_LABEL_ONLY.exec(text);
  if (labelled) {
    const [, when, by, label] = labelled;
    return KNOWN_LABEL.test(label) || atBlockStart ? { when: normaliseWhen(when), by: oneLine(by, 80), label } : null;
  }
  const plain = WITH_DASH_ONLY.exec(text);
  if (plain && atBlockStart && looksLikeName(plain[2])) return { when: normaliseWhen(plain[1]), by: oneLine(plain[2], 80), label: '' };
  return null;
}

// Unknown or translated labels count as work notes: reading a customer comment as internal is safe, the other way round is not.
const typeOfLabel = (label) => (/work|internal/i.test(label) || !/comment|customer|additional|visible/i.test(label) ? 'work_note' : 'comment');

/**
 * Entries from a journal display string, in the order they appear (ServiceNow lists the newest first).
 * `type` ('comment' | 'work_note') says which column the string came from; without it the header label decides.
 * Text with no recognisable header becomes one entry without a time or author.
 */
export function parseJournalString(text, { type } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  if (!lines.some((line) => line.trim())) return [];

  const blocks = [];
  let current = null;
  let atBlockStart = true;
  for (const line of lines) {
    const header = readHeader(line, atBlockStart);
    if (header) {
      current = { ...header, body: [] };
      blocks.push(current);
    } else {
      if (!current) {
        current = { when: '', by: '', label: '', body: [] };
        blocks.push(current);
      }
      current.body.push(line);
    }
    atBlockStart = line.trim() === '';
  }

  return blocks
    .map((block) => ({
      when: block.when,
      by: block.by,
      type: type || typeOfLabel(block.label),
      text: clipText(stripHtml(block.body.join('\n')), LIMITS.journalEntry),
    }))
    .filter((e) => e.text || e.by || e.when);
}

// ---- Ordering ----------------------------------------------------------------------------------------

// Milliseconds for a time we can read without guessing the date format: year first, or a month written as a word.
function whenMs(when) {
  const text = String(when || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return parseSnTime(text);
  if (/[A-Za-z]{3}/.test(text)) {
    const ms = Date.parse(text);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

/**
 * One list, oldest first, from groups of entries that are each newest-first. When every time can be read the groups are
 * interleaved by time; otherwise they are not mixed on a guess and each group is simply reversed.
 */
export function orderChronological(groups) {
  const all = groups.flatMap((group, g) => group.map((e, i) => ({ e, g, i, t: whenMs(e.when) })));
  if (all.length && all.every((x) => Number.isFinite(x.t))) {
    return all.sort((a, b) => a.t - b.t || b.i - a.i).map((x) => x.e);
  }
  return groups.flatMap((group) => [...group].reverse());
}

// ---- Reading ------------------------------------------------------------------------------------------

const TYPE_OF_ELEMENT = { comments: 'comment', work_notes: 'work_note' };
const COLUMN_OF_TYPE = { comment: 'comments', work_note: 'work_notes' };

// Rows come newest first, so each type's list is newest first like a parsed string.
function entriesFromRows(rows) {
  const out = { comment: [], work_note: [] };
  for (const row of rows) {
    const type = TYPE_OF_ELEMENT[raw(row.element)];
    const text = clipText(stripHtml(raw(row.value)), LIMITS.journalEntry);
    if (type && text) out[type].push({ when: raw(row.sys_created_on), by: raw(row.sys_created_by), type, text });
  }
  return out;
}

/**
 * Read the notes and comments of a record.
 * @param {{ table: string, sysId: string, recordText?: { comments?: string, work_notes?: string } | null }} record
 *   `recordText` is the record's own comments/work_notes display strings (null when they were not read).
 * @returns {Promise<{ entries: object[], access: object[], loginNames: string[] }>}
 *   `loginNames`: authors still given as a login (from sys_journal_field); applyAuthorNames swaps in display names.
 *   access[0].strategy: 'sys_journal_field' | 'record-fields' | 'mixed' | 'none'.
 */
export async function readJournal({ table, sysId, recordText = null }, deps, { max = LIMITS.journalEntries, memo } = {}) {
  const query = `name=${table}^element_id=${sysId}^elementINcomments,work_notes^ORDERBYDESCsys_created_on`;
  const fields = ['element', 'value', 'sys_created_on', 'sys_created_by', 'element_id'];
  const { rows: found, failure } = await softRead(deps, 'sys_journal_field', query, fields, { limit: max + 1, displayValue: false });

  // The instance ignoring a condition shows up as rows that belong to other records: none of them may be used.
  const mismatched = found.some((row) => raw(row.element_id) && raw(row.element_id) !== sysId);
  const viaTable = failure || mismatched ? { comment: [], work_note: [] } : entriesFromRows(found);

  const groups = [];
  const strategies = new Set();
  for (const type of ['comment', 'work_note']) {
    const text = recordText ? String(recordText[COLUMN_OF_TYPE[type]] || '') : '';
    if (viaTable[type].length) {
      groups.push(viaTable[type]);
      strategies.add('sys_journal_field');
    } else if (text.trim()) {
      groups.push(parseJournalString(text, { type }));
      strategies.add('record-fields');
    }
  }

  const ordered = orderChronological(groups);
  const entries = ordered.slice(-max);
  const strategy = strategies.size > 1 ? 'mixed' : [...strategies][0] || 'none';

  if (!entries.length) {
    const access = await emptyAccess({ failure, mismatched, recordFieldsRead: recordText !== null }, deps, memo);
    return { entries, loginNames: [], access: [access] };
  }

  const notes = [];
  if (strategy !== 'sys_journal_field') {
    const why = failure ? 'could not be read by your user' : mismatched ? 'answered with other records' : 'showed no entries';
    notes.push(`The journal table ${why}, so notes were read from the record's own comments and work notes fields. Times are in your time zone.`);
  }
  if (ordered.length > max) notes.push(`Showing the newest ${max} entries.`);
  const loginNames = strategy === 'record-fields' ? [] : [...new Set(entries.map((e) => e.by).filter((by) => by && !/\s/.test(by)))];
  return { entries, loginNames, access: [accessEntry(JOURNAL_SOURCE, STATUS.OK, notes.join(' '), { strategy })] };
}

// Nothing was found by either route: say whether that is a fact or only what this user can see.
async function emptyAccess({ failure, mismatched, recordFieldsRead }, deps, memo) {
  const none = { strategy: 'none' };
  if (failure?.status === STATUS.DENIED) {
    return recordFieldsRead
      ? accessEntry(JOURNAL_SOURCE, STATUS.EMPTY_OR_HIDDEN, "Your user cannot read the journal table and the record's own comments and work notes are empty, so there may be notes this user cannot see.", none)
      : accessEntry(JOURNAL_SOURCE, STATUS.DENIED, 'Your user cannot read the notes and comments of this record.', none);
  }
  if (failure) return accessEntry(JOURNAL_SOURCE, failure.status, failure.note, none);
  if (mismatched) return accessEntry(JOURNAL_SOURCE, STATUS.ERROR, 'The journal table answered with other records, so it was not used.', none);
  const seen = await confirmEmptyIsReallyEmpty('sys_journal_field', deps, memo);
  if (seen.status === STATUS.EMPTY) return accessEntry(JOURNAL_SOURCE, STATUS.EMPTY, 'This record has no notes or comments.', none);
  if (seen.status === STATUS.EMPTY_OR_HIDDEN) {
    return accessEntry(JOURNAL_SOURCE, STATUS.EMPTY_OR_HIDDEN, 'No notes or comments were found. Your user may not be able to read notes on this table, so this does not prove there are none.', none);
  }
  return accessEntry(JOURNAL_SOURCE, seen.status, seen.note, none);
}

/** Swap logins (beth.anglin) for display names where a map is known; other entries are left alone. */
export function applyAuthorNames(entries, namesByLogin) {
  return entries.map((e) => (namesByLogin.get(e.by) ? { ...e, by: namesByLogin.get(e.by) } : e));
}
