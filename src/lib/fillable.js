// The one place that knows which form fields Agent Buddy may write to and what each of them is like. Pure: no DOM, no chrome.*.
//
//   FILLABLE_FIELDS   the ONLY column names FILL_FIELD may write (the content script refuses anything else), with
//                     { html?, singleLine?, customerVisible? } for each:
//                       html             the form keeps HTML in it (the knowledge article body). Plain text is turned into
//                                        escaped HTML (toSafeHtml) before it reaches the form, so markup in a model answer is
//                                        shown as text and never becomes live.
//                       singleLine       a one-line field (a title, a choice). It is replaced, never appended to, and a line
//                                        break becomes a space.
//                       customerVisible  the person who raised the ticket (or the reader of the article) can read it. The
//                                        send check looks at this text first. A field that is not listed counts as visible.
//                       choice           (round 4) a choice list: filled with its STORED value, never a label and never typed
//                                        into a box. Only a form with g_form can set one with certainty; elsewhere the page bridge
//                                        refuses ('choice-by-hand') and the panel says which choice to pick by hand.
//   expect            the record a text was written for. The panel sends it with FILL_FIELD; the content script compares it with
//                     the form that is open now and answers 'wrong-record' on a mismatch.
//   replacing         (round 3) the text this panel put into the same box before: on append, the page swaps that one copy for the
//                     new text when the box still holds it as a whole block, so "Try again" + Insert never leaves two answers.
//   describeInsert()  where an insert lands and what the person does next (Save; Post in a Workspace; the page's own Send on a
//                     portal), said before the click (TRACKER.md F5).
//   undo              (round 4, docs/round4.md) a FILL_FIELD answer carries what the box held before and what the insert left in
//                     it (`undo: { previous, after }`, from the page, checked as data). The panel keeps them in memory only and
//                     can put the earlier text back with a FILL_FIELD of mode 'undo' (buildUndoMessage), which the page refuses
//                     ('changed') unless the box still holds exactly what the insert left there. Nothing is saved either way.
//
// A new insert in a feature pack needs its field here: tests/insert-fillable.test.js walks the whole registry and fails when an
// insert field is missing, so a new feature cannot silently fail to insert.

import { MSG } from './messages.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';
// (core.js, not index.js: this file is also in the page script's bundle, which has no Arabic catalogue to carry. The texts below are
// only ever shown by the side panel.)
import { t, tm, isolate, t as tr } from '../i18n/core.js';
import { tableLabel } from './tableLabels.js';

// The kinds of ticket whose comments the requester may not see (src/features/packs/kinds.js NOTE_FIRST_KINDS, and a problem, which has
// no customer). The kind is the panel's (src/context/kinds.js), so every task table is 'task'.
const NO_REQUESTER_KINDS = new Set(['catalog_task', 'task', 'problem']);

export const FILLABLE_FIELDS = Object.freeze({
  // Journal fields of the ticket forms (comments are customer-visible, work notes are not).
  comments: Object.freeze({ customerVisible: true }),
  work_notes: Object.freeze({}),
  close_notes: Object.freeze({ customerVisible: true }),
  // Fields the feature packs insert into.
  description: Object.freeze({ customerVisible: true }),
  short_description: Object.freeze({ singleLine: true, customerVisible: true }),
  cause_notes: Object.freeze({}),
  fix_notes: Object.freeze({}), // a problem's "Fix notes": where its resolution goes (a problem form has no close_notes box)
  workaround: Object.freeze({}),
  text: Object.freeze({ html: true, customerVisible: true }), // the knowledge article body
  // The email client.
  body: Object.freeze({ customerVisible: true }),
  subject: Object.freeze({ singleLine: true, customerVisible: true }),
  // Notes to ticket: choices on a blank incident or case form.
  impact: Object.freeze({ singleLine: true }),
  urgency: Object.freeze({ singleLine: true }),
  contact_type: Object.freeze({ singleLine: true }),
  // Prepare to close (round 4): an incident's close code, by its stored value, next to the resolution notes. A code from the
  // instance's own list, not text anyone wrote, so no send check. The second field of the user's named exception to "one field per
  // Insert" (docs/build-rules.md, rule 1).
  close_code: Object.freeze({ singleLine: true, choice: true }),
});

const has = (field) => typeof field === 'string' && Object.prototype.hasOwnProperty.call(FILLABLE_FIELDS, field);

/** May FILL_FIELD write this column at all? */
export const isFillable = (field) => has(field);

/** { html?, singleLine?, customerVisible? } for a fillable field, or null. */
export const fieldMeta = (field) => (has(field) ? FILLABLE_FIELDS[field] : null);

export const isHtmlField = (field) => fieldMeta(field)?.html === true;
export const isSingleLineField = (field) => fieldMeta(field)?.singleLine === true;
/** A choice list (filled by its stored value, and only where the form can set it with certainty). */
export const isChoiceField = (field) => fieldMeta(field)?.choice === true;

/** Can the customer (or the reader of the article) see this field? A field nobody described counts as visible: the safe side. */
export const isCustomerVisible = (field) => (has(field) ? FILLABLE_FIELDS[field].customerVisible === true : true);

/** 'replace' or 'append' for an insert into `field`. A one-line field is always replaced: appending gives "Title\n\nTitle". */
export function fillModeFor(field, requested) {
  if (isSingleLineField(field)) return 'replace';
  return requested === 'replace' ? 'replace' : 'append';
}

/** The modes a person may choose for `field`: a one-line field only replaces; anything else can replace or go below. */
export const fillModesFor = (field) => (isSingleLineField(field) ? ['replace'] : ['replace', 'append']);

// Journal fields: written on the form, posted when the form is saved (classic) or with the composer's Post (Workspace).
const JOURNAL = new Set(['comments', 'work_notes']);
export const isJournalField = (field) => JOURNAL.has(field);

// ---- Where the text lands, and what the person does next ------------------------------------------------------------

const FIELD_NAMES = {
  comments: tm('Additional comments'),
  work_notes: tm('Work notes'),
  close_notes: tm('Resolution notes'),
  text: tm('the article body'),
  short_description: tm('Short description'),
  subject: tm('the email subject'),
  body: tm('the email body'),
  close_code: tm('Close code'),
};
// The email client's own boxes (an AI email draft carried to the email form, AI9). They are named for what they are, whatever the
// page calls them, and nothing goes anywhere until the person presses Send there.
const EMAIL_FIELDS = new Set(['subject', 'body']);
export const EMAIL_NEXT = tm('Nothing is sent until you press Send in the email form.'); // an English text: show it with t()

// ---- What comes after the notes of a close (audit of 2026-11-07, F13) ---------------------------------------------------------------
// The notes and the close code are not what closes a ticket: the state is, and nothing said so ("Then press Save" is all the insert used
// to say). Advice, not a claim: whether the form needs the state, or another field, before it will save is not known here, and the words
// of an instance's own states may differ from the base system's. One sentence per kind, written out in full; the names of the states are
// what the form's State list shows, so they go in as data (isolate keeps them whole) and are not translated.
//   incident, problem   the state Resolved          requested item, catalog task   Closed Complete, or Closed Incomplete / Closed Skipped
//   change              Closed                      customer service case, HR case  the state the organisation's process uses
// A kind with no step of its own (a request, a plain task, anything else) has none: the insert says what it always said.
const CLOSE_FIELDS = new Set(['close_notes', 'fix_notes', 'close_code']);

/** The sentence that names the state step of a close for this kind of ticket, or '' when the kind has none. */
export function closeStep(kind) {
  switch (kind) {
    case 'incident':
    case 'problem':
      return t('Set State to {state}, then save.', { state: isolate('Resolved') });
    case 'requested_item':
    case 'catalog_task':
      return t('Set State to {done} (or {notDone} or {skipped}), then save.', { done: isolate('Closed Complete'), notDone: isolate('Closed Incomplete'), skipped: isolate('Closed Skipped') });
    case 'change':
      return t('Move the change to {state}, then save.', { state: isolate('Closed') });
    case 'case':
    case 'hr_case':
      return t('Set the state your process uses to close, then save.');
    default:
      return '';
  }
}

/**
 * What a comment on a catalog task says about its reader, by whether the requester can read the task (wave 6; src/domain/requesterReads.js
 * works out which of the three applies). The platform does not decide it: a requester reads a catalog task only by its read rule (it asks who
 * opened the task) and its comments have no rule of their own (docs/live-checks-2026-11-07.md). So:
 *   true   the person who opened the task is the requester                  "The requester can read comments on this task."
 *   false  someone else opened it                                           "The requester may not see this." (and where to reach them)
 *   null   either is not known: the sentence this panel has always said     (the careful one)
 */
export function catalogCommentCaution(requesterCanRead = null) {
  if (requesterCanRead === true) return t('The requester can read comments on this task.');
  if (requesterCanRead === false) return t('The requester may not see this. Use the requested item to reach them.');
  return t('The requester may not see comments on a catalog task. Use the requested item to reach them.');
}

/**
 * One line that says where an insert lands, one that says what to do after it, and a caution when the box is not what it seems.
 * Shown BEFORE the click, next to the Insert button (TRACKER.md F5: "say where text lands and the next step").
 * @param {{ field: string, fieldLabel?: string, mode?: string, kind?: string, surface?: string, table?: string, composerMode?: string,
 *   requesterCanRead?: boolean|null }} target
 *   surface: 'classic' | 'workspace' | 'portal' | 'other' (the page the person is on); table: the form the insert belongs to;
 *   composerMode: what the page said a Workspace composer is set to ('match' = to this field's kind): then the caution that it might not be goes;
 *   requesterCanRead: for a comment on a catalog task, whether the requester can read it (catalogCommentCaution): true / false / null (not known).
 *   One boolean from the ticket's own read (src/domain/requesterReads.js); any other kind ignores it.
 * @returns {{ where: string, next: string, caution: string }}
 */
export function describeInsert({ field, fieldLabel = '', mode = 'append', kind = '', surface = 'classic', table = '', composerMode = '', requesterCanRead = null } = {}) {
  const email = EMAIL_FIELDS.has(field);
  // (the label is an English text marked in the feature, or the page's own label: tr shows the known ones in the panel's language)
  const label = (email ? FIELD_NAMES[field] : fieldLabel) || FIELD_NAMES[field] || field;
  const name = tr(label);
  const replacing = fillModeFor(field, mode) === 'replace';
  const into = table === 'kb_knowledge' ? t('the article form ({name})', { name }) : name;
  // Whole sentences, so a language can put the clause about who reads it where it likes. The customer sees a comment on an incident, a
  // request or a case; on a catalog task or any other task (and a problem, which has no customer) the requester MAY NOT, and nothing
  // here says they do (audit of 2026-11-07, W-02).
  const requesterMayNotSee = field === 'comments' && NO_REQUESTER_KINDS.has(kind);
  // (a catalog task whose opener is the requester: they can read the task, and its comments have no rule of their own)
  const requesterReads = requesterMayNotSee && kind === 'catalog_task' && requesterCanRead === true;
  const reader = requesterReads ? 'requester' : requesterMayNotSee ? 'maybe' : field === 'comments' ? 'customer' : field === 'work_notes' ? 'colleagues' : isCustomerVisible(field) && table !== 'kb_knowledge' && !email ? 'often' : '';
  let where;
  if (replacing) {
    where =
      reader === 'maybe' ? t('Replaces what is in {into}, which the requester may not see.', { into })
      : reader === 'requester' ? t('Replaces what is in {into}, which the requester can read.', { into })
      : reader === 'customer' ? t('Replaces what is in {into}, which the customer sees.', { into })
      : reader === 'colleagues' ? t('Replaces what is in {into}, which only your colleagues see.', { into })
      : reader === 'often' ? t('Replaces what is in {into}, which the customer can often read.', { into })
      : t('Replaces what is in {into}.', { into });
  } else {
    where =
      reader === 'maybe' ? t('Goes below what is in {into}, which the requester may not see.', { into })
      : reader === 'requester' ? t('Goes below what is in {into}, which the requester can read.', { into })
      : reader === 'customer' ? t('Goes below what is in {into}, which the customer sees.', { into })
      : reader === 'colleagues' ? t('Goes below what is in {into}, which only your colleagues see.', { into })
      : reader === 'often' ? t('Goes below what is in {into}, which the customer can often read.', { into })
      : t('Goes below what is in {into}.', { into });
  }
  if (email) return { where, next: tr(EMAIL_NEXT), caution: '' };

  let next = t('Then press Save.');
  let caution = '';
  if (isJournalField(field) && surface === 'workspace') {
    next = t('Then press Post.');
    if (composerMode !== 'match') caution = t('In a Workspace one box can hold both comments and work notes: check it is set to {box} before you post.', { box: field === 'comments' ? t('Additional comments') : t('Work notes') });
  } else if (isJournalField(field) && surface === 'portal') {
    next = t("Then press the page's own Send.");
  } else if (field === 'comments' && !requesterMayNotSee) {
    // (softly: whether saving emails the caller depends on how the ticket came in and on the site's notifications, which nothing here knows)
    next = t('Then press Save. The customer may be emailed.');
  } else if (table === 'kb_knowledge') {
    next = t('Then save the article.');
  }
  // The notes (or the code) of a close: the state is the step that closes the ticket, so the line names it for the kind (F13).
  if (CLOSE_FIELDS.has(field) && surface !== 'portal' && table !== 'kb_knowledge') next = closeStep(kind) || next;
  if (field === 'comments' && kind === 'catalog_task') caution = catalogCommentCaution(requesterCanRead);
  else if (field === 'comments' && kind === 'task' && !caution) caution = t('The requester may not see comments on a task. Check who can see them.');
  return { where, next, caution };
}

/** A line break, tab or run of spaces is one space; for one-line fields. */
export const toOneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// ---- Plain text for an HTML field ----------------------------------------------------------------------------------

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Plain text as HTML that cannot carry markup: & < > " ' are escaped, a blank line starts a new paragraph, a line break is <br>.
 * "<img src=x onerror=1>" becomes "&lt;img src=x onerror=1&gt;": shown as the characters, never parsed as a tag. The only tags in
 * the result are the <p> and <br> this function writes itself.
 */
export function toSafeHtml(text) {
  const plain = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!plain) return '';
  return plain
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// ---- Why an insert failed ------------------------------------------------------------------------------------------

/** What the person reads for each reason FILL_FIELD can answer with. The content script maps any other reason to 'no-form'. */
export const FILL_REASON_TEXT = Object.freeze({
  'no-form': tm('Agent Buddy could not reach a form field on this page.'),
  'no-such-field': tm('That field is not on this form.'),
  // (read back after the write, or by the list of editable fields, or by a ticket that is closed: all three look the same to a person)
  'read-only': tm('This field is locked on this form.'),
  'too-long': tm('The text is too long to insert.'),
  'set-failed': tm('The form did not accept the text.'),
  'bad-field': tm('That field cannot be filled.'),
  'wrong-record': tm('The open form is not the ticket this text was written for.'),
  // Round 4: a choice list on a page without g_form (Workspace, portal), a value the form's list does not have, and an Undo of a box
  // that no longer holds what the insert left there.
  'choice-by-hand': tm('Agent Buddy does not pick from a list on this page.'),
  'no-such-choice': tm('That choice is not in the list on this form.'),
  changed: tm('The box was changed after the insert, so it was left as it is.'),
  // Audit of 2026-11-07, part 9 (Workspaces): a page too big to look through in time, and a composer that is set to the other kind of note.
  unreachable: tm('This page is too big for Agent Buddy to find the box.'),
  'wrong-mode': tm('The box on this page is set to the other kind of note. Switch it, then try again.'),
});

export const FILL_REASONS = Object.freeze(Object.keys(FILL_REASON_TEXT));

export const fillReasonText = (reason) => (FILL_REASON_TEXT[reason] ? tr(FILL_REASON_TEXT[reason]) : t('Could not insert it.'));

// ---- The record a text was written for -------------------------------------------------------------------------------

/**
 * `expect` as FILL_FIELD carries it:
 *   { table, sysId }               a saved record
 *   { table, newRecord: true }     a blank form of that table
 *   { email: true, table, sysId }  the email client opened for that record
 * Anything else that is present is invalid, and an invalid expectation is a mismatch (fail closed).
 * @returns {null | 'invalid' | { kind: 'record'|'new'|'email', table: string, sysId?: string }} null = no expectation
 */
export function parseExpect(expect) {
  if (expect === undefined || expect === null) return null;
  if (typeof expect !== 'object' || Array.isArray(expect)) return 'invalid';
  const table = typeof expect.table === 'string' ? expect.table.toLowerCase() : '';
  if (!TABLE_RE.test(table)) return 'invalid';
  const sysId = typeof expect.sysId === 'string' ? expect.sysId.toLowerCase() : '';
  if (expect.email === true) return SYS_ID_RE.test(sysId) ? { kind: 'email', table, sysId } : 'invalid';
  if (expect.newRecord === true) return { kind: 'new', table };
  return SYS_ID_RE.test(sysId) ? { kind: 'record', table, sysId } : 'invalid';
}

// The address a wrapper carries inside it, or '': the classic shell (nav_to.do?uri=email_client.do%3Fsysparm_table%3D...) and the
// Next Experience (/now/nav/ui/classic/params/target/email_client.do%3Fsysparm_table%3D..., where the whole inner address sits
// encoded in the path). It is decoded up to twice, as the address may have been encoded twice (src/context/kinds.js does the same).
function wrappedAddress(url) {
  let inner = '';
  let inPath = false;
  if (/\/nav_to\.do$/i.test(url.pathname)) inner = url.searchParams.get('uri') || '';
  else {
    const target = /\/params\/target\/(.+)$/i.exec(url.pathname);
    if (target) {
      inner = target[1];
      inPath = true;
    }
  }
  // (only the address in a path is still encoded: the uri parameter of the classic shell was decoded once by URLSearchParams)
  for (let i = 0; inPath && i < 2 && /%(?:3F|3D|26|2F|25)/i.test(inner); i += 1) {
    try {
      inner = decodeURIComponent(inner);
    } catch {
      break;
    }
  }
  // (a wrapper that was not encoded keeps the inner query where a query goes)
  return inPath && inner && !inner.includes('?') ? inner + url.search : inner;
}

// The record and table of the email client address: .../email_client.do?sysparm_table=incident&sysparm_sys_id=<id>, also when the
// classic shell or the Next Experience wraps it (see wrappedAddress); a wrapper inside a wrapper is followed up to three levels.
export function emailClientTarget(href) {
  try {
    let url = new URL(href);
    for (let depth = 0; depth < 3; depth += 1) {
      const inner = wrappedAddress(url);
      if (!inner) break;
      const next = new URL(/^[a-z][a-z0-9+.-]*:/i.test(inner) ? inner : `/${inner.replace(/^\/+/, '')}`, url.origin);
      if (next.origin !== url.origin) return null; // a wrapper that points at another site is no email form of this one
      url = next;
    }
    if (!/\/email_client\.do$/i.test(url.pathname)) return null;
    return { table: (url.searchParams.get('sysparm_table') || '').toLowerCase(), sysId: (url.searchParams.get('sysparm_sys_id') || '').toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Is the form that is open now the one the text was written for?
 * @param {*} expect as sent (see parseExpect); null/undefined = no expectation = true
 * @param {{ record?: {table: string, sysId: string}|null, newRecord?: {table: string}|null, href?: string }} current what the page shows now
 */
export function matchesExpect(expect, current) {
  const want = parseExpect(expect);
  if (want === null) return true;
  if (want === 'invalid') return false;
  const here = current && typeof current === 'object' ? current : {};
  if (want.kind === 'record') {
    return Boolean(here.record) && String(here.record.table || '').toLowerCase() === want.table && String(here.record.sysId || '').toLowerCase() === want.sysId;
  }
  if (want.kind === 'new') return !here.record && String(here.newRecord?.table || '').toLowerCase() === want.table;
  const target = emailClientTarget(here.href);
  return Boolean(target) && target.table === want.table && target.sysId === want.sysId;
}

/** The expectation for "this page, right now": the open record, or the blank form's table, or none. */
export function expectFromPage(page) {
  if (page?.record?.table && SYS_ID_RE.test(page.record.sysId || '')) return { table: page.record.table, sysId: page.record.sysId };
  if (page?.newRecord?.table) return { table: page.newRecord.table, newRecord: true };
  return null;
}

/**
 * Which form an insert on a result card must land in:
 *   target   set by a draft that waits on a blank form ({ table, newRecord: true }): that form, nothing else
 *   spec.table  an insert for another kind of form (an article's title and body): whichever form is open now (ResultView has already
 *            checked it is of that table)
 *   source   the record the answer was written for ({ expect, number })
 *   otherwise the page as it is now
 * A target of undefined means "not set"; null means "any form".
 */
export function expectForInsert({ spec, source, target, page }) {
  if (target !== undefined) return target;
  if (spec && spec.table) return expectFromPage(page);
  return source ? source.expect : expectFromPage(page);
}

/** What the content script would see: the shape matchesExpect() wants, from the panel's `page`. */
export const currentFromPage = (page) => ({ record: page?.record || null, newRecord: page?.newRecord || null, href: page?.href || '' });

/**
 * The record a result was written for, from the pack of the run: { expect, number }, or null when the pack stands for no record
 * (a pasted text has a made-up sys_id). Used by RunPanel for ResultView.
 */
export function sourceFromPack(pack) {
  if (!pack || !TABLE_RE.test(String(pack.table || '')) || !SYS_ID_RE.test(String(pack.sysId || ''))) return null;
  return { expect: { table: pack.table, sysId: pack.sysId }, number: String(pack.number || '').slice(0, 40) };
}

/**
 * What the panel says when the open form is not the one a text was written for. The number is the record's own when it is known:
 *   "This was written for INC0010001. Open that ticket again, or use Copy."
 */
export function wrongRecordText(source) {
  const want = parseExpect(source?.expect);
  const kind = want && want !== 'invalid' ? want.kind : '';
  const number = String(source?.number || '').trim();
  if (kind === 'email') return t('This was written for the email form of {number}. Open that email form, or use Copy.', { number: number ? isolate(number) : t('its own ticket') });
  if (kind === 'new') return t('This was written for a new {form} form. Open that form again, or use Copy.', { form: tableLabel(want.table) });
  const record = number ? isolate(number) : kind ? t('another {type}', { type: tableLabel(want.table) }) : t('another ticket');
  return t('This was written for {record}. Open that ticket again, or use Copy.', { record });
}

/**
 * The line shown after a successful insert. A box found in the page (Workspace, portal) is named as well, so a wrong box is easy to
 * see before the person saves: 'It went into the box labelled "Additional comments".'
 */
export function insertedNote(answer, target = null) {
  // With the target ({ field, surface, ... }) the note names the next step for that box (Post in a Workspace, Save on a form).
  const base = target?.field ? t('Inserted. Review it. {next}', { next: describeInsert(target).next }) : t('Inserted into the form. Review it, then save the ticket yourself.');
  const named = answer?.method === 'dom' && typeof answer.label === 'string' && answer.label ? t('{base} It went into the box labelled "{label}".', { base, label: isolate(answer.label) }) : base;
  // A Workspace composer serves Work notes and customer comments: when the page could not say which one it was set to, a work note must be
  // checked before it is posted (audit of 2026-11-07, W-12). A customer reply is safe either way: it was reviewed for the customer.
  return answer?.modeUnread === true && target?.field === 'work_notes' ? `${named} ${t('Check the box says Work notes before you post.')}` : named;
}

/** The record of the page an Agent Buddy result is for, for the audit log: table and sys_id only. */
export const auditRefFromPage = (page) => ({ table: page?.record?.table || page?.newRecord?.table || '', sysId: page?.record?.sysId || '' });

// ---- The message ---------------------------------------------------------------------------------------------------

/** Longest `replacing` text sent with FILL_FIELD (the content script and the bridge use the same limit for any text). */
export const MAX_REPLACING_CHARS = 20000;
/** Longest text an Undo carries either way (what the box held before, what the insert left there): the same limit. */
export const MAX_UNDO_CHARS = 20000;

/**
 * The FILL_FIELD message for the content script. `value` is plain text: the content script turns it into HTML for an HTML field.
 * `expect` undefined means "the page as it is now" (a safe default for a caller that forgot); pass null to say "any form".
 * `replacing` (append only, never for an HTML or one-line field): the text this panel put into the same box earlier. When the box
 * still holds it, the page swaps it for the new text instead of adding a second copy below (Try again, then Insert again).
 */
export function buildFillMessage({ field, value, label = '', mode = 'append', expect, page = null, replacing = '' }) {
  const message = { type: MSG.FILL_FIELD, field, value, label, mode: fillModeFor(field, mode) };
  const want = expect === undefined ? expectFromPage(page) : expect;
  if (want) message.expect = want;
  const earlier = typeof replacing === 'string' ? replacing.trim() : '';
  if (message.mode === 'append' && earlier && earlier.length <= MAX_REPLACING_CHARS && !isHtmlField(field)) message.replacing = earlier;
  return message;
}

// ---- Undo (round 4) ------------------------------------------------------------------------------------------------------

const undoText = (v) => (typeof v === 'string' && v.length <= MAX_UNDO_CHARS ? v : null);

/**
 * One step an Undo can take, from a FILL_FIELD answer: the box, what it held before, what the insert left in it, and the record it
 * belongs to. null when the answer carries nothing usable (an older content script, a page that said nothing, a text too long), when
 * the insert changed nothing, or when it was not bound to a record (an Undo always names the record it is for).
 * @param {object} answer the FILL_FIELD answer ({ ok: true, undo: { previous, after } })
 * @param {{ field: string, fieldLabel?: string, expect?: object|null, stamp?: string }} target  stamp: page.formStamp at the insert
 * @returns {{ field: string, fieldLabel: string, previous: string, after: string, expect: object, stamp: string } | null}
 */
export function undoStepOf(answer, { field, fieldLabel = '', expect = null, stamp = '' } = {}) {
  if (!answer || answer.ok !== true || !isFillable(field)) return null;
  const want = parseExpect(expect);
  if (!want || want === 'invalid') return null;
  const u = answer.undo && typeof answer.undo === 'object' ? answer.undo : null;
  const previous = undoText(u?.previous);
  const after = undoText(u?.after);
  if (previous === null || after === null || !after.trim() || previous === after) return null;
  return { field, fieldLabel: typeof fieldLabel === 'string' ? fieldLabel.slice(0, 100) : '', previous, after, expect, stamp: typeof stamp === 'string' ? stamp : '' };
}

/**
 * The FILL_FIELD message that puts one box back: `value` is what it held before (it may be empty), `current` what the insert left
 * there. The page refuses ('changed') when the box holds anything else now, so a text the person typed since is never lost.
 */
export function buildUndoMessage(step) {
  return { type: MSG.FILL_FIELD, field: step.field, value: step.previous, current: step.after, label: step.fieldLabel || '', mode: 'undo', expect: step.expect };
}

/** Can an Undo still be offered on this page? The same record, and no Save since the insert (the form stamp, when the page has one). */
export function undoStillFor(step, page) {
  if (!step || !matchesExpect(step.expect, currentFromPage(page))) return false;
  const now = typeof page?.formStamp === 'string' ? page.formStamp : '';
  return !step.stamp || !now || step.stamp === now;
}
