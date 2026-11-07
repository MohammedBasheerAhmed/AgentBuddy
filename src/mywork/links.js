// The "open the full list" address: the classic list of a table with a filter, on the instance the page is on. Built from the page's
// own origin and a filter the reader made from validated parts (sys_ids and fixed words), never from ticket text. The address itself
// comes from src/lib/snLinks.js (the one list builder, shared with the report drill-downs). Pure.
import { listLink } from '../lib/snLinks.js';

// Only what the reader writes into a list filter: column names, = and the word operators (IN, ISEMPTY), sys_ids, commas, ^ joins.
const QUERY_RE = /^[A-Za-z0-9_.=^,]{1,4000}$/;

/** `${origin}/nav_to.do?uri=<table>_list.do?sysparm_query=...`, or '' when it cannot be built safely. */
export function fullListUrl(page, table, query) {
  if (!QUERY_RE.test(String(query || ''))) return '';
  return listLink(page, table, query);
}
