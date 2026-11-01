import { useSyncExternalStore } from 'react';
import { EMAIL_TYPES, parseEmailDraft } from '../compose/emailRecommend.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';
import { emailClientTarget } from '../lib/fillable.js';
import { parseSafeText, toPlainText } from '../render/safeText.js';
import { t, tm } from '../i18n/index.js';

// A result the agent wants to carry to ANOTHER form: "Open a new article form" navigates the tab away, which would lose the
// draft with the record it came from. The draft is kept here, in memory only (never in storage), under these rules:
//   - it belongs to the ServiceNow site (origin) it was written on, and is shown only there: a draft made on one customer's
//     instance is never offered on another's
//   - it is shown only on a blank form of the table the feature names, or (an email draft, AI9) only on the email form of the
//     ticket it was written for: another ticket's email form never gets it
//   - it is dropped after 15 minutes, when the person closes it, and once every insert it offers (an article: title and body; an
//     email: subject and body) went in
// It holds the text and the firewall's memory of the values it masked (`scan`), which is why it does not stay long.
// <PendingDraft> shows it.

export const MAX_AGE_MS = 15 * 60 * 1000;
let pending = null;
let timer = null;
let seq = 0;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

/** "https://acme.service-now.com" from an address, or '' (only https sites hold a draft). */
export function originOf(href) {
  try {
    const url = new URL(String(href || ''));
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function drop() {
  clearTimeout(timer);
  timer = null;
  pending = null;
}

/** { table, sysId } of a ticket, lower case, or null when either is not a valid table name / sys_id. */
function ticketOf(ref) {
  const table = typeof ref?.table === 'string' ? ref.table.toLowerCase() : '';
  const sysId = typeof ref?.sysId === 'string' ? ref.sysId.toLowerCase() : '';
  return TABLE_RE.test(table) && SYS_ID_RE.test(sysId) ? { table, sysId } : null;
}

/**
 * @param {{ feature: object, text: string, people: object[], scan: Function|null, origin: string, internalTexts?: string[],
 *   email?: { table: string, sysId: string } }} draft  `email`: an email draft, bound to the email form of that ticket (emailDraft)
 * @returns {boolean} false when the draft was not kept (no known site, or an email draft without a valid ticket, to bind it to)
 */
export function setPending(draft) {
  const email = draft?.email == null ? undefined : ticketOf(draft.email);
  if (!draft || !originOf(draft.origin) || email === null) {
    clearPending();
    return false;
  }
  drop();
  seq += 1;
  pending = { ...draft, ...(email ? { email } : {}), origin: originOf(draft.origin), at: Date.now(), id: seq };
  // The memory is released when the draft expires, even if nothing else happens in the panel.
  timer = setTimeout(() => {
    if (pending && Date.now() - pending.at >= MAX_AGE_MS) {
      drop();
      emit();
    }
  }, MAX_AGE_MS + 1000);
  timer.unref?.();
  emit();
  return true;
}

export function clearPending() {
  if (!pending) return;
  drop();
  emit();
}

export function getPending(now = Date.now()) {
  if (pending && now - pending.at > MAX_AGE_MS) drop();
  return pending;
}

/**
 * Is this draft the one to show on this page? Same site, and a blank form of the table the feature names; for an email draft, the
 * email form (email_client.do, also inside nav_to.do) of the very ticket it was written for.
 */
export function pendingFits(draft, page) {
  if (!draft || !draft.origin || originOf(page?.href) !== draft.origin) return false;
  if (draft.email) {
    const want = ticketOf(draft.email);
    const here = emailClientTarget(page.href);
    return Boolean(want && here) && here.table === want.table && here.sysId === want.sysId;
  }
  const table = draft.feature?.open?.table;
  return Boolean(table) && page?.newRecord?.table === table;
}

// ---- An email draft (AI9): from an answer on the Ticket screen to the email form of that ticket ------------------------------------

/** Is this one of the six AI email drafts (src/features/packs/compose.js)? A refinement counts as its base (AnswerCard passes that). */
/**
 * The subject with the ticket's number in it ("INC0010001: Your VPN is working again"). The subject replaces the one the email form
 * put there, which carries the number; ServiceNow can match a customer's reply to the ticket by the number in the subject, so it
 * stays. A subject that already names the ticket is left as it is.
 */
export function subjectWithNumber(subject, number) {
  const s = String(subject || '').trim();
  const n = String(number || '').trim();
  if (!s || !/^[A-Z]{2,10}\d{4,12}$/i.test(n) || s.toLowerCase().includes(n.toLowerCase())) return s;
  return `${n}: ${s}`.slice(0, 200);
}

export const isEmailFeature = (feature) => Boolean(feature?.id) && EMAIL_TYPES.some((type) => type.featureId === feature.id);

/**
 * The draft "Open the email form" carries to the email form of the ticket it was written for, or null when it cannot be bound
 * (no https site, no valid ticket, no text). The answer text is split into its subject line and body (parseEmailDraft); a draft
 * without a "Subject:" line is all body.
 * @param {{ feature: object, text: string, people?: object[], scan?: Function|null, internalTexts?: string[],
 *   internalPhrases?: string[], href: string, ticket: { table: string, sysId: string }, number?: string, provider?: string,
 *   model?: string }} args  href: the page the answer is on (its site); ticket: the record the answer was written for
 */
export function emailDraft({ feature, text, people = [], scan = null, internalTexts = [], internalPhrases = [], href, ticket, number = '', provider = '', model = '' } = {}) {
  const origin = originOf(href);
  const email = ticketOf(ticket);
  if (!origin || !email || !feature?.id) return null;
  const { subject, body } = parseEmailDraft(toPlainText(parseSafeText(String(text ?? ''))));
  if (!body.trim()) return null;
  return {
    feature,
    text: String(text ?? ''),
    subject: subjectWithNumber(subject, number),
    body,
    people: Array.isArray(people) ? people : [],
    scan: typeof scan === 'function' ? scan : null,
    internalTexts: Array.isArray(internalTexts) ? internalTexts : [],
    internalPhrases: Array.isArray(internalPhrases) ? internalPhrases : [],
    origin,
    email,
    number: String(number || '').slice(0, 40),
    provider: String(provider || ''),
    model: String(model || ''),
  };
}

/**
 * The inserts an email draft offers on the email form: the subject (replaced: it is one line, and the client may have put its own
 * there) and the body (added below what the client put in, a signature say). No subject line in the draft = the body only.
 * `fieldLabel` is the box's name on the form (the page's own label, for a form without g_form).
 */
export function emailInserts(draft) {
  const out = [];
  // (fieldLabel is the page's own label of the box, matched in the page in English: marked with tm(), shown with t() where it is read)
  if (draft?.subject) out.push({ field: 'subject', label: t('Insert subject'), fieldLabel: tm('Subject'), mode: 'replace', pick: () => draft.subject });
  if (draft?.body) out.push({ field: 'body', label: t('Insert body'), fieldLabel: tm('Body'), mode: 'append', pick: () => draft.body });
  return out;
}

/** The expectation every insert of an email draft carries: the email form of that ticket, nothing else (src/lib/fillable.js). */
export const emailExpect = (draft) => {
  const ticket = ticketOf(draft?.email);
  return ticket ? { email: true, table: ticket.table, sysId: ticket.sysId } : null;
};

/**
 * Which inserts of the draft's feature are done once `spec` went in, and whether that is all of them. A draft is used up only then:
 * an article draft has a title AND a body, and dropping it after the title would leave the body with nowhere to come from.
 * @param {string[]} done fields already inserted from this draft
 * @param {{ field?: string }} spec the insert that just succeeded
 * @param {{ insert?: object|object[] }} feature
 * @returns {{ done: string[], complete: boolean }}
 */
export function afterInsert(done, spec, feature) {
  const field = String(spec?.field || '');
  const next = field && !done.includes(field) ? [...done, field] : done;
  const wanted = [].concat(feature?.insert || []).filter(Boolean).map((s) => String(s.field || ''));
  return { done: next, complete: wanted.every((f) => next.includes(f)) };
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// (the same snapshot is given for rendering on a server, so the card can be rendered to markup in tests)
const snapshot = () => getPending();
export const usePending = () => useSyncExternalStore(subscribe, snapshot, snapshot);
