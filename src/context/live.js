// The only file in src/context that touches the browser: it hands the read-only Table/Aggregate client to the pure
// context functions as `deps`. Use it inside the content script on a ServiceNow page; everything else in src/context
// takes `deps` as an argument and is tested with a fake.

import { countByColumn, countRecords, fetchRecord, queryTable } from '../content/tableApi.js';

/** The real instance, read with the signed-in user's own session (ACLs apply). */
export const liveDeps = Object.freeze({ queryTable, fetchRecord, countRecords, countByColumn });

/**
 * The same deps with an AbortSignal on every row read, so closing the panel cancels the requests that are still waiting.
 * (The Aggregate API calls take no signal and are passed through.)
 */
export function createLiveDeps({ signal } = {}) {
  if (!signal) return liveDeps;
  const withSignal = (options = {}) => ({ ...options, signal });
  return Object.freeze({
    queryTable: (table, query, fields, options) => queryTable(table, query, fields, withSignal(options)),
    fetchRecord: (table, sysId, fields, options) => fetchRecord(table, sysId, fields, withSignal(options)),
    countRecords,
    countByColumn,
  });
}
