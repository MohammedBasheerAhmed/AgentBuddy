// The only way report sections read from the instance. It adds, around the injected `deps` (queryTable, aggregate):
//   - a limit on parallel requests, shared by everything the page is asked for
//   - a time limit for the whole section (reads started after it are refused at once, waiting ones are given up on)
//   - a short-lived cache (identical reads in the same minute are one request) that "Refresh" empties
//   - the managed policy's blocked tables
//   - honest failure results: a table you cannot read is { ok: false, status: 'denied' }, never a zero
// A lost session is not a read problem: it is thrown so the whole report can say "log in again".
import { classifyReadError, confirmEmptyIsReallyEmpty, STATUS } from '../../context/access.js';
import { say, tm } from './say.js';
import { SYS_ID_RE, raw, disp } from '../../context/util.js';
import { LIMITS, tableWords } from './constants.js';

export class ReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
  }
}

export const isSessionExpired = (err) => err?.code === 'SESSION_EXPIRED';

// A text for a person that is also a table name, or 'this': what a failed read is about is said as words ('incidents'), never as the
// table's name (the note is shown as it is written, and the instance's own error text is never part of it).
const TABLE_NAME = /^[a-z][a-z0-9_]*$/;
const thing = (what) => (what !== 'this' && TABLE_NAME.test(String(what)) ? tableWords(what) : String(what));
// A column in a sentence ('configuration item', not cmdb_ci): the few the reports group by, else the name as words.
const COLUMN_WORDS = { cmdb_ci: 'configuration item', caller_id: 'caller', assigned_to: 'assigned to', assignment_group: 'assignment group', opened_by: 'opened by', business_service: 'service' };
const columnWords = (name) => COLUMN_WORDS[name] || String(name).replace(/^u_/, '').replace(/_/g, ' ');

// What a person is told about a failed read: fixed sentences by status (the engine's notes are shown as they are written).
const FAILED_NOTE = {
  denied: tm('Not available to you.'),
  error: tm('Could not be read right now.'),
  skipped: tm('Not available on this ServiceNow site.'),
};

/** { ok: true, value } or { ok: false, status, note } for one number: 'denied' | 'hidden' | 'blocked' | 'timeout' | 'error'. */
export async function attempt(fn, what = 'this') {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (isSessionExpired(err)) throw err;
    if (err?.code === 'TIMEOUT' || err?.name === 'AbortError') return { ok: false, status: 'timeout', note: tm('It took too long to read.') };
    if (err?.code === 'BLOCKED') return { ok: false, status: 'blocked', note: err.message };
    if (err?.code === 'NO_COLUMN') return { ok: false, status: 'error', note: err.message };
    const { status } = classifyReadError(err, thing(what));
    if (status === 'blocked') {
      // (the policy guard's own message names a table: said here with the table's words)
      return { ok: false, status, note: what !== 'this' && TABLE_NAME.test(String(what)) ? say(tm('Your organisation does not allow reports to read {table}.'), { table: thing(what) }) : tm('Your organisation does not allow reports to read this.') };
    }
    return { ok: false, status, note: FAILED_NOTE[status] || FAILED_NOTE.error };
  }
}

/** The counts from an Aggregate API answer: [{ keys: [{ field, value, display }], count, avg: { column: number } }]. */
export function normalizeGroups(result) {
  if (!Array.isArray(result)) return null;
  return result.map((g) => {
    const avg = {};
    Object.entries(g?.stats?.avg || {}).forEach(([k, v]) => {
      const n = Number(v);
      if (Number.isFinite(n)) avg[k] = n;
    });
    return {
      count: Math.max(0, Number(g?.stats?.count) || 0),
      avg,
      keys: (Array.isArray(g?.groupby_fields) ? g.groupby_fields : []).map((f) => ({
        field: String(f?.field || ''),
        value: f?.value == null ? '' : String(f.value),
        // A reference the user may not read can come back with no display value: its stored value is the id, which is never a name
        // (D1, R-13). keyName says what to show instead.
        display: shownName(f),
      })),
    };
  });
}

// What a group-by key shows: its display value, else the stored value unless that is an id.
function shownName(field) {
  const shown = String(field?.display_value || field?.value || '');
  return SYS_ID_RE.test(shown) ? '' : shown;
}

/**
 * The name shown for a person or group column of a ticket row: its display value; for a reference whose name is hidden from this user,
 * `hidden` (the person is there, "(unassigned)" would be false); '' for an empty column.
 */
export function nameOf(cell, hidden = tm('Not shown to you')) {
  const shown = disp(cell);
  if (shown) return shown;
  return raw(cell) ? hidden : '';
}

/**
 * The name of a group-by key for a row: its display value; for a key that is an id with no display value, `hidden` (the person or group
 * exists, its name is hidden from this user: never counted as "nobody" and never shown as an id); else `empty` (the column is empty).
 */
export function keyName(key, empty, hidden = tm('Not shown to you')) {
  if (key?.display) return key.display;
  return key?.value ? hidden : empty;
}

/**
 * @param {object} options
 * @param {{ queryTable: Function, aggregate: Function }} options.deps
 * @param {ReturnType<import('./cache.js').createCache>} options.cache shared across sections
 * @param {ReturnType<import('./cache.js').createLimiter>} options.limiter shared across sections
 * @param {string} [options.prefix] cache namespace (the signed-in user)
 * @param {string[]} [options.blocked] tables the organisation's policy does not allow
 * @param {(table: string) => boolean} [options.isBlocked] the content script's own policy check (src/content/policyGuard.js), on
 *   top of `blocked`; it is asked BEFORE the cache, so a table blocked after a number was cached is refused all the same
 * @param {AbortSignal} [options.signal]
 */
export function createReader({ deps, cache, limiter, prefix = '', blocked = [], isBlocked: policyBlocks = null, signal }) {
  let oldest = Infinity;
  const blockedSet = new Set(blocked.map((t) => String(t).toLowerCase()));
  const blocks = (table) => {
    const name = String(table).toLowerCase();
    if (blockedSet.has(name)) return true;
    try {
      return Boolean(policyBlocks?.(name));
    } catch {
      return true; // a policy that cannot answer is not a yes
    }
  };

  const aborted = () => Boolean(signal?.aborted);
  const timeoutError = () => new ReportError('TIMEOUT', tm('It took too long to read this.'));
  // A shared request that stopped because ANOTHER section gave up on it (its own time limit), not because of this one.
  const gaveUp = (err) => err?.code === 'TIMEOUT' || err?.name === 'AbortError';

  // Rejects when the signal fires, so a request whose deps ignore the signal still stops waiting.
  const abortion = signal
    ? new Promise((_, reject) => {
        if (signal.aborted) reject(timeoutError());
        signal.addEventListener('abort', () => reject(timeoutError()), { once: true });
      })
    : null;
  abortion?.catch(() => {}); // never an unhandled rejection when nobody is waiting

  function check(table) {
    if (aborted()) throw timeoutError();
    if (blocks(table)) throw new ReportError('BLOCKED', say(tm('Your organisation does not allow reports to read {table}.'), { table: tableWords(table) }));
  }

  const limited = (fn) => limiter.run(() => (abortion ? Promise.race([Promise.resolve().then(fn), abortion]) : fn()));

  async function cached(key, fn) {
    const full = `${prefix}|${key}`;
    let entry;
    try {
      entry = await cache.load(full, fn);
    } catch (err) {
      // Two sections asking for the same number share one request. When the OTHER section ran out of time, the shared request is
      // cancelled under this one too: that is not this section's failure, so it asks once more on its own time (the failed load
      // is no longer in the cache, so this is a new request, with this section's own time limit).
      if (!gaveUp(err) || aborted()) throw err;
      entry = await cache.load(full, fn);
    }
    if (entry.at < oldest) oldest = entry.at;
    return entry.value;
  }

  const api = {
    /** When the oldest number used so far was actually read (ms), or null when nothing was read. */
    get readAt() {
      return Number.isFinite(oldest) ? oldest : null;
    },

    isBlocked: (table) => blocks(table),

    async count(table, query = '') {
      check(table);
      return cached(`count|${table}|${query}`, () =>
        limited(async () => {
          const result = await deps.aggregate(table, { query, signal });
          const n = Number(result?.stats?.count);
          if (!Number.isFinite(n)) throw new ReportError('BAD_ANSWER', say(tm('ServiceNow did not return a count for {table}.'), { table: tableWords(table) }));
          return n;
        })
      );
    },

    /**
     * Counts per value of one or two columns. `avg` names numeric columns to average per group. `minCount` asks the instance to
     * leave out the groups smaller than that (the Aggregate API's sysparm_having), so a breakdown with thousands of small groups
     * does not travel; the caller still filters, because an instance (or a table client) may ignore it.
     */
    async groups(table, query, columns, { avg = [], minCount = 0 } = {}) {
      check(table);
      const min = Math.max(0, Math.floor(Number(minCount)) || 0);
      // aggregate^field^operator^value; "> min - 1" because ">" is the operator every release documents.
      const having = min > 1 && columns.length === 1 ? `count^${columns[0]}^>^${min - 1}` : '';
      return cached(`groups|${table}|${query}|${columns.join(',')}|${avg.join(',')}|${having}`, () =>
        limited(async () => {
          const result = await deps.aggregate(table, { query, groupBy: columns, avgFields: avg, signal, ...(having ? { having } : {}) });
          const groups = normalizeGroups(result);
          // A column the table does not have may be ignored by the instance: the answer is then not grouped at all.
          if (!groups) throw new ReportError('NO_COLUMN', say(tm('{columns} is not available on {table}.'), { columns: columns.map(columnWords).join(' and '), table: tableWords(table) }));
          return groups;
        })
      );
    },

    /** Average of numeric columns over a query (one number each), or null for a column with no values. */
    async averages(table, query, columns) {
      check(table);
      return cached(`avg|${table}|${query}|${columns.join(',')}`, () =>
        limited(async () => {
          const result = await deps.aggregate(table, { query, avgFields: columns, signal });
          const stats = result?.stats;
          if (!stats) throw new ReportError('BAD_ANSWER', say(tm('ServiceNow did not return an average for {table}.'), { table: tableWords(table) }));
          const out = { count: Number(stats.count) || 0 };
          columns.forEach((c) => {
            const n = Number(stats.avg?.[c]);
            out[c] = Number.isFinite(n) && stats.avg?.[c] !== '' ? n : null;
          });
          return out;
        })
      );
    },

    async rows(table, query, fields, { limit = 50, offset = 0, displayValue = false } = {}) {
      check(table);
      return cached(`rows|${table}|${query}|${fields.join(',')}|${limit}|${offset}|${displayValue ? 1 : 0}`, () =>
        limited(async () => {
          const rows = await deps.queryTable(table, query, fields, { limit, offset, displayValue, signal });
          return Array.isArray(rows) ? rows : [];
        })
      );
    },

    /**
     * Read up to `max` rows, one page at a time. { rows, fetched, capped, total }: `capped` is true when more rows exist than
     * were read (so the caller can say "first 3000 of 4210").
     */
    async pages(table, query, fields, { max = LIMITS.dateRowsMax, pageSize = LIMITS.pageSize, displayValue = false } = {}) {
      const rows = [];
      let lastFull = false;
      while (rows.length < max) {
        const want = Math.min(pageSize, max - rows.length);
        // eslint-disable-next-line no-await-in-loop -- pages stay sequential so the instance is not hit with a burst.
        const page = await api.rows(table, query, fields, { limit: want, offset: rows.length, displayValue });
        rows.push(...page);
        lastFull = page.length >= want;
        if (!lastFull) break;
      }
      let total = rows.length;
      let capped = false;
      if (lastFull && rows.length >= max) {
        // The last page was full, so there may be more: ask for the real number.
        const counted = await attempt(() => api.count(table, query), table);
        if (counted.ok) {
          total = counted.value;
          capped = counted.value > rows.length;
        } else {
          capped = true;
          total = null;
        }
      }
      return { rows, fetched: rows.length, capped, total };
    },

    /**
     * Can this person see rows of the table at all? { status: 'ok' | 'hidden' | 'denied' | 'error' | 'blocked', note }.
     * 'hidden' means an unfiltered read returned nothing: the table may be empty or an access rule hides every row, so a
     * zero from this table proves nothing (confirmEmptyIsReallyEmpty, as everywhere else in Agent Buddy).
     */
    async visibility(table) {
      if (blocks(table)) return { status: 'blocked', note: say(tm('Your organisation does not allow reports to read {table}.'), { table: tableWords(table) }) };
      if (aborted()) return { status: 'error', note: tm('It took too long to read this.') };
      try {
        return await cached(`visible|${table}`, async () => {
          const reads = { queryTable: (t, q, f, o) => api.rows(t, q, f, o) };
          const answer = await confirmEmptyIsReallyEmpty(table, reads, new Map());
          if (answer.status === STATUS.EMPTY) return { status: 'ok', note: '' };
          // (the notes are this engine's own fixed sentences, said with the table's words: not the read layer's, which names the table)
          const words = tableWords(table);
          if (answer.status === STATUS.EMPTY_OR_HIDDEN) return { status: 'hidden', note: say(tm('You can see no {table} at all, so a count of none proves nothing: there may be none, or your role may not let you see them.'), { table: words }) };
          if (answer.status === STATUS.DENIED) return { status: 'denied', note: FAILED_NOTE.denied };
          if (answer.status === STATUS.BLOCKED) return { status: 'blocked', note: say(tm('Your organisation does not allow reports to read {table}.'), { table: words }) };
          // A passing failure (a timeout, a busy instance) is an answer for now only: thrown so the cache does not keep it, and a
          // table is not reported as unreadable for the next minute because of one slow request.
          throw Object.assign(new Error(FAILED_NOTE.error), { visibility: { status: 'error', note: FAILED_NOTE.error } });
        });
      } catch (err) {
        if (err?.visibility) return err.visibility;
        throw err;
      }
    },

    /** Which of `names` exist as columns of the table, judged from one row. { known, has(name) }. */
    async columns(table, names) {
      const rows = await api.rows(table, '', ['sys_id', ...names], { limit: 1 });
      const row = rows[0];
      const present = new Set(row ? Object.keys(row) : []);
      return { known: Boolean(row), has: (name) => present.has(name), names: [...present] };
    },
  };

  return api;
}

/** Row cell helpers re-exported so sections do not import two places. */
export { raw, disp };
