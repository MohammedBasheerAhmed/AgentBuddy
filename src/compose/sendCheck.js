// The safe-to-send check for text the Write section is about to put into a form field the customer can read.
//
// There is one implementation of the check, src/safeSend/review.js (reviewForCustomer): ResultView and the Write section both
// call it. This file keeps the name the Write section's tests and panels use: the findings that STOP an insert until the person
// chooses ("Insert anyway"). The low-severity ones come back as `hints` from reviewForCustomer() itself.

import { reviewForCustomer } from '../safeSend/review.js';

/**
 * @param {string} plain the text about to be inserted
 * @param {object[]} people the record's people (their own email addresses are not flagged)
 * @param {(text: string) => object[]} [scan] the firewall's scan() from the run that produced the text
 * @param {string[]} [internalTexts] the record's work notes (words copied from them are flagged)
 * @returns {{kind: string, severity: string, start: number, end: number, excerpt: string, advice: string}[]} findings that need a look (low severity left out)
 */
export function seriousFindings(plain, people = [], scan = null, internalTexts = []) {
  return reviewForCustomer(plain, { people, scan, internalTexts }).serious;
}
