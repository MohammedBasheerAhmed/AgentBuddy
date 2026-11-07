// "Safe to send" check for text a fulfiller is about to make visible to a customer (a comment, an email).
//
// It reuses the firewall's detectors, so it finds the same PII and secrets, and adds two things that only make sense for
// outgoing messages: hints about OTHER people's data (an email address that is not one of the record's people, a name
// introduced as "your colleague John Smith") and internal-only wording ("work note", "root password").
//
// Findings are for showing in the UI, so they never carry the value itself: only a masked excerpt and advice. This is a
// reviewer's aid, not a guarantee: a missing finding does not prove the text is safe, and name hints are cue-based
// guesses (see the OTHER_PERSON kind).

import { detect } from '../pii/detectors.js';
import { createDictionary, fold } from '../pii/dictionary.js';
import { tm, t as tr } from '../i18n/index.js';

/** Phrases that suggest the text was meant to stay internal. Replace them with options.internalPhrases. */
export const DEFAULT_INTERNAL_PHRASES = Object.freeze([
  'internal only',
  'do not share',
  'work note',
  'workaround for admins',
  'escalated to',
  'root password',
  'vpn token',
]);

// Default phrases that are more serious (or less) than the "medium" everything else gets.
const PHRASE_SEVERITY = { 'root password': 'high', 'vpn token': 'high', 'escalated to': 'low' };

const KIND_SEVERITY = {
  SECRET: 'high',
  URL_CREDENTIALS: 'high',
  CARD: 'high',
  IBAN: 'high',
  NATIONAL_ID: 'high',
  DOB: 'medium',
  ADDRESS: 'medium',
  EMPLOYEE_ID: 'medium',
  PHONE: 'medium',
  EMAIL: 'medium',
  IP: 'low',
  MAC: 'low',
};

// (English texts marked with tm(); each finding carries its advice through tr(), in the language of the panel)
const ADVICE = {
  SECRET: tm('This looks like a password or a secret key. Never put credentials in a customer-visible message; share them through the approved secure channel.'),
  URL_CREDENTIALS: tm('This link contains a username and password. Remove the credentials before sending.'),
  CARD: tm('This looks like a payment card number. Do not send card numbers; ask the customer to use the secure payment route.'),
  IBAN: tm('This looks like a bank account number. Check it belongs to the customer you are writing to and that it must be shared.'),
  NATIONAL_ID: tm('This looks like a national identity number. Remove it unless the customer asked for exactly this.'),
  DOB: tm('This looks like a date of birth. Share it only with the person it belongs to.'),
  ADDRESS: tm('This looks like a postal address. Check it is the customer\'s own.'),
  EMPLOYEE_ID: tm('This looks like an employee or staff id. Check it is the customer\'s own.'),
  PHONE: tm('This looks like a phone number. Check it is the customer\'s own or a published support number.'),
  EMAIL: tm('This email address is not one of the people on this ticket. Check you may share it with this customer.'),
  IP: tm('This looks like an IP address. Internal addresses are rarely useful to a customer.'),
  MAC: tm('This looks like a device (MAC) address. Check it is the customer\'s own device.'),
  OTHER_PERSON: tm('This looks like the name of someone who is not on this ticket. Check you may mention them to this customer.'),
  INTERNAL_PHRASE: tm('This wording suggests the text was meant to stay internal. Move it to a work note or rephrase it for the customer.'),
};

/** Hide a value but keep enough to recognise it: "abel.tuter@x.com" -> "ab****@x.com". Never returns the whole value. */
export function maskExcerpt(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const maskWord = (w) => {
    const chars = [...w];
    const keep = chars.length >= 6 ? 2 : chars.length >= 4 ? 1 : 0; // a short value shows less, and the length is never shown
    return `${chars.slice(0, keep).join('')}****`;
  };
  const at = s.indexOf('@');
  if (at > 0 && s.indexOf('.', at) > at && !s.includes(' ')) return `${maskWord(s.slice(0, at))}${s.slice(at)}`;
  const words = s.split(' ');
  const shown = words.slice(0, 3).map(maskWord).join(' ');
  return words.length > 3 ? `${shown} ...` : shown;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function phraseRule(entry) {
  const phrase = String(typeof entry === 'string' ? entry : entry?.phrase ?? '').trim().slice(0, 80);
  if (!phrase) return null;
  const words = phrase.split(/\s+/).map(escapeRegex);
  return {
    phrase,
    severity: (typeof entry === 'object' && entry.severity) || PHRASE_SEVERITY[phrase.toLowerCase()] || 'medium',
    re: new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu'),
  };
}

// "your colleague John Smith": a cue word followed by two or three capitalised words. Cue-based on purpose: free-form
// names cannot be found by pattern, and guessing at every capitalised pair would flag half the message.
const NAME_CUE = /(?<![\p{L}])(?:colleague|coworker|co-worker|manager|supervisor|employee|user|customer|client|requester|requestor|reported by|raised by|opened by|escalated by|approved by|on behalf of|belongs to|owned by|assigned to|ticket (?:of|for|from)|also affects|same issue as)[ \t]+(\p{Lu}[\p{Ll}'-]{1,24}(?:[ \t]+\p{Lu}[\p{Ll}'-]{1,24}){1,2})/gud;
// Capitalised words that name a team or a thing, not a person ("escalated to Service Desk").
const NOT_NAMES = new Set(['service', 'desk', 'team', 'support', 'department', 'group', 'center', 'centre', 'office', 'helpdesk', 'management', 'operations', 'security', 'network', 'desktop', 'infrastructure', 'engineering', 'finance', 'vendor', 'supplier', 'application', 'applications', 'database', 'platform', 'level', 'tier', 'queue', 'owner', 'administrator', 'administrators']);

/**
 * Check text that is about to be shown to a customer.
 * @param {string} text
 * @param {{people?: {name?: string, email?: string, sysId?: string}[], regions?: string[], internalPhrases?: (string | {phrase: string, severity?: string})[]}} [options]
 * @returns {{ok: boolean, findings: {kind: string, severity: 'high'|'medium'|'low', start: number, end: number, excerpt: string, advice: string}[], summary: {high: number, medium: number, low: number}}}
 *   ok is true only when nothing was found at all; low-severity findings still need a glance.
 */
export function checkOutgoing(text, options = {}) {
  const findings = [];
  if (typeof text !== 'string' || !text) return { ok: true, findings, summary: { high: 0, medium: 0, low: 0 } };

  const people = Array.isArray(options.people) ? options.people : [];
  const knownEmails = new Set(people.map((p) => String(p?.email ?? '').trim().toLowerCase()).filter(Boolean));
  const known = createDictionary(people).find(text, { unconditionalOnly: true }).filter((k) => k.kind === 'PERSON');

  // 1. PII and secrets, the same detectors the firewall uses.
  for (const f of detect(text, { regions: options.regions })) {
    if (f.kind === 'EMAIL' && knownEmails.has(f.value.toLowerCase())) continue; // writing to or about the record's own people
    findings.push({
      kind: f.kind,
      severity: KIND_SEVERITY[f.kind] || 'medium',
      start: f.start,
      end: f.end,
      excerpt: maskExcerpt(f.value),
      advice: tr(ADVICE[f.kind] || ADVICE.SECRET),
    });
  }

  // 2. Someone else's name, introduced by a cue word, who is not one of the record's people.
  NAME_CUE.lastIndex = 0;
  let m;
  while ((m = NAME_CUE.exec(text)) !== null) {
    const [start, end] = m.indices[1];
    const words = m[1].split(/\s+/);
    if (words.some((w) => NOT_NAMES.has(fold(w)))) continue;
    if (known.some((k) => k.start < end && start < k.end)) continue;
    findings.push({ kind: 'OTHER_PERSON', severity: 'low', start, end, excerpt: maskExcerpt(m[1]), advice: tr(ADVICE.OTHER_PERSON) });
  }

  // 3. Internal-only wording.
  const phrases = (Array.isArray(options.internalPhrases) ? options.internalPhrases : DEFAULT_INTERNAL_PHRASES).map(phraseRule).filter(Boolean);
  for (const rule of phrases) {
    rule.re.lastIndex = 0;
    while ((m = rule.re.exec(text)) !== null) {
      findings.push({ kind: 'INTERNAL_PHRASE', severity: rule.severity, start: m.index, end: m.index + m[0].length, excerpt: m[0], advice: tr(ADVICE.INTERNAL_PHRASE) });
    }
  }

  findings.sort((a, b) => a.start - b.start || b.end - a.end);
  const summary = { high: 0, medium: 0, low: 0 };
  for (const f of findings) summary[f.severity] = (summary[f.severity] || 0) + 1;
  return { ok: findings.length === 0, findings, summary };
}
