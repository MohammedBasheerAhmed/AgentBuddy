// Turn a ContextPack (src/context) into the untrusted "parts" the firewall wraps and masks, and collect everyone whose
// name must be masked. Pure. Only data already on the pack is used, and the pack only holds allowlisted fields.
//
// Two things the builders here do for the size and the quality of the request (TRACKER AI0.3):
//  - A record column is marked `inline: true`. The firewall puts a short, one-line inline part as a "Label: value" line into ONE
//    shared <ticket_data field="fields"> block instead of a block of its own (a long or multi-line value still gets its own block).
//    Masking, blocked fields and Strict mode treat it exactly as before: they work on the part, not on the layout.
//  - Free text that may have come in by email (a description, a note) loses what the mail program added: the quoted thread,
//    signatures, legal notices (cleanEmailText in src/context/journal.js). The pack keeps the whole text.
import { cleanEmailText } from '../context/journal.js';
import { t, tm } from '../i18n/index.js';
import { tableLabel } from '../lib/tableLabels.js';

const LABELS = {
  number: 'Number',
  short_description: 'Short description',
  description: 'Description',
  state: 'State',
  priority: 'Priority',
  impact: 'Impact',
  urgency: 'Urgency',
  category: 'Category',
  subcategory: 'Subcategory',
  assignment_group: 'Assignment group',
  assigned_to: 'Assigned to',
  caller_id: 'Caller',
  opened_by: 'Opened by',
  requested_for: 'Requested for',
  contact: 'Contact',
  account: 'Account',
  cmdb_ci: 'Configuration item',
  business_service: 'Business service',
  opened_at: 'Opened',
  resolved_at: 'Resolved',
  close_code: 'Close code',
  close_notes: 'Close notes',
  contact_type: 'Contact type',
  cat_item: 'Catalog item',
  request_item: 'Requested item', // (the fallback would say 'Request item'; F10)
  hr_service: 'HR service',
  stage: 'Stage',
  due_date: 'Due date',
  product: 'Product',
  type: 'Type',
  risk: 'Risk',
};

// (an unknown column becomes words, and a short word that is always written in capitals keeps them: 'u_hr_leave' -> 'U HR leave')
const CAPITALS = /\b(hr|it|ci|sla|kb|vip|id|url)\b/g;
export const labelFor = (field) => LABELS[field] || String(field).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(CAPITALS, (w) => w.toUpperCase());

// Columns whose text is often an email (a ticket opened by mail): cleaned like a note.
const EMAIL_COLUMNS = new Set(['description']);

/** The text of a record column as it goes into a part: trimmed, and cleaned of mail clutter where that column can hold an email. */
export const columnText = (field, value) => {
  const text = String(value ?? '').trim();
  return EMAIL_COLUMNS.has(field) ? cleanEmailText(text) : text;
};

/** The text of a journal entry as it goes into a part: trimmed and cleaned of mail clutter. */
export const noteText = (entry) => cleanEmailText(String(entry?.text ?? '').trim());

/** The journal fields: a part with one of these carries one note or comment (the oldest are the first to go when a request is cut). */
export const JOURNAL_FIELDS = Object.freeze(['comments', 'work_notes']);
export const isJournalPart = (part) => JOURNAL_FIELDS.includes(part?.field);

/**
 * @param {object} pack ContextPack
 * @param {{ journal?: number, skipFields?: string[], journalTypes?: string[] }} [options]
 * @returns {Array<{ label: string, field: string, text: string, inline?: boolean }>}
 */
export function packToParts(pack, { journal = 12, skipFields = [], journalTypes } = {}) {
  const parts = [];
  Object.entries(pack?.fields || {}).forEach(([field, value]) => {
    const text = columnText(field, value);
    if (!text || skipFields.includes(field)) return;
    parts.push({ label: labelFor(field), field, text, inline: true });
  });

  let entries = Array.isArray(pack?.journal) ? pack.journal : [];
  if (journalTypes) entries = entries.filter((e) => journalTypes.includes(e.type));
  // Newest entries matter most; keep them in chronological order for reading.
  // (slice(-0) would keep everything, so a depth of 0 is handled on its own.)
  entries = journal > 0 ? entries.slice(-journal) : [];
  entries.forEach((e) => {
    const text = noteText(e);
    if (!text) return;
    // The author goes inside the masked text, not in the label, so a name can never slip out through trusted markup.
    const kind = e.type === 'work_note' ? 'Work note' : 'Customer-visible comment';
    parts.push({ label: kind, field: e.type === 'work_note' ? 'work_notes' : 'comments', text: `[${e.when || ''}] ${e.by || 'Unknown'}: ${text}` });
  });
  return parts;
}

/** Everyone whose name/email must be masked: the pack's people plus every journal author. */
export function peopleFor(pack) {
  const byKey = new Map();
  const out = [];
  const add = (p) => {
    if (!p.name && !p.email) return;
    // The same person appears as caller, as journal author, as assignee: one entry, with the email if any source had it.
    const key = (p.name || p.email).toLowerCase();
    const known = byKey.get(key);
    if (known) {
      if (!known.email && p.email) known.email = p.email;
      return;
    }
    const copy = { ...p };
    byKey.set(key, copy);
    out.push(copy);
  };
  (pack?.people || []).forEach(add);
  (pack?.journal || []).forEach((e) => e.by && add({ role: 'author', name: e.by }));
  return out;
}

// ---- What could not be read, or was left out ------------------------------------------------------------------------------------
//
// A summary of a ticket whose notes the person cannot read must say "the notes were not readable", not "Not stated". So every request
// carries one short part listing what was not available (src/lib/pipeline.js adds it), and the panel gets the same list to show
// "Made without: ..." next to the answer. All wording here is fixed: nothing from the instance's error text.

// What each source is, for the person and for the model: the name of a table through the one shared label (src/lib/tableLabels.js), so
// "Made without" and the "Not available" part say 'Incidents' and 'Customer service cases' for the table they read, wherever it is read
// from (before, two tables were given the name of one place they happen to be read: 'Linked incidents', "The account's other cases").
// The words stay English for the model (sourceWords with english: true); the panel shows them in its language (madeWithout below).
// A few sources are not tables: the notes, the chat messages, the field history and the caller's other tickets.
const SOURCE_TABLE = { journal: 'sys_journal_field', chat: 'sys_cs_message', 'field history': 'sys_audit' };
const SOURCE_PHRASE = { 'caller-history': tm("The caller's other tickets"), tickets: tm('Tickets') };
const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** What a source is called, with a capital: 'SLAs', 'Customer service cases'. English for the model, the panel's language otherwise. */
export function sourceWords(source, { english = true } = {}) {
  const name = String(source ?? '').trim();
  if (Object.hasOwn(SOURCE_PHRASE, name)) return english ? SOURCE_PHRASE[name] : t(SOURCE_PHRASE[name]);
  const table = SOURCE_TABLE[name] || name;
  if (TABLE_NAME.test(table)) return tableLabel(table, { plural: true, sentenceCase: true, english });
  return english ? 'Something' : t('Something'); // a source nobody can name: never print it as it is
}

// People lookups only affect email addresses; the model has no use for hearing about them.
const QUIET_SOURCES = new Set(['sys_user', 'csm_consumer', 'customer_contact', 'sys_user_group']);

// For the model (the part), worded as the domain features have always said it.
const PHRASE = {
  blocked: 'not allowed by your organisation (do not describe it as empty)',
  denied: 'not readable by your user',
  'empty-or-hidden': 'nothing visible to your user; it may exist but be hidden from them',
  error: 'could not be read',
  partial: 'some of it may be hidden from your user (do not say there is none)',
};
// For the person ("Made without: ...").
const PERSON_PHRASE = {
  blocked: tm('not allowed by your organisation'),
  denied: tm('you cannot read them'),
  'empty-or-hidden': tm('may be hidden from you'),
  error: tm('could not be read'),
  skipped: tm('not read'),
  partial: tm('some may be hidden from you'),
};
// The two kinds of note a journal read can come back without (src/context/journal.js workNotesHidden / commentsHidden).
const HIDDEN_NOTES = [
  ['workNotesHidden', 'Internal notes', tm('Internal notes')],
  ['commentsHidden', 'Comments to the customer', tm('Comments to the customer')],
];

const present = (value) => String(value ?? '').trim();

/**
 * What the request is made without, from the pack's access list: one entry per source the person's user could not read, the
 * organisation does not allow, or that was left out on purpose (`skipped`, with the fixed note saying why). Reads made for
 * reference material (`reference: true`, src/itsm/reference.js) are left to the reference status part.
 * @returns {Array<{ source: string, what: string, status: string, why: string, note: string }>} `why`: plain words for the person
 */
export function unavailable(pack) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(pack?.access) ? pack.access : []) {
    if (!a || typeof a !== 'object' || QUIET_SOURCES.has(a.source) || a.reference === true) continue;
    const status = String(a.status || '');
    // The read worked but came back without a whole kind of note: not an error, not proof that there are none.
    for (const [flag, what] of HIDDEN_NOTES) {
      if (a[flag] === true && !seen.has(`${what}|partial`)) {
        seen.add(`${what}|partial`);
        out.push({ source: String(a.source || 'journal'), what, status: 'partial', why: PERSON_PHRASE.partial, note: '' });
      }
    }
    if (!PHRASE[status] && !(status === 'skipped' && present(a.note))) continue;
    const source = String(a.source || '');
    // (a skip on the record's own table is the record's own fields; any other status on that table is a read of OTHER records of it)
    const what = source && source === pack?.table && status === 'skipped' ? 'Some fields of this ticket' : sourceWords(source);
    const key = `${what}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, what, status, why: PERSON_PHRASE[status], note: status === 'skipped' ? present(a.note).slice(0, 300) : '' });
  }
  return out;
}

/**
 * The facts about notes that are not in a request, or null when every note is in it. `sent` is the number of note parts sent,
 * `depth` how many the feature asks for, `trimmed` how many the pipeline left out to fit the model. `more`: older notes were not
 * even read (src/context/journal.js marks its access entry with `more: true`).
 * @returns {{ sent: number, total: number, more: boolean, trimmed: number } | null}
 */
export function journalCut(pack, { sent = 0, depth = 0, trimmed = 0, fields = null } = {}) {
  // Only the kinds of entry the feature sends at all count (a feature that sends customer comments only is not "missing" the work
  // notes): `fields` is the set of journal part fields it built ('comments', 'work_notes'); chat messages count as comments.
  const counts = (e) => !fields || fields.has(e?.type === 'work_note' ? 'work_notes' : 'comments');
  const total = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => present(e?.text) && counts(e)).length;
  const more = (Array.isArray(pack?.access) ? pack.access : []).some(
    (a) => a && a.source === 'journal' && (a.more === true || /Showing the newest \d+ entries/.test(String(a.note || '')))
  );
  // The feature asked for `depth` notes, got them, and more exist: the older ones were left out by design.
  const byDepth = depth > 0 && sent + trimmed === depth && total > depth;
  if (!sent && !trimmed) return null;
  if (!trimmed && !more && !byDepth) return null;
  return { sent, total, more, trimmed };
}

function notesLine({ sent, total, more, trimmed }) {
  if (trimmed) return `Older notes and comments were left out so that the request fits the AI model: the newest ${sent} of ${total} are included.`;
  if (more) return `Only the newest ${total} notes and comments could be read; older ones exist and are not included.`;
  return `Only the newest ${sent} of the ${total} notes and comments are included.`;
}

/**
 * The text of the "Not available" part, or ''. One line per source that could not be read, then one line about notes left out.
 * @param {ReturnType<typeof unavailable>} list
 * @param {ReturnType<typeof journalCut>} [cut]
 */
export function unavailableText(list, cut = null) {
  const lines = list.map((u) => `- ${u.what}: ${u.status === 'skipped' ? u.note : PHRASE[u.status]}`);
  const head = lines.length ? `These parts could not be read, so do not describe them as empty or as "none":\n${lines.join('\n')}` : '';
  return [head, cut ? notesLine(cut) : ''].filter(Boolean).join('\n');
}

/** The handle of the part (src/features/partColumns.js maps it to no column: it carries no ticket data). */
export const NOT_AVAILABLE_FIELD = 'data_not_available';

/** The part itself, or null when nothing is missing. */
export function notAvailablePart(list, cut = null) {
  const text = unavailableText(list, cut);
  return text ? { label: 'Not available', field: NOT_AVAILABLE_FIELD, text } : null;
}

/** The one line the panel can show under an answer: "Made without: Notes and comments (you cannot read them); SLAs (...)." */
export const madeWithoutText = (list) =>
  Array.isArray(list) && list.length ? t('Made without: {list}.', { list: list.map((m) => t('{what} ({why})', { what: m.what, why: m.why })).join(t('; ')) }) : '';

/** "Made without: ..." for the panel: `{ what, why, status }` in plain words, nothing from the instance. */
export function madeWithout(list, cut = null) {
  // (for the person only, so it is said in the language of the panel; what the model reads is unavailableText above)
  const out = list.map((u) => ({ what: u.what === 'Some fields of this ticket' ? t('Some fields of this ticket') : u.status === 'partial' ? t(u.what) : sourceWords(u.source, { english: false }), why: t(u.why), status: u.status }));
  if (cut) {
    const why = cut.trimmed
      ? t('left out to fit the AI model (the newest {sent} of {total} were sent)', { sent: cut.sent, total: cut.total })
      : cut.more
        ? t('not read (only the newest {total} could be read)', { total: cut.total })
        : t('left out (the newest {sent} of {total} were sent)', { sent: cut.sent, total: cut.total });
    out.push({ what: t('Older notes and comments'), why, status: 'cut' });
  }
  return out;
}
