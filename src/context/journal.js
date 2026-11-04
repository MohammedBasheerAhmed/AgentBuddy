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
// The header's time and name are in the reader's date format and time zone, not UTC: a column read that way next to one read from
// the table is put on UTC first (see "Two clocks"), so the two are ordered on one clock.

import { LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { foldText } from './identity.js';
import { clipText, formatSnTime, journalText, oneLine, parseSnTime, raw } from './util.js';

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
      text: clipText(journalText(block.body.join('\n')), LIMITS.journalEntry),
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

// ---- Two clocks ---------------------------------------------------------------------------------------
// When one column comes from the table (stored UTC) and the other from the record's own text (the reader's time zone), their times
// are on two clocks. The column read from the table is in the record's text too: the same entries, the same words, with the time
// the reader sees. Those pairs give the reader's offset at their dates, and the other column is put on UTC with the offset of the
// nearest pair (a clock change between two notes is then still right on both sides of it).

const QUARTER = 15 * 60000;
const MAX_OFFSET = 14 * 3600000; // the widest real UTC offset

// The same entry read both ways: the same words (the table's rich text and the display string differ in spacing and line breaks), the
// first 200 characters of them so a long entry cut at a different place still pairs.
const pairKey = (entry) => foldText(entry?.text).slice(0, 200);

/** [{ at, offset }] from entries read both ways (the table's, newest first; the same column parsed from the record's text). */
function offsetsFromPairs(tableEntries, textEntries) {
  const pairs = [];
  const used = new Set();
  for (const e of tableEntries) {
    const key = pairKey(e);
    const i = key ? textEntries.findIndex((x, k) => !used.has(k) && pairKey(x) === key) : -1;
    if (i < 0) continue;
    used.add(i);
    const utc = parseSnTime(e.when);
    const local = parseSnTime(textEntries[i].when); // year first only: another date format is not read on a guess
    const offset = Math.round((local - utc) / QUARTER) * QUARTER;
    if (Number.isFinite(offset) && Math.abs(offset) <= MAX_OFFSET) pairs.push({ at: utc, offset });
  }
  return pairs;
}

/** The entries with their local times put on UTC; null when one of them cannot be (no time, or another date format). */
function toUtc(entries, pairs) {
  const out = [];
  for (const e of entries) {
    const local = parseSnTime(e.when);
    if (!Number.isFinite(local)) return null;
    const near = pairs.reduce((best, p) => (Math.abs(p.at - local) < Math.abs(best.at - local) ? p : best));
    out.push({ ...e, when: formatSnTime(local - near.offset) });
  }
  return out;
}

/**
 * Is the time of this entry in the reader's time zone (read from the record's own text) rather than stored UTC? The journal's access
 * entry says: every entry when the notes were read from the record's text ('record-fields'); the types listed in `localTimes` when the
 * comments and the work notes came from different places and could not be put on one clock ('mixed').
 * @param {{ type?: string }} entry
 * @param {object[]} access the pack's access list
 */
export function isLocalTime(entry, access) {
  const a = (Array.isArray(access) ? access : []).find((x) => x && x.source === JOURNAL_SOURCE);
  if (a?.strategy === 'record-fields') return true;
  return a?.strategy === 'mixed' && Array.isArray(a.localTimes) && a.localTimes.includes(entry?.type);
}

// ---- Reading ------------------------------------------------------------------------------------------

const TYPE_OF_ELEMENT = { comments: 'comment', work_notes: 'work_note' };
const COLUMN_OF_TYPE = { comment: 'comments', work_note: 'work_notes' };

// Rows come newest first, so each type's list is newest first like a parsed string.
function entriesFromRows(rows) {
  const out = { comment: [], work_note: [] };
  for (const row of rows) {
    const type = TYPE_OF_ELEMENT[raw(row.element)];
    const text = clipText(journalText(raw(row.value)), LIMITS.journalEntry);
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
 *   access[0].strategy: 'sys_journal_field' | 'record-fields' | 'mixed' | 'none'; access[0].localTimes: on 'mixed', the type whose
 *   times stayed in the reader's time zone (see isLocalTime), when it could not be put on UTC.
 */
export async function readJournal({ table, sysId, recordText = null }, deps, { max = LIMITS.journalEntries, memo } = {}) {
  const query = `name=${table}^element_id=${sysId}^elementINcomments,work_notes^ORDERBYDESCsys_created_on`;
  const fields = ['element', 'value', 'sys_created_on', 'sys_created_by', 'element_id'];
  const { rows: found, failure } = await softRead(deps, 'sys_journal_field', query, fields, { limit: max + 1, displayValue: false });

  // The organisation does not allow the journal to be read: the record's own comments and work notes columns are not a way round it.
  if (failure?.status === STATUS.BLOCKED) return { entries: [], loginNames: [], access: [accessEntry(JOURNAL_SOURCE, STATUS.BLOCKED, failure.note, { strategy: 'none' })] };

  // The instance ignoring a condition shows up as rows that belong to other records: none of them may be used.
  const mismatched = found.some((row) => raw(row.element_id) && raw(row.element_id) !== sysId);
  const viaTable = failure || mismatched ? { comment: [], work_note: [] } : entriesFromRows(found);

  const groups = [];
  const strategies = new Set();
  const textOf = (type) => (recordText ? String(recordText[COLUMN_OF_TYPE[type]] || '') : '');
  let fromText = ''; // the type read from the record's text while the other came from the table ('mixed')
  for (const type of ['comment', 'work_note']) {
    const text = textOf(type);
    if (viaTable[type].length) {
      groups.push(viaTable[type]);
      strategies.add('sys_journal_field');
    } else if (text.trim()) {
      groups.push(parseJournalString(text, { type }));
      strategies.add('record-fields');
      fromText = type;
    }
  }
  const strategy = strategies.size > 1 ? 'mixed' : [...strategies][0] || 'none';

  // Mixed: put the column from the record's text on the table's clock (UTC) before the two are ordered together. When that cannot be
  // done, the access entry names the column whose times are local, and its order among the other column's is only approximate.
  let localTimes = [];
  if (strategy === 'mixed') {
    const fromTable = fromText === 'comment' ? 'work_note' : 'comment';
    const at = fromText === 'comment' ? 0 : 1;
    const pairs = offsetsFromPairs(viaTable[fromTable], parseJournalString(textOf(fromTable), { type: fromTable }));
    const onUtc = pairs.length ? toUtc(groups[at], pairs) : null;
    if (onUtc) groups[at] = onUtc;
    else localTimes = [fromText];
  }

  const ordered = orderChronological(groups);
  const entries = ordered.slice(-max);

  if (!entries.length) {
    const access = await emptyAccess({ failure, mismatched, recordFieldsRead: recordText !== null }, deps, memo);
    return { entries, loginNames: [], access: [access] };
  }

  const notes = [];
  if (strategy === 'record-fields') {
    const why = failure ? 'could not be read by your user' : mismatched ? 'answered with other records' : 'showed no entries';
    notes.push(`The journal table ${why}, so notes were read from the record's own comments and work notes fields. Times are in your time zone.`);
  } else if (strategy === 'mixed') {
    // (The table answered for this record, with entries of the other column only.)
    const column = fromText === 'comment' ? 'comments' : 'work notes';
    notes.push(`The journal table showed no ${column} for this record, so they were read from the record's own ${column} field.`);
    if (localTimes.length) notes.push('Their times are in your time zone, so their order among the other notes may be off by a few hours.');
  }
  if (ordered.length > max) notes.push(`Showing the newest ${max} entries.`);
  const loginNames = strategy === 'record-fields' ? [] : [...new Set(entries.map((e) => e.by).filter((by) => by && !/\s/.test(by)))];
  // `more`: older entries exist and were not read. The AI request says so (src/features/parts.js, notAvailable), so a summary does not
  // take the newest entries for the whole story. `localTimes`: see isLocalTime.
  const extra = { strategy, ...(localTimes.length ? { localTimes } : {}), ...(ordered.length > max ? { more: true } : {}) };
  return { entries, loginNames, access: [accessEntry(JOURNAL_SOURCE, STATUS.OK, notes.join(' '), extra)] };
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


// ---- What a mail program adds: quoted replies, signatures, legal notices --------------------------------------------------
//
// A comment that came in by email (and the description of a ticket opened by email) carries everything the mail program added: the
// whole earlier thread under "On Mon, ... wrote:" or "From: ... Sent: ...", a signature with titles and phone numbers, a legal notice,
// "Sent from my iPhone", an "external sender" banner. For the AI that is noise (often more than half of the note), and the earlier
// thread is already in the journal as entries of its own. cleanEmailText() takes it out before the text becomes a part
// (src/features/parts.js, src/itsm/parts.js); the pack itself and the views keep the whole text.
//
// The rules are conservative, because the customer's own words must never be lost:
//  - The quoted thread is cut only below a reply header: a line ending in "wrote:" (or its translation) that carries a date, a time or
//    an address; a line "-----Original Message-----"; or a From: / Sent: / Subject: block in one of the common languages whose date
//    line has a time. And only when the person wrote something above it that is not "see below". A forwarded message ("Forwarded
//    message", "Begin forwarded message") is kept: it is what the person wanted to show. A short note says where something was cut.
//  - A signature is cut only at the very end: below a sign-off line ("Kind regards,", "Mit freundlichen Grüßen") or a "-- " line, or a
//    last paragraph of contact lines, and only when every line of it looks like a name, a job title or contact details. The sign-off
//    line itself stays.
//  - A legal notice is a paragraph at the end with a known legal phrase and the vocabulary of one (recipient, delete, prohibited...),
//    a company register footer, or the one line "consider the environment before printing".
//  - "Sent from my iPhone" (and its kin in other languages and apps), an "external sender" banner at the top, and ServiceNow's own
//    "reply from: <address>" line at the start of an emailed comment are dropped.
//  - If nothing with a letter in it would be left, the text is returned as it was.

const MIN_OWN_LETTERS = 12;
const SEE_BELOW = /\bbelow\b|\binline\b|\bunten\b|\bim text\b|\bci-dessous\b|\bplus bas\b|\babajo\b|\ba continuación\b|\bhieronder\b|\bsotto\b|\babaixo\b|\bnedan\b/i;

// Reply headers that end with "wrote:" in the common languages. A time, a year or an address must be in it, so "On Monday the
// printer wrote:" is not one.
const WROTE = [
  /^On\s.{4,250}\bwrote:$/i,
  /^Am\s.{4,250}\bschrieb\b.{0,200}:$/i,
  /^Le\s.{4,250}\ba\s+écrit\s?:$/i,
  /^El\s.{4,250}\bescribió\s?:$/i,
  /^Op\s.{4,250}\bschreef\b.{0,200}:$/i,
  /^Il\s.{4,250}\bha\s+scritto\s?:$/i,
  /^(?:Em|No dia)\s.{4,250}\bescreveu\s?:$/i,
  /^Den\s.{4,250}\bskrev\b.{0,200}:$/i,
];
const HAS_TIME = /\d{1,2}[:.h]\d{2}/;
const WROTE_EVIDENCE = /@|\d{1,2}[:.h]\d{2}|\b(?:19|20)\d{2}\b/;
const ORIGINAL = /^[-_=*\s]{0,12}-{2,}\s*(?:original message|original-nachricht|ursprüngliche nachricht|originalnachricht|message d'origine|mensaje original|oorspronkelijk bericht|messaggio originale|mensagem original|ursprungligt meddelande|oprindelig meddelelse|opprinnelig melding)\s*-{2,}[-_=*\s]{0,12}$/i;
const FORWARDED = /forwarded message|begin forwarded message|weitergeleitete nachricht|message transféré|mensaje reenviado|doorgestuurd bericht|messaggio inoltrato|mensagem encaminhada|vidarebefordrat meddelande/i;

// The lines of an Outlook-style header block. Outlook may put the label in bold ("*From:*").
const headerLabel = (words) => new RegExp(`^\\*?(?:${words})\\*?\\s?:`, 'i');
const H_FROM = headerLabel('from|von|de|van|da|fra|från|od|от');
const H_SENT = headerLabel('sent|date|gesendet|datum|envoyé|enviado|enviada em|enviado el|fecha|verzonden|inviato|data|sendt|skickat|wysłano|отправлено');
const H_SUBJECT = headerLabel('subject|betreff|objet|asunto|onderwerp|oggetto|assunto|emne|ämne|temat|тема');

const DEVICE =
  '(?:iphone|ipad|ipod|android(?: phone| device| tablet)?|samsung(?: [\\p{L}\\p{N}+-]+){0,4}|galaxy(?: [\\p{L}\\p{N}+-]+){0,3}|huawei(?: [\\p{L}\\p{N}+-]+){0,3}|' +
  'xiaomi(?: [\\p{L}\\p{N}+-]+){0,3}|pixel(?: [\\p{L}\\p{N}+-]+){0,2}|oneplus(?: [\\p{L}\\p{N}+-]+){0,2}|blackberry(?: [\\p{L}\\p{N}+-]+){0,2}|' +
  'mobile(?: device| phone)?|phone|smartphone|tablet|handy|mobiltelefon|téléphone(?: mobile)?|portable|móvil|celular|dispositivo móvil|telefoon|telefono|cellulare|mobil)';
const MOBILE = new RegExp(
  '^(?:' +
    [
      `sent from my ${DEVICE}`,
      'sent from (?:outlook|mail|yahoo mail|gmail|aol mail|proton mail)(?: for (?:ios|android|windows(?: \\d+)?|mac)| on (?:ios|android))?',
      'get outlook for (?:ios|android|mac|windows)',
      `von meinem ${DEVICE} gesendet`,
      'gesendet von (?:meinem )?(?:iphone|ipad|outlook für (?:ios|android)|mail für windows(?: \\d+)?)',
      `envoyé (?:de|depuis) mon ${DEVICE}`,
      'obtenir outlook pour (?:ios|android)',
      `enviado desde mi ${DEVICE}`,
      `enviado do meu ${DEVICE}`,
      `verzonden (?:vanaf|met|van) (?:mijn )?${DEVICE}`,
      `inviato da(?:l mio| il mio)? ${DEVICE}`,
      `skickat från min ${DEVICE}`,
    ].join('|') +
    ')[.!]?$',
  'iu'
);

const SIGN_OFF =
  /^(?:(?:kind|best|warm|warmest|many|with kind) regards|regards|best wishes|best|all the best|thanks(?: a lot| again| so much| in advance)?|thank you(?: very much| so much| again| in advance)?|many thanks|cheers|sincerely|yours sincerely|yours truly|yours faithfully|br|kr|mit freundlichen grüßen|mit freundlichem gruß|freundliche grüße|viele grüße|beste grüße|liebe grüße|schöne grüße|herzliche grüße|lg|vg|mfg|gruß|grüße|danke|vielen dank|cordialement|bien cordialement|bien à vous|merci(?: beaucoup)?|salutations|saludos(?: cordiales)?|un saludo|atentamente|gracias|met vriendelijke groet(?:en)?|vriendelijke groet(?:en)?|groeten|bedankt|dank je(?: wel)?|cordiali saluti|distinti saluti|saluti|grazie(?: mille)?|atenciosamente|obrigad[oa]|abraços|med vänliga hälsningar|vänliga hälsningar|mvh|med venlig hilsen|vennlig hilsen)\s*[,.!]*$/i;
const SIGN_OFF_WITH_NAME = /^(?:thanks|thank you|regards|cheers|best|kind regards|best regards|danke|merci|gracias|grazie|groeten|grüße)\s*,?\s+\p{Lu}[\p{L}'-]+(?:\s\p{Lu}[\p{L}'.-]*){0,2}\.?$/u;

// Lines a signature is made of: a name, a job title or company, contact details.
const NAME_LINE = /^\p{Lu}[\p{L}'.-]*(?:[ ,]+(?:\p{Lu}[\p{L}'.-]*|van|von|der|den|de|del|da|di|la|le|du|dos|y|e)){0,4}$/u;
const CONTACT_LINE = /\+?\d[\d ().\/-]{6,}\d|@|\bwww\.|https?:\/\/|\b(?:tel|phone|mobile|mob|fax|cell|direct|office|ext|telefon|handy|téléphone|tél|teléfono|móvil|telefoon|cellulare)\b\.?\s*[:.]?|\s\|\s/i;
const SMALL_WORDS = new Set(['and', 'of', 'for', 'the', 'und', 'für', 'de', 'des', 'du', 'et', 'y', 'e', 'del', 'van', 'der', 'di', 'a', 'à', '&', '|', '-', '–', '/', ',']);
function titleLine(t) {
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8 || t.length > 70 || /[.!?]$/.test(t) && !/\b(?:Inc|Ltd|Co|Corp|GmbH|AG|S\.A|B\.V|Pty|LLC)\.?$/.test(t)) return false;
  const content = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  return content.length > 0 && content.filter((w) => /^[\p{Lu}\p{N}(]/u.test(w)).length / content.length >= 0.6;
}
const signatureLine = (line) => {
  const t = line.trim();
  if (!t || t.length > 90 || /\?\s*$/.test(t)) return false;
  return NAME_LINE.test(t) || titleLine(t) || (CONTACT_LINE.test(t) && t.split(/\s+/).length <= 10);
};

const LEGAL_PHRASE = new RegExp(
  [
    'this (?:e-?mail|message|communication|transmission)\\b.{0,80}\\b(?:is|are|may be|may contain|contains?)\\b.{0,30}\\b(?:confidential|privileged|intended (?:solely|only))',
    'confidentiality notice',
    'privileged and confidential',
    'if you (?:are not|have received this).{0,60}(?:intended recipient|in error)',
    'the information (?:contained )?in this (?:e-?mail|message|communication)',
    '^disclaimer\\s*:',
    'diese (?:e-?mail|nachricht)\\b.{0,60}\\b(?:enthält|kann)\\b.{0,40}\\bvertraulich',
    'wenn sie nicht der (?:richtige|beabsichtigte) (?:adressat|empfänger)',
    'sollten sie diese (?:e-?mail|nachricht) (?:irrtümlich|fälschlicherweise)',
    '(?:ce|le présent) (?:message|courriel|e-?mail)\\b.{0,80}\\b(?:confidentiel|strictement)',
    "si vous (?:avez reçu|n'êtes pas le destinataire)",
    '(?:este|el presente) (?:mensaje|correo)\\b.{0,80}\\bconfidencial',
    'si (?:usted )?no es el destinatario',
    'dit (?:e-?mail)?bericht\\b.{0,60}\\b(?:vertrouwelijk|uitsluitend bestemd)',
    'questo messaggio\\b.{0,80}\\briservat',
    'esta mensagem\\b.{0,80}\\bconfidencia',
  ].join('|'),
  'i'
);
const LEGAL_WORDS =
  /recipient|intended|addressee|notify|delete|destroy|prohibited|unauthori[sz]ed|disclos\w*|dissemination|distribution|copying|liabilit\w*|virus|privileged|in error|empfänger|adressat|absender|vernichten|löschen|untersagt|unzulässig|unerlaubt\w*|unbefugt\w*|weitergabe|irrtümlich|destinataire|supprimer|interdit\w*|par erreur|diffusion|destinatario|eliminar|prohibid\w*|por error|divulgaci\w*|bestemd|verwijder\w*|ontvanger|abusievelijk|cancellare|vietat\w*|per errore|destinatário|apagar|proibid\w*|por engano/gi;
const COMPANY_WORDS = /sitz der gesellschaft|registergericht|handelsregister|\bhrb\s?\d+|geschäftsführ\w*|registered (?:office|in (?:england|scotland|wales))|company (?:registration|reg\.?) (?:no|number)|\bvat (?:no|number|reg\w*)|ust-?id\w*/gi;
const PRINT_NOTE = /^(?:please )?(?:consider|think (?:of|about)) the environment before (?:you )?print|^think before you print|^bitte denken sie an die umwelt|^pensez à l'environnement avant d'imprimer/i;
const ASKS = /\?|\b(?:please (?:can|could|help|reset|check|fix|update|change)|could you|can you|i need|we need|können sie|könnten sie|ich brauche|pourriez-vous|pouvez-vous|podría|puede usted|kunt u|potete|può)\b/i;
const distinct = (text, re) => new Set((text.match(re) || []).map((w) => w.toLowerCase())).size;

function isLegalNotice(text) {
  if (text.length <= 160 && PRINT_NOTE.test(text)) return true;
  if (/\?/.test(text)) return false;
  if (text.length >= 120 && LEGAL_PHRASE.test(text) && distinct(text, LEGAL_WORDS) >= 3) return true;
  return text.length <= 500 && distinct(text, COMPANY_WORDS) >= 2 && !ASKS.test(text);
}

const BANNER = /^\[?(?:external|caution|warning|attention|notice|achtung|vorsicht|extern|externe)\]?\s*[:!\-–]?.{0,400}(?:outside (?:of )?(?:the |your |our )?organi[sz]ation|external (?:sender|email|e-mail)|from outside|externen absender|extern(?:en|e)? (?:e-?mail|absender)|expéditeur externe|remitente externo)/i;
const REPLY_FROM = /^reply from:\s*\S+@\S+\s*$/i;

const LEFT_OUT = '(earlier quoted email left out)';

const letterCount = (text) => (String(text).match(/\p{L}/gu) || []).length;
const isBlank = (line) => !line.trim();

// The line where a reply header starts, or -1. Line 0 cannot be one: the person's own text must be above it.
function replyHeaderAt(lines) {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (ORIGINAL.test(line)) return i;
    // "On ... wrote:" may be wrapped over up to three lines by the mail program.
    for (let n = 1; n <= 3 && i + n <= lines.length; n++) {
      const joined = lines.slice(i, i + n).map((l) => l.trim()).join(' ');
      if (joined.length > 320) break;
      if (WROTE.some((re) => re.test(joined)) && WROTE_EVIDENCE.test(joined)) return i;
    }
    if (H_FROM.test(line)) {
      const next = lines.slice(i + 1, i + 8).map((l) => l.trim()).filter(Boolean);
      // A date line with a time, and a subject line: "From: London / Date: 26 Oct / To: Paris" in a travel request is not a header.
      if (next.some((l) => H_SENT.test(l) && HAS_TIME.test(l)) && next.some((l) => H_SUBJECT.test(l))) {
        // Outlook draws a line of underscores above the block: cut from there.
        let start = i;
        for (let k = i - 1; k > 0; k--) {
          if (isBlank(lines[k])) continue;
          if (/^[_\-=]{8,}$/.test(lines[k].trim())) start = k;
          break;
        }
        return start;
      }
    }
  }
  return -1;
}

function cutQuoted(lines) {
  const at = replyHeaderAt(lines);
  if (at <= 0) return { lines, cut: false };
  // A message forwarded on purpose: the marker is the header line or one of the few lines above it.
  if (lines.slice(Math.max(0, at - 3), at + 1).some((l) => FORWARDED.test(l))) return { lines, cut: false };
  const own = lines.slice(0, at).join('\n');
  if (letterCount(own) < MIN_OWN_LETTERS || SEE_BELOW.test(own)) return { lines, cut: false };
  return { lines: lines.slice(0, at), cut: true };
}

// Paragraphs (runs of non-blank lines) as [start, end) line ranges.
function paragraphs(lines) {
  const out = [];
  let start = -1;
  lines.forEach((line, i) => {
    if (isBlank(line)) {
      if (start >= 0) out.push([start, i]);
      start = -1;
    } else if (start < 0) start = i;
  });
  if (start >= 0) out.push([start, lines.length]);
  return out;
}

// Legal notices at the end, paragraph by paragraph from the bottom; never the first paragraph.
function cutNotices(lines) {
  let out = lines;
  for (;;) {
    const paras = paragraphs(out);
    if (paras.length < 2) return out;
    const [s, e] = paras[paras.length - 1];
    if (!isLegalNotice(out.slice(s, e).join(' ').replace(/\s+/g, ' ').trim())) return out;
    out = out.slice(0, s);
  }
}

function cutSignature(lines) {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) end--;
  const body = lines.slice(0, end);
  const tailFrom = (i) => body.slice(i).filter((l) => !isBlank(l));
  const isSignature = (tail) => tail.length >= 1 && tail.length <= 8 && tail.every(signatureLine) && tail.join(' ').length <= 600;

  // "-- " on its own line: below it is the signature.
  for (let i = body.length - 1; i > 0; i--) {
    if (/^--\s?$/.test(body[i]) && isSignature(tailFrom(i + 1))) return body.slice(0, i);
  }
  // A sign-off line ("Kind regards,"): the name and contact lines below it go, the sign-off stays. Only the last sign-off counts.
  for (let i = body.length - 1; i > 0; i--) {
    const t = body[i].trim();
    if (!SIGN_OFF.test(t) && !SIGN_OFF_WITH_NAME.test(t)) continue;
    const tail = tailFrom(i + 1);
    return tail.length && isSignature(tail) ? body.slice(0, i + 1) : body;
  }
  // No sign-off: a last paragraph of signature lines, at least two of them contact details.
  const paras = paragraphs(body);
  if (paras.length >= 2) {
    const [s, e] = paras[paras.length - 1];
    const tail = body.slice(s, e);
    if (isSignature(tail) && tail.filter((l) => CONTACT_LINE.test(l)).length >= 2) return body.slice(0, s);
  }
  return body;
}

/**
 * The text without what a mail program added (see above). Returns the text unchanged when nothing applies or nothing would be left.
 * @param {string} text a journal entry or a description, already free of HTML
 * @returns {string}
 */
export function cleanEmailText(text) {
  const original = String(text ?? '');
  if (!original.trim()) return original;
  let lines = original.replace(/\r\n?/g, '\n').split('\n');

  // ServiceNow's "reply from: <address>" line, and an "external sender" banner, at the top.
  while (lines.length && isBlank(lines[0])) lines.shift();
  if (lines.length && REPLY_FROM.test(lines[0])) lines.shift();
  const paras = paragraphs(lines);
  if (paras.length > 1) {
    const banner = lines.slice(paras[0][0], paras[0][1]).join(' ').trim();
    if (banner.length <= 500 && BANNER.test(banner)) lines = lines.slice(paras[0][1]);
  }

  const quoted = cutQuoted(lines);
  lines = quoted.lines.filter((line) => !MOBILE.test(line.trim()));
  // Twice: a notice can sit below a signature and a signature below a notice.
  lines = cutSignature(cutNotices(cutSignature(cutNotices(lines))));

  // Nothing taken out: the text exactly as it was.
  if (!quoted.cut && lines.join('\n').trim() === original.replace(/\r\n?/g, '\n').trim()) return original;
  const out = lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (letterCount(out) < 1) return original;
  return quoted.cut ? `${out}\n${LEFT_OUT}` : out;
}
