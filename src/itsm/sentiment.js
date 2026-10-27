// Signals about a customer's mood, counted locally with plain rules (word lists, capital letters, counts, order of
// messages). Pure: no browser, no network, no AI. The numbers are handed to the model as one labelled part, so its answer
// about mood and escalation risk is grounded in things anyone can check, not only in its own reading of the thread.
//
// Honest limits, stated where the person reads them (see signalsText): these are word and count rules. They miss sarcasm,
// other languages and polite anger, and a word list over-counts ("manager" can be a neutral mention). They are evidence for
// the model and the agent, never a verdict.
//
// Nothing here quotes ticket text. The output holds counts and labels from our own word lists only, so the signals part
// cannot carry a name or number of its own.

import { parseSnTime } from '../context/util.js';

// ---- Word lists ---------------------------------------------------------------------------------------
// [label, pattern]: the label is what the signals part says; the pattern is matched case-insensitively, whole words only.

const FRUSTRATION = [
  ['frustrated', /\bfrustrat(?:ed|ing|ion)\b/i],
  ['annoyed', /\bannoy(?:ed|ing|s)\b/i],
  ['ridiculous', /\bridiculous(?:ly)?\b/i],
  ['unacceptable', /\bunacceptable\b/i],
  ['terrible', /\b(?:terrible|terribly|awful|horrible|horrendous|appalling|atrocious|dreadful)\b/i],
  ['useless', /\b(?:useless|pointless|incompetent|pathetic|rubbish|hopeless)\b/i],
  ['fed up', /\b(?:fed up|sick of|tired of|had enough|sick and tired)\b/i],
  ['angry', /\b(?:angry|furious|livid|outraged|outrageous|infuriating|disgusted|disgusting)\b/i],
  ['disappointed', /\b(?:disappoint(?:ed|ing|ment)|dissatisfied|unhappy|not happy|upset)\b/i],
  ['worst', /\bworst\b/i],
  ['waste of time', /\bwaste of (?:my |our )?(?:time|money)\b/i],
  ['shocking', /\bshocking\b/i],
  ['poor service', /\b(?:poor|bad|lousy) (?:service|support|experience)\b/i],
  ['nonsense', /\b(?:nonsense|farce|shambles)\b/i],
];

// Words that bring in someone with authority, or talk about leaving. A neutral "my manager approved it" counts too.
const ESCALATION = [
  ['escalate', /\bescalat(?:e|ed|es|ing|ion)\b/i],
  ['manager or executive', /\b(?:manager|supervisor|director|vp|ceo|cio|cto|executive|senior management|higher up|higher-ups)\b/i],
  ['complaint', /\bcomplain(?:t|ts|ing|ed)?\b/i],
  ['legal', /\b(?:legal|lawyer|solicitor|lawsuit|regulator|ombudsman|sue you|sue us)\b/i],
  ['cancel', /\bcancel(?:l?ing|l?ed)?\b.{0,20}\b(?:contract|subscription|account|service|licen[cs]e)\b/i],
  ['refund', /\b(?:refund|compensation)\b/i],
];

const URGENCY = [
  ['urgent', /\burgent(?:ly)?\b/i],
  ['asap', /\basap\b|\bas soon as possible\b/i],
  ['immediately', /\bimmediate(?:ly)?\b/i],
  ['critical', /\bcritical\b/i],
  ['emergency', /\bemergency\b/i],
  ['deadline', /\bdeadline\b/i],
  ['right now', /\bright now\b/i],
  ['cannot work', /\b(?:cannot|can't|cant|unable to) (?:work|do my job|log ?in|access)\b/i],
  ['production down', /\bproduction (?:is )?down\b/i],
  ['blocked', /\b(?:blocked|blocking)\b/i],
];

// "again", "still" and friends: the problem came back or was not fixed.
const REPEAT = [
  ['again', /\bagain\b/i],
  ['still', /\bstill\b/i],
  ['nth time', /\b(?:second|third|fourth|fifth|sixth|2nd|3rd|[4-9]th|\d{2,}th|umpteenth|nth) time\b/i],
  ['every time', /\bevery (?:single )?time\b/i],
  ['once more', /\b(?:yet again|once more|over and over)\b/i],
  ['already told', /\balready (?:told|said|sent|explained|provided|tried|mentioned|asked|reported)\b/i],
  ['same problem', /\b(?:same|recurring|repeated|repeat) (?:issue|problem|error|fault)\b/i],
  ['many times', /\b(?:twice|several times|multiple times|many times|how many times|three times|four times)\b/i],
];

// A message that asks where things are. (A second message with no reply in between counts as a chaser too.)
const CHASE = [
  /\b(?:any|an) updates?\b/i,
  /\bupdate (?:please|pls|on this)\b/i,
  /\bfollow(?:ing)?[- ]?up\b/i,
  /\bchas(?:e|ing|ed)\b/i,
  /\breminder\b/i,
  /\bstill waiting\b/i,
  /\bwaiting (?:for|on) (?:a |an |your |any |some )?(?:reply|response|update|answer|call|callback|news)\b/i,
  /\b(?:haven't|have not|hasn't|has not|not yet) (?:heard|had|received)\b/i,
  /\b(?:heard nothing|no news)\b/i,
  /\b(?:no|nobody|no one) (?:has )?(?:reply|replied|response|responded|update|answer)\b/i,
  /\bany (?:news|progress|luck)\b/i,
  /\bhello\?+/i,
];

const THANKS = /\b(?:thanks|thank you|thx|appreciat(?:e|ed|es|ion)|cheers|grateful)\b/gi;

// Capital words that are normal in IT writing: not shouting.
const ACRONYMS = new Set(
  (
    'VPN SAP LDAP DNS DHCP HTTP HTTPS HTML SSL TLS MFA SSO SMS SMTP IMAP POP SQL WIFI WLAN LAN WAN OTP CSV PDF USB HDMI API JSON XML RDP ' +
    'CPU GPU RAM SSD HDD BIOS URL FAQ ASAP FYI ETA SLA KPI CEO CIO CTO CFO COO INC REQ RITM CHG PRB KB UTC GMT EST PST CET AWS GCP VDI ERP ' +
    'CRM HRIS SIM APN PIN IOS MAC PC TV OK'
  ).split(' ')
);

// ---- Text analysis ------------------------------------------------------------------------------------

// Curly apostrophes (U+2018, U+2019, U+02BC) become plain ones so "can't" matches. Written as numbers: this file stays plain ASCII.
const CURLY_APOSTROPHES = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x2bc)}]`, 'g');
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const plainQuotes = (text) => String(text ?? '').replace(CURLY_APOSTROPHES, "'");
const labelsFound = (list, text) => list.filter(([, re]) => re.test(text)).map(([label]) => label);

/**
 * What one piece of text shows. Labels come from the word lists above, never from the text itself.
 * @returns {{ frustration: string[], escalation: string[], urgency: string[], repeat: string[], chase: boolean,
 *   shoutedWords: number, shouting: boolean, exclamationRuns: number, thanks: number }}
 */
export function analyseText(text) {
  const t = plainQuotes(text);
  const shouted = (t.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !ACRONYMS.has(w));
  // A message shouts when two words are in capitals, or one long word (URGENT) is.
  const shouting = shouted.length >= 2 || shouted.some((w) => w.length >= 6);
  const runs = (t.match(/[!?]{2,}/g) || []).filter((r) => r.includes('!') || r.length >= 3);
  return {
    frustration: labelsFound(FRUSTRATION, t),
    escalation: labelsFound(ESCALATION, t),
    urgency: labelsFound(URGENCY, t),
    repeat: labelsFound(REPEAT, t),
    chase: CHASE.some((re) => re.test(t)),
    shoutedWords: shouted.length,
    shouting,
    exclamationRuns: runs.length,
    thanks: (t.match(THANKS) || []).length,
  };
}

// ---- Who is the customer? -----------------------------------------------------------------------------

// The people on the record who raised it or asked for it. (opened_by is not used: an agent often opens a ticket for someone.)
const CUSTOMER_ROLES = new Set(['caller', 'requested_for', 'contact', 'consumer']);

// Names with accents, logins such as abel.tuter, and "Abel Tuter" all become lower-case words separated by single spaces, so a note author written
// as a login still matches the person's name or the front of their email address.
const fold = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function identityKeys(person) {
  const email = String(person?.email || '');
  const keys = [person?.name, email, email.split('@')[0], `${person?.firstName || ''} ${person?.lastName || ''}`].map(fold).filter(Boolean);
  return new Set(keys);
}

/** The customer(s) and the assignee of a pack, as sets of folded names. */
export function identities(pack) {
  const people = Array.isArray(pack?.people) ? pack.people : [];
  const customers = new Set();
  const support = new Set();
  for (const p of people) {
    if (!p || typeof p !== 'object') continue;
    if (CUSTOMER_ROLES.has(p.role)) identityKeys(p).forEach((k) => customers.add(k));
    else if (p.role === 'assigned_to') identityKeys(p).forEach((k) => support.add(k));
  }
  return { customers, support, known: customers.size > 0 };
}

/**
 * Who wrote a journal entry: 'customer', 'support' (a customer is known and it is someone else), 'unknown' (no customer
 * could be identified, or the entry has no author, so its role cannot be told), or 'note' for an internal work note.
 */
export function roleOfEntry(entry, ids) {
  if (!entry || entry.type !== 'comment') return 'note';
  const by = fold(entry.by);
  if (!ids.known || !by) return 'unknown';
  return ids.customers.has(by) ? 'customer' : 'support';
}

// ---- Time ---------------------------------------------------------------------------------------------

const HOUR = 3600000;

/** "about 5 hours", "about 3 days", "less than an hour". Never more precise than the time zone allows. */
export function approxAge(hours) {
  if (!Number.isFinite(hours)) return '';
  const h = Math.max(0, hours);
  if (h < 1) return 'less than an hour';
  if (h < 48) {
    const n = Math.round(h);
    return `about ${n} hour${n === 1 ? '' : 's'}`;
  }
  return `about ${Math.round(h / 24)} days`;
}

// ---- The signals --------------------------------------------------------------------------------------

const countOf = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const union = (lists) => [...new Set(lists.flat())];

/**
 * Count the signals in a pack. Only the newest `depth` notes are looked at: the same ones the model is shown.
 * @param {object} pack ContextPack
 * @param {{ now?: number, depth?: number }} [options] now: milliseconds (tests pass it); depth: how many notes
 */
export function computeSignals(pack, { now = Date.now(), depth = 20 } = {}) {
  const fields = pack?.fields || {};
  const journal = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e && String(e.text ?? '').trim()).slice(-Math.max(1, depth));
  const ids = identities(pack);
  const comments = journal.filter((e) => e.type === 'comment').map((e) => ({ e, role: roleOfEntry(e, ids), at: parseSnTime(e.when), found: analyseText(e.text) }));

  // Messages that count as "the customer's": theirs when we know who they are, every customer-visible comment when we do not.
  const theirs = ids.known ? comments.filter((c) => c.role === 'customer') : comments;
  const replies = ids.known ? comments.filter((c) => c.role === 'support') : [];

  // A chaser: a customer message that asks where things are, or that follows another customer message nobody answered.
  // When the customer is not known, "follows another message" would count support replies too, so only the wording counts.
  let run = 0;
  let chasers = 0;
  for (const c of comments) {
    if (!ids.known) {
      if (c.found.chase) chasers += 1;
      continue;
    }
    if (c.role === 'unknown') continue; // an entry with no author is neither a reply nor a chaser
    if (c.role !== 'customer') {
      run = 0;
      continue;
    }
    if (run >= 1 || c.found.chase) chasers += 1;
    run += 1;
  }
  const last = comments[comments.length - 1];
  const awaitingReply = ids.known && last ? last.role === 'customer' : false;

  const hoursSince = (at) => (Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, (now - at) / HOUR) : null);
  const newest = (list) => list.reduce((best, c) => (Number.isFinite(c.at) && (best === null || c.at > best) ? c.at : best), null);
  const lastCustomerAt = newest(theirs);
  const lastSupportAt = newest(replies);

  const opening = analyseText(`${fields.short_description || ''}\n${fields.description || ''}`);
  const slas = Array.isArray(pack?.related?.slas) ? pack.related.slas : null;

  return {
    customerKnown: ids.known,
    commentsRead: comments.length,
    customerMessages: theirs.length,
    supportReplies: replies.length,
    chasers,
    unansweredCustomerMessages: ids.known ? run : null,
    awaitingReply,
    hoursSinceCustomerMessage: hoursSince(lastCustomerAt),
    hoursSinceSupportReply: hoursSince(lastSupportAt),
    frustrationWords: union(theirs.map((c) => c.found.frustration)),
    escalationWords: union(theirs.map((c) => c.found.escalation)),
    urgencyWords: union(theirs.map((c) => c.found.urgency)),
    repeatPhrases: union(theirs.map((c) => c.found.repeat)),
    repeatMessages: theirs.filter((c) => c.found.repeat.length).length,
    shoutingMessages: theirs.filter((c) => c.found.shouting).length,
    shoutedWords: theirs.reduce((sum, c) => sum + c.found.shoutedWords, 0),
    exclamationRuns: theirs.reduce((sum, c) => sum + c.found.exclamationRuns, 0),
    thanks: theirs.reduce((sum, c) => sum + c.found.thanks, 0),
    opening: {
      frustrationWords: opening.frustration,
      escalationWords: opening.escalation,
      urgencyWords: opening.urgency,
      repeatPhrases: opening.repeat,
      shouting: opening.shouting,
      exclamationRuns: opening.exclamationRuns,
    },
    reopenCount: countOf(fields.reopen_count),
    reassignmentCount: countOf(fields.reassignment_count),
    priority: String(fields.priority || '').trim(),
    state: String(fields.state || '').trim(),
    slas: slas ? { total: slas.length, breached: slas.filter((s) => s && s.breached === 'true').length } : null,
  };
}

// ---- The part the model reads ----------------------------------------------------------------------------

const list = (words) => (words.length ? words.join(', ') : 'none');
const times = (n) => (n === 1 ? '1 time' : `${n} times`);

/** The signals as short labelled lines. Counts and our own labels only. */
export function signalsText(s) {
  const lines = ['Counted by simple word and count rules, not a judgement. They can miss sarcasm and other languages.'];
  if (!s.commentsRead) {
    lines.push('Customer-visible comments read: 0 (nothing has been written to the customer yet, or the comments could not be read).');
  } else if (s.customerKnown) {
    lines.push(`Customer-visible comments read: ${s.commentsRead} (customer ${s.customerMessages}, support ${s.supportReplies}).`);
  } else {
    lines.push(`Customer-visible comments read: ${s.commentsRead}. The customer could not be identified, so all of them are counted together and the counts below may include support staff.`);
  }
  if (s.customerKnown) {
    lines.push(`Customer chasers (asking for news, or writing again with no reply in between): ${s.chasers}.`);
    lines.push(`Customer messages in a row with no reply from support: ${s.unansweredCustomerMessages}.`);
    lines.push(`The newest customer-visible comment is from the customer (waiting for an answer): ${s.awaitingReply ? 'yes' : 'no'}.`);
  } else {
    lines.push(`Messages that ask where things are, or repeat an earlier message: ${s.chasers}.`);
  }
  const since = approxAge(s.hoursSinceCustomerMessage);
  const sinceWhat = s.customerKnown ? "the customer's last message" : 'the newest customer-visible comment';
  lines.push(`Time since ${sinceWhat}: ${since ? `${since} (approximate: the time zone of the notes is not known)` : 'not known'}.`);
  const sinceSupport = approxAge(s.hoursSinceSupportReply);
  if (s.customerKnown) lines.push(`Time since the last reply from support: ${sinceSupport ? `${sinceSupport} (approximate)` : 'no reply, or not known'}.`);
  lines.push(`Frustration words in the customer's messages: ${list(s.frustrationWords)}.`);
  lines.push(`Escalation words (manager, complaint, cancel, legal...): ${list(s.escalationWords)}.`);
  lines.push(`Urgency words: ${list(s.urgencyWords)}.`);
  lines.push(`Repeat phrases ("again", "still", "third time"...): ${list(s.repeatPhrases)}, in ${s.repeatMessages} message${s.repeatMessages === 1 ? '' : 's'}.`);
  lines.push(`Shouting (words in capital letters): ${s.shoutingMessages} message${s.shoutingMessages === 1 ? '' : 's'}, ${s.shoutedWords} capitalised word${s.shoutedWords === 1 ? '' : 's'}.`);
  lines.push(`Runs of exclamation or question marks: ${s.exclamationRuns}.`);
  lines.push(`Thank-you words: ${s.thanks}.`);

  const o = s.opening;
  const openingBits = [];
  if (o.frustrationWords.length) openingBits.push(`frustration words: ${o.frustrationWords.join(', ')}`);
  if (o.escalationWords.length) openingBits.push(`escalation words: ${o.escalationWords.join(', ')}`);
  if (o.urgencyWords.length) openingBits.push(`urgency words: ${o.urgencyWords.join(', ')}`);
  if (o.repeatPhrases.length) openingBits.push(`repeat phrases: ${o.repeatPhrases.join(', ')}`);
  if (o.shouting) openingBits.push('capital letters');
  if (o.exclamationRuns) openingBits.push(`${o.exclamationRuns} run${o.exclamationRuns === 1 ? '' : 's'} of exclamation marks`);
  lines.push(`In the short description and description: ${openingBits.length ? openingBits.join('; ') : 'nothing notable'}.`);

  lines.push(`Reopened: ${s.reopenCount === null ? 'not stated' : times(s.reopenCount)}.`);
  lines.push(`Reassigned between groups or people: ${s.reassignmentCount === null ? 'not stated' : times(s.reassignmentCount)}.`);
  lines.push(`Priority: ${s.priority || 'not stated'}.`);
  lines.push(`State: ${s.state || 'not stated'}.`);
  if (s.slas) lines.push(`SLAs: ${s.slas.breached} breached of ${s.slas.total}.`);
  return lines.join('\n');
}
