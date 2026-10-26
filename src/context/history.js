// "What happened before": the tickets a caller has had on the main fulfiller tables, with a few signals worked out
// locally (repeat issues, still-open tickets, the last fix that worked, a reopen pattern). Read-only, minimal columns.
//
// Every table is asked with a condition on the caller and every row is checked against the caller again: ServiceNow
// ignores a condition on a column that does not exist and then returns everyone's rows, and those must never be
// shown as this caller's history. HR cases are only read when `allowSensitive` is set.

import { similarKeywords } from '../lib/similar.js';
import { LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { SYS_ID_RE, cleanText, disp, oneLine, parseSnTime, raw } from './util.js';

const DAY = 86400000;

// `links`: columns that can hold the caller, tried in order until one answers with rows that really are the caller's.
export const HISTORY_SOURCES = Object.freeze([
  { table: 'incident', links: ['caller_id'] },
  { table: 'sc_req_item', links: ['requested_for', 'request.requested_for'] },
  { table: 'sn_customerservice_case', links: ['contact'] },
  { table: 'sn_hr_core_case', links: ['opened_for'], sensitive: true },
]);

const FIELDS = [
  'sys_id', 'number', 'short_description', 'state', 'active', 'opened_at', 'resolved_at', 'closed_at', 'close_code',
  'resolution_code', 'close_notes', 'category', 'cat_item', 'cmdb_ci', 'assignment_group',
];

const CLOSED_STATE = /closed|resolved|cancel|complete|solved/i;

// ---- Rows to items -------------------------------------------------------------------------------------

/** One history item from a Table API row (display values). Times: *_at are as the user sees them, *Utc are stored UTC. */
export function normaliseHistoryRow(row, table) {
  const resolvedUtc = raw(row.resolved_at) || raw(row.closed_at);
  return {
    table,
    sysId: raw(row.sys_id).toLowerCase(),
    number: oneLine(disp(row.number), 40),
    short_description: cleanText(disp(row.short_description), LIMITS.shortDescription),
    state: oneLine(disp(row.state), 40),
    active: raw(row.active) === 'true' || raw(row.active) === 'false' ? raw(row.active) : '',
    category: oneLine(disp(row.category) || disp(row.cat_item), 100),
    cmdb_ci: oneLine(disp(row.cmdb_ci), 100),
    assignment_group: oneLine(disp(row.assignment_group), 100),
    close_code: oneLine(disp(row.close_code) || disp(row.resolution_code), 60),
    close_notes: cleanText(disp(row.close_notes), LIMITS.historyCloseNotes),
    opened_at: oneLine(disp(row.opened_at), 40),
    resolved_at: oneLine(disp(row.resolved_at) || disp(row.closed_at), 40),
    openedUtc: raw(row.opened_at),
    resolvedUtc,
  };
}

// ---- Signals (pure) -------------------------------------------------------------------------------------

const keywordsOf = (item) => similarKeywords(item.short_description, 4);
const resolvedLike = (item) => Boolean(item.resolvedUtc) || item.active === 'false' || CLOSED_STATE.test(item.state);

function sharedKeywords(a, b) {
  const other = new Set(keywordsOf(b));
  return keywordsOf(a).filter((w) => other.has(w));
}

function repeatsOf(items) {
  const groups = new Map();
  const add = (kind, key, number) => {
    if (!key) return;
    const id = `${kind}:${key}`;
    if (!groups.has(id)) groups.set(id, { kind, key, count: 0, numbers: [] });
    const group = groups.get(id);
    group.count += 1;
    group.numbers.push(number);
  };
  for (const item of items) {
    add('category', item.category.toLowerCase(), item.number);
    keywordsOf(item).forEach((word) => add('keyword', word, item.number));
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === 'category' ? -1 : 1))
    .slice(0, 6);
}

// A later ticket that reads like the same problem coming back shortly after an earlier one was resolved.
function reopenHint(items) {
  const withTimes = items
    .map((item) => ({ item, opened: parseSnTime(item.openedUtc), resolved: parseSnTime(item.resolvedUtc) }))
    .filter((x) => Number.isFinite(x.opened))
    .sort((a, b) => b.opened - a.opened);
  for (const later of withTimes) {
    if (/reopen/i.test(later.item.state)) return { earlier: '', later: later.item.number, days: 0, shared: [] };
    for (const earlier of withTimes) {
      if (earlier === later || !Number.isFinite(earlier.resolved) || later.opened < earlier.resolved) continue;
      const days = (later.opened - earlier.resolved) / DAY;
      if (days > 14) continue;
      const shared = sharedKeywords(earlier.item, later.item);
      const sameCategory = earlier.item.category && earlier.item.category === later.item.category;
      const sameCi = earlier.item.cmdb_ci && earlier.item.cmdb_ci === later.item.cmdb_ci;
      if (shared.length >= 2 || (shared.length >= 1 && (sameCategory || sameCi))) {
        return { earlier: earlier.item.number, later: later.item.number, days: Math.round(days * 10) / 10, shared };
      }
    }
  }
  return null;
}

/**
 * What the list says at a glance.
 * @param {object[]} items from normaliseHistoryRow (any order)
 * @param {{ now?: number, current?: { short_description?: string, category?: string } }} [options]
 *   `current`: the ticket on screen, to name earlier tickets that look like it.
 * @returns {{ openCount: number, repeatCount: object, repeats: object[], lastResolved: object|null,
 *   reopenedHint: object|null, daysSinceLast: number|null, similarToCurrent: string[] }}
 */
export function historySignals(items, { now = Date.now(), current } = {}) {
  const list = items || [];
  const repeats = repeatsOf(list);

  const solved = list
    .filter((item) => resolvedLike(item) && item.close_notes)
    .sort((a, b) => (parseSnTime(b.resolvedUtc || b.openedUtc) || 0) - (parseSnTime(a.resolvedUtc || a.openedUtc) || 0))[0];

  const opened = list.map((item) => parseSnTime(item.openedUtc)).filter(Number.isFinite);
  let similarToCurrent = [];
  if (current?.short_description) {
    const wanted = new Set(similarKeywords(current.short_description, 4));
    const category = String(current.category || '').toLowerCase();
    similarToCurrent = list
      .filter((item) => {
        const shared = keywordsOf(item).filter((w) => wanted.has(w)).length;
        return shared >= 2 || (shared >= 1 && category && item.category.toLowerCase() === category);
      })
      .map((item) => item.number)
      .slice(0, 5);
  }

  return {
    openCount: list.filter((item) => !resolvedLike(item)).length,
    repeatCount: Object.fromEntries(repeats.map((g) => [`${g.kind}:${g.key}`, g.count])),
    repeats,
    lastResolved: solved
      ? { table: solved.table, number: solved.number, short_description: solved.short_description, close_code: solved.close_code, close_notes: solved.close_notes, resolved_at: solved.resolved_at }
      : null,
    reopenedHint: reopenHint(list),
    daysSinceLast: opened.length ? Math.max(0, Math.floor((now - Math.max(...opened)) / DAY)) : null,
    similarToCurrent,
  };
}

// ---- Reading ----------------------------------------------------------------------------------------------

async function readSource(source, callerSysId, excludeSysId, deps, { limit, memo, knownVisible }) {
  const exclude = SYS_ID_RE.test(excludeSysId) ? `^sys_id!=${excludeSysId}` : '';
  let ignoredFilter = false;
  for (const link of source.links) {
    const query = `${link}=${callerSysId}${exclude}^ORDERBYDESCopened_at`;
    // eslint-disable-next-line no-await-in-loop -- a second link is only tried when the first was ignored.
    const { rows, failure } = await softRead(deps, source.table, query, [...FIELDS, link], { limit, displayValue: true });
    if (failure) return { items: [], access: accessEntry(source.table, failure.status, failure.note) };

    if (!rows.length) {
      if (knownVisible.has(source.table)) return { items: [], access: accessEntry(source.table, STATUS.EMPTY) };
      // eslint-disable-next-line no-await-in-loop
      const seen = await confirmEmptyIsReallyEmpty(source.table, deps, memo);
      return { items: [], access: accessEntry(source.table, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note) };
    }
    if (rows.every((row) => raw(row[link]).toLowerCase() === callerSysId)) {
      return { items: rows.map((row) => normaliseHistoryRow(row, source.table)), access: accessEntry(source.table, STATUS.OK) };
    }
    ignoredFilter = true;
  }
  return {
    items: [],
    access: accessEntry(source.table, STATUS.ERROR, `Could not check ${source.table}${ignoredFilter ? ': the instance did not apply the filter on this person, so its rows were not used' : ''}.`),
  };
}

/**
 * The caller's earlier tickets.
 * @param {{ callerSysId: string, excludeSysId?: string }} who excludeSysId: the ticket on screen
 * @param {{ queryTable: Function }} deps
 * @param {{ limit?: number, tables?: string[], allowSensitive?: boolean, now?: number, current?: object,
 *   knownVisible?: string[], memo?: Map }} [options] tables: restrict to these table names
 * @returns {Promise<{ items: object[], signals: object, access: object[] }>} items are oldest first (newest last),
 *   at most `limit` of the newest across all tables. Items carry sysId/table for local links; they are not ContextPack data.
 */
export async function readCallerHistory({ callerSysId, excludeSysId = '' }, deps, options = {}) {
  const { limit = LIMITS.historyRows, tables, allowSensitive = false, now = Date.now(), current, knownVisible = [], memo = new Map() } = options;
  if (!SYS_ID_RE.test(callerSysId || '')) return { items: [], signals: historySignals([], { now, current }), access: [accessEntry('caller-history', STATUS.SKIPPED, 'No caller was found on this record.')] };
  const caller = callerSysId.toLowerCase();

  const wanted = HISTORY_SOURCES.filter((source) => !tables || tables.includes(source.table));
  const access = [];
  const items = [];
  const visible = new Set(knownVisible);
  for (const source of wanted) {
    if (source.sensitive && !allowSensitive) {
      access.push(accessEntry(source.table, STATUS.SKIPPED, 'HR cases are only included when sensitive data is allowed.'));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- one table at a time keeps the load on the instance low.
    const result = await readSource(source, caller, excludeSysId, deps, { limit, memo, knownVisible: visible });
    items.push(...result.items);
    access.push(result.access);
  }

  const newest = items
    .sort((a, b) => (parseSnTime(b.openedUtc) || 0) - (parseSnTime(a.openedUtc) || 0))
    .slice(0, limit)
    .reverse();
  return { items: newest, signals: historySignals(newest, { now, current }), access };
}
