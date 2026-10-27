// C2, "Check before you resolve": a short list of things worth a second look before a ticket is resolved or closed.
// It ADVISES and never blocks: nothing here stops the agent, changes the record or asks for anything.
//
// Inputs are the saved record (a ContextPack, kind incident / problem / request / requested item / catalog task / case /
// task) and the form's CURRENT, unsaved values for a fixed set of fields when the page has a form we can read. Where the
// form cannot be read (portals, Workspaces) the saved record is checked and the caller says so.
//
// Personal data and secrets are reported by KIND and COUNT only ("1 email address"). The value itself is never copied into
// a result, so the list is safe to show, log or screenshot.
//
// A check is { id, status: 'ok' | 'warn' | 'info', title, hint }. Pure: no I/O, the clock comes in as `now`.

import { checkOutgoing } from '../safeSend/index.js';
import { LIMITS } from '../context/allowlists.js';
import { clipText } from '../context/util.js';
import { daysSince, isFinishedState, isOpenItem } from './states.js';

const text = (v) => String(v ?? '').trim();

/** How many days of silence after the agent's last message is "enough waiting". */
export const DEFAULT_WAIT_DAYS = 3;
/** Fewer characters than this (or fewer words) is too little to help the next person. */
export const MIN_NOTE_CHARS = 40;
export const MIN_NOTE_WORDS = 6;

// The code field a kind uses (other kinds have none: a request item is simply closed).
const CODE_FIELD = { incident: 'close_code', problem: 'resolution_code', case: 'resolution_code' };
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
// Roles of people who are the customer (not the agents who answer them).
const CUSTOMER_ROLES = new Set(['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'subject_person']);

const KIND_LABEL = {
  EMAIL: 'email address',
  PHONE: 'phone number',
  CARD: 'card number',
  IBAN: 'bank account number',
  NATIONAL_ID: 'ID number',
  IP: 'IP address',
  MAC: 'device address',
  DOB: 'date of birth',
  ADDRESS: 'postal address',
  EMPLOYEE_ID: 'employee id',
  SECRET: 'password or key',
  URL_CREDENTIALS: 'link with a password in it',
  OTHER_PERSON: "other person's name",
  INTERNAL_PHRASE: 'wording meant to stay internal',
};
// What counts in earlier comments that are already on the ticket: only the serious ones.
const SERIOUS = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const check = (id, status, title, hint = '') => ({ id, status, title, hint });
const fold = (s) => text(s).toLowerCase().replace(/\s+/g, ' ');

// ---- the effective value of a field: the form if it has it, else the saved record -----------------------------------

function effective(pack, form, name) {
  if (form && typeof form[name] === 'string') return { value: form[name], fromForm: true };
  return { value: text(pack?.fields?.[name]), fromForm: false };
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

function notesCheck(pack, form) {
  const { value } = effective(pack, form, 'close_notes');
  const body = text(value);
  if (!body) return check('notes', 'warn', 'No resolution notes yet', 'Say what the cause was and what fixed it. These notes are what the next person finds when the same thing happens again.');
  if (isFillerNote(body)) return check('notes', 'warn', 'The notes only say "resolved"', 'Add what was wrong and what you did, in a sentence or two. "Resolved" does not help anyone later.');
  const words = body.split(/\s+/).filter(Boolean).length;
  if (body.length < MIN_NOTE_CHARS || words < MIN_NOTE_WORDS) {
    return check('notes', 'warn', 'The resolution notes are very short', 'A sentence on the cause and one on the fix makes them far more useful to the next person.');
  }
  return check('notes', 'ok', 'Resolution notes are filled in');
}

// ---- close code ----------------------------------------------------------------------------------------------------

function codeCheck(pack, form) {
  const field = CODE_FIELD[pack?.kind];
  if (!field) return null;
  const { value } = effective(pack, form, field);
  if (!text(value)) return check('code', 'warn', 'No close code chosen', 'Pick the code that best describes the fix. Reports and trends use it.');
  return check('code', 'ok', 'A close code is chosen');
}

// ---- did the customer answer? -------------------------------------------------------------------------------------

function customerNames(pack) {
  return new Set((pack?.people || []).filter((p) => CUSTOMER_ROLES.has(p.role) && text(p.name)).map((p) => fold(p.name)));
}

function customerCheck(pack, now, waitDays) {
  const visible = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e?.type === 'comment' && text(e.text));
  if (!visible.length) {
    return check('customer', 'info', 'No messages to or from the customer on this ticket', 'If you confirmed the fix by phone or in person, say so in the resolution notes.');
  }
  const customers = customerNames(pack);
  if (!customers.size) {
    return check('customer', 'info', 'Could not tell which messages are the customer\'s', 'Check by eye that the customer confirmed the fix or had a chance to answer.');
  }
  const last = visible[visible.length - 1];
  if (customers.has(fold(last.by))) {
    return check('customer', 'ok', 'The customer wrote the last message', 'Read it once more and make sure it confirms the fix.');
  }
  const days = daysSince(last.when, now);
  if (Number.isFinite(days) && days >= waitDays) {
    return check('customer', 'ok', `No reply for ${Math.floor(days)} days since your last message`, 'That is a fair wait. Mention in the notes that you asked and heard nothing.');
  }
  if (Number.isFinite(days)) {
    const age = days < 1 ? 'today' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;
    return check('customer', 'warn', `The customer has not replied to your last message (${age})`, `Wait for an answer (about ${waitDays} days is usual) or confirm the fix another way before you resolve.`);
  }
  return check('customer', 'warn', 'The last message on the ticket is from an agent and there is no reply yet', 'Wait for an answer or confirm the fix another way before you resolve.');
}

// ---- open work under this ticket -----------------------------------------------------------------------------------

function childCheck(pack) {
  const spec = CHILD_LIST[pack?.kind];
  if (!spec) return null;
  const [key, noun] = spec;
  const list = pack?.related?.[key];
  if (!Array.isArray(list)) {
    const entry = (pack?.access || []).find((e) => e?.source === { childTasks: 'task', catalogTasks: 'sc_task', items: 'sc_req_item' }[key]);
    const why = entry?.status === 'denied' ? `You cannot read ${noun}s on this instance.` : entry?.status ? `The ${noun}s could not be read.` : '';
    return check('children', 'info', `Could not check for open ${noun}s`, why || 'Look at the related list on the form.');
  }
  const open = list.filter(isOpenItem);
  if (!open.length) return check('children', 'ok', list.length ? `All ${plural(list.length, noun)} closed` : `No ${noun}s under this ticket`);
  const named = open.slice(0, 4).map((t) => [text(t.number), text(t.state) && `(${text(t.state)})`].filter(Boolean).join(' ')).filter(Boolean);
  const more = open.length > named.length ? ` and ${open.length - named.length} more` : '';
  return check('children', 'warn', `${plural(open.length, noun)} still open`, `Close or hand over ${named.join(', ')}${more} first, or leave a note saying why they stay open.`);
}

// ---- linked problem or knowledge ----------------------------------------------------------------------------------

const KB_MENTION = /\bKB\d{4,}\b/i;

function linkCheck(pack, links, notes) {
  if (!LINK_KINDS.has(pack?.kind)) return null;
  const problem = links?.problem?.status || '';
  const mentioned = KB_MENTION.test(notes);
  const knowledge = mentioned ? 'yes' : links?.knowledge?.status || '';
  const found = [];
  if (problem === 'yes') found.push('a problem');
  if (knowledge === 'yes') found.push(mentioned && links?.knowledge?.status !== 'yes' ? 'an article (named in the notes)' : 'an article');
  if (found.length) return check('links', 'ok', `Linked to ${found.join(' and ')}`);
  if (!links) return check('links', 'info', 'Could not check for a linked problem or article', 'Look at the related lists on the form.');
  const unsure = [problem, knowledge].includes('unknown') || !knowledge;
  const what = pack?.kind === 'incident' ? 'problem or article' : 'article';
  if (unsure) {
    return check('links', 'info', `Could not fully check for a linked ${what}`, `${[links?.problem?.note, links?.knowledge?.note].filter(Boolean).join(' ')} Look at the related lists on the form.`.trim());
  }
  return check('links', 'info', `No ${what} is linked`, 'If this is likely to happen again, link a problem or attach an article (or write one) so the fix is easy to find.');
}

// ---- personal data and secrets -----------------------------------------------------------------------------------

function tally(counts, findings, keep) {
  for (const f of findings) if (keep(f)) counts.set(f.kind, (counts.get(f.kind) || 0) + 1);
}

function describeCounts(counts) {
  return [...counts.entries()].map(([kind, n]) => plural(n, KIND_LABEL[kind] || 'item')).join(', ');
}

function piiCheck(pack, form) {
  const people = pack?.people || [];
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
  scan('the resolution notes', effective(pack, form, 'close_notes').value, notable);
  if (form) scan('the comment you have not sent yet', form.comments, notable);
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
  if (earlierCounts.size) where.push({ label: 'comments already on the ticket', counts: earlierCounts });

  if (where.length) {
    const detail = where.map((w) => `${describeCounts(w.counts)} in ${w.label}`).join('; ');
    return check('pii', 'warn', 'Possible personal data or secrets in the text', `Found: ${detail}. Remove or rephrase before you save; resolution notes are reused and may be seen by the customer.`);
  }
  return check('pii', 'ok', scanned ? 'No personal data or secrets spotted in the text' : 'Nothing written yet to scan for personal data');
}

// ---- hold reason ---------------------------------------------------------------------------------------------------

function holdCheck(pack, form) {
  const reason = effective(pack, form, 'hold_reason').value;
  if (!text(reason)) return null;
  return check('hold', 'warn', 'A hold reason is still filled in', 'Clear the hold reason (and move the ticket off "On hold") before you resolve it.');
}

// ---- already finished -----------------------------------------------------------------------------------------------

function finishedCheck(pack) {
  const state = text(pack?.fields?.state);
  if (!isFinishedState(state)) return null;
  return check('state', 'info', `This ticket is already ${state.toLowerCase()}`, 'The checks below look at what is saved on it.');
}

/**
 * The checks for one ticket.
 * @param {object} pack ContextPack (saved record: fields, people, journal, related, access)
 * @param {{ form?: object | null, links?: { problem?: {status: string, note?: string}, knowledge?: {status: string, note?: string} } | null }} [facts]
 *   form: the unsaved values (close_notes, close_code, resolution_code, state, hold_reason, comments, work_notes) or null
 *   when the page has no form to read; links: from the resolutionFacts read operation.
 * @param {{ now?: number, waitDays?: number }} [options]
 * @returns {{ id: string, status: 'ok' | 'warn' | 'info', title: string, hint: string }[]}
 */
export function resolutionCheck(pack, facts = {}, { now = Date.now(), waitDays = DEFAULT_WAIT_DAYS } = {}) {
  const form = facts?.form && typeof facts.form === 'object' ? facts.form : null;
  const notes = effective(pack, form, 'close_notes').value;
  return [
    finishedCheck(pack),
    notesCheck(pack, form),
    codeCheck(pack, form),
    customerCheck(pack, now, waitDays),
    childCheck(pack),
    linkCheck(pack, facts?.links || null, notes),
    piiCheck(pack, form),
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
  if (warn) return { warn, info, ok, tone: 'warn', headline: `${plural(warn, 'thing')} to look at before you resolve this` };
  if (info) return { warn, info, ok, tone: 'info', headline: 'Nothing is wrong, but there are a few notes' };
  return { warn, info, ok, tone: 'ok', headline: 'Nothing stands out. This looks ready to resolve' };
}


/**
 * Everything the Check tab draws: the ordered list, the summary line, and whether the form's unsaved values were used.
 * @returns {{ checks: object[], summary: object, usedForm: boolean }}
 */
export function buildCheckView(pack, facts, options) {
  const checks = resolutionCheck(pack, facts, options);
  return { checks: orderChecks(checks), summary: summarizeChecks(checks), usedForm: Boolean(facts?.form && typeof facts.form === 'object') };
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
