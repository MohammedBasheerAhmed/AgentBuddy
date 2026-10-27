// The safe-to-send check for text the Write section is about to put into a form field the customer can read.
//
// It is checkOutgoing() (src/safeSend) plus the firewall's own memory: the firewall learns every secret it masked on the way
// out, so a password the model repeats bare ("your sign-in value is Winter2026...") is still recognised even though no
// "password:" label stands in front of it. Findings come back masked (never the value itself).
//
// This mirrors the check ResultView runs for the ordinary Insert buttons; it lives here because the Write section has its
// own insert buttons (a body field, a replace mode) that ResultView does not offer.

import { checkOutgoing, maskExcerpt } from '../safeSend/index.js';

// Kinds the firewall masks on the way out and that must never come back into a message the customer reads.
const NEVER_BACK = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const NEVER_BACK_ADVICE = 'This is a password, key, card number or ID that was hidden from the AI, and it is back in the text. Remove it before it reaches the customer.';

/**
 * @param {string} plain the text about to be inserted
 * @param {object[]} people the record's people (their own email addresses are not flagged)
 * @param {(text: string) => object[]} [scan] the firewall's scan() from the run that produced the text
 * @returns {{kind: string, severity: string, start: number, end: number, excerpt: string, advice: string}[]} findings that need a look (low severity left out)
 */
export function seriousFindings(plain, people = [], scan = null) {
  const found = checkOutgoing(plain, { people }).findings.filter((f) => f.severity !== 'low');
  let remembered = [];
  try {
    remembered = (typeof scan === 'function' ? scan(plain) : []).filter((f) => NEVER_BACK.has(f.kind));
  } catch {
    /* the text check above still applies */
  }
  const extra = remembered
    .filter((f) => !found.some((g) => g.start < f.end && f.start < g.end))
    .map((f) => ({ kind: f.kind, severity: 'high', start: f.start, end: f.end, excerpt: maskExcerpt(f.value), advice: NEVER_BACK_ADVICE }));
  return [...found, ...extra];
}
