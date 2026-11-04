// The only file in src/context that touches the browser: it hands the read-only Table/Aggregate client to the pure
// context functions as `deps`. Use it inside the content script on a ServiceNow page; everything else in src/context
// takes `deps` as an argument and is tested with a fake.

import { countByColumn, countRecords, fetchRecord, queryTable } from '../content/tableApi.js';

/** The real instance, read with the signed-in user's own session (ACLs apply). */
export const liveDeps = Object.freeze({ queryTable, fetchRecord, countRecords, countByColumn });

/** The deps every READ operation starts from (src/content/reads.js puts the organisation's policy around them). */
export function createLiveDeps() {
  return liveDeps;
}
