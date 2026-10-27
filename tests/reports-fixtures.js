// Helpers shared by the reports tests: a scriptable fake of the two reads the engine uses (queryTable, aggregate).
// Not a test file itself (tests/run.js only runs *.test.js).

export const USER = '9'.repeat(32);
export const GROUP_A = 'a'.repeat(32);
export const GROUP_B = 'b'.repeat(32);
export const NOW = Date.UTC(2026, 9, 27, 12, 0, 0); // Tuesday 27 Oct 2026, 12:00 UTC
export const DAY = 86400000;
export const HOUR = 3600000;

export const cell = (value, display) => ({ value, display_value: display ?? value });
/** One Aggregate API group: group('assigned_to', id, 'Ann Lee', 4) or with two keys via groupN. */
export const group = (field, value, display, count, extra = {}) => ({ stats: { count: String(count), ...extra }, groupby_fields: [{ field, value, display_value: display }] });
export const group2 = (f1, v1, d1, f2, v2, d2, count) => ({ stats: { count: String(count) }, groupby_fields: [{ field: f1, value: v1, display_value: d1 }, { field: f2, value: v2, display_value: d2 }] });
export const count = (n) => ({ stats: { count: String(n) } });

const denied = () => Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' });

/**
 * @param {object} [options]
 * @param {string[]} [options.denied] tables that answer 403
 * @param {string[]} [options.hidden] tables that answer 200 with nothing, whatever the query
 * @param {string[]} [options.missingColumns] columns the instance does not have (left out of every row)
 * @param {{ when: (call) => boolean, then: any | ((call) => any) }[]} [options.rules] first match wins
 * A call is { kind: 'query' | 'aggregate', table, query, fields, groupBy, avgFields, options }.
 */
export function fakeInstance({ denied: deniedTables = [], hidden = [], missingColumns = [], rules = [] } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;

  async function route(call) {
    calls.push(call);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (deniedTables.includes(call.table)) throw denied();
      for (const rule of rules) {
        if (rule.when(call)) return typeof rule.then === 'function' ? rule.then(call) : rule.then;
      }
      if (hidden.includes(call.table)) return call.kind === 'aggregate' ? (call.groupBy.length ? [] : count(0)) : [];
      if (call.kind === 'query' && call.query === '') {
        // The "can I see this table, and which columns does it have" probe: one row with every requested column.
        const row = {};
        call.fields.filter((f) => !missingColumns.includes(f)).forEach((f) => {
          row[f] = f === 'sys_id' ? 'f'.repeat(32) : '';
        });
        return [row];
      }
      if (call.kind === 'aggregate') return call.groupBy.length ? [] : count(0);
      return [];
    } finally {
      inFlight -= 1;
    }
  }

  return {
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    deps: {
      queryTable: (table, query, fields, opts) => route({ kind: 'query', table, query, fields: fields || [], options: opts || {} }),
      aggregate: (table, o = {}) => route({ kind: 'aggregate', table, query: o.query || '', groupBy: o.groupBy || [], avgFields: o.avgFields || [], options: o }),
    },
    /** Calls to one table, optionally only those whose query contains `text`. */
    callsTo: (table, text = '') => calls.filter((c) => c.table === table && c.query.includes(text)),
  };
}
