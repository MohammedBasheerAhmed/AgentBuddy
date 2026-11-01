// The "open the full list" address: the classic list of a table with a filter, on the instance the page is on. Built from the page's
// own origin and a filter the reader made from validated parts (sys_ids and fixed words), never from ticket text. Pure.
import { TABLE_RE } from '../context/util.js';

// Only what the reader writes into a list filter: column names, = and the word operators (IN, ISEMPTY), sys_ids, commas, ^ joins.
const QUERY_RE = /^[A-Za-z0-9_.=^,]{1,4000}$/;

/** `${origin}/nav_to.do?uri=<table>_list.do?sysparm_query=...`, or '' when it cannot be built safely. */
export function fullListUrl(page, table, query) {
  if (!TABLE_RE.test(table || '') || !QUERY_RE.test(String(query || ''))) return '';
  let origin;
  try {
    origin = new URL(page.href).origin;
  } catch {
    return '';
  }
  if (!/^https?:$/.test(new URL(origin).protocol)) return '';
  const inner = `${table}_list.do?sysparm_query=${encodeURIComponent(query)}`;
  return `${origin}/nav_to.do?uri=${encodeURIComponent(inner)}`;
}
