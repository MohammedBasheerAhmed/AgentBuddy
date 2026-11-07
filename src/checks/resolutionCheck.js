// C2, "Check before you resolve": a short list of things worth a second look before a ticket is resolved or closed.
// It ADVISES and never blocks: nothing here stops the agent, changes the record or asks for anything.
//
// Inputs are the saved record (a ContextPack, kind incident / problem / request / requested item / catalog task / case /
// task) and the form's CURRENT, unsaved values for a fixed set of fields when the page has a form we can read. On a Workspace
// (no g_form) only the notes boxes are read (`formSource: 'boxes'`): every other field, and a box that was not found, is the
// saved value, and the hints say that what was not read is not counted. Where nothing can be read (portals) the saved record is
// checked and the caller says so.
//
// Personal data and secrets are reported by KIND and COUNT only ("1 email address"). The value itself is never copied into
// a result, so the list is safe to show, log or screenshot.
//
// A check is { id, status: 'ok' | 'warn' | 'info', title, hint }. Pure: no I/O, the clock comes in as `now`.

import { checkOutgoing } from '../safeSend/index.js';
import { LIMITS } from '../context/allowlists.js';
import { authorRole, identities } from '../context/identity.js';
import { clipText } from '../context/util.js';
import { daysSinceSnTime, isFinishedState, isOpenItem } from './states.js';
import { isolate, t, tm, tn } from '../i18n/index.js';
import { answerWords } from '../insights/personWords.js';

const text = (v) => String(v ?? '').trim();

/** How many days of silence after the agent's last message is "enough waiting". */
export const DEFAULT_WAIT_DAYS = 3;
/** Fewer characters than this (or fewer words) is too little to help the next person. */
export const MIN_NOTE_CHARS = 40;
export const MIN_NOTE_WORDS = 6;

// The code field a kind uses (other kinds have none: a request item is simply closed). A change has a close code too (W-10).
const CODE_FIELD = { incident: 'close_code', problem: 'resolution_code', case: 'resolution_code', change: 'close_code' };

// The words of the kind (audit of 2026-11-07, F4, F8, F12: "Ready to resolve?" was an incident's). A kind that FULFILS something (a request,
// a requested item, a catalog task) has no cause to explain: it says what was delivered. Kinds whose form calls the box "Close notes"
// (everything but an incident and a customer service case) say "close notes".
const FULFILMENT = new Set(['request', 'requested_item', 'catalog_task']);
const RESOLUTION_NOTES = new Set(['incident', 'case', 'problem', 'other']);
const closeNotes = (kind) => Boolean(kind) && !RESOLUTION_NOTES.has(kind);
// The kinds whose comments the person it is for does not read, or that have nobody to answer: a catalog task (the requester reads the
// requested item), a change, a problem and the tasks of a ticket. There is no conversation with a customer to check on them.
const NO_CUSTOMER_CONVERSATION = new Set(['catalog_task', 'change', 'problem', 'task']);
// What the person is called in "has not confirmed" (the same words the Ticket screen uses: src/sidepanel/ticket/cards/Glance.jsx).
const confirmer = (kind) =>
  ({ request: t('the requester has not confirmed'), requested_item: t('the requester has not confirmed'), hr_case: t('the employee has not confirmed'), case: t('the customer has not confirmed') })[kind] || t('the caller has not confirmed');
// Kinds where a linked problem or article is worth a nudge.
const LINK_KINDS = new Set(['incident', 'problem', 'case', 'task']);
// The pack list that holds the open work under each kind, and what to call one.
const CHILD_LIST = {
  incident: ['childTasks', 'task'],
  problem: ['childTasks', 'task'],
  case: ['childTasks', 'task'],
  task: ['childTasks', 'task'],
  requested_item: ['catalogTasks', 'catalog task'],
  request: ['items', 'requested item'],
};
// The words for what a ticket's children are called (the noun above is a key, not a text).
const nounPlural = (noun) => ({ task: t('tasks'), 'catalog task': t('catalog tasks'), 'requested item': t('requested items') })[noun];
const nounCount = (noun, n) =>
  noun === 'task' ? tn(n, '{n} task', '{n} tasks') : noun === 'catalog task' ? tn(n, '{n} catalog task', '{n} catalog tasks') : tn(n, '{n} requested item', '{n} requested items');

// "1 email address", "2 phone numbers": what was found, by kind and count.
function kindCount(kind, n) {
  switch (kind) {
    case 'EMAIL':
      return tn(n, '{n} email address', '{n} email addresses');
    case 'PHONE':
      return tn(n, '{n} phone number', '{n} phone numbers');
    case 'CARD':
      return tn(n, '{n} card number', '{n} card numbers');
    case 'IBAN':
      return tn(n, '{n} bank account number', '{n} bank account numbers');
    case 'NATIONAL_ID':
      return tn(n, '{n} ID number', '{n} ID numbers');
    case 'IP':
      return tn(n, '{n} IP address', '{n} IP addresses');
    case 'MAC':
      return tn(n, '{n} device address', '{n} device addresses');
    case 'DOB':
      return tn(n, '{n} date of birth', '{n} dates of birth');
    case 'ADDRESS':
      return tn(n, '{n} postal address', '{n} postal addresses');
    case 'EMPLOYEE_ID':
      return tn(n, '{n} employee id', '{n} employee ids');
    case 'SECRET':
      return tn(n, '{n} password or key', '{n} passwords or keys');
    case 'URL_CREDENTIALS':
      return tn(n, '{n} link with a password in it', '{n} links with a password in them');
    case 'OTHER_PERSON':
      return tn(n, "{n} other person's name", "{n} other persons' names");
    case 'INTERNAL_PHRASE':
      return tn(n, '{n} wording meant to stay internal', '{n} wordings meant to stay internal');
    default:
      return tn(n, '{n} item', '{n} items');
  }
}
// What counts in earlier comments that are already on the ticket: only the serious ones.
const SERIOUS = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);

const check = (id, status, title, hint = '') => ({ id, status, title, hint });
const fold = (s) => text(s).toLowerCase().replace(/\s+/g, ' ');

// ---- what could not be read -----------------------------------------------------------------------------------------------
// An empty list of notes only means "no notes" when the notes could be read. The context engine says so in the pack's `access`
// list (source 'journal'); a check that is about the notes must not answer "nothing there" when it was not allowed to look.

// ('blocked': the organisation's policy does not let Agent Buddy read that table; 'skipped': not read on purpose.)
const NOT_READ = new Set(['denied', 'empty-or-hidden', 'error', 'skipped', 'blocked']);
export const NOTES_UNREADABLE = tm('Could not read the notes and comments');
const noForm = () => t('This page has no form Agent Buddy can read, so anything you have typed and not saved is not counted.');
// A Workspace page: the notes boxes are read, nothing else.
const noNotesBox = () => t('The resolution notes box was not found on this page, so notes typed there and not saved are not counted.');
const codeNotRead = () => t('On this page only the notes are read, so a code picked and not saved yet is not counted.');

/** The access entry for the notes when they could not be read (or may be hidden from this user); null when they were read. */
function unreadableNotes(pack) {
  return (Array.isArray(pack?.access) ? pack.access : []).find((e) => e?.source === 'journal' && NOT_READ.has(e.status)) || null;
}

/** The notes' entry when the read worked but the customer's comments may be hidden (their column did not come back and none were found). */
const hiddenComments = (pack) => (Array.isArray(pack?.access) ? pack.access : []).find((e) => e?.source === 'journal' && e.commentsHidden === true) || null;

const sentence = (s) => text(s).replace(/([^.!?])$/, '$1.');

// ---- the effective value of a field: the form if it has it, else the saved record -----------------------------------

function effective(pack, form, name) {
  if (form && typeof form[name] === 'string') return { value: form[name], fromForm: true };
  return { value: text(pack?.fields?.[name]), fromForm: false };
}

// What to add to a hint about `name` when its value is only the saved one: nothing when the form had it (or a form with g_form does
// not have the field at all, so nothing can be typed there); the "no form" text when nothing could be read; on a Workspace, `notRead`.
function notCounted(form, source, fromForm, notRead) {
  if (fromForm) return '';
  if (!form) return ` ${noForm()}`;
  return source === 'boxes' ? ` ${notRead}` : '';
}

// ---- resolution notes ----------------------------------------------------------------------------------------------

// Words that say nothing about WHAT fixed it. A note made only of these is as good as empty.
const FILLER = new Set(
  ('issue problem ticket incident request case has have been is are now was were resolved resolve fixed fix done closed close closing completed complete ' +
    'ok okay sorted na n/a none nil test thanks thank you solved working works worked as requested per user customer caller the a an by and successfully ' +
    'please see above same finished').split(' ')
);

/** Is this note only filler like "Resolved." or "Issue fixed, thanks"? */
export function isFillerNote(note) {
  const words = fold(note).replace(/[^\p{L}\p{N}/\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.every((w) => FILLER.has(w));
}

// The saved value of a column that did not come back with the ticket (a field this user may not read): "none yet" is not known (R-14).
const savedUnreadable = (pack, name) => Array.isArray(pack?.unreadable) && pack.unreadable.includes(name);

// The record was read without its free text on purpose (an HR case, or a policy family, when sensitive data is not allowed): an empty
// close_notes there is not "no notes yet". The entry the reader left says why, in a fixed sentence.
function minimisedEntry(pack) {
  return (Array.isArray(pack?.access) ? pack.access : []).find((e) => e?.source === pack?.table && e.status === 'skipped' && text(e.note)) || null;
}

// What to say when there are no notes at all, by kind: the incident's cause and fix, a delivery, a change's outcome.
function noNotes(kind) {
  if (FULFILMENT.has(kind)) return [t('No close notes yet'), t('Say what was delivered or done, and anything the requester still has to do. These notes are what the next person finds when the same request comes in again.')];
  if (kind === 'change') return [t('No close notes yet'), t('Say whether the change worked, what was done and how it was checked. These notes are what the next person finds when a similar change comes up.')];
  if (kind === 'hr_case') return [t('No close notes yet'), t('Say what was done and how it ended.')];
  if (kind === 'task') return [t('No close notes yet'), t('Say what was done and what it produced.')];
  return [t('No resolution notes yet'), t('Say what the cause was and what fixed it. These notes are what the next person finds when the same thing happens again.')];
}

function notesCheck(pack, form, source) {
  const { value, fromForm } = effective(pack, form, 'close_notes');
  const body = text(value);
  const kind = pack?.kind;
  if (!body && !fromForm && savedUnreadable(pack, 'close_notes')) {
    return check('notes', 'info', closeNotes(kind) ? t('Could not read the saved close notes') : t('Could not read the saved resolution notes'), t('ServiceNow did not send them to you. Check on the form whether they are filled in.'));
  }
  const minimised = !body && !fromForm ? minimisedEntry(pack) : null;
  if (minimised) {
    return check('notes', 'info', closeNotes(kind) ? t('Could not read the saved close notes') : t('Could not read the saved resolution notes'), `${sentence(minimised.note)} ${t('Check on the form whether they are filled in.')}`);
  }
  if (!body) {
    // A work note typed on the form is not a substitute: it stays internal and is not what the next person searches.
    const workNote = form && text(form.work_notes) ? ` ${t('The work note you have typed is separate from these notes.')}` : '';
    // With no readable form (or, on a Workspace, no notes box found) the notes being empty is only what is SAVED: say that the
    // typed ones could not be seen.
    const unseen = notCounted(form, source, fromForm, noNotesBox());
    const [title, hint] = noNotes(kind);
    return check('notes', 'warn', title, `${hint}${workNote}${unseen}`);
  }
  if (isFillerNote(body)) return check('notes', 'warn', t('The notes only say "resolved"'), t('Add what was wrong and what you did, in a sentence or two. "Resolved" does not help anyone later.'));
  const words = body.split(/\s+/).filter(Boolean).length;
  if (body.length < MIN_NOTE_CHARS || words < MIN_NOTE_WORDS) {
    if (FULFILMENT.has(kind)) return check('notes', 'warn', t('The close notes are very short'), t('A sentence on what was delivered and one on anything left for the requester makes them far more useful to the next person.'));
    if (closeNotes(kind)) return check('notes', 'warn', t('The close notes are very short'), t('A sentence on what was done and one on how it ended makes them far more useful to the next person.'));
    return check('notes', 'warn', t('The resolution notes are very short'), t('A sentence on the cause and one on the fix makes them far more useful to the next person.'));
  }
  return check('notes', 'ok', closeNotes(kind) ? t('Close notes are filled in') : t('Resolution notes are filled in'));
}

// ---- close code ----------------------------------------------------------------------------------------------------

function codeCheck(pack, form, source) {
  const field = CODE_FIELD[pack?.kind];
  if (!field) return null;
  // (On a Workspace the code is never read from the page: the form object has no such field, so this is the saved code.)
  const { value, fromForm } = effective(pack, form, field);
  if (!text(value) && !fromForm && savedUnreadable(pack, field)) {
    return check('code', 'info', t('Could not read the saved close code'), t('ServiceNow did not send it to you. Check on the form whether one is chosen.'));
  }
  if (!text(value)) {
    const hint = pack?.kind === 'change' ? t('Pick the code that says how the change went. Reports and trends use it.') : t('Pick the code that best describes the fix. Reports and trends use it.');
    return check('code', 'warn', t('No close code chosen'), `${hint}${notCounted(form, source, fromForm, codeNotRead())}`);
  }
  return check('code', 'ok', t('A close code is chosen'));
}

// ---- did the customer answer? -------------------------------------------------------------------------------------

// Who the customer is, and whether they wrote a note, is src/context/identity.js: names in any script, logins and email addresses.
function customerCheck(pack, now, waitDays) {
  // No conversation with a customer on this kind of ticket (its comments are not the requester's, or there is nobody to answer): there
  // is nothing to check, and the Close row can say "Looks ready" (F4). The notes being unreadable still shows, in the personal data check.
  if (NO_CUSTOMER_CONVERSATION.has(pack?.kind)) return null;
  // (the person is the requester of a request or a requested item and the employee of an HR case; an incident and a case keep "the customer", F11)
  const who = answerWords(pack);
  const unreadable = unreadableNotes(pack) || hiddenComments(pack);
  if (unreadable) {
    const why = sentence(unreadable.note) || t('You may not be able to see them.');
    return check('customer', 'info', t('Could not read the notes and comments'), `${why} ${who.unreadableHint()}`);
  }
  const visible = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e?.type === 'comment' && text(e.text));
  // A request is fulfilled without a word: nothing written is not a finding for the requester (an incident with no messages is).
  if (!visible.length && FULFILMENT.has(pack?.kind)) return null;
  if (!visible.length) {
    return check('customer', 'info', who.noMessages(), t('If you confirmed the fix by phone or in person, say so in the resolution notes.'));
  }
  const ids = identities(pack);
  if (!ids.known) {
    return check('customer', 'info', who.cannotTell(), who.cannotTellHint());
  }
  const last = visible[visible.length - 1];
  const role = authorRole(last.by, ids);
  if (role === 'customer') {
    return check('customer', 'ok', who.wroteLast(), t('Read it once more and make sure it confirms the fix.'));
  }
  // A login (or address) that matches no customer may still be theirs; an author with no name at all cannot be placed either.
  if (role === 'unknown') {
    return check('customer', 'info', t('Could not tell who wrote the last message'), who.authorUnknownHint());
  }
  const days = daysSinceSnTime(last.when, now);
  if (Number.isFinite(days) && days >= waitDays) {
    return check('customer', 'ok', tn(Math.floor(days), 'No reply for {n} day since your last message', 'No reply for {n} days since your last message'), t('That is a fair wait. Mention in the notes that you asked and heard nothing.'));
  }
  if (Number.isFinite(days)) {
    const age = days < 1 ? t('today') : tn(Math.floor(days), '{n} day ago', '{n} days ago');
    return check(
      'customer',
      'warn',
      who.notReplied(age),
      tn(waitDays, 'Wait for an answer (about {n} day is usual) or confirm the fix another way before you resolve.', 'Wait for an answer (about {n} days is usual) or confirm the fix another way before you resolve.')
    );
  }
  return check('customer', 'warn', t('The last message on the ticket is from an agent and there is no reply yet'), t('Wait for an answer or confirm the fix another way before you resolve.'));
}

// ---- open work under this ticket -----------------------------------------------------------------------------------

function childCheck(pack) {
  const spec = CHILD_LIST[pack?.kind];
  if (!spec) return null;
  const [key, noun] = spec;
  const list = pack?.related?.[key];
  if (!Array.isArray(list)) {
    const entry = (pack?.access || []).find((e) => e?.source === { childTasks: 'task', catalogTasks: 'sc_task', items: 'sc_req_item' }[key]);
    const why =
      entry?.status === 'blocked'
        ? t('Your organisation does not allow Agent Buddy to read {things}.', { things: nounPlural(noun) })
        : entry?.status === 'denied'
          ? t('You cannot see {things} with your role.', { things: nounPlural(noun) })
          : entry?.status
            ? t('The {things} could not be read.', { things: nounPlural(noun) })
            : '';
    return check('children', 'info', t('Could not check for open {things}', { things: nounPlural(noun) }), why || t('Look at the related list on the form.'));
  }
  const open = list.filter(isOpenItem);
  // (none under it that this user can see: a task of another class or group may be hidden by a row rule, which cannot be told: R-05)
  if (!open.length) return check('children', 'ok', list.length ? t('All {count} closed', { count: nounCount(noun, list.length) }) : t('No {things} that you can see under this ticket', { things: nounPlural(noun) }));
  const named = open.slice(0, 4).map((row) => [isolate(text(row.number)), text(row.state) && `(${isolate(text(row.state))})`].filter(Boolean).join(' ')).filter(Boolean);
  const names = open.length > named.length ? t('{names} and {extra} more', { names: named.join(t(', ')), extra: open.length - named.length }) : named.join(t(', '));
  return check('children', 'warn', t('{count} still open', { count: nounCount(noun, open.length) }), t('Close or hand over {names} first, or leave a note saying why they stay open.', { names }));
}

// ---- linked problem or knowledge ----------------------------------------------------------------------------------

const KB_MENTION = /\bKB\d{4,}\b/i;

function linkCheck(pack, links, notes) {
  if (!LINK_KINDS.has(pack?.kind)) return null;
  const problem = links?.problem?.status || '';
  const mentioned = KB_MENTION.test(notes);
  const knowledge = mentioned ? 'yes' : links?.knowledge?.status || '';
  const found = [];
  if (problem === 'yes') found.push(t('a problem'));
  if (knowledge === 'yes') found.push(mentioned && links?.knowledge?.status !== 'yes' ? t('an article (named in the notes)') : t('an article'));
  if (found.length) return check('links', 'ok', t('Linked to {things}', { things: found.length > 1 ? t('{names} and {last}', { names: found[0], last: found[1] }) : found[0] }));
  if (!links) return check('links', 'info', t('Could not check for a linked problem or article'), t('Look at the related lists on the form.'));
  const unsure = [problem, knowledge].includes('unknown') || !knowledge;
  const incident = pack?.kind === 'incident';
  if (unsure) {
    return check(
      'links',
      'info',
      incident ? t('Could not fully check for a linked problem or article') : t('Could not fully check for a linked article'),
      `${[links?.problem?.note, links?.knowledge?.note].filter(Boolean).join(' ')} ${t('Look at the related lists on the form.')}`.trim()
    );
  }
  return check('links', 'info', incident ? t('No problem or article is linked') : t('No article is linked'), t('If this is likely to happen again, link a problem or attach an article (or write one) so the fix is easy to find.'));
}

// ---- personal data and secrets -----------------------------------------------------------------------------------

function tally(counts, findings, keep) {
  for (const f of findings) if (keep(f)) counts.set(f.kind, (counts.get(f.kind) || 0) + 1);
}

function describeCounts(counts) {
  return [...counts.entries()].map(([kind, n]) => kindCount(kind, n)).join(t(', '));
}

function piiCheck(pack, form, source) {
  const people = pack?.people || [];
  const unreadable = unreadableNotes(pack);
  const where = [];
  let scanned = false;

  const scan = (label, body, keep) => {
    if (!text(body)) return;
    scanned = true;
    const counts = new Map();
    let findings = [];
    try {
      findings = checkOutgoing(body, { people }).findings;
    } catch {
      /* a failing scan must never break the list: treat as nothing found */
    }
    tally(counts, findings, keep);
    if (counts.size) where.push({ label, counts });
  };

  // The notes and the agent's unsent customer comment: everything that is not just "low" counts.
  const notable = (f) => f.severity !== 'low';
  scan(t('the resolution notes'), effective(pack, form, 'close_notes').value, notable);
  if (form) scan(t('the comment you have not sent yet'), form.comments, notable);
  // Comments already on the ticket (the customer's own too): a password or card number is worth knowing about.
  const earlier = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e?.type === 'comment');
  const earlierCounts = new Map();
  for (const e of earlier) {
    let findings = [];
    try {
      findings = checkOutgoing(text(e.text), { people }).findings;
    } catch {
      /* see above */
    }
    if (text(e.text)) scanned = true;
    tally(earlierCounts, findings, (f) => SERIOUS.has(f.kind));
  }
  if (earlierCounts.size) where.push({ label: t('comments already on the ticket'), counts: earlierCounts });

  if (where.length) {
    const detail = where.map((w) => t('{counts} in {where}', { counts: describeCounts(w.counts), where: w.label })).join(t('; '));
    return check('pii', 'warn', t('Possible personal data or secrets in the text'), t('Found: {detail}. Remove or rephrase before you save; resolution notes are reused and may be seen by the customer.', { detail }));
  }
  // "Nothing found" is only a fact about text that could be read.
  if (unreadable) {
    const checked = scanned
      ? t('No personal data or secrets were spotted in the text you can see, but the comments already on the ticket were not checked.')
      : t('The comments already on the ticket were not checked for personal data.');
    return check('pii', 'info', t('Could not read the notes and comments'), `${sentence(unreadable.note) || t('You may not be able to see them.')} ${checked}`);
  }
  // On a Workspace the boxes that were found were checked; a box that was not found may hold text that was not.
  const missedBox = source === 'boxes' && ['close_notes', 'comments'].some((name) => typeof form[name] !== 'string');
  const unsaved = !form ? t('Text you have typed and not saved on this page was not checked.') : missedBox ? t('Some boxes on this page could not be found, so text typed there and not saved was not checked.') : '';
  return check('pii', 'ok', scanned ? t('No personal data or secrets spotted in the text') : t('Nothing written yet to scan for personal data'), unsaved);
}

// ---- hold reason ---------------------------------------------------------------------------------------------------

function holdCheck(pack, form) {
  const reason = effective(pack, form, 'hold_reason').value;
  if (!text(reason)) return null;
  return check('hold', 'warn', t('A hold reason is still filled in'), t('Clear the hold reason (and move the ticket off "On hold") before you resolve it.'));
}

// ---- already finished -----------------------------------------------------------------------------------------------

function finishedCheck(pack) {
  const state = text(pack?.fields?.state);
  if (!isFinishedState({ table: pack?.table || pack?.kind, label: state })) return null;
  return check('state', 'info', t('This ticket is already {state}', { state: isolate(state.toLowerCase()) }), t('The checks below look at what is saved on it.'));
}

// The only fields a Workspace page gives (src/content/ops/checks.js BOX_FIELDS): the text boxes, never a choice.
const BOX_FIELDS = ['close_notes', 'work_notes', 'comments'];

/** The form values and where they came from: { form: object | null, source: 'form' | 'boxes' | '' }. */
function formOf(facts) {
  const given = facts?.form && typeof facts.form === 'object' && !Array.isArray(facts.form) ? facts.form : null;
  if (!given) return { form: null, source: '' };
  if (facts.formSource !== 'boxes') return { form: given, source: 'form' };
  // Boxes: anything but the notes is dropped, so the close code, the state and the hold reason are always the saved ones.
  const form = {};
  for (const name of BOX_FIELDS) if (typeof given[name] === 'string') form[name] = given[name];
  // (no box at all is no form: the saved ticket only)
  return Object.keys(form).length ? { form, source: 'boxes' } : { form: null, source: '' };
}

/**
 * The checks for one ticket.
 * @param {object} pack ContextPack (saved record: fields, people, journal, related, access)
 * @param {{ form?: object | null, formSource?: 'form' | 'boxes' | null, links?: { problem?: {status: string, note?: string}, knowledge?: {status: string, note?: string} } | null }} [facts]
 *   form: the unsaved values (close_notes, close_code, resolution_code, state, hold_reason, comments, work_notes) or null
 *   when the page has no form to read; formSource: 'boxes' when they are a Workspace page's notes boxes only (close_notes,
 *   work_notes, comments; any other field is ignored and the saved value used), else a form with g_form; links: from the
 *   resolutionFacts read operation.
 * @param {{ now?: number, waitDays?: number }} [options]
 * @returns {{ id: string, status: 'ok' | 'warn' | 'info', title: string, hint: string }[]}
 */
export function resolutionCheck(pack, facts = {}, { now = Date.now(), waitDays = DEFAULT_WAIT_DAYS } = {}) {
  const { form, source } = formOf(facts);
  const notes = effective(pack, form, 'close_notes').value;
  return [
    finishedCheck(pack),
    notesCheck(pack, form, source),
    codeCheck(pack, form, source),
    customerCheck(pack, now, waitDays),
    childCheck(pack),
    linkCheck(pack, facts?.links || null, notes),
    piiCheck(pack, form, source),
    holdCheck(pack, form),
  ].filter(Boolean);
}

const RANK = { warn: 0, info: 1, ok: 2 };

/** Warnings first, then notes, then what is fine; each group keeps its order. */
export const orderChecks = (checks) => checks.map((c, i) => ({ c, i })).sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || a.i - b.i).map((x) => x.c);

/** { warn, info, ok, headline, tone } for the line above the list. */
export function summarizeChecks(checks) {
  const count = (status) => checks.filter((c) => c.status === status).length;
  const warn = count('warn');
  const info = count('info');
  const ok = count('ok');
  if (warn) return { warn, info, ok, tone: 'warn', headline: tn(warn, '{n} thing to look at before you resolve this', '{n} things to look at before you resolve this') };
  if (info) return { warn, info, ok, tone: 'info', headline: t('Nothing is wrong, but there are a few notes') };
  return { warn, info, ok, tone: 'ok', headline: t('Nothing stands out. This looks ready to resolve') };
}


/**
 * Everything the Check tab draws: the ordered list, the summary line, whether unsaved values from the page were used, and from where.
 *   usedForm    true when anything typed on the page was read (a form with g_form, or a Workspace page's notes boxes)
 *   formSource  'form' (the form's fields) | 'boxes' (a Workspace: the notes only; the close code and the rest are the saved ones)
 *               | '' (nothing read: the saved ticket only)
 * @returns {{ checks: object[], summary: object, usedForm: boolean, formSource: 'form' | 'boxes' | '' }}
 */
export function buildCheckView(pack, facts, options) {
  const checks = resolutionCheck(pack, facts, options);
  const { source } = formOf(facts);
  return { checks: orderChecks(checks), summary: summarizeChecks(checks), usedForm: Boolean(source), formSource: source, kind: text(pack?.kind) };
}

// ---- The Close well row and "Prepare to close" (round 4, docs/round4.md) --------------------------------------------------

// What each check is about, in a few words, for the row's line ("Not yet: the caller has not confirmed"). A check without one is
// named by its title.
const SHORT = {
  notes: (kind) => (closeNotes(kind) ? t('the close notes need work') : t('the resolution notes need work')),
  code: () => t('no close code chosen'),
  customer: (kind) => confirmer(kind),
  children: () => t('work under it is still open'),
  pii: () => t('personal data in the text'),
  hold: () => t('a hold reason is filled in'),
};

/**
 * The first part of the "Close well" row's line, from a check view (buildCheckView): "Not yet: the caller has not confirmed" (and
 * "..., and 2 more" when more things need a look), "Nothing wrong, a few notes", "Looks ready"; '' while there is no view.
 */
export function readyLine(view) {
  if (!Array.isArray(view?.checks)) return '';
  const warns = view.checks.filter((c) => c.status === 'warn');
  if (warns.length) {
    const reason = SHORT[warns[0].id]?.(view.kind) || warns[0].title;
    return warns.length > 1 ? t('Not yet: {reason}, and {n} more', { reason, n: warns.length - 1 }) : t('Not yet: {reason}', { reason });
  }
  return view.checks.some((c) => c.status === 'info') ? t('Nothing wrong, a few notes') : t('Looks ready');
}

/** The findings still open (to look at first, then notes), in the view's order: the "Ready to resolve?" part of Prepare to close. */
export const openFindings = (view) => (Array.isArray(view?.checks) ? view.checks.filter((c) => c.status === 'warn' || c.status === 'info') : []);

/** The code field of a kind ('close_code', 'resolution_code'), or '' for a kind that has none. */
export const codeFieldOf = (kind) => CODE_FIELD[kind] || '';

/**
 * The ticket's close code as it is now: what is picked on the form (not saved yet; a classic form gives the stored value) or else the
 * saved one (a display value). '' when there is none, or the kind has no code. What closeCodeVote compares its suggestion with.
 */
export function currentCloseCode(pack, facts = {}) {
  const field = CODE_FIELD[pack?.kind];
  if (!field) return '';
  const { form } = formOf(facts);
  return text(effective(pack, form, field).value);
}

/**
 * The pack with the notes the agent has typed on the form (not yet saved) in place of the saved close notes, for "Improve my
 * resolution notes". The text still goes out only as a part of the pack, through the firewall. Returns a new pack.
 */
export function withCurrentNotes(pack, form) {
  const typed = typeof form?.close_notes === 'string' ? form.close_notes.trim() : '';
  if (!typed) return pack;
  return { ...pack, fields: { ...pack.fields, close_notes: clipText(typed, LIMITS.closeNotes) } };
}
