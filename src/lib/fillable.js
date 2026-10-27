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
//   expect            the record a text was written for. The panel sends it with FILL_FIELD; the content script compares it with
//                     the form that is open now and answers 'wrong-record' on a mismatch.
//
// A new insert in a feature pack needs its field here: tests/insert-fillable.test.js walks the whole registry and fails when an
// insert field is missing, so a new feature cannot silently fail to insert.

import { MSG } from './messages.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

export const FILLABLE_FIELDS = Object.freeze({
  // Journal fields of the ticket forms (comments are customer-visible, work notes are not).
  comments: Object.freeze({ customerVisible: true }),
  work_notes: Object.freeze({}),
  close_notes: Object.freeze({ customerVisible: true }),
  // Fields the feature packs insert into.
  description: Object.freeze({ customerVisible: true }),
  short_description: Object.freeze({ singleLine: true, customerVisible: true }),
  cause_notes: Object.freeze({}),
  workaround: Object.freeze({}),
  text: Object.freeze({ html: true, customerVisible: true }), // the knowledge article body
  // The email client.
  body: Object.freeze({ customerVisible: true }),
  subject: Object.freeze({ singleLine: true, customerVisible: true }),
  // Notes to ticket: choices on a blank incident or case form.
  impact: Object.freeze({ singleLine: true }),
  urgency: Object.freeze({ singleLine: true }),
  contact_type: Object.freeze({ singleLine: true }),
});

const has = (field) => typeof field === 'string' && Object.prototype.hasOwnProperty.call(FILLABLE_FIELDS, field);

/** May FILL_FIELD write this column at all? */
export const isFillable = (field) => has(field);

/** { html?, singleLine?, customerVisible? } for a fillable field, or null. */
export const fieldMeta = (field) => (has(field) ? FILLABLE_FIELDS[field] : null);

export const isHtmlField = (field) => fieldMeta(field)?.html === true;
export const isSingleLineField = (field) => fieldMeta(field)?.singleLine === true;

/** Can the customer (or the reader of the article) see this field? A field nobody described counts as visible: the safe side. */
export const isCustomerVisible = (field) => (has(field) ? FILLABLE_FIELDS[field].customerVisible === true : true);

/** 'replace' or 'append' for an insert into `field`. A one-line field is always replaced: appending gives "Title\n\nTitle". */
export function fillModeFor(field, requested) {
  if (isSingleLineField(field)) return 'replace';
  return requested === 'replace' ? 'replace' : 'append';
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
  'no-form': 'Agent Buddy could not reach a form field on this page.',
  'no-such-field': 'That field is not on this form.',
  'read-only': 'That field is read-only on this form.',
  'too-long': 'The text is too long to insert.',
  'set-failed': 'The form did not accept the text.',
  'bad-field': 'That field cannot be filled.',
  'wrong-record': 'The open form is not the record this text was written for.',
});

export const FILL_REASONS = Object.freeze(Object.keys(FILL_REASON_TEXT));

export const fillReasonText = (reason) => FILL_REASON_TEXT[reason] || 'Could not insert it.';

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

// The record and table of the email client address: .../email_client.do?sysparm_table=incident&sysparm_sys_id=<id>, also when the
// classic shell wraps it (nav_to.do?uri=email_client.do%3Fsysparm_table%3D...).
export function emailClientTarget(href) {
  try {
    let url = new URL(href);
    if (/\/nav_to\.do$/i.test(url.pathname)) {
      const uri = url.searchParams.get('uri') || '';
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `/${uri.replace(/^\/+/, '')}`, url.origin);
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
  if (kind === 'email') return `This was written for the email form of ${number || 'its own ticket'}. Open that email form, or use Copy.`;
  if (kind === 'new') return `This was written for a new ${want.table} form. Open that form again, or use Copy.`;
  return `This was written for ${number || (kind ? `another ${want.table} record` : 'another record')}. Open that ticket again, or use Copy.`;
}

/**
 * The line shown after a successful insert. A box found in the page (Workspace, portal) is named as well, so a wrong box is easy to
 * see before the person saves: 'It went into the box labelled "Additional comments".'
 */
export function insertedNote(answer) {
  const base = 'Inserted into the form. Review it, then save the record yourself.';
  if (answer?.method === 'dom' && typeof answer.label === 'string' && answer.label) return `${base} It went into the box labelled "${answer.label}".`;
  return base;
}

/** The record of the page an Agent Buddy result is for, for the audit log: table and sys_id only. */
export const auditRefFromPage = (page) => ({ table: page?.record?.table || page?.newRecord?.table || '', sysId: page?.record?.sysId || '' });

// ---- The message ---------------------------------------------------------------------------------------------------

/**
 * The FILL_FIELD message for the content script. `value` is plain text: the content script turns it into HTML for an HTML field.
 * `expect` undefined means "the page as it is now" (a safe default for a caller that forgot); pass null to say "any form".
 */
export function buildFillMessage({ field, value, label = '', mode = 'append', expect, page = null }) {
  const message = { type: MSG.FILL_FIELD, field, value, label, mode: fillModeFor(field, mode) };
  const want = expect === undefined ? expectFromPage(page) : expect;
  if (want) message.expect = want;
  return message;
}
